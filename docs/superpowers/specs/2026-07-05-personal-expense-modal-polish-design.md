# Add Personal Expense modal — visual polish

Date: 2026-07-05

## Problem

The `ExpenseFormModal` (personal scope, `src/features/expenses/ExpensesFeature.tsx`)
carries a `personal-expense-modal` class (added during the earlier Personal
Expenses redesign) but that class has zero CSS rules today — it inherits
100% of its layout from `.billing-form-modal` (`max-width: 900px`,
`width: 96vw`) and `.billing-form-fields` (a 2-column grid), both sized for
Billing's denser multi-section form. The personal form only has ~5
default-visible fields (What's this for?, Category, Amount, Date,
Frequency), so it renders as a wide, sparse, generically "business form"
looking modal rather than a compact personal quick-add form.

## Scope

CSS-only, plus one JSX class addition on the field-grid `<div>`. Only
affects `categoryScope === "personal"`. Company Expenses' form (which
still uses `.billing-form-modal`/`.billing-form-fields` with no additional
class) is completely unaffected.

## Design

1. **Narrower modal.** Add `.personal-expense-modal { max-width: 460px; }`
   (overriding `.billing-form-modal`'s 900px via the more-specific combined
   selector already present in the JSX: `className="modal billing-form-modal personal-expense-modal"`).

2. **Single-column fields.** The field grid `<div className="billing-form-fields">`
   gains a second class, `personal-expense-form-fields`, only when
   `categoryScope === "personal"`. New CSS uses the combined selector
   `.billing-form-fields.personal-expense-form-fields { grid-template-columns: 1fr; }`
   (two classes, matching the specificity pattern already used by
   `.billing-btn.primary.personal-accent` elsewhere in this file) so it
   reliably overrides the inherited 2-column grid regardless of CSS source
   order, and personal's 5 fields stack full-width, one per row.

3. **Warm header/border accent.** `.personal-expense-modal` gets a
   `border-top: 3px solid var(--color-warning);` (a thin accent strip
   along the modal's top edge — consistent with the warm accent used
   elsewhere in the personal redesign) instead of the default modal's
   plain border.

4. **Clearer "More options" separation.** The existing
   `.personal-expense-more` block gets `border-top: 1px solid var(--color-border-light); padding-top: 14px;`
   (in addition to its current `margin-top: 4px`) so it visually reads as
   a distinct section below the main fields, not a floating toggle.

No changes to field logic, validation, submit behavior, or the Category
form (company scope unaffected in every respect).

## Testing

Per this project's conventions, this is a pure CSS/JSX-class change with
no domain logic — no new automated tests. Verification is
`npx tsc --noEmit`, `npm test` (confirms the 76 domain tests are
unaffected), and manual browser verification (this environment has no
browser-automation tool available to any agent, so this remains a human
step, consistent with every prior UI change in this project).
