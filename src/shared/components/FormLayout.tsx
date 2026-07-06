import type { InputHTMLAttributes, ReactNode } from "react";
import { CalendarClock, CheckCircle2, Pencil, Trash2, X } from "lucide-react";
import { Spinner } from "./Spinner";

export function Modal({
  children,
  className,
  onClose,
  title,
}: {
  children: ReactNode;
  className?: string;
  onClose: () => void;
  title: string;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-label={title} aria-modal="true" className={`modal${className ? ` ${className}` : ""}`} role="dialog">
        <header>
          <h2>{title}</h2>
          <button aria-label="Close" onClick={onClose} type="button">
            <X size={16} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function FormActions({ busy, onClose }: { busy: boolean; onClose: () => void }) {
  return (
    <div className="form-actions full">
      <button className="secondary-button" onClick={onClose} type="button">
        Cancel
      </button>
      <button className="primary-button compact" disabled={busy} type="submit">
        {busy && <Spinner size="small" />}
        {busy ? "Saving..." : "Save"}
      </button>
    </div>
  );
}

export function TextField({
  label,
  onChange,
  type = "text",
  ...props
}: {
  label: string;
  onChange: (value: string) => void;
  type?: string;
  value: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "type" | "value">) {
  return (
    <label>
      {label}
      <input
        {...props}
        onChange={(event) => onChange(event.target.value)}
        type={type}
      />
    </label>
  );
}

export function RowActions({
  canMarkPaid,
  markActionLabel = "Mark paid",
  onDelete,
  onEdit,
  onHistory,
  onMarkPaid,
}: {
  canMarkPaid?: boolean;
  markActionLabel?: string;
  onDelete: () => void;
  onEdit: () => void;
  onHistory?: () => void;
  onMarkPaid?: () => void;
}) {
  return (
    <div className="row-actions">
      {canMarkPaid && onMarkPaid && (
        <button aria-label={markActionLabel} onClick={onMarkPaid} title={markActionLabel} type="button">
          <CheckCircle2 size={16} />
        </button>
      )}
      <button aria-label="Edit" onClick={onEdit} title="Edit" type="button">
        <Pencil size={16} />
      </button>
      {onHistory && (
        <button aria-label="Payroll history" onClick={onHistory} title="Payroll history" type="button">
          <CalendarClock size={16} />
        </button>
      )}
      <button aria-label="Delete" onClick={onDelete} title="Delete" type="button">
        <Trash2 size={16} />
      </button>
    </div>
  );
}
