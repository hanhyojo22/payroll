import { useEffect, useMemo, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Archive, CheckCircle2, Eye, Plus, RotateCcw, Search, X } from "lucide-react";
import { collectionAgingBucket, collectionStatus, dateCollectedFor, validateCollectionPayment, withCollectionTotals } from "../../domain/collections";
import { isOfflineLikeError } from "../../lib/offlineSync";
import { supabase } from "../../supabase";
import { MoneyField } from "../../shared/components/MoneyField";
import { PageHeader } from "../../shared/components/PageLayout";
import type { QueueOfflineMutation } from "../../shared/types";
import { NotificationService } from "../../shared/notifications/NotificationService";
import { currency, formatMoney } from "../../shared/utils/currency";
import { todayKey } from "../../shared/utils/dates";
import type {
  CollectionFormValues,
  CollectionPayment,
  CollectionPaymentFormValues,
  CollectionReminder,
  CollectionStatus,
} from "../../types";
import {
  archiveReceivable,
  receivablePayload,
  recordReceivablePayment,
  restoreReceivable,
  saveReceivable,
} from "./collectionRepository";

type StatusFilter = "all" | CollectionStatus;
type AgingFilter = "all" | "current" | "days1To30" | "days31To60" | "days61To90" | "daysOver90";

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "partial", label: "Partial" },
  { value: "overdue", label: "Overdue" },
  { value: "collected", label: "Collected" },
  { value: "archived", label: "Archived" },
];

const emptyForm = (): CollectionFormValues => ({
  title: "",
  client_name: "",
  external_reference: "",
  issue_date: todayKey(),
  amount: "",
  due_date: todayKey(),
  notes: "",
});

const emptyPayment = (): CollectionPaymentFormValues => ({
  amount: "",
  payment_date: todayKey(),
  payment_method: "cash",
  reference_number: "",
  notes: "",
});

function errorText(error: unknown) {
  const value = error as { message?: string; details?: string | null };
  return value?.message || value?.details || "Unable to complete that collection action.";
}

function statusLabel(status: CollectionStatus) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function paymentMethodLabel(method: CollectionPayment["payment_method"]) {
  return ({ bank_transfer: "Bank transfer", e_wallet: "E-wallet" } as Record<string, string>)[method] ??
    method.charAt(0).toUpperCase() + method.slice(1);
}

export function CollectionsFeature(props: CollectionFeatureProps) {
  return <CollectionWorkspace {...props} historyMode={false} />;
}

export function CollectionHistoryFeature(props: CollectionFeatureProps) {
  return <CollectionWorkspace {...props} historyMode />;
}

type CollectionFeatureProps = {
  collections: CollectionReminder[];
  onChange: () => Promise<void>;
  onLocalCollectionsChange: (collections: CollectionReminder[]) => void;
  onQueueOfflineMutation: QueueOfflineMutation;
  userId: string;
};

function CollectionWorkspace({
  collections,
  historyMode,
  onChange,
  onLocalCollectionsChange,
  onQueueOfflineMutation,
  userId,
}: CollectionFeatureProps & { historyMode: boolean }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [agingFilter, setAgingFilter] = useState<AgingFilter>("all");
  const [editing, setEditing] = useState<CollectionReminder | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [payingCollection, setPayingCollection] = useState<CollectionReminder | null>(null);
  const [viewing, setViewing] = useState<CollectionReminder | null>(null);

  const visible = useMemo(() => collections.filter((collection) => {
    const status = collectionStatus(collection);
    const matchesMode = historyMode
      ? status === "collected" || status === "archived"
      : status !== "collected" && status !== "archived";
    const searchText = `${collection.collection_no ?? ""} ${collection.external_reference} ${collection.title} ${collection.client_name} ${collection.notes}`.toLowerCase();
    const matchesStatus = statusFilter === "all" || status === statusFilter;
    const matchesAging = agingFilter === "all" || collectionAgingBucket(collection.due_date) === agingFilter;
    return matchesMode && searchText.includes(query.toLowerCase()) && matchesStatus && matchesAging;
  }), [agingFilter, collections, historyMode, query, statusFilter]);

  const summary = useMemo(() => {
    const active = collections.filter((item) => !item.archived_at && item.outstanding_balance > 0);
    return {
      outstanding: active.reduce((sum, item) => sum + item.outstanding_balance, 0),
      overdue: active.filter((item) => item.due_date < todayKey()).reduce((sum, item) => sum + item.outstanding_balance, 0),
      collectedMonth: collections
        .flatMap((item) => item.payments)
        .filter((p) => !p.is_void && p.payment_date.startsWith(todayKey().slice(0, 7)))
        .reduce((sum, p) => sum + Number(p.amount), 0),
      aging: (["current", "days1To30", "days31To60", "days61To90", "daysOver90"] as const).map((bucket) => ({
        bucket,
        value: active.filter((item) => collectionAgingBucket(item.due_date) === bucket).reduce((sum, item) => sum + item.outstanding_balance, 0),
      })),
    };
  }, [collections]);

  function replaceLocal(next: CollectionReminder) {
    onLocalCollectionsChange(collections.map((item) => item.id === next.id ? next : item));
  }

  async function submitReceivable(values: CollectionFormValues) {
    if (!supabase) return;
    if (Number(values.amount) <= 0 || values.issue_date > values.due_date || (editing && Number(values.amount) < editing.amount_paid)) {
      NotificationService.showError("Enter a positive amount, keep it at least equal to payments already received, and use a due date on or after the issue date.");
      return;
    }
    const id = editing?.id ?? crypto.randomUUID();
    const payload = receivablePayload(values, userId);
    const optimistic = withCollectionTotals({
      ...(editing ?? {} as CollectionReminder),
      ...payload,
      id,
      collection_no: editing?.collection_no ?? null,
      archived_at: editing?.archived_at ?? null,
      payments: editing?.payments ?? [],
      amount_paid: editing?.amount_paid ?? 0,
      outstanding_balance: editing ? Math.max(0, Number(values.amount) - editing.amount_paid) : Number(values.amount),
      created_at: editing?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (!navigator.onLine) {
      onLocalCollectionsChange(editing ? collections.map((item) => item.id === id ? optimistic : item) : [optimistic, ...collections]);
      await onQueueOfflineMutation({
        resource: "collections", affectedResources: ["collections", "dashboardSummary"],
        operation: editing ? "update" : "insert", table: "collection_reminders", recordId: id,
        payload: editing ? payload : { ...payload, id },
      });
      closeForm();
      return;
    }

    const result = await saveReceivable(supabase, values, userId, editing?.id);
    if (result.error) {
      if (isOfflineLikeError(result.error)) {
        onLocalCollectionsChange(editing ? collections.map((item) => item.id === id ? optimistic : item) : [optimistic, ...collections]);
        await onQueueOfflineMutation({
          resource: "collections", affectedResources: ["collections", "dashboardSummary"],
          operation: editing ? "update" : "insert", table: "collection_reminders", recordId: id,
          payload: editing ? payload : { ...payload, id },
        });
        closeForm();
        return;
      }
      NotificationService.showError(errorText(result.error));
      return;
    }
    NotificationService.showSuccess("Receivable saved.");
    closeForm();
    await onChange();
  }

  function closeForm() {
    setEditing(null);
    setFormOpen(false);
  }

  async function toggleArchive(collection: CollectionReminder) {
    if (!supabase) return;
    const restoring = Boolean(collection.archived_at);
    const archivedAt = restoring ? null : new Date().toISOString();
    const optimistic = withCollectionTotals({ ...collection, archived_at: archivedAt, updated_at: new Date().toISOString() });
    if (!navigator.onLine) {
      replaceLocal(optimistic);
      await onQueueOfflineMutation({
        resource: "collections", affectedResources: ["collections", "dashboardSummary"], operation: "update",
        table: "collection_reminders", recordId: collection.id, payload: { archived_at: archivedAt },
      });
      return;
    }
    const result = restoring ? await restoreReceivable(supabase, collection.id) : await archiveReceivable(supabase, collection.id);
    if (result.error) {
      NotificationService.showError(errorText(result.error));
      return;
    }
    NotificationService.showSuccess(restoring ? "Receivable restored." : "Receivable archived.");
    await onChange();
  }

  async function recordPayment(collection: CollectionReminder, values: CollectionPaymentFormValues) {
    if (!supabase) return;
    const amount = Number(values.amount);
    const validationError = validateCollectionPayment({
      amount,
      archived: Boolean(collection.archived_at),
      balance: collection.outstanding_balance,
      paymentDate: values.payment_date,
    });
    if (validationError) {
      NotificationService.showError(validationError);
      return;
    }
    const id = crypto.randomUUID();
    const rpcPayload = {
      collection_record_id: collection.id,
      payment_record_id: id,
      payment_amount: amount,
      paid_on: values.payment_date,
      method: values.payment_method,
      payment_reference: values.reference_number.trim(),
      payment_notes: values.notes.trim(),
    };
    const optimisticPayment: CollectionPayment = {
      id, user_id: collection.user_id, collection_id: collection.id, amount,
      payment_date: values.payment_date, payment_method: values.payment_method,
      reference_number: values.reference_number.trim(), notes: values.notes.trim(), is_void: false,
      void_reason: "", voided_at: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    const optimistic = withCollectionTotals({ ...collection, payments: [optimisticPayment, ...collection.payments] });
    if (!navigator.onLine) {
      replaceLocal(optimistic);
      await onQueueOfflineMutation({ resource: "collections", affectedResources: ["collections", "dashboardSummary"], operation: "collection_payment", table: "record_collection_payment", recordId: id, payload: rpcPayload });
      setPayingCollection(null);
      return;
    }
    const result = await recordReceivablePayment(supabase, collection.id, id, values);
    if (result.error) { NotificationService.showError(errorText(result.error)); return; }
    NotificationService.showSuccess(amount >= collection.outstanding_balance ? "Marked as collected." : "Payment recorded.");
    setPayingCollection(null);
    await onChange();
  }

  return (
    <div className="collection-page-stack">
      <PageHeader
        action={!historyMode && (
          <button className="collection-primary" onClick={() => setFormOpen(true)} type="button">
            <Plus size={16} /> Add receivable
          </button>
        )}
        eyebrow="Customer receivables"
        title={historyMode ? "Collection History" : "Collections"}
        text={historyMode ? "Review collected and archived receivables." : "Track balances, partial payments, due dates, and aging."}
      />

      <section className="collection-summary-grid">
        <SummaryCard label="Outstanding" value={summary.outstanding} />
        <SummaryCard label="Overdue" value={summary.overdue} tone="danger" />
        <SummaryCard label="Collected this month" value={summary.collectedMonth} tone="success" />
      </section>

      <section className="collection-aging">
        {summary.aging.map((item) => (
          <button
            className={agingFilter === item.bucket ? "active" : ""}
            key={item.bucket}
            onClick={() => setAgingFilter(agingFilter === item.bucket ? "all" : item.bucket)}
            type="button"
          >
            <span>{agingLabel(item.bucket)}</span>
            <strong>{currency.format(item.value)}</strong>
          </button>
        ))}
      </section>

      <div className="collection-toolbar">
        <label className="collection-search-field">
          <Search size={16} />
          <input
            placeholder="Search number, reference, title, or client"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              aria-label="Clear search"
              className="collection-search-clear"
              onClick={() => setQuery("")}
              type="button"
            >
              <X size={14} />
            </button>
          )}
        </label>
        <div className="collection-status-filter" role="group" aria-label="Filter by status">
          {STATUS_FILTER_OPTIONS.map((option) => (
            <button
              className={`collection-status-chip ${option.value}${statusFilter === option.value ? " active" : ""}`}
              key={option.value}
              onClick={() => setStatusFilter(option.value)}
              type="button"
            >
              {option.value !== "all" && <span className="collection-status-chip-dot" />}
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <p className="collection-results-count">{visible.length} receivable{visible.length === 1 ? "" : "s"} found</p>

      <div className="collection-table-wrap">
        <table className="collection-table">
          <thead>
            <tr>
              <th>Collection</th>
              <th>Client</th>
              <th className="num">Original</th>
              <th className="num">Paid</th>
              <th className="num">Balance</th>
              <th>Due</th>
              <th>Status</th>
              <th>Date Collected</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((collection) => {
              const status = collectionStatus(collection);
              const isCollected = status === "collected";
              const isArchived = Boolean(collection.archived_at);
              const dateCollected = dateCollectedFor(collection);
              return (
                <tr className={isCollected ? "collection-row-done" : ""} key={collection.id}>
                  <td>
                    <strong>{collection.collection_no ?? "Pending sync"}</strong>
                    {collection.title && <span>{collection.title}</span>}
                  </td>
                  <td>{collection.client_name}</td>
                  <td className="num">{currency.format(collection.amount)}</td>
                  <td className="num">{currency.format(collection.amount_paid)}</td>
                  <td className="num">
                    <strong className={isCollected ? "collection-bal-zero" : ""}>{currency.format(collection.outstanding_balance)}</strong>
                  </td>
                  <td>{collection.due_date}</td>
                  <td>
                    <span className={`collection-status ${status}`}>{statusLabel(status)}</span>
                  </td>
                  <td>{dateCollected ?? "—"}</td>
                  <td>
                    <div className="collection-actions">
                      {historyMode && (
                        <button
                          aria-label="View details"
                          onClick={() => setViewing(collection)}
                          title="View details"
                          type="button"
                        >
                          <Eye size={16} />
                        </button>
                      )}
                      {!isCollected && !isArchived && (
                        <button
                          aria-label="Record payment"
                          className="collection-action-collect"
                          title="Record payment"
                          onClick={() => setPayingCollection(collection)}
                          type="button"
                        >
                          <CheckCircle2 size={16} />
                        </button>
                      )}
                      <button
                        aria-label={isArchived ? "Restore" : "Archive"}
                        title={isArchived ? "Restore" : "Archive"}
                        onClick={() => toggleArchive(collection)}
                        type="button"
                      >
                        {isArchived ? <RotateCcw size={16} /> : <Archive size={16} />}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td className="collection-empty" colSpan={9}>No receivables match these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {formOpen && <ReceivableForm initial={editing} onClose={closeForm} onSubmit={submitReceivable} />}
      {payingCollection && (
        <PaymentForm
          balance={payingCollection.outstanding_balance}
          onClose={() => setPayingCollection(null)}
          onSubmit={(values) => recordPayment(payingCollection, values)}
        />
      )}
      {viewing && (
        <CollectionDetailsModal
          collection={collections.find((item) => item.id === viewing.id) ?? viewing}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

function CollectionDetailsModal({ collection, onClose }: { collection: CollectionReminder; onClose: () => void }) {
  const status = collectionStatus(collection);
  const dateCollected = dateCollectedFor(collection);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal collection-details-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>{collection.collection_no ?? "Pending sync"}</h3>
            <span>{collection.title} · {collection.client_name}</span>
          </div>
          <button aria-label="Close" onClick={onClose} type="button"><X size={18} /></button>
        </div>
        <div className="collection-details-modal-body">
          <section className="collection-summary-grid">
            <SummaryCard label="Original amount" value={collection.amount} />
            <SummaryCard label="Amount paid" value={collection.amount_paid} tone="success" />
            <SummaryCard label="Outstanding balance" value={collection.outstanding_balance} />
          </section>

          <section className="collection-detail-card">
            <div>
              <span>Status</span>
              <strong className={`collection-status ${status}`}>{statusLabel(status)}</strong>
            </div>
            <div>
              <span>Issue date</span>
              <strong>{collection.issue_date}</strong>
            </div>
            <div>
              <span>Due date</span>
              <strong>{collection.due_date}</strong>
            </div>
            <div>
              <span>Date collected</span>
              <strong>{dateCollected ?? "—"}</strong>
            </div>
            <div>
              <span>External reference</span>
              <strong>{collection.external_reference || "—"}</strong>
            </div>
            <div className="wide">
              <span>Notes</span>
              <strong>{collection.notes || "No notes"}</strong>
            </div>
          </section>

          <section className="collection-ledger">
            <div className="collection-section-heading">
              <div>
                <p>Audit trail</p>
                <h2>Payment ledger</h2>
              </div>
            </div>
            <div className="collection-table-wrap">
              <table className="collection-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="num">Amount</th>
                    <th>Method</th>
                    <th>Reference</th>
                    <th>Notes</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {collection.payments
                    .slice()
                    .sort((a, b) => b.payment_date.localeCompare(a.payment_date) || b.created_at.localeCompare(a.created_at))
                    .map((payment) => (
                      <tr className={payment.is_void ? "void-row" : ""} key={payment.id}>
                        <td>{payment.payment_date}</td>
                        <td className="num">{currency.format(payment.amount)}</td>
                        <td>{paymentMethodLabel(payment.payment_method)}</td>
                        <td>{payment.reference_number || "—"}</td>
                        <td>{payment.is_void ? `Void: ${payment.void_reason}` : payment.notes || "—"}</td>
                        <td>
                          {payment.is_void
                            ? <span className="collection-status archived">Void</span>
                            : <span className="collection-status collected">Posted</span>}
                        </td>
                      </tr>
                    ))}
                  {collection.payments.length === 0 && (
                    <tr>
                      <td className="collection-empty" colSpan={6}>No payments recorded.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function ReceivableForm({ initial, onClose, onSubmit }: {
  initial: CollectionReminder | null;
  onClose: () => void;
  onSubmit: (values: CollectionFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState<CollectionFormValues>(
    initial
      ? { title: initial.title, client_name: initial.client_name, external_reference: initial.external_reference, issue_date: initial.issue_date, amount: String(initial.amount), due_date: initial.due_date, notes: initial.notes }
      : emptyForm()
  );
  const [busy, setBusy] = useState(false);
  return (
    <FeatureModal title={initial ? "Edit receivable" : "Add receivable"} onClose={onClose}>
      <form className="collection-form" onSubmit={async (e) => { e.preventDefault(); setBusy(true); await onSubmit(values); setBusy(false); }}>
        <Field label="Title" required value={values.title} onChange={(title) => setValues({ ...values, title })} />
        <Field label="Client / customer" required value={values.client_name} onChange={(client_name) => setValues({ ...values, client_name })} />
        <Field label="External reference" value={values.external_reference} onChange={(external_reference) => setValues({ ...values, external_reference })} />
        <MoneyField label="Original amount" required value={values.amount} onChange={(amount) => setValues({ ...values, amount })} />
        <Field label="Issue date" required type="date" value={values.issue_date} onChange={(issue_date) => setValues({ ...values, issue_date })} />
        <Field label="Due date" required type="date" value={values.due_date} onChange={(due_date) => setValues({ ...values, due_date })} />
        <label className="wide">
          Notes
          <textarea rows={4} value={values.notes} onChange={(e) => setValues({ ...values, notes: e.target.value })} />
        </label>
        <FormButtons busy={busy} onClose={onClose} />
      </form>
    </FeatureModal>
  );
}

function PaymentForm({ balance, onClose, onSubmit }: {
  balance: number;
  onClose: () => void;
  onSubmit: (values: CollectionPaymentFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState({ ...emptyPayment(), amount: String(balance) });
  const [busy, setBusy] = useState(false);
  return (
    <FeatureModal title="Record payment" onClose={onClose}>
      <form className="collection-form" onSubmit={async (e) => { e.preventDefault(); setBusy(true); await onSubmit(values); setBusy(false); }}>
        <div className="collection-balance-callout">
          <span>Outstanding balance</span>
          <strong>{currency.format(balance)}</strong>
        </div>
        <MoneyField label="Payment amount" required value={values.amount} onChange={(amount) => setValues({ ...values, amount })} />
        <small className="collection-payment-hint wide">Defaults to the full balance — lower it to record a partial payment.</small>
        <Field label="Payment date" max={todayKey()} required type="date" value={values.payment_date} onChange={(payment_date) => setValues({ ...values, payment_date })} />
        <label>
          Payment method
          <select value={values.payment_method} onChange={(e) => setValues({ ...values, payment_method: e.target.value as CollectionPaymentFormValues["payment_method"] })}>
            <option value="cash">Cash</option>
            <option value="bank_transfer">Bank transfer</option>
            <option value="check">Check</option>
            <option value="e_wallet">E-wallet</option>
            <option value="card">Card</option>
            <option value="other">Other</option>
          </select>
        </label>
        <Field label="Reference number" value={values.reference_number} onChange={(reference_number) => setValues({ ...values, reference_number })} />
        <label className="wide">
          Notes
          <textarea rows={3} value={values.notes} onChange={(e) => setValues({ ...values, notes: e.target.value })} />
        </label>
        <FormButtons busy={busy} onClose={onClose} />
      </form>
    </FeatureModal>
  );
}

function FeatureModal({ children, onClose, title }: { children: ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="collection-modal-backdrop">
      <section aria-label={title} aria-modal="true" className="collection-modal" role="dialog">
        <header>
          <h2>{title}</h2>
          <button aria-label="Close" onClick={onClose} type="button"><X size={18} /></button>
        </header>
        {children}
      </section>
    </div>
  );
}

function Field({ label, onChange, ...props }: { label: string; onChange: (value: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, "onChange">) {
  return <label>{label}<input {...props} onChange={(e) => onChange(e.target.value)} /></label>;
}

function FormButtons({ busy, destructive, onClose, submitLabel = "Save" }: { busy: boolean; destructive?: boolean; onClose: () => void; submitLabel?: string }) {
  return (
    <div className="collection-form-actions">
      <button className="collection-secondary" onClick={onClose} type="button">Cancel</button>
      <button className={destructive ? "collection-danger" : "collection-primary"} disabled={busy} type="submit">
        {busy ? "Saving..." : submitLabel}
      </button>
    </div>
  );
}

function SummaryCard({ label, tone, value }: { label: string; tone?: "danger" | "success"; value: number }) {
  return (
    <div className={`collection-summary-card ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{currency.format(value)}</strong>
    </div>
  );
}

function agingLabel(bucket: Exclude<AgingFilter, "all">) {
  return ({ current: "Current", days1To30: "1–30 days", days31To60: "31–60 days", days61To90: "61–90 days", daysOver90: "90+ days" })[bucket];
}
