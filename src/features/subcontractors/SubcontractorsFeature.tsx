import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, Eye, Pencil, Plus, ReceiptText, Ticket, Trash2, Users, WalletCards, X } from "lucide-react";
import {
  billingPeriodLabel,
  buildSubcontractorAccountSummary,
  filterSubcontractorDailyTickets,
} from "../../domain/billing";
import {
  nextPaymentReminderCompletionState,
  paymentMethodLabel,
  paymentReminderDisplayStatus,
  paymentReminderPaymentsTotal,
  paymentReminderRemainingBalance,
  validatePaymentReminderPayment,
} from "../../domain/paymentReminders";
import { deletePaymentReminderPayment, recordPaymentReminderPayment, saveSubcontractor, updatePaymentReminderCompletion } from "../billing/billingRepository";
import { supabase } from "../../supabase";
import { DataTable } from "../../shared/components/DataTable";
import { MoneyField } from "../../shared/components/MoneyField";
import { PageHeader, RecordTitle, Toolbar } from "../../shared/components/PageLayout";
import { StatusBadge } from "../../shared/components/StatusBadge";
import { NotificationService } from "../../shared/notifications/NotificationService";
import type { QueueOfflineMutation } from "../../shared/types";
import { currency, toNumber } from "../../shared/utils/currency";
import { monthNames, todayKey } from "../../shared/utils/dates";
import type { BillingPeriod, BillingRecord, CollectionPaymentMethod, PaymentReminder, PaymentReminderPayment, SubconDailyTicket, Subcontractor, SubcontractorAdvance, SubcontractorAdvanceFormValues } from "../../types";

type AccountTab = "daily" | "billing" | "payouts" | "advances";

type PayoutPaymentFormValues = {
  amount: string;
  payment_date: string;
  payment_method: CollectionPaymentMethod;
  reference_number: string;
  notes: string;
};

function emptySubcontractorAdvanceForm(subcontractorId: string): SubcontractorAdvanceFormValues {
  return {
    subcontractor_id: subcontractorId,
    date_granted: todayKey(),
    amount: "",
    deduction_mode: "full_payout",
    deduction_per_billing: "",
    status: "active",
    notes: "",
  };
}

function subconInitials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "S";
}

export function SubcontractorsFeature({
  billingRecords,
  initialTab,
  onChange,
  onQueueOfflineMutation,
  onSelectSubcontractor,
  payments,
  selectedSubcontractorId,
  subconDailyTickets,
  subcontractorAdvances,
  subcontractors,
  userId,
}: {
  billingRecords: BillingRecord[];
  initialTab?: AccountTab;
  onChange: () => Promise<void>;
  onQueueOfflineMutation: QueueOfflineMutation;
  onSelectSubcontractor: (subcontractorId: string) => void;
  payments: PaymentReminder[];
  selectedSubcontractorId: string | null;
  subconDailyTickets: SubconDailyTicket[];
  subcontractorAdvances: SubcontractorAdvance[];
  subcontractors: Subcontractor[];
  userId: string;
}) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<AccountTab>(initialTab ?? "daily");
  const [editing, setEditing] = useState<Subcontractor | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [drawerRow, setDrawerRow] = useState<(BillingRecord["subcon_items"][number] & {
    billing_month: number;
    billing_year: number;
    billing_period: BillingPeriod;
  }) | null>(null);

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  const selected = useMemo(() => {
    return subcontractors.find((subcontractor) => subcontractor.id === selectedSubcontractorId) ?? null;
  }, [selectedSubcontractorId, subcontractors]);

  const summaries = useMemo(() => {
    return subcontractors.map((subcontractor) => {
      const account = buildSubcontractorAccountSummary({
        subcontractor,
        billingRecords,
        dailyTickets: subconDailyTickets,
        payments,
        subcontractorAdvances,
      });
      const advanceBalance = subcontractorAdvances
        .filter((advance) => advance.subcontractor_id === subcontractor.id && advance.status === "active")
        .reduce((sum, advance) => sum + Number(advance.balance), 0);
      return {
        subcontractor,
        pending: account.netPending,
        tickets: account.ticketsThisPeriod,
        paidThisMonth: account.paidThisMonth,
        advanceBalance,
      };
    });
  }, [billingRecords, payments, subconDailyTickets, subcontractorAdvances, subcontractors]);

  const listRows = useMemo(() => {
    return summaries.filter((row) => row.subcontractor.name.toLowerCase().includes(query.toLowerCase()));
  }, [query, summaries]);

  const listTotals = useMemo(() => {
    return summaries.reduce(
      (sum, row) => ({
        pending: sum.pending + row.pending,
        paidThisMonth: sum.paidThisMonth + row.paidThisMonth,
        advanceBalance: sum.advanceBalance + row.advanceBalance,
      }),
      { pending: 0, paidThisMonth: 0, advanceBalance: 0 },
    );
  }, [summaries]);

  async function toggleArchive(subcontractor: Subcontractor) {
    if (!supabase) return;
    const nextStatus = subcontractor.status === "active" ? "archived" : "active";
    const confirmed = await NotificationService.showConfirm({
      title: nextStatus === "archived" ? "Archive subcontractor" : "Restore subcontractor",
      message: nextStatus === "archived"
        ? `Archive ${subcontractor.name}? They'll no longer appear in active subcontractor lists.`
        : `Restore ${subcontractor.name} to active status?`,
    });
    if (!confirmed) return;
    const result = await saveSubcontractor(supabase, userId, {
      id: subcontractor.id,
      name: subcontractor.name,
      installation_rate: subcontractor.installation_rate,
      repair_rate: subcontractor.repair_rate,
      payable_pct: subcontractor.payable_pct,
      status: nextStatus,
    });
    if (result.error) {
      NotificationService.showError((result.error as { message?: string }).message ?? "Failed to update subcontractor.");
      return;
    }
    NotificationService.showSuccess(nextStatus === "archived" ? "Subcontractor archived." : "Subcontractor restored.");
    await onChange();
  }

  return (
    <>
      {selected ? (
        <SubcontractorDetailsView
          billingRecords={billingRecords}
          onArchive={toggleArchive}
          onBack={() => onSelectSubcontractor("")}
          onChange={onChange}
          onEdit={(subcontractor) => { setEditing(subcontractor); setFormOpen(true); }}
          onOpenBillingRow={setDrawerRow}
          onQueueOfflineMutation={onQueueOfflineMutation}
          payments={payments}
          selected={selected}
          setTab={setTab}
          subconDailyTickets={subconDailyTickets}
          subcontractorAdvances={subcontractorAdvances}
          tab={tab}
          userId={userId}
        />
      ) : (
        <SubcontractorsListView
          listRows={listRows}
          onAdd={() => { setEditing(null); setFormOpen(true); }}
          onSelect={onSelectSubcontractor}
          query={query}
          setQuery={setQuery}
          totals={listTotals}
        />
      )}

      {formOpen && (
        <SubcontractorProfileModal
          initial={editing}
          onClose={() => setFormOpen(false)}
          onSaved={async () => {
            setFormOpen(false);
            await onChange();
          }}
          userId={userId}
        />
      )}

      {drawerRow && (
        <div className="modal-backdrop" onClick={() => setDrawerRow(null)}>
          <aside className="subcon-billing-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>{drawerRow.subcon_name}</h3>
              <button onClick={() => setDrawerRow(null)} type="button" aria-label="Close"><X size={18} /></button>
            </div>
            <div className="subcon-billing-drawer-body">
              <p className="eyebrow">{monthNames[drawerRow.billing_month - 1]} {drawerRow.billing_year} · {billingPeriodLabel(drawerRow.billing_period)}</p>
              <div className="subcon-drawer-grid">
                <div><span>Install</span><strong>{drawerRow.install_tickets}</strong></div>
                <div><span>Repair</span><strong>{drawerRow.repair_tickets}</strong></div>
                <div><span>Disputed</span><strong>{drawerRow.disputed_install + drawerRow.disputed_repair}</strong></div>
                <div><span>Billable</span><strong>{drawerRow.billable_tickets}</strong></div>
              </div>
              <div className="billing-preview">
                <div className="billing-preview-row"><span>Gross billed</span><strong>{currency.format(drawerRow.billing_amount)}</strong></div>
                <div className="billing-preview-row highlight"><span>Net payable</span><strong>{currency.format(drawerRow.payable_amount)}</strong></div>
                <div className="billing-preview-row"><span>Company share</span><strong>{currency.format(drawerRow.collection_amount)}</strong></div>
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

function SubcontractorsListView({
  listRows,
  onAdd,
  onSelect,
  query,
  setQuery,
  totals,
}: {
  listRows: Array<{ subcontractor: Subcontractor; pending: number; tickets: number; paidThisMonth: number; advanceBalance: number }>;
  onAdd: () => void;
  onSelect: (subcontractorId: string) => void;
  query: string;
  setQuery: (query: string) => void;
  totals: { pending: number; paidThisMonth: number; advanceBalance: number };
}) {
  const activeCount = listRows.filter((row) => row.subcontractor.status === "active").length;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Partner accounts"
        title="Subcontractors"
        text="Review each subcontractor's ticket history, net payable, and payout status."
        action={(
          <button className="primary-button compact" onClick={onAdd} type="button">
            <Plus size={16} />
            Add subcontractor
          </button>
        )}
      />

      <section className="metric-grid">
        <SubconMetric helperText={`${activeCount} active`} icon={<Users size={18} />} label="Subcontractors" value={listRows.length} />
        <SubconMetric icon={<WalletCards size={18} />} label="Net pending" tone="warning" value={currency.format(totals.pending)} />
        <SubconMetric icon={<CheckCircle2 size={18} />} label="Paid this month" tone="success" value={currency.format(totals.paidThisMonth)} />
        <SubconMetric icon={<ReceiptText size={18} />} label="Cash advance balance" value={currency.format(totals.advanceBalance)} />
      </section>

      <section className="panel employee-list-panel">
        <Toolbar query={query} setQuery={setQuery} />
        <DataTable
          empty="No subcontractors found."
          headers={["No.", "Subcontractor", "Tickets this period", "Net pending", "Advance balance", "Status"]}
          onRowClick={(index) => onSelect(listRows[index].subcontractor.id)}
          rows={listRows.map((row, index) => [
            index + 1,
            <div className="employee-list-identity" key="identity">
              <div className="employee-list-avatar"><span>{subconInitials(row.subcontractor.name)}</span></div>
              <RecordTitle
                title={row.subcontractor.name}
                notes={`Install ${currency.format(row.subcontractor.installation_rate)} · Repair ${currency.format(row.subcontractor.repair_rate)}`}
              />
            </div>,
            row.tickets,
            currency.format(row.pending),
            currency.format(row.advanceBalance),
            <StatusBadge key="status" status={row.subcontractor.status} />,
          ])}
        />
      </section>
    </div>
  );
}

function SubconMetric({ helperText, icon, label, tone, value }: {
  helperText?: string;
  icon: ReactNode;
  label: string;
  tone?: "danger" | "success" | "warning";
  value: number | string;
}) {
  return (
    <div className={`subcon-metric ${tone ?? ""}`}>
      <div className={`subcon-metric-icon ${tone ?? "neutral"}`}>{icon}</div>
      <div className="subcon-metric-text">
        <span>{label}</span>
        <strong>{value}</strong>
        {helperText ? <span className="subcon-metric-helper">{helperText}</span> : null}
      </div>
    </div>
  );
}

function SubcontractorDetailsView({
  billingRecords,
  onChange,
  onArchive,
  onBack,
  onEdit,
  onOpenBillingRow,
  onQueueOfflineMutation,
  payments,
  selected,
  setTab,
  subconDailyTickets,
  subcontractorAdvances,
  tab,
  userId,
}: {
  billingRecords: BillingRecord[];
  onChange: () => Promise<void>;
  onArchive: (subcontractor: Subcontractor) => Promise<void>;
  onBack: () => void;
  onEdit: (subcontractor: Subcontractor) => void;
  onOpenBillingRow: (row: BillingRecord["subcon_items"][number] & { billing_month: number; billing_year: number; billing_period: BillingPeriod }) => void;
  onQueueOfflineMutation: QueueOfflineMutation;
  payments: PaymentReminder[];
  selected: Subcontractor;
  setTab: (tab: AccountTab) => void;
  subconDailyTickets: SubconDailyTicket[];
  subcontractorAdvances: SubcontractorAdvance[];
  tab: AccountTab;
  userId: string;
}) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [periodFilter, setPeriodFilter] = useState<"all" | BillingPeriod>("all");
  const [dailyPage, setDailyPage] = useState(1);
  const [activeCalendar, setActiveCalendar] = useState<"start" | "end" | null>(null);
  const [calendarYear, setCalendarYear] = useState(() => Number(todayKey().split("-")[0]));
  const [calendarMonth, setCalendarMonth] = useState(() => Number(todayKey().split("-")[1]));
  const [editingAdvance, setEditingAdvance] = useState<SubcontractorAdvance | null>(null);
  const [advanceForm, setAdvanceForm] = useState<SubcontractorAdvanceFormValues>(() => emptySubcontractorAdvanceForm(selected.id));
  const [advanceBusy, setAdvanceBusy] = useState(false);
  const [payingPayout, setPayingPayout] = useState<PaymentReminder | null>(null);
  const [viewingPayout, setViewingPayout] = useState<PaymentReminder | null>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const isMatchingPeriod = (value: string) => {
    if (periodFilter === "all") return true;
    const day = Number(value.slice(-2));
    return periodFilter === "first_half" ? day <= 15 : day >= 16;
  };

  const summary = useMemo(() => buildSubcontractorAccountSummary({
    subcontractor: selected,
    billingRecords,
    dailyTickets: subconDailyTickets,
    payments,
    subcontractorAdvances,
  }), [billingRecords, payments, selected, subconDailyTickets, subcontractorAdvances]);

  useEffect(() => {
    setEditingAdvance(null);
    setAdvanceForm(emptySubcontractorAdvanceForm(selected.id));
  }, [selected.id]);

  const filteredTickets = useMemo(() => {
    return filterSubcontractorDailyTickets(subconDailyTickets, selected.id, startDate || undefined, endDate || undefined)
      .filter((entry) => isMatchingPeriod(entry.entry_date))
      .sort((a, b) => b.entry_date.localeCompare(a.entry_date));
  }, [endDate, periodFilter, selected.id, startDate, subconDailyTickets]);

  useEffect(() => {
    setDailyPage(1);
  }, [endDate, periodFilter, selected.id, startDate]);

  const DAILY_TICKETS_PAGE_SIZE = 10;
  const dailyPageCount = Math.max(1, Math.ceil(filteredTickets.length / DAILY_TICKETS_PAGE_SIZE));
  const safeDailyPage = Math.min(dailyPage, dailyPageCount);
  const dailyPageStart = (safeDailyPage - 1) * DAILY_TICKETS_PAGE_SIZE;
  const dailyPageEnd = Math.min(dailyPageStart + DAILY_TICKETS_PAGE_SIZE, filteredTickets.length);
  const paginatedTickets = filteredTickets.slice(dailyPageStart, dailyPageEnd);

  const subconPayments = useMemo(() => {
    return payments
      .filter((payment) => payment.type === "subcontractor" && payment.subcontractor_id === selected.id)
      .sort((a, b) =>
        `${b.billing_year ?? 0}-${String(b.billing_month ?? 0).padStart(2, "0")}-${b.billing_period ?? ""}`.localeCompare(
          `${a.billing_year ?? 0}-${String(a.billing_month ?? 0).padStart(2, "0")}-${a.billing_period ?? ""}`,
        ),
      );
  }, [payments, selected.id]);

  const selectedAdvances = useMemo(() => subcontractorAdvances
    .filter((advance) => advance.subcontractor_id === selected.id)
    .sort((a, b) => b.date_granted.localeCompare(a.date_granted)),
  [selected.id, subcontractorAdvances]);

  const activeAdvanceBalance = selectedAdvances
    .filter((advance) => advance.status === "active")
    .reduce((sum, advance) => sum + Number(advance.balance), 0);

  async function saveAdvance(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    const amount = Number(advanceForm.amount) || 0;
    const balance = editingAdvance ? Number(editingAdvance.balance) || 0 : amount;
    const deductionPerBilling = advanceForm.deduction_mode === "per_billing"
      ? Number(advanceForm.deduction_per_billing) || 0
      : 0;
    if (amount <= 0) {
      NotificationService.showError("Enter a cash advance amount greater than zero.");
      return;
    }
    if (advanceForm.deduction_mode === "per_billing" && deductionPerBilling <= 0) {
      NotificationService.showError("Enter a per-billing deduction amount greater than zero.");
      return;
    }
    setAdvanceBusy(true);
    const payload = {
      user_id: userId,
      subcontractor_id: selected.id,
      subcon_name: selected.name,
      advance_id: editingAdvance?.advance_id ?? `SCA-${Date.now().toString(36).toUpperCase()}`,
      date_granted: advanceForm.date_granted,
      amount,
      balance,
      deduction_mode: advanceForm.deduction_mode,
      deduction_per_billing: deductionPerBilling,
      status: advanceForm.status,
      notes: advanceForm.notes.trim(),
    };

    if (!navigator.onLine) {
      await onQueueOfflineMutation({
        resource: "subcontractorAdvances",
        affectedResources: ["subcontractorAdvances", "dashboardSummary"],
        operation: editingAdvance ? "update" : "insert",
        table: "subcontractor_advances",
        recordId: editingAdvance?.id,
        payload,
      });
      setEditingAdvance(null);
      setAdvanceForm(emptySubcontractorAdvanceForm(selected.id));
      setAdvanceBusy(false);
      return;
    }

    const result = editingAdvance
      ? await supabase.from("subcontractor_advances").update(payload).eq("id", editingAdvance.id)
      : await supabase.from("subcontractor_advances").insert(payload);
    setAdvanceBusy(false);
    if (result.error) {
      NotificationService.showError((result.error as { message?: string }).message ?? "Failed to save cash advance.");
      return;
    }
    NotificationService.showSuccess(editingAdvance ? "Cash advance updated." : "Cash advance saved.");
    setEditingAdvance(null);
    setAdvanceForm(emptySubcontractorAdvanceForm(selected.id));
    await onChange();
  }

  function openLatestPayoutPaymentForm() {
    const latestOutstanding = payments
      .filter((payment) => payment.type === "subcontractor" && payment.subcontractor_id === selected.id)
      .filter((payment) => paymentReminderDisplayStatus(payment, payment.payments) !== "paid")
      .sort((a, b) =>
        `${b.billing_year ?? 0}-${String(b.billing_month ?? 0).padStart(2, "0")}-${b.billing_period ?? ""}`.localeCompare(
          `${a.billing_year ?? 0}-${String(a.billing_month ?? 0).padStart(2, "0")}-${a.billing_period ?? ""}`,
        ),
      )[0];
    if (!latestOutstanding) return;
    setPayingPayout(latestOutstanding);
  }

  async function handleRecordPayoutPayment(payment: PaymentReminder, values: PayoutPaymentFormValues) {
    if (!supabase) return;
    const amount = toNumber(values.amount);
    const remainingBalance = paymentReminderRemainingBalance(payment, payment.payments);
    const validationError = validatePaymentReminderPayment({
      amount,
      remainingBalance,
      paymentDate: values.payment_date,
      today: todayKey(),
    });
    if (validationError) {
      NotificationService.showError(validationError);
      return;
    }

    const paymentId = crypto.randomUUID();
    const paymentPayload = {
      amount,
      payment_date: values.payment_date,
      payment_method: values.payment_method,
      reference_number: values.reference_number.trim(),
      notes: values.notes.trim(),
    };
    const newPaymentRecord: PaymentReminderPayment = {
      id: paymentId, user_id: userId, payment_reminder_id: payment.id, ...paymentPayload, created_at: new Date().toISOString(),
    };
    const next = nextPaymentReminderCompletionState(payment, [...(payment.payments ?? []), newPaymentRecord]);
    const complete = next.status === "paid";

    if (!navigator.onLine) {
      await onQueueOfflineMutation({
        resource: "payments",
        affectedResources: ["payments"],
        operation: "payment_reminder_payment_group",
        table: "payment_reminder_payments",
        recordId: paymentId,
        payload: {
          paymentPayload: { ...paymentPayload, id: paymentId, user_id: userId, payment_reminder_id: payment.id },
          reminderUpdate: complete ? { id: payment.id, payload: { status: "paid" } } : null,
        },
      });
      setPayingPayout(null);
      NotificationService.showSuccess("Payment recorded locally. It will sync when online.");
      return;
    }

    const paymentResult = await recordPaymentReminderPayment(supabase, userId, payment.id, paymentPayload);
    if (paymentResult.error) {
      NotificationService.showError((paymentResult.error as { message?: string }).message ?? "Failed to record the payment.");
      return;
    }
    if (complete) {
      const completionResult = await updatePaymentReminderCompletion(supabase, payment.id, "paid");
      if (completionResult.error) {
        NotificationService.showError((completionResult.error as { message?: string }).message ?? "Payment recorded, but failed to mark the payout complete.");
        await onChange();
        return;
      }
    }
    setPayingPayout(null);
    NotificationService.showSuccess(complete ? "Final payment recorded — payout marked paid." : "Payment recorded.");
    await onChange();
  }

  async function handleDeletePayoutPayment(payment: PaymentReminder, paymentRecord: PaymentReminderPayment) {
    if (!supabase) return;
    const confirmed = await NotificationService.showConfirm({
      message: "Delete this recorded payment?",
      danger: true,
    });
    if (!confirmed) return;
    const remainingPayments = (payment.payments ?? []).filter((item) => item.id !== paymentRecord.id);
    const shouldRevert = payment.status === "paid" && nextPaymentReminderCompletionState(payment, remainingPayments).status !== "paid";

    if (!navigator.onLine) {
      await onQueueOfflineMutation({
        resource: "payments",
        affectedResources: ["payments"],
        operation: "delete",
        table: "payment_reminder_payments",
        recordId: paymentRecord.id,
      });
      if (shouldRevert) {
        await onQueueOfflineMutation({
          resource: "payments",
          affectedResources: ["payments"],
          operation: "update",
          table: "payment_reminders",
          recordId: payment.id,
          payload: { status: "pending" },
        });
      }
      NotificationService.showSuccess("Deleted locally. It will sync when online.");
      return;
    }

    const deleteResult = await deletePaymentReminderPayment(supabase, paymentRecord.id);
    if (deleteResult.error) {
      NotificationService.showError((deleteResult.error as { message?: string }).message ?? "Failed to delete that payment.");
      return;
    }
    if (shouldRevert) {
      const completionResult = await updatePaymentReminderCompletion(supabase, payment.id, "pending");
      if (completionResult.error) {
        NotificationService.showError((completionResult.error as { message?: string }).message ?? "Deleted, but failed to revert the payout status.");
        await onChange();
        return;
      }
    }
    NotificationService.showSuccess("Payment deleted.");
    await onChange();
  }

  function editAdvance(advance: SubcontractorAdvance) {
    setEditingAdvance(advance);
    setAdvanceForm({
      subcontractor_id: advance.subcontractor_id ?? selected.id,
      date_granted: advance.date_granted,
      amount: String(advance.amount),
      deduction_mode: advance.deduction_mode,
      deduction_per_billing: String(advance.deduction_per_billing),
      status: advance.status,
      notes: advance.notes,
    });
    setTab("advances");
  }

  const paymentByItemId = useMemo(() => new Map(
    subconPayments
      .filter((p) => p.billing_subcon_item_id !== null)
      .map((payment) => [payment.billing_subcon_item_id!, payment]),
  ), [subconPayments]);

  const displaySummary = useMemo(() => {
    if (periodFilter === "all") return summary;

    const billingRows = summary.billingRows.filter((row) => row.billing_period === periodFilter);
    const filteredPayments = subconPayments.filter((payment) => payment.billing_period === periodFilter);
    const filteredPaymentByItemId = new Map(
      filteredPayments
        .filter((p) => p.billing_subcon_item_id !== null)
        .map((payment) => [payment.billing_subcon_item_id!, payment]),
    );
    const pendingFromPayments = filteredPayments
      .filter((payment) => paymentReminderDisplayStatus(payment, payment.payments) !== "paid")
      .reduce((sum, payment) => sum + paymentReminderRemainingBalance(payment, payment.payments), 0);
    const pendingFromUntrackedBilling = billingRows
      .filter((row) => !filteredPaymentByItemId.has(row.id))
      .reduce((sum, row) => sum + row.payable_amount, 0);
    const paidThisMonth = filteredPayments
      .reduce((sum, payment) => sum + paymentReminderPaymentsTotal(payment.payments), 0);

    return {
      ...summary,
      billingRows,
      lastPayoutStatus: filteredPayments[0] ? paymentReminderDisplayStatus(filteredPayments[0], filteredPayments[0].payments) : "none",
      netPending: pendingFromPayments + pendingFromUntrackedBilling,
      paidThisMonth,
      ticketsThisPeriod: filteredTickets.length,
    };
  }, [filteredTickets.length, subconPayments, periodFilter, summary]);

  const latestBillingRows = useMemo(() => {
    if (summary.billingRows.length === 0) return [];
    const latestMonthKey = [...summary.billingRows]
      .map((row) => `${row.billing_year}-${String(row.billing_month).padStart(2, "0")}`)
      .sort((a, b) => b.localeCompare(a))[0];

    return summary.billingRows.filter(
      (row) => `${row.billing_year}-${String(row.billing_month).padStart(2, "0")}` === latestMonthKey,
    );
  }, [summary.billingRows]);

  useEffect(() => {
    if (!activeCalendar) return;
    function handleClickOutside(event: MouseEvent) {
      if (calendarRef.current && !calendarRef.current.contains(event.target as Node)) {
        setActiveCalendar(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [activeCalendar]);

  function displayDate(dateKey: string) {
    return new Date(`${dateKey}T00:00:00`).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }

  function getCalendarDays(year: number, month: number) {
    const firstDow = new Date(year, month - 1, 1).getDay();
    const startOffset = (firstDow + 6) % 7;
    const daysInMonth = new Date(year, month, 0).getDate();
    const days: Array<{ dateKey: string; day: number; currentMonth: boolean }> = [];
    const pad = (n: number) => String(n).padStart(2, "0");
    for (let i = startOffset; i > 0; i -= 1) {
      const date = new Date(year, month - 1, 1 - i);
      days.push({ dateKey: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, day: date.getDate(), currentMonth: false });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      days.push({ dateKey: `${year}-${pad(month)}-${pad(day)}`, day, currentMonth: true });
    }
    const remaining = (7 - (days.length % 7)) % 7;
    for (let day = 1; day <= remaining; day += 1) {
      const nextMonth = month === 12 ? 1 : month + 1;
      const nextYear = month === 12 ? year + 1 : year;
      days.push({ dateKey: `${nextYear}-${pad(nextMonth)}-${pad(day)}`, day, currentMonth: false });
    }
    return days;
  }

  function openCalendar(field: "start" | "end") {
    const value = field === "start" ? startDate : endDate;
    const baseDate = value || todayKey();
    const [year, month] = baseDate.split("-").map(Number);
    setCalendarYear(year);
    setCalendarMonth(month);
    setActiveCalendar((current) => current === field ? null : field);
  }

  function prevCalendarMonth() {
    if (calendarMonth === 1) {
      setCalendarMonth(12);
      setCalendarYear((year) => year - 1);
      return;
    }
    setCalendarMonth((month) => month - 1);
  }

  function nextCalendarMonth() {
    if (calendarMonth === 12) {
      setCalendarMonth(1);
      setCalendarYear((year) => year + 1);
      return;
    }
    setCalendarMonth((month) => month + 1);
  }

  function selectCalendarDate(dateKey: string) {
    if (activeCalendar === "start") setStartDate(dateKey);
    if (activeCalendar === "end") setEndDate(dateKey);
    setActiveCalendar(null);
  }

  return (
    <div className="page-stack">
      <div className="subcon-details">
        <header className="subcon-header">
          <button aria-label="Back to subcontractors" className="subcon-back" onClick={onBack} type="button">
            <ArrowLeft size={16} />
          </button>
          <div className="subcon-identity">
            <div className="subcon-avatar"><span>{subconInitials(selected.name)}</span></div>
            <div className="subcon-name-group">
              <strong className="subcon-name">{selected.name}</strong>
              <StatusBadge status={selected.status} />
              <div className="subcon-meta-row">
                <div className="subcon-meta-item">
                  <span>Installation rate</span>
                  <strong>{currency.format(selected.installation_rate)}</strong>
                </div>
                <div className="subcon-meta-item">
                  <span>Repair rate</span>
                  <strong>{currency.format(selected.repair_rate)}</strong>
                </div>
                <div className="subcon-meta-item">
                  <span>Payable %</span>
                  <strong>{selected.payable_pct}%</strong>
                </div>
              </div>
            </div>
          </div>
          <div className="subcon-header-actions">
            <button className="secondary-button compact" onClick={() => onEdit(selected)} type="button"><Pencil size={16} /> Edit profile</button>
            <button className="secondary-button compact" onClick={() => void onArchive(selected)} type="button">
              {selected.status === "active" ? <><Trash2 size={16} /> Archive</> : <><Plus size={16} /> Restore</>}
            </button>
            <button className="primary-button compact" disabled={displaySummary.netPending <= 0} onClick={openLatestPayoutPaymentForm} type="button">
              <CheckCircle2 size={16} />
              Record payout payment
            </button>
          </div>
        </header>

        <section className="metric-grid">
          <SubconMetric icon={<Ticket size={18} />} label="Tickets this period" value={String(displaySummary.ticketsThisPeriod)} />
          <SubconMetric icon={<WalletCards size={18} />} label="Net pending" tone="warning" value={currency.format(displaySummary.netPending)} />
          <SubconMetric icon={<CheckCircle2 size={18} />} label="Paid this month" tone="success" value={currency.format(displaySummary.paidThisMonth)} />
          <SubconMetric icon={<ReceiptText size={18} />} label="Cash advance balance" value={currency.format(activeAdvanceBalance)} />
        </section>

        <nav className="subcon-tabs" role="tablist">
          <button className={tab === "daily" ? "active" : ""} onClick={() => setTab("daily")} role="tab" type="button">Daily Tickets</button>
          <button className={tab === "billing" ? "active" : ""} onClick={() => setTab("billing")} role="tab" type="button">Billing & Net</button>
          <button className={tab === "payouts" ? "active" : ""} onClick={() => setTab("payouts")} role="tab" type="button">Payouts</button>
          <button className={tab === "advances" ? "active" : ""} onClick={() => setTab("advances")} role="tab" type="button">Cash Advances</button>
        </nav>

        {tab === "daily" && (
          <section className="emp-content-card">
            <div className="page-stack">
              <div className="subcon-filters" ref={calendarRef}>
                <label>
                  Start date
                  <div className="att-cal-wrap">
                    <button
                      className="subcon-date-trigger att-cal-trigger"
                      onClick={() => openCalendar("start")}
                      type="button"
                    >
                      <CalendarClock size={16} />
                      <span>{startDate ? displayDate(startDate) : "Select start date"}</span>
                    </button>
                    {activeCalendar === "start" && (
                      <div className="att-cal">
                        <div className="att-cal-header">
                          <button onClick={prevCalendarMonth} type="button"><ChevronLeft size={14} /></button>
                          <span>{monthNames[calendarMonth - 1]} {calendarYear}</span>
                          <button onClick={nextCalendarMonth} type="button"><ChevronRight size={14} /></button>
                        </div>
                        <div className="att-cal-grid">
                          {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((day) => (
                            <span key={day} className="att-cal-day-name">{day}</span>
                          ))}
                          {getCalendarDays(calendarYear, calendarMonth).map(({ currentMonth, dateKey, day }) => (
                            <button
                              key={dateKey}
                              className={[
                                "att-cal-day",
                                !currentMonth ? "other-month" : "",
                                dateKey === startDate ? "selected" : "",
                                dateKey === todayKey() ? "today" : "",
                              ].filter(Boolean).join(" ")}
                              onClick={() => selectCalendarDate(dateKey)}
                              type="button"
                            >
                              {day}
                            </button>
                          ))}
                        </div>
                        <div className="att-cal-footer">
                          <span>Today: {displayDate(todayKey())}</span>
                          <button
                            onClick={() => {
                              const today = todayKey();
                              const [year, month] = today.split("-").map(Number);
                              setCalendarYear(year);
                              setCalendarMonth(month);
                              setStartDate(today);
                              setActiveCalendar(null);
                            }}
                            type="button"
                          >
                            Go to today
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </label>
                <label>
                  End date
                  <div className="att-cal-wrap">
                    <button
                      className="subcon-date-trigger att-cal-trigger"
                      onClick={() => openCalendar("end")}
                      type="button"
                    >
                      <CalendarClock size={16} />
                      <span>{endDate ? displayDate(endDate) : "Select end date"}</span>
                    </button>
                    {activeCalendar === "end" && (
                      <div className="att-cal">
                        <div className="att-cal-header">
                          <button onClick={prevCalendarMonth} type="button"><ChevronLeft size={14} /></button>
                          <span>{monthNames[calendarMonth - 1]} {calendarYear}</span>
                          <button onClick={nextCalendarMonth} type="button"><ChevronRight size={14} /></button>
                        </div>
                        <div className="att-cal-grid">
                          {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((day) => (
                            <span key={day} className="att-cal-day-name">{day}</span>
                          ))}
                          {getCalendarDays(calendarYear, calendarMonth).map(({ currentMonth, dateKey, day }) => (
                            <button
                              key={dateKey}
                              className={[
                                "att-cal-day",
                                !currentMonth ? "other-month" : "",
                                dateKey === endDate ? "selected" : "",
                                dateKey === todayKey() ? "today" : "",
                              ].filter(Boolean).join(" ")}
                              onClick={() => selectCalendarDate(dateKey)}
                              type="button"
                            >
                              {day}
                            </button>
                          ))}
                        </div>
                        <div className="att-cal-footer">
                          <span>Today: {displayDate(todayKey())}</span>
                          <button
                            onClick={() => {
                              const today = todayKey();
                              const [year, month] = today.split("-").map(Number);
                              setCalendarYear(year);
                              setCalendarMonth(month);
                              setEndDate(today);
                              setActiveCalendar(null);
                            }}
                            type="button"
                          >
                            Go to today
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </label>
                <label>
                  Billing period
                  <select value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value as typeof periodFilter)}>
                    <option value="all">All</option>
                    <option value="first_half">1st - 15th</option>
                    <option value="second_half">16th - End</option>
                  </select>
                </label>
              </div>
              <DataTable
                empty="No daily tickets for this subcontractor yet."
                headers={["Date", "Install", "Repair", "Total", "Total net"]}
                rows={paginatedTickets.map((entry) => [
                  entry.entry_date,
                  entry.install_tickets,
                  entry.repair_tickets,
                  entry.install_tickets + entry.repair_tickets,
                  currency.format(
                    Math.round(
                      (
                        (entry.install_tickets * entry.installation_rate +
                          entry.repair_tickets * entry.repair_rate) *
                        (selected.payable_pct / 100)
                      ) * 100,
                    ) / 100,
                  ),
                ])}
              />
              {filteredTickets.length > DAILY_TICKETS_PAGE_SIZE && (
                <div className="attendance-footer">
                  <span>
                    Showing {dailyPageStart + 1} to {dailyPageEnd} of {filteredTickets.length} ticket entries
                  </span>
                  <div>
                    <button disabled={safeDailyPage === 1} onClick={() => setDailyPage((page) => Math.max(1, page - 1))} type="button">{"<"}</button>
                    {Array.from({ length: dailyPageCount }, (_, index) => index + 1).map((page) => (
                      <button
                        className={page === safeDailyPage ? "active" : undefined}
                        key={page}
                        onClick={() => setDailyPage(page)}
                        type="button"
                      >
                        {page}
                      </button>
                    ))}
                    <button disabled={safeDailyPage === dailyPageCount} onClick={() => setDailyPage((page) => Math.min(dailyPageCount, page + 1))} type="button">{">"}</button>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {tab === "billing" && (
          <section className="emp-content-card">
            <DataTable
              empty="No billing rows for this subcontractor yet."
              headers={["Period", "Tickets", "Disputed", "Billable", "Gross billed", "Split", "Net payable", "Payout"]}
              onRowClick={(index) => onOpenBillingRow(latestBillingRows[index])}
              rows={latestBillingRows.map((row) => {
                const payment = paymentByItemId.get(row.id);
                return [
                  `${monthNames[row.billing_month - 1]} ${row.billing_year} · ${billingPeriodLabel(row.billing_period)}`,
                  `${row.install_tickets + row.repair_tickets} (I:${row.install_tickets} R:${row.repair_tickets})`,
                  row.disputed_install + row.disputed_repair,
                  row.billable_tickets,
                  currency.format(row.billing_amount),
                  `${100 - row.payable_pct}% collection · ${row.payable_pct}% payable`,
                  <strong className="subcon-net-value" key={`${row.id}-net`}>{currency.format(row.payable_amount)}</strong>,
                  payment
                    ? <StatusBadge key={`${row.id}-status`} status={paymentReminderDisplayStatus(payment, payment.payments)} />
                    : <span className="subcon-missing-payment"><AlertTriangle size={14} /> Missing payout</span>,
                ];
              })}
            />
          </section>
        )}

        {tab === "payouts" && (
          <section className="emp-content-card">
            <DataTable
              empty="No payout records yet."
              headers={["Period", "Net amount", "Paid", "Remaining", "Due date", "Status", "Notes", "Action"]}
              rows={subconPayments.map((payment) => {
                const displayStatus = paymentReminderDisplayStatus(payment, payment.payments);
                const paidAmount = paymentReminderPaymentsTotal(payment.payments);
                const remainingBalance = paymentReminderRemainingBalance(payment, payment.payments);
                return [
                  payment.billing_month != null
                    ? `${monthNames[payment.billing_month - 1]} ${payment.billing_year} · ${billingPeriodLabel(payment.billing_period!)}`
                    : payment.notes || "—",
                  <strong className="subcon-net-value" key={`${payment.id}-net`}>{currency.format(payment.amount)}</strong>,
                  currency.format(paidAmount),
                  currency.format(remainingBalance),
                  payment.due_date,
                  <StatusBadge key={`${payment.id}-status`} status={displayStatus} />,
                  payment.notes || "—",
                  <div className="billing-row-actions" key={`${payment.id}-action`}>
                    <button onClick={() => setViewingPayout(payment)} title="View details" type="button"><Eye size={14} /></button>
                    {displayStatus !== "paid" && (
                      <button onClick={() => setPayingPayout(payment)} title="Record payment" type="button"><CheckCircle2 size={14} /></button>
                    )}
                  </div>,
                ];
              })}
            />
          </section>
        )}

        {tab === "advances" && (
          <section className="emp-content-card">
            <div className="page-stack">
              <form className="employee-advance-form" onSubmit={saveAdvance}>
                <div className="employee-advance-selected-employee">
                  <span>{editingAdvance ? "Edit cash advance" : "New cash advance"}</span>
                  <strong>{selected.name}</strong>
                  {editingAdvance && (
                    <button aria-label="Cancel editing cash advance" onClick={() => {
                      setEditingAdvance(null);
                      setAdvanceForm(emptySubcontractorAdvanceForm(selected.id));
                    }} type="button">
                      <X size={14} />
                    </button>
                  )}
                </div>
                <label>
                  Date Granted *
                  <input required type="date" value={advanceForm.date_granted} onChange={(event) => setAdvanceForm({ ...advanceForm, date_granted: event.target.value })} />
                </label>
                <MoneyField label="Amount *" onChange={(amountValue) => setAdvanceForm({ ...advanceForm, amount: amountValue })} required value={advanceForm.amount} />
                <label>
                  Deduction Method
                  <select value={advanceForm.deduction_mode} onChange={(event) => setAdvanceForm({ ...advanceForm, deduction_mode: event.target.value as SubcontractorAdvance["deduction_mode"] })}>
                    <option value="full_payout">Full paid from payout</option>
                    <option value="per_billing">Per billing deduction</option>
                  </select>
                </label>
                <MoneyField
                  disabled={advanceForm.deduction_mode !== "per_billing"}
                  label="Deduction Per Billing"
                  onChange={(value) => setAdvanceForm({ ...advanceForm, deduction_per_billing: value })}
                  required={advanceForm.deduction_mode === "per_billing"}
                  value={advanceForm.deduction_per_billing}
                />
                <label>
                  Status
                  <select value={advanceForm.status} onChange={(event) => setAdvanceForm({ ...advanceForm, status: event.target.value as SubcontractorAdvance["status"] })}>
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                    <option value="archived">Archived</option>
                  </select>
                </label>
                <label className="employee-advance-form-wide">
                  Notes
                  <textarea placeholder="Purpose, release details, or reminders..." value={advanceForm.notes} onChange={(event) => setAdvanceForm({ ...advanceForm, notes: event.target.value })} />
                </label>
                <div className="employee-advance-form-actions">
                  <button className="secondary-button" onClick={() => {
                    setEditingAdvance(null);
                    setAdvanceForm(emptySubcontractorAdvanceForm(selected.id));
                  }} type="button">Clear</button>
                  <button className="primary-button" disabled={advanceBusy} type="submit">{advanceBusy ? "Saving..." : editingAdvance ? "Update advance" : "Save cash advance"}</button>
                </div>
              </form>
              <DataTable
                empty="No cash advances for this subcontractor yet."
                headers={["Reference", "Date", "Amount", "Balance", "Deduction", "Status", "Notes", "Action"]}
                rows={selectedAdvances.map((advance) => [
                  advance.advance_id,
                  advance.date_granted,
                  currency.format(Number(advance.amount)),
                  <strong className="subcon-net-value" key={`${advance.id}-balance`}>{currency.format(Number(advance.balance))}</strong>,
                  advance.deduction_mode === "per_billing"
                    ? `${currency.format(Number(advance.deduction_per_billing))} / billing`
                    : "Full paid from payout",
                  <StatusBadge key={`${advance.id}-status`} status={advance.status} />,
                  advance.notes || "-",
                  <button className="secondary-button compact" key={`${advance.id}-edit`} onClick={() => editAdvance(advance)} type="button"><Pencil size={14} /> Edit</button>,
                ])}
              />
            </div>
          </section>
        )}
      </div>
      {payingPayout && (
        <PayoutPaymentForm
          onClose={() => setPayingPayout(null)}
          onSubmit={(values) => handleRecordPayoutPayment(payingPayout, values)}
          payment={payments.find((item) => item.id === payingPayout.id) ?? payingPayout}
        />
      )}
      {viewingPayout && (
        <PayoutDetailsModal
          onClose={() => setViewingPayout(null)}
          onDeletePayment={(paymentRecord) => handleDeletePayoutPayment(viewingPayout, paymentRecord)}
          onRecordPayment={() => setPayingPayout(viewingPayout)}
          payment={payments.find((item) => item.id === viewingPayout.id) ?? viewingPayout}
        />
      )}
    </div>
  );
}

function SubcontractorProfileModal({
  initial,
  onClose,
  onSaved,
  userId,
}: {
  initial: Subcontractor | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  userId: string;
}) {
  const [values, setValues] = useState({
    name: initial?.name ?? "",
    installation_rate: String(initial?.installation_rate ?? 0),
    repair_rate: String(initial?.repair_rate ?? 0),
    payable_pct: String(initial?.payable_pct ?? 30),
  });
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !values.name.trim()) return;
    setBusy(true);
    const result = await saveSubcontractor(supabase, userId, {
      id: initial?.id,
      name: values.name.trim(),
      installation_rate: Number(values.installation_rate) || 0,
      repair_rate: Number(values.repair_rate) || 0,
      payable_pct: Number(values.payable_pct) || 30,
      status: initial?.status ?? "active",
    });
    setBusy(false);
    if (result.error) {
      NotificationService.showError((result.error as { message?: string }).message ?? "Failed to save subcontractor.");
      return;
    }
    NotificationService.showSuccess(initial ? "Subcontractor updated." : "Subcontractor added.");
    await onSaved();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal billing-form-modal subcon-form-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h3>{initial ? "Edit" : "Add"} Subcontractor</h3>
          <button onClick={onClose} type="button" aria-label="Close"><X size={18} /></button>
        </div>
        <form
          className="billing-form-body"
          onSubmit={handleSubmit}
        >
          <div className="billing-form-fields subcon-form-fields">
            <label>
              Name
              <input value={values.name} onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))} required />
            </label>
            <MoneyField label="Installation rate (PHP)" value={values.installation_rate} onChange={(value) => setValues((current) => ({ ...current, installation_rate: value }))} required />
            <MoneyField label="Repair rate (PHP)" value={values.repair_rate} onChange={(value) => setValues((current) => ({ ...current, repair_rate: value }))} required />
            <label>
              Payable % (default 30)
              <input max="100" min="0" type="number" value={values.payable_pct} onChange={(event) => setValues((current) => ({ ...current, payable_pct: event.target.value }))} required />
            </label>
            <label>
              Collection % (derived)
              <input disabled type="number" value={100 - (Number(values.payable_pct) || 0)} />
            </label>
          </div>
          <div className="form-actions">
            <button className="billing-btn outline" onClick={onClose} type="button">Cancel</button>
            <button className="billing-btn primary" disabled={busy} type="submit">{busy ? "Saving..." : initial ? "Update" : "Add"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PayoutPaymentForm({
  onClose,
  onSubmit,
  payment,
}: {
  onClose: () => void;
  onSubmit: (values: PayoutPaymentFormValues) => Promise<void>;
  payment: PaymentReminder;
}) {
  const remainingBalance = paymentReminderRemainingBalance(payment, payment.payments);
  const [values, setValues] = useState<PayoutPaymentFormValues>({
    amount: String(remainingBalance),
    payment_date: todayKey(),
    payment_method: "cash" as CollectionPaymentMethod,
    reference_number: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal billing-form-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>Record Payment</h3>
            <span>
              {payment.billing_month != null
                ? `${monthNames[payment.billing_month - 1]} ${payment.billing_year} · ${billingPeriodLabel(payment.billing_period!)}`
                : payment.title}
            </span>
          </div>
          <button aria-label="Close" onClick={onClose} type="button"><X size={18} /></button>
        </div>
        <form
          className="billing-form-body"
          onSubmit={async (event) => { event.preventDefault(); setBusy(true); await onSubmit(values); setBusy(false); }}
        >
          <p className="expense-remaining-note">Remaining balance: {currency.format(remainingBalance)}</p>
          <div className="billing-form-fields">
            <MoneyField label="Amount" onChange={(amount) => setValues((current) => ({ ...current, amount }))} required value={values.amount} />
            <label>
              Payment date
              <input
                max={todayKey()}
                onChange={(event) => setValues((current) => ({ ...current, payment_date: event.target.value }))}
                required
                type="date"
                value={values.payment_date}
              />
            </label>
            <label>
              Payment method
              <select
                onChange={(event) => setValues((current) => ({ ...current, payment_method: event.target.value as CollectionPaymentMethod }))}
                value={values.payment_method}
              >
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="check">Check</option>
                <option value="e_wallet">E-wallet</option>
                <option value="card">Card</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Reference number
              <input
                onChange={(event) => setValues((current) => ({ ...current, reference_number: event.target.value }))}
                type="text"
                value={values.reference_number}
              />
            </label>
          </div>
          <label>
            Notes
            <textarea onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))} rows={3} value={values.notes} />
          </label>
          <div className="form-actions">
            <button className="billing-btn outline" onClick={onClose} type="button">Cancel</button>
            <button className="billing-btn primary" disabled={busy} type="submit">{busy ? "Saving..." : "Record payment"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PayoutDetailsModal({
  onClose,
  onDeletePayment,
  onRecordPayment,
  payment,
}: {
  onClose: () => void;
  onDeletePayment: (paymentRecord: PaymentReminderPayment) => Promise<void>;
  onRecordPayment: () => void;
  payment: PaymentReminder;
}) {
  const history = [...(payment.payments ?? [])].sort((a, b) => b.payment_date.localeCompare(a.payment_date) || b.created_at.localeCompare(a.created_at));
  const displayStatus = paymentReminderDisplayStatus(payment, payment.payments);
  const paidAmount = paymentReminderPaymentsTotal(payment.payments);
  const remainingBalance = paymentReminderRemainingBalance(payment, payment.payments);
  const canRecordPayment = displayStatus !== "paid";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal expense-details-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>{payment.title}</h3>
            <span>
              {payment.billing_month != null
                ? `${monthNames[payment.billing_month - 1]} ${payment.billing_year} · ${billingPeriodLabel(payment.billing_period!)}`
                : "One-off payout"}
            </span>
          </div>
          <button aria-label="Close" onClick={onClose} type="button"><X size={18} /></button>
        </div>
        <div className="expense-details-modal-body">
          <section className="expense-summary-grid">
            <SummaryCard label="Net amount" value={payment.amount} />
            <SummaryCard label="Paid so far" tone="success" value={paidAmount} />
            <SummaryCard label="Remaining" value={remainingBalance} />
          </section>

          <section className="expense-detail-card">
            <div>
              <span>Status</span>
              <StatusBadge status={displayStatus} />
            </div>
            <div>
              <span>Due date</span>
              <strong>{payment.due_date}</strong>
            </div>
            <div className="wide">
              <span>Notes</span>
              <strong>{payment.notes || "No notes"}</strong>
            </div>
          </section>

          <section className="expense-ledger">
            <div className="expense-section-heading">
              <div>
                <p>Audit trail</p>
                <h2>Payment history</h2>
              </div>
              {canRecordPayment && (
                <button className="billing-btn primary" onClick={onRecordPayment} type="button">
                  <CheckCircle2 size={15} /> Record Payment
                </button>
              )}
            </div>
            <div className="billing-table-wrap">
              <table className="billing-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="num">Amount</th>
                    <th>Method</th>
                    <th>Reference</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((paymentRecord) => (
                    <tr key={paymentRecord.id}>
                      <td>{paymentRecord.payment_date}</td>
                      <td className="num">{currency.format(paymentRecord.amount)}</td>
                      <td>{paymentMethodLabel(paymentRecord.payment_method)}</td>
                      <td>{paymentRecord.reference_number || "—"}</td>
                      <td>
                        <div className="billing-row-actions">
                          <button onClick={() => void onDeletePayment(paymentRecord)} title="Delete" type="button"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {history.length === 0 && (
                    <tr>
                      <td className="collection-empty" colSpan={5}>No payments recorded yet.</td>
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

function SummaryCard({ label, tone, value }: { label: string; tone?: "success"; value: number }) {
  return (
    <div className={`expense-summary-card ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{currency.format(value)}</strong>
    </div>
  );
}
