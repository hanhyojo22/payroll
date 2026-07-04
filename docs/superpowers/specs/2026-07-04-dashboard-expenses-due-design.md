# Dashboard: surface expense payment due dates

Date: 2026-07-04

## Problem

`Expense` records (src/types.ts) already carry a `due_date` and `status`
("pending"/"paid"), and the Expenses page already flags overdue rows. But
`loadDashboardSummary` (src/lib/supabaseData.ts) never queries expenses, so
due/overdue expenses never appear on the dashboard — only `payment_reminders`
("bills") and `collections` show up in the "Bills due" stat and "Needs
attention" list.

## Goal

Surface due-today and overdue expenses on the dashboard, using the same
pattern already used for payment reminders.

## Design

**Scope:** only expenses with a `due_date` set and `status !== "paid"` are
considered (matches the overdue-row logic already in `ExpensesFeature.tsx`).
Expenses without a due date (e.g. open-ended monthly recurring items with no
end date) are not dashboard candidates — there's no date to compare against.

**Types (`src/types.ts`):** `DashboardSummary` gains two fields, mirroring the
existing payment fields:
- `dueTodayExpenses: Expense[]`
- `overdueExpenses: Expense[]`

**Data loading (`src/lib/supabaseData.ts`, `loadDashboardSummary`):** add an
expenses query (reuse `loadExpenses`) alongside the existing
payments/collections queries in the `Promise.all`. Filter to
`status !== "paid" && due_date` truthy, then split by `due_date === today` vs
`due_date < today`, same as the existing payments split.

**Dashboard UI (`src/App.tsx`, `Dashboard` component):**
- "Bills due" pulse card: total and count include due-today + overdue
  expenses added to the existing payment-reminder totals (card label/copy
  unchanged — it already reads as a generic "money owed out" figure).
- "Needs attention" action list: expenses added as a third `kind: "expense"`
  alongside `"collection"` and `"bill"`, sorted into the same overdue/today
  buckets. Row label becomes "Expense" for these entries (via a small kind→
  label map instead of the current inline ternary).
- `emptyDashboardSummary` gets the two new empty arrays.

**Out of scope:** no new stat card, no changes to the Expenses page itself,
no changes to `payment_reminders` table/schema.

## Testing

No domain logic changes (only `src/domain/**` tests run in CI), so this is
verified manually: seed/observe an expense with a past or today `due_date`
and status `pending`, confirm it shows in the dashboard's "Bills due" total
and "Needs attention" list.
