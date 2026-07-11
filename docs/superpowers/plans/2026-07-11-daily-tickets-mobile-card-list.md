# Daily Tickets Mobile Card List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mobile (≤760px) presentation of the "Daily closed tickets" employee entry table with a card list that preserves full data-entry functionality (per-category count inputs, disputed-count inputs, live gross, save states, kebab menu) — currently only 3 of ~8 columns are visible on a phone, with the actual entry fields hidden behind horizontal scroll.

**Architecture:** Refactor the existing per-row computation inside `DailyTicketEntryView` (`src/App.tsx`) from an inline `.map()` inside the desktop `<tbody>` into a precomputed `rows` array, so both the desktop `<tr>` map and a new mobile card map read from the same computed values (no duplicated logic, no risk of the two views drifting out of sync). New CSS in `src/styles.css` hides the table and shows the card list at ≤760px, scoped via a dedicated marker class (not a shared/reused class — this repo has already hit one bug this session from scoping a mobile-hide rule to a class that turned out to be shared elsewhere).

**Tech Stack:** React + TypeScript, plain CSS, existing `lucide-react` icons (`Save`, `CheckCircle2`, `MoreVertical`, `Eye` — all already imported in `App.tsx`), existing `RecordTitle` component, existing domain helpers (`normalizeTicketCount`, `currency`, `toNumber` — all already imported/in scope).

## Global Constraints

- Scope is the row list only (≤760px), inside `DailyTicketEntryView`'s active-position-group render (`App.tsx:3831-3996`). Do not touch: the toolbar (date picker, search, Save All, Refresh), the position tabs, the ticket history detail modal, or the separate Subcontractor daily-tickets table elsewhere in the file.
- Every computed value the mobile card needs (`dirty`, `busy`, `saved`, `disputes`, `installTotal`, `repairTotal`) must come from the same single computation the desktop row already uses — do not write a second, separately-maintained copy of this logic.
- The mobile-hide CSS rule must use a marker class added only to this specific `.table-wrap` div, not a class reused elsewhere (see `docs/superpowers/specs/2026-07-11-daily-tickets-mobile-card-list-design.md` Context section for why this matters — a prior fix this session had to correct exactly this mistake for the Employees/Subcontractors/Payroll pages).
- No unit tests apply — per CLAUDE.md, `src/domain/**/*.test.ts` is the only tested surface, and no domain logic changes (all calculations are reused verbatim, just relocated). Verification is manual, in-browser.
- Follow the spec at `docs/superpowers/specs/2026-07-11-daily-tickets-mobile-card-list-design.md`.

---

### Task 1: Refactor per-row computation into a shared `rows` array

**Files:**
- Modify: `src/App.tsx:3839-3878` (inside `DailyTicketEntryView`, the active-position-group IIFE)

**Interfaces:**
- Produces: a local `rows` array of `{ draft: PositionTicketDraft; index: number; dirty: boolean; busy: boolean; saved: boolean; disputes: { install: number; repair: number }; installTotal: number; repairTotal: number }`, consumed by both Task 1's updated desktop `<tbody>` map and Task 3's new mobile card map.

- [ ] **Step 1: Insert the `rows` computation**

Find (immediately after `groupTotal` is computed):

```tsx
            const cats = activeCategories(activePosition);
            const groupTotal = activeGroup.drafts.reduce((sum, d) => sum + grossFor(d), 0);
            return (
```

Replace with:

```tsx
            const cats = activeCategories(activePosition);
            const groupTotal = activeGroup.drafts.reduce((sum, d) => sum + grossFor(d), 0);
            const rows = activeGroup.drafts.map((draft, index) => {
              const dirty = isDirty(draft);
              const busy = busyEmployeeId === draft.employee.id;
              const saved = savedIds.has(draft.employee.id);
              const disputes = disputeValuesFor(draft);
              const installTotal = cats
                .filter((cat) => (cat.ticket_type ?? "installation") === "installation")
                .reduce((sum, cat) => sum + normalizeTicketCount(draft.counts[cat.id]), 0);
              const repairTotal = cats
                .filter((cat) => cat.ticket_type === "repair")
                .reduce((sum, cat) => sum + normalizeTicketCount(draft.counts[cat.id]), 0);
              return { draft, index, dirty, busy, saved, disputes, installTotal, repairTotal };
            });
            return (
```

- [ ] **Step 2: Update the desktop `<tbody>` map to consume `rows` instead of recomputing**

Find:

```tsx
                    <tbody>
                      {activeGroup.drafts.map((draft, index) => {
                        const dirty = isDirty(draft);
                        const busy = busyEmployeeId === draft.employee.id;
                        const saved = savedIds.has(draft.employee.id);
                        const disputes = disputeValuesFor(draft);
                        const installTotal = cats
                          .filter((cat) => (cat.ticket_type ?? "installation") === "installation")
                          .reduce((sum, cat) => sum + normalizeTicketCount(draft.counts[cat.id]), 0);
                        const repairTotal = cats
                          .filter((cat) => cat.ticket_type === "repair")
                          .reduce((sum, cat) => sum + normalizeTicketCount(draft.counts[cat.id]), 0);
                        return (
```

Replace with:

```tsx
                    <tbody>
                      {rows.map(({ draft, index, dirty, busy, saved, disputes, installTotal, repairTotal }) => {
                        return (
```

Do not change anything else inside this `.map()` callback (the `<tr>...</tr>` body) — it already references `draft`, `index`, `dirty`, `busy`, `saved`, `disputes`, `installTotal`, `repairTotal` by these exact names, which now come from destructuring instead of local `const`s.

- [ ] **Step 3: Type-check**

Run: `npm run build`
Expected: exits 0 (`tsc --noEmit && vite build`), no type errors. This confirms the destructured names line up with what the existing `<tr>` body expects.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "Extract Daily Tickets per-row computation into a shared rows array"
```

---

### Task 2: Add `.ticket-mobile-*` CSS

**Files:**
- Modify: `src/styles.css` (insert a new block; suggested anchor is right after the existing `.ticket-row-saved td` / `.ticket-saved-icon` rules — search for `.ticket-saved-icon` to find the insertion point, since exact line numbers may have shifted since plan-writing time)

**Interfaces:**
- Produces CSS classes consumed by Task 3's JSX: `.ticket-table-wrap` (marker class added to the existing `.table-wrap` div — not a new container), `.ticket-mobile-list`, `.ticket-mobile-card`, `.ticket-mobile-card--dirty`, `.ticket-mobile-card--saved`, `.ticket-mobile-card-header`, `.ticket-mobile-card-index`, `.ticket-mobile-card-gross`, `.ticket-mobile-input-grid`, `.ticket-mobile-input-tile`, `.ticket-mobile-input-tile--dispute`, `.ticket-mobile-card-footer`, `.ticket-mobile-save-button`, `.ticket-mobile-save-status`, `.ticket-mobile-save-status--saved`.
- Reuses existing classes/tokens without modification: `.employee-list-identity`, `.employee-list-avatar`, `.ticket-menu-wrap`/`.ticket-menu-dropdown` (kebab dropdown chrome), `.expense-mobile-kebab` (kebab trigger button — already generic, introduced for the Expenses mobile card list earlier this session), `var(--color-surface)`, `var(--color-border-light)`, `var(--radius-lg)`, `var(--radius-sm)`, `var(--color-text-secondary)`, `var(--color-text-tertiary)`, `var(--color-accent)`, `var(--color-surface-secondary)`.

- [ ] **Step 1: Insert the new CSS block**

Find `.ticket-saved-icon { color: #12b76a; }` in `src/styles.css`. Insert the following block immediately after it:

```css
.ticket-mobile-list {
  display: none;
  flex-direction: column;
  gap: 10px;
}

@media (max-width: 760px) {
  .ticket-table-wrap {
    display: none;
  }

  .ticket-mobile-list {
    display: flex;
  }
}

.ticket-mobile-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
}

.ticket-mobile-card--dirty {
  background: #fffbeb;
  border-color: #f79009;
  border-left-width: 3px;
}

.ticket-mobile-card--saved {
  background: #f0fdf4;
}

.ticket-mobile-card-header {
  align-items: center;
  display: flex;
  gap: 10px;
}

.ticket-mobile-card-index {
  color: var(--color-text-tertiary);
  flex: 0 0 auto;
  font-size: 12px;
  text-align: center;
  width: 18px;
}

.ticket-mobile-card-header .employee-list-identity {
  flex: 1 1 auto;
}

.ticket-mobile-card-gross {
  color: var(--color-text);
  flex: 0 0 auto;
  font-size: 15px;
  font-weight: 700;
  white-space: nowrap;
}

.ticket-mobile-input-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
}

.ticket-mobile-input-tile {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ticket-mobile-input-tile span {
  color: var(--color-text-secondary);
  font-size: 11px;
  font-weight: 600;
}

.ticket-mobile-input-tile span small {
  color: var(--color-text-tertiary);
  display: block;
  font-size: 10px;
  font-weight: 500;
}

.ticket-mobile-input-tile input[type="number"] {
  -moz-appearance: textfield;
  appearance: textfield;
  border: 1px solid #dfe5ef;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  height: 40px;
  text-align: center;
  width: 100%;
}

.ticket-mobile-input-tile input[type="number"]::-webkit-inner-spin-button,
.ticket-mobile-input-tile input[type="number"]::-webkit-outer-spin-button {
  -webkit-appearance: none;
}

.ticket-mobile-input-tile input[type="number"]:focus {
  border-color: #006ffd;
  box-shadow: 0 0 0 3px rgba(0, 111, 253, .12);
}

.ticket-mobile-input-tile--dispute input[type="number"] {
  border-color: #fecaca;
  color: #b42318;
}

.ticket-mobile-input-tile--dispute input[type="number"]:focus {
  border-color: #f04438;
  box-shadow: 0 0 0 3px rgba(240, 68, 56, .12);
}

.ticket-mobile-card-footer {
  align-items: center;
  border-top: 1px solid var(--color-border-light);
  display: flex;
  gap: 10px;
  justify-content: space-between;
  padding-top: 12px;
}

.ticket-mobile-save-button {
  align-items: center;
  background: var(--color-accent);
  border: none;
  border-radius: var(--radius-sm);
  color: #fff;
  display: inline-flex;
  font-size: 13px;
  font-weight: 700;
  gap: 6px;
  height: 38px;
  padding: 0 14px;
}

.ticket-mobile-save-button:disabled {
  background: var(--color-surface-secondary);
  color: var(--color-text-tertiary);
}

.ticket-mobile-save-status {
  align-items: center;
  color: var(--color-text-secondary);
  display: inline-flex;
  font-size: 13px;
  font-weight: 600;
  gap: 6px;
}

.ticket-mobile-save-status--saved {
  color: #12b76a;
}
```

- [ ] **Step 2: Confirm no other file uses the new class names yet (expected)**

Run: `grep -n "ticket-mobile-\|ticket-table-wrap" src/App.tsx`

Expected: no matches yet — Task 3 introduces them. This just confirms there's no naming collision with existing code.

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "Add CSS for Daily Tickets mobile card list"
```

---

### Task 3: Add the mobile card list JSX

**Files:**
- Modify: `src/App.tsx` (the `.table-wrap` div at `App.tsx:3846` as read at plan-writing time, and the closing of that div at `App.tsx:3993`)

**Interfaces:**
- Consumes: the `rows` array from Task 1, `cats` (already in scope), `saveDraftAndMark`, `openMenuId`/`setOpenMenuId`/`menuRef`, `setDetailEmployee`, `setDraftCounts`, `setDraftDisputes`, `normalizeTicketCount`, `currency`, `toNumber`, `grossFor` — all already defined/imported in `DailyTicketEntryView`.

- [ ] **Step 1: Mark the table wrapper**

Find:

```tsx
                <div className="table-wrap">
                  <table className="ticket-table">
```

Replace with:

```tsx
                <div className="table-wrap ticket-table-wrap">
                  <table className="ticket-table">
```

- [ ] **Step 2: Add the mobile card list after the table wrapper**

Find the end of the table wrapper and the section's closing tag:

```tsx
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })()}
```

Replace with:

```tsx
                    </tbody>
                  </table>
                </div>
                <div className="ticket-mobile-list">
                  {rows.map(({ draft, index, dirty, busy, saved, disputes, installTotal, repairTotal }) => (
                    <div
                      className={`ticket-mobile-card${dirty ? " ticket-mobile-card--dirty" : saved ? " ticket-mobile-card--saved" : ""}`}
                      key={draft.employee.id}
                    >
                      <div className="ticket-mobile-card-header">
                        <span className="ticket-mobile-card-index">{index + 1}</span>
                        <div className="employee-list-identity">
                          <div className="employee-list-avatar">
                            {draft.employee.profile_photo_url
                              ? <img alt="" src={draft.employee.profile_photo_url} />
                              : <span>{draft.employee.full_name.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "E"}</span>}
                          </div>
                          <RecordTitle title={draft.employee.full_name} notes={draft.employee.email || "No email"} />
                        </div>
                        <strong className="ticket-mobile-card-gross">{currency.format(grossFor(draft))}</strong>
                      </div>
                      <div className="ticket-mobile-input-grid">
                        {cats.map((cat) => (
                          <label className="ticket-mobile-input-tile" key={cat.id}>
                            <span>{cat.name} <small>₱{toNumber(cat.rate).toLocaleString()}/ticket</small></span>
                            <input
                              aria-label={`${cat.name} tickets for ${draft.employee.full_name}`}
                              min="0"
                              step="1"
                              type="number"
                              value={draft.counts[cat.id] ?? 0}
                              onChange={(e) => setDraftCounts((current) => ({
                                ...current,
                                [draft.employee.id]: {
                                  ...(current[draft.employee.id] ?? draft.counts),
                                  [cat.id]: normalizeTicketCount(e.target.value),
                                },
                              }))}
                            />
                          </label>
                        ))}
                        <label className="ticket-mobile-input-tile ticket-mobile-input-tile--dispute">
                          <span>Disputed Install</span>
                          <input
                            aria-label={`Disputed installation tickets for ${draft.employee.full_name}`}
                            disabled={installTotal === 0}
                            max={installTotal}
                            min="0"
                            step="1"
                            type="number"
                            value={Math.min(installTotal, normalizeTicketCount(disputes.install))}
                            onChange={(e) => setDraftDisputes((current) => ({
                              ...current,
                              [draft.employee.id]: {
                                install: Math.min(installTotal, normalizeTicketCount(e.target.value)),
                                repair: current[draft.employee.id]?.repair ?? draft.entry?.disputed_repair ?? 0,
                              },
                            }))}
                          />
                        </label>
                        <label className="ticket-mobile-input-tile ticket-mobile-input-tile--dispute">
                          <span>Disputed Repair</span>
                          <input
                            aria-label={`Disputed repair tickets for ${draft.employee.full_name}`}
                            disabled={repairTotal === 0}
                            max={repairTotal}
                            min="0"
                            step="1"
                            type="number"
                            value={Math.min(repairTotal, normalizeTicketCount(disputes.repair))}
                            onChange={(e) => setDraftDisputes((current) => ({
                              ...current,
                              [draft.employee.id]: {
                                install: current[draft.employee.id]?.install ?? draft.entry?.disputed_install ?? 0,
                                repair: Math.min(repairTotal, normalizeTicketCount(e.target.value)),
                              },
                            }))}
                          />
                        </label>
                      </div>
                      <div className="ticket-mobile-card-footer">
                        {busy ? (
                          <span className="ticket-mobile-save-status"><Spinner size="small" /> Saving…</span>
                        ) : saved ? (
                          <span className="ticket-mobile-save-status ticket-mobile-save-status--saved"><CheckCircle2 size={16} /> Saved</span>
                        ) : (
                          <button
                            className="ticket-mobile-save-button"
                            disabled={!dirty}
                            onClick={() => void saveDraftAndMark(draft)}
                            type="button"
                          >
                            <Save size={15} /> Save
                          </button>
                        )}
                        <div className="ticket-menu-wrap" ref={openMenuId === draft.employee.id ? menuRef : undefined}>
                          <button
                            aria-label="More actions"
                            className="expense-mobile-kebab"
                            onClick={() => setOpenMenuId((prev) => prev === draft.employee.id ? "" : draft.employee.id)}
                            type="button"
                          >
                            <MoreVertical size={15} />
                          </button>
                          {openMenuId === draft.employee.id && (
                            <div className="ticket-menu-dropdown">
                              <button onClick={() => { setDetailEmployee(draft.employee); setOpenMenuId(""); }} type="button">
                                <Eye size={14} /> View details
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })()}
```

- [ ] **Step 3: Type-check**

Run: `npm run build`
Expected: exits 0, no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "Add Daily Tickets mobile card list"
```

---

### Task 4: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Verify at ≤760px**

Navigate to Daily Tickets, resize to ≤760px, and confirm:
- The table is hidden; the card list is visible with every employee row present.
- Each card shows: index, avatar, name/email, live Gross (right-aligned).
- Typing into a category count input updates that card's Gross immediately (same calculation as desktop).
- Disputed Install/Repair inputs are disabled (greyed) when their respective category total is 0, and become enabled once a count is entered — capped at that total, matching desktop.
- The Save button is disabled until the row is dirty; clicking it shows the busy spinner, then a "Saved" checkmark state (matching desktop's `saveDraftAndMark` behavior), and the card gets the dirty (amber) / saved (green) tint at the right times.
- Tapping ⋮ opens a menu with "View details"; selecting it opens the same ticket history modal the desktop kebab opens, with correct data for that employee.
- If there's more than one position tab (e.g. Technician I / Technician II), switching tabs updates the mobile card list the same way it updates the desktop table today.

- [ ] **Step 3: Verify desktop (>760px) is unchanged**

Widen above 760px and confirm the original table renders exactly as before — same columns, same inputs, same Save/kebab behavior.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all existing tests still pass (120/120 as of the last full run in this repo) — this change touches no domain logic.

- [ ] **Step 5: Clean up any screenshot/scratch files created during manual verification**

If browser automation tooling was used to verify and left screenshot files in the repo root, remove them (`git status --porcelain` should be clean of anything not part of the intended diff) before considering the plan complete.
