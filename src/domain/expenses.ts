import type { CollectionPaymentMethod, Expense, ExpenseDisplayStatus, ExpenseFrequency, ExpenseInstallmentPayment } from "../types";

export const expensePaymentsTotal = (payments: ExpenseInstallmentPayment[] | null | undefined) =>
  (payments ?? []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

export function expenseTotalAmount(
  expense: Pick<Expense, "amount" | "frequency" | "duration_months">,
): number | null {
  if (expense.frequency === "one_time") return Number(expense.amount);
  if (expense.duration_months == null) return null;
  return Number(expense.amount) * expense.duration_months;
}

export function expenseRemainingBalance(
  expense: Pick<Expense, "amount" | "frequency" | "duration_months">,
  payments: ExpenseInstallmentPayment[] | null | undefined,
): number | null {
  const total = expenseTotalAmount(expense);
  if (total == null) return null;
  return Math.max(0, total - expensePaymentsTotal(payments));
}

export function expenseDisplayStatus(
  expense: Pick<Expense, "amount" | "frequency" | "duration_months" | "status">,
  payments: ExpenseInstallmentPayment[] | null | undefined,
): ExpenseDisplayStatus {
  if (expense.status === "cancelled") return "cancelled";
  const total = expenseTotalAmount(expense);
  const paid = expensePaymentsTotal(payments);
  if (total == null) {
    return expense.status === "paid" ? "paid" : paid > 0 ? "partial" : "unpaid";
  }
  if (total > 0 && paid >= total) return "paid";
  return paid > 0 ? "partial" : "unpaid";
}

export function nextExpenseCompletionState(
  expense: Pick<Expense, "amount" | "frequency" | "duration_months">,
  payments: ExpenseInstallmentPayment[] | null | undefined,
  today: string,
): { status: "pending" | "paid"; paid_date: string | null } {
  const total = expenseTotalAmount(expense);
  const paid = expensePaymentsTotal(payments);
  const complete = total != null && total > 0 && paid >= total;
  return complete ? { status: "paid", paid_date: today } : { status: "pending", paid_date: null };
}

export function validateExpensePayment({
  amount,
  cancelled,
  remainingBalance,
  paymentDate,
  today = new Date().toISOString().slice(0, 10),
}: {
  amount: number;
  cancelled: boolean;
  remainingBalance: number | null;
  paymentDate: string;
  today?: string;
}): string | null {
  if (cancelled) return "Cancelled expenses cannot accept payments.";
  if (!Number.isFinite(amount) || amount <= 0) return "Payment amount must be greater than zero.";
  if (remainingBalance != null && amount > remainingBalance) return "Payment exceeds the remaining balance.";
  if (!paymentDate || paymentDate > today) return "Payment date cannot be in the future.";
  return null;
}

export function paymentMethodLabel(method: CollectionPaymentMethod): string {
  return ({ bank_transfer: "Bank transfer", e_wallet: "E-wallet" } as Record<string, string>)[method]
    ?? method.charAt(0).toUpperCase() + method.slice(1);
}

// Calendar-month difference, ignoring day-of-month (the due date's day becomes the recurring due day).
export function monthsBetween(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
  return Math.max(1, months);
}

export function daysBetween(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  return Math.max(1, Math.round((end - start) / 86_400_000));
}

// Derives the recurring duration count (months for monthly, days for daily) from a start and end date.
export function expenseDurationCount(frequency: ExpenseFrequency, startDate: string, endDate: string): number {
  return frequency === "daily" ? daysBetween(startDate, endDate) : monthsBetween(startDate, endDate);
}

export function formatExpenseDuration(frequency: ExpenseFrequency, durationCount: number | null): string | null {
  if (!durationCount) return null;
  if (frequency === "daily") return `${durationCount} day${durationCount === 1 ? "" : "s"}`;
  if (durationCount % 12 === 0) {
    const years = durationCount / 12;
    return `${years} year${years === 1 ? "" : "s"}`;
  }
  return `${durationCount} month${durationCount === 1 ? "" : "s"}`;
}

// The schedule of per-cycle due dates for a recurring expense, one per period, ending on due_date
// (e.g. due_date 2027-07-14 with duration_months 6 => the 14th of each of the 6 months up to and including July 2027).
export function expensePeriodDueDates(
  expense: Pick<Expense, "frequency" | "due_date" | "duration_months">,
): string[] {
  if (expense.frequency === "one_time" || !expense.due_date || expense.duration_months == null) return [];
  const due = new Date(`${expense.due_date}T00:00:00Z`);
  const dueDay = due.getUTCDate();
  const dates: string[] = [];
  for (let periodsBack = 0; periodsBack < expense.duration_months; periodsBack++) {
    let periodDate: Date;
    if (expense.frequency === "monthly") {
      // Clamp to the target month's last day instead of letting setUTCMonth overflow
      // (e.g. due date on the 31st stepping back into a shorter month like February).
      const targetYear = due.getUTCFullYear();
      const targetMonth = due.getUTCMonth() - periodsBack;
      const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
      periodDate = new Date(Date.UTC(targetYear, targetMonth, Math.min(dueDay, lastDayOfTargetMonth)));
    } else {
      periodDate = new Date(due);
      periodDate.setUTCDate(periodDate.getUTCDate() - periodsBack);
    }
    dates.push(periodDate.toISOString().slice(0, 10));
  }
  return dates.sort();
}

// How many of a recurring expense's per-cycle due dates have arrived by today.
export function expensePeriodsDueByNow(
  expense: Pick<Expense, "frequency" | "due_date" | "duration_months">,
  today: string,
): number {
  return expensePeriodDueDates(expense).filter((dueDate) => dueDate <= today).length;
}

// For an open-ended monthly expense with no due_date (e.g. a Company expense whose Payment Date marks
// when the recurring charge starts, recurring on that same day-of-month indefinitely — clamped to the
// target month's last day), walks forward from startDate through today counting how many cycles have
// arrived, and the most recent such cycle's date (for "is this due today"/"how overdue" purposes).
export function expenseCyclesElapsedSince(
  startDate: string,
  today: string,
): { periodsElapsed: number; mostRecentDate: string | null } {
  if (today < startDate) return { periodsElapsed: 0, mostRecentDate: null };
  const start = new Date(`${startDate}T00:00:00Z`);
  const startDay = start.getUTCDate();
  let periodsElapsed = 0;
  let mostRecentDate: string | null = null;
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth();
  while (true) {
    const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const cycleDate = new Date(Date.UTC(year, month, Math.min(startDay, lastDayOfMonth))).toISOString().slice(0, 10);
    if (cycleDate > today) break;
    periodsElapsed++;
    mostRecentDate = cycleDate;
    month++;
    if (month > 11) { month = 0; year++; }
  }
  return { periodsElapsed, mostRecentDate };
}

// A one-time expense is overdue once its single due date passes unpaid. A recurring (monthly/daily)
// expense with a set end date (due_date) is overdue once cumulative payments fall behind what should
// have been paid by now, based on how many of its per-cycle due dates have already arrived. An
// open-ended monthly expense with no due_date but a Payment Date (its recurring start date) is
// overdue the same way, using cycles counted forward from that Payment Date instead.
export function isExpenseOverdue(
  expense: Pick<Expense, "amount" | "frequency" | "expense_date" | "due_date" | "duration_months" | "status" | "payment_date">,
  payments: ExpenseInstallmentPayment[] | null | undefined,
  today: string,
): boolean {
  if (expense.status === "paid" || expense.status === "cancelled") return false;
  const periodsDue = expenseOverdueCyclesDue(expense, today);
  if (periodsDue <= 0) return false;
  if (expense.due_date && expense.frequency === "one_time") return expense.due_date < today;
  const expectedPaidByNow = periodsDue * Number(expense.amount);
  return expensePaymentsTotal(payments) < expectedPaidByNow;
}

function expenseOverdueCyclesDue(
  expense: Pick<Expense, "frequency" | "due_date" | "duration_months" | "payment_date">,
  today: string,
): number {
  if (expense.due_date) {
    if (expense.frequency === "one_time") return 1;
    if (expense.duration_months == null) return 0;
    return expensePeriodsDueByNow(expense, today);
  }
  if (expense.frequency === "monthly" && expense.payment_date) {
    return expenseCyclesElapsedSince(expense.payment_date, today).periodsElapsed;
  }
  return 0;
}

// The date to treat as "the reference point" for how overdue an expense is: its due_date for
// due-date-driven (Personal) expenses, or the most recent arrived cycle for an open-ended,
// Payment-Date-anchored (Company monthly) expense. Null when neither applies.
export function expenseOverdueReferenceDate(
  expense: Pick<Expense, "due_date" | "payment_date" | "frequency">,
  today: string,
): string | null {
  if (expense.due_date) return expense.due_date;
  if (expense.frequency === "monthly" && expense.payment_date) {
    return expenseCyclesElapsedSince(expense.payment_date, today).mostRecentDate;
  }
  return null;
}

// Whether an open-ended, Payment-Date-anchored (Company monthly) expense has a recurring cycle
// landing exactly on today.
export function isExpensePeriodDueToday(startDate: string, today: string): boolean {
  return expenseCyclesElapsedSince(startDate, today).mostRecentDate === today;
}
