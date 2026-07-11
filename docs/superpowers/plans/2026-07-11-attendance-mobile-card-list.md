# Attendance Mobile Card List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Attendance entry table (`AttendanceView` in `src/App.tsx`) the same bespoke mobile card treatment the Daily Tickets table received earlier this session, at ≤760px.

**Architecture:** Additive JSX inside `AttendanceView` (a card list rendered as a sibling to the existing `.attendance-table-wrap`, reading the same `paginatedEmployees` data and the same local state/handlers the desktop table already uses — no new state, no duplicated business logic) plus new/reused CSS in `src/styles.css`. Maximizes reuse of classes already introduced for the Daily Tickets and Employees mobile cards (`.ticket-mobile-card`, `.ticket-mobile-card-header`, `.ticket-mobile-card-index`, `.ticket-mobile-card-gross`, `.ticket-mobile-card-footer`, `.ticket-mobile-save-button`, `.ticket-mobile-save-status`, `.emp-mobile-card-badge`) rather than inventing parallel ones.

**Tech Stack:** React + TypeScript, plain CSS, existing `lucide-react` icons (`Save`, `CheckCircle2` — already imported in `App.tsx`), existing `formatMoney`/`computeDailyEarnings` helpers already in scope inside `AttendanceView`.

## Global Constraints

- Scope is the row list only (≤760px), inside `AttendanceView`'s render (`App.tsx:5121-5252`). Do not touch the toolbar (date picker, search, status/department filters, Bulk Actions, Save all, Refresh) or the pagination footer.
- Do not add the "Edit" button to the mobile card — it has no `onClick` on desktop (`App.tsx:5218`) and is intentionally left out per the spec.
- The mobile-hide CSS rule targets `.attendance-table-wrap` directly (confirmed a unique class, not reused elsewhere — no `:has()` or marker-class workaround needed here, unlike the Employees-class collision fixed earlier this session).
- No unit tests apply — per CLAUDE.md, `src/domain/**/*.test.ts` is the only tested surface, and no domain logic changes. Verification is manual, in-browser.
- Follow the spec at `docs/superpowers/specs/2026-07-11-attendance-mobile-card-list-design.md`.

---

### Task 1: Add CSS for the Attendance mobile card

**Files:**
- Modify: `src/styles.css` (insert a new block; suggested anchor is right after `.attendance-empty` — search for `.attendance-empty` to find the insertion point, since exact line numbers may have shifted since plan-writing time)

**Interfaces:**
- Produces: `.attendance-mobile-list` (new), `.attendance-mobile-time-row` / `.attendance-mobile-time-field` (new), plus two mobile-scoped touch-target bumps for existing classes (`.attendance-mobile-card .attendance-status-control span`, `.attendance-mobile-card .attendance-time-input`) that only apply inside the new card, leaving the desktop table's use of `.attendance-status-control`/`.attendance-time-input` unchanged.
- Reuses without modification: `.ticket-mobile-card`, `.ticket-mobile-card--dirty`, `.ticket-mobile-card--saved`, `.ticket-mobile-card-header`, `.ticket-mobile-card-index`, `.ticket-mobile-card-gross`, `.ticket-mobile-card-footer`, `.ticket-mobile-save-button`, `.ticket-mobile-save-status`, `.ticket-mobile-save-status--saved` (all from the Daily Tickets mobile card), `.employee-list-identity`, `.employee-list-avatar`, `.record-title`, `.emp-mobile-card-badge` (from the Employees mobile card), `.attendance-status-control` (color variants `.present`/`.half_day`/`.absent`/`.unmarked`), `.attendance-time-input.missing`.

- [ ] **Step 1: Insert the new CSS block**

Find `.attendance-empty { ... }` in `src/styles.css`. Insert the following block immediately after its closing brace:

```css
.attendance-mobile-list {
  display: none;
  flex-direction: column;
  gap: 10px;
}

@media (max-width: 760px) {
  .attendance-table-wrap {
    display: none;
  }

  .attendance-mobile-list {
    display: flex;
  }
}

.attendance-mobile-card .attendance-status-control span {
  font-size: 13px;
  padding: 10px 16px;
}

.attendance-mobile-time-row {
  display: flex;
  gap: 8px;
}

.attendance-mobile-time-field {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  gap: 4px;
}

.attendance-mobile-time-field span {
  color: var(--color-text-secondary);
  font-size: 11px;
  font-weight: 600;
}

.attendance-mobile-card .attendance-time-input {
  height: 40px;
  width: 100%;
}
```

- [ ] **Step 2: Confirm no other file uses the new class names yet (expected)**

Run: `grep -n "attendance-mobile-" src/App.tsx`

Expected: no matches yet — Task 2 introduces them.

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "Add CSS for Attendance mobile card list"
```

---

### Task 2: Add the Attendance mobile card list JSX

**Files:**
- Modify: `src/App.tsx` (inside `AttendanceView`, the `paginatedEmployees.length === 0 ? ... : (<div className="attendance-table-wrap">...)` branch at `App.tsx:5121-5252` as read at plan-writing time)

**Interfaces:**
- Consumes (all already defined/imported in `AttendanceView`, no new props/state): `paginatedEmployees`, `dailyEmployees`, `positions`, `statusFor`, `setStatus`, `timeInFor`, `timeOutFor`, `setTime`, `requiresTimeTracking`, `existingEntries`, `drafts`, `timeDrafts`, `busyEmployeeId`, `saveEntry`, `employeeCode`, `initials`, `statusLabel`, `computeDailyEarnings`, `formatMoney`, `Save`, `CheckCircle2`, `Spinner`.

- [ ] **Step 1: Add the mobile card list after the table**

Find the end of the table and the start of the "no filtered results" message:

```tsx
              </tbody>
            </table>
            {filteredEmployees.length === 0 && (
              <p className="attendance-empty">No employees match the selected filters.</p>
            )}
```

Replace with:

```tsx
              </tbody>
            </table>
            {filteredEmployees.length === 0 && (
              <p className="attendance-empty">No employees match the selected filters.</p>
            )}
            <div className="attendance-mobile-list">
              {paginatedEmployees.map((emp) => {
                const pos = positions.find((p) => p.id === emp.position_id);
                const current = statusFor(emp.id);
                const saved = existingEntries.has(emp.id);
                const dirty = drafts[emp.id] !== undefined || timeDrafts[emp.id] !== undefined;
                const dailyRate = Number(pos?.daily_rate ?? 0);
                const earnings = computeDailyEarnings(dailyRate, current, timeInFor(emp.id), timeOutFor(emp.id));
                const employeeIndex = dailyEmployees.findIndex((item) => item.id === emp.id);
                const busy = busyEmployeeId === emp.id;
                return (
                  <div
                    className={`ticket-mobile-card${dirty ? " ticket-mobile-card--dirty" : saved ? " ticket-mobile-card--saved" : ""}`}
                    key={emp.id}
                  >
                    <div className="ticket-mobile-card-header">
                      <span className="ticket-mobile-card-index">{employeeIndex + 1}</span>
                      <div className="employee-list-identity">
                        <div className="employee-list-avatar">
                          {emp.profile_photo_url ? <img src={emp.profile_photo_url} alt="" /> : <span>{initials(emp.full_name)}</span>}
                        </div>
                        <div className="record-title">
                          <strong>{emp.full_name}</strong>
                          {emp.email && <span>{emp.email}</span>}
                          <span className="emp-mobile-card-badge">{emp.department || "Unassigned"}</span>
                        </div>
                      </div>
                      <strong className="ticket-mobile-card-gross">{formatMoney(earnings)}</strong>
                    </div>
                    <div className={`attendance-status-control ${current || "unmarked"}`}>
                      <span>{statusLabel(current)}</span>
                      <select
                        value={current}
                        onChange={(e) => setStatus(emp.id, e.target.value as AttendanceStatus)}
                        aria-label={`Attendance status for ${emp.full_name}`}
                      >
                        <option value="">No Entry</option>
                        <option value="present">Present</option>
                        <option value="absent">Absent</option>
                        <option value="half_day">On Leave</option>
                      </select>
                    </div>
                    {requiresTimeTracking(current) && (
                      <div className="attendance-mobile-time-row">
                        <label className="attendance-mobile-time-field">
                          <span>Time In</span>
                          <input
                            type="time"
                            className={`attendance-time-input${!timeInFor(emp.id) ? " missing" : ""}`}
                            value={timeInFor(emp.id)}
                            onChange={(e) => setTime(emp.id, "time_in", e.target.value)}
                            aria-label={`Time in for ${emp.full_name}`}
                          />
                        </label>
                        <label className="attendance-mobile-time-field">
                          <span>Time Out</span>
                          <input
                            type="time"
                            className={`attendance-time-input${!timeOutFor(emp.id) ? " missing" : ""}`}
                            value={timeOutFor(emp.id)}
                            onChange={(e) => setTime(emp.id, "time_out", e.target.value)}
                            aria-label={`Time out for ${emp.full_name}`}
                          />
                        </label>
                      </div>
                    )}
                    <div className="ticket-mobile-card-footer">
                      {busy ? (
                        <span className="ticket-mobile-save-status"><Spinner size="small" /> Saving…</span>
                      ) : saved && !dirty ? (
                        <span className="ticket-mobile-save-status ticket-mobile-save-status--saved"><CheckCircle2 size={16} /> Saved</span>
                      ) : (
                        <button
                          className="ticket-mobile-save-button"
                          disabled={!dirty}
                          onClick={() => saveEntry(emp)}
                          type="button"
                          aria-label={`Save attendance for ${emp.full_name}`}
                        >
                          <Save size={15} /> Save
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
```

Note: this duplicates the per-row `pos`/`current`/`saved`/`dirty`/`dailyRate`/`earnings`/`employeeIndex` computation that the desktop `<tbody>` map above it already does. Unlike the Daily Tickets refactor (which had 7 interdependent computed values reused across both views), this is 7 simple one-line lookups with no cross-dependencies — consistent with how the Employees and Expenses mobile cards (added earlier this session) each independently recompute their own simple per-row values rather than sharing a precomputed array. Do not refactor the desktop `<tbody>` map to extract a shared array for this one — that pattern was justified for Daily Tickets by the complexity of `installTotal`/`repairTotal`/`disputes`, which doesn't apply here.

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: exits 0, no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "Add Attendance mobile card list"
```

---

### Task 3: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Verify at ≤760px**

Navigate to Attendance, resize to ≤760px, and confirm:
- The table is hidden; the card list is visible with every employee on the current page present, index numbers matching the desktop table's numbering.
- Each card shows: avatar, name/email, department badge, Daily Earnings (right-aligned).
- Tapping the status pill opens the native picker; selecting Present or On Leave reveals the Time In/Time Out row; selecting Absent or No Entry hides it (matching desktop's `requiresTimeTracking` exactly).
- Daily Earnings updates live as status/time change.
- Clearing a required time value shows the red "missing" state on that input.
- The Save button is disabled until the row is dirty; saving transitions through busy → "Saved", persists (confirm by reloading and checking the desktop table shows the same values), and the card's dirty/saved tint (amber/green) updates accordingly.
- Changing the date, status filter, department filter, or search still filters/paginates the mobile list identically to the desktop table (same `paginatedEmployees` source).

- [ ] **Step 3: Verify desktop (>760px) is unchanged**

Widen above 760px and confirm the original table renders exactly as before.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all existing tests still pass (120/120 as of the last full run in this repo) — this change touches no domain logic.

- [ ] **Step 5: Clean up any screenshot/scratch files created during manual verification**

If browser automation tooling was used to verify and left screenshot files in the repo root, remove them (`git status --porcelain` should be clean of anything not part of the intended diff) before considering the plan complete.
