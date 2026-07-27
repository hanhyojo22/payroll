import { useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

/**
 * Wires the accessibility behaviour a modal needs -- dialog role and accessible name, Escape
 * to close, backdrop-click to close, focus moved in on open, trapped while open, and returned
 * to whatever opened it. Deliberately a hook rather than a wrapper component: the app's modals
 * each have their own header markup and class names, and those must stay untouched.
 */
export function useDialog<T extends HTMLElement = HTMLDivElement>({
  label,
  labelledBy,
  onClose,
  open = true,
}: {
  label?: string;
  labelledBy?: string;
  onClose: () => void;
  /** Pass the visibility flag for modals written inline as `{open && <div .../>}`, so the
   *  hook can sit above the conditional without trapping focus while the modal is hidden. */
  open?: boolean;
}) {
  const dialogRef = useRef<T>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    (focusable?.[0] ?? dialogRef.current)?.focus();

    return () => {
      // The opener can be gone if the dialog closed because its row was deleted.
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  return {
    backdropProps: {
      onClick: onClose,
      role: "presentation" as const,
    },
    dialogProps: {
      "aria-label": labelledBy ? undefined : label,
      "aria-labelledby": labelledBy,
      "aria-modal": true,
      onClick: (event: ReactMouseEvent) => event.stopPropagation(),
      ref: dialogRef,
      role: "dialog" as const,
      tabIndex: -1,
    },
  };
}
