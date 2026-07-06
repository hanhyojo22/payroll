# Subcontractor Payout — Record Payment

## Context

In Subcontractor Profile → Payouts, the only action on a pending payout is "Mark paid" — a confirm dialog that flips `payment_reminders.status` to `paid` with no record of when, how, or how much was actually paid. Expenses already solved this problem with a "Record Payment" flow that captures payment date, method, reference number, and notes, and supports paying a balance off across multiple partial payments. This spec ports that same pattern to subcontractor payouts.

Scope: this only touches the Payouts tab in `SubcontractorsFeature.tsx`. Loan/bill payment reminders share the same `payment_reminders` table but have no "mark paid" UI anywhere in the app today, so they are unaffected.

## Data Model

### `payment_reminder_payments` table (new)

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | |
| user_id | uuid FK → auth.users | Owner |
| payment_reminder_id | uuid FK → payment_reminders, on delete cascade | Which payout |
| amount | numeric(12,2), > 0 | This installment's amount |
| payment_date | date, default current_date | When this installment was paid |
| payment_method | text, default 'other' | One of `cash`, `bank_transfer`, `check`, `e_wallet`, `card`, `other` |
| reference_number | text, default '' | |
| notes | text, default '' | |
| created_at | timestamptz | |

RLS: `auth.uid() = user_id`, same pattern as every other table. Index on `(payment_reminder_id, payment_date desc)`.

This table is generic to any `payment_reminders` row (loan/bill/subcontractor) — only the Payouts tab writes to it for now, but it's not subcontractor-specific by name, so loan/bill reminders could reuse it later without a schema change.

`payment_reminders.status` is **unchanged** (`pending` / `paid` / `overdue`, DB-level). A payout flips to `paid` only once its payments sum to the full `amount`. No new DB status value is introduced.

## TypeScript Types

```ts
export type PaymentReminderPayment = {
  id: string;
  user_id: string;
  payment_reminder_id: string;
  amount: number;
  payment_date: string;
  payment_method: CollectionPaymentMethod;
  reference_number: string;
  notes: string;
  created_at: string;
};
```

`PaymentReminder` gains a required field: `payments: PaymentReminderPayment[]` (fetched via nested select, same as `Expense.installment_payments`).

## Domain Logic (`src/domain/paymentReminders.ts`, new file)

Pure functions, no Supabase dependency, mirroring `src/domain/expenses.ts`:

- `paymentReminderPaymentsTotal(payments)` — sum of amounts.
- `paymentReminderRemainingBalance(reminder, payments)` — `max(0, reminder.amount - paymentsTotal)`.
- `paymentReminderDisplayStatus(reminder, payments)` — `"pending" | "partial" | "paid" | "overdue"`. This is **UI-only**; it never gets written to the DB. Logic: if `reminder.status === "overdue"` return `"overdue"` (preserved for type completeness, not currently reachable for payouts); else `"paid"` if `reminder.status === "paid"` or payments cover the full amount; else `"partial"` if any payments exist; else `"pending"`.
- `nextPaymentReminderCompletionState(reminder, payments)` — `{ status: "pending" | "paid" }`, used to decide whether recording/deleting a payment should flip the reminder's DB status.
- `validatePaymentReminderPayment({ amount, remainingBalance, paymentDate, today })` — amount > 0, amount ≤ remainingBalance, paymentDate not in the future.
- Re-exports `paymentMethodLabel` from `domain/expenses.ts` rather than duplicating it.

Unlike expenses, a payout has no duration/recurrence — `reminder.amount` is already the one fixed total for that billing period, so there's no equivalent of `expenseTotalAmount`.

### `buildSubcontractorAccountSummary` changes (`src/domain/billing.ts`)

- `netPending`: sums *remaining balance* (via `paymentReminderRemainingBalance`) across payouts whose display status isn't `"paid"`, instead of summing the full `amount` of `"pending"`-status payouts. This correctly reflects partial payments already made.
- `paidThisMonth`: sums individual payment amounts (flattened from each payout's nested `payments`) whose `payment_date` falls in the current month — instead of only counting payouts whose reminder fully flipped to `"paid"` this month. A partial payment made this month now counts as money received this month.
- `lastPayoutStatus`: uses `paymentReminderDisplayStatus` on the latest payout instead of the raw DB `status`, so it can report `"partial"`.

Existing tests in `billing.test.ts` are updated by adding `payments: []` (or a fixture payment matching prior `updated_at`-based assumptions) to each `PaymentReminder` fixture, preserving the existing expected totals.

## Repository (`src/features/billing/billingRepository.ts`)

Remove `markSubconPaymentReminderPaid` (superseded). Add:

```ts
export async function recordPaymentReminderPayment(
  supabase: SupabaseClient,
  userId: string,
  paymentReminderId: string,
  payload: { amount: number; payment_date: string; payment_method: CollectionPaymentMethod; reference_number: string; notes: string },
): Promise<{ data: PaymentReminderPayment | null; error: unknown }>;

export async function deletePaymentReminderPayment(supabase: SupabaseClient, paymentId: string);

export async function updatePaymentReminderCompletion(
  supabase: SupabaseClient,
  paymentReminderId: string,
  status: "pending" | "paid",
);
```

`loadPayments` (`src/lib/supabaseData.ts`) select gains the nested `payments:payment_reminder_payments(id,user_id,payment_reminder_id,amount,payment_date,payment_method,reference_number,notes,created_at)`. The dashboard's "Open payment reminders" query gets the same nested select for type consistency (it doesn't render payment history, so this is a no-op for that view's behavior).

## Offline Support

New composite mutation `payment_reminder_payment_group` in `offlineSync.ts`, mirroring `expense_payment_group`:

```ts
case "payment_reminder_payment_group": {
  const payload = mutation.payload as {
    paymentPayload: Record<string, unknown>;
    reminderUpdate: { id: string; payload: Record<string, unknown> } | null;
  };
  const paymentResult = await supabase.from("payment_reminder_payments").insert(payload.paymentPayload);
  if (paymentResult.error) return paymentResult;
  if (payload.reminderUpdate) {
    const reminderResult = await supabase.from("payment_reminders").update(payload.reminderUpdate.payload).eq("id", payload.reminderUpdate.id);
    if (reminderResult.error) return reminderResult;
  }
  return { error: null };
}
```

`reminderUpdate` is `null` when the payment doesn't complete the payout (no DB status change needed) — unlike the expense equivalent, which always updates because expense completion also needs to persist `paid_date`.

`PendingMutationOperation` (`src/lib/offlineDb.ts`) gains `"payment_reminder_payment_group"`. Deleting a payment while offline reuses the existing generic `"delete"` operation against the `payment_reminder_payments` table, plus a separate queued `"update"` on `payment_reminders` if deleting the payment un-completes it (same two-step pattern as `handleDeleteInstallmentPayment`).

## UI (`src/features/subcontractors/SubcontractorsFeature.tsx`)

### Payouts table

Adds `Paid` and `Remaining` columns (matching the Expenses table). The `Action` column's single "Mark paid" button is replaced with two icon buttons (matching Expenses' row actions):

- **View details** (`Eye` icon, always shown) → opens `PayoutDetailsModal`.
- **Record payment** (`CheckCircle2` icon, hidden once display status is `"paid"`) → opens `PayoutPaymentForm` directly for that payout.

### `PayoutPaymentForm` (new component)

Same fields as Expenses' `InstallmentPaymentForm`: Amount (`MoneyField`, defaults to remaining balance), Payment date (date input, max = today), Payment method (select: Cash/Bank transfer/Check/E-wallet/Card/Other), Reference number, Notes. Submits to a new `handleRecordPayoutPayment(payment, values)` handler:

1. Validate via `validatePaymentReminderPayment`.
2. Insert the payment (online: `recordPaymentReminderPayment`; offline: queue `payment_reminder_payment_group`).
3. If `nextPaymentReminderCompletionState` says the payout is now complete, also update the reminder's status to `"paid"` (bundled into the same composite mutation when offline).

### `PayoutDetailsModal` (new component)

Same structure as `ExpenseDetailsModal`: summary cards (Net amount / Paid so far / Remaining), a detail card (period, due date, status badge, notes), and a payment history table (Date, Amount, Method, Reference, Delete). Includes its own "Record Payment" button in the section heading when not fully paid. Deleting a payment calls `handleDeletePayoutPayment`, which reverts the reminder to `"pending"` if that payment had completed it.

No new CSS — reuses existing shared classes (`expense-details-modal`, `expense-summary-card`, `expense-detail-card`, `expense-ledger`, `billing-row-actions`, `billing-form-modal`, `billing-table`), which are global and already shared across features.

### Header button

"Mark latest payout paid" becomes **"Record payout payment"**. Same targeting logic (latest payout for this subcontractor, sorted by billing period, currently non-`"paid"`), but opens `PayoutPaymentForm` pre-filled with that payout's remaining balance instead of a confirm dialog. Disabled under the same condition as today (`netPending <= 0`).

`markPaymentPaid` / `markLatestPendingPaid` and their props (`onMarkPaymentPaid`, `onMarkLatestPendingPaid`) are removed and replaced by the new payment-recording handlers, kept local to `SubcontractorsFeature.tsx` (no new props needed beyond what's already passed in).

## Testing

- `src/domain/paymentReminders.test.ts` (new): unit tests for `paymentReminderPaymentsTotal`, `paymentReminderRemainingBalance`, `paymentReminderDisplayStatus` (pending/partial/paid transitions), `nextPaymentReminderCompletionState`, `validatePaymentReminderPayment` (amount ≤ 0, exceeds remaining, future date).
- `src/domain/billing.test.ts`: update `PaymentReminder` fixtures with `payments: []` / matching payment records; add a case with a partial payment to confirm `netPending` and `paidThisMonth` reflect the remaining balance and the in-month payment correctly.
