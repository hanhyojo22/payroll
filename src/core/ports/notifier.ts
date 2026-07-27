/**
 * User feedback, stated as a port so use-cases can assert on what the user was told without
 * mounting the notification host. `confirm` is included because destructive actions branch on
 * it -- a use-case that skipped the confirmation would otherwise be untestable.
 */
export interface Notifier {
  success(message: string): void;
  error(message: string): void;
  confirm(options: { title: string; message: string; danger?: boolean }): Promise<boolean>;
}
