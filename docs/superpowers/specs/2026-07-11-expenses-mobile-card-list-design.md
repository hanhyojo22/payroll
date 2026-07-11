# Expenses Mobile Card List

## Context

`ExpensesFeature.tsx` (`src/features/expenses/ExpensesFeature.tsx`) renders a plain HTML `<table className="billing-table">` for the expense list, used for both the Company and Personal expense views (`categoryScope`). Unlike the Billing and Collections tables, its `<td>` cells never set a `data-label` attribute, so the app's generic mobile rule (`@media (max-width: 640px)` in `styles.css`, which turns any `<table>` into stacked rows via `content: attr(data-label)`) currently renders blank field labels on phones — a real defect. Between 641–900px there's no stacking at all; the table just scrolls horizontally.

Following the recent Employees mobile card redesign (flat divider rows, no per-row card border/shadow), this spec replaces the mobile presentation of the expense table with a purpose-built card list, reviewed and approved via an interactive mockup: https://claude.ai/code/artifact/59418818-d03c-46ae-9d6b-5ec4f97d01f7

## Scope

**In scope:** the mobile (≤760px) presentation of the expense list inside `ExpensesFeature` — both `categoryScope="company"` and `categoryScope="personal"`.

**Out of scope:** the desktop table (unchanged), KPI cards (`.expense-kpi-row`, already responsive), status filter chips (already responsive), all modals (`ExpenseFormModal`, `InstallmentPaymentForm`, `ExpenseDetailsModal`, `ConfirmDeleteExpenseModal` — already single-column on mobile), pagination footer (unchanged, sits below the card list same as it does below the table today), `ExpenseCategoriesManager` (a different screen, not part of this list).

## Design

### Layout

A new `ExpenseMobileCardList` component renders at ≤760px in place of `.billing-table-wrap` (which is hidden via CSS at that breakpoint — same pattern as `EmployeeMobileCardList`/`.emp-mobile-list` vs `.table-wrap` in `App.tsx`). Rows are flat, full-bleed, separated by a `1px solid var(--color-border-light)` bottom divider (no per-row border/shadow/radius), matching the Employees card style. The desktop table keeps its current `data-label`-less markup unchanged — the mobile card list is an independent render path, not a CSS reflow of the same DOM, so the missing-`data-label` bug is moot once the table is hidden below 760px.

### Card content (per expense, left to right)

1. **Icon tile** — a small circular tile (36px) in the accent-tinted style already used for `.employee-list-avatar`, containing a `lucide-react` icon. Use `Receipt` for company expenses and `Tag` for personal expenses (reusing icons already imported in this file) — a fixed icon per `categoryScope`, not per-category (no per-category icon/color mapping exists today and inventing one is out of scope).
2. **Main column:**
   - First line: `expense.category_name` (bold) + a status pill immediately after it, using the same status vocabulary as `StatusBadge`/`expenseDisplayStatus` (`pending`/`unpaid` → warning tone, `partial` → partial tone, `paid` → success tone, `cancelled` → danger tone), rendered with the existing `.status` CSS classes (reuse, don't duplicate).
   - Second line: `expense.employee_name` (works for both scopes — for personal expenses this is the free-text name field), muted color, truncated with ellipsis on overflow.
   - Third line: date + recurrence info, muted/tertiary color:
     - Company scope: `Payment: {payment_date}` if set, else `Due: {expense_date}`.
     - Personal scope: `Due: {due_date}` if set, else `Logged {expense_date}`.
     - If `expense.frequency !== "one_time"` and `expense.duration_months != null`, append ` · {installment_payments.length} of {duration_months} paid`.
3. **Side column** (right-aligned): the remaining balance if not null (`expenseRemainingBalance`), else the total (`expenseTotalAmount`), else "Ongoing" — bold, primary figure, formatted with the existing `currency` formatter. Below it, a small secondary line: `of {totalAmount}` when the remaining balance differs from the total (partial payments), else the frequency label (`one-time` / `monthly` / `daily`).
4. **Kebab button** — a `MoreVertical` icon button, absolutely positioned top-right of the card. Opens a dropdown menu reusing the existing `.ticket-menu-wrap`/`.ticket-menu-dropdown` CSS classes and the `openMenuId` + `menuRef` + outside-click-close pattern already established in `App.tsx` (state added locally inside `ExpensesFeature`, keyed by `expense.id`). The kebab button's click handler calls `event.stopPropagation()` so it doesn't also trigger the card's tap-to-open-details handler.

### Kebab menu contents

Same conditions the desktop `.billing-row-actions` column already computes (`isSystemManaged`, `canRecordPayment`, `isOpenEndedRecurring`, `hasPayments`) — no new business logic, just re-rendered as menu items instead of icon buttons:

- **Record payment** — shown when `!isSystemManaged && canRecordPayment`.
- **End expense** — shown when `!isSystemManaged && canRecordPayment && isOpenEndedRecurring`.
- **Edit** — shown when `!isSystemManaged`; `disabled` when `hasPayments`, with the same title text used on desktop ("Locked — payments already recorded against this expense.").
- **Cancel expense** — shown when `!isSystemManaged && canRecordPayment`; `disabled` when `hasPayments`, same title text as desktop.
- **Delete** — shown when `!isSystemManaged`; `disabled` when `hasPayments`, same title text as desktop.

If none of the above apply (fully system-managed and not payable, e.g. a paid subcontractor payout), the kebab button still renders but its menu is empty except whichever items pass their condition — in the fully-empty case the kebab is omitted entirely (no point showing an empty menu).

### Interaction

Tapping the card body (anywhere except the kebab button) calls the same handler the desktop "view details" eye icon already calls — `setViewingExpense(expense)` — opening the existing `ExpenseDetailsModal`. No new modal.

### Empty state

Unchanged — `.billing-empty` (Receipt icon + "No expenses found") already renders above/instead of the table+card list when `recordCount === 0`, independent of which list presentation is active.

## Testing

Visual/interaction-only change; no domain logic touched, so no new `src/domain/**` tests apply (per CLAUDE.md, the test suite only covers domain calculation logic). Verify manually at ≤760px width in the browser: card content matches the table's data for both Company and Personal scopes, status pills match `expenseDisplayStatus`, kebab menu item visibility/disabled states match the desktop row actions for a system-managed expense, a with-payments expense, and an open-ended recurring expense, tapping the card opens `ExpenseDetailsModal`, and the desktop table view (>760px) is unchanged.
