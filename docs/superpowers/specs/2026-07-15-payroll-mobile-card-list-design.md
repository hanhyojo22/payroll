# Payroll Mobile Card List

## Context

`PayrollItemsTable` (`src/features/payroll/PayrollFeature.tsx:1237-1377`) renders the active payroll run's per-employee items via the shared `DataTable` component (`src/shared/components/DataTable.tsx`) — columns: No., Employee ID, Employee (avatar + name/email), Pay Basis (+ notes), Gross, Deductions, Net (+ allowance), Status, and a Mark Paid/Mark Pending action. `DataTable` is generic and shared by several other views (Salary Bonds, Payment Reminders) that have no mobile card treatment yet, so it cannot be changed — any mobile-only behavior has to be scoped to Payroll specifically, the same way Employees scoped its own card list without touching `DataTable`.

This came out of a mobile UI/UX audit (2026-07-15) that found only Employees, Daily Tickets, and Expenses had dedicated mobile card layouts; every other data view — including Payroll, the highest-traffic financial screen — falls back to the app's generic `table→stacked-rows` CSS reflow. Payroll was chosen as the first of the remaining views to receive a real card list, reusing the `.ticket-mobile-card` shell that Daily Tickets introduced and Attendance already proved out for a structurally different view, rather than adding a fourth one-off card family.

The audit's touch-target finding (icon-only row actions under ~44px) also applies directly to this table's Mark Paid/Pending button (`App.tsx` — rendered via `.row-actions button`, icon-only, 16px icon in a 38px baseline button), so the new card resolves that for this view as part of the same change.

## Scope

**In scope:** the active Payroll Run items list only (`PayrollItemsTable`, ≤900px per the documented breakpoint tier for phones — see note below on breakpoint choice), replacing the `DataTable`-rendered `<table>` with a card list on mobile.

**Out of scope:** the read-only Payroll History table (`.ph-table`, `PayrollFeature.tsx:1613-1648`) — stays as the generic reflow fallback, per explicit scoping decision. Also out of scope: `Toolbar` (search + status filter), the `.attendance-footer` pagination controls, and any change to `DataTable.tsx` or the payroll run generation/mark-paid domain logic — all reused verbatim.

**Breakpoint:** the existing card-list views (Employees, Daily Tickets, Attendance, Expenses) all switch at 760px, an undocumented but consistent value across all prior mobile-card work. This spec follows that precedent for consistency with the other three card views, rather than the documented-but-unused 640/900px tiers — reconciling the two is a separate breakpoint-cleanup effort the user already deferred.

## Design

### Where the code lives

`PayrollItemsTable` already holds all the state and handlers the card needs: `paginatedItems`, `employees`, `empCode`, `payBasis()`, `handleMarkPaid`/`handleMarkPending`, and the `EmpAvatar`/`RecordTitle` components already used by the desktop row. The mobile card list is added as a sibling to the existing `<DataTable ... />` call inside the same `<section className="panel employee-list-panel">` (`PayrollFeature.tsx:1306-1353`), not extracted into a separate component — same rationale as Attendance/Daily Tickets: the state is local to this component and not reused elsewhere.

### Card layout (reusing the `.ticket-mobile-card` shell)

Per item, in `paginatedItems` order (same list/pagination the desktop table uses):

1. **Header** (`.ticket-mobile-card-header`): index number (`payrollPageStart + index + 1`, matching the desktop "No." column) in `.ticket-mobile-card-index`; employee identity (`.employee-list-identity` with `EmpAvatar` + `RecordTitle`, identical to the desktop cell); **Net Pay** right-aligned in `.ticket-mobile-card-gross` — the headline number, matching how Daily Tickets/Attendance lead with their primary figure.
2. **Body:** a pay-basis line showing the same string `payBasis(item)` already computed for desktop (e.g. "142 tickets", "Base ₱8,000 + 12 tickets"), with `item.notes` shown below in smaller text when present — same content as the desktop `.payroll-basis-cell`, new class `.payroll-mobile-card-basis` (simple text block, no new interaction). A deductions line (`Deductions: ₱X`) shown only when `toNumber(item.deductions) > 0`, and an allowance line (`+₱X allowance`) shown only when `toNumber(item.allowances) > 0` — both currently shown on desktop only inside the Net cell; on the card they get their own lines for readability, new class `.payroll-mobile-card-meta`.
3. **Footer** (`.ticket-mobile-card-footer`): a status pill on one side (`.emp-status-pill active|inactive`, same classes/logic as desktop's Status column) and, on the other, the Mark Paid / Mark Pending action rebuilt as a **full-width labeled button** ("Mark Paid" / "Mark Pending", not icon-only) — this directly fixes the icon-only-button touch-target finding from the audit for this view. Same `handleMarkPaid`/`handleMarkPending` confirmation-dialog flow as desktop, unchanged.

No field is dropped: every desktop column (No., Employee ID via `empCode`, Employee, Pay Basis, Gross, Deductions, Net, Allowance, Status, Action) has a home on the card. Gross is shown in the body alongside Deductions/Net rather than as its own headline, since Net Pay is the number that matters most at a glance (what the employee actually receives) — consistent with the desktop table's own visual weighting, which already bolds Net and not Gross.

### CSS scoping

`PayrollItemsTable`'s table already lives inside `<section className="panel employee-list-panel">` (`PayrollFeature.tsx:1306`) — the same wrapper class Employees uses. The existing hide-rule is scoped specifically to `:has(.emp-mobile-list)`, so it won't accidentally apply here; a new rule is added following the identical pattern:

```css
.employee-list-panel:has(.payroll-mobile-list) .table-wrap {
  display: none;
}

.payroll-mobile-list {
  display: none;
}

@media (max-width: 760px) {
  .payroll-mobile-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
}
```

This means: no changes to `DataTable.tsx`, no changes to the Employees rule, and Salary Bonds/Payment Reminders (which also render through `DataTable` inside their own differently-classed wrappers) are entirely unaffected.

### Testing

No domain logic is touched — `payBasis()`, `handleMarkPaid`, `handleMarkPending`, `empCode`, and all currency formatting are reused verbatim, so no `src/domain` changes and no new domain tests are needed. Manual verification: at ≤760px, confirm the card list renders in place of the table with pagination/search/status-filter still working identically to desktop, Mark Paid/Mark Pending buttons trigger the same confirmation dialogs and produce the same state update as the desktop action, the status pill reflects the item's current status after the action completes, and desktop (>760px) is pixel-unchanged. Also confirm the new mobile input/touch-target CSS fixes already committed (44px targets, no `:has()` conflicts) still hold with this addition.
