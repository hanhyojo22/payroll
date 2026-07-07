# Payroll → Company Expenses Sync

## Context

Payroll and Company Expenses are today two fully independent features with no link between them (no FK, no shared code). Payroll cost only shows up in the Payroll view, Payroll History, and the dashboard's "Pending/Paid payroll" figures — it never counts toward Company Expenses totals ("This month's spending" etc.), even though payroll is one of the business's largest actual cash outflows.

Goal: every generated payroll run automatically appears as a single line item in Company Expenses, kept in sync with the run's real state, so company expense totals reflect true overall spend without any manual double-entry.

Must work offline, since payroll generation and per-item "mark paid" already work offline today.

## Data Model

### `expenses` table (altered)

| Column | Type | Description |
|--------|------|-------------|
| payroll_run_id | uuid, null, FK → payroll_runs(id) on delete cascade, unique | Set only for auto-generated payroll expense rows. Null for every normal, manually-created expense. |

Postgres unique constraints allow multiple NULLs, so this only enforces "at most one expense per payroll run" without affecting normal expenses.

**The linked expense's `id` is set equal to its `payroll_run_id` (i.e. `expenses.id = payroll_runs.id` for these rows).** Expenses and payroll runs are separate tables/PK spaces, so there's no collision risk. This means "does a linked expense already exist for this run?" never needs a lookup — every sync step is just one `upsert` by that id, whether executed online or replayed later from the offline mutation queue.

### `expense_categories` table (no schema change)

A company-type category named `"Payroll"` is found-or-created lazily (see below) using the existing category shape — no new columns needed.

## TypeScript Types

`src/types.ts`:

```ts
export type Expense = {
  // ...existing fields
  payroll_run_id: string | null;
};
```

`ExpenseFormValues` is **not** changed — `payroll_run_id` is never surfaced in the manual create/edit expense form; it only ever gets set by the payroll sync path.

## Domain Logic (`src/domain/payroll.ts`, additions)

One new pure function, no Supabase dependency:

```ts
function payrollExpensePayload(
  run: Pick<PayrollRun, "id" | "period_month" | "period_year" | "pay_period" | "generated_date">,
  items: Pick<PayrollRunItem, "net_pay" | "status" | "paid_date">[],
  categoryId: string,
  userId: string,
): Omit<Expense, "installment_payments">
```

Computes:
- `amount` = sum of `net_pay` across `items`
- `status`: `"paid"` if `items.length > 0` and every item's `status === "paid"`, else `"pending"`
- `paid_date`: latest non-null `paid_date` among items when fully paid, else `null`
- `id` = `run.id`, `payroll_run_id` = `run.id`
- `category_id`/`category_name` = the resolved "Payroll" category
- `expense_date` = `run.generated_date`
- `frequency: "one_time"`, `duration_months: null`, `employee_id: null`
- `notes`: `"Auto-generated from payroll run"`
- `employee_name` = the period label, e.g. `"July 2026 – 1st Cutoff"`, built from `period_month`/`period_year`/`pay_period` the same way `payPeriodLabel`/`monthNames` are used elsewhere
- `user_id` = `userId`; `due_date` and `payment_date` = `null` (unused by one-time company expenses today, per existing `ExpensesFeature` behavior)

Note on `employee_name`: for company-scope expenses the Expenses table renders `employee_name` as the row's prominent identity (with an avatar built from its initials), while `category_name` is a separate column and `notes` only appears in the expanded detail view. Since `category_name` will be the same fixed `"Payroll"` string for every one of these rows, `employee_name` is the field that actually needs to carry the distinguishing per-run label so each payroll row reads as e.g. "Payroll · July 2026 – 1st Cutoff" in the list, matching the earlier approved mockup. The initials-avatar will render from this string (e.g. "J2" from "July 2026...") rather than a person's initials — a minor cosmetic quirk, acceptable since these rows are visually distinct anyway (no edit/delete/record-payment actions).

Unit tests in `src/domain/payroll.test.ts`:
- amount sums `net_pay` correctly across multiple items
- status is `"pending"` when any item is unpaid, `"paid"` only when all are paid
- zero-items case (defensive — shouldn't occur in practice) doesn't throw and reports `"pending"`, amount `0`
- `paid_date` picks the latest of the items' paid dates

## Category Find-or-Create

New repository function in `src/features/payroll/payrollRepository.ts`, mirroring the existing `ensurePayrollSettings`/`ensureBillingSettings` pattern:

```ts
async function ensurePayrollExpenseCategory(supabase, userId): Promise<ExpenseCategory>
```

Looks for an existing company-type category named `"Payroll"` for the user; creates it if missing. Called once, eagerly, via a `useEffect` in `PayrollFeature` (same shape as the existing `ensurePayrollSettings` effect), with the resolved category id kept in local component state for reuse by every sync call site below.

`viewResources.payroll` and `viewResources["payroll-history"]` (`App.tsx`) gain `"expenses"` and `"expenseCategories"` so both are loaded/cached whenever Payroll is visited. Because resource loading hydrates from the IndexedDB cache first (existing two-phase pattern), the category id is available even when the Payroll view is opened while offline, as long as it was loaded at least once before while online.

**Edge case:** if the app is used fully offline before the "Payroll" category has ever been created/cached (i.e. never opened Payroll or Expenses online, ever), there is nothing to link to yet. In that rare case, payroll generation proceeds normally and the expense-sync step is silently skipped; it resolves itself next time the category loads online. Payroll itself is never blocked by this.

## Sync Call Sites (`src/features/payroll/PayrollFeature.tsx`)

After each of the following succeeds, compute `payrollExpensePayload(...)` from current local state and upsert it into `expenses`:

1. **`createRun`** — both the online success path and the offline-queued path. The offline payload (`itemPayloads`) already carries `net_pay` per item and the run's period fields, so the total is computable client-side with no round trip.
2. **`addMissingEmployees`** — recomputes the total after new items are appended to an existing run.
3. **`updateItem`** (and the `handleMarkPaid`/`handleMarkPending` callers that go through it) — whenever a change affects `net_pay` or `status`.
4. **`applyMissingPayrollDeductions`** — after bulk advance-deduction updates.
5. **`markAllPaid`** — already online-only today (it explicitly refuses to run offline), so only an online sync branch is needed here.

Online: a direct Supabase `upsert` on `expenses`.
Offline: `onQueueOfflineMutation({ resource: "expenses", operation: "upsert", table: "expenses", recordId: expense.id, affectedResources: ["expenses", "dashboardSummary"], payload: expense })` — this is the exact same `upsert`-by-`recordId` pattern `ExpensesFeature` already uses for offline expense edits, so no changes to `offlineDb.ts` or `offlineSync.ts` are needed.

**Error handling:** if the payroll write itself succeeds but the expense-sync upsert fails, the payroll action is **not** rolled back — payroll is the source of truth. Show a soft warning ("Payroll saved, but couldn't sync it to Company Expenses.") rather than blocking the user.

**Deletion:** there is no "delete payroll run" feature in the app today, so no application code is needed for it. If one is added later, the `on delete cascade` FK already removes the linked expense automatically for free.

## Expenses UI Treatment (`src/features/expenses/ExpensesFeature.tsx`)

- Auto-synced rows render like any normal company expense (and count toward existing KPI totals: This Month's Spending, etc.) — Category column shows "Payroll", Employee column shows the period label (e.g. "July 2026 – 1st Cutoff").
- For any expense with `payroll_run_id !== null`: hide the **Edit**, **Delete**, and **Record Payment** row actions. These rows are system-managed and only ever change via the Payroll feature, so there's no path for a manual edit to desync them from the real payroll state.

## Testing

- Domain-level unit tests for `payrollExpensePayload` in `src/domain/payroll.test.ts` (see above).
- No new UI/e2e tests — this repo's test suite only covers `src/domain/**/*.test.ts` (per `vitest.config.ts`); UI behavior is verified manually.

## Out of Scope

- Backfilling expense entries for payroll runs generated before this feature ships (going-forward only, by explicit choice).
- Gross-pay based tracking (net pay only, matching what the dashboard already treats as the real cash outflow).
- Any click-through/deep-link from the Expenses row back to the originating payroll run (could be a later enhancement).
- Payroll run deletion (feature doesn't exist yet).
