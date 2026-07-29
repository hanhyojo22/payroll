# New Billing Wizard — Mobile Polish Pass

## Context

The New/Edit Billing dialog (`BillingForm` in `src/features/billing/BillingFeature.tsx:1563-2422`) is a 5-step wizard (Billing Details, Employee Tickets, Subcontractors, Company & Disputes, Billable Summary) that has already been through several rounds of mobile-specific CSS work (bottom-sheet modal, compact stepper, an Employee Ticket Reference table redesigned to avoid horizontal scroll, iOS viewport-height fixes). This pass is a general mobile polish sweep on top of that existing work, not a response to a specific regression.

Reviewing the wizard's mobile CSS surfaced one real bug and one minor gap:

- **Step 3 "Subcontractor Tickets" (bug):** the mobile rule at `src/styles.css:11344-11393` carries a comment claiming "every column visible at once, no horizontal scroll" (matching the Employee table's treatment), but the rule immediately below it sets `min-width: 720px` on the 9-column CSS grid (`.billing-subcon-form-head` / `.billing-subcon-form-row`, defined at `src/styles.css:9882-9919`) — which forces horizontal scrolling on any phone screen. Header text is 8px and the dispute `<input>`s (`.billing-subcon-dispute-cell input`) are 30px tall on mobile / 34px on desktop, both below the 44px touch-target minimum already used elsewhere in this same wizard (e.g. `.cbf-ticket-input-wrap` at `src/styles.css:10973-10983` is 44px).
- **Step 5 "Billable Summary" invoice table (gap):** `.cbf-invoice-table` (`src/styles.css:11126-11161`) has no mobile-specific rule at all. At ~360-375px wide phones the 4 columns (Description/Qty/Unit Price/Total) are untested.

Step 2 (Employee Ticket Reference, `src/styles.css:11302-11342`) and Steps 1/4 (Billing Details, Company & Disputes) already have adequate mobile treatment from prior work and are confirmed out of scope.

## Scope

**In scope:**
1. Step 3 subcontractor rows: replace the horizontally-scrolling grid with a stacked card layout on mobile, matching the ≤640px breakpoint already used for this wizard's other mobile rules.
2. Step 5 invoice table: minor mobile-only padding/font tuning so it doesn't crowd at narrow widths — no column or content changes (this is a client-facing statement).

**Out of scope:** Step 1, Step 2, Step 4, the stepper/header chrome, the modal shell, and all `src/domain/billing.ts` calculation logic — all reused verbatim, unchanged.

## Design

### Step 3: subcontractor cards on mobile

Below 640px, each `.billing-subcon-form-row` (rendered in `BillingFeature.tsx:2270-2318`, one per `values.subcon_items` entry) switches from the 9-column grid to a card. The header row (`.billing-subcon-form-head`, `BillingFeature.tsx:2236-2246`) is hidden via `display: none` on mobile — its column labels are replaced by inline captions on the card itself, described below. Desktop (>640px) is visually unchanged; this is purely a mobile CSS reflow of the existing markup plus a handful of new mobile-only label elements (following the existing `tbl-label-full`/`tbl-label-abbr` convention already used in this file for the Employee table headers).

Card content, top to bottom:

1. **Header:** subcontractor name (`item.subcon_name`, bold), followed by the 3 existing rate lines — "Install rate: ₱X", "Repair rate: ₱X", "Nap Rehab rate: ₱X" — kept as 3 separate lines (not condensed), just restyled to fit the card width.
2. **Tickets row:** a "Tickets" label, then the 3 read-only counts (`item.install_tickets`, `item.repair_tickets`, `item.nap_rehab_tickets`) laid out side by side, each with a small "Ins"/"Rep"/"NR" caption underneath (new mobile-only `<span>`s, CSS-hidden above 640px since the desktop header row already labels these columns).
3. **Disputed row:** a "Disputed" label, then the 3 existing dispute `<input>`s (currently `.billing-subcon-dispute-cell input`), same Ins/Rep/NR captions underneath. These inputs grow to 44px tall on mobile (currently 30px) to meet the touch-target minimum already used elsewhere in this wizard.
4. **Footer:** two full-width label→value rows using the existing computed values and existing header labels for these columns (`computed.billingAmount` and `computed.payableAmount`) — e.g. "Net Amount → ₱7,750.00" and "[label] → ₱6,200.00". The existing sub-captions ("X billable tickets", "Y% payable", currently rendered via the `<span>` inside `.billing-subcon-amount`) are hidden on mobile only — they remain visible on desktop where there's room; nothing is removed from the underlying data or from desktop.

Implementation is CSS-only for the reflow (`grid-template-columns` → a card layout, likely via `grid-template-areas` or simple block stacking) plus the handful of new mobile-only caption/label elements in `BillingFeature.tsx`'s step-3 render block (`BillingFeature.tsx:2228-2326`). No changes to `updateSubconItem`, `computeSubconItem`, or any value in `values.subcon_items` — this is presentation only.

### Step 5: invoice table mobile tuning

Add a mobile-only rule (under the existing `max-width: 640px` breakpoint used elsewhere in this file, e.g. `src/styles.css:11249`) that reduces `.cbf-invoice-table td` / `thead th` padding and font-size slightly, so the 4 columns have more breathing room on ~360-375px screens. No column removal, no header text changes, no restructuring — this table represents a real billing statement and should keep its current shape.

### Testing

No `src/domain` changes, so no new domain tests. This is CSS + a few presentational JSX label elements — manual verification via the dev server at common phone widths (360px, 375px, 390px, 430px):
- Step 3: confirm no horizontal scroll, all 3 rate lines readable, Tickets/Disputed values and captions align correctly, dispute inputs are comfortably tappable (44px), Net Amount/Payable are legible, and editing a dispute value still updates `computed.billingAmount`/`computed.payableAmount` the same as before.
- Step 5: confirm the invoice table no longer looks cramped and nothing wraps awkwardly.
- Desktop (>640px): confirm Step 3 and Step 5 are pixel-unchanged from before this pass.
