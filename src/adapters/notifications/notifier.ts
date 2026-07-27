import type { Notifier } from "../../core/ports/notifier";
import { NotificationService } from "../../shared/notifications/NotificationService";

/** Notifier backed by the app's toast/confirm host. */
export const notificationServiceNotifier: Notifier = {
  success: (message) => NotificationService.showSuccess(message),
  error: (message) => NotificationService.showError(message),
  confirm: (options) => NotificationService.showConfirm(options),
};
