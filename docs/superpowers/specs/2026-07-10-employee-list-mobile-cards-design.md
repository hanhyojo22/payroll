# Employee List — mobile card redesign

Date: 2026-07-10

## Problem

`EmployeesView` (`src/App.tsx`) renders the employee list with the shared
`<DataTable>` component (`src/shared/components/DataTable.tsx`), which sets
a `data-label` attribute on every `<td>` so the site-wide mobile CSS
(`styles.css`, the `@media (max-width: 640px)` block starting around line
7780) can convert the `<table>` into stacked label/value "cards" — the same
generic fallback used by every other table in the app.

On the Employees page specifically, this generic fallback produces seven
stacked label/value rows per employee (No., Employee ID, Employee,
Department, Position, Date Hired, Status) inside a bordered box. It's
functional but generic — it doesn't read as a purpose-built mobile card,
and there's no way to reach a distinctive "modern SaaS" look by restyling
label/value rows alone (no room for an avatar-led identity row, chip-style
metadata, or a right-aligned status/date stack).

## Scope

Mobile-only, additive. The desktop `<DataTable>` in `EmployeesView` is not
modified in any way — same markup, same CSS, same columns. A new
mobile-only card list renders alongside it; a CSS media query shows
exactly one of the two at any given width. No changes to `EmployeeDetailsView`,
`EmployeeForm`, filtering/search logic, or the employee data model.

## Design

### 1. Component

Add `EmployeeMobileCardList` (new function, colocated in `src/App.tsx` next
to `EmployeesView`, same file the desktop table lives in — consistent with
how `DailyTicketEntryView`/`SubconDailyTicketView` etc. are colocated
rather than extracted into `src/features/`). It receives the same `rows`
(filtered `Employee[]`) and helper functions (`employeeCodeFor`,
`employeeInitialsFor`) already computed in `EmployeesView`, and an
`onOpenDetails(employee)` callback (wired to the existing
`setDetailsEmployee`, identical to the table's `onRowClick`).

`EmployeesView` renders both:

```tsx
<DataTable ... />                          {/* unchanged, desktop */}
<EmployeeMobileCardList
  employees={rows}
  employeeCodeFor={employeeCodeFor}
  employeeInitialsFor={employeeInitialsFor}
  onOpenDetails={setDetailsEmployee}
/>
```

### 2. Card layout (per employee)

Matches the approved mockup (variant D2), one card per employee, tappable:

```
┌──────────────────────────────────────────────────┐
│ (avatar)  Jemon Montecillo            EMP-0001    │
│           montecillo@gmail.com        Jul 4, 2026 │
│           Telco • Technician I          [Active] ›│
└──────────────────────────────────────────────────┘
```

- **Left**: avatar (photo if `profile_photo_url`, else initials via
  `employeeInitialsFor`, reusing the existing `.employee-list-avatar`
  circle style) + name (bold) + email (muted, small) on the first two
  lines, then a metadata line: `{Department} • {Position}`, each falling
  back to `"Unassigned"` when empty — identical to the desktop table's
  `employee.department || "Unassigned"` / `employee.role || "Unassigned"`.
- **Right**, stacked and right-aligned: Employee ID (small, muted, via
  `employeeCodeFor`) above Date Hired (same `MMM d, yyyy` formatting
  already computed inline in the table's `rows.map`, falling back to `"—"`
  when `hire_date` is empty, matching the desktop table exactly), then the
  status pill reusing the existing
  `.emp-status-pill.active`/`.emp-status-pill.inactive` classes verbatim
  (no new status styling).
- **Far right**: a static chevron (`ChevronRight` from `lucide-react`,
  already imported in `App.tsx`) signaling the card is tappable.
- **"No."** (the table's row-position column) is dropped from the card
  face — it's a list-rendering artifact, not employee data, and doesn't
  appear in the approved reference. It remains visible in
  `EmployeeDetailsView` via the existing table if needed later, but no
  such display currently exists there either, so this is a pure omission,
  not a regression.

Whole `<div>` card has `onClick={() => onOpenDetails(employee)}` and
`role="button"`/`tabIndex={0}`/`onKeyDown` (Enter/Space) for keyboard and
a11y parity with the table's existing clickable-row pattern in
`DataTable.tsx`.

### 3. Styling

New classes, all built from existing design tokens (no new colors):

- `.emp-mobile-list` — the card list wrapper, `display: none` by default
  (hidden on desktop).
- `.emp-mobile-card` — `background: var(--color-surface); border: 1px
  solid var(--color-border-light); border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm); padding: 14px;` flex row layout (avatar +
  main column + side column + chevron).
- `.emp-mobile-card-main` — name/email/meta-line column, `min-width: 0`
  (prevents the flex-shrink overflow bug fixed earlier this week on
  Attendance/Daily Tickets).
- `.emp-mobile-card-meta` — the `Department • Position` line: `font-size:
  var(--font-size-sm); color: var(--color-text-secondary);` with a `•`
  separator matching the reference image.
- `.emp-mobile-card-side` — right column, `align-items: flex-end`, reuses
  `.emp-status-pill` unchanged.

These live inside the *existing* `@media (max-width: 760px)` block already
present for `.employee-list-panel` (`styles.css` ~line 4674), matching
this page's already-established breakpoint (confirmed with the user —
same cutoff as every other mobile override in the app, not the site-wide
640px table-card breakpoint, since this page defines its own 760px block
already). Inside that same block:

- `.employee-list-panel .table-wrap { display: none; }` — hides the
  desktop table only below 760px.
- `.emp-mobile-list { display: flex; flex-direction: column; gap: 10px; }`
  — shows the card list only below 760px.

Desktop (>760px) is untouched: the table-wrap's default `display` is
whatever it already is today, and `.emp-mobile-list`'s base rule keeps it
`display: none`.

### 4. Interaction

Identical to today — tapping/clicking a card opens `EmployeeDetailsView`,
same as clicking a table row. No new state, no new modals, no quick
actions on the card face (confirmed with the user — tap-to-open only).

## Testing

Per this project's conventions (UI-only change, no domain logic): `npx tsc
--noEmit`, `npm test` (confirms the existing domain suite is unaffected —
this page has no domain-layer logic of its own). Manual/agent-driven
verification via the Playwright browser tool: screenshot at ~390px width
confirming the card list renders correctly with no horizontal overflow
(same `scrollWidth` check used for the recent Attendance/Daily Tickets
fixes), and a desktop-width (≥1280px) screenshot confirming the
`<DataTable>` renders pixel-identical to before this change.
