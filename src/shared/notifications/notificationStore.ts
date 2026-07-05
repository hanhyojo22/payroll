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
