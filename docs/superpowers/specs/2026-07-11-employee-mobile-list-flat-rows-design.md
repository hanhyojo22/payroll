# Employee Mobile List — Flat Divided Rows

## Context

The Employees view (`EmployeesView` in `App.tsx`) already has a mobile card list (`EmployeeMobileCardList`, App.tsx:5474-5534) added in recent commits — bordered, shadowed cards shown below `--color-border-light` at ≤760px width, with the desktop `DataTable` hidden at that breakpoint.

The user supplied a reference screenshot of a target list design (numbered rows, colored avatar circles, name/email, department/role shown as pill badges, date + status pill on the right, chevron) and asked to clone it. This spec covers restyling the existing mobile card list to match that reference exactly. The desktop table and the shared `Toolbar` (search box + status filter) are explicitly out of scope.

## Scope

**In scope:** `EmployeeMobileCardList` component (App.tsx) and its CSS (`styles.css`, `.emp-mobile-*` rules, ≤760px media query).

**Out of scope:** Desktop `DataTable`/`.employee-list-panel` table view, `Toolbar`/`search-box`/status `<select>` markup and styling.

## Design

### Row structure (per employee)

Flat, full-bleed row (no card border/shadow/border-radius/background), separated from the next row by a `1px solid var(--color-border-light)` bottom border. The last row has no divider.

Left to right:
1. **Index number** — `1`, `2`, `3`… (1-based position in the filtered/sorted list), muted gray text, fixed narrow width, vertically centered with the avatar.
2. **Avatar** — existing `.employee-list-avatar` circle (photo or initials), unchanged.
3. **Main column** (flex, min-width 0):
   - Name (bold, existing `.emp-mobile-card-name` style)
   - Email (existing `.emp-mobile-card-email` style, or "No email")
   - Badge row: two small pill badges side by side — department and role — each independently truncating/wrapping as needed. Replaces the current single "Dept • Role" text line.
4. **Side column** (right-aligned, flex column): date (existing `.emp-mobile-card-date` style) above the status pill (existing `.emp-status-pill`). The employee ID (`EMP-xxx`) that currently renders here is removed — the reference design doesn't show it.
5. **Chevron** — existing `ChevronRight`, unchanged, vertically centered.

Click-to-open-details and Enter/Space keyboard activation on the row are unchanged.

### New/changed CSS

- `.emp-mobile-card`: remove `border`, `box-shadow`, `border-radius`, `background`; add `border-bottom: 1px solid var(--color-border-light)`; `padding` becomes vertical-only (e.g. `14px 0`); `:last-child` gets `border-bottom: none`. Parent `.emp-mobile-list` padding adjusts so rows are flush with the panel edges horizontally (matching the divider spanning full width) while keeping outer panel padding.
- New `.emp-mobile-card-index`: fixed width (~20px), `color: var(--color-text-tertiary)`, small font size, centered text, `flex: 0 0 auto`.
- New `.emp-mobile-card-badges`: flex row, `gap: 6px`, `flex-wrap: wrap`, `margin-top: 6px` (replaces `.emp-mobile-card-meta`/`.emp-mobile-card-dot`, which become unused and are removed).
- New `.emp-mobile-card-badge`: small pill (`border-radius: 999px`, `padding: 2px 8px`, `font-size: 11px`, `font-weight: 600`), light neutral background (`var(--color-surface-muted)` or similar existing token), `color: var(--color-text-secondary)`.
- `.emp-mobile-card-id` rule and its usage are removed (no longer rendered).

### Component changes (`EmployeeMobileCardList`)

- Map with index; render `employee-mobile-card-index` span with `index + 1`.
- Replace the meta `<span>` (dept `•` role) with a `.emp-mobile-card-badges` div containing one `.emp-mobile-card-badge` span for department (`employee.department || "Unassigned"`) and one for role (`employee.role || "Unassigned"`).
- Remove the `employeeCodeFor` usage/`emp-mobile-card-id` span from the side column (keep the prop plumbing as-is elsewhere in the file since `employeeCodeFor` is also used by the desktop table — just stop rendering it here).

## Testing

Visual-only change in a UI file with no domain logic; no unit tests apply (project test suite covers `src/domain/**` only). Verify manually in the browser at ≤760px width: numbering, badges, divider lines, no per-row border/shadow, right-aligned date+status, chevron, click/keyboard navigation into employee details still works, empty-state message still renders correctly (per the prior fix in commit `1e8c246`).
