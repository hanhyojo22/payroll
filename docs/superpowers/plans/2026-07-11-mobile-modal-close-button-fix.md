# Mobile Modal Close Button Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the confirmed CSS selector bug that prevents the mobile touch-target enlargement from reaching ~20 of the app's ~23 modals, bump the mobile close-button target to 44×44px, extend the tight/bottom-sheet modal treatment from 640px to 760px, and fix two one-off unstyled close buttons (Billing's `.cbf-close-btn`, the Ticket History modal's `icon-button`).

**Architecture:** A CSS-only fix in `src/styles.css` (remove two modal-specific lines from the existing `@media (max-width: 640px)` block, add one new consolidated `@media (max-width: 760px)` block near the base modal rules), plus a 1-line JSX fix in `App.tsx` to drop an unstyled class and add a missing `aria-label`. No modal layout, content, or business logic changes.

**Tech Stack:** Plain CSS, React/TypeScript (one JSX attribute change).

## Global Constraints

- Do not change any modal's body content, field layout, or spacing — only the close-button touch target and the bottom-sheet/padding breakpoint.
- Do not change desktop (>760px) modal or close-button sizing — it stays at 38×38px, unchanged.
- Do not change `.row-actions button`'s own mobile sizing (unrelated to modals; stays at 640px, untouched).
- Follow the spec at `docs/superpowers/specs/2026-07-11-mobile-modal-close-button-fix-design.md`.

---

### Task 1: Fix the CSS — selector bug, 44px target, 760px breakpoint

**Files:**
- Modify: `src/styles.css:7994-8009` (remove modal-specific lines from the `@media (max-width: 640px)` block)
- Modify: `src/styles.css` (insert a new `@media (max-width: 760px)` block near the base `/* ── Modal ── */` rules, i.e. right after the base `.modal { ... }` rule ending at line 7152 as read at plan-writing time)

**Interfaces:**
- Produces: a corrected, consolidated mobile modal ruleset (`.modal-backdrop`, `.modal`, `.modal header button`, `.modal-header button`, `.cbf-close-btn`) inside one `@media (max-width: 760px)` block. No other file depends on new class names — this only changes existing selectors' behavior.

- [ ] **Step 1: Remove the modal-specific lines from the 640px block**

Find (inside the `@media (max-width: 640px)` block that starts at `src/styles.css:7509` as read at plan-writing time):

```css
  .row-actions button,
  .modal header button {
    height: 40px;
    min-height: 40px;
    width: 40px;
  }

  .modal-backdrop {
    align-items: flex-end;
    padding: 10px;
  }

  .modal {
    max-height: calc(100vh - 20px);
    padding: 18px;
  }

  .form-actions {
```

Replace with:

```css
  .row-actions button {
    height: 40px;
    min-height: 40px;
    width: 40px;
  }

  .form-actions {
```

(This removes `.modal header button` from the row-actions rule — leaving `.row-actions button` alone, unchanged — and removes the `.modal-backdrop`/`.modal` rules entirely, since Step 2 replaces them at a wider 760px breakpoint.)

- [ ] **Step 2: Add the new consolidated 760px modal block**

Find the base modal rule (immediately after the `/* ── Modal ── */` comment):

```css
.modal {
  max-height: calc(100vh - 40px);
  max-width: 680px;
  overflow-y: auto;
  padding: 24px;
  width: 100%;
}
```

Insert immediately after it (before `.modal header,` / `.modal-header {`):

```css

@media (max-width: 760px) {
  .modal-backdrop {
    align-items: flex-end;
    padding: 10px;
  }

  .modal {
    max-height: calc(100vh - 20px);
    padding: 18px;
  }

  .modal header button,
  .modal-header button,
  .cbf-close-btn {
    height: 44px;
    min-height: 44px;
    width: 44px;
  }
}
```

- [ ] **Step 3: Type-check and build**

Run: `npm run build`
Expected: exits 0 (`tsc --noEmit && vite build`) — this is a CSS-only change, but running the build confirms Vite processes the stylesheet without error.

- [ ] **Step 4: Commit**

```bash
git add src/styles.css
git commit -m "Fix mobile modal close-button selector bug and extend tight layout to 760px"
```

---

### Task 2: Fix the Ticket History modal's unstyled close button

**Files:**
- Modify: `src/App.tsx:4031` (as read at plan-writing time)

**Interfaces:** none — this is a local JSX attribute fix with no external dependents.

- [ ] **Step 1: Replace the button's className with the standard pattern**

Find:

```tsx
                <button className="icon-button" type="button" onClick={() => setDetailEmployee(null)}>
                  <X size={18} />
                </button>
```

Replace with:

```tsx
                <button aria-label="Close" type="button" onClick={() => setDetailEmployee(null)}>
                  <X size={18} />
                </button>
```

This button is already inside a `<div className="modal-header">` (line 4029), so dropping the unstyled `icon-button` class lets it inherit the standard `.modal-header button` styling (base 38×38px on desktop, 44×44px on mobile per Task 1) automatically. The added `aria-label="Close"` matches every other modal close button in the app (all of which already have one).

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: exits 0, no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "Fix unstyled close button on the Ticket History modal"
```

---

### Task 3: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Verify at a narrow mobile width (e.g. 390px)**

For each of these four modals, confirm the close button renders at a visibly enlarged size (~44×44px) with its existing background/border, is easy to tap, and closes the modal:
- Change Password modal (uses the shared `<Modal>` component from `FormLayout.tsx` — reachable from the admin menu in the topbar)
- A standard hand-rolled modal, e.g. Add Expense (Expenses page → "Add expense")
- Billing's "New/Edit Billing" modal (`.cbf-close-btn`) (Billing page → new/edit a billing record)
- Employees → open an employee → Ticket History modal (the one fixed in Task 2)

Also confirm each modal is bottom-anchored (sheet style, not centered) with the tighter `padding: 18px`.

- [ ] **Step 3: Verify the 641–760px band specifically**

Resize to e.g. 700px width and re-check one modal (e.g. Add Expense) — confirm it's still bottom-anchored with the tight padding and 44px close button (this range previously fell through to the old centered/38px desktop-like treatment before this fix).

- [ ] **Step 4: Verify desktop (>760px) is unchanged**

Widen to e.g. 1400px and confirm modals are centered (not bottom-anchored), with the original `padding: 24px` and 38×38px close buttons.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all existing tests still pass (120/120 as of the last full run in this repo) — this change touches no domain logic.

- [ ] **Step 6: Clean up any screenshot/scratch files created during manual verification**

If browser automation left screenshot files in the repo root, remove them (`git status --porcelain` should be clean of anything not part of the intended diff).
