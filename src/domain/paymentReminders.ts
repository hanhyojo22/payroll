import type { PaymentReminder, PaymentReminderPayment } from "../types";

export { paymentMethodLabel } from "./expenses";

export type PaymentReminderDisplayStatus = "pending" | "partial" | "paid" | "overdue";

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
  today = new Date().toISOString().slice(0, 10),
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
