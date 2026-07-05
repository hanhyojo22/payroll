# NotificationService design

Date: 2026-07-05

## Problem

The app has no shared, prop-free way to show notifications or confirmation
dialogs:

- Success/error messages go through a `Notice` type (`success | error` only)
  and a single `<NoticeBanner>` rendered once in `Workspace`, with `setNotice`
  threaded as a prop through every feature component.
- Confirmations are ad hoc: `window.confirm()` is used in 4 places in
  `ExpensesFeature.tsx`, and there's a one-off inline "delete position" modal
  in `App.tsx` with its own local `confirmDelete` state, not reused anywhere
  else.
- There's no loading-overlay pattern; components handle loading state
  individually.

## Scope

Additive only. This introduces a new `NotificationService` module and a
root-mounted host component. **No existing call sites are migrated** —
`setNotice`, `NoticeBanner`, `window.confirm`, and the position-delete modal
all keep working exactly as they do today. New code (and future refactors,
if ever desired) can opt into `NotificationService`.

## Architecture

New module: `src/shared/notifications/`

- `notificationStore.ts` — a minimal external store (subscribe / getSnapshot /
  dispatch pattern, no new dependency) holding:
  - `toasts: ToastItem[]` — active success/error/warning/info toasts
  - `confirmRequest: ConfirmRequest | null` — the currently-shown confirm
    dialog (if any), plus a queue of pending confirm requests
  - `loading: { id: string; message?: string } | null` — the currently-shown
    loading overlay (if any)
- `NotificationService.ts` — the public API object, calling into the store.
- `NotificationHost.tsx` — the single component that subscribes to the store
  via `useSyncExternalStore` and renders the toast stack, the confirm modal,
  and the loading overlay.

`NotificationHost` is mounted once in `src/main.tsx`, alongside `<App />`,
so it works regardless of what view/route is active and requires no props.

## Public API

```ts
NotificationService.showSuccess(message: string, options?: { duration?: number }): void
NotificationService.showError(message: string, options?: { duration?: number }): void
NotificationService.showWarning(message: string, options?: { duration?: number }): void
NotificationService.showInfo(message: string, options?: { duration?: number }): void

NotificationService.showConfirm(options: {
  title?: string;
  message: string;
  confirmText?: string;   // default "Confirm"
  cancelText?: string;    // default "Cancel"
  danger?: boolean;       // true => destructive/red confirm button
}): Promise<boolean>

NotificationService.showLoading(message?: string): () => void   // call the returned fn to hide it
```

## Behavior

### Toasts (success / error / warning / info)

- Stack top-right, newest on top, each independently auto-dismissing (or not).
- Default durations: success 3000ms, info 4000ms, warning 6000ms. Error has
  no auto-dismiss — stays until manually closed (mirrors today's
  `NoticeBanner`, which only auto-dismisses success).
- `options.duration` overrides the default for any type. Passing `0`
  disables auto-dismiss.
- Every toast has a manual dismiss (×) button regardless of auto-dismiss.
- Toasts are keyed by id (`crypto.randomUUID()`), not array index, so a
  timer firing after other toasts have been added/removed can't dismiss the
  wrong one.

### Confirm dialog

- Visually reuses the app's existing `.modal` / `.modal-backdrop` classes
  (same look as the current position-delete modal) so it reads as native to
  the app rather than a new visual language.
- Returns a `Promise<boolean>`: `true` on Confirm, `false` on Cancel,
  backdrop click, or Escape key.
- Only one confirm dialog is shown at a time. If `showConfirm()` is called
  while one is already open, the new request is queued and shown after the
  current one resolves — dialogs never stack.
- `danger: true` styles the confirm button as destructive (red), for use on
  delete-style confirmations.

### Loading overlay

- Full-screen backdrop + centered spinner + optional message, blocks
  interaction with the rest of the page.
- Calling `showLoading()` again while one is already active updates the
  message in place rather than stacking a second overlay.
- The returned `hide()` closure carries the request's id and only clears the
  overlay if it is still the active one — a stale `hide()` from an earlier,
  already-superseded `showLoading()` call cannot dismiss a newer one.

## Files touched

New:
- `src/shared/notifications/notificationStore.ts`
- `src/shared/notifications/NotificationService.ts`
- `src/shared/notifications/NotificationHost.tsx`
- CSS additions to `src/styles.css` (toast stack, toast variants, loading
  overlay; confirm modal reuses existing `.modal`/`.modal-backdrop`)

Modified:
- `src/main.tsx` — mount `<NotificationHost />` next to `<App />`

No other files change.

## Testing

Per this project's conventions (see `CLAUDE.md`), only
`src/domain/**/*.test.ts` files are unit-tested — pure calculation logic, no
DOM. This module is UI/interaction, not domain logic, so it will not have
automated tests. Verification will be manual: run the dev server and
exercise each `show*` method (toast stacking/auto-dismiss, confirm
dialog resolving true/false via button/backdrop/Escape, loading overlay
blocking and correctly unblocking), per the project's `verify` skill.
