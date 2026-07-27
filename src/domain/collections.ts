import type { CollectionPayment, CollectionReminder, CollectionStatus } from "../types";
import { todayKey } from "../shared/utils/dates";

export type CollectionAgingBucket = "current" | "days1To30" | "days31To60" | "days61To90" | "daysOver90";

// Every amount here is PHP denominated in centavos, so sums of instalments carry binary
// float residue (333.33 + 333.33 + 333.44 vs 1000.10 is off by ~1.1e-13). Rounding to
// centavos keeps a fully settled receivable at exactly 0 instead of leaving it in the
// open/overdue pile forever, and keeps a real shortfall reporting a clean 0.01.
const roundCentavos = (value: number) => Math.round(value * 100) / 100;

export const collectionPaymentsTotal = (payments: CollectionPayment[] | null | undefined) =>
  roundCentavos(
    (payments ?? [])
      .filter((payment) => !payment.is_void)
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
  );

export const collectionBalance = (
  amount: number | string | null | undefined,
  payments: CollectionPayment[] | null | undefined,
) => Math.max(0, roundCentavos(Number(amount ?? 0) - collectionPaymentsTotal(payments)));

export function collectionStatus(
  collection: Pick<CollectionReminder, "amount" | "due_date" | "archived_at" | "payments">,
  today = todayKey(),
): CollectionStatus {
  if (collection.archived_at) return "archived";
  const paid = collectionPaymentsTotal(collection.payments);
  const balance = collectionBalance(collection.amount, collection.payments);
  if (balance === 0 && Number(collection.amount) > 0) return "collected";
  if (collection.due_date < today) return "overdue";
  return paid > 0 ? "partial" : "pending";
}

export function dateCollectedFor(
  collection: Pick<CollectionReminder, "amount" | "due_date" | "archived_at" | "payments">,
  today?: string,
): string | null {
  if (collectionStatus(collection, today) !== "collected") return null;
  const nonVoidPayments = (collection.payments ?? []).filter((payment) => !payment.is_void);
  if (nonVoidPayments.length === 0) return null;
  return nonVoidPayments.reduce(
    (latest, payment) => (payment.payment_date > latest ? payment.payment_date : latest),
    nonVoidPayments[0].payment_date,
  );
}

export function daysOverdue(dueDate: string, today = todayKey()) {
  if (!dueDate || dueDate >= today) return 0;
  const due = Date.parse(`${dueDate}T00:00:00Z`);
  const current = Date.parse(`${today}T00:00:00Z`);
  return Math.max(0, Math.floor((current - due) / 86_400_000));
}

export function collectionAgingBucket(dueDate: string, today?: string): CollectionAgingBucket {
  const days = daysOverdue(dueDate, today);
  if (days === 0) return "current";
  if (days <= 30) return "days1To30";
  if (days <= 60) return "days31To60";
  if (days <= 90) return "days61To90";
  return "daysOver90";
}

export function validateCollectionPayment({
  amount,
  archived,
  balance,
  paymentDate,
  today = todayKey(),
}: {
  amount: number;
  archived: boolean;
  balance: number;
  paymentDate: string;
  today?: string;
}) {
  if (archived) return "Archived receivables cannot accept payments.";
  if (!Number.isFinite(amount) || amount <= 0) return "Payment amount must be greater than zero.";
  if (amount > balance) return "Payment exceeds the outstanding balance.";
  if (!paymentDate || paymentDate > today) return "Payment date cannot be in the future.";
  return null;
}

export function withCollectionTotals(collection: CollectionReminder): CollectionReminder {
  const amountPaid = collectionPaymentsTotal(collection.payments);
  return {
    ...collection,
    amount_paid: amountPaid,
    outstanding_balance: collectionBalance(collection.amount, collection.payments),
    status: collectionStatus(collection),
  };
}
