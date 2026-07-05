# NotificationService app-wide migration design

Date: 2026-07-05

## Problem

`NotificationService` (toasts, confirm dialog, loading overlay) was built as
an additive, unused utility (see
`docs/superpowers/specs/2026-07-05-notification-service-design.md`). Nothing
in the app calls it yet. The app still uses the old patterns everywhere:

- `setNotice({ type: "success" | "error", text })` — a prop threaded through
  `App.tsx`'s `Workspace` and all 6 feature modules, rendered by a single
  `<NoticeBanner>`. 138 call sites across 7 files.
- `window.confirm(...)` — 4 call sites, all in `ExpensesFeature.tsx`.
- A bespoke inline "delete position" confirm modal in `App.tsx` (`confirmDelete`
  state).
- Three "Mark paid" actions (payroll, billing payout, subcontractor payout)
  have **no confirmation at all** today — one click changes status
  immediately.

This migration wires `NotificationService` into the real app: every notice
becomes a toast, every existing confirmation becomes `showConfirm`, and the
three unconfirmed "Mark paid" actions gain a confirm step.

## Scope

Full migration, all 7 files, executed one file per task so each is
independently reviewable (per user preference — can stop after any file).

## Transformation rule (mechanical, applied identically in every file)

- `setNotice({ type: "success", text: X })` → `NotificationService.showSuccess(X)`
- `setNotice({ type: "error", text: X })` → `NotificationService.showError(X)`
- Once a file has zero remaining `setNotice(...)` calls: remove `setNotice`
  from that component's prop type and destructured parameters, and remove
  the `setNotice={setNotice}` JSX attribute from that component's call site
  in `App.tsx`.
- Verification per file: `npx tsc --noEmit` passes, and
  `grep -n "setNotice" <file>` returns nothing (or, for `App.tsx` in its own
  task, returns only the JSX props being passed to feature components not
  yet migrated).

## File order and per-file scope

1. **`App.tsx`** — migrate its own 47 direct `setNotice` calls to
   `NotificationService.showSuccess/showError`. Replace the `confirmDelete`
   position-delete modal (state + inline JSX) with
   `await NotificationService.showConfirm({ title: "Delete position", message: ..., danger: true })`,
   preserving the existing "employees still assigned" guard (the confirm
   should not even be offered — or should be blocked — when employees are
   assigned, matching current behavior where the Delete button is disabled).
   Do **not** yet remove the `notice`/`setNotice` state, `<NoticeBanner>`, or
   the prop passed to child feature components — those are removed only in
   the final cleanup task, once no consumer needs them.
2. **`EmployeeAdvancesFeature.tsx`** (2 sites) — pure mechanical migration.
3. **`CollectionsFeature.tsx`** (8 sites) — pure mechanical migration.
4. **`SubcontractorsFeature.tsx`** (10 sites) — mechanical migration, plus:
   add a `showConfirm` guard at the top of `markPaymentPaid` (the function
   both the per-row "Mark paid" button and `markLatestPendingPaid` call
   through to, so adding it once covers both call sites). Example wording:
   `{ title: "Mark payout as paid", message: `Mark ${payment.title} as paid?` }`.
   If not confirmed, return before calling `markSubconPaymentReminderPaid`.
5. **`BillingFeature.tsx`** (15 sites) — mechanical migration, plus: add the
   same `showConfirm` guard at the top of `markPayoutPaid`.
6. **`PayrollFeature.tsx`** (21 sites) — mechanical migration, plus: wrap the
   "Mark paid" button's `onUpdate(item, { status: "paid", paid_date: todayKey() })`
   call in a new async handler that calls `showConfirm` first (title e.g.
   "Mark as paid", message referencing the employee/period) and only calls
   `onUpdate` if confirmed.
7. **`ExpensesFeature.tsx`** (35 sites) — mechanical migration, plus: replace
   each of the 4 `window.confirm("...")` calls with
   `await NotificationService.showConfirm({ message: "..." })`, preserving
   each call's exact existing message text, and preserving `danger: true`
   for the destructive ones (cancel expense, delete installment payment, end
   recurring expense, delete category — all are destructive/state-changing,
   so all four get `danger: true`).
8. **Cleanup** (after all above) — delete the `notice`/`setNotice` state and
   `<NoticeBanner>` render from `Workspace` in `App.tsx`; delete the `Notice`
   type from `src/shared/types.ts`; delete
   `src/shared/components/NoticeBanner.tsx`; remove the now-fully-unused
   `setNotice` prop from every one of the 6 feature components' prop types
   (confirm via project-wide grep that no `setNotice` reference remains
   anywhere in `src/`).

## Confirm dialog behavior on cancel

Every migrated `window.confirm` / new "Mark paid" guard follows the same
pattern: `const confirmed = await NotificationService.showConfirm({...}); if (!confirmed) return;` before the destructive/state-changing work proceeds. This
matches `window.confirm`'s original blocking semantics exactly (code after
the check simply doesn't run if the user declines).

## Out of scope

- No changes to `NotificationService`, `NotificationHost`, or
  `notificationStore` themselves (already built, reviewed, fixed).
- No new toast types, no new confirm options beyond what already exists.
- No changes to any other action's click-count beyond the 3 named "Mark
  paid" flows — no other flow gains a new confirmation step.

## Testing

Per this project's conventions, only `src/domain/**/*.test.ts` is
unit-tested; this migration touches UI/interaction code exclusively, so
verification per file is: `npx tsc --noEmit`, `npm test` (confirms the
existing 76 domain tests are unaffected), and a `grep` check that the
target call sites were actually transformed. As established in the original
NotificationService build, this environment does not have browser-automation
tooling, so interactive verification (toasts actually appearing, confirms
actually resolving) remains a manual, human, post-merge step — flagged
explicitly per task rather than silently skipped.
