import type { PayrollBundle, PayrollItemsBundle, PayrollRepository } from "../../core/ports/payroll";
import type { Notifier } from "../../core/ports/notifier";
import { attendanceTotalsForEmployee } from "../../domain/payroll";
import { isConnectivityFailure, friendlyError } from "../../shared/utils/errors";
import type { QueueOfflineMutation } from "../../shared/types";
import type {
  AttendanceEntry,
  Employee,
  PayrollPayPeriod,
  PayrollRun,
  Position,
} from "../../types";

/**
 * Everything that must hold before a payroll run can be generated. Pure, so each rule is
 * checkable without a database: returns the message to show, or null when generation is safe.
 */
export function validatePayrollGeneration(input: {
  employees: Employee[];
  positions: Position[];
  attendanceEntries: AttendanceEntry[];
  periodMonth: number;
  periodYear: number;
  payPeriod: PayrollPayPeriod;
}): string | null {
  const { employees, positions, attendanceEntries, periodMonth, periodYear, payPeriod } = input;

  const activeTeam = employees.filter((employee) => employee.status === "active");
  if (activeTeam.length === 0) {
    return "Add at least one active employee first.";
  }

  const withoutPosition = activeTeam.filter((employee) => {
    const position = positions.find((item) => item.id === employee.position_id);
    return !position || position.status !== "active";
  });
  if (withoutPosition.length > 0) {
    return `Assign an active position to: ${withoutPosition.map((employee) => employee.full_name).join(", ")}.`;
  }

  // Daily-wage pay is computed from attendance, so generating without any would silently
  // pay those employees zero rather than failing loudly.
  const missingAttendance = activeTeam.filter((employee) => {
    const position = positions.find((item) => item.id === employee.position_id);
    if (position?.pay_mode !== "daily") return false;
    const totals = attendanceTotalsForEmployee(attendanceEntries, employee.id, periodMonth, periodYear, payPeriod);
    return totals.presentDays + totals.halfDays + totals.absentDays === 0;
  });
  if (missingAttendance.length > 0) {
    return `Attendance not recorded for: ${missingAttendance.map((employee) => employee.full_name).join(", ")}. Please log attendance before generating payroll.`;
  }

  return null;
}

export type SavePayrollRunDeps = {
  repos: { payroll: PayrollRepository };
  queue: QueueOfflineMutation;
  notify: Notifier;
  isOnline: () => boolean;
  reload: () => Promise<void>;
};

export type SavePayrollRunResult = {
  outcome: "saved" | "queued" | "existing" | "failed";
  runId?: string;
};

const AFFECTED = [
  "payrollRuns", "payrollHistory", "employeeAdvances", "salaryBonds", "dashboardSummary",
] as const;

/**
 * Writes a generated run, its items, ticket details and deduction ledger as one bundle,
 * with the three recovery paths that matter: queue it when offline, fall back to the queue
 * on a connectivity failure, and -- when the period's unique key collides -- select the run
 * that already exists rather than reporting a duplicate-key error the admin cannot act on.
 */
export async function savePayrollRun(
  deps: SavePayrollRunDeps,
  input: { run: PayrollRun; bundle: PayrollBundle },
): Promise<SavePayrollRunResult> {
  const { run, bundle } = input;

  const queueBundle = async () => {
    await deps.queue({
      resource: "payrollRuns",
      affectedResources: [...AFFECTED],
      operation: "payroll_group",
      table: "payroll_runs",
      payload: bundle,
    });
  };

  if (!deps.isOnline()) {
    await queueBundle();
    return { outcome: "queued", runId: run.id };
  }

  const result = await deps.repos.payroll.saveBundle(bundle);
  if (!result.error) {
    deps.notify.success("Payroll run generated.");
    return { outcome: "saved", runId: run.id };
  }

  if (isConnectivityFailure(result.error)) {
    await queueBundle();
    return { outcome: "queued", runId: run.id };
  }

  const message = `${result.error.message ?? ""} ${result.error.details ?? ""}`.toLowerCase();
  const collided = message.includes("duplicate key") || message.includes("payroll_runs_user_id_period");
  if (collided) {
    await deps.reload();
    const existing = await deps.repos.payroll.findRunId(run.period_month, run.period_year, run.pay_period);
    if (existing.data) {
      deps.notify.success("Payroll for this pay period already exists and has been selected.");
      return { outcome: "existing", runId: existing.data };
    }
  }

  deps.notify.error(friendlyError(result.error));
  return { outcome: "failed" };
}

export type SaveItemsBundleOutcome = "saved" | "queued" | "failed";

/**
 * Adds newly-hired employees to a payroll run that was already generated before they joined
 * the team. Same bundle-write/offline-queue/connectivity-fallback shape as savePayrollRun,
 * but against payroll_run_items rather than payroll_runs -- there is no unique-key collision
 * to recover from here, since this patches an existing, already-known run rather than
 * creating a new one.
 *
 * "Nothing to add" and "declined" both resolve to "failed": the caller's job either way is to
 * skip the follow-up sync and reload, and any real error is already reported here via notify.
 */
export async function addMissingEmployeesToRun(
  deps: SavePayrollRunDeps,
  input: { missingEmployeeCount: number; bundle: PayrollItemsBundle },
): Promise<SaveItemsBundleOutcome> {
  const { missingEmployeeCount, bundle } = input;
  if (missingEmployeeCount === 0) return "failed";

  const confirmed = await deps.notify.confirm({
    title: "Add missing employees",
    message: `Add ${missingEmployeeCount} missing employee${missingEmployeeCount === 1 ? "" : "s"} to this payroll run?`,
  });
  if (!confirmed) return "failed";

  const queueBundle = async () => {
    await deps.queue({
      resource: "payrollRuns",
      affectedResources: [...AFFECTED],
      operation: "payroll_items_group",
      table: "payroll_run_items",
      payload: bundle,
    });
  };

  if (!deps.isOnline()) {
    await queueBundle();
    return "queued";
  }

  const result = await deps.repos.payroll.saveItemsBundle(bundle);
  if (!result.error) {
    deps.notify.success(`${missingEmployeeCount} employee${missingEmployeeCount === 1 ? "" : "s"} added to payroll.`);
    return "saved";
  }

  if (isConnectivityFailure(result.error)) {
    await queueBundle();
    return "queued";
  }

  deps.notify.error(friendlyError(result.error));
  return "failed";
}
