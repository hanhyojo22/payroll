# Payroll Mobile Card List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the active Payroll Run items table (`PayrollItemsTable` in `src/features/payroll/PayrollFeature.tsx`) a bespoke mobile card list at ≤760px, matching the treatment already given to Employees, Daily Tickets, and Attendance.

**Architecture:** Additive JSX inside `PayrollItemsTable` — a card list rendered as a sibling to the existing `<DataTable ... />` call, reading the same `paginatedItems`/`employees` data and the same local handlers (`handleMarkPaid`, `handleMarkPending`, `payBasis`, `empCode`) the desktop table already uses. No new state, no duplicated business logic, no changes to `DataTable.tsx` (it stays generic — Salary Bonds and Payment Reminders still depend on its default behavior). New CSS in `src/styles.css` maximizes reuse of the `.ticket-mobile-card` shell already established by Daily Tickets and reused by Attendance, plus `.employee-list-identity`/`.employee-list-avatar`/`.record-title` (Employees) and `.emp-status-pill`/`.emp-mobile-card-badge` (Employees).

**Tech Stack:** React + TypeScript, plain CSS, existing `lucide-react` icons (`CheckCircle2`, `CalendarClock` — already imported in `PayrollFeature.tsx`), existing `currency`/`toNumber` helpers already imported in this file.

## Global Constraints

- Scope is the active Payroll Run items list only (`PayrollItemsTable`, `src/features/payroll/PayrollFeature.tsx:1237-1377` as read at plan-writing time). Do not touch `Toolbar` (search, status filter), the pagination footer, or the Payroll History table (`.ph-table`) — out of scope per the spec.
- The desktop-table hide rule must use the `.employee-list-panel:has(.payroll-mobile-list) .table-wrap` pattern (same as Employees), scoped inside `@media (max-width: 760px)` — do not hide `.table-wrap` unconditionally, since `.employee-list-panel` is a shared wrapper class and this must not affect any other view that reuses it.
- The Mark Paid/Mark Pending action must render as a full-width labeled button (not icon-only) — this is the fix for the icon-only touch-target finding from the 2026-07-15 mobile UX audit. Reuse `handleMarkPaid`/`handleMarkPending` verbatim; do not change their confirmation-dialog behavior.
- No unit tests apply — per CLAUDE.md, `src/domain/**/*.test.ts` is the only tested surface, and no domain logic changes. Verification is manual, in-browser.
- Follow the spec at `docs/superpowers/specs/2026-07-15-payroll-mobile-card-list-design.md`.

---

### Task 1: Add CSS for the Payroll mobile card

**Files:**
- Modify: `src/styles.css` (insert a new block right after the existing `.payroll-net-allowance` rule, before the `/* ── Payroll History Groups ── */` comment — search for `.payroll-net-allowance` to find the insertion point, since exact line numbers may have shifted since plan-writing time)

**Interfaces:**
- Produces: `.payroll-mobile-list` (new container), `.payroll-mobile-card` (new marker class added alongside `.ticket-mobile-card` on each card, used only to scope the footer layout override below), `.payroll-mobile-card-basis` / `.payroll-mobile-card-meta` / `.payroll-mobile-card-deduction` / `.payroll-mobile-card-allowance` (new, body text rows), `.payroll-mobile-card-action` / `.payroll-mobile-card-action--paid` / `.payroll-mobile-card-action--pending` (new, the full-width action button).
- Reuses without modification: `.ticket-mobile-card`, `.ticket-mobile-card-header`, `.ticket-mobile-card-index`, `.ticket-mobile-card-gross`, `.employee-list-identity`, `.employee-list-avatar`, `.record-title`, `.emp-mobile-card-badge`, `.emp-status-pill` (`.active`/`.inactive`), `--color-accent`, `--color-success-text`, `--color-border`, `--radius-sm`.
- Overrides scoped to Payroll only: `.payroll-mobile-card .ticket-mobile-card-footer` (changes the shared footer from a row to a column layout — does not affect Daily Tickets' or Attendance's use of `.ticket-mobile-card-footer`, since the override is qualified by the `.payroll-mobile-card` ancestor class that only Payroll's cards carry).

- [ ] **Step 1: Insert the new CSS block**

Find `.payroll-net-allowance { ... }` in `src/styles.css`. Insert the following block immediately after its closing brace (before the `/* ── Payroll History Groups ── */` comment):

```css
.payroll-mobile-list {
  display: none;
  flex-direction: column;
  gap: 10px;
}

@media (max-width: 760px) {
  .employee-list-panel:has(.payroll-mobile-list) .table-wrap {
    display: none;
  }

  .payroll-mobile-list {
    display: flex;
  }
}

.payroll-mobile-card .ticket-mobile-card-footer {
  align-items: stretch;
  flex-direction: column;
  gap: 10px;
}

.payroll-mobile-card-basis {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.payroll-mobile-card-basis span {
  font-size: 13px;
  font-weight: 500;
}

.payroll-mobile-card-basis small {
  color: var(--color-text-secondary);
  font-size: 11px;
}

.payroll-mobile-card-meta {
  display: flex;
  flex-direction: column;
  font-size: 12px;
  gap: 2px;
}

.payroll-mobile-card-deduction {
  color: var(--color-text-secondary);
}

.payroll-mobile-card-allowance {
  color: var(--color-success-text);
}

.payroll-mobile-card-action {
  align-items: center;
  border-radius: var(--radius-sm);
  display: inline-flex;
  font-size: 13px;
  font-weight: 700;
  gap: 6px;
  height: 44px;
  justify-content: center;
  min-height: 44px;
  width: 100%;
}

.payroll-mobile-card-action--paid {
  background: var(--color-accent);
  border: none;
  color: #fff;
}

.payroll-mobile-card-action--pending {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  color: var(--color-accent);
}
```

- [ ] **Step 2: Confirm no other file uses the new class names yet (expected)**

Run: `grep -n "payroll-mobile-" src/features/payroll/PayrollFeature.tsx`

Expected: no matches yet — Task 2 introduces them.

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "Add CSS for Payroll mobile card list"
```

---

### Task 2: Add the Payroll mobile card list JSX

**Files:**
- Modify: `src/features/payroll/PayrollFeature.tsx` (inside `PayrollItemsTable`, immediately after the `<DataTable ... />` call and before the closing `</section>`, at `PayrollFeature.tsx:1315-1353` as read at plan-writing time)

**Interfaces:**
- Consumes (all already defined/imported/in-scope inside `PayrollItemsTable`, no new props/state): `paginatedItems`, `employees`, `payrollPageStart`, `empCode`, `payBasis`, `handleMarkPaid`, `handleMarkPending`, `currency`, `toNumber`, `EmpAvatar` (local component defined at `PayrollFeature.tsx:47`), `CheckCircle2`, `CalendarClock` (already imported from `lucide-react` at the top of the file).

- [ ] **Step 1: Add the mobile card list after the table**

Find the end of the `DataTable` call and the closing of the panel section:

```tsx
      <DataTable
        empty="No payroll items match the current filter."
        headers={["No.", "Employee ID", "Employee", "Pay Basis", "Gross", "Deductions", "Net", "Status", "Actions"]}
        rows={paginatedItems.map((item, index) => [
          payrollPageStart + index + 1,
          empCode(item.employee_id ?? null),
          <div key="employee" className="employee-list-identity">
            <EmpAvatar employees={employees} employeeId={item.employee_id ?? null} employeeName={item.employee_name} />
            <RecordTitle title={item.employee_name} notes={employees.find((e) => e.id === item.employee_id)?.email || "No email"} />
          </div>,
          <div key="basis" className="payroll-basis-cell">
            <span>{payBasis(item)}</span>
            {item.notes && <small>{item.notes}</small>}
          </div>,
          currency.format(toNumber(item.gross_pay)),
          toNumber(item.deductions) > 0 ? currency.format(toNumber(item.deductions)) : "-",
          <div key="net" className="payroll-net-cell">
            <strong>{currency.format(toNumber(item.net_pay))}</strong>
            {toNumber(item.allowances) > 0 && (
              <span className="payroll-net-allowance">+{currency.format(toNumber(item.allowances))} allowance</span>
            )}
          </div>,
          <span key="status" className={item.status === "paid" ? "emp-status-pill active" : "emp-status-pill inactive"}>
            {item.status === "paid" ? "Paid" : "Pending"}
          </span>,
          <div className="row-actions" key="actions">
            {item.status !== "paid" ? (
              <button aria-label="Mark paid" onClick={() => void handleMarkPaid(item)} title="Mark paid" type="button">
                <CheckCircle2 size={16} />
              </button>
            ) : (
              <button aria-label="Mark pending" onClick={() => void handleMarkPending(item)} title="Mark pending" type="button">
                <CalendarClock size={16} />
              </button>
            )}
          </div>,
        ])}
      />
      </section>
```

Replace with:

```tsx
      <DataTable
        empty="No payroll items match the current filter."
        headers={["No.", "Employee ID", "Employee", "Pay Basis", "Gross", "Deductions", "Net", "Status", "Actions"]}
        rows={paginatedItems.map((item, index) => [
          payrollPageStart + index + 1,
          empCode(item.employee_id ?? null),
          <div key="employee" className="employee-list-identity">
            <EmpAvatar employees={employees} employeeId={item.employee_id ?? null} employeeName={item.employee_name} />
            <RecordTitle title={item.employee_name} notes={employees.find((e) => e.id === item.employee_id)?.email || "No email"} />
          </div>,
          <div key="basis" className="payroll-basis-cell">
            <span>{payBasis(item)}</span>
            {item.notes && <small>{item.notes}</small>}
          </div>,
          currency.format(toNumber(item.gross_pay)),
          toNumber(item.deductions) > 0 ? currency.format(toNumber(item.deductions)) : "-",
          <div key="net" className="payroll-net-cell">
            <strong>{currency.format(toNumber(item.net_pay))}</strong>
            {toNumber(item.allowances) > 0 && (
              <span className="payroll-net-allowance">+{currency.format(toNumber(item.allowances))} allowance</span>
            )}
          </div>,
          <span key="status" className={item.status === "paid" ? "emp-status-pill active" : "emp-status-pill inactive"}>
            {item.status === "paid" ? "Paid" : "Pending"}
          </span>,
          <div className="row-actions" key="actions">
            {item.status !== "paid" ? (
              <button aria-label="Mark paid" onClick={() => void handleMarkPaid(item)} title="Mark paid" type="button">
                <CheckCircle2 size={16} />
              </button>
            ) : (
              <button aria-label="Mark pending" onClick={() => void handleMarkPending(item)} title="Mark pending" type="button">
                <CalendarClock size={16} />
              </button>
            )}
          </div>,
        ])}
      />
      <div className="payroll-mobile-list">
        {paginatedItems.map((item, index) => (
          <div className="ticket-mobile-card payroll-mobile-card" key={item.id}>
            <div className="ticket-mobile-card-header">
              <span className="ticket-mobile-card-index">{payrollPageStart + index + 1}</span>
              <div className="employee-list-identity">
                <EmpAvatar employees={employees} employeeId={item.employee_id ?? null} employeeName={item.employee_name} />
                <div className="record-title">
                  <strong>{item.employee_name}</strong>
                  <span>{employees.find((e) => e.id === item.employee_id)?.email || "No email"}</span>
                  <span className="emp-mobile-card-badge">{empCode(item.employee_id ?? null)}</span>
                </div>
              </div>
              <strong className="ticket-mobile-card-gross">{currency.format(toNumber(item.net_pay))}</strong>
            </div>
            <div className="payroll-mobile-card-basis">
              <span>{payBasis(item)}</span>
              {item.notes && <small>{item.notes}</small>}
            </div>
            <div className="payroll-mobile-card-meta">
              <span>Gross: {currency.format(toNumber(item.gross_pay))}</span>
              {toNumber(item.deductions) > 0 && (
                <span className="payroll-mobile-card-deduction">Deductions: -{currency.format(toNumber(item.deductions))}</span>
              )}
              {toNumber(item.allowances) > 0 && (
                <span className="payroll-mobile-card-allowance">+{currency.format(toNumber(item.allowances))} allowance</span>
              )}
            </div>
            <div className="ticket-mobile-card-footer">
              <span className={item.status === "paid" ? "emp-status-pill active" : "emp-status-pill inactive"}>
                {item.status === "paid" ? "Paid" : "Pending"}
              </span>
              {item.status !== "paid" ? (
                <button
                  aria-label={`Mark paid for ${item.employee_name}`}
                  className="payroll-mobile-card-action payroll-mobile-card-action--paid"
                  onClick={() => void handleMarkPaid(item)}
                  type="button"
                >
                  <CheckCircle2 size={16} /> Mark Paid
                </button>
              ) : (
                <button
                  aria-label={`Mark pending for ${item.employee_name}`}
                  className="payroll-mobile-card-action payroll-mobile-card-action--pending"
                  onClick={() => void handleMarkPending(item)}
                  type="button"
                >
                  <CalendarClock size={16} /> Mark Pending
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      </section>
```

Note: this duplicates the per-item `payBasis`/`empCode`/currency-formatting calls the desktop `DataTable` rows already do. This is intentional and matches the Attendance/Employees precedent — these are simple, side-effect-free lookups with no cross-row dependencies, so there's nothing to gain from extracting a shared array (unlike the Daily Tickets refactor, which was justified by genuinely interdependent computed totals).

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: exits 0, no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/payroll/PayrollFeature.tsx
git commit -m "Add Payroll mobile card list"
```

---

### Task 3: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Verify at ≤760px**

Navigate to Payroll, select a run with items, resize to ≤760px, and confirm:
- The table is hidden; the card list is visible with every item on the current page present, index numbers matching the desktop table's numbering.
- Each card shows: avatar, employee name/email, employee-code badge, Net Pay (right-aligned headline), pay-basis line (with notes if present), Gross line, Deductions line (only when > 0), allowance line (only when > 0), and a status pill (Paid = green, Pending = gray).
- For a Pending item, tapping "Mark Paid" shows the same confirmation dialog as desktop; confirming updates the card's status pill to Paid and swaps the button to "Mark Pending" without a page reload.
- For a Paid item, tapping "Mark Pending" shows the same confirmation dialog as desktop; confirming reverts the status pill to Pending and swaps the button back to "Mark Paid".
- Both action buttons are full-width and comfortably tappable (visually taller than the old icon-only button).
- Changing the search query, status filter, or pagination page filters/paginates the mobile list identically to the desktop table (same `paginatedItems` source).

- [ ] **Step 3: Verify desktop (>760px) is unchanged**

Widen above 760px and confirm the original table renders exactly as before, including the icon-only Mark Paid/Mark Pending action.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all existing tests still pass — this change touches no domain logic.

- [ ] **Step 5: Clean up any screenshot/scratch files created during manual verification**

If browser automation tooling was used to verify and left screenshot files in the repo root, remove them (`git status --porcelain` should be clean of anything not part of the intended diff) before considering the plan complete.
