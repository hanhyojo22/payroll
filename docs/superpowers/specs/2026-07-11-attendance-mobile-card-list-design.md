# Attendance Mobile Card List

## Context

`AttendanceView` (`src/App.tsx`, exported at line 4677) renders a per-employee daily attendance entry table (`.attendance-table-wrap` > `table.attendance-table`, at `App.tsx:5124-5125`). Unlike the Daily Tickets table fixed earlier this session, this one is not currently *broken* on mobile — its `<td>` cells already carry `data-label` attributes, and its wrapper uses a unique class (`attendance-table-wrap`) not affected by the `.table-wrap`/`.employee-list-panel` hide-rule bugs fixed earlier — so it already falls back to the app's generic labeled stacked-row view at ≤640px. This request is to give it the same bespoke, touch-friendly card treatment the Daily Tickets table just received, following the same conventions.

Each row lets the admin: pick a status (No Entry / Present / Absent / On Leave) via a colored pill that has a fully transparent `<select>` absolutely positioned over it (`.attendance-status-control` — the whole pill is the tap target, not just a small dropdown arrow), enter Time In/Time Out (only shown when status is Present or On Leave, per `requiresTimeTracking()` at `App.tsx:4820`), see a computed read-only Daily Earnings figure, see a derived Remarks string, and Save the row (enabled only when dirty). There is also a currently-non-functional "Edit" icon button next to Save (`App.tsx:5218` — no `onClick` handler at all); this spec does not replicate it into the new card, since there's nothing for it to do.

## Scope

**In scope:** the row list only (≤760px), replacing `.attendance-table-wrap` > `table.attendance-table` inside `AttendanceView`.

**Out of scope:** the toolbar (date picker, search, status/department filters, Bulk Actions, Save all, Refresh — already reasonably responsive), pagination footer, and the dead Edit button (left as-is on desktop, not carried into the new card).

## Design

### Where the code lives

All needed state/handlers — `statusFor`, `setStatus`, `timeInFor`/`timeOutFor`/`setTime`, `requiresTimeTracking`, `saveEntry`, `busyEmployeeId`, `drafts`/`timeDrafts` (for the dirty check), `existingEntries` (for the saved check), `computeDailyEarnings`, `formatMoney`, `initials`, `employeeCode` — already live as local state/functions inside `AttendanceView`. The mobile card list is inlined as a sibling to `.attendance-table-wrap` inside the same `paginatedEmployees.length === 0 ? ... : (...)` branch, not extracted into a separate component, for the same reason as the Daily Tickets card: the state is tightly coupled and only ever used here.

### Card layout (matching the Daily Tickets card conventions)

Per employee, in `paginatedEmployees` order (same list the desktop table renders, so pagination/filtering already matches):
1. **Header row:** row number (`employeeIndex + 1`, same `dailyEmployees.findIndex` lookup the desktop row already does), avatar (photo or initials, reusing `.employee-list-avatar`), name + email (reusing `RecordTitle`), and **Daily Earnings** right-aligned in bold — the same `computeDailyEarnings(dailyRate, current, timeInFor(emp.id), timeOutFor(emp.id))` calculation, formatted with the same `formatMoney`.
2. **Department badge:** a small pill under the name showing `emp.department || "Unassigned"` — the desktop table shows this as its own column; on the card it's a compact badge (reusing the `.expense-mobile-badge`-style small pill treatment already established for Expenses, not a new pattern).
3. **Status row:** label "Status" + the existing `.attendance-status-control` pill-with-overlaid-select, reused as-is (same colors per status: present/half_day/absent/unmarked), just sized up for a touch target (~40px tall vs desktop's ~26px).
4. **Time row:** shown only when `requiresTimeTracking(current)` is true (mirrors desktop exactly) — two `type="time"` inputs side by side, labeled "Time In" / "Time Out", reusing the existing `.attendance-time-input`/`.attendance-time-input.missing` classes for the red missing-value state.
5. **Footer:** a Save button (same disabled-until-dirty, busy-spinner behavior as `saveEntry`/`busyEmployeeId` already drive on desktop) and, when `saved && !dirty`, the same "Saved" indicator desktop shows (reusing `.attendance-saved-text`, or the checkmark treatment from the Daily Tickets card for visual consistency — see plan for the final choice).

Remarks (the derived "No Entry"/"Half Day"/"--" text) is not shown as its own row — it's redundant with the Status pill already on the card, and Daily Tickets' card similarly dropped no functionally-informative fields, only ones already conveyed elsewhere.

### CSS scoping

`.attendance-table-wrap` is a unique class (confirmed via search — used nowhere else in the codebase), so the hide-at-mobile rule can target it directly without needing the `:has()` workaround used for the Employees-class collision, or a newly-added marker class like the Expenses/Daily-Tickets fixes needed.

### Testing

No domain logic is touched (all calculations reused verbatim). Manual verification: at ≤760px, confirm status pill changes correctly change the pill color and reveal/hide the time inputs, Daily Earnings recalculates live as status/time change, Save is disabled until dirty and correctly persists (matching what the desktop table shows for the same employee after a reload), the missing-time red state shows correctly, and desktop (>760px) is pixel-unchanged.
