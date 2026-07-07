import { afterEach, describe, expect, it, vi } from "vitest";
import { todayKey } from "../shared/utils/dates";
import {
  daysBetween,
  expenseCyclesElapsedSince,
  expenseDisplayStatus,
  expenseDurationCount,
  expenseOverdueReferenceDate,
  expensePeriodDueDates,
  expensePeriodsDueByNow,
  expenseRemainingBalance,
  expenseTotalAmount,
  formatExpenseDuration,
  isExpenseOverdue,
  isExpensePeriodDueToday,
  monthsBetween,
  nextExpenseCompletionState,
  validateExpensePayment,
} from "./expenses";
import type { Expense, ExpenseInstallmentPayment } from "../types";

const payment = (amount: number, overrides: Partial<ExpenseInstallmentPayment> = {}): ExpenseInstallmentPayment => ({
  id: crypto.randomUUID(), user_id: "user-1", expense_id: "expense-1", amount,
  payment_date: "2026-06-10", payment_method: "cash", reference_number: "", notes: "",
  created_at: "2026-06-10T00:00:00Z", ...overrides,
});

const expense = (overrides: Partial<Expense> = {}): Expense => ({
  id: "expense-1", user_id: "user-1", employee_id: "employee-1", employee_name: "Juan Dela Cruz",
  category_id: "category-1", category_name: "Transportation", amount: 1000,
  frequency: "one_time", duration_months: null, installment_payments: [],
  status: "pending", paid_date: null, expense_date: "2026-06-01", due_date: "2026-06-30",
  payment_date: null,
  notes: "", payroll_run_id: null, created_at: "2026-06-01T00:00:00Z", updated_at: "2026-06-01T00:00:00Z", ...overrides,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("one-time expense payment rules", () => {
  it("moves from unpaid to partial to paid as payments accumulate", () => {
    expect(expenseDisplayStatus(expense(), [])).toBe("unpaid");
    expect(expenseDisplayStatus(expense(), [payment(400)])).toBe("partial");
    expect(expenseDisplayStatus(expense(), [payment(400), payment(600)])).toBe("paid");
  });

  it("computes remaining balance against the full amount", () => {
    expect(expenseRemainingBalance(expense(), [payment(400)])).toBe(600);
    expect(expenseRemainingBalance(expense(), [payment(400), payment(600)])).toBe(0);
  });

  it("cancelled short-circuits regardless of payments", () => {
    expect(expenseDisplayStatus(expense({ status: "cancelled" }), [payment(400)])).toBe("cancelled");
    expect(expenseDisplayStatus(expense({ status: "cancelled" }), [])).toBe("cancelled");
  });
});

describe("monthly expense with a set duration", () => {
  it("uses total (amount * duration_months), not a payment count, to determine completion", () => {
    const monthly = expense({ frequency: "monthly", duration_months: 3, amount: 100 });
    expect(expenseTotalAmount(monthly)).toBe(300);
    // Two uneven payments that sum to the total should complete it, even though only 2 payments were made for a 3-month duration.
    expect(expenseDisplayStatus(monthly, [payment(250), payment(50)])).toBe("paid");
    expect(expenseDisplayStatus(monthly, [payment(250)])).toBe("partial");
  });

  it("computes next completion state from cumulative amount", () => {
    const monthly = expense({ frequency: "monthly", duration_months: 3, amount: 100 });
    expect(nextExpenseCompletionState(monthly, [payment(250)], "2026-06-15")).toEqual({ status: "pending", paid_date: null });
    expect(nextExpenseCompletionState(monthly, [payment(250), payment(50)], "2026-06-15")).toEqual({ status: "paid", paid_date: "2026-06-15" });
  });
});

describe("monthly expense with no end date", () => {
  it("never computes a total or balance", () => {
    const openEnded = expense({ frequency: "monthly", duration_months: null, amount: 100 });
    expect(expenseTotalAmount(openEnded)).toBeNull();
    expect(expenseRemainingBalance(openEnded, [payment(100)])).toBeNull();
  });

  it("falls back to the stored status, using payment presence to distinguish unpaid vs partial", () => {
    const openEnded = expense({ frequency: "monthly", duration_months: null, amount: 100 });
    expect(expenseDisplayStatus(openEnded, [])).toBe("unpaid");
    expect(expenseDisplayStatus(openEnded, [payment(100)])).toBe("partial");
    const openEndedPaid = expense({ frequency: "monthly", duration_months: null, amount: 100, status: "paid" });
    expect(expenseDisplayStatus(openEndedPaid, [payment(100)])).toBe("paid");
  });
});

describe("daily expense with a due-date-derived duration", () => {
  it("computes total from amount times the number of days between start and due date", () => {
    const daily = expense({ frequency: "daily", amount: 100, expense_date: "2026-06-01", due_date: "2026-06-11", duration_months: daysBetween("2026-06-01", "2026-06-11") });
    expect(daily.duration_months).toBe(10);
    expect(expenseTotalAmount(daily)).toBe(1000);
  });
});

describe("date-derived duration helpers", () => {
  it("computes whole calendar months between a start and due date, ignoring day-of-month", () => {
    expect(monthsBetween("2026-07-04", "2027-07-04")).toBe(12);
    expect(monthsBetween("2026-07-15", "2027-01-04")).toBe(6);
  });

  it("floors at 1 month so a same-day or past due date still yields a valid duration", () => {
    expect(monthsBetween("2026-07-04", "2026-07-04")).toBe(1);
    expect(monthsBetween("2026-07-04", "2026-06-01")).toBe(1);
  });

  it("computes whole days between a start and due date", () => {
    expect(daysBetween("2026-06-01", "2026-06-11")).toBe(10);
    expect(daysBetween("2026-06-01", "2026-06-01")).toBe(1);
  });

  it("expenseDurationCount dispatches on frequency", () => {
    expect(expenseDurationCount("monthly", "2026-07-04", "2027-07-04")).toBe(12);
    expect(expenseDurationCount("daily", "2026-06-01", "2026-06-11")).toBe(10);
  });

  it("formats duration using the frequency's unit", () => {
    expect(formatExpenseDuration("daily", 10)).toBe("10 days");
    expect(formatExpenseDuration("daily", 1)).toBe("1 day");
    expect(formatExpenseDuration("monthly", 12)).toBe("1 year");
    expect(formatExpenseDuration("monthly", 6)).toBe("6 months");
    expect(formatExpenseDuration("monthly", null)).toBeNull();
  });
});

describe("monthly recurring overdue tracking", () => {
  const monthly = expense({
    frequency: "monthly", amount: 1000, expense_date: "2027-01-14", due_date: "2027-07-14", duration_months: 6,
  });

  it("uses the current calendar day in the local timezone for overdue checks", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-07-14T00:30:00+08:00"));
    expect(todayKey()).toBe("2027-07-14");
  });

  it("builds one per-cycle due date per period, ending on due_date", () => {
    expect(expensePeriodDueDates(monthly)).toEqual([
      "2027-02-14", "2027-03-14", "2027-04-14", "2027-05-14", "2027-06-14", "2027-07-14",
    ]);
  });

  it("clamps to the shorter month's last day instead of overflowing when due_date is on the 29th-31st", () => {
    const monthlyEndOfMonth = expense({
      frequency: "monthly", amount: 1000, expense_date: "2027-01-31", due_date: "2027-03-31", duration_months: 3,
    });
    expect(expensePeriodDueDates(monthlyEndOfMonth)).toEqual([
      "2027-01-31", "2027-02-28", "2027-03-31",
    ]);
  });

  it("counts how many cycles have arrived by a given date", () => {
    expect(expensePeriodsDueByNow(monthly, "2027-01-20")).toBe(0);
    expect(expensePeriodsDueByNow(monthly, "2027-04-01")).toBe(2);
    expect(expensePeriodsDueByNow(monthly, "2027-04-14")).toBe(3);
    expect(expensePeriodsDueByNow(monthly, "2027-12-01")).toBe(6);
  });

  it("flags overdue once cumulative payments fall behind the cycles due so far", () => {
    expect(isExpenseOverdue(monthly, [payment(1000)], "2027-04-01")).toBe(true);
    expect(isExpenseOverdue(monthly, [payment(1000), payment(1000)], "2027-04-01")).toBe(false);
    expect(isExpenseOverdue(monthly, [], "2027-01-20")).toBe(false);
  });

  it("stays overdue past the final due date if still short, per-cycle basis", () => {
    expect(isExpenseOverdue(monthly, [payment(1000), payment(1000)], "2027-08-01")).toBe(true);
    expect(isExpenseOverdue(monthly, [payment(6000)], "2027-08-01")).toBe(false);
  });

  it("never flags cancelled or already-paid expenses", () => {
    expect(isExpenseOverdue({ ...monthly, status: "cancelled" }, [], "2027-08-01")).toBe(false);
    expect(isExpenseOverdue({ ...monthly, status: "paid" }, [], "2027-08-01")).toBe(false);
  });

  it("open-ended recurring expenses (no duration) never trigger this per-cycle overdue check", () => {
    const openEnded = expense({ frequency: "monthly", amount: 1000, due_date: "2027-07-14", duration_months: null });
    expect(isExpenseOverdue(openEnded, [], "2027-08-01")).toBe(false);
  });

  it("one-time expenses still use a simple single due-date comparison", () => {
    const oneTime = expense({ frequency: "one_time", due_date: "2027-07-14" });
    expect(isExpenseOverdue(oneTime, [], "2027-07-13")).toBe(false);
    expect(isExpenseOverdue(oneTime, [], "2027-07-15")).toBe(true);
  });
});

describe("open-ended monthly cycle tracking (Company Payment Date, no due_date)", () => {
  const openEndedMonthly = expense({
    frequency: "monthly", amount: 1000, due_date: null, duration_months: null, payment_date: "2027-07-04",
  });

  it("counts no cycles before the payment date starts", () => {
    expect(expenseCyclesElapsedSince("2027-07-04", "2027-07-03")).toEqual({ periodsElapsed: 0, mostRecentDate: null });
  });

  it("counts the starting cycle itself once its date arrives", () => {
    expect(expenseCyclesElapsedSince("2027-07-04", "2027-07-04")).toEqual({ periodsElapsed: 1, mostRecentDate: "2027-07-04" });
  });

  it("recurs on the same day each month, forward, with no end", () => {
    expect(expenseCyclesElapsedSince("2027-07-04", "2027-09-04")).toEqual({ periodsElapsed: 3, mostRecentDate: "2027-09-04" });
    expect(expenseCyclesElapsedSince("2027-07-04", "2027-09-03")).toEqual({ periodsElapsed: 2, mostRecentDate: "2027-08-04" });
  });

  it("clamps to the shorter month's last day for a start date on the 29th-31st", () => {
    expect(expenseCyclesElapsedSince("2027-01-31", "2027-03-31")).toEqual({ periodsElapsed: 3, mostRecentDate: "2027-03-31" });
    expect(expenseCyclesElapsedSince("2027-01-31", "2027-02-28")).toEqual({ periodsElapsed: 2, mostRecentDate: "2027-02-28" });
  });

  it("flags overdue once cumulative payments fall behind the cycles elapsed since the payment date", () => {
    expect(isExpenseOverdue(openEndedMonthly, [], "2027-07-04")).toBe(true);
    expect(isExpenseOverdue(openEndedMonthly, [payment(1000)], "2027-07-04")).toBe(false);
    expect(isExpenseOverdue(openEndedMonthly, [payment(1000)], "2027-08-04")).toBe(true);
    expect(isExpenseOverdue(openEndedMonthly, [payment(1000), payment(1000)], "2027-08-04")).toBe(false);
  });

  it("is not overdue before the payment date's first cycle arrives", () => {
    expect(isExpenseOverdue(openEndedMonthly, [], "2027-07-03")).toBe(false);
  });

  it("only applies to monthly frequency, not daily or one-time, per confirmed scope", () => {
    expect(isExpenseOverdue({ ...openEndedMonthly, frequency: "daily" }, [], "2027-08-04")).toBe(false);
    expect(isExpenseOverdue({ ...openEndedMonthly, frequency: "one_time" }, [], "2027-08-04")).toBe(false);
  });

  it("marks a cycle date as due today, and non-cycle dates as not due today", () => {
    expect(isExpensePeriodDueToday("2027-07-04", "2027-08-04")).toBe(true);
    expect(isExpensePeriodDueToday("2027-07-04", "2027-08-05")).toBe(false);
  });

  it("uses the most recent elapsed cycle as the overdue reference date", () => {
    expect(expenseOverdueReferenceDate(openEndedMonthly, "2027-09-10")).toBe("2027-09-04");
    expect(expenseOverdueReferenceDate({ ...openEndedMonthly, payment_date: null }, "2027-09-10")).toBeNull();
  });
});

describe("validateExpensePayment", () => {
  it("rejects cancelled parents, non-positive amounts, future dates, and over-balance amounts", () => {
    expect(validateExpensePayment({ amount: 100, cancelled: true, remainingBalance: 100, paymentDate: "2026-06-01", today: "2026-06-02" })).toContain("Cancelled");
    expect(validateExpensePayment({ amount: 0, cancelled: false, remainingBalance: 100, paymentDate: "2026-06-01", today: "2026-06-02" })).toContain("greater than zero");
    expect(validateExpensePayment({ amount: 101, cancelled: false, remainingBalance: 100, paymentDate: "2026-06-01", today: "2026-06-02" })).toContain("exceeds");
    expect(validateExpensePayment({ amount: 50, cancelled: false, remainingBalance: 100, paymentDate: "2026-06-03", today: "2026-06-02" })).toContain("future");
  });

  it("allows unlimited amounts when there is no balance cap (open-ended recurring)", () => {
    expect(validateExpensePayment({ amount: 100000, cancelled: false, remainingBalance: null, paymentDate: "2026-06-01", today: "2026-06-02" })).toBeNull();
  });
});
