import { useMemo, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { ArrowLeft, Archive, CheckCircle2, Eye, Pencil, Plus, RotateCcw, Search, X } from "lucide-react";
import { collectionAgingBucket, collectionStatus, validateCollectionPayment, withCollectionTotals } from "../../domain/collections";
import type { PendingMutation } from "../../lib/offlineDb";
import { isOfflineLikeError } from "../../lib/offlineSync";
import { supabase } from "../../supabase";
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
  voidReceivablePayment,
} from "./collectionRepository";

type Notice = { type: "success" | "error"; text: string } | null;
type QueueOfflineMutation = (mutation: Omit<PendingMutation, "id" | "createdAt" | "status" | "attempts" | "userId">) => Promise<void>;
type StatusFilter = "all" | CollectionStatus;
type AgingFilter = "all" | "current" | "days1To30" | "days31To60" | "days61To90" | "daysOver90";

const currency = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
const todayKey = () => new Date().toISOString().slice(0, 10);
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
  setNotice: (notice: Notice) => void;
  userId: string;
};

function CollectionWorkspace({
  collections,
  historyMode,
  onChange,
  onLocalCollectionsChange,
  onQueueOfflineMutation,
  setNotice,
  userId,
}: CollectionFeatureProps & { historyMode: boolean }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [agingFilter, setAgingFilter] = useState<AgingFilter>("all");
  const [selected, setSelected] = useState<CollectionReminder | null>(null);
  const [editing, setEditing] = useState<CollectionReminder | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const visible = useMemo(() => collections.filter((collection) => {
    const status = collectionStatus(collection);
    const matchesMode = historyMode ? status === "collected" || status === "archived" : status !== "collected" && status !== "archived";
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
      collectedMonth: collections.flatMap((item) => item.payments).filter((payment) => !payment.is_void && payment.payment_date.startsWith(todayKey().slice(0, 7))).reduce((sum, payment) => sum + Number(payment.amount), 0),
      aging: (["current", "days1To30", "days31To60", "days61To90", "daysOver90"] as const).map((bucket) => ({
        bucket,
        value: active.filter((item) => collectionAgingBucket(item.due_date) === bucket).reduce((sum, item) => sum + item.outstanding_balance, 0),
      })),
    };
  }, [collections]);

  function replaceLocal(next: CollectionReminder) {
    onLocalCollectionsChange(collections.map((item) => item.id === next.id ? next : item));
    setSelected((current) => current?.id === next.id ? next : current);
  }

  async function submitReceivable(values: CollectionFormValues) {
    if (!supabase) return;
    if (Number(values.amount) <= 0 || values.issue_date > values.due_date || (editing && Number(values.amount) < editing.amount_paid)) {
      setNotice({ type: "error", text: "Enter a positive amount, keep it at least equal to payments already received, and use a due date on or after the issue date." });
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
        resource: "collections",
        affectedResources: ["collections", "dashboardSummary"],
        operation: editing ? "update" : "insert",
        table: "collection_reminders",
        recordId: id,
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
      setNotice({ type: "error", text: errorText(result.error) });
      return;
    }
    setNotice({ type: "success", text: "Receivable saved." });
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
      setNotice({ type: "error", text: errorText(result.error) });
      return;
    }
    setNotice({ type: "success", text: restoring ? "Receivable restored." : "Receivable archived." });
    if (!restoring) setSelected(null);
    await onChange();
  }

  if (selected) {
    const latest = collections.find((item) => item.id === selected.id) ?? selected;
    return (
      <ReceivableDetails
        collection={latest}
        onArchive={() => toggleArchive(latest)}
        onBack={() => setSelected(null)}
        onChange={onChange}
        onLocalChange={replaceLocal}
        onQueueOfflineMutation={onQueueOfflineMutation}
        setNotice={setNotice}
      />
    );
  }

  return (
    <div className="collection-page-stack">
      <header className="collection-page-header">
        <div><p>Customer receivables</p><h1>{historyMode ? "Collection History" : "Collections"}</h1><span>{historyMode ? "Review collected and archived receivables." : "Track balances, partial payments, due dates, and aging."}</span></div>
        {!historyMode && <button className="collection-primary" onClick={() => setFormOpen(true)} type="button"><Plus size={16} /> Add receivable</button>}
      </header>
      <section className="collection-summary-grid">
        <SummaryCard label="Outstanding" value={summary.outstanding} />
        <SummaryCard label="Overdue" value={summary.overdue} tone="danger" />
        <SummaryCard label="Collected this month" value={summary.collectedMonth} tone="success" />
      </section>
      <section className="collection-aging">
        {summary.aging.map((item) => <button className={agingFilter === item.bucket ? "active" : ""} key={item.bucket} onClick={() => setAgingFilter(agingFilter === item.bucket ? "all" : item.bucket)} type="button"><span>{agingLabel(item.bucket)}</span><strong>{currency.format(item.value)}</strong></button>)}
      </section>
      <div className="collection-toolbar">
        <label><Search size={16} /><input placeholder="Search number, reference, title, or client" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
          <option value="all">All statuses</option>
          <option value="pending">Pending</option><option value="partial">Partial</option><option value="overdue">Overdue</option><option value="collected">Collected</option><option value="archived">Archived</option>
        </select>
      </div>
      <div className="collection-table-wrap"><table className="collection-table"><thead><tr><th>Collection</th><th>Client</th><th>Original</th><th>Paid</th><th>Balance</th><th>Due</th><th>Status</th><th>Actions</th></tr></thead><tbody>
        {visible.map((collection) => {
          const status = collectionStatus(collection);
          return <tr key={collection.id}><td><strong>{collection.collection_no ?? "Pending sync"}</strong><span>{collection.title}{collection.external_reference ? ` · ${collection.external_reference}` : ""}</span></td><td>{collection.client_name}</td><td>{currency.format(collection.amount)}</td><td>{currency.format(collection.amount_paid)}</td><td><strong>{currency.format(collection.outstanding_balance)}</strong></td><td>{collection.due_date}</td><td><span className={`collection-status ${status}`}>{statusLabel(status)}</span></td><td><div className="collection-actions"><button title="View" onClick={() => setSelected(collection)} type="button"><Eye size={16} /></button>{!historyMode && <button title="Edit" onClick={() => { setEditing(collection); setFormOpen(true); }} type="button"><Pencil size={16} /></button>}<button title={collection.archived_at ? "Restore" : "Archive"} onClick={() => toggleArchive(collection)} type="button">{collection.archived_at ? <RotateCcw size={16} /> : <Archive size={16} />}</button></div></td></tr>;
        })}
        {visible.length === 0 && <tr><td className="collection-empty" colSpan={8}>No receivables match these filters.</td></tr>}
      </tbody></table></div>
      {formOpen && <ReceivableForm initial={editing} onClose={closeForm} onSubmit={submitReceivable} />}
    </div>
  );
}

function ReceivableDetails({ collection, onArchive, onBack, onChange, onLocalChange, onQueueOfflineMutation, setNotice }: {
  collection: CollectionReminder;
  onArchive: () => void;
  onBack: () => void;
  onChange: () => Promise<void>;
  onLocalChange: (collection: CollectionReminder) => void;
  onQueueOfflineMutation: QueueOfflineMutation;
  setNotice: (notice: Notice) => void;
}) {
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [voiding, setVoiding] = useState<CollectionPayment | null>(null);
  const status = collectionStatus(collection);

  async function addPayment(values: CollectionPaymentFormValues) {
    if (!supabase) return;
    const amount = Number(values.amount);
    const validationError = validateCollectionPayment({ amount, archived: Boolean(collection.archived_at), balance: collection.outstanding_balance, paymentDate: values.payment_date });
    if (validationError) {
      setNotice({ type: "error", text: validationError });
      return;
    }
    const id = crypto.randomUUID();
    const optimisticPayment: CollectionPayment = {
      id, user_id: collection.user_id, collection_id: collection.id, amount,
      payment_date: values.payment_date, payment_method: values.payment_method,
      reference_number: values.reference_number.trim(), notes: values.notes.trim(), is_void: false,
      void_reason: "", voided_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    const optimistic = withCollectionTotals({ ...collection, payments: [optimisticPayment, ...collection.payments] });
    const rpcPayload = {
      collection_record_id: collection.id, payment_record_id: id, payment_amount: amount,
      paid_on: values.payment_date, method: values.payment_method,
      payment_reference: values.reference_number.trim(), payment_notes: values.notes.trim(),
    };
    if (!navigator.onLine) {
      onLocalChange(optimistic);
      await onQueueOfflineMutation({ resource: "collections", affectedResources: ["collections", "dashboardSummary"], operation: "collection_payment", table: "record_collection_payment", recordId: id, payload: rpcPayload });
      setPaymentOpen(false);
      return;
    }
    const result = await recordReceivablePayment(supabase, collection.id, id, values);
    if (result.error) { setNotice({ type: "error", text: errorText(result.error) }); return; }
    setPaymentOpen(false);
    setNotice({ type: "success", text: "Payment recorded." });
    await onChange();
  }

  async function voidPayment(payment: CollectionPayment, reason: string) {
    if (!supabase || !reason.trim()) return;
    const optimistic = withCollectionTotals({ ...collection, payments: collection.payments.map((item) => item.id === payment.id ? { ...item, is_void: true, void_reason: reason.trim(), voided_at: new Date().toISOString() } : item) });
    if (!navigator.onLine) {
      onLocalChange(optimistic);
      await onQueueOfflineMutation({ resource: "collections", affectedResources: ["collections", "dashboardSummary"], operation: "collection_payment_void", table: "void_collection_payment", recordId: payment.id, payload: { payment_record_id: payment.id, reason: reason.trim() } });
      setVoiding(null);
      return;
    }
    const result = await voidReceivablePayment(supabase, payment.id, reason);
    if (result.error) { setNotice({ type: "error", text: errorText(result.error) }); return; }
    setVoiding(null);
    setNotice({ type: "success", text: "Payment voided and balance recalculated." });
    await onChange();
  }

  return <div className="collection-page-stack">
    <header className="collection-page-header"><div><button className="collection-back" onClick={onBack} type="button"><ArrowLeft size={16} /> Collections</button><h1>{collection.collection_no ?? "Pending sync"}</h1><span>{collection.title} · {collection.client_name}</span></div><div className="collection-header-actions">{!collection.archived_at && status !== "collected" && <button className="collection-primary" onClick={() => setPaymentOpen(true)} type="button"><Plus size={16} /> Record payment</button>}<button className="collection-secondary" onClick={onArchive} type="button">{collection.archived_at ? <RotateCcw size={16} /> : <Archive size={16} />}{collection.archived_at ? "Restore" : "Archive"}</button></div></header>
    <section className="collection-summary-grid"><SummaryCard label="Original amount" value={collection.amount} /><SummaryCard label="Amount paid" value={collection.amount_paid} tone="success" /><SummaryCard label="Outstanding balance" value={collection.outstanding_balance} tone={collection.due_date < todayKey() && collection.outstanding_balance > 0 ? "danger" : undefined} /></section>
    <section className="collection-detail-card"><div><span>Status</span><strong className={`collection-status ${status}`}>{statusLabel(status)}</strong></div><div><span>Issue date</span><strong>{collection.issue_date}</strong></div><div><span>Due date</span><strong>{collection.due_date}</strong></div><div><span>External reference</span><strong>{collection.external_reference || "—"}</strong></div><div className="wide"><span>Notes</span><strong>{collection.notes || "No notes"}</strong></div></section>
    <section className="collection-ledger"><div className="collection-section-heading"><div><p>Audit trail</p><h2>Payment ledger</h2></div></div><div className="collection-table-wrap"><table className="collection-table"><thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th><th>Notes</th><th>Status</th><th>Action</th></tr></thead><tbody>{collection.payments.slice().sort((a,b) => b.payment_date.localeCompare(a.payment_date) || b.created_at.localeCompare(a.created_at)).map((payment) => <tr className={payment.is_void ? "void-row" : ""} key={payment.id}><td>{payment.payment_date}</td><td>{currency.format(payment.amount)}</td><td>{paymentMethodLabel(payment.payment_method)}</td><td>{payment.reference_number || "—"}</td><td>{payment.is_void ? `Void: ${payment.void_reason}` : payment.notes || "—"}</td><td>{payment.is_void ? <span className="collection-status archived">Void</span> : <span className="collection-status collected">Posted</span>}</td><td>{!payment.is_void && !collection.archived_at ? <button className="collection-link-danger" onClick={() => setVoiding(payment)} type="button">Void</button> : "—"}</td></tr>)}{collection.payments.length === 0 && <tr><td className="collection-empty" colSpan={7}>No payments recorded.</td></tr>}</tbody></table></div></section>
    {paymentOpen && <PaymentForm balance={collection.outstanding_balance} onClose={() => setPaymentOpen(false)} onSubmit={addPayment} />}
    {voiding && <VoidPaymentForm payment={voiding} onClose={() => setVoiding(null)} onSubmit={(reason) => voidPayment(voiding, reason)} />}
  </div>;
}

function ReceivableForm({ initial, onClose, onSubmit }: { initial: CollectionReminder | null; onClose: () => void; onSubmit: (values: CollectionFormValues) => Promise<void> }) {
  const [values, setValues] = useState<CollectionFormValues>(initial ? { title: initial.title, client_name: initial.client_name, external_reference: initial.external_reference, issue_date: initial.issue_date, amount: String(initial.amount), due_date: initial.due_date, notes: initial.notes } : emptyForm());
  const [busy, setBusy] = useState(false);
  return <FeatureModal title={initial ? "Edit receivable" : "Add receivable"} onClose={onClose}><form className="collection-form" onSubmit={async (event) => { event.preventDefault(); setBusy(true); await onSubmit(values); setBusy(false); }}><Field label="Title" required value={values.title} onChange={(title) => setValues({ ...values, title })} /><Field label="Client / customer" required value={values.client_name} onChange={(client_name) => setValues({ ...values, client_name })} /><Field label="External reference" value={values.external_reference} onChange={(external_reference) => setValues({ ...values, external_reference })} /><Field label="Original amount" min="0.01" required step="0.01" type="number" value={values.amount} onChange={(amount) => setValues({ ...values, amount })} /><Field label="Issue date" required type="date" value={values.issue_date} onChange={(issue_date) => setValues({ ...values, issue_date })} /><Field label="Due date" required type="date" value={values.due_date} onChange={(due_date) => setValues({ ...values, due_date })} /><label className="wide">Notes<textarea rows={4} value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} /></label><FormButtons busy={busy} onClose={onClose} /></form></FeatureModal>;
}

function PaymentForm({ balance, onClose, onSubmit }: { balance: number; onClose: () => void; onSubmit: (values: CollectionPaymentFormValues) => Promise<void> }) {
  const [values, setValues] = useState(emptyPayment()); const [busy, setBusy] = useState(false);
  return <FeatureModal title="Record payment" onClose={onClose}><form className="collection-form" onSubmit={async (event) => { event.preventDefault(); setBusy(true); await onSubmit(values); setBusy(false); }}><div className="collection-balance-callout"><span>Outstanding balance</span><strong>{currency.format(balance)}</strong></div><Field label="Payment amount" max={String(balance)} min="0.01" required step="0.01" type="number" value={values.amount} onChange={(amount) => setValues({ ...values, amount })} /><Field label="Payment date" max={todayKey()} required type="date" value={values.payment_date} onChange={(payment_date) => setValues({ ...values, payment_date })} /><label>Payment method<select value={values.payment_method} onChange={(event) => setValues({ ...values, payment_method: event.target.value as CollectionPaymentFormValues["payment_method"] })}><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="check">Check</option><option value="e_wallet">E-wallet</option><option value="card">Card</option><option value="other">Other</option></select></label><Field label="Reference number" value={values.reference_number} onChange={(reference_number) => setValues({ ...values, reference_number })} /><label className="wide">Notes<textarea rows={3} value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} /></label><FormButtons busy={busy} onClose={onClose} /></form></FeatureModal>;
}

function VoidPaymentForm({ payment, onClose, onSubmit }: { payment: CollectionPayment; onClose: () => void; onSubmit: (reason: string) => Promise<void> }) { const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); return <FeatureModal title="Void payment" onClose={onClose}><form className="collection-form" onSubmit={async (event) => { event.preventDefault(); if (!reason.trim()) return; setBusy(true); await onSubmit(reason); setBusy(false); }}><div className="collection-balance-callout"><span>Payment being voided</span><strong>{currency.format(payment.amount)}</strong></div><label className="wide">Reason<textarea required rows={4} value={reason} onChange={(event) => setReason(event.target.value)} /></label><FormButtons busy={busy} destructive onClose={onClose} submitLabel="Void payment" /></form></FeatureModal>; }

function FeatureModal({ children, onClose, title }: { children: ReactNode; onClose: () => void; title: string }) { return <div className="collection-modal-backdrop"><section className="collection-modal" role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button onClick={onClose} type="button" aria-label="Close"><X size={18} /></button></header>{children}</section></div>; }
function Field({ label, onChange, ...props }: { label: string; onChange: (value: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, "onChange">) { return <label>{label}<input {...props} onChange={(event) => onChange(event.target.value)} /></label>; }
function FormButtons({ busy, destructive, onClose, submitLabel = "Save" }: { busy: boolean; destructive?: boolean; onClose: () => void; submitLabel?: string }) { return <div className="collection-form-actions"><button className="collection-secondary" onClick={onClose} type="button">Cancel</button><button className={destructive ? "collection-danger" : "collection-primary"} disabled={busy} type="submit">{busy ? "Saving..." : submitLabel}</button></div>; }
function SummaryCard({ label, tone, value }: { label: string; tone?: "danger" | "success"; value: number }) { return <div className={`collection-summary-card ${tone ?? ""}`}><span>{label}</span><strong>{currency.format(value)}</strong></div>; }
function agingLabel(bucket: Exclude<AgingFilter, "all">) { return ({ current: "Current", days1To30: "1–30 days", days31To60: "31–60 days", days61To90: "61–90 days", daysOver90: "90+ days" })[bucket]; }
