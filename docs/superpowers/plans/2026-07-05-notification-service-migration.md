# NotificationService App-Wide Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old `setNotice({type, text})` prop-drilled notification pattern and all `window.confirm`/ad-hoc confirm modals with `NotificationService` (toasts + `showConfirm`) everywhere in the app, and add a confirm step to the three "Mark paid" actions that currently have none.

**Architecture:** File-by-file mechanical migration. Each `setNotice({ type: "success", text: X })` becomes `NotificationService.showSuccess(X)`; each `setNotice({ type: "error", text: X })` becomes `NotificationService.showError(X)`. The `setNotice` prop itself is only removed once every consumer of it has been migrated — that happens in one final cleanup task, not per-file, since 6 of the 7 files still depend on the prop existing until their own task lands.

**Tech Stack:** React 18, TypeScript. `NotificationService` from `src/shared/notifications/NotificationService.ts` (already built, reviewed, and mounted — see `docs/superpowers/specs/2026-07-05-notification-service-design.md`).

## Global Constraints

- Every task must end with `npx tsc --noEmit` passing and `npm test` passing (76 domain tests; this migration touches no domain code, so this only confirms nothing broke).
- No automated tests for this migration itself: per `CLAUDE.md`, `vitest.config.ts` only collects `src/domain/**/*.test.ts`. Verification per task is type-check + `npm test` + `grep` checks confirming the transformation is complete (zero remaining `setNotice(` calls in a fully-migrated file, zero remaining `window.confirm(` calls in `ExpensesFeature.tsx`).
- Confirm-dialog cancel behavior: `const confirmed = await NotificationService.showConfirm({...}); if (!confirmed) return;` before any destructive/state-changing work proceeds — this exactly matches `window.confirm`'s original blocking semantics.
- Destructive confirms (delete/cancel/end anything) get `danger: true`. The 3 new "Mark paid" confirms are NOT destructive (they don't delete data) — do NOT set `danger: true` on those.
- No other action beyond the 3 named "Mark paid" flows (subcontractor, billing payout, payroll) gains a new confirmation step.
- Every file in this plan currently has `import type { Notice, QueueOfflineMutation } from ".../shared/types";` (relative path varies by depth) — `Notice` stays in that import until Task 8, since the `setNotice: (notice: Notice) => void` prop type isn't removed until then. Do not touch these import lines before Task 8.
- Interactive/visual verification (do toasts actually render correctly, does the confirm dialog actually resolve correctly) is not possible in this environment (no browser-automation tool). Every task's report must say so explicitly rather than silently omit it — this is a known, accepted limitation, not a defect to fix.

---

### Task 1: Migrate App.tsx (own call sites, position-delete modal, hardcoded banner, Login cleanup)

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `NotificationService` from `./shared/notifications/NotificationService` (already exists — `showSuccess(message)`, `showError(message)`, `showWarning(message)`, `showConfirm({title?, message, confirmText?, cancelText?, danger?}): Promise<boolean>`)
- Produces: nothing new for later tasks — `App.tsx`'s own `notice`/`setNotice` state (Workspace-level, not Login's), `<NoticeBanner>` render, and the `setNotice={setNotice}` prop passed to the 6 external feature components (`EmployeeAdvancesFeature`, `CollectionsFeature`/`CollectionHistoryFeature`, `SubcontractorsFeature`, `BillingFeature`/`BillingSettingsManager`, `PayrollFeature`/`PayrollHistoryFeature`/`PayrollSettingsManager`, `ExpensesFeature`/`ExpenseCategoriesManager`) MUST remain unchanged — those consumers aren't migrated until their own tasks.

This task has 5 parts. Do them in order.

#### Part A: Migrate Login's self-contained notice usage (fully removable — nothing else depends on it)

`Login` has its own separate `notice`/`setNotice` state (line 482) and `<NoticeBanner>` render (line 540), entirely separate from the Workspace-level one. Nothing outside `Login` uses this state, so it can be fully migrated and cleaned up in one pass.

- [ ] **Step 1: Find and replace Login's setNotice calls**

Search within `Login` (roughly lines 470-545) for every `setNotice({ type: "success", text: X })` or `setNotice({ type: "error", text: X })` call. One confirmed example at line 496:

```tsx
      setNotice({ type: "error", text: friendlyError(result.error) });
```

becomes:

```tsx
      NotificationService.showError(friendlyError(result.error));
```

Apply the same substitution to every other `setNotice(...)` call found within `Login`. Use `grep -n "setNotice" src/App.tsx` (before and after) to confirm you found and converted all of them within this component's boundaries.

- [ ] **Step 2: Remove Login's state and banner**

Delete this line (around 482):

```tsx
  const [notice, setNotice] = useState<Notice>(null);
```

Delete this line (around 540):

```tsx
          <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} />
```

#### Part B: Replace the hardcoded conditional NoticeBanner (line ~2813)

This one doesn't use state at all — it's a persistent conditional warning, not a one-shot event, so it does NOT become a toast (toasts are transient/event-triggered; this needs to stay visible as long as the condition holds). Replace it with a plain inline banner reusing the existing `.notice`/`.error` CSS classes directly.

- [ ] **Step 1: Replace the hardcoded banner**

Find:

```tsx
      {employees.some((employee) => employee.status === "active" && !employee.position_id) && <NoticeBanner notice={{ type: "error", text: "Some active employees have no position and cannot receive ticket entries." }} onDismiss={() => undefined} />}
```

Replace with:

```tsx
      {employees.some((employee) => employee.status === "active" && !employee.position_id) && (
        <div className="notice error" role="alert">
          <div>
            <strong>Action needed</strong>
            <p>Some active employees have no position and cannot receive ticket entries.</p>
          </div>
        </div>
      )}
```

#### Part C: Replace the position-delete confirm modal

- [ ] **Step 1: Remove the `confirmDelete` state**

Find (around line 1994):

```tsx
  const [confirmDelete, setConfirmDelete] = useState<Position | null>(null);
```

Delete this line entirely.

- [ ] **Step 2: Replace the delete button and add a handler function**

Find the delete button (around line 2214):

```tsx
            <button aria-label="Delete position" className="delete-action" onClick={() => setConfirmDelete(position)} title="Delete" type="button"><Trash2 size={16} /></button>
```

Replace with:

```tsx
            <button aria-label="Delete position" className="delete-action" onClick={() => void handleDeletePosition(position)} title="Delete" type="button"><Trash2 size={16} /></button>
```

Add this new function in the same component, near `deletePosition` (which already exists around line 2148 and is unchanged by this task):

```tsx
  async function handleDeletePosition(position: Position) {
    const assignedCount = employees.filter((e) => e.position_id === position.id).length;
    if (assignedCount > 0) {
      NotificationService.showWarning(`${assignedCount} employee${assignedCount === 1 ? " is" : "s are"} still assigned — reassign before deleting.`);
      return;
    }
    const confirmed = await NotificationService.showConfirm({
      title: "Delete position",
      message: `Are you sure you want to permanently delete "${position.name}"? This action cannot be undone.`,
      danger: true,
    });
    if (!confirmed) return;
    await deletePosition(position);
  }
```

- [ ] **Step 3: Delete the old modal JSX block**

Find and delete this entire block (verified exact range: lines 2219–2249):

```tsx
      {confirmDelete && (
        <div className="modal-backdrop" role="presentation">
          <section aria-label="Delete position" aria-modal="true" className="modal confirm-modal" role="dialog">
            <div className="confirm-icon-wrap danger">
              <Trash2 size={24} />
            </div>
            <h2>Delete position</h2>
            <p>Are you sure you want to permanently delete <strong>{confirmDelete.name}</strong>? This action cannot be undone.</p>
            {employees.filter((e) => e.position_id === confirmDelete.id).length > 0 && (
              <div className="confirm-warning">
                <span>{employees.filter((e) => e.position_id === confirmDelete.id).length} employee{employees.filter((e) => e.position_id === confirmDelete.id).length === 1 ? "" : "s"} assigned — reassign before deleting.</span>
              </div>
            )}
            <div className="confirm-actions">
              <button className="secondary-button" onClick={() => setConfirmDelete(null)} type="button">Cancel</button>
              <button
                className="primary-button danger-button"
                disabled={employees.filter((e) => e.position_id === confirmDelete.id).length > 0}
                onClick={async () => {
                  await deletePosition(confirmDelete);
                  setConfirmDelete(null);
                }}
                type="button"
              >
                <Trash2 size={15} />
                Delete
              </button>
            </div>
          </section>
        </div>
      )}
```

#### Part D: Remove `setNotice` prop from `EmployeesView` and `PositionsView`

These two components are defined within `App.tsx` itself and are ONLY ever rendered from within this same file (never from another feature file), so — unlike the 6 external feature files — their `setNotice` prop can be safely removed now rather than waiting for Task 8.

- [ ] **Step 1: Migrate their internal setNotice(...) calls**

`EmployeesView` and `PositionsView` each have their own `setNotice(...)` call sites (part of this file's 47 total). Apply the same rule as everywhere else: `setNotice({ type: "success", text: X })` → `NotificationService.showSuccess(X)`, `setNotice({ type: "error", text: X })` → `NotificationService.showError(X)`. Two confirmed examples inside `PositionsView`:

```tsx
      setNotice({ type: "error", text: `Reassign ${assignedActiveEmployees} active employee${assignedActiveEmployees === 1 ? "" : "s"} before archiving this position.` });
```

becomes:

```tsx
      NotificationService.showError(`Reassign ${assignedActiveEmployees} active employee${assignedActiveEmployees === 1 ? "" : "s"} before archiving this position.`);
```

and the ternary-shaped call:

```tsx
    setNotice(error ? { type: "error", text: friendlyError(error) } : { type: "success", text: `Position ${status}.` });
```

becomes:

```tsx
    if (error) {
      NotificationService.showError(friendlyError(error));
    } else {
      NotificationService.showSuccess(`Position ${status}.`);
    }
```

- [ ] **Step 2: Remove `setNotice` from `EmployeesView`'s prop type and destructuring**

`EmployeesView`'s prop type currently includes `setNotice: (notice: Notice) => void;` and its destructured parameter list includes `setNotice,` — remove both.

- [ ] **Step 3: Remove `setNotice` from `PositionsView`'s prop type and destructuring**

Same as above, for `PositionsView`'s own prop type and destructured parameters.

- [ ] **Step 4: Remove the `setNotice={setNotice}` prop from both call sites**

`EmployeesView` is rendered twice (list mode and add mode), around lines 1118-1152:

```tsx
              {view === "employees" && (
                <EmployeesView
                  employees={employees}
                  initialDetailsEmployeeId={selectedEmployeeDetailId}
                  initialDetailsEmployeeNonce={selectedEmployeeDetailNonce}
                  onChange={refreshEmployeesPage}
                  onClearInitialDetailsEmployee={() => setSelectedEmployeeDetailId(null)}
                  onDetailsOpenChange={setEmployeeDetailOpen}
                  onLocalEmployeesChange={setEmployees}
                  onQueueOfflineMutation={queueOfflineMutation}
                  payrollRuns={payrollRuns}
                  positions={positions}
                  employeeAdvances={employeeAdvances}
                  setNotice={setNotice}
                  userId={session.user.id}
                />
            )}
            {view === "employee-add" && (
              <EmployeesView
                employees={employees}
                initialDetailsEmployeeId={selectedEmployeeDetailId}
                initialDetailsEmployeeNonce={selectedEmployeeDetailNonce}
                mode="add"
                onChange={refreshEmployeesPage}
                onClearInitialDetailsEmployee={() => setSelectedEmployeeDetailId(null)}
                onExitForm={() => navigate("employees")}
                onLocalEmployeesChange={setEmployees}
                onQueueOfflineMutation={queueOfflineMutation}
                payrollRuns={payrollRuns}
                positions={positions}
                employeeAdvances={employeeAdvances}
                setNotice={setNotice}
                userId={session.user.id}
              />
            )}
```

Remove the `setNotice={setNotice}` line from both blocks (leave every other prop untouched).

`PositionsView`, around lines 1153-1163:

```tsx
              {view === "compensation" && (
                <PositionsView
                  employees={employees}
                  onChange={refreshPositionsPage}
                  onLocalPositionsChange={setPositions}
                  onQueueOfflineMutation={queueOfflineMutation}
                  positions={positions}
                  setNotice={setNotice}
                  userId={session.user.id}
                />
              )}
```

Remove the `setNotice={setNotice}` line.

#### Part E: Migrate the remaining direct `setNotice(...)` calls in `App.tsx`

- [ ] **Step 1: Apply the rule to every remaining `setNotice(...)` call in the file**

Everything not already covered in Parts A and D. Representative examples (apply the same substitution pattern to every remaining occurrence):

```tsx
    setNotice({ type: "success", text: "Saved locally. It will sync when online." });
```
→
```tsx
    NotificationService.showSuccess("Saved locally. It will sync when online.");
```

```tsx
      setNotice({ type: "success", text: `${result.synced.length} offline change${result.synced.length === 1 ? "" : "s"} synced.` });
```
→
```tsx
      NotificationService.showSuccess(`${result.synced.length} offline change${result.synced.length === 1 ? "" : "s"} synced.`);
```

```tsx
      setNotice({ type: "error", text: `Cannot delete "${position.name}" — ${assignedEmployees} employee${assignedEmployees === 1 ? " is" : "s are"} still assigned. Reassign them first.` });
```
→
```tsx
      NotificationService.showError(`Cannot delete "${position.name}" — ${assignedEmployees} employee${assignedEmployees === 1 ? " is" : "s are"} still assigned. Reassign them first.`);
```

Note: `deletePosition` (containing the example above, around line 2152) also has an early-return call `setConfirmDelete(null);` right after it (around line 2153) — since `confirmDelete`/`setConfirmDelete` no longer exist after Part C, remove that `setConfirmDelete(null);` line too if you encounter it still present.

- [ ] **Step 2: Add the NotificationService import**

Near the top of `App.tsx`, alongside the existing imports (e.g. near line 96 where `NoticeBanner` is imported — leave that import as-is, it's still needed for the Workspace-level banner), add:

```tsx
import { NotificationService } from "./shared/notifications/NotificationService";
```

- [ ] **Step 3: Verify no unintended call sites remain**

Run: `grep -c "setNotice(" src/App.tsx`

Expected: a much smaller number than the original 47 — specifically, only occurrences that are `setNotice={setNotice}` (JSX prop-passing to the 6 not-yet-migrated external feature components) or the Workspace-level `setNotice(null)` inside `<NoticeBanner onDismiss={() => setNotice(null)} />` should remain. Zero bare `setNotice({ type: ..., text: ... })` calls should remain anywhere in the file.

Run: `grep -n "setNotice(" src/App.tsx` and manually confirm every remaining match is one of the two allowed shapes above.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the test suite**

Run: `npm test`
Expected: all 76 domain tests pass (unaffected by this change, but confirms nothing broke).

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "$(cat <<'EOF'
refactor: migrate App.tsx to NotificationService

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Migrate EmployeeAdvancesFeature.tsx

**Files:**
- Modify: `src/features/payroll/EmployeeAdvancesFeature.tsx`

**Interfaces:**
- Consumes: `NotificationService` from `../../shared/notifications/NotificationService`
- Produces: nothing for later tasks (this file's `setNotice` prop is removed in Task 8, not here)

- [ ] **Step 1: Add the import**

Near the top of the file, alongside the existing `import type { Notice, QueueOfflineMutation } from "../../shared/types";` (line 8, leave unchanged), add:

```tsx
import { NotificationService } from "../../shared/notifications/NotificationService";
```

- [ ] **Step 2: Migrate both `setNotice(...)` calls**

Find (line 129):

```tsx
      setNotice({ type: "error", text: friendlyError(result.error) });
```

Replace with:

```tsx
      NotificationService.showError(friendlyError(result.error));
```

Find (line 135):

```tsx
    setNotice({ type: "success", text: editingAdvance ? "Employee advance updated." : "Employee advance saved." });
```

Replace with:

```tsx
    NotificationService.showSuccess(editingAdvance ? "Employee advance updated." : "Employee advance saved.");
```

Do NOT remove the `setNotice` prop from this component's type/destructuring yet — it's still declared as an unused-but-required prop parameter until Task 8 removes it from the call site in `App.tsx` too. (It will produce no type error either way since an unused destructured parameter is not a TS error.)

- [ ] **Step 3: Verify**

Run: `grep -c "setNotice(" src/features/payroll/EmployeeAdvancesFeature.tsx`
Expected: `0` (only the prop type/destructuring references `setNotice` as an identifier now, not as a call — this grep specifically matches the `setNotice(` call pattern with an open paren, which the prop declaration `setNotice,` and `setNotice: (notice: Notice) => void;` do not match).

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: all 76 domain tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/features/payroll/EmployeeAdvancesFeature.tsx
git commit -m "$(cat <<'EOF'
refactor: migrate EmployeeAdvancesFeature to NotificationService

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Migrate CollectionsFeature.tsx

**Files:**
- Modify: `src/features/collections/CollectionsFeature.tsx`

**Interfaces:**
- Consumes: `NotificationService` from `../../shared/notifications/NotificationService`
- Produces: nothing for later tasks

- [ ] **Step 1: Add the import**

Alongside the existing `import type { Notice, QueueOfflineMutation } from "../../shared/types";` (line 8, leave unchanged), add:

```tsx
import { NotificationService } from "../../shared/notifications/NotificationService";
```

- [ ] **Step 2: Migrate all 8 `setNotice(...)` calls**

Apply this exact substitution to each of the 8 occurrences (verified verbatim):

Line 138:
```tsx
      setNotice({ type: "error", text: "Enter a positive amount, keep it at least equal to payments already received, and use a due date on or after the issue date." });
```
→
```tsx
      NotificationService.showError("Enter a positive amount, keep it at least equal to payments already received, and use a due date on or after the issue date.");
```

Line 179:
```tsx
      setNotice({ type: "error", text: errorText(result.error) });
```
→
```tsx
      NotificationService.showError(errorText(result.error));
```

Line 182:
```tsx
    setNotice({ type: "success", text: "Receivable saved." });
```
→
```tsx
    NotificationService.showSuccess("Receivable saved.");
```

Line 207:
```tsx
      setNotice({ type: "error", text: errorText(result.error) });
```
→
```tsx
      NotificationService.showError(errorText(result.error));
```

Line 210:
```tsx
    setNotice({ type: "success", text: restoring ? "Receivable restored." : "Receivable archived." });
```
→
```tsx
    NotificationService.showSuccess(restoring ? "Receivable restored." : "Receivable archived.");
```

Line 224:
```tsx
      setNotice({ type: "error", text: validationError });
```
→
```tsx
      NotificationService.showError(validationError);
```

Line 252 (this one is combined with an `if` on one line):
```tsx
    if (result.error) { setNotice({ type: "error", text: errorText(result.error) }); return; }
```
→
```tsx
    if (result.error) { NotificationService.showError(errorText(result.error)); return; }
```

Line 253:
```tsx
    setNotice({ type: "success", text: amount >= collection.outstanding_balance ? "Marked as collected." : "Payment recorded." });
```
→
```tsx
    NotificationService.showSuccess(amount >= collection.outstanding_balance ? "Marked as collected." : "Payment recorded.");
```

- [ ] **Step 3: Verify**

Run: `grep -c "setNotice(" src/features/collections/CollectionsFeature.tsx`
Expected: `0`

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: all 76 domain tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/features/collections/CollectionsFeature.tsx
git commit -m "$(cat <<'EOF'
refactor: migrate CollectionsFeature to NotificationService

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Migrate SubcontractorsFeature.tsx (+ Mark paid confirm)

**Files:**
- Modify: `src/features/subcontractors/SubcontractorsFeature.tsx`

**Interfaces:**
- Consumes: `NotificationService` from `../../shared/notifications/NotificationService`
- Produces: nothing for later tasks

This file has 3 components sharing the `setNotice` prop pattern (top-level `SubcontractorsFeature`, a cash-advance form sub-component, a subcontractor-profile form sub-component). All 10 call sites are covered below.

- [ ] **Step 1: Add the import**

Alongside `import type { Notice, QueueOfflineMutation } from "../../shared/types";` (line 14, leave unchanged), add:

```tsx
import { NotificationService } from "../../shared/notifications/NotificationService";
```

- [ ] **Step 2: Migrate all 10 `setNotice(...)` calls**

Line 120:
```tsx
      setNotice({ type: "error", text: (result.error as { message?: string }).message ?? "Failed to update subcontractor." });
```
→
```tsx
      NotificationService.showError((result.error as { message?: string }).message ?? "Failed to update subcontractor.");
```

Line 123:
```tsx
    setNotice({ type: "success", text: nextStatus === "archived" ? "Subcontractor archived." : "Subcontractor restored." });
```
→
```tsx
    NotificationService.showSuccess(nextStatus === "archived" ? "Subcontractor archived." : "Subcontractor restored.");
```

Lines 131/134 are inside `markPaymentPaid` — handled together with the confirm addition in Step 3 below, skip them here.

Line 365:
```tsx
      setNotice({ type: "error", text: "Enter a cash advance amount greater than zero." });
```
→
```tsx
      NotificationService.showError("Enter a cash advance amount greater than zero.");
```

Line 369:
```tsx
      setNotice({ type: "error", text: "Enter a per-billing deduction amount greater than zero." });
```
→
```tsx
      NotificationService.showError("Enter a per-billing deduction amount greater than zero.");
```

Line 407:
```tsx
      setNotice({ type: "error", text: (result.error as { message?: string }).message ?? "Failed to save cash advance." });
```
→
```tsx
      NotificationService.showError((result.error as { message?: string }).message ?? "Failed to save cash advance.");
```

Line 410:
```tsx
    setNotice({ type: "success", text: editingAdvance ? "Cash advance updated." : "Cash advance saved." });
```
→
```tsx
    NotificationService.showSuccess(editingAdvance ? "Cash advance updated." : "Cash advance saved.");
```

Line 898:
```tsx
      setNotice({ type: "error", text: (result.error as { message?: string }).message ?? "Failed to save subcontractor." });
```
→
```tsx
      NotificationService.showError((result.error as { message?: string }).message ?? "Failed to save subcontractor.");
```

Line 901:
```tsx
    setNotice({ type: "success", text: initial ? "Subcontractor updated." : "Subcontractor added." });
```
→
```tsx
    NotificationService.showSuccess(initial ? "Subcontractor updated." : "Subcontractor added.");
```

- [ ] **Step 3: Add a confirm guard to `markPaymentPaid` and migrate its 2 setNotice calls**

Find the full function (lines 127-136):

```tsx
  async function markPaymentPaid(payment: PaymentReminder) {
    if (!supabase) return;
    const result = await markSubconPaymentReminderPaid(supabase, payment.id);
    if (result.error) {
      setNotice({ type: "error", text: (result.error as { message?: string }).message ?? "Failed to mark payout paid." });
      return;
    }
    setNotice({ type: "success", text: `Marked ${payment.title} payout paid.` });
    await onChange();
  }
```

Replace with:

```tsx
  async function markPaymentPaid(payment: PaymentReminder) {
    if (!supabase) return;
    const confirmed = await NotificationService.showConfirm({
      title: "Mark payout as paid",
      message: `Mark ${payment.title} as paid?`,
    });
    if (!confirmed) return;
    const result = await markSubconPaymentReminderPaid(supabase, payment.id);
    if (result.error) {
      NotificationService.showError((result.error as { message?: string }).message ?? "Failed to mark payout paid.");
      return;
    }
    NotificationService.showSuccess(`Marked ${payment.title} payout paid.`);
    await onChange();
  }
```

`markLatestPendingPaid` (lines 138-149) calls `markPaymentPaid` internally and needs no changes — it automatically inherits the confirm step.

- [ ] **Step 4: Verify**

Run: `grep -c "setNotice(" src/features/subcontractors/SubcontractorsFeature.tsx`
Expected: `0`

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: all 76 domain tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/subcontractors/SubcontractorsFeature.tsx
git commit -m "$(cat <<'EOF'
refactor: migrate SubcontractorsFeature to NotificationService, add Mark paid confirm

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Migrate BillingFeature.tsx (+ Mark paid confirm)

**Files:**
- Modify: `src/features/billing/BillingFeature.tsx`

**Interfaces:**
- Consumes: `NotificationService` from `../../shared/notifications/NotificationService`
- Produces: nothing for later tasks

**Important structural note:** `markPayoutPaid` (around line 825) is a **module-level free function**, not a closure over component state — it currently takes `setNotice` as an explicit parameter. This task removes that parameter entirely (since `NotificationService` is a direct import, no prop-passing needed) and updates its one call site accordingly.

- [ ] **Step 1: Add the import**

Alongside `import type { Notice, QueueOfflineMutation } from "../../shared/types";` (line 15, leave unchanged), add:

```tsx
import { NotificationService } from "../../shared/notifications/NotificationService";
```

- [ ] **Step 2: Migrate the 13 setNotice calls that are NOT in markPayoutPaid**

Line 151:
```tsx
      setNotice({ type: "success", text: "Marked as collected (will sync when online)." });
```
→
```tsx
      NotificationService.showSuccess("Marked as collected (will sync when online).");
```

Line 163:
```tsx
      setNotice({ type: "error", text: (result.error as { message?: string }).message ?? "Failed to record collection." });
```
→
```tsx
      NotificationService.showError((result.error as { message?: string }).message ?? "Failed to record collection.");
```

Line 167:
```tsx
    setNotice({ type: "success", text: "Collection marked as collected." });
```
→
```tsx
    NotificationService.showSuccess("Collection marked as collected.");
```

Line 346:
```tsx
      setNotice({ type: "error", text: `Billing for ${monthNames[month - 1]} ${year} (${periodLabel}) already exists.` });
```
→
```tsx
      NotificationService.showError(`Billing for ${monthNames[month - 1]} ${year} (${periodLabel}) already exists.`);
```

Line 380:
```tsx
      setNotice({ type: "success", text: `Billing for ${monthNames[month - 1]} ${year} (${periodLabel}) created.` });
```
→
```tsx
      NotificationService.showSuccess(`Billing for ${monthNames[month - 1]} ${year} (${periodLabel}) created.`);
```

Line 418:
```tsx
      setNotice({ type: "error", text: (result.error as { message?: string }).message ?? "Failed to create billing." });
```
→
```tsx
      NotificationService.showError((result.error as { message?: string }).message ?? "Failed to create billing.");
```

Line 423:
```tsx
    setNotice({ type: "success", text: `Billing for ${monthNames[month - 1]} ${year} (${periodLabel}) created.` });
```
→
```tsx
    NotificationService.showSuccess(`Billing for ${monthNames[month - 1]} ${year} (${periodLabel}) created.`);
```

Line 449:
```tsx
      setNotice({ type: "error", text: (result.error as { message?: string }).message ?? "Failed to update billing." });
```
→
```tsx
      NotificationService.showError((result.error as { message?: string }).message ?? "Failed to update billing.");
```

Lines 454-457 (multi-line form):
```tsx
    setNotice({
      type: "success",
      text: `Billing for ${monthNames[Number(values.billing_month) - 1]} ${values.billing_year} (${periodLabel}) updated.`,
    });
```
→
```tsx
    NotificationService.showSuccess(`Billing for ${monthNames[Number(values.billing_month) - 1]} ${values.billing_year} (${periodLabel}) updated.`);
```

Line 470:
```tsx
      setNotice({ type: "error", text: (result.error as { message?: string }).message ?? "Failed to delete billing." });
```
→
```tsx
      NotificationService.showError((result.error as { message?: string }).message ?? "Failed to delete billing.");
```

Line 473:
```tsx
    setNotice({ type: "success", text: "Billing record deleted." });
```
→
```tsx
    NotificationService.showSuccess("Billing record deleted.");
```

Line 1557:
```tsx
      setNotice({ type: "error", text: "Failed to save settings." });
```
→
```tsx
      NotificationService.showError("Failed to save settings.");
```

Line 1561:
```tsx
    setNotice({ type: "success", text: "Billing settings saved." });
```
→
```tsx
    NotificationService.showSuccess("Billing settings saved.");
```

- [ ] **Step 3: Rewrite `markPayoutPaid` (drop the `setNotice` parameter, add confirm) and update its call site**

Find the full function (lines 825-838):

```tsx
async function markPayoutPaid(
  payment: PaymentReminder,
  setNotice: (notice: Notice) => void,
  onChange: () => Promise<void>,
) {
  if (!supabase) return;
  const result = await markSubconPaymentReminderPaid(supabase, payment.id);
  if (result.error) {
    setNotice({ type: "error", text: (result.error as { message?: string }).message ?? "Failed to mark payout paid." });
    return;
  }
  setNotice({ type: "success", text: `${payment.title} payout marked paid.` });
  await onChange();
}
```

Replace with:

```tsx
async function markPayoutPaid(
  payment: PaymentReminder,
  onChange: () => Promise<void>,
) {
  if (!supabase) return;
  const confirmed = await NotificationService.showConfirm({
    title: "Mark payout as paid",
    message: `Mark ${payment.title} as paid?`,
  });
  if (!confirmed) return;
  const result = await markSubconPaymentReminderPaid(supabase, payment.id);
  if (result.error) {
    NotificationService.showError((result.error as { message?: string }).message ?? "Failed to mark payout paid.");
    return;
  }
  NotificationService.showSuccess(`${payment.title} payout marked paid.`);
  await onChange();
}
```

Find its call site (lines 651-662, the button itself on line 657):

```tsx
                                      <td>
                                        <div className="billing-row-actions">
                                          <button onClick={() => onOpenSubcontractorAccount(item.subcontractor_id)} type="button">
                                            View account
                                          </button>
                                          {payment?.status === "pending" && (
                                            <button onClick={() => void markPayoutPaid(payment, setNotice, onChange)} type="button">
                                              Mark paid
                                            </button>
                                          )}
                                        </div>
                                      </td>
```

Replace the button's `onClick` with:

```tsx
                                          {payment?.status === "pending" && (
                                            <button onClick={() => void markPayoutPaid(payment, onChange)} type="button">
                                              Mark paid
                                            </button>
                                          )}
```

(Only the `onClick` line changes — drop the `setNotice` argument. Leave the surrounding JSX untouched.)

- [ ] **Step 4: Verify**

Run: `grep -c "setNotice(" src/features/billing/BillingFeature.tsx`
Expected: `0`

Run: `npx tsc --noEmit`
Expected: no errors. (This also confirms the `Notice` import — used only for the now-removed `markPayoutPaid` parameter type — isn't left dangling; if `tsc` reports `Notice` as an unused import, remove it from the `import type { Notice, QueueOfflineMutation } from "../../shared/types";` line, changing it to `import type { QueueOfflineMutation } from "../../shared/types";` — but only if `Notice` is truly unused elsewhere in this file, e.g. still check `BillingSettingsManager`'s prop type below, which still needs it.)

Run: `npm test`
Expected: all 76 domain tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/billing/BillingFeature.tsx
git commit -m "$(cat <<'EOF'
refactor: migrate BillingFeature to NotificationService, add Mark paid confirm

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Migrate PayrollFeature.tsx (+ Mark paid confirm)

**Files:**
- Modify: `src/features/payroll/PayrollFeature.tsx`

**Interfaces:**
- Consumes: `NotificationService` from `../../shared/notifications/NotificationService`
- Produces: nothing for later tasks

This file has 21 `setNotice(` occurrences across the main `PayrollFeature` component and the separately-exported `PayrollSettingsManager`. Full line list: 299, 335, 343, 359, 383, 513, 515, 519, 549, 556, 560, 623, 690, 697, 701, 748, 755, 764, 768, 1028, 1042.

- [ ] **Step 1: Add the import**

Alongside `import type { Notice, QueueOfflineMutation } from "../../shared/types";` (line 17, leave unchanged), add:

```tsx
import { NotificationService } from "../../shared/notifications/NotificationService";
```

- [ ] **Step 2: Migrate the standard-shape calls**

Apply the standard rule (`setNotice({ type: "success", text: X })` → `NotificationService.showSuccess(X)`, `setNotice({ type: "error", text: X })` → `NotificationService.showError(X)`) to every occurrence at lines 299, 335, 343, 359, 383, 513, 515, 519, 549, 556, 560, 690, 697, 748, 755, 764, 1028, 1042. Verified examples:

Line 299:
```tsx
      setNotice({ type: "error", text: friendlyError(result.error) });
```
→
```tsx
      NotificationService.showError(friendlyError(result.error));
```

Line 343:
```tsx
      setNotice({ type: "error", text: `Assign an active position to: ${invalidEmployees.map((employee) => employee.full_name).join(", ")}.` });
```
→
```tsx
      NotificationService.showError(`Assign an active position to: ${invalidEmployees.map((employee) => employee.full_name).join(", ")}.`);
```

Line 383:
```tsx
      setNotice({ type: "success", text: "Payroll for this pay period already exists and is now selected." });
```
→
```tsx
      NotificationService.showSuccess("Payroll for this pay period already exists and is now selected.");
```

Lines 701-704 (multi-line form):
```tsx
    setNotice({
      type: "success",
      text: `${missingEmployees.length} employee${missingEmployees.length === 1 ? "" : "s"} added to payroll.`,
    });
```
→
```tsx
    NotificationService.showSuccess(`${missingEmployees.length} employee${missingEmployees.length === 1 ? "" : "s"} added to payroll.`);
```

Lines 768-771 (multi-line form):
```tsx
    setNotice({
      type: "success",
      text: `Applied payroll deductions to ${itemsNeedingPayrollDeductions.length} payroll item${itemsNeedingPayrollDeductions.length === 1 ? "" : "s"}.`,
    });
```
→
```tsx
    NotificationService.showSuccess(`Applied payroll deductions to ${itemsNeedingPayrollDeductions.length} payroll item${itemsNeedingPayrollDeductions.length === 1 ? "" : "s"}.`);
```

For the remaining occurrences not shown verbatim above (335, 359, 513, 515, 519, 549, 556, 560, 690, 697, 748, 755, 764, 1028, 1042), read each in context and apply the identical mechanical rule — every one of them (except line 623, handled next) follows the `{ type: "success" | "error", text: ... }` object shape.

- [ ] **Step 3: Migrate the ternary-shaped call at line 623**

Find:

```tsx
    setNotice(error ? { type: "error", text: friendlyError(error) } : { type: "success", text: "Payroll item updated." });
```

Replace with:

```tsx
    if (error) {
      NotificationService.showError(friendlyError(error));
    } else {
      NotificationService.showSuccess("Payroll item updated.");
    }
```

- [ ] **Step 4: Add a Mark-paid confirm to `PayrollItemsTable`**

Find the row-actions block (lines 942-952, inside `PayrollItemsTable`, whose props are `{ employees, items, onUpdate }` per its type at lines 861-869):

```tsx
          <div className="row-actions" key="actions">
            {item.status !== "paid" ? (
              <button aria-label="Mark paid" onClick={() => onUpdate(item, { status: "paid", paid_date: todayKey() })} title="Mark paid" type="button">
                <CheckCircle2 size={16} />
              </button>
            ) : (
              <button aria-label="Mark pending" onClick={() => onUpdate(item, { status: "pending", paid_date: null })} title="Mark pending" type="button">
                <CalendarClock size={16} />
              </button>
            )}
          </div>,
```

Replace the "Mark paid" button's `onClick` only (leave "Mark pending" untouched — only "Mark paid" gets a new confirm, per this migration's scope):

```tsx
          <div className="row-actions" key="actions">
            {item.status !== "paid" ? (
              <button aria-label="Mark paid" onClick={() => void handleMarkPaid(item)} title="Mark paid" type="button">
                <CheckCircle2 size={16} />
              </button>
            ) : (
              <button aria-label="Mark pending" onClick={() => onUpdate(item, { status: "pending", paid_date: null })} title="Mark pending" type="button">
                <CalendarClock size={16} />
              </button>
            )}
          </div>,
```

Add this new function inside `PayrollItemsTable`, right after its opening (after line 869, before the function's existing body):

```tsx
  async function handleMarkPaid(item: PayrollRunItem) {
    const confirmed = await NotificationService.showConfirm({
      title: "Mark as paid",
      message: "Mark this payroll item as paid?",
    });
    if (!confirmed) return;
    await onUpdate(item, { status: "paid", paid_date: todayKey() });
  }
```

- [ ] **Step 5: Verify**

Run: `grep -c "setNotice(" src/features/payroll/PayrollFeature.tsx`
Expected: `0`

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: all 76 domain tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/payroll/PayrollFeature.tsx
git commit -m "$(cat <<'EOF'
refactor: migrate PayrollFeature to NotificationService, add Mark paid confirm

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Migrate ExpensesFeature.tsx (+ replace all 4 window.confirm calls)

**Files:**
- Modify: `src/features/expenses/ExpensesFeature.tsx`

**Interfaces:**
- Consumes: `NotificationService` from `../../shared/notifications/NotificationService`
- Produces: nothing for later tasks

This file has 35 `setNotice(` occurrences (main `ExpensesFeature` component + the separately-exported `ExpenseCategoriesManager`) and 4 `window.confirm(...)` calls to replace. Full setNotice line list: 163, 172, 179, 218, 235, 239, 243, 246, 252, 268, 274, 278, 295, 302, 305, 308, 324, 355, 361, 367, 373, 403, 409, 415, 420, 437, 443, 446, 1132, 1139, 1145, 1165, 1173, 1176, 1184.

- [ ] **Step 1: Add the import**

Alongside `import type { Notice, QueueOfflineMutation } from "../../shared/types";` (line 8, leave unchanged), add:

```tsx
import { NotificationService } from "../../shared/notifications/NotificationService";
```

- [ ] **Step 2: Migrate the standard-shape setNotice calls**

Apply the standard rule to every occurrence in the line list above. Verified examples covering the different patterns you'll encounter:

Line 163:
```tsx
      setNotice({ type: "error", text: "Select a valid category." });
```
→
```tsx
      NotificationService.showError("Select a valid category.");
```

Line 218:
```tsx
      setNotice({ type: "success", text: "Expense saved locally. It will sync when online." });
```
→
```tsx
      NotificationService.showSuccess("Expense saved locally. It will sync when online.");
```

Line 246:
```tsx
      setNotice({ type: "error", text: result.error.message ?? "Failed to save expense." });
```
→
```tsx
      NotificationService.showError(result.error.message ?? "Failed to save expense.");
```

Line 305:
```tsx
      setNotice({ type: "error", text: friendlyError(result.error, "Failed to cancel this expense.") });
```
→
```tsx
      NotificationService.showError(friendlyError(result.error, "Failed to cancel this expense."));
```

Lines 373-376 (multi-line form):
```tsx
    setNotice({
      type: "success",
      text: complete ? "Final payment recorded — expense moved to History." : "Payment recorded.",
    });
```
→
```tsx
    NotificationService.showSuccess(complete ? "Final payment recorded — expense moved to History." : "Payment recorded.");
```

Apply the same mechanical substitution to every remaining line in the list (172, 179, 235, 239, 243, 252, 268, 274, 278, 295, 302, 308, 324, 355, 361, 367, 403, 409, 415, 420, 437, 443, 446, 1132, 1139, 1145, 1165, 1173, 1176, 1184) — each follows the `{ type: "success" | "error", text: ... }` shape, some with plain strings, some with `friendlyError(...)` calls (some with a second fallback-message argument, some without), some with `?? "fallback"` patterns. Preserve the exact text/expression, only change the call wrapper.

- [ ] **Step 3: Replace the 4 `window.confirm(...)` calls**

**`handleCancelExpense`** (lines 282-310) — find:

```tsx
  async function handleCancelExpense(expense: Expense) {
    if (!supabase || expense.installment_payments.length > 0) return;
    if (!window.confirm("Cancel this expense? It will move to Expense History.")) return;

    if (!navigator.onLine) {
```

Replace the function signature line through the confirm check with:

```tsx
  async function handleCancelExpense(expense: Expense) {
    if (!supabase || expense.installment_payments.length > 0) return;
    const confirmed = await NotificationService.showConfirm({
      message: "Cancel this expense? It will move to Expense History.",
      danger: true,
    });
    if (!confirmed) return;

    if (!navigator.onLine) {
```

(The rest of the function body — lines 286-310 — is unchanged except for its own `setNotice` calls, already covered by Step 2's rule if not already migrated.)

**`handleDeleteInstallmentPayment`** (lines 380-422) — find:

```tsx
  async function handleDeleteInstallmentPayment(expense: Expense, payment: ExpenseInstallmentPayment) {
    if (!supabase || !window.confirm("Delete this installment payment?")) return;
    const remainingPayments = expense.installment_payments.filter((item) => item.id !== payment.id);
```

Replace with:

```tsx
  async function handleDeleteInstallmentPayment(expense: Expense, payment: ExpenseInstallmentPayment) {
    if (!supabase) return;
    const confirmed = await NotificationService.showConfirm({
      message: "Delete this installment payment?",
      danger: true,
    });
    if (!confirmed) return;
    const remainingPayments = expense.installment_payments.filter((item) => item.id !== payment.id);
```

**`handleEndRecurringExpense`** (lines 424-448) — find:

```tsx
  async function handleEndRecurringExpense(expense: Expense) {
    if (!supabase || !window.confirm("End this recurring expense? It will move to Expense History.")) return;
    const payload = { status: "paid" as const, paid_date: todayKey() };
```

Replace with:

```tsx
  async function handleEndRecurringExpense(expense: Expense) {
    if (!supabase) return;
    const confirmed = await NotificationService.showConfirm({
      message: "End this recurring expense? It will move to Expense History.",
      danger: true,
    });
    if (!confirmed) return;
    const payload = { status: "paid" as const, paid_date: todayKey() };
```

**`deleteCategory`** (lines 1149-1186, inside `ExpenseCategoriesManager`) — find:

```tsx
  async function deleteCategory(category: ExpenseCategory) {
    if (!supabase || !window.confirm(`Delete the "${category.name}" category?`)) return;

    if (!navigator.onLine) {
```

Replace with:

```tsx
  async function deleteCategory(category: ExpenseCategory) {
    if (!supabase) return;
    const confirmed = await NotificationService.showConfirm({
      message: `Delete the "${category.name}" category?`,
      danger: true,
    });
    if (!confirmed) return;

    if (!navigator.onLine) {
```

- [ ] **Step 4: Verify**

Run: `grep -c "setNotice(" src/features/expenses/ExpensesFeature.tsx`
Expected: `0`

Run: `grep -c "window.confirm(" src/features/expenses/ExpensesFeature.tsx`
Expected: `0`

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: all 76 domain tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/expenses/ExpensesFeature.tsx
git commit -m "$(cat <<'EOF'
refactor: migrate ExpensesFeature to NotificationService, replace window.confirm calls

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Cleanup — remove the dead Notice/NoticeBanner infrastructure

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/shared/types.ts`
- Modify: `src/features/payroll/EmployeeAdvancesFeature.tsx`
- Modify: `src/features/collections/CollectionsFeature.tsx`
- Modify: `src/features/subcontractors/SubcontractorsFeature.tsx`
- Modify: `src/features/billing/BillingFeature.tsx`
- Modify: `src/features/payroll/PayrollFeature.tsx`
- Modify: `src/features/expenses/ExpensesFeature.tsx`
- Delete: `src/shared/components/NoticeBanner.tsx`

**Interfaces:**
- Consumes: nothing new — this is pure removal of now-dead code, safe only because Tasks 1-7 already migrated every consumer.
- Produces: nothing (terminal task)

- [ ] **Step 1: Remove the Workspace-level `notice`/`setNotice` state and `<NoticeBanner>` render in App.tsx**

Find and delete the `useState` line (the one NOT inside `Login` — Task 1 already removed Login's copy):

```tsx
  const [notice, setNotice] = useState<Notice>(null);
```

Find and delete the render call:

```tsx
          <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} />
```

Remove the now-unused `NoticeBanner` import:

```tsx
import { NoticeBanner } from "./shared/components/NoticeBanner";
```

Change the `Notice` import — it's no longer needed in `App.tsx` at all once the state above is gone:

```tsx
import type { Notice, QueueOfflineMutation } from "./shared/types";
```

becomes:

```tsx
import type { QueueOfflineMutation } from "./shared/types";
```

- [ ] **Step 2: Remove the `setNotice` prop from all 6 external feature components' call sites in App.tsx**

Remove the `setNotice={setNotice}` line from each of these JSX blocks (leave every other prop untouched): the `EmployeeAdvancesFeature` call (around line 4890), both `CollectionsFeature`/`CollectionHistoryFeature` calls (around lines 1376, 1385), the `SubcontractorsFeature` call (around line 1357), the `BillingFeature` call (around line 1260) and the `BillingSettingsManager` call (around line 1292), the `PayrollFeature` call (around line 1220) and the `PayrollSettingsManager` call (around line 1301), and both `ExpensesFeature` calls (around lines 1313, 1325) and the `ExpenseCategoriesManager` call (around line 1334).

- [ ] **Step 2b: Remove the `setNotice` prop from 5 additional in-file components (not in the "6 external" list — discovered during execution, not in the original brief)**

Besides `EmployeesView`/`PositionsView` (already cleaned up in Task 1) and the 6 external feature components above, `App.tsx` defines 5 MORE components that still declare a `setNotice: (notice: Notice) => void` prop: `DailyTicketEntryView`, `SubconDailyTicketView`, `AttendanceView`, `EmployeeDetailsView`, and `SubcontractorsView` (dead code, never rendered — see Task 1's report). Since Step 4 below deletes the `Notice` type entirely, every one of these must lose its `setNotice` prop too, or the file will fail to compile with "Cannot find name 'Notice'".

Current call sites (verify current line numbers via `grep -n "setNotice=" src/App.tsx` before editing, since line numbers may have shifted slightly since this note was written):

- Remove `setNotice={setNotice}` from `DailyTicketEntryView`'s call site (around line 1179).
- Remove `setNotice={setNotice}` from `SubconDailyTicketView`'s call site (around line 1186).
- Remove `setNotice={setNotice}` from `AttendanceView`'s call site (around line 1201).
- `EmployeeDetailsView`'s call site (inside `EmployeesView`, around line 4298) is NOT a plain `setNotice={setNotice}` — Task 1 replaced it with an adapter closure:

  ```tsx
  setNotice={(notice) => {
    if (!notice) return;
    if (notice.type === "error") NotificationService.showError(notice.text);
    else NotificationService.showSuccess(notice.text);
  }}
  ```

  Delete this entire `setNotice={...}` attribute (all 5 lines) from that JSX call site — once `EmployeeDetailsView` no longer has a `setNotice` prop (per below), nothing should be passed for it at all.
- `SubcontractorsView` is dead code (never rendered anywhere), so it has no call site to clean up — only its own prop type/destructuring (next step) needs fixing.

For each of these 4 components with a real call site (`DailyTicketEntryView`, `SubconDailyTicketView`, `AttendanceView`, `EmployeeDetailsView`), also remove `setNotice` from that component's own prop type and destructured parameter list (same treatment as Step 3 below, just for these 4 extra components plus `SubcontractorsView`'s signature). Concretely: remove `setNotice,` from each destructured parameter list, and remove `setNotice: (notice: Notice) => void;` from each prop type. Do this for all 5: `DailyTicketEntryView`, `SubconDailyTicketView`, `AttendanceView`, `EmployeeDetailsView`, `SubcontractorsView`.

Do NOT delete the `SubcontractorsView` component itself (it's out of scope to remove dead code in this migration) — only strip its now-invalid `setNotice`/`Notice` reference so it keeps compiling.

- [ ] **Step 3: Remove the `setNotice` prop from each of the 6 feature files' prop types and destructuring, and fix their `Notice` import**

In each of these 6 files, remove `setNotice` from the destructured parameter list and from the prop type (`setNotice: (notice: Notice) => void;`), then change the import line from:

```tsx
import type { Notice, QueueOfflineMutation } from "../../shared/types";
```

to:

```tsx
import type { QueueOfflineMutation } from "../../shared/types";
```

Files to edit this way:
- `src/features/payroll/EmployeeAdvancesFeature.tsx` (one component)
- `src/features/collections/CollectionsFeature.tsx` (the shared `CollectionFeatureProps` type and `CollectionWorkspace`'s destructuring)
- `src/features/subcontractors/SubcontractorsFeature.tsx` (all 3 components: top-level `SubcontractorsFeature`, the cash-advance form sub-component around line 279/296, the subcontractor-profile form sub-component around line 867/873)
- `src/features/billing/BillingFeature.tsx` (`BillingFeatureProps`/`BillingFeature`, and `BillingSettingsManager`)
- `src/features/payroll/PayrollFeature.tsx` (main `PayrollFeature`, and `PayrollSettingsManager`)
- `src/features/expenses/ExpensesFeature.tsx` (`ExpensesFeatureProps`/`ExpensesFeature`, and `ExpenseCategoriesManager`)

- [ ] **Step 4: Delete `Notice` from `src/shared/types.ts`**

Find:

```tsx
export type Notice = { type: "success" | "error"; text: string } | null;
```

Delete this line entirely. Leave `AppError` and `QueueOfflineMutation` untouched.

- [ ] **Step 5: Delete the NoticeBanner component file**

```bash
rm "src/shared/components/NoticeBanner.tsx"
```

- [ ] **Step 6: Project-wide verification that nothing references the removed code**

Run: `grep -rn "setNotice" src/`
Expected: no matches anywhere in the project.

Run: `grep -rn "NoticeBanner" src/`
Expected: no matches anywhere in the project.

Run: `grep -rn "\bNotice\b" src/ --include="*.ts" --include="*.tsx"`
Expected: no matches (the type no longer exists anywhere, and nothing imports it).

Run: `npx tsc --noEmit`
Expected: no errors — this is the definitive check that every consumer was correctly migrated in Tasks 1-7 before this cleanup ran.

Run: `npm test`
Expected: all 76 domain tests pass.

Run: `npm run build`
Expected: production build succeeds (confirms no leftover dead imports break bundling).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor: remove dead Notice/NoticeBanner infrastructure

All consumers migrated to NotificationService in prior commits; this
removes the now-unused setNotice prop, Notice type, and NoticeBanner
component entirely.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Post-plan manual verification (required, cannot be automated in this environment)

After all 8 tasks land, a human must verify in a real browser (no browser-automation tool is available here):

1. Every migrated success/error message still appears as a toast with the correct text, in every one of the 7 files' flows (spot-check a handful, not all 138).
2. The position-delete confirm (App.tsx) still blocks deletion when employees are assigned (now via a warning toast instead of a disabled button) and deletes correctly when confirmed and no employees are assigned.
3. All 4 migrated Expenses confirms (cancel expense, delete installment payment, end recurring expense, delete category) behave identically to their old `window.confirm` versions — proceeding on OK, doing nothing on Cancel.
4. All 3 new "Mark paid" confirms (subcontractor, billing payout, payroll) appear before the status actually changes, and cancelling truly does nothing.
5. The hardcoded "no position" warning banner (App.tsx, Daily Tickets area) still displays when applicable.
