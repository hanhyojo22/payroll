# Expenses Mobile Card List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mobile (≤760px) presentation of the Expenses list table with a purpose-built card list (`ExpenseMobileCardList`), matching the interactive mockup approved at https://claude.ai/code/artifact/59418818-d03c-46ae-9d6b-5ec4f97d01f7 and the spec at `docs/superpowers/specs/2026-07-11-expenses-mobile-card-list-design.md`.

**Architecture:** One new component (`ExpenseMobileCardList`) added to `src/features/expenses/ExpensesFeature.tsx`, rendered as a sibling to the existing `.billing-table-wrap` inside `ExpensesFeature`. New CSS in `src/styles.css` hides the table and shows the card list at ≤760px, scoped narrowly (via a new `expense-list-table-wrap` class added only to the Expenses list's table wrapper, not the shared `.billing-table-wrap` used by Billing/Subcontractors/the expense details modal) so no other feature's mobile layout is affected.

**Tech Stack:** React + TypeScript, plain CSS, existing `lucide-react` icons (`Receipt`, `Tag`, `MoreVertical`, `CheckCircle2`, `Square`, `Pencil`, `Ban`, `Trash2` — only `MoreVertical` needs a new import), existing `StatusBadge` component, existing domain helpers from `src/domain/expenses.ts` (already imported in this file).

## Global Constraints

- Scope is the Expenses list's mobile presentation only (≤760px), for both `categoryScope="company"` and `"personal"`. Do not touch: the desktop table, KPI cards, status filter chips, any modal, the pagination footer, `ExpenseCategoriesManager`, or the payment-ledger table inside `ExpenseDetailsModal` (a different `.billing-table-wrap` at `ExpensesFeature.tsx:1103` — leave it alone).
- Do not modify the shared `.billing-table-wrap` CSS rule (used by Billing and Subcontractors) — scope the hide-on-mobile rule to a new class added only to the Expenses list table wrapper.
- Kebab menu item visibility/disabled state must exactly match the existing desktop `.billing-row-actions` logic in the same file (`ExpensesFeature.tsx:627-672`) — same conditions (`isSystemManaged`, `canRecordPayment`, `isOpenEndedRecurring`, `hasPayments`), same handlers, same disabled-tooltip text. Do not invent new business rules.
- No unit tests apply — per CLAUDE.md, `src/domain/**/*.test.ts` is the only tested surface, and this change touches no domain logic. Verification is manual, in-browser.
- Follow the spec at `docs/superpowers/specs/2026-07-11-expenses-mobile-card-list-design.md`.

---

### Task 1: Add `.expense-mobile-*` CSS

**Files:**
- Modify: `src/styles.css` (insert a new block; suggested location is right after the `.expense-status-filter`/`.expense-status-chip` rules, e.g. after line 8176 as read at plan-writing time — search for `.expense-status-chip.active` to find the current insertion point, since exact line numbers may have shifted)

**Interfaces:**
- Produces CSS classes consumed by Task 2's JSX: `.expense-mobile-list`, `.expense-mobile-card`, `.expense-mobile-tap`, `.expense-mobile-main`, `.expense-mobile-title-row`, `.expense-mobile-subtitle`, `.expense-mobile-meta`, `.expense-mobile-side`, `.expense-mobile-kebab-wrap`, `.expense-mobile-kebab`, `.expense-list-table-wrap` (a marker class added to the existing table wrapper div, not a new container).
- Reuses existing classes/tokens without modification: `.employee-list-avatar` (icon tile), `.status` (via `StatusBadge`, no direct class usage needed), `.expense-overdue`, `.ticket-menu-wrap`/`.ticket-menu-dropdown` (kebab dropdown chrome), `var(--color-surface)`, `var(--color-border-light)`, `var(--radius-md)`, `var(--radius-pill)`, `var(--color-text-secondary)`, `var(--color-text-tertiary)`, `var(--color-accent)`, `var(--font-size-sm)`.

- [ ] **Step 1: Insert the new CSS block**

Find `.expense-status-chip.active` in `src/styles.css` (it's immediately followed by a blank line, then `.expense-overdue`). Insert the following block between them:

```css
.expense-mobile-list {
  background: var(--color-surface);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  display: none;
  flex-direction: column;
  padding: 4px 14px;
}

.expense-mobile-card {
  align-items: center;
  border-bottom: 1px solid var(--color-border-light);
  display: flex;
  gap: 4px;
}

.expense-mobile-card:last-child {
  border-bottom: none;
}

.expense-mobile-tap {
  align-items: flex-start;
  cursor: pointer;
  display: flex;
  flex: 1 1 auto;
  gap: 11px;
  min-width: 0;
  padding: 14px 0;
}

.expense-mobile-tap:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.expense-mobile-main {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
}

.expense-mobile-title-row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.expense-mobile-title-row strong {
  font-size: var(--font-size-sm);
  font-weight: 700;
}

.expense-mobile-subtitle {
  color: var(--color-text-secondary);
  font-size: 12px;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.expense-mobile-meta {
  color: var(--color-text-tertiary);
  font-size: 11.5px;
  margin-top: 6px;
}

.expense-mobile-side {
  align-items: flex-end;
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 2px;
  text-align: right;
}

.expense-mobile-side strong {
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

.expense-mobile-side small {
  color: var(--color-text-tertiary);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}

.expense-mobile-kebab-wrap {
  flex: 0 0 auto;
}

.expense-mobile-kebab {
  align-items: center;
  background: none;
  border: none;
  border-radius: var(--radius-pill);
  color: var(--color-text-tertiary);
  cursor: pointer;
  display: flex;
  height: 32px;
  justify-content: center;
  width: 32px;
}

.expense-mobile-kebab:hover {
  background: var(--color-surface-secondary);
  color: var(--color-text);
}

@media (max-width: 760px) {
  .expense-list-table-wrap {
    display: none;
  }

  .expense-mobile-list {
    display: flex;
  }
}
```

- [ ] **Step 2: Confirm no other file uses the new class names yet (expected)**

Run: `grep -rn "expense-mobile-\|expense-list-table-wrap" src/App.tsx src/features`

Expected: no matches yet — Task 2 introduces them. This just confirms there's no naming collision with existing code.

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "Add CSS for Expenses mobile card list"
```

---

### Task 2: Add `ExpenseMobileCardList` component and wire it in

**Files:**
- Modify: `src/features/expenses/ExpensesFeature.tsx`
  - Line 1: React import (add `useRef`)
  - Line 2: lucide-react import (add `MoreVertical`)
  - Line 552 (as read at plan-writing time — the Expenses list's own `.billing-table-wrap`, not the one inside `ExpenseDetailsModal`): add a second class to the wrapper div
  - After the `.billing-table-wrap` closing `</div>` for the Expenses list (line 679 as read at plan-writing time, immediately before the pagination block): render `<ExpenseMobileCardList />`
  - After the `ExpensesFeature` function's closing brace (or anywhere else at module scope below it, e.g. right before `function ExpenseFormModal`): add the new `ExpenseMobileCardList` function component

**Interfaces:**
- Consumes: `Expense`, `ExpenseCategoryType` types (already imported in this file); `currency` (already imported); `expenseDisplayStatus`, `expenseTotalAmount`, `expenseRemainingBalance`, `isExpenseOverdue` (already imported); `normalizeSubcontractorPayoutTitle` (already imported); `todayKey` (already imported); `StatusBadge` (already imported).
- Produces: `ExpenseMobileCardList` component with this exact prop signature (used by Task 2 Step 3's call site):
  ```ts
  {
    categoryScope: ExpenseCategoryType;
    expenses: Expense[];
    onCancelExpense: (expense: Expense) => void;
    onDeleteExpense: (expense: Expense) => void;
    onEditExpense: (expense: Expense) => void;
    onEndRecurringExpense: (expense: Expense) => void;
    onOpenDetails: (expense: Expense) => void;
    onRecordPayment: (expense: Expense) => void;
  }
  ```

- [ ] **Step 1: Add the missing imports**

In `src/features/expenses/ExpensesFeature.tsx`, change line 1 from:

```tsx
import { useEffect, useMemo, useState } from "react";
```

to:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
```

Change line 2 from:

```tsx
import { Ban, CalendarClock, CheckCircle2, Eye, Pencil, Plus, Receipt, Square, Tag, Trash2, X } from "lucide-react";
```

to:

```tsx
import { Ban, CalendarClock, CheckCircle2, Eye, MoreVertical, Pencil, Plus, Receipt, Square, Tag, Trash2, X } from "lucide-react";
```

- [ ] **Step 2: Mark the Expenses list's table wrapper**

`<div className="billing-table-wrap">` followed by `<table className="billing-table">` appears twice in this file — once in the main `ExpensesFeature` list (right after `Toolbar`), once inside `ExpenseDetailsModal`'s payment ledger (`ExpensesFeature.tsx:1103` as read at plan-writing time). A plain string search will match both — disambiguate using the `<thead>` row that follows, which differs between the two: the list's header starts with `<th>Date</th>\n<th>Category</th>`, the ledger's starts with `<th>Date</th>\n<th className="num">Amount</th>`. Only edit the one whose thead includes `<th>Category</th>` (the list, not the ledger).

Find:

```tsx
        <div className="billing-table-wrap">
          <table className="billing-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
```

Replace with:

```tsx
        <div className="billing-table-wrap expense-list-table-wrap">
          <table className="billing-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
```

- [ ] **Step 3: Render the mobile card list after the table wrapper**

Find the end of the Expenses list's table wrapper and the start of the pagination block:

```tsx
              })}
            </tbody>
          </table>
        </div>
        {recordCount > EXPENSES_PAGE_SIZE && (
```

Replace with:

```tsx
              })}
            </tbody>
          </table>
        </div>
        <ExpenseMobileCardList
          categoryScope={categoryScope}
          expenses={paginatedExpenses}
          onCancelExpense={(expense) => void handleCancelExpense(expense)}
          onDeleteExpense={(expense) => setDeletingExpense(expense)}
          onEditExpense={(expense) => { setEditingExpense(expense); setFormOpen(true); }}
          onEndRecurringExpense={(expense) => void handleEndRecurringExpense(expense)}
          onOpenDetails={(expense) => setViewingExpense(expense)}
          onRecordPayment={(expense) => setPayingInstallmentExpense(expense)}
        />
        {recordCount > EXPENSES_PAGE_SIZE && (
```

- [ ] **Step 4: Add the `ExpenseMobileCardList` component**

Find the line `function ExpenseFormModal({` (the next top-level function after `ExpensesFeature`). Insert this new function immediately before it:

```tsx
function ExpenseMobileCardList({
  categoryScope,
  expenses,
  onCancelExpense,
  onDeleteExpense,
  onEditExpense,
  onEndRecurringExpense,
  onOpenDetails,
  onRecordPayment,
}: {
  categoryScope: ExpenseCategoryType;
  expenses: Expense[];
  onCancelExpense: (expense: Expense) => void;
  onDeleteExpense: (expense: Expense) => void;
  onEditExpense: (expense: Expense) => void;
  onEndRecurringExpense: (expense: Expense) => void;
  onOpenDetails: (expense: Expense) => void;
  onRecordPayment: (expense: Expense) => void;
}) {
  const [openMenuId, setOpenMenuId] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenuId) return;
    function handleClick(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpenMenuId("");
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openMenuId]);

  const today = todayKey();

  return (
    <div className="expense-mobile-list">
      {expenses.map((expense) => {
        const displayStatus = expenseDisplayStatus(expense, expense.installment_payments);
        const totalAmount = expenseTotalAmount(expense);
        const remainingBalance = expenseRemainingBalance(expense, expense.installment_payments);
        const isOverdue = isExpenseOverdue(expense, expense.installment_payments, today);
        const hasPayments = expense.installment_payments.length > 0;
        const canRecordPayment = displayStatus !== "paid" && displayStatus !== "cancelled";
        const isSystemManaged = expense.payroll_run_id !== null || expense.subcontractor_payment_reminder_id !== null;
        const isOpenEndedRecurring = expense.frequency !== "one_time" && !expense.duration_months;
        const expenseDisplayName = expense.subcontractor_payment_reminder_id !== null
          ? normalizeSubcontractorPayoutTitle(expense.employee_name)
          : expense.employee_name;
        const dateLabel = categoryScope === "company"
          ? (expense.payment_date ? `Payment: ${expense.payment_date}` : `Due: ${expense.expense_date}`)
          : (expense.due_date ? `Due: ${expense.due_date}` : `Logged ${expense.expense_date}`);
        const installmentNote = expense.frequency !== "one_time" && expense.duration_months != null
          ? ` · ${expense.installment_payments.length} of ${expense.duration_months} paid`
          : "";
        const frequencyLabel = expense.frequency === "monthly" ? "Monthly" : expense.frequency === "daily" ? "Daily" : "One-time";
        const primaryAmount = remainingBalance != null
          ? currency.format(remainingBalance)
          : totalAmount == null ? "Ongoing" : currency.format(totalAmount);
        const secondaryAmount = remainingBalance != null && totalAmount != null && remainingBalance !== totalAmount
          ? `of ${currency.format(totalAmount)}`
          : frequencyLabel;
        const showKebab = !isSystemManaged;

        return (
          <div className="expense-mobile-card" key={expense.id}>
            <div
              className="expense-mobile-tap"
              onClick={() => onOpenDetails(expense)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpenDetails(expense);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <div className="employee-list-avatar">
                {categoryScope === "company" ? <Receipt size={18} /> : <Tag size={18} />}
              </div>
              <div className="expense-mobile-main">
                <div className="expense-mobile-title-row">
                  <strong>{expense.category_name}</strong>
                  <StatusBadge status={displayStatus} />
                </div>
                <span className="expense-mobile-subtitle">{expenseDisplayName}</span>
                <span className={`expense-mobile-meta${isOverdue ? " expense-overdue" : ""}`}>
                  {dateLabel}{installmentNote}
                </span>
              </div>
              <div className="expense-mobile-side">
                <strong>{primaryAmount}</strong>
                <small>{secondaryAmount}</small>
              </div>
            </div>
            {showKebab && (
              <div className="ticket-menu-wrap expense-mobile-kebab-wrap" ref={openMenuId === expense.id ? menuRef : undefined}>
                <button
                  aria-label="More actions"
                  className="expense-mobile-kebab"
                  onClick={() => setOpenMenuId((prev) => prev === expense.id ? "" : expense.id)}
                  type="button"
                >
                  <MoreVertical size={16} />
                </button>
                {openMenuId === expense.id && (
                  <div className="ticket-menu-dropdown">
                    {canRecordPayment && (
                      <button onClick={() => { onRecordPayment(expense); setOpenMenuId(""); }} type="button">
                        <CheckCircle2 size={14} /> Record payment
                      </button>
                    )}
                    {canRecordPayment && isOpenEndedRecurring && (
                      <button onClick={() => { onEndRecurringExpense(expense); setOpenMenuId(""); }} type="button">
                        <Square size={14} /> End expense
                      </button>
                    )}
                    <button
                      disabled={hasPayments}
                      onClick={() => { onEditExpense(expense); setOpenMenuId(""); }}
                      title={hasPayments ? "Locked — payments already recorded against this expense." : undefined}
                      type="button"
                    >
                      <Pencil size={14} /> Edit
                    </button>
                    {canRecordPayment && (
                      <button
                        disabled={hasPayments}
                        onClick={() => { onCancelExpense(expense); setOpenMenuId(""); }}
                        title={hasPayments ? "Can't cancel — payments already recorded against this expense." : undefined}
                        type="button"
                      >
                        <Ban size={14} /> Cancel expense
                      </button>
                    )}
                    <button
                      disabled={hasPayments}
                      onClick={() => { onDeleteExpense(expense); setOpenMenuId(""); }}
                      title={hasPayments ? "Can't delete — payments already recorded against this expense." : undefined}
                      type="button"
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

Note: `CalendarClock` and `Eye` remain imported and still used elsewhere in this file (the KPI row and the desktop row actions, respectively) — do not remove them.

- [ ] **Step 5: Type-check**

Run: `npm run build`
Expected: exits 0 (`tsc --noEmit && vite build`), no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/features/expenses/ExpensesFeature.tsx
git commit -m "Add ExpenseMobileCardList and wire it into the Expenses list"
```

---

### Task 3: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Verify the Company Expenses view at ≤760px**

In a browser at ≤760px width, navigate to the Expenses (Company) page and confirm:
- The table is hidden; the new card list is visible.
- Each card shows: category name + status pill, employee name, date line (`Payment: …` or `Due: …`), remaining/total amount right-aligned.
- A recurring expense with installments shows the "· N of M paid" note.
- An overdue expense's date line is styled red (reuses `.expense-overdue`).
- Tapping a card body opens `ExpenseDetailsModal` with the same data as the desktop "view" icon shows.
- Tapping ⋮ opens a menu; tapping outside it or pressing another card's ⋮ closes it.
- For an expense with `installment_payments.length > 0`: Edit/Cancel/Delete are visible but disabled with a tooltip; Record payment is enabled (if not paid/cancelled).
- For a system-managed expense (payroll- or subcontractor-linked, if any exist in the current data — otherwise skip this check and note it wasn't exercised): the ⋮ button does not render at all.
- For an open-ended recurring expense (`frequency !== "one_time"` and no `duration_months`) that is still payable: "End expense" appears in the menu.

- [ ] **Step 3: Verify the Personal Expenses view at ≤760px**

Same checks as Step 2, but confirm the date line reads `Due: …` / `Logged …` (personal-scope wording) and the subtitle/icon reflect the personal-expense fields correctly.

- [ ] **Step 4: Verify desktop (>760px) is unchanged**

Widen the viewport above 760px and confirm the original table (with `data-label`-less cells, unchanged) and row-action icons render exactly as before.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all existing tests still pass (120/120 as of the last full run in this repo) — this change touches no domain logic, so no count change is expected.

- [ ] **Step 6: Clean up any screenshot/scratch files created during manual verification**

If browser automation tooling was used to verify and left screenshot files in the repo root, remove them (`git status --porcelain` should be clean of anything not part of the intended diff) before considering the plan complete.
