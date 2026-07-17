import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { BadgeDollarSign, CalendarClock, CheckCircle2, Plus, Users, X } from "lucide-react";
import { Spinner } from "../../shared/components/Spinner";
import { ActionProgress, type ActionProgressState } from "../../shared/components/ActionProgress";
import {
  attendanceTotalsForEmployee,
  dailyTicketEntriesForPayrollPeriod,
  governmentDeductionForEmployee,
  payrollExpensePayload,
  payrollItemPayloadForEmployee,
} from "../../domain/payroll";
import { salaryBondDeductionsForEmployee, salaryBondHasDeductionForItem } from "../../domain/salaryBonds";
import { netPay, normalizeTicketCount, ticketGrossPay } from "../../domain/tickets";
import { isOfflineLikeError } from "../../lib/offlineSync";
import { supabase } from "../../supabase";
import { Modal, TextField } from "../../shared/components/FormLayout";
import { DataTable } from "../../shared/components/DataTable";
import { PageHeader, RecordTitle, Toolbar } from "../../shared/components/PageLayout";
import { ensurePayrollSettings, savePayrollSettings } from "./payrollRepository";
import { ensurePayrollExpenseCategory, saveExpense } from "../expenses/expenseRepository";
import type { QueueOfflineMutation } from "../../shared/types";
import { NotificationService } from "../../shared/notifications/NotificationService";
import { currency, toNumber } from "../../shared/utils/currency";
import { currentMonth, currentYear, monthNames, todayKey } from "../../shared/utils/dates";
import { friendlyError } from "../../shared/utils/errors";
import type {
  AttendanceEntry,
  DailyTicketEntry,
  EmployeeAdvance,
  Employee,
  ExpenseCategory,
  PayrollHistoryRow,
  PayrollPayPeriod,
  PayrollRun,
  PayrollRunFormValues,
  PayrollRunItem,
  PayrollSettings,
  PayrollRunWithItems,
  Position,
  SalaryBond,
} from "../../types";

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "E";
}

function EmpAvatar({ employees, employeeId, employeeName }: { employees: Employee[]; employeeId: string | null; employeeName: string }) {
  const emp = employees.find((e) => e.id === employeeId);
  const fallback = initials(employeeName);
  return (
    <div className="employee-list-avatar">
      {emp?.profile_photo_url
        ? <img alt="" src={emp.profile_photo_url} />
        : <span>{fallback}</span>}
    </div>
  );
}

const emptyPayrollRun: PayrollRunFormValues = {
  period_month: currentMonth(),
  period_year: currentYear(),
  pay_period: "first_half",
  generated_date: todayKey(),
  notes: "",
};

type EmployeeAdvancePayrollDeduction = {
  amount: number;
  advance: EmployeeAdvance;
};

type SalaryBondPayrollDeduction = {
  amount: number;
  bond: SalaryBond;
};

const EMPLOYEE_ADVANCE_NOTE_PREFIX = "Employee advance deduction:";
const SALARY_BOND_NOTE_PREFIX = "Salary bond deduction:";
const GOVERNMENT_DEDUCTION_NOTE_PREFIX = "Government deduction:";

function employeeAdvanceDeductionsForEmployee(
  employeeAdvances: EmployeeAdvance[],
  employee: Employee,
  payrollDate: string,
) {
  return employeeAdvances
    .filter((advance) =>
      advance.status === "active" &&
      advance.employee_id === employee.id &&
      toNumber(advance.balance) > 0 &&
      toNumber(advance.deduction_per_payroll) > 0 &&
      (!advance.start_deduction || advance.start_deduction <= payrollDate)
    )
    .map((advance) => ({
      amount: Math.min(toNumber(advance.balance), toNumber(advance.deduction_per_payroll)),
      advance,
    }))
    .filter((deduction) => deduction.amount > 0);
}

function payrollItemPayloadForEmployeeWithEmployeeAdvances(
  employee: Employee,
  position: Position | undefined,
  payrollRunId: string,
  userId: string,
  dailyTicketEntries: DailyTicketEntry[],
  employeeAdvances: EmployeeAdvance[],
  salaryBonds: SalaryBond[],
  payrollSettings: PayrollSettings | null,
  payrollDate: string,
  attendanceEntries: AttendanceEntry[] = [],
  periodMonth = 0,
  periodYear = 0,
  payPeriod: PayrollPayPeriod = "first_half",
) {
  const payload = payrollItemPayloadForEmployee(
    employee,
    payrollRunId,
    userId,
    dailyTicketEntries,
    position,
    attendanceEntries,
    periodMonth,
    periodYear,
    payPeriod,
  );
  const governmentDeduction = governmentDeductionForEmployee(employee, payrollSettings, payPeriod);
  const advanceDeductions = employeeAdvanceDeductionsForEmployee(employeeAdvances, employee, payrollDate);
  const employeeAdvanceDeduction = advanceDeductions.reduce((sum, deduction) => sum + deduction.amount, 0);
  const bondDeductions = salaryBondDeductionsForEmployee(salaryBonds, employee, payrollDate);
  const salaryBondDeduction = bondDeductions.reduce((sum, deduction) => sum + deduction.amount, 0);

  if (governmentDeduction === 0 && employeeAdvanceDeduction === 0 && salaryBondDeduction === 0) {
    return { advanceDeductions, bondDeductions, payload };
  }

  const deductions = toNumber(payload.deductions) + governmentDeduction + employeeAdvanceDeduction + salaryBondDeduction;
  const notes = [
    governmentDeduction > 0 ? `${GOVERNMENT_DEDUCTION_NOTE_PREFIX} ${currency.format(governmentDeduction)}` : "",
    employeeAdvanceDeduction > 0 ? `${EMPLOYEE_ADVANCE_NOTE_PREFIX} ${currency.format(employeeAdvanceDeduction)}` : "",
    salaryBondDeduction > 0 ? `${SALARY_BOND_NOTE_PREFIX} ${currency.format(salaryBondDeduction)}` : "",
  ].filter(Boolean);

  return {
    advanceDeductions,
    bondDeductions,
    payload: {
      ...payload,
      deductions,
      net_pay: netPay(toNumber(payload.gross_pay), toNumber(payload.allowances), deductions),
      notes: [payload.notes, ...notes].filter(Boolean).join(" | "),
    },
  };
}

async function applyEmployeeAdvancePayrollDeductions(deductions: EmployeeAdvancePayrollDeduction[]) {
  if (!supabase || deductions.length === 0) return null;
  const client = supabase;

  const updates = deductions.map(({ amount, advance }) => {
    const balance = Math.max(0, toNumber(advance.balance) - amount);
    return client
      .from("employee_advances")
      .update({
        balance,
        status: balance === 0 ? "completed" : advance.status,
      })
      .eq("id", advance.id);
  });
  const results = await Promise.all(updates);
  return results.find((result) => result.error)?.error ?? null;
}

function employeeAdvanceUpdatesForDeductions(deductions: EmployeeAdvancePayrollDeduction[]) {
  return deductions.map(({ amount, advance }) => {
    const balance = Math.max(0, toNumber(advance.balance) - amount);
    return {
      id: advance.id,
      payload: {
        balance,
        status: balance === 0 ? "completed" : advance.status,
      },
    };
  });
}

function salaryBondTransactionPayloadsForDeductions(
  deductions: SalaryBondPayrollDeduction[],
  payrollRunId: string,
  paidDate: string,
) {
  return deductions.map(({ amount, bond }) => ({
    user_id: bond.user_id,
    salary_bond_id: bond.id,
    employee_id: bond.employee_id,
    type: "deduction" as const,
    amount,
    transaction_date: paidDate,
    payroll_run_id: payrollRunId,
  }));
}

async function insertSalaryBondTransactionPayloads(payloads: Array<Record<string, unknown>>) {
  if (!supabase || payloads.length === 0) return null;
  const result = await supabase.from("employee_salary_bond_transactions").insert(payloads);
  return result.error ?? null;
}

async function applySalaryBondPayrollDeductions(
  deductions: SalaryBondPayrollDeduction[],
  payrollRunId: string,
  paidDate: string,
) {
  return insertSalaryBondTransactionPayloads(salaryBondTransactionPayloadsForDeductions(deductions, payrollRunId, paidDate));
}

// Item-linked variant: records which payroll_run_item a deduction belongs to and skips
// any bond that already has a non-void deduction transaction for that item, so retrying
// after a partial failure (item patched but ledger write failed, or vice versa) can't
// double-deduct the employee's bond balance.
function salaryBondTransactionPayloadsForItemDeductions(
  entries: Array<{ itemId: string; deductions: SalaryBondPayrollDeduction[] }>,
  payrollRunId: string,
  paidDate: string,
) {
  return entries.flatMap(({ itemId, deductions }) =>
    deductions
      .filter(({ bond }) => !salaryBondHasDeductionForItem(bond, itemId))
      .map(({ amount, bond }) => ({
        user_id: bond.user_id,
        salary_bond_id: bond.id,
        employee_id: bond.employee_id,
        type: "deduction" as const,
        amount,
        transaction_date: paidDate,
        payroll_run_id: payrollRunId,
        payroll_run_item_id: itemId,
      })),
  );
}

// Applies both deduction ledgers in parallel (they touch independent tables with no
// data dependency), and is called BEFORE the corresponding payroll_run_items write at
// every call site, so an item is only ever created/patched to show a deduction once the
// ledger write it depends on has actually succeeded.
async function applyPayrollDeductionLedger(
  advanceDeductions: EmployeeAdvancePayrollDeduction[],
  bondTransactionPayloads: Array<Record<string, unknown>>,
) {
  const [advanceError, bondError] = await Promise.all([
    applyEmployeeAdvancePayrollDeductions(advanceDeductions),
    insertSalaryBondTransactionPayloads(bondTransactionPayloads),
  ]);
  return advanceError ?? bondError ?? null;
}

function payrollItemAdvanceDeductionPatch(
  item: PayrollRunItem,
  employee: Employee | undefined,
  employeeAdvances: EmployeeAdvance[],
  salaryBonds: SalaryBond[],
  payrollSettings: PayrollSettings | null,
  payPeriod: PayrollPayPeriod,
  payrollDate: string,
) {
  if (!employee) return null;
  const notes = item.notes ?? "";
  const hasGovernmentDeduction = notes.includes(GOVERNMENT_DEDUCTION_NOTE_PREFIX);
  const hasAdvanceDeduction = notes.includes(EMPLOYEE_ADVANCE_NOTE_PREFIX);
  const hasBondDeduction = notes.includes(SALARY_BOND_NOTE_PREFIX);
  const governmentDeduction = hasGovernmentDeduction ? 0 : governmentDeductionForEmployee(employee, payrollSettings, payPeriod);
  const advanceDeductions = employeeAdvanceDeductionsForEmployee(employeeAdvances, employee, payrollDate);
  const employeeAdvanceDeduction = hasAdvanceDeduction
    ? 0
    : advanceDeductions.reduce((sum, deduction) => sum + deduction.amount, 0);
  const bondDeductions = salaryBondDeductionsForEmployee(salaryBonds, employee, payrollDate);
  const salaryBondDeduction = hasBondDeduction
    ? 0
    : bondDeductions.reduce((sum, deduction) => sum + deduction.amount, 0);
  if (governmentDeduction === 0 && employeeAdvanceDeduction === 0 && salaryBondDeduction === 0) return null;

  const deductions = toNumber(item.deductions) + governmentDeduction + employeeAdvanceDeduction + salaryBondDeduction;
  const deductionNotes = [
    governmentDeduction > 0 ? `${GOVERNMENT_DEDUCTION_NOTE_PREFIX} ${currency.format(governmentDeduction)}` : "",
    employeeAdvanceDeduction > 0 ? `${EMPLOYEE_ADVANCE_NOTE_PREFIX} ${currency.format(employeeAdvanceDeduction)}` : "",
    salaryBondDeduction > 0 ? `${SALARY_BOND_NOTE_PREFIX} ${currency.format(salaryBondDeduction)}` : "",
  ].filter(Boolean);

  return {
    advanceDeductions: hasAdvanceDeduction ? [] : advanceDeductions,
    bondDeductions: hasBondDeduction ? [] : bondDeductions,
    payload: {
      deductions,
      net_pay: netPay(toNumber(item.gross_pay), toNumber(item.allowances), deductions),
      notes: [item.notes, ...deductionNotes].filter(Boolean).join(" | "),
    },
  };
}

export function PayrollFeature({
  attendanceEntries,
  dailyTicketEntries,
  employees,
  ensurePayrollRunItems,
  expenseCategories,
  onLocalPayrollRunsChange,
  onChange,
  onQueueOfflineMutation,
  payrollRuns,
  payrollSettings,
  positions,
  employeeAdvances,
  salaryBonds,
  tabs,
  userId,
}: {
  attendanceEntries: AttendanceEntry[];
  dailyTicketEntries: DailyTicketEntry[];
  employees: Employee[];
  ensurePayrollRunItems: (payrollRunId: string) => Promise<void>;
  expenseCategories: ExpenseCategory[];
  onLocalPayrollRunsChange: (payrollRuns: PayrollRunWithItems[]) => void;
  onChange: () => Promise<void>;
  onQueueOfflineMutation: QueueOfflineMutation;
  payrollRuns: PayrollRunWithItems[];
  payrollSettings: PayrollSettings | null;
  positions: Position[];
  employeeAdvances: EmployeeAdvance[];
  salaryBonds: SalaryBond[];
  tabs?: ReactNode;
  userId: string;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [activePayrollSettings, setActivePayrollSettings] = useState<PayrollSettings | null>(payrollSettings);
  const [payAllProgress, setPayAllProgress] = useState<{ completed: number; total: number } | null>(null);
  const [generateProgress, setGenerateProgress] = useState<ActionProgressState | null>(null);
  const [selectedRunId, setSelectedRunId] = useState(payrollRuns[0]?.id ?? "");
  const selectedRun = selectedRunId
    ? payrollRuns.find((run) => run.id === selectedRunId)
    : payrollRuns[0];
  const activeEmployees = employees.filter((employee) => employee.status === "active");
  const existingEmployeeIds = new Set(
    (selectedRun?.items ?? [])
      .map((item) => item.employee_id)
      .filter((id): id is string => Boolean(id)),
  );
  const missingEmployees = selectedRun
    ? activeEmployees.filter((employee) => !existingEmployeeIds.has(employee.id))
    : [];

  useEffect(() => {
    setActivePayrollSettings(payrollSettings);
  }, [payrollSettings]);

  useEffect(() => {
    if (!supabase || activePayrollSettings) return;
    void ensurePayrollSettings(supabase, userId).then(({ data }) => {
      if (data) setActivePayrollSettings(data);
    });
  }, [activePayrollSettings, userId]);

  const [payrollExpenseCategoryId, setPayrollExpenseCategoryId] = useState<string | null>(
    expenseCategories.find((category) => category.type === "company" && category.name === "Payroll")?.id ?? null,
  );

  useEffect(() => {
    const found = expenseCategories.find((category) => category.type === "company" && category.name === "Payroll");
    if (found) setPayrollExpenseCategoryId(found.id);
  }, [expenseCategories]);

  useEffect(() => {
    if (!supabase || payrollExpenseCategoryId) return;
    function tryEnsureCategory() {
      if (!supabase || payrollExpenseCategoryId || !navigator.onLine) return;
      void ensurePayrollExpenseCategory(supabase, userId).then(({ data }) => {
        if (data) setPayrollExpenseCategoryId(data.id);
      });
    }
    tryEnsureCategory();
    window.addEventListener("online", tryEnsureCategory);
    return () => window.removeEventListener("online", tryEnsureCategory);
  }, [payrollExpenseCategoryId, userId]);

  useEffect(() => {
    if (!selectedRunId && payrollRuns[0]) {
      setSelectedRunId(payrollRuns[0].id);
    }
  }, [payrollRuns, selectedRunId]);

  useEffect(() => {
    if (selectedRun?.id && selectedRun.items.length === 0) {
      void ensurePayrollRunItems(selectedRun.id);
    }
  }, [selectedRun?.id, selectedRun?.items.length]);

  function createOfflinePayrollItems(payloads: Array<Omit<PayrollRunItem, "id" | "created_at" | "updated_at">>) {
    const now = new Date().toISOString();
    const detailPayloads: Array<Record<string, unknown>> = [];
    const items = payloads.map((payload) => {
      const id = crypto.randomUUID();
      const ticketDetails = payload.ticket_details.map((detail) => {
        const savedDetail = {
          ...detail,
          id: crypto.randomUUID(),
          payroll_run_item_id: id,
          created_at: now,
        };
        detailPayloads.push(savedDetail);
        return savedDetail;
      });
      return { ...payload, id, ticket_details: ticketDetails, created_at: now, updated_at: now } as PayrollRunItem;
    });
    const itemPayloads = items.map(({ ticket_details: _ticketDetails, created_at: _createdAt, updated_at: _updatedAt, ...item }) => item);
    return { detailPayloads, itemPayloads, items };
  }

  async function resolvePayrollSettings() {
    if (activePayrollSettings) return activePayrollSettings;
    if (!supabase) return null;

    const result = await ensurePayrollSettings(supabase, userId);
    if (result.error) {
      NotificationService.showError(friendlyError(result.error));
      return null;
    }

    setActivePayrollSettings(result.data);
    return result.data;
  }

  async function insertPayrollItems(
    payloads: Array<Omit<PayrollRunItem, "id" | "created_at" | "updated_at">>,
    onProgress?: (completed: number, total: number) => void,
  ) {
    if (!supabase) return { error: null };
    for (let index = 0; index < payloads.length; index += 1) {
      const payload = payloads[index];
      const { ticket_details: ticketDetails, ...itemPayload } = payload;
      const itemResult = await supabase.from("payroll_run_items").insert(itemPayload).select("id").single();
      if (itemResult.error) return { error: itemResult.error };
      if (ticketDetails.length > 0) {
        const detailResult = await supabase.from("payroll_run_item_ticket_details").insert(
          ticketDetails.map(({ id: _id, created_at: _createdAt, ...detail }) => ({
            ...detail,
            id: crypto.randomUUID(),
            payroll_run_item_id: itemResult.data.id,
          })),
        );
        if (detailResult.error) return { error: detailResult.error };
      }
      onProgress?.(index + 1, payloads.length);
    }
    return { error: null };
  }

  async function syncPayrollExpense(
    run: Pick<PayrollRun, "id" | "period_month" | "period_year" | "pay_period" | "generated_date">,
    items: Array<Pick<PayrollRunItem, "net_pay" | "status" | "paid_date">>,
  ) {
    if (!payrollExpenseCategoryId) return;
    const payload = payrollExpensePayload(run, items, payrollExpenseCategoryId, userId);

    if (!navigator.onLine) {
      await onQueueOfflineMutation({
        resource: "expenses",
        affectedResources: ["expenses", "dashboardSummary"],
        operation: "upsert",
        table: "expenses",
        recordId: payload.id,
        payload,
      });
      return;
    }

    if (!supabase) return;
    const result = await saveExpense(supabase, payload);
    if (result.error && isOfflineLikeError(result.error)) {
      await onQueueOfflineMutation({
        resource: "expenses",
        affectedResources: ["expenses", "dashboardSummary"],
        operation: "upsert",
        table: "expenses",
        recordId: payload.id,
        payload,
      });
      return;
    }
    if (result.error) {
      NotificationService.showError("Payroll saved, but couldn't sync it to Company Expenses.");
    }
  }

  async function createRun(
    values: PayrollRunFormValues,
    onProgress?: (progress: ActionProgressState | null) => void,
  ) {
    if (!supabase) return;
    const reportProgress = (progress: ActionProgressState | null) => {
      setGenerateProgress(progress);
      onProgress?.(progress);
    };
    const resolvedPayrollSettings = await resolvePayrollSettings();
    if (!resolvedPayrollSettings) {
      return;
    }
    const activeTeamEmployees = employees.filter((employee) => employee.status === "active");
    if (activeTeamEmployees.length === 0) {
      NotificationService.showError("Add at least one active employee first.");
      return;
    }
    const invalidEmployees = activeTeamEmployees.filter((employee) => {
      const position = positions.find((item) => item.id === employee.position_id);
      return !position || position.status !== "active";
    });
    if (invalidEmployees.length > 0) {
      NotificationService.showError(`Assign an active position to: ${invalidEmployees.map((employee) => employee.full_name).join(", ")}.`);
      return;
    }

    const periodMonth = Number(values.period_month);
    const periodYear = Number(values.period_year);
    const payPeriod = values.pay_period;

    const missingAttendanceEmployees = activeTeamEmployees.filter((emp) => {
      const pos = positions.find((p) => p.id === emp.position_id);
      if (pos?.pay_mode !== "daily") return false;
      const totals = attendanceTotalsForEmployee(attendanceEntries, emp.id, periodMonth, periodYear, payPeriod);
      return totals.presentDays + totals.halfDays + totals.absentDays === 0;
    });

    if (missingAttendanceEmployees.length > 0) {
      NotificationService.showError(`Attendance not recorded for: ${missingAttendanceEmployees.map((e) => e.full_name).join(", ")}. Please log attendance before generating payroll.`);
      return;
    }

    const confirmed = await NotificationService.showConfirm({
      title: "Generate payroll",
      message: `Generate payroll for ${monthNames[periodMonth - 1]} ${periodYear} (${payPeriod === "first_half" ? "1st - 15th" : "16th - End"})? This creates payroll items for ${activeTeamEmployees.length} active employee${activeTeamEmployees.length === 1 ? "" : "s"}.`,
    });
    if (!confirmed) return;
    reportProgress({
      title: "Generating payroll",
      description: "Preparing payroll run and employee items.",
      completed: 1,
      total: 4,
    });

    const runPayload = {
      user_id: userId,
      period_month: Number(values.period_month),
      period_year: Number(values.period_year),
      pay_period: values.pay_period,
      generated_date: values.generated_date,
      notes: values.notes.trim(),
    };
    const existingRun = payrollRuns.find(
      (run) =>
        run.period_month === runPayload.period_month &&
        run.period_year === runPayload.period_year &&
        run.pay_period === runPayload.pay_period,
    );
    if (existingRun) {
      setSelectedRunId(existingRun.id);
      setFormOpen(false);
      NotificationService.showSuccess("Payroll for this pay period already exists and is now selected.");
      return;
    }

    if (!navigator.onLine) {
      const offlineRunId = crypto.randomUUID();
      const offlineRun = {
        ...runPayload,
        id: offlineRunId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as PayrollRun;
      const periodDailyEntries = dailyTicketEntriesForPayrollPeriod(
        dailyTicketEntries,
        offlineRun.period_month,
        offlineRun.period_year,
        offlineRun.pay_period,
      );
      const employeePayrollItems = activeTeamEmployees.map((employee) =>
        payrollItemPayloadForEmployeeWithEmployeeAdvances(
          employee,
          positions.find((position) => position.id === employee.position_id),
          offlineRun.id,
          userId,
          periodDailyEntries,
          employeeAdvances,
          salaryBonds,
          resolvedPayrollSettings,
          offlineRun.generated_date,
          attendanceEntries,
          offlineRun.period_month,
          offlineRun.period_year,
          offlineRun.pay_period,
        ),
      );
      const { detailPayloads, itemPayloads, items: offlineItems } = createOfflinePayrollItems(employeePayrollItems.map((item) => item.payload));
      const employeeAdvanceUpdates = employeeAdvanceUpdatesForDeductions(
        employeePayrollItems.flatMap((item) => item.advanceDeductions),
      );
      const salaryBondTransactionPayloads = salaryBondTransactionPayloadsForDeductions(
        employeePayrollItems.flatMap((item) => item.bondDeductions),
        offlineRun.id,
        offlineRun.generated_date,
      );

      reportProgress({
        title: "Generating payroll",
        description: "Queueing payroll for sync.",
        completed: 2,
        total: 4,
      });
      await onQueueOfflineMutation({
        resource: "payrollRuns",
        affectedResources: ["payrollRuns", "payrollHistory", "employeeAdvances", "salaryBonds", "dashboardSummary"],
        operation: "payroll_group",
        table: "payroll_runs",
        payload: {
          runPayload: offlineRun,
          itemPayloads,
          detailPayloads,
          employeeAdvanceUpdates,
          salaryBondTransactionPayloads,
        },
      });
      reportProgress({
        title: "Generating payroll",
        description: "Syncing payroll expense record.",
        completed: 3,
        total: 4,
      });
      await syncPayrollExpense(offlineRun, itemPayloads);
      onLocalPayrollRunsChange([
        { ...offlineRun, items: offlineItems },
        ...payrollRuns,
      ]);
      setFormOpen(false);
      setSelectedRunId(offlineRunId);
      reportProgress(null);
      return;
    }

    const runResult = await supabase.from("payroll_runs").insert(runPayload).select().single();
    if (runResult.error) {
      if (isOfflineLikeError(runResult.error)) {
        const offlineRunId = crypto.randomUUID();
        const offlineRun = {
          ...runPayload,
          id: offlineRunId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as PayrollRun;
        const periodDailyEntries = dailyTicketEntriesForPayrollPeriod(
          dailyTicketEntries,
          offlineRun.period_month,
          offlineRun.period_year,
          offlineRun.pay_period,
        );
        const employeePayrollItems = activeTeamEmployees.map((employee) =>
          payrollItemPayloadForEmployeeWithEmployeeAdvances(
            employee,
            positions.find((position) => position.id === employee.position_id),
            offlineRun.id,
            userId,
            periodDailyEntries,
            employeeAdvances,
            salaryBonds,
            resolvedPayrollSettings,
            offlineRun.generated_date,
            attendanceEntries,
            offlineRun.period_month,
            offlineRun.period_year,
            offlineRun.pay_period,
          ),
        );
        const { detailPayloads, itemPayloads, items: offlineItems } = createOfflinePayrollItems(employeePayrollItems.map((item) => item.payload));
        const employeeAdvanceUpdates = employeeAdvanceUpdatesForDeductions(
          employeePayrollItems.flatMap((item) => item.advanceDeductions),
        );
        const salaryBondTransactionPayloads = salaryBondTransactionPayloadsForDeductions(
          employeePayrollItems.flatMap((item) => item.bondDeductions),
          offlineRun.id,
          offlineRun.generated_date,
        );

        reportProgress({
          title: "Generating payroll",
          description: "Queueing payroll for sync.",
          completed: 2,
          total: 4,
        });
        await onQueueOfflineMutation({
          resource: "payrollRuns",
          affectedResources: ["payrollRuns", "payrollHistory", "employeeAdvances", "salaryBonds", "dashboardSummary"],
          operation: "payroll_group",
          table: "payroll_runs",
          payload: {
            runPayload: offlineRun,
            itemPayloads,
            detailPayloads,
            employeeAdvanceUpdates,
            salaryBondTransactionPayloads,
          },
        });
        reportProgress({
          title: "Generating payroll",
          description: "Syncing payroll expense record.",
          completed: 3,
          total: 4,
        });
        await syncPayrollExpense(offlineRun, itemPayloads);
        onLocalPayrollRunsChange([
          { ...offlineRun, items: offlineItems },
          ...payrollRuns,
        ]);
        setFormOpen(false);
        setSelectedRunId(offlineRunId);
        reportProgress(null);
        return;
      }
      const errMsg = `${runResult.error.message ?? ""} ${runResult.error.details ?? ""}`.toLowerCase();
      if (errMsg.includes("duplicate key") || errMsg.includes("payroll_runs_user_id_period")) {
        await onChange();
        const existing = await supabase
          .from("payroll_runs")
          .select("id")
          .eq("period_month", runPayload.period_month)
          .eq("period_year", runPayload.period_year)
          .eq("pay_period", runPayload.pay_period)
          .single();
        if (existing.data) {
          setSelectedRunId(existing.data.id);
          setFormOpen(false);
          NotificationService.showSuccess("Payroll for this pay period already exists and has been selected.");
        } else {
          NotificationService.showError(friendlyError(runResult.error));
        }
        return;
      }
      NotificationService.showError(friendlyError(runResult.error));
      return;
    }

    const newRun = runResult.data as PayrollRun;
    const periodDailyEntries = dailyTicketEntriesForPayrollPeriod(
      dailyTicketEntries,
      newRun.period_month,
      newRun.period_year,
      newRun.pay_period,
    );
    const employeePayrollItems = activeTeamEmployees.map((employee) =>
      payrollItemPayloadForEmployeeWithEmployeeAdvances(
        employee,
        positions.find((position) => position.id === employee.position_id),
        newRun.id,
        userId,
        periodDailyEntries,
        employeeAdvances,
        salaryBonds,
        resolvedPayrollSettings,
        newRun.generated_date,
        attendanceEntries,
        newRun.period_month,
        newRun.period_year,
        newRun.pay_period,
      ),
    );
    const itemPayloads = employeePayrollItems.map((item) => item.payload);
    const advanceDeductions = employeePayrollItems.flatMap((item) => item.advanceDeductions);
    const bondDeductions = employeePayrollItems.flatMap((item) => item.bondDeductions);
    reportProgress({
      title: "Generating payroll",
      description: "Applying deductions.",
      completed: 2,
      total: 4,
    });
    // Apply the deduction ledger writes before creating any payroll item, so an item is
    // never inserted showing a deduction that never actually happened against the
    // employee's advance balance / salary bond.
    const ledgerError = await applyPayrollDeductionLedger(
      advanceDeductions,
      salaryBondTransactionPayloadsForDeductions(bondDeductions, newRun.id, newRun.generated_date),
    );
    if (ledgerError) {
      NotificationService.showError(friendlyError(ledgerError));
      return;
    }

    reportProgress({
      title: "Generating payroll",
      description: "Saving payroll items.",
      completed: 3,
      total: 4,
    });
    const itemResult = await insertPayrollItems(itemPayloads);
    if (itemResult.error) {
      NotificationService.showError(friendlyError(itemResult.error));
      return;
    }

    NotificationService.showSuccess("Payroll run generated.");
    setFormOpen(false);
    setSelectedRunId(newRun.id);
    reportProgress({
      title: "Generating payroll",
      description: "Refreshing payroll data.",
      completed: 4,
      total: 4,
    });
    await syncPayrollExpense(newRun, itemPayloads);
    await onChange();
    reportProgress(null);
  }

  async function updateItem(item: PayrollRunItem, patch: Partial<PayrollRunItem>) {
    if (!supabase) return;
    const installationTickets = normalizeTicketCount(patch.installation_tickets ?? item.installation_tickets);
    const repairTickets = normalizeTicketCount(patch.repair_tickets ?? item.repair_tickets);
    const installationRate = toNumber(patch.installation_rate ?? item.installation_rate);
    const repairRate = toNumber(patch.repair_rate ?? item.repair_rate);
    const allowances = toNumber(patch.allowances ?? item.allowances);
    const deductions = toNumber(patch.deductions ?? item.deductions);
    const ticketFieldsChanged = patch.installation_tickets !== undefined || patch.repair_tickets !== undefined ||
      patch.installation_rate !== undefined || patch.repair_rate !== undefined;
    const ticketPay = ticketFieldsChanged
      ? ticketGrossPay(installationTickets, repairTickets, installationRate, repairRate)
      : toNumber(item.ticket_pay);
    const basePay = toNumber(item.base_pay);
    const gross = basePay + ticketPay;
    const payload = {
      ...patch,
      installation_tickets: installationTickets,
      repair_tickets: repairTickets,
      installation_rate: installationRate,
      repair_rate: repairRate,
      base_pay: basePay,
      ticket_pay: ticketPay,
      gross_pay: gross,
      net_pay: netPay(gross, allowances, deductions),
    };
    const runForSync = payrollRuns.find((run) => run.id === item.payroll_run_id);
    const itemsForSync = runForSync
      ? runForSync.items.map((runItem) => runItem.id === item.id ? { ...runItem, ...payload } : runItem)
      : [];
    if (!navigator.onLine) {
      onLocalPayrollRunsChange(payrollRuns.map((run) => ({
        ...run,
        items: run.items.map((runItem) => runItem.id === item.id ? { ...runItem, ...payload } : runItem),
      })));
      await onQueueOfflineMutation({
        resource: "payrollRuns",
        affectedResources: ["payrollRuns", "payrollHistory", "dashboardSummary"],
        operation: "update",
        table: "payroll_run_items",
        recordId: item.id,
        payload,
      });
      if (runForSync) await syncPayrollExpense(runForSync, itemsForSync);
      return;
    }
    const { error } = await supabase.from("payroll_run_items").update(payload).eq("id", item.id);
    if (error && isOfflineLikeError(error)) {
      onLocalPayrollRunsChange(payrollRuns.map((run) => ({
        ...run,
        items: run.items.map((runItem) => runItem.id === item.id ? { ...runItem, ...payload } : runItem),
      })));
      await onQueueOfflineMutation({
        resource: "payrollRuns",
        affectedResources: ["payrollRuns", "payrollHistory", "dashboardSummary"],
        operation: "update",
        table: "payroll_run_items",
        recordId: item.id,
        payload,
      });
      if (runForSync) await syncPayrollExpense(runForSync, itemsForSync);
      return;
    }
    if (error) {
      NotificationService.showError(friendlyError(error));
    } else {
      NotificationService.showSuccess("Payroll item updated.");
    }
    if (runForSync) await syncPayrollExpense(runForSync, itemsForSync);
    await onChange();
  }

  async function addMissingEmployees() {
    if (!supabase || !selectedRun || missingEmployees.length === 0) return;
    const confirmed = await NotificationService.showConfirm({
      title: "Add missing employees",
      message: `Add ${missingEmployees.length} missing employee${missingEmployees.length === 1 ? "" : "s"} to this payroll run?`,
    });
    if (!confirmed) return;
    const resolvedPayrollSettings = await resolvePayrollSettings();
    if (!resolvedPayrollSettings) {
      return;
    }

    const periodDailyEntries = dailyTicketEntriesForPayrollPeriod(
      dailyTicketEntries,
      selectedRun.period_month,
      selectedRun.period_year,
      selectedRun.pay_period,
    );
    const employeePayrollItems = missingEmployees.map((employee) =>
      payrollItemPayloadForEmployeeWithEmployeeAdvances(
        employee,
        positions.find((position) => position.id === employee.position_id),
        selectedRun.id,
        userId,
        periodDailyEntries,
        employeeAdvances,
        salaryBonds,
        resolvedPayrollSettings,
        selectedRun.generated_date,
        attendanceEntries,
        selectedRun.period_month,
        selectedRun.period_year,
        selectedRun.pay_period,
      ),
    );
    const itemPayloads = employeePayrollItems.map((item) => item.payload);
    const employeeAdvanceUpdates = employeeAdvanceUpdatesForDeductions(
      employeePayrollItems.flatMap((item) => item.advanceDeductions),
    );
    const salaryBondTransactionPayloads = salaryBondTransactionPayloadsForDeductions(
      employeePayrollItems.flatMap((item) => item.bondDeductions),
      selectedRun.id,
      selectedRun.generated_date,
    );
    if (!navigator.onLine) {
      const { detailPayloads, itemPayloads: offlineItemPayloads, items: offlineItems } = createOfflinePayrollItems(itemPayloads);
      onLocalPayrollRunsChange(payrollRuns.map((run) =>
        run.id === selectedRun.id ? { ...run, items: [...run.items, ...offlineItems] } : run,
      ));
      await onQueueOfflineMutation({
        resource: "payrollRuns",
        affectedResources: ["payrollRuns", "payrollHistory", "employeeAdvances", "salaryBonds", "dashboardSummary"],
        operation: "payroll_items_group",
        table: "payroll_run_items",
        payload: { itemPayloads: offlineItemPayloads, detailPayloads, employeeAdvanceUpdates, salaryBondTransactionPayloads },
      });
      await syncPayrollExpense(selectedRun, [...selectedRun.items, ...itemPayloads]);
      return;
    }
    // Apply the deduction ledger writes before creating any payroll item, so an item is
    // never inserted showing a deduction that never actually happened against the
    // employee's advance balance / salary bond.
    const ledgerError = await applyPayrollDeductionLedger(
      employeePayrollItems.flatMap((item) => item.advanceDeductions),
      salaryBondTransactionPayloads,
    );
    if (ledgerError) {
      NotificationService.showError(friendlyError(ledgerError));
      return;
    }

    const { error } = await insertPayrollItems(itemPayloads);
    if (error) {
      if (isOfflineLikeError(error)) {
        // The deduction ledger was already applied above (online), so the queued
        // composite mutation must only create the items on sync, not reapply the
        // advance/bond ledger writes a second time.
        const { detailPayloads, itemPayloads: offlineItemPayloads, items: offlineItems } = createOfflinePayrollItems(itemPayloads);
        onLocalPayrollRunsChange(payrollRuns.map((run) =>
          run.id === selectedRun.id ? { ...run, items: [...run.items, ...offlineItems] } : run,
        ));
        await onQueueOfflineMutation({
          resource: "payrollRuns",
          affectedResources: ["payrollRuns", "payrollHistory", "employeeAdvances", "salaryBonds", "dashboardSummary"],
          operation: "payroll_items_group",
          table: "payroll_run_items",
          payload: { itemPayloads: offlineItemPayloads, detailPayloads, employeeAdvanceUpdates: [], salaryBondTransactionPayloads: [] },
        });
        await syncPayrollExpense(selectedRun, [...selectedRun.items, ...itemPayloads]);
        return;
      }
      NotificationService.showError(friendlyError(error));
      return;
    }

    NotificationService.showSuccess(`${missingEmployees.length} employee${missingEmployees.length === 1 ? "" : "s"} added to payroll.`);
    await syncPayrollExpense(selectedRun, [...selectedRun.items, ...itemPayloads]);
    await onChange();
  }

  const employeesById = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);
  // Memoized: markAllPaid's per-item progress updates trigger a re-render on every paid
  // item, and this scan re-derives a deduction check (which itself scans employeeAdvances
  // and salaryBonds) per pending item — without memoizing on the underlying data, that
  // becomes O(items^2) work during "Pay all" on a large payroll run.
  const itemsNeedingPayrollDeductions = useMemo(() => (
    selectedRun
      ? selectedRun.items
        .filter((item) => item.status !== "paid")
        .map((item) => ({
          item,
          patch: payrollItemAdvanceDeductionPatch(
            item,
            item.employee_id ? employeesById.get(item.employee_id) : undefined,
            employeeAdvances,
            salaryBonds,
            activePayrollSettings,
            selectedRun.pay_period,
            todayKey(),
          ),
        }))
        .filter((entry): entry is { item: PayrollRunItem; patch: NonNullable<ReturnType<typeof payrollItemAdvanceDeductionPatch>> } => Boolean(entry.patch))
      : []
  ), [selectedRun, employeesById, employeeAdvances, salaryBonds, activePayrollSettings]);
  const deductionPatchByItemId = new Map(itemsNeedingPayrollDeductions.map((entry) => [entry.item.id, entry.patch.payload]));
  const allItems = (selectedRun?.items ?? []).map((item) => {
    const patch = deductionPatchByItemId.get(item.id);
    return patch ? { ...item, ...patch } : item;
  });
  const pendingItems = allItems.filter((item) => item.status !== "paid");
  const paidItems = allItems.filter((item) => item.status === "paid");
  const allTotals = allItems.reduce(
    (sum, item) => ({ gross: sum.gross + toNumber(item.gross_pay), net: sum.net + toNumber(item.net_pay) }),
    { gross: 0, net: 0 },
  );
  const pendingTotals = pendingItems.reduce(
    (sum, item) => ({ net: sum.net + toNumber(item.net_pay) }),
    { net: 0 },
  );
  const paidTotals = paidItems.reduce(
    (sum, item) => ({ net: sum.net + toNumber(item.net_pay) }),
    { net: 0 },
  );

  async function applyMissingPayrollDeductions() {
    if (!supabase || !selectedRun || itemsNeedingPayrollDeductions.length === 0) return;
    if (!navigator.onLine) {
      NotificationService.showError("Connect to the internet to apply payroll deductions to this payroll run.");
      return;
    }
    const confirmed = await NotificationService.showConfirm({
      title: "Apply deductions",
      message: `Apply advance deductions to ${itemsNeedingPayrollDeductions.length} payroll item${itemsNeedingPayrollDeductions.length === 1 ? "" : "s"}?`,
    });
    if (!confirmed) return;

    // Apply the deduction ledger first, item-linked and idempotent (skips any bond that
    // already has a deduction transaction recorded for a given item), before patching
    // payroll_run_items. This way a retry after a partial failure — in either order —
    // can't double-deduct a bond balance or leave an item's notes claiming a deduction
    // that was never actually applied to the ledger.
    const ledgerError = await applyPayrollDeductionLedger(
      itemsNeedingPayrollDeductions.flatMap((entry) => entry.patch.advanceDeductions),
      salaryBondTransactionPayloadsForItemDeductions(
        itemsNeedingPayrollDeductions.map(({ item, patch }) => ({ itemId: item.id, deductions: patch.bondDeductions })),
        selectedRun.id,
        todayKey(),
      ),
    );
    if (ledgerError) {
      NotificationService.showError(friendlyError(ledgerError));
      return;
    }

    for (const { item, patch } of itemsNeedingPayrollDeductions) {
      const { error } = await supabase.from("payroll_run_items").update(patch.payload).eq("id", item.id);
      if (error) {
        NotificationService.showError(friendlyError(error));
        return;
      }
    }

    NotificationService.showSuccess(`Applied payroll deductions to ${itemsNeedingPayrollDeductions.length} payroll item${itemsNeedingPayrollDeductions.length === 1 ? "" : "s"}.`);
    await syncPayrollExpense(selectedRun, allItems);
    await onChange();
  }

  async function markAllPaid() {
    if (!supabase || !selectedRun || pendingItems.length === 0) return;
    if (!navigator.onLine) {
      NotificationService.showError("Connect to the internet to mark all payroll items as paid.");
      return;
    }
    const confirmed = await NotificationService.showConfirm({
      title: "Pay all",
      message: `Mark all ${pendingItems.length} pending payroll item${pendingItems.length === 1 ? "" : "s"} as paid?`,
    });
    if (!confirmed) return;

    const paidDate = todayKey();
    setPayAllProgress({ completed: 0, total: pendingItems.length });
    try {
      // Apply the deduction ledger first, item-linked and idempotent, before marking any
      // item paid — so an item is never marked paid with a deduction note that was never
      // actually applied to the advance balance / salary bond ledger.
      if (itemsNeedingPayrollDeductions.length > 0) {
        const ledgerError = await applyPayrollDeductionLedger(
          itemsNeedingPayrollDeductions.flatMap((entry) => entry.patch.advanceDeductions),
          salaryBondTransactionPayloadsForItemDeductions(
            itemsNeedingPayrollDeductions.map(({ item, patch }) => ({ itemId: item.id, deductions: patch.bondDeductions })),
            selectedRun.id,
            paidDate,
          ),
        );
        if (ledgerError) {
          NotificationService.showError(friendlyError(ledgerError));
          return;
        }
      }

      for (let index = 0; index < pendingItems.length; index += 1) {
        const item = pendingItems[index];
        const deductionPatch = deductionPatchByItemId.get(item.id);
        const { error } = await supabase.from("payroll_run_items").update({
          ...(deductionPatch ?? {}),
          status: "paid",
          paid_date: paidDate,
        }).eq("id", item.id);
        if (error) {
          NotificationService.showError(friendlyError(error));
          return;
        }
        setPayAllProgress({ completed: index + 1, total: pendingItems.length });
      }

      NotificationService.showSuccess(`Marked ${pendingItems.length} payroll item${pendingItems.length === 1 ? "" : "s"} as paid.`);
      const paidItemsForSync = allItems.map((item) => item.status !== "paid" ? { ...item, status: "paid" as const, paid_date: paidDate } : item);
      await syncPayrollExpense(selectedRun, paidItemsForSync);
      await onChange();
    } finally {
      setPayAllProgress(null);
    }
  }

  return (
    <div className="page-stack action-progress-shell">
      {payAllProgress && (
        <ActionProgress
          description="Updating payroll items and finishing employee payouts."
          progress={payAllProgress.total === 0 ? 0 : (payAllProgress.completed / payAllProgress.total) * 100}
          progressLabel={`${payAllProgress.completed} of ${payAllProgress.total} employee${payAllProgress.total === 1 ? "" : "s"} paid`}
          title="Paying payroll"
        />
      )}
      <PageHeader
        action={(
          <button className="primary-button compact" onClick={() => setFormOpen(true)} type="button">
            <Plus size={16} />
            Generate payroll
          </button>
        )}
        eyebrow="Pay-period runs"
        text="Generate first-half or second-half payroll for all active employees."
        title="Payroll"
      />

      {selectedRun && (
        <section className="payroll-metrics">
          <div className="payroll-metric">
            <div className="payroll-metric-icon neutral"><Users size={21} /></div>
            <div className="payroll-metric-text">
              <span>Employees</span>
              <strong>{allItems.length}</strong>
              <span className="payroll-metric-helper">In this payroll run</span>
            </div>
          </div>
          <div className="payroll-metric">
            <div className="payroll-metric-icon neutral"><BadgeDollarSign size={21} /></div>
            <div className="payroll-metric-text">
              <span>Total Gross</span>
              <strong>{currency.format(allTotals.gross)}</strong>
              <span className="payroll-metric-helper">Before deductions</span>
            </div>
          </div>
          <div className="payroll-metric warning">
            <div className="payroll-metric-icon warning"><CalendarClock size={21} /></div>
            <div className="payroll-metric-text">
              <span>Unpaid</span>
              <strong>{currency.format(pendingTotals.net)}</strong>
              <span className="payroll-metric-helper">Pending payout</span>
            </div>
          </div>
          <div className="payroll-metric success">
            <div className="payroll-metric-icon success"><CheckCircle2 size={21} /></div>
            <div className="payroll-metric-text">
              <span>Paid</span>
              <strong>{currency.format(paidTotals.net)}</strong>
              <span className="payroll-metric-helper">Completed payments</span>
            </div>
          </div>
        </section>
      )}

      {tabs}

      {selectedRun && missingEmployees.length > 0 && (
        <div className="payroll-missing-banner">
          <span>Warning: {missingEmployees.length} active employee{missingEmployees.length !== 1 ? "s" : ""} not in this run</span>
          <button className="secondary-button compact" onClick={addMissingEmployees} type="button">
            <Plus size={14} /> Add missing
          </button>
        </div>
      )}

      {selectedRun && itemsNeedingPayrollDeductions.length > 0 && (
        <div className="payroll-missing-banner">
          <span>Warning: {itemsNeedingPayrollDeductions.length} payroll item{itemsNeedingPayrollDeductions.length !== 1 ? "s" : ""} missing payroll deductions</span>
          <button className="secondary-button compact" onClick={applyMissingPayrollDeductions} type="button">
            <BadgeDollarSign size={14} /> Apply deductions
          </button>
        </div>
      )}

      {selectedRun && pendingItems.length > 0 && (
        <div className="payroll-bulk-bar">
          <span className="payroll-bulk-count">{pendingItems.length} pending payroll item{pendingItems.length === 1 ? "" : "s"}</span>
          <button className="primary-button compact" disabled={Boolean(payAllProgress)} onClick={() => void markAllPaid()} type="button">
            <CheckCircle2 size={14} /> Pay all
          </button>
        </div>
      )}

      {selectedRun ? (
        <PayrollItemsTable employees={employees} items={allItems} onUpdate={updateItem} />
      ) : (
        <div className="panel">
          <p className="muted">No payroll has been generated yet.</p>
        </div>
      )}

      {formOpen && (
        <PayrollRunForm onClose={() => setFormOpen(false)} onSubmit={createRun} progress={generateProgress} />
      )}
    </div>
  );
}

function PayrollItemsTable({
  employees,
  items,
  onUpdate,
}: {
  employees: Employee[];
  items: PayrollRunItem[];
  onUpdate: (item: PayrollRunItem, patch: Partial<PayrollRunItem>) => Promise<void>;
}) {
  async function handleMarkPaid(item: PayrollRunItem) {
    const confirmed = await NotificationService.showConfirm({
      title: "Mark as paid",
      message: "Mark this payroll item as paid?",
    });
    if (!confirmed) return;
    await onUpdate(item, { status: "paid", paid_date: todayKey() });
  }

  async function handleMarkPending(item: PayrollRunItem) {
    const confirmed = await NotificationService.showConfirm({
      title: "Mark as pending",
      message: "Mark this payroll item as pending? This reverts it to unpaid.",
    });
    if (!confirmed) return;
    await onUpdate(item, { status: "pending", paid_date: null });
  }

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "paid">("pending");
  const [payrollPage, setPayrollPage] = useState(1);

  const visibleItems = items
    .filter((i) => statusFilter === "all" || i.status === statusFilter)
    .filter((i) => `${i.employee_name} ${i.position_name}`.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    setPayrollPage(1);
  }, [query, statusFilter]);

  const PAYROLL_ITEMS_PAGE_SIZE = 10;
  const payrollPageCount = Math.max(1, Math.ceil(visibleItems.length / PAYROLL_ITEMS_PAGE_SIZE));
  const safePayrollPage = Math.min(payrollPage, payrollPageCount);
  const payrollPageStart = (safePayrollPage - 1) * PAYROLL_ITEMS_PAGE_SIZE;
  const payrollPageEnd = Math.min(payrollPageStart + PAYROLL_ITEMS_PAGE_SIZE, visibleItems.length);
  const paginatedItems = visibleItems.slice(payrollPageStart, payrollPageEnd);

  const employeeCodeMap = useMemo(() => {
    const sorted = [...employees].sort((a, b) => a.created_at.localeCompare(b.created_at));
    return new Map(sorted.map((e, i) => [e.id, `EMP-${String(i + 1).padStart(3, "0")}`]));
  }, [employees]);
  const empCode = (id: string | null) => (id ? employeeCodeMap.get(id) ?? "-" : "-");

  function payBasis(item: PayrollRunItem): string {
    if (item.pay_mode === "daily") {
      return `${toNumber(item.days_worked)} days x ${currency.format(toNumber(item.daily_rate))}`;
    }
    if (item.pay_mode === "fixed") {
      return `Base ${currency.format(toNumber(item.base_pay))}`;
    }
    const ticketCount = item.ticket_details && item.ticket_details.length > 0
      ? item.ticket_details.reduce((sum, d) => sum + (d.ticket_count ?? 0), 0)
      : toNumber(item.installation_tickets) + toNumber(item.repair_tickets);
    if (item.pay_mode === "ticket") return `${ticketCount} tickets`;
    if (item.pay_mode === "hybrid") return `Base ${currency.format(toNumber(item.base_pay))} + ${ticketCount} tickets`;
    return "-";
  }

  return (
    <div className="page-stack" style={{ gap: 8 }}>
      <section className="panel employee-list-panel">
        <Toolbar query={query} setQuery={setQuery}>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
            <option value="all">All status</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
          </select>
        </Toolbar>

      <DataTable
        empty="No payroll items match the current filter."
        headers={["No.", "Employee ID", "Employee", "Pay Basis", "Gross", "Deductions", "Net", "Status", "Actions"]}
        rows={paginatedItems.map((item, index) => [
          payrollPageStart + index + 1,
          empCode(item.employee_id ?? null),
          <div key="employee" className="employee-list-identity">
            <EmpAvatar employees={employees} employeeId={item.employee_id ?? null} employeeName={item.employee_name} />
            <RecordTitle title={item.employee_name} notes={employees.find((e) => e.id === item.employee_id)?.email || "No email"} />
          </div>,
          <div key="basis" className="payroll-basis-cell">
            <span>{payBasis(item)}</span>
            {item.notes && <small>{item.notes}</small>}
          </div>,
          currency.format(toNumber(item.gross_pay)),
          toNumber(item.deductions) > 0 ? currency.format(toNumber(item.deductions)) : "-",
          <div key="net" className="payroll-net-cell">
            <strong>{currency.format(toNumber(item.net_pay))}</strong>
            {toNumber(item.allowances) > 0 && (
              <span className="payroll-net-allowance">+{currency.format(toNumber(item.allowances))} allowance</span>
            )}
          </div>,
          <span key="status" className={item.status === "paid" ? "emp-status-pill active" : "emp-status-pill inactive"}>
            {item.status === "paid" ? "Paid" : "Pending"}
          </span>,
          <div className="row-actions" key="actions">
            {item.status !== "paid" ? (
              <button aria-label="Mark paid" onClick={() => void handleMarkPaid(item)} title="Mark paid" type="button">
                <CheckCircle2 size={16} />
              </button>
            ) : (
              <button aria-label="Mark pending" onClick={() => void handleMarkPending(item)} title="Mark pending" type="button">
                <CalendarClock size={16} />
              </button>
            )}
          </div>,
        ])}
      />
      <div className="payroll-mobile-list">
        {paginatedItems.map((item, index) => (
          <div className="ticket-mobile-card payroll-mobile-card" key={item.id}>
            <div className="ticket-mobile-card-header">
              <span className="ticket-mobile-card-index">{payrollPageStart + index + 1}</span>
              <div className="employee-list-identity">
                <EmpAvatar employees={employees} employeeId={item.employee_id ?? null} employeeName={item.employee_name} />
                <div className="record-title">
                  <strong>{item.employee_name}</strong>
                  <span>{employees.find((e) => e.id === item.employee_id)?.email || "No email"}</span>
                  <span className="emp-mobile-card-badge">{empCode(item.employee_id ?? null)}</span>
                </div>
              </div>
              <strong className="ticket-mobile-card-gross">{currency.format(toNumber(item.net_pay))}</strong>
            </div>
            <div className="payroll-mobile-card-basis">
              <span>{payBasis(item)}</span>
              {item.notes && <small>{item.notes}</small>}
            </div>
            <div className="payroll-mobile-card-meta">
              <span>Gross: {currency.format(toNumber(item.gross_pay))}</span>
              {toNumber(item.deductions) > 0 && (
                <span className="payroll-mobile-card-deduction">Deductions: -{currency.format(toNumber(item.deductions))}</span>
              )}
              {toNumber(item.allowances) > 0 && (
                <span className="payroll-mobile-card-allowance">+{currency.format(toNumber(item.allowances))} allowance</span>
              )}
            </div>
            <div className="ticket-mobile-card-footer">
              <span className={item.status === "paid" ? "emp-status-pill active" : "emp-status-pill inactive"}>
                {item.status === "paid" ? "Paid" : "Pending"}
              </span>
              {item.status !== "paid" ? (
                <button
                  aria-label={`Mark paid for ${item.employee_name}`}
                  className="payroll-mobile-card-action payroll-mobile-card-action--paid"
                  onClick={() => void handleMarkPaid(item)}
                  type="button"
                >
                  <CheckCircle2 size={16} /> Mark Paid
                </button>
              ) : (
                <button
                  aria-label={`Mark pending for ${item.employee_name}`}
                  className="payroll-mobile-card-action payroll-mobile-card-action--pending"
                  onClick={() => void handleMarkPending(item)}
                  type="button"
                >
                  <CalendarClock size={16} /> Mark Pending
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      </section>
      {visibleItems.length > PAYROLL_ITEMS_PAGE_SIZE && (
        <div className="attendance-footer">
          <span>
            Showing {payrollPageStart + 1} to {payrollPageEnd} of {visibleItems.length} payroll items
          </span>
          <div>
            <button disabled={safePayrollPage === 1} onClick={() => setPayrollPage((page) => Math.max(1, page - 1))} type="button">{"<"}</button>
            {Array.from({ length: payrollPageCount }, (_, index) => index + 1).map((page) => (
              <button
                className={page === safePayrollPage ? "active" : undefined}
                key={page}
                onClick={() => setPayrollPage(page)}
                type="button"
              >
                {page}
              </button>
            ))}
            <button disabled={safePayrollPage === payrollPageCount} onClick={() => setPayrollPage((page) => Math.min(payrollPageCount, page + 1))} type="button">{">"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function PayrollSettingsManager({
  employees,
  payrollSettings,
  onChange,
  userId,
}: {
  employees: Employee[];
  payrollSettings: PayrollSettings | null;
  onChange: () => Promise<void>;
  userId: string;
}) {
  const [settings, setSettings] = useState<PayrollSettings | null>(payrollSettings);
  const [cutoff, setCutoff] = useState<PayrollSettings["government_deduction_cutoff"]>(payrollSettings?.government_deduction_cutoff ?? "second_half");
  const [enabled, setEnabled] = useState(payrollSettings?.government_deduction_enabled ?? true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSettings(payrollSettings);
    setCutoff(payrollSettings?.government_deduction_cutoff ?? "second_half");
    setEnabled(payrollSettings?.government_deduction_enabled ?? true);
  }, [payrollSettings]);

  useEffect(() => {
    if (!supabase || settings) return;
    void ensurePayrollSettings(supabase, userId).then(({ data }) => {
      if (data) {
        setSettings(data);
        setCutoff(data.government_deduction_cutoff);
        setEnabled(data.government_deduction_enabled);
      }
    });
  }, [settings, userId]);

  const isDirty = settings
    ? cutoff !== settings.government_deduction_cutoff || enabled !== settings.government_deduction_enabled
    : false;

  const employeeMonthlyDeduction = (employee: Employee) =>
    toNumber(employee.sss_deduction) +
    toNumber(employee.philhealth_deduction) +
    toNumber(employee.pagibig_deduction) +
    toNumber(employee.withholding_tax);

  const activeEmployeesWithDeductions = employees.filter(
    (employee) => employee.status === "active" && employeeMonthlyDeduction(employee) > 0,
  );
  const totalMonthlyDeduction = activeEmployeesWithDeductions.reduce(
    (sum, employee) => sum + employeeMonthlyDeduction(employee),
    0,
  );

  const cutoffOptions: Array<{
    value: PayrollSettings["government_deduction_cutoff"];
    label: string;
    helper: string;
  }> = [
    { value: "first_half", label: "1st - 15th Payroll", helper: "Deductions come out of the first payroll of the month." },
    { value: "second_half", label: "30th / Second Cutoff Payroll", helper: "Deductions come out of the second payroll of the month." },
  ];

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    const result = await savePayrollSettings(supabase, userId, { government_deduction_enabled: enabled, government_deduction_cutoff: cutoff });
    setBusy(false);
    if (result.error) {
      NotificationService.showError("Failed to save payroll settings.");
      return;
    }

    setSettings((current) => (current
      ? { ...current, government_deduction_enabled: enabled, government_deduction_cutoff: cutoff }
      : {
          id: "",
          user_id: userId,
          government_deduction_enabled: enabled,
          government_deduction_cutoff: cutoff,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));
    NotificationService.showSuccess("Payroll settings saved.");
    await onChange();
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Settings"
        title="Payroll Settings"
        text="Choose which payroll cutoff applies monthly government deductions for all employees."
      />
      <section className="panel payroll-settings-panel">
        <form onSubmit={handleSubmit}>
          <div className="payroll-settings-section">
            <div className="payroll-settings-toggle-row">
              <div>
                <h3>Government deductions</h3>
                <p className="payroll-settings-hint">
                  Turn off to stop deducting SSS, PhilHealth, Pag-IBIG, and Withholding Tax from every payroll run.
                </p>
              </div>
              <label className="payroll-toggle-switch">
                <input
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                  type="checkbox"
                />
                <span className="payroll-toggle-track"><span className="payroll-toggle-thumb" /></span>
                <span className="sr-only">Enable government deductions</span>
              </label>
            </div>
          </div>

          <div className={`payroll-settings-section${enabled ? "" : " disabled"}`}>
            <h3>Government deduction cutoff</h3>
            <p className="payroll-settings-hint">
              SSS, PhilHealth, Pag-IBIG, and Withholding Tax are deducted once a month - only on the payroll you pick below, never both.
            </p>
            <div className="payroll-cutoff-options" role="radiogroup" aria-label="Government deduction cutoff">
              {cutoffOptions.map((option) => (
                <label
                  className={`payroll-cutoff-card${cutoff === option.value ? " selected" : ""}`}
                  key={option.value}
                >
                  <input
                    checked={cutoff === option.value}
                    disabled={!enabled}
                    name="government-deduction-cutoff"
                    onChange={() => setCutoff(option.value)}
                    type="radio"
                    value={option.value}
                  />
                  <span className="payroll-cutoff-card-check">
                    <CheckCircle2 size={18} />
                  </span>
                  <span className="payroll-cutoff-card-copy">
                    <strong>{option.label}</strong>
                    <small>{option.helper}</small>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className={`payroll-settings-impact${enabled ? "" : " off"}`}>
            <BadgeDollarSign size={20} />
            <div>
              {enabled ? (
                <>
                  <strong>{currency.format(totalMonthlyDeduction)}</strong>
                  <span>
                    total government deductions across {activeEmployeesWithDeductions.length} active employee{activeEmployeesWithDeductions.length === 1 ? "" : "s"} will be applied
                    on the {cutoff === "first_half" ? "1st - 15th" : "30th / second cutoff"} payroll each month.
                  </span>
                </>
              ) : (
                <>
                  <strong>Turned off</strong>
                  <span>No government deductions will be applied to any payroll run until you turn this back on.</span>
                </>
              )}
            </div>
          </div>

          <div className="form-actions">
            <button className="primary-button" disabled={busy || !isDirty} type="submit">
              {busy ? "Saving..." : isDirty ? "Save Settings" : "Saved"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function PayrollHistoryFeature({ employees, rows, tabs }: { employees: Employee[]; rows: PayrollHistoryRow[]; tabs?: ReactNode }) {
  const [query, setQuery] = useState("");
  const [monthFilter, setMonthFilter] = useState("all");
  const [cutoffFilter, setCutoffFilter] = useState<"all" | PayrollPayPeriod>("all");
  const [historyPage, setHistoryPage] = useState(1);
  const HISTORY_PAGE_SIZE = 13;

  const employeeCodeMap = useMemo(() => {
    const sorted = [...employees].sort((a, b) => a.created_at.localeCompare(b.created_at));
    return new Map(sorted.map((e, i) => [e.id, `EMP-${String(i + 1).padStart(3, "0")}`]));
  }, [employees]);
  const empCode = (id: string | null) => (id ? employeeCodeMap.get(id) ?? "-" : "-");

  const filteredRows = rows.filter((row) => {
    const matchesQuery = row.searchText.includes(query.trim().toLowerCase());
    const matchesMonth = monthFilter === "all" || String(row.periodMonth) === monthFilter;
    const matchesCutoff = cutoffFilter === "all" || row.payPeriodCutoff === cutoffFilter;
    return matchesQuery && matchesMonth && matchesCutoff;
  });

  useEffect(() => {
    setHistoryPage(1);
  }, [query, monthFilter, cutoffFilter]);

  const historyPageCount = Math.max(1, Math.ceil(filteredRows.length / HISTORY_PAGE_SIZE));
  const safeHistoryPage = Math.min(historyPage, historyPageCount);
  const historyPageStart = (safeHistoryPage - 1) * HISTORY_PAGE_SIZE;
  const historyPageEnd = Math.min(historyPageStart + HISTORY_PAGE_SIZE, filteredRows.length);
  const paginatedRows = filteredRows.slice(historyPageStart, historyPageEnd);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Payroll records"
        text="Review every employee payroll record."
        title="Payroll History"
      />
      {tabs}
      <Toolbar query={query} setQuery={setQuery}>
        <div className="ph-filter-group">
          <select value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)}>
            <option value="all">All Months</option>
            {monthNames.map((name, index) => (
              <option key={name} value={String(index + 1)}>{name}</option>
            ))}
          </select>
          <select value={cutoffFilter} onChange={(event) => setCutoffFilter(event.target.value as "all" | PayrollPayPeriod)}>
            <option value="all">All cutoffs</option>
            <option value="first_half">1st Cutoff</option>
            <option value="second_half">2nd Cutoff</option>
          </select>
        </div>
      </Toolbar>
      {rows.length === 0 ? (
        <div className="panel"><p className="muted">No paid payroll history yet.</p></div>
      ) : filteredRows.length === 0 ? (
        <div className="panel"><p className="muted">No records match your search.</p></div>
      ) : (
        <>
        <div className="table-wrap ph-table-wrap">
          <table className="ph-table">
            <thead>
              <tr>
                <th>Payroll No.</th>
                <th>Pay Period</th>
                <th>Employee ID</th>
                <th>Employee</th>
                <th>Department</th>
                <th>Gross Pay</th>
                <th>Deductions</th>
                <th>Net Pay</th>
                <th>Date Processed</th>
              </tr>
            </thead>
            <tbody>
              {paginatedRows.map((row) => (
                <tr key={row.payrollNo}>
                  <td className="ph-no" data-label="Payroll No.">{row.payrollNo}</td>
                  <td data-label="Pay Period">{row.payPeriod}</td>
                  <td data-label="Employee ID">{empCode(row.employeeId)}</td>
                  <td data-label="Employee">
                    <div className="employee-list-identity">
                      <EmpAvatar employees={employees} employeeId={row.employeeId} employeeName={row.employeeName} />
                      <RecordTitle title={row.employeeName} notes={employees.find((e) => e.id === row.employeeId)?.email || "No email"} />
                    </div>
                  </td>
                  <td data-label="Department">{row.department}</td>
                  <td data-label="Gross Pay">{currency.format(row.grossPay)}</td>
                  <td data-label="Deductions">{row.deductions > 0 ? currency.format(row.deductions) : "-"}</td>
                  <td data-label="Net Pay"><strong>{currency.format(row.netPay)}</strong></td>
                  <td data-label="Date Processed">{row.processedDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="payroll-mobile-list">
          {paginatedRows.map((row) => (
            <div className="ticket-mobile-card payroll-mobile-card" key={row.payrollNo}>
              <div className="ticket-mobile-card-header">
                <div className="employee-list-identity">
                  <EmpAvatar employees={employees} employeeId={row.employeeId} employeeName={row.employeeName} />
                  <div className="record-title">
                    <strong>{row.employeeName}</strong>
                    <span>{row.department}</span>
                    <span className="emp-mobile-card-badge">{empCode(row.employeeId)}</span>
                  </div>
                </div>
                <strong className="ticket-mobile-card-gross">{currency.format(row.netPay)}</strong>
              </div>
              <div className="payroll-mobile-card-basis">
                <span>{row.payrollNo} · {row.payPeriod}</span>
                <small>Processed {row.processedDate}</small>
              </div>
              <div className="payroll-mobile-card-meta">
                <span>Gross: {currency.format(row.grossPay)}</span>
                {row.deductions > 0 && (
                  <span className="payroll-mobile-card-deduction">Deductions: -{currency.format(row.deductions)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
        </>
      )}
      {filteredRows.length > HISTORY_PAGE_SIZE && (
        <div className="attendance-footer">
          <span>
            Showing {historyPageStart + 1} to {historyPageEnd} of {filteredRows.length} record{filteredRows.length === 1 ? "" : "s"}
          </span>
          <div>
            <button disabled={safeHistoryPage === 1} onClick={() => setHistoryPage((page) => Math.max(1, page - 1))} type="button">{"<"}</button>
            {Array.from({ length: historyPageCount }, (_, index) => index + 1).map((page) => (
              <button
                className={page === safeHistoryPage ? "active" : undefined}
                key={page}
                onClick={() => setHistoryPage(page)}
                type="button"
              >
                {page}
              </button>
            ))}
            <button disabled={safeHistoryPage === historyPageCount} onClick={() => setHistoryPage((page) => Math.min(historyPageCount, page + 1))} type="button">{">"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function PayrollRunForm({
  onClose,
  onSubmit,
  progress,
}: {
  onClose: () => void;
  onSubmit: (values: PayrollRunFormValues, onProgress?: (progress: ActionProgressState | null) => void) => Promise<void>;
  progress: ActionProgressState | null;
}) {
  const [values, setValues] = useState<PayrollRunFormValues>(emptyPayrollRun);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await onSubmit(values);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal className="billing-form-modal payroll-run-modal" onClose={onClose} title="Generate payroll">
      <form className="billing-form-body action-progress-shell" onSubmit={handleSubmit}>
        {busy && (
          <ActionProgress
            description={progress?.description ?? "Preparing employees, payroll items, and totals."}
            progress={progress ? (progress.completed / Math.max(progress.total, 1)) * 100 : undefined}
            progressLabel={progress ? `${progress.completed} of ${progress.total} steps` : undefined}
            title={progress?.title ?? "Generating payroll"}
          />
        )}
        <div className="billing-form-fields payroll-run-form-fields">
          <label>
            Payroll month
            <select value={values.period_month} onChange={(event) => setValues({ ...values, period_month: event.target.value })}>
              {monthNames.map((month, index) => (
                <option key={month} value={index + 1}>
                  {month}
                </option>
              ))}
            </select>
          </label>
          <TextField label="Payroll year" max="2200" min="1900" onChange={(period_year) => setValues({ ...values, period_year })} required type="number" value={values.period_year} />
          <label>
            Pay period
            <select value={values.pay_period} onChange={(event) => setValues({ ...values, pay_period: event.target.value as PayrollRunFormValues["pay_period"] })}>
              <option value="first_half">First half</option>
              <option value="second_half">Second half</option>
            </select>
          </label>
          <TextField label="Generated date" onChange={(generated_date) => setValues({ ...values, generated_date })} required type="date" value={values.generated_date} />
        </div>
        <label>
          Notes
          <textarea rows={3} value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} />
        </label>
        <div className="form-actions">
          <button className="billing-btn outline" disabled={busy} onClick={onClose} type="button">Cancel</button>
          <button className="billing-btn primary" disabled={busy} type="submit">{busy ? "Generating..." : "Generate payroll"}</button>
        </div>
      </form>
    </Modal>
  );
}

