import { describe, expect, it, vi } from "vitest";
import { addMissingEmployeesToRun, savePayrollRun, validatePayrollGeneration } from "./generationUseCases";
import { fakePayrollRepository } from "../../testing/fakes";
import type { QueueOfflineMutation } from "../../shared/types";
import type { AttendanceEntry, Employee, PayrollRun, Position } from "../../types";

const employee = (overrides: Partial<Employee> = {}): Employee => ({
  id: "e1", full_name: "Ana Cruz", status: "active", position_id: "p-ticket",
  ...overrides,
}) as Employee;

const position = (overrides: Partial<Position> = {}): Position => ({
  id: "p-ticket", user_id: "u1", name: "Technician", department: "Ops", description: "",
  status: "active", pay_mode: "ticket", monthly_base_salary: 0, daily_rate: 0, categories: [],
  created_at: "", updated_at: "", ...overrides,
});

const attendance = (overrides: Partial<AttendanceEntry> = {}): AttendanceEntry => ({
  id: "at1", user_id: "u1", employee_id: "e1", employee_name: "Ana Cruz",
  position_id: "p-daily", position_name: "Guard", entry_date: "2026-06-03",
  status: "present", time_in: "08:00", time_out: "17:00",
  created_at: "", updated_at: "", ...overrides,
});

const period = { periodMonth: 6, periodYear: 2026, payPeriod: "first_half" as const };

describe("validatePayrollGeneration", () => {
  it("rejects a run with no active employees", () => {
    const error = validatePayrollGeneration({
      employees: [employee({ status: "inactive" })], positions: [position()],
      attendanceEntries: [], ...period,
    });

    expect(error).toMatch(/at least one active employee/i);
  });

  it("names the employees who have no active position", () => {
    const error = validatePayrollGeneration({
      employees: [employee(), employee({ id: "e2", full_name: "Ben Reyes", position_id: "gone" })],
      positions: [position()], attendanceEntries: [], ...period,
    });

    expect(error).toContain("Ben Reyes");
    expect(error).not.toContain("Ana Cruz");
  });

  it("treats an archived position as no position", () => {
    const error = validatePayrollGeneration({
      employees: [employee()], positions: [position({ status: "archived" })],
      attendanceEntries: [], ...period,
    });

    expect(error).toContain("Ana Cruz");
  });

  // Daily-wage pay is computed from attendance; generating without it would silently pay zero.
  it("blocks generation when a daily-wage employee has no attendance in the period", () => {
    const error = validatePayrollGeneration({
      employees: [employee({ position_id: "p-daily" })],
      positions: [position({ id: "p-daily", pay_mode: "daily" })],
      attendanceEntries: [], ...period,
    });

    expect(error).toMatch(/attendance not recorded/i);
    expect(error).toContain("Ana Cruz");
  });

  it("allows generation once that employee has any attendance in the period", () => {
    const error = validatePayrollGeneration({
      employees: [employee({ position_id: "p-daily" })],
      positions: [position({ id: "p-daily", pay_mode: "daily" })],
      attendanceEntries: [attendance()], ...period,
    });

    expect(error).toBeNull();
  });

  it("ignores attendance from a different period", () => {
    const error = validatePayrollGeneration({
      employees: [employee({ position_id: "p-daily" })],
      positions: [position({ id: "p-daily", pay_mode: "daily" })],
      attendanceEntries: [attendance({ entry_date: "2026-06-20" })], ...period,
    });

    expect(error).toMatch(/attendance not recorded/i);
  });

  it("does not require attendance for ticket-paid employees", () => {
    expect(validatePayrollGeneration({
      employees: [employee()], positions: [position()], attendanceEntries: [], ...period,
    })).toBeNull();
  });
});

const run = (): PayrollRun => ({
  id: "r1", user_id: "u1", period_month: 6, period_year: 2026, pay_period: "first_half",
  generated_date: "2026-06-16", notes: "",
  created_at: "2026-06-16T00:00:00Z", updated_at: "2026-06-16T00:00:00Z",
});

const bundle = () => ({
  runPayload: run() as unknown as Record<string, unknown>,
  itemPayloads: [{ id: "i1" }],
  detailPayloads: [],
  employeeAdvanceUpdates: [],
  salaryBondTransactionPayloads: [],
});

function deps({ online = true, confirmed = true } = {}) {
  const payroll = fakePayrollRepository();
  return {
    repos: { payroll },
    queue: vi.fn(async (_mutation: Parameters<QueueOfflineMutation>[0]) => {}),
    notify: {
      success: vi.fn((_message: string) => {}),
      error: vi.fn((_message: string) => {}),
      confirm: vi.fn(async (_options: { title: string; message: string; danger?: boolean }) => confirmed),
    },
    isOnline: () => online,
    reload: vi.fn(async () => {}),
  };
}

const itemsBundle = () => ({
  itemPayloads: [{ id: "i2", employee_id: "e2" }],
  detailPayloads: [],
  employeeAdvanceUpdates: [],
  salaryBondTransactionPayloads: [],
});

describe("savePayrollRun", () => {
  it("queues the whole bundle when offline", async () => {
    const d = deps({ online: false });
    const result = await savePayrollRun(d, { run: run(), bundle: bundle() });

    expect(result.outcome).toBe("queued");
    expect(d.queue).toHaveBeenCalledTimes(1);
    expect(d.queue.mock.calls[0][0]).toMatchObject({
      operation: "payroll_group", table: "payroll_runs",
    });
  });

  it("saves through the repository when online", async () => {
    const d = deps();
    const result = await savePayrollRun(d, { run: run(), bundle: bundle() });

    expect(result.outcome).toBe("saved");
    expect(result.runId).toBe("r1");
    expect(d.notify.success).toHaveBeenCalled();
    expect(d.queue).not.toHaveBeenCalled();
  });

  it("falls back to the queue on a connectivity failure", async () => {
    const d = deps();
    d.repos.payroll.failNext({ message: "Failed to fetch" });

    const result = await savePayrollRun(d, { run: run(), bundle: bundle() });

    expect(result.outcome).toBe("queued");
    expect(d.queue).toHaveBeenCalledTimes(1);
    expect(d.notify.error).not.toHaveBeenCalled();
  });

  // Generating a period that already exists is a normal mistake, not an error to shout
  // about -- recover by selecting the run that is already there.
  it("recovers the existing run when the period unique key collides", async () => {
    const d = deps();
    d.repos.payroll.failNext({
      code: "23505",
      message: 'duplicate key value violates unique constraint "payroll_runs_user_id_period_month_period_year_pay_period_key"',
    });
    d.repos.payroll.seedRunId("existing-run");

    const result = await savePayrollRun(d, { run: run(), bundle: bundle() });

    expect(result.outcome).toBe("existing");
    expect(result.runId).toBe("existing-run");
    expect(d.notify.success.mock.calls[0][0]).toMatch(/already exists/i);
    expect(d.notify.error).not.toHaveBeenCalled();
  });

  it("reports the original error when the collision cannot be resolved to a run", async () => {
    const d = deps();
    d.repos.payroll.failNext({ code: "23505", message: "duplicate key value" });

    const result = await savePayrollRun(d, { run: run(), bundle: bundle() });

    expect(result.outcome).toBe("failed");
    expect(d.notify.error).toHaveBeenCalled();
  });

  it("surfaces any other server error without queueing", async () => {
    const d = deps();
    d.repos.payroll.failNext({ code: "42501", message: "row-level security" });

    const result = await savePayrollRun(d, { run: run(), bundle: bundle() });

    expect(result.outcome).toBe("failed");
    expect(d.queue).not.toHaveBeenCalled();
    expect(d.notify.error).toHaveBeenCalled();
  });
});

describe("addMissingEmployeesToRun", () => {
  it("does nothing when there are no missing employees", async () => {
    const d = deps();
    const saveSpy = vi.spyOn(d.repos.payroll, "saveItemsBundle");

    const outcome = await addMissingEmployeesToRun(d, { missingEmployeeCount: 0, bundle: itemsBundle() });

    expect(outcome).toBe("failed");
    expect(d.notify.confirm).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("does nothing when the confirmation is declined", async () => {
    const d = deps({ confirmed: false });
    const saveSpy = vi.spyOn(d.repos.payroll, "saveItemsBundle");

    const outcome = await addMissingEmployeesToRun(d, { missingEmployeeCount: 1, bundle: itemsBundle() });

    expect(outcome).toBe("failed");
    expect(d.queue).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("queues the items bundle when offline", async () => {
    const d = deps({ online: false });
    const outcome = await addMissingEmployeesToRun(d, { missingEmployeeCount: 1, bundle: itemsBundle() });

    expect(outcome).toBe("queued");
    expect(d.queue).toHaveBeenCalledTimes(1);
    expect(d.queue.mock.calls[0][0]).toMatchObject({
      operation: "payroll_items_group", table: "payroll_run_items",
    });
  });

  it("saves through the repository when online", async () => {
    const d = deps();
    const outcome = await addMissingEmployeesToRun(d, { missingEmployeeCount: 1, bundle: itemsBundle() });

    expect(outcome).toBe("saved");
    expect(d.notify.success).toHaveBeenCalled();
    expect(d.queue).not.toHaveBeenCalled();
  });

  it("falls back to the queue on a connectivity failure", async () => {
    const d = deps();
    d.repos.payroll.failNext({ message: "Failed to fetch" });

    const outcome = await addMissingEmployeesToRun(d, { missingEmployeeCount: 1, bundle: itemsBundle() });

    expect(outcome).toBe("queued");
    expect(d.queue).toHaveBeenCalledTimes(1);
    expect(d.notify.error).not.toHaveBeenCalled();
  });

  it("surfaces a server error without queueing", async () => {
    const d = deps();
    d.repos.payroll.failNext({ code: "42501", message: "row-level security" });

    const outcome = await addMissingEmployeesToRun(d, { missingEmployeeCount: 1, bundle: itemsBundle() });

    expect(outcome).toBe("failed");
    expect(d.queue).not.toHaveBeenCalled();
    expect(d.notify.error).toHaveBeenCalled();
  });

  it("pluralizes the confirmation and success messages correctly", async () => {
    const d = deps();
    await addMissingEmployeesToRun(d, { missingEmployeeCount: 2, bundle: itemsBundle() });

    expect(d.notify.confirm.mock.calls[0][0].message).toContain("2 missing employees");
    expect(d.notify.success.mock.calls[0][0]).toContain("2 employees added");
  });
});
