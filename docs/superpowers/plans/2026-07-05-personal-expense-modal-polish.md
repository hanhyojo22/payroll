# Add Personal Expense Modal Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Add/Edit Personal Expense modal feel like a compact, purpose-built quick-add form instead of inheriting Billing's wide, dense-form layout.

**Architecture:** CSS-only changes plus one new conditional JSX class, all confined to `ExpenseFormModal` in `src/features/expenses/ExpensesFeature.tsx` and new rules in `src/styles.css`. Company Expenses' form is untouched.

**Tech Stack:** React 18, TypeScript, existing CSS custom properties (`--color-warning`, `--color-border-light`).

## Global Constraints

- Only `categoryScope === "personal"` is affected. Company Expenses' form must render identically to before — same classes, same 2-column field grid, same modal width.
- No new CSS custom properties — reuse `--color-warning` and `--color-border-light`, both already defined in `src/styles.css`.
- The single-column override must use the combined selector `.billing-form-fields.personal-expense-form-fields` (two classes) so it reliably wins over `.billing-form-fields`'s existing `grid-template-columns: repeat(2, minmax(0, 1fr));` regardless of CSS source order.
- No changes to field logic, validation, or submit behavior.
- Verification: `npx tsc --noEmit` and `npm test` (76 domain tests, unaffected by this UI-only change) must pass. No new automated tests — this project's `vitest.config.ts` only collects `src/domain/**/*.test.ts`, and this change touches no domain code. Manual browser verification is a human step (no browser-automation tool is available in this environment).

---

### Task 1: Compact, warm-accented Personal Expense modal

**Files:**
- Modify: `src/features/expenses/ExpensesFeature.tsx` (the `ExpenseFormModal` component, currently around lines 716-732)
- Modify: `src/styles.css` (new rules near `.billing-form-modal`/`.billing-form-fields` at line ~8196, and near `.personal-expense-more` at line ~7252)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing for later tasks (single-task plan).

- [ ] **Step 1: Add the `personal-expense-form-fields` class to the field grid**

Find (currently around line 732):

```tsx
          <div className="billing-form-fields">
```

Replace with:

```tsx
          <div className={`billing-form-fields${categoryScope === "personal" ? " personal-expense-form-fields" : ""}`}>
```

- [ ] **Step 2: Add the narrow-modal and single-column-grid CSS**

In `src/styles.css`, find:

```css
.billing-form-modal {
  max-width: 900px;
  width: 96vw;
}
```

Add immediately after it:

```css
.personal-expense-modal {
  border-top: 3px solid var(--color-warning);
  max-width: 460px;
}

.billing-form-fields.personal-expense-form-fields {
  grid-template-columns: 1fr;
}
```

- [ ] **Step 3: Add the "More options" section divider CSS**

In `src/styles.css`, find:

```css
.personal-expense-more {
  margin-top: 4px;
}
```

Replace with:

```css
.personal-expense-more {
  border-top: 1px solid var(--color-border-light);
  margin-top: 4px;
  padding-top: 14px;
}
```

- [ ] **Step 4: Type-check and test**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: all 76 domain tests pass.

- [ ] **Step 5: Manual verification**

Start `npm run dev`. Open "Add expense" on Personal Expenses: confirm the modal is noticeably narrower than before, fields stack in a single column, there's a thin orange line across the top of the modal, and the "More options" section (once expanded) has a visible divider above it separating it from the main fields. Open "Add expense" on Company Expenses: confirm it's completely unchanged — same width, same 2-column field grid, no orange border.

- [ ] **Step 6: Commit**

```bash
git add src/features/expenses/ExpensesFeature.tsx src/styles.css
git commit -m "$(cat <<'EOF'
feat: polish Add Personal Expense modal layout

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Post-plan manual verification (required, cannot be automated in this environment)

A human must verify in a real browser (no browser-automation tool is available here): the narrower modal width, single-column field stacking, the warm top-border accent, and the "More options" divider all render correctly and look intentional — and that Company Expenses' form is untouched.
