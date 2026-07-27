import { useSyncExternalStore } from "react";
import { AlertTriangle, CheckCircle2, HelpCircle, Info, X, XCircle } from "lucide-react";
import { dismissToast, getSnapshot, resolveConfirm, subscribe } from "./notificationStore";
import type { ToastItem, ToastType } from "./notificationStore";
import { useDialog } from "../components/useDialog";

const TOAST_ICONS: Record<ToastType, JSX.Element> = {
  success: <CheckCircle2 size={18} />,
  error: <XCircle size={18} />,
  warning: <AlertTriangle size={18} />,
  info: <Info size={18} />,
};

function ToastStack({ className, toasts }: { className: string; toasts: ToastItem[] }) {
  if (toasts.length === 0) return null;

  return (
    <div className={className}>
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.type}`} role={toast.type === "error" ? "alert" : "status"}>
          {TOAST_ICONS[toast.type]}
          <p>{toast.message}</p>
          <button aria-label="Dismiss notification" onClick={() => dismissToast(toast.id)} type="button">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

// Its own component so useDialog can run unconditionally -- Escape, focus trap and focus
// restore all come from the hook rather than being re-implemented here.
function ConfirmDialog({ request }: { request: NonNullable<ReturnType<typeof getSnapshot>["confirmRequest"]> }) {
  const { backdropProps, dialogProps } = useDialog<HTMLElement>({
    label: request.title ?? "Confirm",
    onClose: () => resolveConfirm(request.id, false),
  });

  return (
    <div className="modal-backdrop" {...backdropProps}>
      <section className="modal confirm-modal" {...dialogProps}>
        <div className={`confirm-icon-wrap${request.danger ? " danger" : ""}`}>
          {request.danger ? <AlertTriangle size={24} /> : <HelpCircle size={24} />}
        </div>
        {request.title && <h2>{request.title}</h2>}
        <p>{request.message}</p>
        <div className="confirm-actions">
          <button className="secondary-button" onClick={() => resolveConfirm(request.id, false)} type="button">
            {request.cancelText}
          </button>
          <button
            className={`primary-button${request.danger ? " danger-button" : ""}`}
            onClick={() => resolveConfirm(request.id, true)}
            type="button"
          >
            {request.confirmText}
          </button>
        </div>
      </section>
    </div>
  );
}

export function NotificationHost() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const confirmRequest = state.confirmRequest;
  const successInfoToasts = state.toasts.filter((toast) => toast.type === "success" || toast.type === "info");
  const attentionToasts = state.toasts.filter((toast) => toast.type === "warning" || toast.type === "error");

  return (
    <>
      <ToastStack className="toast-stack toast-stack-top-right toast-stack-success-info" toasts={successInfoToasts} />
      <ToastStack className="toast-stack toast-stack-top-center toast-stack-attention" toasts={attentionToasts} />

      {confirmRequest && <ConfirmDialog request={confirmRequest} />}

      {state.loading && (
        <div aria-busy="true" className="loading-overlay" role="status">
          <span aria-hidden="true" className="spinner" />
          {state.loading.message && <p>{state.loading.message}</p>}
        </div>
      )}
    </>
  );
}
