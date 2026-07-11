# Mobile Modal Close Button Fix

## Context

The user reported the close ("X") button on modals is hard to tap on mobile. Investigation found a real CSS selector bug in `src/styles.css`: the mobile touch-target enlargement rule inside `@media (max-width: 640px)` reads

```css
.row-actions button,
.modal header button {
  height: 40px;
  min-height: 40px;
  width: 40px;
}
```

`.modal header button` matches a `<button>` inside a real `<header>` element — but only one shared component (`src/shared/components/FormLayout.tsx`'s `<Modal>`) actually renders a `<header>`. Every hand-rolled modal across the app (`ExpensesFeature.tsx`, `BillingFeature.tsx`, `CollectionsFeature.tsx`, `SubcontractorsFeature.tsx`, `SalaryBondsFeature.tsx`, `PaymentsFeature.tsx`, and most of `App.tsx`) uses `<div className="modal-header">` instead. That's a different selector (`.modal-header button`, no space), which this rule never lists. Result: ~20 of the app's ~23 modals never get any mobile touch-target enlargement — their close button stays at the base 38×38px, with no border/background to hint its clickable bounds beyond the icon, on every screen size.

Two additional outliers found during the audit, neither covered by `.modal-header button` at all:
- `BillingFeature.tsx:1555` — the "New/Edit Billing" modal's close button uses a bespoke `.cbf-close-btn` class (its own header markup, `.cbf-header`, not `.modal-header`), fixed at 38×38px with no mobile rule.
- `App.tsx:4031` — the "Ticket History" modal's close button uses `className="icon-button"`, a class with **zero CSS rules defined anywhere in the codebase** (confirmed via search) — a completely unstyled native `<button>`, and it's also missing `aria-label` (every other modal close button has one).

Separately: the "tight," bottom-sheet mobile modal treatment (`.modal-backdrop { align-items: flex-end; padding: 10px }`, `.modal { max-height: calc(100vh - 20px); padding: 18px }`) only activates below 640px. The two mobile redesigns shipped earlier this session (Employees card list, Expenses card list) both use 760px as the phone breakpoint. Between 641–760px, modals still render as centered dialogs with looser padding — inconsistent with that adjacent work.

## Scope

**In scope:** the close-button touch target and the bottom-sheet/tight-padding treatment for every modal in the app, on mobile only.

**Out of scope:** modal body content, layout, or field spacing (not reported as a problem); desktop modal sizing (38×38px close button stays as-is above 760px — no complaint there); the generic `.row-actions button` touch-target rule (unrelated to modals, already correctly scoped, not touched); the confirm dialog (`NotificationHost.tsx`'s `.confirm-modal`) — it has no close button, only full-width Cancel/Confirm buttons already sized correctly on mobile.

## Design

### 1. Fix the selector bug and consolidate mobile modal rules

Remove the modal-specific lines from the existing `@media (max-width: 640px)` block (the `.modal header button` part of the row-actions/modal rule, and the `.modal-backdrop`/`.modal` bottom-sheet rules), leaving `.row-actions button`'s own 40px rule untouched at 640px since it's unrelated to modals.

Add a new, dedicated `@media (max-width: 760px)` block (placed near the base `/* ── Modal ── */` rules in `styles.css` for locality) containing:
- The bottom-sheet backdrop and tightened modal padding (moved up from 640px to 760px, per the breakpoint-consistency decision).
- A corrected close-button rule covering **both** real selectors — `.modal header button` (the `<Modal>` component) and `.modal-header button` (every hand-rolled modal) — plus the one-off `.cbf-close-btn`, all bumped to **44×44px** (Apple's HIG minimum touch target, up from the originally-intended-but-broken 40px).

Because a `max-width: 760px` query already covers every width the old `max-width: 640px` query covered, no duplicate rule is needed for the 0–640 range.

### 2. Fix the two outliers

- `BillingFeature.tsx:1555` (`.cbf-close-btn`): no JSX change — covered by the new mobile CSS rule above.
- `App.tsx:4031` (Ticket History modal): drop the erroneous `className="icon-button"` (which has no styling anywhere) and add `aria-label="Close"` to match every other modal close button in the app. Once the class is removed, the button is a bare `<button>` inside `.modal-header`, so it automatically inherits the correct base and mobile styling — no new CSS needed for this one.

### 3. Result

On mobile (≤760px), every modal in the app gets: a bottom-anchored sheet with tighter padding, and a 44×44px close button with a visible background/border (inherited from the existing base `.modal-header button` style) — a large, clearly-tappable target instead of a bare 18px icon. Desktop (>760px) is unchanged.

## Testing

CSS-and-two-JSX-lines change with no domain logic touched — no `src/domain/**` tests apply. Manual verification: at ≤760px, open one modal per family — the shared `<Modal>` component (Change Password), a standard hand-rolled modal (e.g. Add Expense), the Billing "New/Edit Billing" modal (`.cbf-close-btn`), and the Employees Ticket History modal — and confirm each close button is visibly ≥44×44px, tappable, and closes the modal; confirm the modal is bottom-anchored with tight padding between 641–760px (not just below 640px); confirm nothing changed above 760px.
