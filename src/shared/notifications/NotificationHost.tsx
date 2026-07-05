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
      <div className="toast-stack">
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
        <div aria-busy="true" className="loading-overlay" role="status">
          <span aria-hidden="true" className="spinner" />
          {state.loading.message && <p>{state.loading.message}</p>}
        </div>
      )}
    </>
  );
}
