import { describe, expect, it, vi } from "vitest";
import {
  cancelExpense,
  deleteExpense,
  deleteInstallmentPayment,
  endRecurringExpense,
  payInstallment,
  saveExpense,
} from "./useCases";
import { fakeExpenseCategoryRepository, fakeExpenseRepository } from "../../testing/fakes";
import type { QueueOfflineMutation } from "../../shared/types";
import type { Employee, Expense, ExpenseCategory, ExpenseInstallmentPayment } from "../../types";

const category = (overrides: Partial<ExpenseCategory> = {}): ExpenseCategory => ({
  id: "cat-company", user_id: "u1", name: "Rent", type: "company", status: "active",
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...overrides,
});

const employee = (overrides: Partial<Employee> = {}): Employee => ({
  id: "e1", full_name: "Ana Cruz", status: "active",
  ...overrides,
}) as Employee;

const payment = (overrides: Partial<ExpenseInstallmentPayment> = {}): ExpenseInstallmentPayment => ({
  id: "p1", user_id: "u1", expense_id: "x1", amount: 500, payment_date: "2026-06-10",
  payment_method: "cash", reference_number: "", notes: "", created_at: "2026-06-10T00:00:00Z",
  ...overrides,
});

const expense = (overrides: Partial<Expense> = {}): Expense => ({
  id: "x1", user_id: "u1", employee_id: "e1", employee_name: "Ana Cruz",
  category_id: "cat-company", category_name: "Rent", amount: 1000, frequency: "one_time",
  duration_months: null, status: "pending", paid_date: null, expense_date: "2026-06-01",
  due_date: null, payment_date: null, notes: "", payroll_run_id: null,
  subcontractor_payment_reminder_id: null, installment_payments: [],
  created_at: "2026-06-01T00:00:00Z", updated_at: "2026-06-01T00:00:00Z", ...overrides,
});

const formValues = (overrides = {}) => ({
  employee_id: "e1", employee_name: "", category_id: "cat-company", amount: "1000",
  frequency: "one_time" as const, expense_date: "2026-06-01", due_date: "", payment_date: "",
  notes: "", ...overrides,
});

function deps({ online = true, confirmed = true } = {}) {
  const expenses = fakeExpenseRepository();
  const expenseCategories = fakeExpenseCategoryRepository();
  return {
    repos: { expenses, expenseCategories },
    queue: vi.fn(async (_mutation: Parameters<QueueOfflineMutation>[0]) => {}),
    notify: {
      success: vi.fn((_message: string) => {}),
      error: vi.fn((_message: string) => {}),
      confirm: vi.fn(async (_options: { title: string; message: string; danger?: boolean }) => confirmed),
    },
    isOnline: () => online,
    reload: vi.fn(async () => {}),
    newId: () => "generated-id",
    now: () => "2026-06-15T00:00:00Z",
    today: () => "2026-06-15",
  };
}

const context = {
  activeCategories: [category(), category({ id: "cat-personal", type: "personal", name: "Groceries" })],
  activeEmployees: [employee()],
  userId: "u1",
};

describe("saveExpense", () => {
  it("refuses an unknown category", async () => {
    const d = deps();
    const saved = await saveExpense(d, { values: formValues({ category_id: "nope" }), editing: null, ...context });

    expect(saved).toBe(false);
    expect(d.notify.error).toHaveBeenCalled();
    expect((await d.repos.expenses.list()).data).toEqual([]);
  });

  it("requires a real employee for a company expense", async () => {
    const d = deps();
    const saved = await saveExpense(d, { values: formValues({ employee_id: "ghost" }), editing: null, ...context });

    expect(saved).toBe(false);
    expect(d.notify.error).toHaveBeenCalled();
  });

  it("requires a typed name for a personal expense instead of an employee", async () => {
    const d = deps();
    const blank = await saveExpense(d, {
      values: formValues({ category_id: "cat-personal", employee_name: "   " }), editing: null, ...context,
    });
    expect(blank).toBe(false);

    const named = await saveExpense(d, {
      values: formValues({ category_id: "cat-personal", employee_name: "  Meralco  " }), editing: null, ...context,
    });
    expect(named).toBe(true);
    expect((await d.repos.expenses.list()).data![0].employee_name).toBe("Meralco");
  });

  it("queues instead of writing when offline", async () => {
    const d = deps({ online: false });
    const saved = await saveExpense(d, { values: formValues(), editing: null, ...context });

    expect(saved).toBe(true);
    expect(d.queue).toHaveBeenCalledTimes(1);
    expect(d.queue.mock.calls[0][0]).toMatchObject({ table: "expenses", operation: "upsert", recordId: "generated-id" });
    expect((await d.repos.expenses.list()).data).toEqual([]);
    expect(d.reload).not.toHaveBeenCalled();
  });

  it("writes through and reloads when online", async () => {
    const d = deps();
    const saved = await saveExpense(d, { values: formValues(), editing: null, ...context });

    expect(saved).toBe(true);
    expect((await d.repos.expenses.list()).data).toHaveLength(1);
    expect(d.reload).toHaveBeenCalledTimes(1);
  });

  it("falls back to the queue on a connectivity failure", async () => {
    const d = deps();
    d.repos.expenses.failNext({ message: "Failed to fetch" });

    const saved = await saveExpense(d, { values: formValues(), editing: null, ...context });

    expect(saved).toBe(true);
    expect(d.queue).toHaveBeenCalledTimes(1);
  });

  // These two constraint errors mean the database predates a schema update; the admin needs
  // to be told that specifically, not handed a raw Postgres message.
  it("explains a legacy status constraint rather than surfacing it raw", async () => {
    const d = deps();
    d.repos.expenses.failNext({ code: "23514", message: 'violates check constraint "expenses_status_check"' });

    const saved = await saveExpense(d, { values: formValues(), editing: null, ...context });

    expect(saved).toBe(false);
    expect(d.notify.error.mock.calls[0][0]).toMatch(/schema update/i);
    expect(d.notify.error.mock.calls[0][0]).not.toMatch(/expenses_status_check/);
  });

  it("explains a legacy frequency constraint rather than surfacing it raw", async () => {
    const d = deps();
    d.repos.expenses.failNext({ code: "23514", message: 'violates check constraint "expenses_frequency_check"' });

    await saveExpense(d, { values: formValues({ frequency: "daily" }), editing: null, ...context });

    expect(d.notify.error.mock.calls[0][0]).toMatch(/schema update/i);
    expect(d.notify.error.mock.calls[0][0]).not.toMatch(/expenses_frequency_check/);
  });
});

describe("deleteExpense", () => {
  it("refuses to delete an expense that already has payments against it", async () => {
    const d = deps();
    const target = expense({ installment_payments: [payment()] });
    d.repos.expenses.seed([target]);

    const deleted = await deleteExpense(d, { expense: target });

    expect(deleted).toBe(false);
    expect((await d.repos.expenses.list()).data).toHaveLength(1);
    expect(d.queue).not.toHaveBeenCalled();
  });

  it("queues the delete when offline", async () => {
    const d = deps({ online: false });
    const target = expense();
    d.repos.expenses.seed([target]);

    expect(await deleteExpense(d, { expense: target })).toBe(true);
    expect(d.queue.mock.calls[0][0]).toMatchObject({ operation: "delete", table: "expenses", recordId: "x1" });
    expect((await d.repos.expenses.list()).data).toHaveLength(1);
  });

  it("deletes through the repository when online", async () => {
    const d = deps();
    const target = expense();
    d.repos.expenses.seed([target]);

    expect(await deleteExpense(d, { expense: target })).toBe(true);
    expect((await d.repos.expenses.list()).data).toEqual([]);
    expect(d.reload).toHaveBeenCalledTimes(1);
  });
});

describe("cancelExpense", () => {
  it("does nothing when the confirmation is declined", async () => {
    const d = deps({ confirmed: false });
    const target = expense();
    d.repos.expenses.seed([target]);

    await cancelExpense(d, { expense: target });

    expect((await d.repos.expenses.list()).data![0].status).toBe("pending");
    expect(d.queue).not.toHaveBeenCalled();
  });

  it("cancels through the repository when online", async () => {
    const d = deps();
    const target = expense();
    d.repos.expenses.seed([target]);

    await cancelExpense(d, { expense: target });

    expect((await d.repos.expenses.list()).data![0].status).toBe("cancelled");
    expect(d.reload).toHaveBeenCalledTimes(1);
  });
});

describe("payInstallment", () => {
  it("rejects a payment above the remaining balance", async () => {
    const d = deps();
    const target = expense({ amount: 1000 });
    d.repos.expenses.seed([target]);

    const paid = await payInstallment(d, {
      expense: target,
      values: { amount: "5000", payment_date: "2026-06-10", payment_method: "cash", reference_number: "", notes: "" },
      userId: "u1",
    });

    expect(paid).toBe(false);
    expect(d.notify.error).toHaveBeenCalled();
  });

  it("queues the payment bundle when offline", async () => {
    const d = deps({ online: false });
    const target = expense();
    d.repos.expenses.seed([target]);

    const paid = await payInstallment(d, {
      expense: target,
      values: { amount: "400", payment_date: "2026-06-10", payment_method: "cash", reference_number: "", notes: "" },
      userId: "u1",
    });

    expect(paid).toBe(true);
    expect(d.queue.mock.calls[0][0]).toMatchObject({ operation: "expense_payment_group", recordId: "generated-id" });
    expect((await d.repos.expenses.list()).data![0].installment_payments).toEqual([]);
  });

  it("records the payment and leaves a part-paid expense open", async () => {
    const d = deps();
    const target = expense({ amount: 1000 });
    d.repos.expenses.seed([target]);

    await payInstallment(d, {
      expense: target,
      values: { amount: "400", payment_date: "2026-06-10", payment_method: "cash", reference_number: "", notes: "" },
      userId: "u1",
    });

    const saved = (await d.repos.expenses.list()).data![0];
    expect(saved.installment_payments).toHaveLength(1);
    expect(saved.status).toBe("pending");
    expect(d.notify.success.mock.calls[0][0]).not.toMatch(/History/);
  });

  it("settles the expense and says so when the final payment lands", async () => {
    const d = deps();
    const target = expense({ amount: 1000 });
    d.repos.expenses.seed([target]);

    await payInstallment(d, {
      expense: target,
      values: { amount: "1000", payment_date: "2026-06-10", payment_method: "cash", reference_number: "", notes: "" },
      userId: "u1",
    });

    expect((await d.repos.expenses.list()).data![0].status).toBe("paid");
    expect(d.notify.success.mock.calls[0][0]).toMatch(/History/);
  });
});

describe("deleteInstallmentPayment", () => {
  // Removing the payment that settled an expense has to reopen it, or the expense stays in
  // History showing paid while its balance is outstanding again.
  it("reopens a settled expense when its last payment is removed", async () => {
    const d = deps();
    const settled = expense({ amount: 500, status: "paid", paid_date: "2026-06-10", installment_payments: [payment({ amount: 500 })] });
    d.repos.expenses.seed([settled]);

    await deleteInstallmentPayment(d, { expense: settled, payment: settled.installment_payments[0] });

    const after = (await d.repos.expenses.list()).data![0];
    expect(after.installment_payments).toEqual([]);
    expect(after.status).toBe("pending");
    expect(after.paid_date).toBeNull();
  });

  it("leaves a still-unpaid expense alone beyond removing the payment", async () => {
    const d = deps();
    const partial = expense({ amount: 1000, status: "pending", installment_payments: [payment({ amount: 400 })] });
    d.repos.expenses.seed([partial]);

    await deleteInstallmentPayment(d, { expense: partial, payment: partial.installment_payments[0] });

    const after = (await d.repos.expenses.list()).data![0];
    expect(after.installment_payments).toEqual([]);
    expect(after.status).toBe("pending");
  });

  it("does nothing when the confirmation is declined", async () => {
    const d = deps({ confirmed: false });
    const target = expense({ installment_payments: [payment()] });
    d.repos.expenses.seed([target]);

    await deleteInstallmentPayment(d, { expense: target, payment: target.installment_payments[0] });

    expect((await d.repos.expenses.list()).data![0].installment_payments).toHaveLength(1);
  });
});

describe("endRecurringExpense", () => {
  it("marks the expense paid as of today", async () => {
    const d = deps();
    const target = expense({ frequency: "monthly" });
    d.repos.expenses.seed([target]);

    await endRecurringExpense(d, { expense: target });

    const after = (await d.repos.expenses.list()).data![0];
    expect(after.status).toBe("paid");
    expect(after.paid_date).toBe("2026-06-15");
  });

  it("does nothing when the confirmation is declined", async () => {
    const d = deps({ confirmed: false });
    const target = expense({ frequency: "monthly" });
    d.repos.expenses.seed([target]);

    await endRecurringExpense(d, { expense: target });

    expect((await d.repos.expenses.list()).data![0].status).toBe("pending");
  });
});
