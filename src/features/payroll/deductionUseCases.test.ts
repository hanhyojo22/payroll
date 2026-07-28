import { describe, expect, it, vi } from "vitest";
import { applyMissingDeductions, markAllItemsPaid } from "./deductionUseCases";
import { fakeEmployeeAdvanceRepository, fakePayrollRepository, fakeSalaryBondRepository } from "../../testing/fakes";
import type { EmployeeAdvance, PayrollRunItem, PayrollRunWithItems } from "../../types";

const item = (overrides: Partial<PayrollRunItem> = {}): PayrollRunItem => ({
  id: "i1", user_id: "u1", payroll_run_id: "r1", employee_id: "e1", employee_name: "Ana Cruz",
  position_id: "p1", position_name: "Technician", pay_mode: "ticket", base_pay: 0,
  ticket_pay: 1000, daily_rate: 0, days_worked: 0, total_working_days: 0, ticket_details: [],
  installation_tickets: 0, repair_tickets: 4, installation_rate: 0, repair_rate: 0,
  nap_rehab_tickets: 0, nap_rehab_rate: 0, gross_pay: 1000, allowances: 0, deductions: 0,
  net_pay: 1000, status: "pending", paid_date: null, notes: "",
  created_at: "2026-06-01T00:00:00Z", updated_at: "2026-06-01T00:00:00Z", ...overrides,
});

const run = (items: PayrollRunItem[]): PayrollRunWithItems => ({
  id: "r1", user_id: "u1", period_month: 6, period_year: 2026, pay_period: "first_half",
  generated_date: "2026-06-16", notes: "",
  created_at: "2026-06-16T00:00:00Z", updated_at: "2026-06-16T00:00:00Z", items,
});

const advance = (overrides: Partial<EmployeeAdvance> = {}): EmployeeAdvance => ({
  id: "a1", user_id: "u1", employee_id: "e1", employee_name: "Ana Cruz", advance_id: "EA-1",
  advance_type: "Cash Advance", date_granted: "2026-05-01", start_deduction: "2026-06-01",
  purpose: "", amount: 1000, balance: 1000, deduction_per_payroll: 200, status: "active",
  notes: "", created_at: "2026-05-01T00:00:00Z", updated_at: "2026-05-01T00:00:00Z", ...overrides,
});

function deps({ online = true, confirmed = true } = {}) {
  const payroll = fakePayrollRepository();
  const salaryBonds = fakeSalaryBondRepository();
  const employeeAdvances = fakeEmployeeAdvanceRepository();
  return {
    repos: { payroll, salaryBonds, employeeAdvances },
    notify: {
      success: vi.fn((_message: string) => {}),
      error: vi.fn((_message: string) => {}),
      confirm: vi.fn(async (_options: { title: string; message: string; danger?: boolean }) => confirmed),
    },
    isOnline: () => online,
    reload: vi.fn(async () => {}),
    today: () => "2026-06-20",
    onProgress: vi.fn((_completed: number, _total: number) => {}),
  };
}

const deductionEntry = (target: PayrollRunItem) => ({
  item: target,
  patch: {
    payload: { deductions: 200, net_pay: 800, notes: "Advance deduction" } as Partial<PayrollRunItem>,
    advanceDeductions: [{ amount: 200, advance: advance() }],
    bondDeductions: [],
  },
});

const buildBondPayloads = () => [{ id: "bt1", salary_bond_id: "b1", amount: 100, type: "deduction" }];

describe("applyMissingDeductions", () => {
  it("refuses to run offline without touching anything", async () => {
    const d = deps({ online: false });
    const target = item();
    d.repos.payroll.seedItems([target]);

    await applyMissingDeductions(d, {
      run: run([target]),
      itemsNeedingDeductions: [deductionEntry(target)],
      buildBondPayloads,
    });

    expect(d.notify.error).toHaveBeenCalled();
    expect(d.repos.payroll.itemsFor("r1")[0].deductions).toBe(0);
    expect(d.repos.salaryBonds.transactions()).toEqual([]);
  });

  it("does nothing when the confirmation is declined", async () => {
    const d = deps({ confirmed: false });
    const target = item();
    d.repos.payroll.seedItems([target]);

    await applyMissingDeductions(d, {
      run: run([target]),
      itemsNeedingDeductions: [deductionEntry(target)],
      buildBondPayloads,
    });

    expect(d.repos.salaryBonds.transactions()).toEqual([]);
    expect(d.repos.payroll.itemsFor("r1")[0].deductions).toBe(0);
  });

  it("does nothing at all when no item needs a deduction", async () => {
    const d = deps();
    await applyMissingDeductions(d, { run: run([]), itemsNeedingDeductions: [], buildBondPayloads });

    expect(d.notify.confirm).not.toHaveBeenCalled();
    expect(d.reload).not.toHaveBeenCalled();
  });

  // The ordering invariant: an item must never end up patched with a deduction note whose
  // ledger write never happened. So the ledger goes first, and a ledger failure stops
  // everything before any item is touched.
  it("does not patch any item when the ledger write fails", async () => {
    const d = deps();
    const target = item();
    d.repos.payroll.seedItems([target]);
    d.repos.salaryBonds.failNext({ code: "23503", message: "foreign key violation" });

    await applyMissingDeductions(d, {
      run: run([target]),
      itemsNeedingDeductions: [deductionEntry(target)],
      buildBondPayloads,
    });

    expect(d.notify.error).toHaveBeenCalled();
    expect(d.repos.payroll.itemsFor("r1")[0].deductions).toBe(0);
    expect(d.reload).not.toHaveBeenCalled();
  });

  it("writes the ledger before patching, so a later item failure leaves the ledger applied", async () => {
    const d = deps();
    const target = item();
    d.repos.payroll.seedItems([target]);
    d.repos.payroll.failNext({ code: "42501", message: "row-level security" });

    await applyMissingDeductions(d, {
      run: run([target]),
      itemsNeedingDeductions: [deductionEntry(target)],
      buildBondPayloads,
    });

    expect(d.repos.salaryBonds.transactions()).toHaveLength(1);
    expect(d.notify.error).toHaveBeenCalled();
  });

  it("applies the ledger and every item patch on the happy path", async () => {
    const d = deps();
    const target = item();
    d.repos.payroll.seedItems([target]);
    d.repos.employeeAdvances.seed([advance()]);

    await applyMissingDeductions(d, {
      run: run([target]),
      itemsNeedingDeductions: [deductionEntry(target)],
      buildBondPayloads,
    });

    expect(d.repos.salaryBonds.transactions()).toHaveLength(1);
    expect(d.repos.payroll.itemsFor("r1")[0].deductions).toBe(200);
    // Absolute balance, not a decrement -- 1000 less a 200 deduction.
    expect((await d.repos.employeeAdvances.list()).data![0].balance).toBe(800);
    expect(d.reload).toHaveBeenCalledTimes(1);
  });
});

describe("markAllItemsPaid", () => {
  it("refuses to run offline", async () => {
    const d = deps({ online: false });
    const target = item();
    d.repos.payroll.seedItems([target]);

    await markAllItemsPaid(d, {
      run: run([target]), pendingItems: [target],
      itemsNeedingDeductions: [], deductionPatchById: new Map(), buildBondPayloads,
    });

    expect(d.notify.error).toHaveBeenCalled();
    expect(d.repos.payroll.itemsFor("r1")[0].status).toBe("pending");
  });

  it("marks every pending item paid with today's date", async () => {
    const d = deps();
    const items = [item({ id: "i1" }), item({ id: "i2" })];
    d.repos.payroll.seedItems(items);

    await markAllItemsPaid(d, {
      run: run(items), pendingItems: items,
      itemsNeedingDeductions: [], deductionPatchById: new Map(), buildBondPayloads,
    });

    const saved = d.repos.payroll.itemsFor("r1");
    expect(saved.every((row) => row.status === "paid")).toBe(true);
    expect(saved.every((row) => row.paid_date === "2026-06-20")).toBe(true);
    expect(d.reload).toHaveBeenCalledTimes(1);
  });

  // Same invariant as above: nothing is marked paid until the ledger it claims is applied.
  it("marks nothing paid when the ledger write fails", async () => {
    const d = deps();
    const target = item();
    d.repos.payroll.seedItems([target]);
    d.repos.salaryBonds.failNext({ code: "23503", message: "foreign key violation" });

    await markAllItemsPaid(d, {
      run: run([target]), pendingItems: [target],
      itemsNeedingDeductions: [deductionEntry(target)],
      deductionPatchById: new Map(), buildBondPayloads,
    });

    expect(d.repos.payroll.itemsFor("r1")[0].status).toBe("pending");
    expect(d.notify.error).toHaveBeenCalled();
  });

  it("stops at the first failing item rather than continuing", async () => {
    const d = deps();
    const items = [item({ id: "i1" }), item({ id: "i2" })];
    d.repos.payroll.seedItems(items);
    d.repos.payroll.failNext({ code: "42501", message: "row-level security" });

    await markAllItemsPaid(d, {
      run: run(items), pendingItems: items,
      itemsNeedingDeductions: [], deductionPatchById: new Map(), buildBondPayloads,
    });

    expect(d.repos.payroll.itemsFor("r1").every((row) => row.status === "pending")).toBe(true);
    expect(d.notify.error).toHaveBeenCalled();
    expect(d.reload).not.toHaveBeenCalled();
  });

  it("reports progress as it goes", async () => {
    const d = deps();
    const items = [item({ id: "i1" }), item({ id: "i2" })];
    d.repos.payroll.seedItems(items);

    await markAllItemsPaid(d, {
      run: run(items), pendingItems: items,
      itemsNeedingDeductions: [], deductionPatchById: new Map(), buildBondPayloads,
    });

    expect(d.onProgress).toHaveBeenCalledWith(1, 2);
    expect(d.onProgress).toHaveBeenCalledWith(2, 2);
  });

  it("folds a pending deduction patch into the same write that marks the item paid", async () => {
    const d = deps();
    const target = item();
    d.repos.payroll.seedItems([target]);
    const patchById = new Map([["i1", { deductions: 200, net_pay: 800 } as Partial<PayrollRunItem>]]);

    await markAllItemsPaid(d, {
      run: run([target]), pendingItems: [target],
      itemsNeedingDeductions: [], deductionPatchById: patchById, buildBondPayloads,
    });

    const saved = d.repos.payroll.itemsFor("r1")[0];
    expect(saved.status).toBe("paid");
    expect(saved.deductions).toBe(200);
    expect(saved.net_pay).toBe(800);
  });
});
