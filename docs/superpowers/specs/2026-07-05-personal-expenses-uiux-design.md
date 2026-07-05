# Personal Expenses UI/UX redesign

Date: 2026-07-05

## Problem

The Personal Expenses page (`src/features/expenses/ExpensesFeature.tsx`,
rendered when `categoryScope === "personal"`) is visually and structurally
the same component as the Company Expenses page — same dense billing-style
table, same 4-card KPI row, same modal (`ExpenseFormModal`, reusing the
`billing-form-modal` CSS class), same field labels written for the company
use case (e.g. "Name" with placeholder "Who is this expense for?", a
leftover from the employee-picker field it shares code with). It reads as a
reused business ledger rather than a purpose-built personal expense
tracker.

## Scope

This redesign only affects rendering paths gated by `categoryScope ===
"personal"`. Company Expenses (`categoryScope === "company"`) keeps its
current table/KPI/modal layout and blue accent, completely unchanged. Where
a component is currently shared unconditionally between both scopes (e.g.
`ExpenseFormModal`), it gains a `categoryScope === "personal"` branch
rather than being duplicated or having its company behavior altered.

No changes to `src/domain/expenses.ts` (calculation logic) or the
`expenseRepository.ts` data layer — this is a rendering/UX change only.

## Design

### 1. KPI row (personal scope only)

Replace the current 4 cards (Total Expenses / Outstanding / Paid This
Month / Overdue) with 3, reusing the existing `expenseKpis` calculation
inputs already computed in the component (`kpis.totalExpensesAmount`,
`kpis.outstanding`, `kpis.paidThisMonth`, `kpis.overdueTotal`,
`kpis.overdueCount` — no new domain calculation needed):

- **This Month's Spending** — reuse `kpis.paidThisMonth`
- **Upcoming** — reuse `kpis.outstanding` (renamed label; same number)
- **Overdue** — reuse `kpis.overdueTotal` / `kpis.overdueCount` (unchanged)

"Total Expenses" is dropped for personal scope (kept for company scope,
which retains all 4 cards).

### 2. Card list instead of table (personal scope only)

When `categoryScope === "personal"`, render a new list of cards
(`.personal-expense-card`) instead of `<table className="billing-table">`.
One card per expense, replacing the current 10-column row with:

- Left: a generic `Receipt` icon (no per-category icon mapping exists in
  the codebase today, and inventing one is out of scope) + the expense's
  `employee_name` field (renamed "description" conceptually, see form
  changes below) as the card's title + `category_name` as a subtitle.
- Middle: amount, with the existing `expense-installment-progress` note
  ("N of M paid") shown inline under the amount when applicable — same data
  as today's `<td className="num">` cell, just restyled.
- Right: `due_date` (reusing the existing `expense-overdue` class when
  overdue) + the existing `<StatusBadge status={displayStatus} />`.
- Actions row: the same 5 conditional action buttons that exist today
  (View, Record payment, End expense, Edit, Cancel, Delete), same
  `disabled`/`title` logic (locked when `hasPayments`), just laid out
  horizontally at the bottom or side of the card instead of a table's
  `<td className="billing-row-actions">`.

Company scope keeps the existing `<table>` entirely as-is (same JSX,
untouched).

### 3. Add/Edit form changes (`ExpenseFormModal`, personal branch only)

- Relabel the "Name" field to **"What's this for?"** when
  `categoryScope === "personal"` (placeholder becomes something like
  "e.g. Netflix subscription"). Company scope's employee-picker field and
  label are unchanged.
- Default-visible fields for personal scope: What's this for?, Category,
  Amount, Date, Frequency. **Due date** and **Notes** move behind a
  collapsed section, toggled by a plain "More options" button using local
  `useState<boolean>` state (matching the toggle pattern already used
  elsewhere in this codebase, e.g. calendar popovers — not a native
  `<details>` element, to keep styling consistent with the rest of the
  form). The
  existing due-date recurrence hint text stays with the field, inside the
  expanded section. Company scope's form is unaffected — it keeps showing
  Payment date inline as it does today (company's field set is smaller
  already and wasn't identified as a pain point).
- The modal itself gets a dedicated class for personal scope,
  `personal-expense-modal`, added alongside (not replacing) the existing
  `modal billing-form-modal` classes, so personal-specific CSS overrides
  (spacing, the "More options" toggle, warm accent touches) can target it
  without touching company's styling. Company scope keeps using
  `modal billing-form-modal` alone, unchanged.

### 4. Visual identity (personal scope only)

Personal-scope elements (KPI card icons/accents, the card list's category
icons, the "Add expense" button, the "More options" toggle) use the
existing `--color-warning` (orange) and `--color-warning-bg`/
`--color-warning-text` tokens already defined in `src/styles.css`, instead
of `--color-accent` (blue). No new CSS custom properties are introduced.
Company scope keeps `--color-accent` throughout, unchanged.

## Out of scope

- No changes to the status filter chips, search toolbar, or empty-state
  message — these already read fine and aren't part of the "feels reused"
  complaint.
- No changes to `ExpenseDetailsModal`, `InstallmentPaymentForm`, or
  `ExpenseCategoriesManager` — not mentioned as pain points.
- No changes to Company Expenses in any respect.
- No new domain/calculation logic — purely a rendering/layout/styling
  change reusing existing computed values.

## Testing

Per this project's conventions (`CLAUDE.md`), only `src/domain/**/*.test.ts`
is unit-tested; this is a pure UI/rendering change with no new domain logic,
so it has no new automated tests. Verification is `npx tsc --noEmit`,
`npm test` (confirms the existing 76 domain tests are unaffected), and
manual verification in the browser (per this project's established pattern
for UI changes) — comparing Personal Expenses' new card list/KPI/form
against Company Expenses' unchanged table/KPI/form to confirm the two
scopes render independently and neither broke the other.
