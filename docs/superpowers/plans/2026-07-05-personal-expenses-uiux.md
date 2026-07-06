# Personal Expenses UI/UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Personal Expenses page (`categoryScope === "personal"`) feel like a purpose-built personal budget tracker instead of a reused Billing-style ledger, while leaving Company Expenses completely unchanged.

**Architecture:** All changes live in one file, `src/features/expenses/ExpensesFeature.tsx` (plus supporting CSS in `src/styles.css`). Every change branches on `categoryScope === "personal"` vs `"company"` — company's existing JSX/classes are preserved byte-for-byte in an `else`/alternate branch, never rewritten.

**Tech Stack:** React 18, TypeScript, existing CSS custom properties in `src/styles.css`. No new dependencies, no new domain logic.

## Global Constraints

- Every change is gated on `categoryScope === "personal"`. Company Expenses (`categoryScope === "company"`) must render pixel-identical to today — same JSX, same classes, same 4 KPI cards, same table, same modal fields.
- No changes to `src/domain/expenses.ts`, `src/features/expenses/expenseRepository.ts`, or any calculation logic. This is rendering/CSS only.
- No new CSS custom properties — reuse existing tokens (`--color-warning`, `--color-warning-bg`, `--color-warning-text`, `--color-danger`, etc.) already defined in `src/styles.css`.
- Every task ends with `npx tsc --noEmit` passing and `npm test` passing (76 domain tests — this change touches no domain code, so this only confirms nothing broke).
- No automated tests for this change itself: per `CLAUDE.md`, `vitest.config.ts` only collects `src/domain/**/*.test.ts`. Verification is type-check + test-suite-unaffected + manual browser check (per this project's established pattern for UI changes, and because no browser-automation tool is available in this environment).

---

### Task 1: KPI row simplification (personal scope only)

**Files:**
- Modify: `src/features/expenses/ExpensesFeature.tsx` (the `expense-kpi-row` section, currently at lines 490-523)

**Interfaces:**
- Consumes: the existing `kpis` object (already computed at lines 141-156: `{ totalExpensesAmount, outstanding, paidThisMonth, overdueTotal, overdueCount }`) — no changes to this computation.
- Produces: nothing for later tasks.

- [ ] **Step 1: Replace the KPI section JSX**

Find this exact block:

```tsx
      <section className="expense-kpi-row">
        <div className="billing-stat accent">
          <div className="billing-stat-icon"><Receipt size={21} /></div>
          <div className="billing-stat-text">
            <span className="billing-stat-label">Total Expenses</span>
            <strong className="billing-stat-value">{currency.format(kpis.totalExpensesAmount)}</strong>
            <span className="billing-stat-helper">Active, non-cancelled</span>
          </div>
        </div>
        <div className="billing-stat billing-stat-outstanding">
          <div className="billing-stat-icon"><CalendarClock size={21} /></div>
          <div className="billing-stat-text">
            <span className="billing-stat-label">Outstanding</span>
            <strong className="billing-stat-value">{currency.format(kpis.outstanding)}</strong>
            <span className="billing-stat-helper">Remaining balance</span>
          </div>
        </div>
        <div className="billing-stat billing-stat-paid-month">
          <div className="billing-stat-icon"><CheckCircle2 size={21} /></div>
          <div className="billing-stat-text">
            <span className="billing-stat-label">Paid This Month</span>
            <strong className="billing-stat-value">{currency.format(kpis.paidThisMonth)}</strong>
            <span className="billing-stat-helper">{monthNames[Number(todayKey().slice(5, 7)) - 1]}</span>
          </div>
        </div>
        <div className="billing-stat billing-stat-overdue">
          <div className="billing-stat-icon"><Ban size={21} /></div>
          <div className="billing-stat-text">
            <span className="billing-stat-label">Overdue</span>
            <strong className="billing-stat-value">{currency.format(kpis.overdueTotal)}</strong>
            <span className="billing-stat-helper">{kpis.overdueCount} expense{kpis.overdueCount === 1 ? "" : "s"}</span>
          </div>
        </div>
      </section>
```

Replace with:

```tsx
      <section className="expense-kpi-row">
        {categoryScope === "company" && (
          <div className="billing-stat accent">
            <div className="billing-stat-icon"><Receipt size={21} /></div>
            <div className="billing-stat-text">
              <span className="billing-stat-label">Total Expenses</span>
              <strong className="billing-stat-value">{currency.format(kpis.totalExpensesAmount)}</strong>
              <span className="billing-stat-helper">Active, non-cancelled</span>
            </div>
          </div>
        )}
        <div className="billing-stat billing-stat-outstanding">
          <div className="billing-stat-icon"><CalendarClock size={21} /></div>
          <div className="billing-stat-text">
            <span className="billing-stat-label">{categoryScope === "personal" ? "Upcoming" : "Outstanding"}</span>
            <strong className="billing-stat-value">{currency.format(kpis.outstanding)}</strong>
            <span className="billing-stat-helper">Remaining balance</span>
          </div>
        </div>
        <div className="billing-stat billing-stat-paid-month">
          <div className="billing-stat-icon"><CheckCircle2 size={21} /></div>
          <div className="billing-stat-text">
            <span className="billing-stat-label">{categoryScope === "personal" ? "This Month's Spending" : "Paid This Month"}</span>
            <strong className="billing-stat-value">{currency.format(kpis.paidThisMonth)}</strong>
            <span className="billing-stat-helper">{monthNames[Number(todayKey().slice(5, 7)) - 1]}</span>
          </div>
        </div>
        <div className="billing-stat billing-stat-overdue">
          <div className="billing-stat-icon"><Ban size={21} /></div>
          <div className="billing-stat-text">
            <span className="billing-stat-label">Overdue</span>
            <strong className="billing-stat-value">{currency.format(kpis.overdueTotal)}</strong>
            <span className="billing-stat-helper">{kpis.overdueCount} expense{kpis.overdueCount === 1 ? "" : "s"}</span>
          </div>
        </div>
      </section>
```

Note: no CSS changes in this task — the `billing-stat-outstanding`/`billing-stat-paid-month`/`billing-stat-overdue` classes already render in amber/emerald/red (not blue), so they don't need re-theming; only the label text and card count change for personal scope.

- [ ] **Step 2: Type-check and test**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: all 76 domain tests pass.

- [ ] **Step 3: Manual verification**

Start `npm run dev`. Navigate to Personal Expenses — confirm exactly 3 KPI cards show ("Upcoming", "This Month's Spending", "Overdue"). Navigate to Company Expenses — confirm all 4 original cards still show unchanged ("Total Expenses", "Outstanding", "Paid This Month", "Overdue").

- [ ] **Step 4: Commit**

```bash
git add src/features/expenses/ExpensesFeature.tsx
git commit -m "$(cat <<'EOF'
feat: simplify Personal Expenses KPI row to 3 cards

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Card list instead of table (personal scope only)

**Files:**
- Modify: `src/features/expenses/ExpensesFeature.tsx` (the table-rendering block, currently lines 527-644)
- Modify: `src/styles.css` (new card-list CSS)

**Interfaces:**
- Consumes: `filteredExpenses`, `employees`, `expenseDisplayStatus`, `expenseTotalAmount`, `expenseRemainingBalance`, `isExpenseOverdue`, `expensePaymentsTotal` (all already imported/available in this file); `StatusBadge` component; the state setters `setViewingExpense`, `setPayingInstallmentExpense`, `setEditingExpense`, `setFormOpen`, `setDeletingExpense`, and the handler `handleEndRecurringExpense` — all already defined earlier in this component.
- Produces: a helper function `expenseRowMeta(expense: Expense)` (new, local to this component) returning `{ displayStatus, totalAmount, remainingBalance, isOverdue, hasPayments, canRecordPayment, isOpenEndedRecurring }` — used by both the company table branch and the new personal card branch, so the derived-value logic isn't duplicated even though the two render branches are.

- [ ] **Step 1: Extract the shared per-row derived values into a helper function**

Find this line (inside the `.map()` callback, currently around line 552-558):

```tsx
              {filteredExpenses.map((expense) => {
                const displayStatus = expenseDisplayStatus(expense, expense.installment_payments);
                const totalAmount = expenseTotalAmount(expense);
                const remainingBalance = expenseRemainingBalance(expense, expense.installment_payments);
                const isOverdue = isExpenseOverdue(expense, expense.installment_payments, todayKey());
                const hasPayments = expense.installment_payments.length > 0;
                const canRecordPayment = displayStatus !== "paid" && displayStatus !== "cancelled";
                const isOpenEndedRecurring = expense.frequency !== "one_time" && !expense.duration_months;
                return (
```

Just above the `return (` statement in the main component (before the `return (` that starts with `<div className="billing-page">`, i.e. right after the `handleEndRecurringExpense` function definition and before the component's JSX return), add this new helper function:

```tsx
  function expenseRowMeta(expense: Expense) {
    const displayStatus = expenseDisplayStatus(expense, expense.installment_payments);
    const totalAmount = expenseTotalAmount(expense);
    const remainingBalance = expenseRemainingBalance(expense, expense.installment_payments);
    const isOverdue = isExpenseOverdue(expense, expense.installment_payments, todayKey());
    const hasPayments = expense.installment_payments.length > 0;
    const canRecordPayment = displayStatus !== "paid" && displayStatus !== "cancelled";
    const isOpenEndedRecurring = expense.frequency !== "one_time" && !expense.duration_months;
    return { displayStatus, totalAmount, remainingBalance, isOverdue, hasPayments, canRecordPayment, isOpenEndedRecurring };
  }
```

- [ ] **Step 2: Replace the table-or-empty-state block**

Find this exact block (the empty-state check through the closing `</table></div>`, currently lines 527-644):

```tsx
      {recordCount === 0 ? (
        <div className="billing-empty">
          <Receipt size={32} />
          <p>No expenses found</p>
          <span>Add an expense or adjust the filters to see records here.</span>
        </div>
      ) : (
        <div className="billing-table-wrap">
          <table className="billing-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>{categoryScope === "personal" ? "Name" : "Employee"}</th>
                {categoryScope === "personal" && <th>Due date</th>}
                {categoryScope === "company" && <th>Payment date</th>}
                <th className="num">Total</th>
                <th className="num">Paid</th>
                <th className="num">Remaining</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredExpenses.map((expense) => {
                const displayStatus = expenseDisplayStatus(expense, expense.installment_payments);
                const totalAmount = expenseTotalAmount(expense);
                const remainingBalance = expenseRemainingBalance(expense, expense.installment_payments);
                const isOverdue = isExpenseOverdue(expense, expense.installment_payments, todayKey());
                const hasPayments = expense.installment_payments.length > 0;
                const canRecordPayment = displayStatus !== "paid" && displayStatus !== "cancelled";
                const isOpenEndedRecurring = expense.frequency !== "one_time" && !expense.duration_months;
                return (
                <tr key={expense.id}>
                  <td>{expense.expense_date}</td>
                  <td>{expense.category_name}</td>
                  <td>
                    {categoryScope === "personal" ? (
                      expense.employee_name
                    ) : (
                      <div className="employee-list-identity">
                        <div className="employee-list-avatar">
                          {(() => {
                            const emp = employees.find((e) => e.id === expense.employee_id);
                            return emp?.profile_photo_url
                              ? <img alt="" src={emp.profile_photo_url} />
                              : <span>{expense.employee_name.split(" ").filter(Boolean).slice(0, 2).map((p: string) => p[0]).join("").toUpperCase() || "E"}</span>;
                          })()}
                        </div>
                        <RecordTitle title={expense.employee_name} notes={employees.find((e) => e.id === expense.employee_id)?.email || "No email"} />
                      </div>
                    )}
                  </td>
                  {categoryScope === "personal" && (
                    <td className={isOverdue ? "expense-overdue" : ""}>{expense.due_date ?? "—"}</td>
                  )}
                  {categoryScope === "company" && (
                    <td className={isOverdue ? "expense-overdue" : ""}>{expense.payment_date ?? "—"}</td>
                  )}
                  <td className="num">
                    {totalAmount == null ? "Ongoing" : currency.format(totalAmount)}
                    {expense.frequency !== "one_time" && expense.duration_months != null && (
                      <small className="expense-installment-progress">{expense.installment_payments.length} of {expense.duration_months} paid</small>
                    )}
                  </td>
                  <td className="num">{currency.format(expensePaymentsTotal(expense.installment_payments))}</td>
                  <td className="num">{remainingBalance == null ? "—" : currency.format(remainingBalance)}</td>
                  <td><StatusBadge status={displayStatus} /></td>
                  <td>
                    <div className="billing-row-actions">
                      <button onClick={() => setViewingExpense(expense)} title="View details" type="button">
                        <Eye size={14} />
                      </button>
                      {canRecordPayment && (
                        <button onClick={() => setPayingInstallmentExpense(expense)} title="Record payment" type="button">
                          <CheckCircle2 size={14} />
                        </button>
                      )}
                      {canRecordPayment && isOpenEndedRecurring && (
                        <button onClick={() => void handleEndRecurringExpense(expense)} title="End expense" type="button">
                          <Square size={14} />
                        </button>
                      )}
                      <button
                        disabled={hasPayments}
                        onClick={() => { setEditingExpense(expense); setFormOpen(true); }}
                        title={hasPayments ? "Locked — payments already recorded against this expense." : "Edit"}
                        type="button"
                      >
                        <Pencil size={14} />
                      </button>
                      {canRecordPayment && (
                        <button
                          disabled={hasPayments}
                          onClick={() => void handleCancelExpense(expense)}
                          title={hasPayments ? "Can't cancel — payments already recorded against this expense." : "Cancel expense"}
                          type="button"
                        >
                          <Ban size={14} />
                        </button>
                      )}
                      <button
                        disabled={hasPayments}
                        onClick={() => setDeletingExpense(expense)}
                        title={hasPayments ? "Can't delete — payments already recorded against this expense." : "Delete"}
                        type="button"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
```

Replace with:

```tsx
      {recordCount === 0 ? (
        <div className="billing-empty">
          <Receipt size={32} />
          <p>No expenses found</p>
          <span>Add an expense or adjust the filters to see records here.</span>
        </div>
      ) : categoryScope === "company" ? (
        <div className="billing-table-wrap">
          <table className="billing-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>Employee</th>
                <th>Payment date</th>
                <th className="num">Total</th>
                <th className="num">Paid</th>
                <th className="num">Remaining</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredExpenses.map((expense) => {
                const { displayStatus, totalAmount, remainingBalance, isOverdue, hasPayments, canRecordPayment, isOpenEndedRecurring } = expenseRowMeta(expense);
                return (
                <tr key={expense.id}>
                  <td>{expense.expense_date}</td>
                  <td>{expense.category_name}</td>
                  <td>
                    <div className="employee-list-identity">
                      <div className="employee-list-avatar">
                        {(() => {
                          const emp = employees.find((e) => e.id === expense.employee_id);
                          return emp?.profile_photo_url
                            ? <img alt="" src={emp.profile_photo_url} />
                            : <span>{expense.employee_name.split(" ").filter(Boolean).slice(0, 2).map((p: string) => p[0]).join("").toUpperCase() || "E"}</span>;
                        })()}
                      </div>
                      <RecordTitle title={expense.employee_name} notes={employees.find((e) => e.id === expense.employee_id)?.email || "No email"} />
                    </div>
                  </td>
                  <td className={isOverdue ? "expense-overdue" : ""}>{expense.payment_date ?? "—"}</td>
                  <td className="num">
                    {totalAmount == null ? "Ongoing" : currency.format(totalAmount)}
                    {expense.frequency !== "one_time" && expense.duration_months != null && (
                      <small className="expense-installment-progress">{expense.installment_payments.length} of {expense.duration_months} paid</small>
                    )}
                  </td>
                  <td className="num">{currency.format(expensePaymentsTotal(expense.installment_payments))}</td>
                  <td className="num">{remainingBalance == null ? "—" : currency.format(remainingBalance)}</td>
                  <td><StatusBadge status={displayStatus} /></td>
                  <td>
                    <div className="billing-row-actions">
                      <button onClick={() => setViewingExpense(expense)} title="View details" type="button">
                        <Eye size={14} />
                      </button>
                      {canRecordPayment && (
                        <button onClick={() => setPayingInstallmentExpense(expense)} title="Record payment" type="button">
                          <CheckCircle2 size={14} />
                        </button>
                      )}
                      {canRecordPayment && isOpenEndedRecurring && (
                        <button onClick={() => void handleEndRecurringExpense(expense)} title="End expense" type="button">
                          <Square size={14} />
                        </button>
                      )}
                      <button
                        disabled={hasPayments}
                        onClick={() => { setEditingExpense(expense); setFormOpen(true); }}
                        title={hasPayments ? "Locked — payments already recorded against this expense." : "Edit"}
                        type="button"
                      >
                        <Pencil size={14} />
                      </button>
                      {canRecordPayment && (
                        <button
                          disabled={hasPayments}
                          onClick={() => void handleCancelExpense(expense)}
                          title={hasPayments ? "Can't cancel — payments already recorded against this expense." : "Cancel expense"}
                          type="button"
                        >
                          <Ban size={14} />
                        </button>
                      )}
                      <button
                        disabled={hasPayments}
                        onClick={() => setDeletingExpense(expense)}
                        title={hasPayments ? "Can't delete — payments already recorded against this expense." : "Delete"}
                        type="button"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="personal-expense-list">
          {filteredExpenses.map((expense) => {
            const { displayStatus, totalAmount, isOverdue, hasPayments, canRecordPayment, isOpenEndedRecurring } = expenseRowMeta(expense);
            return (
              <div className={`personal-expense-card${isOverdue ? " overdue" : ""}`} key={expense.id}>
                <div className="personal-expense-card-icon"><Receipt size={18} /></div>
                <div className="personal-expense-card-main">
                  <div className="personal-expense-card-title-row">
                    <strong>{expense.employee_name}</strong>
                    <StatusBadge status={displayStatus} />
                  </div>
                  <span className="personal-expense-card-category">{expense.category_name}</span>
                </div>
                <div className="personal-expense-card-amount">
                  <strong>{totalAmount == null ? "Ongoing" : currency.format(totalAmount)}</strong>
                  {expense.frequency !== "one_time" && expense.duration_months != null && (
                    <small className="expense-installment-progress">{expense.installment_payments.length} of {expense.duration_months} paid</small>
                  )}
                </div>
                <div className="personal-expense-card-due">
                  <span className={isOverdue ? "expense-overdue" : ""}>{expense.due_date ?? "—"}</span>
                </div>
                <div className="personal-expense-card-actions billing-row-actions">
                  <button onClick={() => setViewingExpense(expense)} title="View details" type="button">
                    <Eye size={14} />
                  </button>
                  {canRecordPayment && (
                    <button onClick={() => setPayingInstallmentExpense(expense)} title="Record payment" type="button">
                      <CheckCircle2 size={14} />
                    </button>
                  )}
                  {canRecordPayment && isOpenEndedRecurring && (
                    <button onClick={() => void handleEndRecurringExpense(expense)} title="End expense" type="button">
                      <Square size={14} />
                    </button>
                  )}
                  <button
                    disabled={hasPayments}
                    onClick={() => { setEditingExpense(expense); setFormOpen(true); }}
                    title={hasPayments ? "Locked — payments already recorded against this expense." : "Edit"}
                    type="button"
                  >
                    <Pencil size={14} />
                  </button>
                  {canRecordPayment && (
                    <button
                      disabled={hasPayments}
                      onClick={() => void handleCancelExpense(expense)}
                      title={hasPayments ? "Can't cancel — payments already recorded against this expense." : "Cancel expense"}
                      type="button"
                    >
                      <Ban size={14} />
                    </button>
                  )}
                  <button
                    disabled={hasPayments}
                    onClick={() => setDeletingExpense(expense)}
                    title={hasPayments ? "Can't delete — payments already recorded against this expense." : "Delete"}
                    type="button"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
```

- [ ] **Step 3: Add the card-list CSS**

In `src/styles.css`, find the existing rule `.expense-installment-progress {` (search for it — it's near the billing-table rules) and add the following new block immediately before it:

```css
.personal-expense-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.personal-expense-card {
  align-items: center;
  background: var(--color-surface);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  display: grid;
  gap: 14px;
  grid-template-columns: auto 1fr auto auto auto;
  padding: 14px 16px;
}

.personal-expense-card.overdue {
  border-color: rgba(255, 59, 48, 0.35);
}

.personal-expense-card-icon {
  align-items: center;
  background: var(--color-warning-bg);
  border-radius: var(--radius-pill);
  color: var(--color-warning);
  display: flex;
  height: 36px;
  justify-content: center;
  width: 36px;
}

.personal-expense-card-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.personal-expense-card-title-row {
  align-items: center;
  display: flex;
  gap: 10px;
}

.personal-expense-card-category {
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
}

.personal-expense-card-amount {
  display: flex;
  flex-direction: column;
  text-align: right;
}

.personal-expense-card-due {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  white-space: nowrap;
}

.personal-expense-card-actions {
  flex: 0 0 auto;
}
```

- [ ] **Step 4: Type-check and test**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: all 76 domain tests pass.

- [ ] **Step 5: Manual verification**

`npm run dev`. Personal Expenses: confirm each expense shows as a card (icon, name, category, amount, due date, status badge, action buttons) and that View/Record payment/End expense/Edit/Cancel/Delete all still work exactly as before. Company Expenses: confirm the table is completely unchanged (same columns, same rows, same behavior).

- [ ] **Step 6: Commit**

```bash
git add src/features/expenses/ExpensesFeature.tsx src/styles.css
git commit -m "$(cat <<'EOF'
feat: replace Personal Expenses table with a card list

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Add/Edit form redesign (personal scope only)

**Files:**
- Modify: `src/features/expenses/ExpensesFeature.tsx` (`ExpenseFormModal`, currently lines 683-822)
- Modify: `src/styles.css` (new "More options" toggle + modal CSS)

**Interfaces:**
- Consumes: nothing new from Tasks 1-2.
- Produces: nothing for later tasks (Task 4 only adds color, doesn't rely on new exports from this task beyond the class names introduced here: `personal-expense-modal`, `personal-expense-more-toggle`).

- [ ] **Step 1: Add local state for the collapsible section**

Find (near the top of `ExpenseFormModal`, right after the `values`/`busy` state):

```tsx
  const [busy, setBusy] = useState(false);
```

Add immediately after it:

```tsx
  const [showMoreOptions, setShowMoreOptions] = useState(false);
```

- [ ] **Step 2: Relabel the personal "Name" field**

Find:

```tsx
            <label>
              {categoryScope === "personal" ? "Name" : "Employee"}
              {categoryScope === "personal" ? (
                <input
                  placeholder="Who is this expense for?"
                  type="text"
                  value={values.employee_name}
                  onChange={(event) => setValues((current) => ({ ...current, employee_name: event.target.value }))}
                  required
                />
              ) : (
```

Replace with:

```tsx
            <label>
              {categoryScope === "personal" ? "What's this for?" : "Employee"}
              {categoryScope === "personal" ? (
                <input
                  placeholder="e.g. Netflix subscription"
                  type="text"
                  value={values.employee_name}
                  onChange={(event) => setValues((current) => ({ ...current, employee_name: event.target.value }))}
                  required
                />
              ) : (
```

- [ ] **Step 3: Move personal's Due date + Notes behind a "More options" toggle**

Find this exact block (the due-date/payment-date fields inside `.billing-form-fields`, through the closing of `.billing-form-fields`, then the always-visible Notes field, then the form-actions div's opening):

```tsx
            {categoryScope === "personal" && (
              <label>
                {values.frequency === "one_time" ? "Due date (optional)" : "Due date — when this ends (optional)"}
                <input type="date" value={values.due_date} onChange={(event) => setValues((current) => ({ ...current, due_date: event.target.value }))} />
                {dueDateHint && <small className="expense-remaining-note">{dueDateHint}</small>}
              </label>
            )}
            {categoryScope === "company" && (
              <label>
                Payment date (optional)
                <input type="date" value={values.payment_date} onChange={(event) => setValues((current) => ({ ...current, payment_date: event.target.value }))} />
              </label>
            )}
          </div>
          <label>
            Notes
            <textarea rows={3} value={values.notes} onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))} />
          </label>
          <div className="form-actions">
```

Replace with:

```tsx
            {categoryScope === "company" && (
              <label>
                Payment date (optional)
                <input type="date" value={values.payment_date} onChange={(event) => setValues((current) => ({ ...current, payment_date: event.target.value }))} />
              </label>
            )}
          </div>
          {categoryScope === "company" && (
            <label>
              Notes
              <textarea rows={3} value={values.notes} onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))} />
            </label>
          )}
          {categoryScope === "personal" && (
            <div className="personal-expense-more">
              <button
                className="personal-expense-more-toggle"
                onClick={() => setShowMoreOptions((current) => !current)}
                type="button"
              >
                {showMoreOptions ? "Hide options" : "More options"}
              </button>
              {showMoreOptions && (
                <div className="personal-expense-more-fields">
                  <label>
                    {values.frequency === "one_time" ? "Due date (optional)" : "Due date — when this ends (optional)"}
                    <input type="date" value={values.due_date} onChange={(event) => setValues((current) => ({ ...current, due_date: event.target.value }))} />
                    {dueDateHint && <small className="expense-remaining-note">{dueDateHint}</small>}
                  </label>
                  <label>
                    Notes
                    <textarea rows={3} value={values.notes} onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))} />
                  </label>
                </div>
              )}
            </div>
          )}
          <div className="form-actions">
```

- [ ] **Step 4: Give the modal its own class for personal scope**

Find:

```tsx
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal billing-form-modal" onClick={(event) => event.stopPropagation()}>
```

Replace with:

```tsx
      <div className="modal-backdrop" onClick={onClose}>
        <div className={`modal billing-form-modal${categoryScope === "personal" ? " personal-expense-modal" : ""}`} onClick={(event) => event.stopPropagation()}>
```

- [ ] **Step 5: Add the "More options" toggle CSS**

In `src/styles.css`, add this block right after the `.personal-expense-card-actions` rule added in Task 2:

```css
.personal-expense-more {
  margin-top: 4px;
}

.personal-expense-more-toggle {
  background: transparent;
  border: 0;
  color: var(--color-warning);
  cursor: pointer;
  font: inherit;
  font-size: var(--font-size-xs);
  font-weight: 600;
  padding: 0;
}

.personal-expense-more-toggle:hover {
  text-decoration: underline;
}

.personal-expense-more-fields {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 10px;
}
```

- [ ] **Step 6: Type-check and test**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: all 76 domain tests pass.

- [ ] **Step 7: Manual verification**

`npm run dev`. Open "Add expense" on Personal Expenses: confirm the field is labeled "What's this for?" with the new placeholder, confirm Due date/Notes are hidden until "More options" is clicked, confirm the form still saves correctly with and without expanding "More options". Open "Add expense" on Company Expenses: confirm it's completely unchanged (Employee picker, Payment date and Notes both always visible, no "More options" toggle).

- [ ] **Step 8: Commit**

```bash
git add src/features/expenses/ExpensesFeature.tsx src/styles.css
git commit -m "$(cat <<'EOF'
feat: redesign Personal Expense form with collapsible advanced fields

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Visual identity — warm accent for personal scope

**Files:**
- Modify: `src/features/expenses/ExpensesFeature.tsx` (the "Add expense" button, currently around line 465)
- Modify: `src/styles.css` (new `.billing-btn.primary.personal-accent` rule)

**Interfaces:**
- Consumes: the `personal-expense-card-icon` class (Task 2) and `personal-expense-more-toggle` class (Task 3) — both already use `var(--color-warning)`/`var(--color-warning-bg)` directly, so no further changes needed to those; this task only needs to handle the "Add expense" button, which is the one remaining blue (`--color-accent`) element on the personal-scope page.
- Produces: nothing for later tasks (final task).

- [ ] **Step 1: Give the Add button a personal-scope accent class**

Find:

```tsx
            <button className="billing-btn primary" onClick={() => { setEditingExpense(null); setFormOpen(true); }} type="button">
              <Plus size={15} /> Add expense
            </button>
```

Replace with:

```tsx
            <button
              className={`billing-btn primary${categoryScope === "personal" ? " personal-accent" : ""}`}
              onClick={() => { setEditingExpense(null); setFormOpen(true); }}
              type="button"
            >
              <Plus size={15} /> Add expense
            </button>
```

- [ ] **Step 2: Add the CSS override**

In `src/styles.css`, find the existing rule:

```css
.billing-btn.primary:hover {
  background: var(--color-accent-hover);
}
```

Add immediately after it:

```css
.billing-btn.primary.personal-accent {
  background: var(--color-warning);
}

.billing-btn.primary.personal-accent:hover {
  background: #e08600;
}
```

- [ ] **Step 3: Type-check and test**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: all 76 domain tests pass.

- [ ] **Step 4: Manual verification**

`npm run dev`. Personal Expenses: confirm the "Add expense" button is now orange (matching the card icons and "More options" toggle), and hovering darkens it slightly. Company Expenses: confirm its "Add expense" button is still the original blue, unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/features/expenses/ExpensesFeature.tsx src/styles.css
git commit -m "$(cat <<'EOF'
feat: apply warm accent color to Personal Expenses page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Post-plan manual verification (required, cannot be automated in this environment)

After all 4 tasks land, a human must verify in a real browser (no browser-automation tool is available here):

1. Personal Expenses: 3 KPI cards, card list (not table), warm-orange "Add expense" button and card icons, form with collapsible "More options".
2. Company Expenses: completely unchanged — 4 KPI cards, table, blue "Add expense" button, all fields always visible in the form.
3. All existing actions (view, record payment, end expense, edit, cancel, delete) still function correctly on both scopes.
