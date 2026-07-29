# Billing Wizard Mobile Polish Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Step 3 "Subcontractor Tickets" mobile layout (currently forces horizontal scrolling despite a code comment claiming otherwise) by turning it into stacked per-subcontractor cards, and give the Step 5 invoice table a little breathing room on narrow phones.

**Architecture:** Pure CSS + presentational-JSX change inside the existing New/Edit Billing wizard (`BillingForm` in `src/features/billing/BillingFeature.tsx`) and its stylesheet (`src/styles.css`). No component state, props, domain logic (`src/domain/billing.ts`), or repository code changes. Desktop (>640px) is visually unchanged — all new rules live inside the wizard's existing `@media (max-width: 640px)` block.

**Tech Stack:** React + TypeScript (JSX only, no new hooks/state), plain CSS with the project's existing custom-property design tokens (`--color-*`, `--radius-*`, `--shadow-*`).

## Global Constraints

- Breakpoint: mobile rules go inside the existing `@media (max-width: 640px)` block at `src/styles.css:11249` — do not introduce a new breakpoint value.
- Desktop (>640px) must be pixel-unchanged after this pass.
- No changes to `computeSubconItem`, `updateSubconItem`, `values.subcon_items`, or any other data/logic in `BillingFeature.tsx` — this is presentation only.
- No changes to Steps 1, 2, or 4, the stepper, or the modal shell.
- Dispute number inputs must be at least 44px tall on mobile (matches `.cbf-ticket-input-wrap`'s existing 44px elsewhere in this same wizard, `src/styles.css:10973-10983`).

---

### Task 1: Step 3 — subcontractor cards on mobile

**Files:**
- Modify: `src/features/billing/BillingFeature.tsx:2277-2309` (subcontractor row JSX — ticket count cells and dispute cells)
- Modify: `src/styles.css:9998-10002` (add one base rule immediately after `.billing-subcon-form-empty`)
- Modify: `src/styles.css:11344-11393` (replace the existing broken mobile rule block)
- Test: none — no domain/logic change. Verified manually via dev server (Step 4 below).

**Interfaces:** None. No new functions, types, or props — this task only adds `data-label` attributes and two static-text `<span>` elements to existing JSX, and CSS rules that key off them.

- [ ] **Step 1: Add mobile group-label spans and `data-label` attributes in the JSX**

In `src/features/billing/BillingFeature.tsx`, find this block (currently lines 2277-2309, inside the `values.subcon_items.map(...)` render, right after the `.billing-subcon-name-cell` div and before the `.billing-subcon-amount` divs):

```tsx
                          <div className="billing-subcon-inline-values"><span>{item.install_tickets}</span></div>
                          <div className="billing-subcon-inline-values"><span>{item.repair_tickets}</span></div>
                          <div className="billing-subcon-inline-values"><span>{item.nap_rehab_tickets}</span></div>
                          <div className="billing-subcon-dispute-cell">
                            <input
                              disabled={itemInstallTickets === 0}
                              max={itemInstallTickets}
                              min="0"
                              type="number"
                              value={String(itemDisputedInstall)}
                              onChange={(event) => updateSubconItem(index, { disputed_install: String(Math.max(0, Math.min(itemInstallTickets, Number(event.target.value) || 0))) })}
                            />
                          </div>
                          <div className="billing-subcon-dispute-cell">
                            <input
                              disabled={itemRepairTickets === 0}
                              max={itemRepairTickets}
                              min="0"
                              type="number"
                              value={String(itemDisputedRepair)}
                              onChange={(event) => updateSubconItem(index, { disputed_repair: String(Math.max(0, Math.min(itemRepairTickets, Number(event.target.value) || 0))) })}
                            />
                          </div>
                          <div className="billing-subcon-dispute-cell">
                            <input
                              disabled={itemNapRehabTickets === 0}
                              max={itemNapRehabTickets}
                              min="0"
                              type="number"
                              value={String(itemDisputedNapRehab)}
                              onChange={(event) => updateSubconItem(index, { disputed_nap_rehab: String(Math.max(0, Math.min(itemNapRehabTickets, Number(event.target.value) || 0))) })}
                            />
                          </div>
```

Replace it with (adds a `billing-subcon-mobile-group-label` span before each trio, and a `data-label` attribute on each of the 6 value cells — these are read on mobile via CSS `content: attr(data-label)` to caption each number, and are inert/unused on desktop):

```tsx
                          <span className="billing-subcon-mobile-group-label">Tickets</span>
                          <div className="billing-subcon-inline-values" data-label="Ins"><span>{item.install_tickets}</span></div>
                          <div className="billing-subcon-inline-values" data-label="Rep"><span>{item.repair_tickets}</span></div>
                          <div className="billing-subcon-inline-values" data-label="NR"><span>{item.nap_rehab_tickets}</span></div>
                          <span className="billing-subcon-mobile-group-label">Disputed</span>
                          <div className="billing-subcon-dispute-cell" data-label="Ins">
                            <input
                              disabled={itemInstallTickets === 0}
                              max={itemInstallTickets}
                              min="0"
                              type="number"
                              value={String(itemDisputedInstall)}
                              onChange={(event) => updateSubconItem(index, { disputed_install: String(Math.max(0, Math.min(itemInstallTickets, Number(event.target.value) || 0))) })}
                            />
                          </div>
                          <div className="billing-subcon-dispute-cell" data-label="Rep">
                            <input
                              disabled={itemRepairTickets === 0}
                              max={itemRepairTickets}
                              min="0"
                              type="number"
                              value={String(itemDisputedRepair)}
                              onChange={(event) => updateSubconItem(index, { disputed_repair: String(Math.max(0, Math.min(itemRepairTickets, Number(event.target.value) || 0))) })}
                            />
                          </div>
                          <div className="billing-subcon-dispute-cell" data-label="NR">
                            <input
                              disabled={itemNapRehabTickets === 0}
                              max={itemNapRehabTickets}
                              min="0"
                              type="number"
                              value={String(itemDisputedNapRehab)}
                              onChange={(event) => updateSubconItem(index, { disputed_nap_rehab: String(Math.max(0, Math.min(itemNapRehabTickets, Number(event.target.value) || 0))) })}
                            />
                          </div>
```

Note: `.billing-subcon-mobile-group-label` will be defined as `display: none;` at the base (desktop) level in Step 2 below, so these two new spans have zero effect on desktop — `display: none` elements are removed from CSS Grid layout entirely, so they won't consume a column slot in the existing desktop 9-column grid either.

- [ ] **Step 2: Add the base (desktop-safe) rule for the new group-label spans**

In `src/styles.css`, find:

```css
.billing-subcon-form-empty {
  color: var(--color-text-tertiary);
  padding: 24px 18px;
  text-align: center;
}
```

Add immediately after it (before the blank line and `.subcon-details {` that follows):

```css

.billing-subcon-mobile-group-label {
  display: none;
}
```

- [ ] **Step 3: Replace the broken mobile media-query block with the card layout**

In `src/styles.css`, inside the existing `@media (max-width: 640px)` block that starts at `src/styles.css:11249`, find this exact block (it currently has the comment claiming "no horizontal scroll" while `min-width: 720px` two lines below forces it anyway):

```css
  /* Subcontractor Tickets grid (New Billing): same goal as the employee
     table above — every column visible at once, no horizontal scroll. */
  .billing-subcon-form-scroll {
    overflow-x: auto;
  }

  .billing-subcon-form-head,
  .billing-subcon-form-row {
    column-gap: 3px;
    grid-template-columns: 1.5fr repeat(3, 0.55fr) repeat(3, 0.85fr) repeat(2, 1fr);
    min-width: 720px;
    padding: 8px 4px;
  }

  .billing-subcon-form-head {
    font-size: 8px;
  }

  .billing-subcon-name-cell strong {
    font-size: 10.5px;
  }

  .billing-subcon-name-cell span {
    display: none;
  }

  .billing-subcon-inline-values span {
    font-size: 10.5px;
  }

  .billing-subcon-dispute-cell input {
    font-size: 10.5px;
    min-height: 30px;
    padding: 0 2px;
    text-align: center;
    width: 100%;
  }

  .billing-subcon-amount strong {
    font-size: 10px;
    overflow-wrap: anywhere;
  }

  .billing-subcon-amount span {
    display: none;
  }

  .billing-subcon-form-head .tbl-label-full { display: none; }
  .billing-subcon-form-head .tbl-label-abbr { display: inline; }
}
```

Replace the entire block (including the final closing `}` that ends the `@media` query) with:

```css
  /* Subcontractor Tickets (New Billing): each subcontractor becomes a
     self-contained card on mobile instead of a row in the 9-column grid,
     so nothing requires horizontal scrolling and the dispute inputs are
     large enough to tap comfortably (44px, matching this wizard's other
     number inputs). */
  .billing-subcon-form-scroll {
    margin: 0;
    overflow-x: visible;
  }

  .billing-subcon-form-table {
    background: transparent;
    border: none;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .billing-subcon-form-head {
    display: none;
  }

  .billing-subcon-form-row {
    background: var(--color-surface);
    border: 1px solid var(--color-border-light);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
    column-gap: 8px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    min-width: 0;
    padding: 14px;
    row-gap: 10px;
  }

  .billing-subcon-form-row + .billing-subcon-form-row {
    border-top: none;
  }

  .billing-subcon-name-cell,
  .billing-subcon-amount {
    grid-column: 1 / -1;
  }

  .billing-subcon-name-cell strong {
    font-size: 13px;
  }

  .billing-subcon-name-cell span {
    display: block;
    font-size: 10.5px;
  }

  .billing-subcon-mobile-group-label {
    color: var(--color-text-tertiary);
    display: block;
    font-size: 10px;
    font-weight: 700;
    grid-column: 1 / -1;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .billing-subcon-inline-values,
  .billing-subcon-dispute-cell {
    align-items: center;
    flex-direction: column;
    gap: 4px;
  }

  .billing-subcon-inline-values::after,
  .billing-subcon-dispute-cell::after {
    color: var(--color-text-tertiary);
    content: attr(data-label);
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  .billing-subcon-inline-values span {
    font-size: 13px;
  }

  .billing-subcon-dispute-cell input {
    font-size: 13px;
    min-height: 44px;
    padding: 0 4px;
    text-align: center;
    width: 100%;
  }

  .billing-subcon-amount {
    align-items: center;
    display: flex;
    justify-content: space-between;
    text-align: left;
  }

  .billing-subcon-amount strong {
    font-size: 13px;
    overflow-wrap: anywhere;
  }

  .billing-subcon-amount span {
    display: none;
  }

  .billing-subcon-amount::before {
    color: var(--color-text-secondary);
    content: "Net Amount";
    font-size: 11px;
    font-weight: 600;
  }

  .billing-subcon-amount-payable::before {
    content: "Collectibles Amount";
  }
}
```

(The `.billing-subcon-amount::before` / `.billing-subcon-amount-payable::before` pair reuses this wizard's existing header labels — "Net Amount" for `computed.billingAmount` and "Collectibles Amount" for `computed.payableAmount`, matching `BillingFeature.tsx:2244-2245` — rather than inventing new copy. Since both selectors have equal specificity, `.billing-subcon-amount-payable::before` must stay *after* `.billing-subcon-amount::before` in source order so it correctly wins for the payable row.)

- [ ] **Step 4: Type-check and build**

Run: `npm run build`
Expected: succeeds with no TypeScript or build errors (this task adds only `className`/`data-label` attributes and static-text spans — no type changes).

- [ ] **Step 5: Manually verify in the dev server**

Run: `npm run dev`, open the app, go to Billing → New billing, advance to Step 3 ("Subcontractors").

At ≤640px width (use browser devtools device toolbar at 360px, 375px, 390px, and 430px):
- Confirm no horizontal scrollbar appears on the subcontractor list.
- Confirm each subcontractor renders as a card: name, then 3 separate rate lines ("Install rate: ...", "Repair rate: ...", "Nap Rehab rate: ..."), then a "Tickets" row with 3 read-only counts each captioned Ins/Rep/NR, then a "Disputed" row with 3 inputs each captioned Ins/Rep/NR, then "Net Amount" and "Collectibles Amount" rows with just the currency value (no extra caption).
- Confirm the dispute inputs are comfortably tappable (visually ~44px tall) and that typing into one still updates the Net Amount/Collectibles Amount for that card (unchanged calculation, from `computeSubconItem`).
- Widen the viewport back above 640px and confirm Step 3 looks exactly as it did before this change (9-column grid, header row visible, horizontal scroll container present as before).

- [ ] **Step 6: Commit**

```bash
git add src/features/billing/BillingFeature.tsx src/styles.css
git commit -m "$(cat <<'EOF'
Redesign Step 3 subcontractor rows into mobile cards

The mobile rule for the Subcontractor Tickets grid claimed "no
horizontal scroll" in a comment but set min-width: 720px right below
it, forcing sideways scrolling with 8px text and 30px-tall dispute
inputs on every phone. Replace it with a stacked card per
subcontractor, and grow the dispute inputs to 44px to match this
wizard's other touch targets. Desktop is unchanged.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Step 5 — invoice table mobile tuning

**Files:**
- Modify: `src/styles.css` (inside the same `@media (max-width: 640px)` block Task 1 edited, `src/styles.css:11249`)
- Test: none — no domain/logic change. Verified manually via dev server (Step 3 below).

**Interfaces:** None. Pure CSS addition, no markup or logic change.

- [ ] **Step 1: Add mobile padding/font tuning for the invoice table**

In `src/styles.css`, inside the `@media (max-width: 640px)` block, immediately before the closing `}` of that media query (which now ends with the `.billing-subcon-amount-payable::before { content: "Collectibles Amount"; }` rule from Task 1), add:

```css

  /* Billable Summary invoice table (New Billing): a little extra breathing
     room at narrow phone widths so the Description column doesn't crowd
     the numeric columns. Column layout is intentionally unchanged — this
     is a real client-facing billing statement. */
  .cbf-invoice-table thead th {
    font-size: 10px;
    padding: 8px 6px;
  }

  .cbf-invoice-table td {
    font-size: 12px;
    padding: 8px 6px;
  }
```

- [ ] **Step 2: Type-check and build**

Run: `npm run build`
Expected: succeeds with no errors.

- [ ] **Step 3: Manually verify in the dev server**

With the dev server still running from Task 1, go to Billing → New billing, advance through to Step 5 ("Billable Summary"). At 360px and 375px widths, confirm the itemized-charges table (Description/Quantity/Unit Price/Total) no longer looks crowded and no cell text overlaps or clips. Widen above 640px and confirm the table looks unchanged from before this task.

- [ ] **Step 4: Commit**

```bash
git add src/styles.css
git commit -m "$(cat <<'EOF'
Tune Billable Summary invoice table spacing on mobile

Give the itemized-charges table a little more breathing room at
narrow phone widths (reduced padding/font-size) so the Description
column doesn't crowd the numeric columns. No column or content
changes -- this is a client-facing billing statement.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
