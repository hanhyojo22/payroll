# NotificationService Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a global, prop-free `NotificationService` (toasts, confirm dialog, loading overlay) that any component can call without threading props through the tree.

**Architecture:** A minimal external store (subscribe/getSnapshot/dispatch, no new dependency) holds toast/confirm/loading state. `NotificationService` is a plain object exposing `showSuccess/showError/showWarning/showInfo/showConfirm/showLoading`, each dispatching into the store. A single `NotificationHost` component, mounted once in `main.tsx` via `useSyncExternalStore`, renders the toast stack, the confirm modal, and the loading overlay.

**Tech Stack:** React 18 (`useSyncExternalStore`), TypeScript, existing `lucide-react` icons, existing CSS custom properties in `src/styles.css`. No new dependencies.

## Global Constraints

- Additive only — do not modify `App.tsx`, feature modules, `Notice`/`NoticeBanner`, or any existing `window.confirm` call site. The only existing file touched is `src/main.tsx`.
- No automated tests: per `CLAUDE.md`, `vitest.config.ts` only collects `src/domain/**/*.test.ts` (pure calc logic, no DOM). This module is UI/interaction, so verification is manual via the dev server, per each task's verification step.
- Confirm dialog must reuse the existing `.modal` / `.modal-backdrop` / `.confirm-modal` / `.confirm-actions` / `.confirm-icon-wrap` / `.danger-button` CSS classes already defined in `src/styles.css` (used today by the position-delete modal in `App.tsx:2219-2248`) — no new CSS for the confirm dialog itself.
- Toast auto-dismiss defaults: success 3000ms, info 4000ms, warning 6000ms, error 0 (no auto-dismiss). `options.duration` overrides; `0` disables auto-dismiss.
- Only one confirm dialog visible at a time; concurrent `showConfirm()` calls queue.
- `showLoading()` replaces the active overlay's message in place (never stacks); a `hide()` from a superseded call must be a no-op.

---

### Task 1: Notification store engine

**Files:**
- Create: `src/shared/notifications/notificationStore.ts`

**Interfaces:**
- Consumes: nothing (foundational, no imports from app code)
- Produces (used by Task 2 and Task 3):
  - `export type ToastType = "success" | "error" | "warning" | "info"`
  - `export type ToastItem = { id: string; type: ToastType; message: string; duration: number }`
  - `export type ConfirmRequest = { id: string; title?: string; message: string; confirmText: string; cancelText: string; danger: boolean; resolve: (value: boolean) => void }`
  - `export type LoadingState = { id: string; message?: string }`
  - `export type NotificationState = { toasts: ToastItem[]; confirmRequest: ConfirmRequest | null; loading: LoadingState | null }`
  - `export function subscribe(listener: () => void): () => void`
  - `export function getSnapshot(): NotificationState`
  - `export function addToast(type: ToastType, message: string, duration: number): string` (returns toast id)
  - `export function dismissToast(id: string): void`
  - `export function enqueueConfirm(request: Omit<ConfirmRequest, "id" | "resolve">): Promise<boolean>`
  - `export function resolveConfirm(id: string, value: boolean): void`
  - `export function setLoading(message: string | undefined): string` (returns loading id)
  - `export function clearLoading(id: string): void`

- [ ] **Step 1: Write the store**

```ts
export type ToastType = "success" | "error" | "warning" | "info";

export type ToastItem = {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
};

export type ConfirmRequest = {
  id: string;
  title?: string;
  message: string;
  confirmText: string;
  cancelText: string;
  danger: boolean;
  resolve: (value: boolean) => void;
};

export type LoadingState = {
  id: string;
  message?: string;
};

export type NotificationState = {
  toasts: ToastItem[];
  confirmRequest: ConfirmRequest | null;
  loading: LoadingState | null;
};

let state: NotificationState = { toasts: [], confirmRequest: null, loading: null };
const listeners = new Set<() => void>();
const toastTimers = new Map<string, number>();
const confirmQueue: ConfirmRequest[] = [];

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): NotificationState {
  return state;
}

export function addToast(type: ToastType, message: string, duration: number): string {
  const id = crypto.randomUUID();
  state = { ...state, toasts: [...state.toasts, { id, type, message, duration }] };
  emit();
  if (duration > 0) {
    toastTimers.set(id, window.setTimeout(() => dismissToast(id), duration));
  }
  return id;
}

export function dismissToast(id: string): void {
  const timer = toastTimers.get(id);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    toastTimers.delete(id);
  }
  state = { ...state, toasts: state.toasts.filter((toast) => toast.id !== id) };
  emit();
}

export function enqueueConfirm(request: Omit<ConfirmRequest, "id" | "resolve">): Promise<boolean> {
  return new Promise((resolve) => {
    const fullRequest: ConfirmRequest = { ...request, id: crypto.randomUUID(), resolve };
    if (state.confirmRequest) {
      confirmQueue.push(fullRequest);
      return;
    }
    state = { ...state, confirmRequest: fullRequest };
    emit();
  });
}

export function resolveConfirm(id: string, value: boolean): void {
  // Guards against a stale caller (e.g. a delayed keydown handler) resolving
  // a confirm request that's already been superseded by the next queued one.
  if (state.confirmRequest?.id !== id) return;
  state.confirmRequest.resolve(value);
  const next = confirmQueue.shift() ?? null;
  state = { ...state, confirmRequest: next };
  emit();
}

export function setLoading(message: string | undefined): string {
  const id = crypto.randomUUID();
  state = { ...state, loading: { id, message } };
  emit();
  return id;
}

export function clearLoading(id: string): void {
  // Only the most recent showLoading() call's id can clear the overlay, so a
  // stale hide() from an earlier, already-superseded call is a no-op.
  if (state.loading?.id !== id) return;
  state = { ...state, loading: null };
  emit();
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/shared/notifications/notificationStore.ts
git commit -m "$(cat <<'EOF'
feat: add notification store engine

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: NotificationService public API

**Files:**
- Create: `src/shared/notifications/NotificationService.ts`

**Interfaces:**
- Consumes: `addToast`, `enqueueConfirm`, `setLoading`, `clearLoading` from `./notificationStore` (Task 1)
- Produces (used by app code and Task 5's manual verification):
  - `export const NotificationService: { showSuccess, showError, showWarning, showInfo, showConfirm, showLoading }`

- [ ] **Step 1: Write the service**

```ts
import { addToast, clearLoading, enqueueConfirm, setLoading } from "./notificationStore";

type ToastOptions = { duration?: number };

type ConfirmOptions = {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

const DEFAULT_DURATIONS = {
  success: 3000,
  info: 4000,
  warning: 6000,
  error: 0,
} as const;

function showToast(type: keyof typeof DEFAULT_DURATIONS, message: string, options?: ToastOptions): void {
  addToast(type, message, options?.duration ?? DEFAULT_DURATIONS[type]);
}

export const NotificationService = {
  showSuccess(message: string, options?: ToastOptions): void {
    showToast("success", message, options);
  },
  showError(message: string, options?: ToastOptions): void {
    showToast("error", message, options);
  },
  showWarning(message: string, options?: ToastOptions): void {
    showToast("warning", message, options);
  },
  showInfo(message: string, options?: ToastOptions): void {
    showToast("info", message, options);
  },
  showConfirm(options: ConfirmOptions): Promise<boolean> {
    return enqueueConfirm({
      title: options.title,
      message: options.message,
      confirmText: options.confirmText ?? "Confirm",
      cancelText: options.cancelText ?? "Cancel",
      danger: options.danger ?? false,
    });
  },
  showLoading(message?: string): () => void {
    const id = setLoading(message);
    return () => clearLoading(id);
  },
};

if (import.meta.env.DEV) {
  (window as unknown as { NotificationService: typeof NotificationService }).NotificationService = NotificationService;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/shared/notifications/NotificationService.ts
git commit -m "$(cat <<'EOF'
feat: add NotificationService public API

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: NotificationHost component

**Files:**
- Create: `src/shared/notifications/NotificationHost.tsx`

**Interfaces:**
- Consumes: `subscribe`, `getSnapshot`, `dismissToast`, `resolveConfirm` from `./notificationStore` (Task 1); `ToastType` type from `./notificationStore`
- Produces (used by Task 5): `export function NotificationHost(): JSX.Element`

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useSyncExternalStore } from "react";
import { AlertTriangle, CheckCircle2, HelpCircle, Info, X, XCircle } from "lucide-react";
import { dismissToast, getSnapshot, resolveConfirm, subscribe } from "./notificationStore";
import type { ToastType } from "./notificationStore";

const TOAST_ICONS: Record<ToastType, JSX.Element> = {
  success: <CheckCircle2 size={18} />,
  error: <XCircle size={18} />,
  warning: <AlertTriangle size={18} />,
  info: <Info size={18} />,
};

export function NotificationHost() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const confirmRequest = state.confirmRequest;

  useEffect(() => {
    if (!confirmRequest) return;
    const requestId = confirmRequest.id;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") resolveConfirm(requestId, false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirmRequest]);

  return (
    <>
      <div className="toast-stack" aria-live="polite">
        {state.toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.type}`} role={toast.type === "error" ? "alert" : "status"}>
            {TOAST_ICONS[toast.type]}
            <p>{toast.message}</p>
            <button aria-label="Dismiss notification" onClick={() => dismissToast(toast.id)} type="button">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      {confirmRequest && (
        <div className="modal-backdrop" onClick={() => resolveConfirm(confirmRequest.id, false)} role="presentation">
          <section
            aria-label={confirmRequest.title ?? "Confirm"}
            aria-modal="true"
            className="modal confirm-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className={`confirm-icon-wrap${confirmRequest.danger ? " danger" : ""}`}>
              {confirmRequest.danger ? <AlertTriangle size={24} /> : <HelpCircle size={24} />}
            </div>
            {confirmRequest.title && <h2>{confirmRequest.title}</h2>}
            <p>{confirmRequest.message}</p>
            <div className="confirm-actions">
              <button className="secondary-button" onClick={() => resolveConfirm(confirmRequest.id, false)} type="button">
                {confirmRequest.cancelText}
              </button>
              <button
                className={`primary-button${confirmRequest.danger ? " danger-button" : ""}`}
                onClick={() => resolveConfirm(confirmRequest.id, true)}
                type="button"
              >
                {confirmRequest.confirmText}
              </button>
            </div>
          </section>
        </div>
      )}

      {state.loading && (
        <div aria-busy="true" className="loading-overlay" role="alert">
          <span aria-hidden="true" className="spinner" />
          {state.loading.message && <p>{state.loading.message}</p>}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/shared/notifications/NotificationHost.tsx
git commit -m "$(cat <<'EOF'
feat: add NotificationHost renderer (toasts, confirm modal, loading overlay)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Styles for toasts and loading overlay

**Files:**
- Modify: `src/styles.css` (insert new section after the existing `/* ── Notice / Toast ── */` block, right after line `.notice.success { ... }` closes — search for `.notice.success` to find the anchor)

**Interfaces:**
- Consumes: existing CSS custom properties (`--color-success-bg`, `--color-success-text`, `--color-danger-bg`, `--color-danger-text`, `--color-warning-bg`, `--color-warning-text`, `--color-accent`, `--radius-md`, `--radius-sm`, `--shadow-lg`, `--font-size-sm`) already defined earlier in `src/styles.css`
- Produces: `.toast-stack`, `.toast`, `.toast-success`, `.toast-error`, `.toast-warning`, `.toast-info`, `.loading-overlay` classes used by `NotificationHost.tsx` (Task 3)

- [ ] **Step 1: Add the CSS**

Find this existing block in `src/styles.css` (around line 583-587):

```css
.notice.success {
  background: var(--color-success-bg);
  border-color: rgba(52, 199, 89, 0.25);
  color: var(--color-success-text);
}
```

Insert immediately after it:

```css

/* ── NotificationService: toasts ── */

.toast-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: min(380px, calc(100vw - 32px));
  position: fixed;
  right: 24px;
  top: 24px;
  z-index: 70;
}

.toast {
  align-items: flex-start;
  background: var(--color-surface);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  display: flex;
  font-weight: 500;
  gap: 10px;
  padding: 14px 16px;
}

.toast p {
  flex: 1;
  line-height: 1.4;
  margin: 0;
}

.toast button {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  color: currentColor;
  display: inline-flex;
  flex: 0 0 auto;
  height: 26px;
  justify-content: center;
  margin: -4px -6px 0 0;
  padding: 0;
  width: 26px;
}

.toast button:hover {
  background: rgba(0, 0, 0, 0.06);
}

.toast-success {
  background: var(--color-success-bg);
  border-color: rgba(52, 199, 89, 0.25);
  color: var(--color-success-text);
}

.toast-error {
  background: var(--color-danger-bg);
  border-color: rgba(255, 59, 48, 0.2);
  color: var(--color-danger-text);
}

.toast-warning {
  background: var(--color-warning-bg);
  border-color: rgba(255, 149, 0, 0.25);
  color: var(--color-warning-text);
}

.toast-info {
  background: rgba(0, 113, 227, 0.08);
  border-color: rgba(0, 113, 227, 0.2);
  color: var(--color-accent);
}

/* ── NotificationService: loading overlay ── */

.loading-overlay {
  align-items: center;
  background: rgba(0, 0, 0, 0.48);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  color: #ffffff;
  display: flex;
  flex-direction: column;
  gap: 14px;
  inset: 0;
  justify-content: center;
  position: fixed;
  z-index: 80;
}

.loading-overlay .spinner {
  border-color: rgba(255, 255, 255, 0.3);
  border-top-color: #ffffff;
  height: 40px;
  width: 40px;
}

.loading-overlay p {
  font-size: var(--font-size-sm);
  font-weight: 500;
  margin: 0;
}

@media (max-width: 640px) {
  .toast-stack { left: 16px; right: 16px; top: 16px; max-width: none; }
}
```

- [ ] **Step 2: Type-check (sanity — CSS doesn't affect TS, but confirms nothing else broke)**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "$(cat <<'EOF'
feat: add toast and loading overlay styles

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Mount NotificationHost and manually verify

**Files:**
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: `NotificationHost` from `./shared/notifications/NotificationHost` (Task 3); `NotificationService` exposed on `window` in dev mode (Task 2)
- Produces: nothing further (terminal task)

- [ ] **Step 1: Mount the host**

Current `src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

Replace with:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { NotificationHost } from "./shared/notifications/NotificationHost";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <NotificationHost />
  </React.StrictMode>,
);
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Start the dev server**

Run: `npm run dev`
Expected: Vite prints a local URL (e.g. `http://localhost:5173`). Open it in a browser.

- [ ] **Step 4: Manually verify toasts**

In the browser devtools console, run each of these one at a time and confirm a toast appears top-right with the right color/icon, then disappears on its own after the expected duration (or stays for error until dismissed):

```js
NotificationService.showSuccess("Saved successfully");   // green, disappears after ~3s
NotificationService.showInfo("Heads up, FYI");            // blue, disappears after ~4s
NotificationService.showWarning("Careful with this");     // orange, disappears after ~6s
NotificationService.showError("Something went wrong");    // red, stays until you click the × button
```

Also verify: trigger 2-3 of these in quick succession and confirm they stack vertically rather than overlapping, and clicking a toast's × button removes only that one.

- [ ] **Step 5: Manually verify the confirm dialog**

```js
NotificationService.showConfirm({ title: "Delete item", message: "Are you sure?", danger: true }).then((result) => console.log("resolved:", result));
```

Confirm: the modal appears styled like the existing position-delete modal (icon circle, title, message, Cancel/Confirm buttons, red Confirm button since `danger: true`). Verify each of these resolves the promise correctly (check the console log):
- Click Confirm → logs `resolved: true`
- Re-run the command, click Cancel → logs `resolved: false`
- Re-run the command, click the backdrop (outside the dialog) → logs `resolved: false`
- Re-run the command, press Escape → logs `resolved: false`

Also verify queuing: run the command twice back-to-back without resolving the first — confirm only one dialog is visible, and after resolving it, the second one appears.

- [ ] **Step 6: Manually verify the loading overlay**

```js
const hide = NotificationService.showLoading("Saving...");
```

Confirm a full-screen overlay with a spinner and "Saving..." text appears, blocking clicks on the page behind it. Then run:

```js
hide();
```

Confirm the overlay disappears. Then verify message replacement and stale-hide safety:

```js
const hide1 = NotificationService.showLoading("Step 1...");
const hide2 = NotificationService.showLoading("Step 2...");
hide1(); // should do nothing — hide1 is stale, overlay stays visible showing "Step 2..."
hide2(); // should now clear the overlay
```

- [ ] **Step 7: Confirm existing behavior is untouched**

Run: `npm test`
Expected: all 76 existing domain tests still pass (this change touches no domain code, but confirms nothing else broke).

Navigate the app briefly (Dashboard, Employees, Daily Tickets) and confirm existing notices (`NoticeBanner`) and the position-delete confirm modal still work exactly as before — this module is additive and must not interfere with them.

- [ ] **Step 8: Commit**

```bash
git add src/main.tsx
git commit -m "$(cat <<'EOF'
feat: mount NotificationHost at app root

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
