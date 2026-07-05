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
