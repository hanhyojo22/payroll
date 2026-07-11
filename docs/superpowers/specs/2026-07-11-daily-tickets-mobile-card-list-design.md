# Daily Closed Tickets Mobile Card List

## Context

`DailyTicketEntryView` (`src/App.tsx`, exported at line 3242) renders the "Daily closed tickets" data-entry table (`.table-wrap` > `table.ticket-table`, first occurrence at `App.tsx:3846`). On mobile (≤760px) this table does not get any card-style treatment — it renders as a genuine, unconverted HTML table. In a live check at 390px width, only the "No. / Employee ID / Employee" columns were visible (with names truncated); the actual data-entry columns (per-category ticket counts, Disputed Install, Disputed Repair, Gross, Save/kebab actions) were pushed off-screen behind an undiscoverable horizontal scroll. Since this page's entire purpose is entering ticket counts per employee, this makes the primary workflow effectively unusable on a phone — worse than the other list pages fixed earlier this session, which were read-only.

Unlike Employees/Expenses (simple read-only lists), this table is a **bulk data-entry grid**: each row has one number input per active ticket category for that employee's position (usually 1–2 categories, e.g. "Repair" ₱200/ticket and "Installation" ₱600/ticket, but the count is dynamic per position — see `activeCategories()` at `App.tsx:3388`), plus two more number inputs (Disputed Install / Disputed Repair, each capped to and disabled when its corresponding category total is 0 — `App.tsx:3909-3944`), a live-computed Gross amount, a per-row Save button (enabled only when the row is "dirty" — `isDirty()` at `App.tsx:3523`), and a kebab menu with "View details" (opens the existing ticket history modal, unchanged).

## Scope

**In scope:** the row list only (≤760px), replacing `.table-wrap` > `table.ticket-table` inside `DailyTicketEntryView`.

**Out of scope:** the toolbar above it (date picker, search field, Save All, Refresh — already wraps acceptably via `flex-wrap: wrap`), the position tabs, the ticket history detail modal (`.ticket-detail-modal`, unchanged, already fixed for viewport clipping in an earlier commit this session), and the Subcontractor daily-tickets table (a separate, structurally different table elsewhere in this file — not covered by this spec).

## Design

### Where the code lives

All state this needs — `draftCounts`, `draftDisputes`, `busyEmployeeId`, `savedIds`, `openMenuId`/`menuRef`, `saveDraftAndMark`, `isDirty`, `disputeValuesFor`, `grossFor`, `setDetailEmployee` — already lives as local state/functions inside `DailyTicketEntryView` (`App.tsx:3242-3560`). The mobile card list is inlined as another JSX block directly inside this same function (rendered as a sibling to the existing `.table-wrap`, inside the same `(() => { ... })()` IIFE at `App.tsx:3831-3996` that builds the active position's table), not extracted into a separate component — extracting it would require threading ~10 pieces of tightly-coupled local state through props for no reuse benefit, since this card list is only ever rendered here.

### Card layout (flat divider rows, per the pattern established this session)

Per employee, in the active position group:
1. **Header row:** row number, avatar (photo or initials, reusing `.employee-list-avatar`), name + email (reusing `RecordTitle`), and the live **Gross** amount right-aligned in bold (`currency.format(grossFor(draft))` — identical calculation to desktop, updates as counts change since it derives from the same `draft.counts`/dispute state).
2. **Input grid:** a responsive grid (`repeat(auto-fill, minmax(100px, 1fr))`) of labeled number-input tiles:
   - One tile per active ticket category for the position (`activeCategories(draft.position)`), label = category name + `₱{rate}/ticket` hint (mirroring the desktop `<th>`'s `.ticket-rate-label`), input = the same controlled `<input type="number">` wired to `setDraftCounts`, just touch-sized (≥40px tall vs desktop's 34px).
   - Two more tiles, **Disputed Install** and **Disputed Repair** — same disabled-when-zero-total and max-capped behavior as desktop (`App.tsx:3909-3944`), styled with the same red-tinted border/text desktop uses (`.ticket-count-cell--dispute`) to flag them visually as reducing the count.
3. **Footer row:** a Save button reflecting the same three states desktop shows (`busy` → spinner, `saved` → checkmark, otherwise → enabled-only-if-`dirty` Save icon+label), and the kebab (⋮) button opening "View details" — reusing the exact `.ticket-menu-wrap`/`.ticket-menu-dropdown` pattern already used for this same menu on desktop (`App.tsx:3966-3985`) and for the Expenses mobile kebab.
4. **Dirty/saved tinting:** the whole card gets the same amber-tinted background + left border when dirty, or green tint when just-saved, that desktop's `tr.ticket-row-dirty`/`tr.ticket-row-saved` already use — same color tokens, applied to the card container instead of `<td>`s.

### CSS scoping

Following the lesson learned earlier this session (the `.employee-list-panel` class-reuse bug): the hide-table-on-mobile rule must be scoped narrowly enough that it can't accidentally apply to some other table. Add a distinct marker class (e.g. `ticket-table-wrap`) to this specific `.table-wrap` div (not reused anywhere else), and scope the `display: none` rule to that marker class specifically — mirroring exactly how the Expenses fix (`expense-list-table-wrap`) was scoped, rather than the `:has()` approach used for the Employees-class collision fix (a plain added class is simpler here since there's no pre-existing shared-class ambiguity to route around).

### Testing

No domain logic is touched (all calculations reuse existing functions unchanged) — no `src/domain/**` tests apply. Manual verification: at ≤760px, confirm per-category inputs update the live Gross correctly, Disputed Install/Repair enable/disable and cap correctly, Save button states (disabled/spinner/checkmark) match desktop behavior, the kebab opens the same ticket history modal, dirty/saved tinting matches desktop's colors, and desktop (>760px) is pixel-unchanged. Also confirm the position tabs (when an employee has more than one position group, e.g. Technician I / Technician II) still filter the mobile card list the same way they filter the desktop table today.
