import { useMemo, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { isOfflineLikeError } from "../../lib/offlineSync";
import { supabase } from "../../supabase";
import {
  FormActions,
  Modal,
  RowActions,
  TextField,
} from "../../shared/components/FormLayout";
import { MoneyField } from "../../shared/components/MoneyField";
import { DataTable } from "../../shared/components/DataTable";
import { PageHeader, RecordTitle, Toolbar } from "../../shared/components/PageLayout";
import { StatusBadge } from "../../shared/components/StatusBadge";
import type { Notice, QueueOfflineMutation } from "../../shared/types";
import { currency, toNumber } from "../../shared/utils/currency";
import { isBeforeToday, isToday, todayKey } from "../../shared/utils/dates";
import { friendlyError } from "../../shared/utils/errors";
import type { PaymentFormValues, PaymentReminder } from "../../types";

const emptyPayment: PaymentFormValues = {
  title: "",
  type: "loan",
  amount: "",
  due_date: todayKey(),
  status: "pending",
  notes: "",
};

export function PaymentHistoryFeature({
  payments,
}: {
  payments: PaymentReminder[];
}) {
  const paidRows = payments
    .filter((payment) => payment.status === "paid")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map((payment) => [
      <RecordTitle key="title" notes={payment.notes} title={payment.title} />,
      payment.type,
      currency.format(toNumber(payment.amount)),
      payment.due_date,
      payment.updated_at.slice(0, 10),
      <StatusBadge key="status" status={payment.status} />,
    ]);
  const paidTotal = payments
    .filter((payment) => payment.status === "paid")
    .reduce((sum, payment) => sum + toNumber(payment.amount), 0);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Completed payments"
        text="All paid reminders — loans, bills, and subcontractor payouts."
        title="Payment History"
      />
      <section className="summary-band">
        <div>
          <p className="eyebrow">Total paid</p>
          <h2>{currency.format(paidTotal)}</h2>
        </div>
        <p>Only payments marked paid appear here. Pending and overdue stay in Payments.</p>
      </section>
      <DataTable
        empty="No paid payments yet."
        headers={["Title / Subcontractor", "Type", "Amount", "Due date", "Paid date", "Status"]}
        rows={paidRows}
      />
    </div>
  );
}

export function PaymentsFeature({
  onChange,
  onLocalPaymentsChange,
  onQueueOfflineMutation,
  payments,
  setNotice,
  userId,
}: {
  onChange: () => Promise<void>;
  onLocalPaymentsChange: (payments: PaymentReminder[]) => void;
  onQueueOfflineMutation: QueueOfflineMutation;
  payments: PaymentReminder[];
  setNotice: (notice: Notice) => void;
  userId: string;
}) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "loan" | "bill" | "subcontractor">("all");
  const [editing, setEditing] = useState<PaymentReminder | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const rows = useMemo(() => {
    return payments.filter((payment) => {
      if (payment.status === "paid") return false;
      const matchesQuery = `${payment.title} ${payment.notes}`.toLowerCase().includes(query.toLowerCase());
      const matchesType = typeFilter === "all" || payment.type === typeFilter;
      return matchesQuery && matchesType;
    });
  }, [payments, query, typeFilter]);

  async function savePayment(values: PaymentFormValues) {
    if (!supabase) return;
    const payload = {
      ...(editing ? {} : { id: crypto.randomUUID() }),
      title: values.title.trim(),
      type: values.type,
      amount: toNumber(values.amount),
      due_date: values.due_date,
      status: values.status,
      notes: values.notes.trim(),
      user_id: userId,
    };
    const optimisticPayment = {
      ...(editing ?? {}),
      ...payload,
      id: editing?.id ?? payload.id,
      created_at: editing?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as PaymentReminder;

    if (!navigator.onLine) {
      onLocalPaymentsChange(
        editing
          ? payments.map((payment) => payment.id === editing.id ? optimisticPayment : payment)
          : [optimisticPayment, ...payments],
      );
      await onQueueOfflineMutation({
        resource: "payments",
        affectedResources: ["payments", "dashboardSummary"],
        operation: editing ? "update" : "insert",
        table: "payment_reminders",
        recordId: editing?.id,
        payload,
      });
      setEditing(null);
      setFormOpen(false);
      return;
    }

    const result = editing
      ? await supabase.from("payment_reminders").update(payload).eq("id", editing.id)
      : await supabase.from("payment_reminders").insert(payload);

    if (result.error) {
      if (isOfflineLikeError(result.error)) {
        onLocalPaymentsChange(
          editing
            ? payments.map((payment) => payment.id === editing.id ? optimisticPayment : payment)
            : [optimisticPayment, ...payments],
        );
        await onQueueOfflineMutation({
          resource: "payments",
          affectedResources: ["payments", "dashboardSummary"],
          operation: editing ? "update" : "insert",
          table: "payment_reminders",
          recordId: editing?.id,
          payload,
        });
        setEditing(null);
        setFormOpen(false);
        return;
      }
      setNotice({ type: "error", text: friendlyError(result.error) });
      return;
    }
    setNotice({ type: "success", text: "Payment reminder saved." });
    setEditing(null);
    setFormOpen(false);
    await onChange();
  }

  async function markPaid(id: string) {
    if (!supabase) return;
    if (!navigator.onLine) {
      onLocalPaymentsChange(payments.map((payment) => payment.id === id ? { ...payment, status: "paid" } : payment));
      await onQueueOfflineMutation({
        resource: "payments",
        affectedResources: ["payments", "dashboardSummary"],
        operation: "update",
        table: "payment_reminders",
        recordId: id,
        payload: { status: "paid" },
      });
      return;
    }
    const { error } = await supabase.from("payment_reminders").update({ status: "paid" }).eq("id", id);
    if (error && isOfflineLikeError(error)) {
      onLocalPaymentsChange(payments.map((payment) => payment.id === id ? { ...payment, status: "paid" } : payment));
      await onQueueOfflineMutation({
        resource: "payments",
        affectedResources: ["payments", "dashboardSummary"],
        operation: "update",
        table: "payment_reminders",
        recordId: id,
        payload: { status: "paid" },
      });
      return;
    }
    setNotice(error ? { type: "error", text: friendlyError(error) } : { type: "success", text: "Marked paid." });
    await onChange();
  }

  async function remove(id: string) {
    if (!supabase || !window.confirm("Delete this payment reminder?")) return;
    if (!navigator.onLine) {
      onLocalPaymentsChange(payments.filter((payment) => payment.id !== id));
      await onQueueOfflineMutation({
        resource: "payments",
        affectedResources: ["payments", "dashboardSummary"],
        operation: "delete",
        table: "payment_reminders",
        recordId: id,
      });
      return;
    }
    const { error } = await supabase.from("payment_reminders").delete().eq("id", id);
    if (error && isOfflineLikeError(error)) {
      onLocalPaymentsChange(payments.filter((payment) => payment.id !== id));
      await onQueueOfflineMutation({
        resource: "payments",
        affectedResources: ["payments", "dashboardSummary"],
        operation: "delete",
        table: "payment_reminders",
        recordId: id,
      });
      return;
    }
    setNotice(error ? { type: "error", text: friendlyError(error) } : { type: "success", text: "Payment reminder deleted." });
    await onChange();
  }

  return (
    <div className="page-stack">
      <PageHeader
        action={(
          <button className="primary-button compact" onClick={() => { setEditing(null); setFormOpen(true); }} type="button">
            <Plus size={16} />
            Add payment
          </button>
        )}
        eyebrow="Loans and bills"
        text="Track manual due dates outside payroll."
        title="Payments"
      />
      <Toolbar query={query} setQuery={setQuery}>
        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}>
          <option value="all">All types</option>
          <option value="loan">Loans</option>
          <option value="bill">Bills</option>
          <option value="subcontractor">Subcontractor</option>
        </select>
      </Toolbar>
      <DataTable
        empty="No payment reminders yet."
        headers={["Title / Subcontractor", "Type", "Amount", "Due date", "Status", "Actions"]}
        rows={rows.map((payment) => [
          <RecordTitle key="title" notes={payment.notes} title={payment.title} />,
          payment.type,
          currency.format(toNumber(payment.amount)),
          payment.due_date,
          <StatusBadge key="status" status={computedPaymentStatus(payment)} />,
          payment.type === "subcontractor"
            ? (
              <button
                className="secondary-button compact"
                key="action"
                onClick={() => void markPaid(payment.id)}
                type="button"
              >
                Mark paid
              </button>
            )
            : (
              <RowActions
                key="actions"
                canMarkPaid={payment.status !== "paid"}
                onDelete={() => remove(payment.id)}
                onEdit={() => { setEditing(payment); setFormOpen(true); }}
                onMarkPaid={() => markPaid(payment.id)}
              />
            ),
        ])}
      />
      {formOpen && (
        <PaymentForm
          initial={editing}
          onClose={() => { setEditing(null); setFormOpen(false); }}
          onSubmit={savePayment}
        />
      )}
    </div>
  );
}

function computedPaymentStatus(payment: PaymentReminder) {
  if (payment.status === "paid") return "paid";
  if (payment.status === "overdue" || isBeforeToday(payment.due_date)) return "overdue";
  if (isToday(payment.due_date)) return "due today";
  return "pending";
}

function PaymentForm({
  initial,
  onClose,
  onSubmit,
}: {
  initial: PaymentReminder | null;
  onClose: () => void;
  onSubmit: (values: PaymentFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState<PaymentFormValues>(
    initial
      ? {
          title: initial.title,
          type: initial.type === "subcontractor" ? "loan" : initial.type,
          amount: String(initial.amount),
          due_date: initial.due_date,
          status: initial.status,
          notes: initial.notes,
        }
      : emptyPayment,
  );
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!values.title.trim() || !values.amount || !values.due_date) return;
    setBusy(true);
    await onSubmit(values);
    setBusy(false);
  }

  return (
    <Modal onClose={onClose} title={initial ? "Edit payment" : "Add payment"}>
      <form className="form-grid" onSubmit={handleSubmit}>
        <TextField label="Title" onChange={(title) => setValues({ ...values, title })} required value={values.title} />
        <label>
          Type
          <select value={values.type} onChange={(event) => setValues({ ...values, type: event.target.value as PaymentFormValues["type"] })}>
            <option value="loan">Loan</option>
            <option value="bill">Bill</option>
          </select>
        </label>
        <MoneyField label="Amount" onChange={(amount) => setValues({ ...values, amount })} required value={values.amount} />
        <TextField label="Due date" onChange={(due_date) => setValues({ ...values, due_date })} required type="date" value={values.due_date} />
        <label>
          Status
          <select value={values.status} onChange={(event) => setValues({ ...values, status: event.target.value as PaymentFormValues["status"] })}>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="overdue">Overdue</option>
          </select>
        </label>
        <label className="full">
          Notes
          <textarea rows={4} value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} />
        </label>
        <FormActions busy={busy} onClose={onClose} />
      </form>
    </Modal>
  );
}
