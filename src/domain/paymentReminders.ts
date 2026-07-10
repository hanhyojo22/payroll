import type { Expense, PaymentReminder, PaymentReminderPayment } from "../types";
import { todayKey } from "../shared/utils/dates";

export { paymentMethodLabel } from "./expenses";

export type PaymentReminderDisplayStatus = "pending" | "partial" | "paid" | "overdue";
export const SUBCONTRACTOR_PAYOUT_EXPENSE_CATEGORY_NAME = "Subcontractor Payout";
const SUBCONTRACTOR_PAYOUT_TITLE_SUFFIX = /\s*\((?:1st|2nd)\s+payout\)\s*$/i;

export function normalizeSubcontractorPayoutTitle(title: string): string {
  return title.replace(SUBCONTRACTOR_PAYOUT_TITLE_SUFFIX, "").trim() || title;
}

export const paymentReminderPaymentsTotal = (payments: PaymentReminderPayment[] | null | undefined) =>
  (payments ?? []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

export function paymentReminderRemainingBalance(
  reminder: Pick<PaymentReminder, "amount">,
  payments: PaymentReminderPayment[] | null | undefined,
): number {
  return Math.max(0, Number(reminder.amount) - paymentReminderPaymentsTotal(payments));
}

export function paymentReminderDisplayStatus(
  reminder: Pick<PaymentReminder, "amount" | "status">,
  payments: PaymentReminderPayment[] | null | undefined,
): PaymentReminderDisplayStatus {
  if (reminder.status === "paid") return "paid";
  if (reminder.status === "overdue") return "overdue";
  const paid = paymentReminderPaymentsTotal(payments);
  if (Number(reminder.amount) > 0 && paid >= Number(reminder.amount)) return "paid";
  return paid > 0 ? "partial" : "pending";
}

export function nextPaymentReminderCompletionState(
  reminder: Pick<PaymentReminder, "amount">,
  payments: PaymentReminderPayment[] | null | undefined,
): { status: "pending" | "paid" } {
  const paid = paymentReminderPaymentsTotal(payments);
  return { status: Number(reminder.amount) > 0 && paid >= Number(reminder.amount) ? "paid" : "pending" };
}

export function validatePaymentReminderPayment({
  amount,
  remainingBalance,
  paymentDate,
  today = todayKey(),
}: {
  amount: number;
  remainingBalance: number;
  paymentDate: string;
  today?: string;
}): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return "Payment amount must be greater than zero.";
  if (amount > remainingBalance) return "Payment exceeds the remaining balance.";
  if (!paymentDate || paymentDate > today) return "Payment date cannot be in the future.";
  return null;
}

export function subcontractorPayoutExpensePayload(
  reminder: Pick<
    PaymentReminder,
    "id" | "user_id" | "title" | "amount" | "notes" | "created_at" | "due_date" | "status"
  >,
  payments: PaymentReminderPayment[] | null | undefined,
  categoryId: string,
): Omit<Expense, "installment_payments" | "created_at" | "updated_at"> {
  const displayStatus = paymentReminderDisplayStatus(reminder, payments);
  const paidDate = displayStatus === "paid"
    ? (payments ?? []).reduce<string | null>((latest, payment) =>
      !latest || payment.payment_date > latest ? payment.payment_date : latest, null)
    : null;
  const expenseName = normalizeSubcontractorPayoutTitle(reminder.title);

  return {
    id: reminder.id,
    user_id: reminder.user_id,
    employee_id: null,
    employee_name: expenseName,
    category_id: categoryId,
    category_name: SUBCONTRACTOR_PAYOUT_EXPENSE_CATEGORY_NAME,
    amount: Number(reminder.amount) || 0,
    frequency: "one_time",
    duration_months: null,
    status: displayStatus === "paid" ? "paid" : "pending",
    paid_date: paidDate,
    expense_date: reminder.created_at.slice(0, 10) || todayKey(),
    due_date: null,
    payment_date: reminder.due_date || null,
    notes: reminder.notes,
    payroll_run_id: null,
    subcontractor_payment_reminder_id: reminder.id,
  };
}
