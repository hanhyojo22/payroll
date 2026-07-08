import { useEffect, useMemo, useState, type FormEvent } from "react";
import { BadgeDollarSign, CheckCircle2, ChevronDown, Eye, FileText, Pencil, Plus, Send, Trash2, X } from "lucide-react";
import {
  billingPeriodLabel,
  buildSubcontractorPayoutArtifacts,
  computeSubconItem,
  countSubconTickets,
  countTicketsByType,
} from "../../domain/billing";
import {
  paymentReminderRemainingBalance,
  subcontractorPayoutExpensePayload,
  SUBCONTRACTOR_PAYOUT_EXPENSE_CATEGORY_NAME,
} from "../../domain/paymentReminders";
import { isOfflineLikeError } from "../../lib/offlineSync";
import { supabase } from "../../supabase";
import { MoneyField } from "../../shared/components/MoneyField";
import { ActionProgress, type ActionProgressState } from "../../shared/components/ActionProgress";
import { PageHeader } from "../../shared/components/PageLayout";
import { NotificationService } from "../../shared/notifications/NotificationService";
import type { QueueOfflineMutation } from "../../shared/types";
import { currency } from "../../shared/utils/currency";
import { addDays, currentMonth, currentYear, monthNames, todayKey } from "../../shared/utils/dates";
import type {
  BillingFormValues,
  BillingRecord,
  BillingSettings,
  BillingSubconItem,
  CollectionPayment,
  CollectionPaymentFormValues,
  CollectionReminder,
  DailyTicketEntry,
  ExpenseCategory,
  PaymentReminder,
  SubcontractorAdvance,
  SubconDailyTicket,
  Subcontractor,
} from "../../types";
import {
  deleteBillingRecord,
  ensureBillingSettings,
  recordPaymentReminderPayment,
  saveBillingRecord,
  saveBillingSettings,
  saveBillingSubconItems,
  saveSubconPaymentReminders,
  updatePaymentReminderCompletion,
} from "./billingRepository";
import { recordReceivablePayment } from "../collections/collectionRepository";
import { ensureSubcontractorPayoutExpenseCategory, saveExpense } from "../expenses/expenseRepository";

function collectionStatusForRecord(record: BillingRecord, collections: CollectionReminder[], collectionId: string | null): string {
  if (!collectionId) return "-";
  const collection = collections.find((item) => item.id === collectionId);
  if (!collection) return "pending";
  return collection.status === "legacy_pending" ? "pending" : collection.status;
}

export type BillingFeatureProps = {
  billingRecords: BillingRecord[];
  billingSettings: BillingSettings | null;
  collections: CollectionReminder[];
  dailyTicketEntries: DailyTicketEntry[];
  expenseCategories: ExpenseCategory[];
  onChange: () => Promise<void>;
  onLocalBillingRecordsChange: (records: BillingRecord[]) => void;
  onOpenSubcontractorAccount: (subcontractorId: string) => void;
  onQueueOfflineMutation: QueueOfflineMutation;
  payments: PaymentReminder[];
  subconDailyTickets: SubconDailyTicket[];
  subcontractorAdvances: SubcontractorAdvance[];
  subcontractors: Subcontractor[];
  userId: string;
};

export function BillingFeature({
  billingRecords,
  billingSettings,
  collections,
  dailyTicketEntries,
  expenseCategories,
  onChange,
  onLocalBillingRecordsChange,
  onOpenSubcontractorAccount,
  onQueueOfflineMutation,
  payments,
  subconDailyTickets,
  subcontractorAdvances,
  subcontractors,
  userId,
}: BillingFeatureProps) {
  const BILLING_PAGE_SIZE = 10;
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<BillingRecord | null>(null);
  const [settings, setSettings] = useState<BillingSettings | null>(billingSettings);
  const [quickCollecting, setQuickCollecting] = useState<{ record: BillingRecord; collection: CollectionReminder } | null>(null);
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);
  const [detailsRecord, setDetailsRecord] = useState<BillingRecord | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [subcontractorExpenseCategoryId, setSubcontractorExpenseCategoryId] = useState<string | null>(
    expenseCategories.find((category) => category.type === "company" && category.name === SUBCONTRACTOR_PAYOUT_EXPENSE_CATEGORY_NAME)?.id ?? null,
  );

  useEffect(() => {
    setSettings(billingSettings);
  }, [billingSettings]);

  useEffect(() => {
    if (!supabase || settings) return;
    void ensureBillingSettings(supabase, userId).then(({ data }) => {
      if (data) setSettings(data);
    });
  }, [settings, userId]);

  useEffect(() => {
    const found = expenseCategories.find((category) => category.type === "company" && category.name === SUBCONTRACTOR_PAYOUT_EXPENSE_CATEGORY_NAME);
    if (found) setSubcontractorExpenseCategoryId(found.id);
  }, [expenseCategories]);

  const paymentByItemId = useMemo(
    () => new Map(
      payments
        .filter((p) => p.type === "subcontractor" && p.billing_subcon_item_id !== null)
        .map((p) => [p.billing_subcon_item_id!, p]),
    ),
    [payments],
  );

  async function resolveSubcontractorExpenseCategoryId() {
    if (subcontractorExpenseCategoryId) return subcontractorExpenseCategoryId;
    if (!supabase || !navigator.onLine) return null;

    const result = await ensureSubcontractorPayoutExpenseCategory(supabase, userId);
    if (result.error || !result.data) return null;
    setSubcontractorExpenseCategoryId(result.data.id);
    return result.data.id;
  }

  function remindersForExpenseSync(
    payoutPayloads: Array<Omit<PaymentReminder, "created_at" | "updated_at" | "payments">>,
  ): PaymentReminder[] {
    const now = new Date().toISOString();
    const paymentById = new Map(payments.map((payment) => [payment.id, payment]));
    return payoutPayloads.map((payload) => {
      const existing = paymentById.get(payload.id);
      return {
        ...payload,
        created_at: existing?.created_at ?? now,
        updated_at: existing?.updated_at ?? now,
        payments: existing?.payments ?? [],
      };
    });
  }

  async function syncSubcontractorPayoutExpenses(reminders: PaymentReminder[]) {
    const categoryId = await resolveSubcontractorExpenseCategoryId();
    if (!categoryId) return false;

    for (const reminder of reminders) {
      const payload = subcontractorPayoutExpensePayload(reminder, reminder.payments, categoryId);
      if (!navigator.onLine) {
        await onQueueOfflineMutation({
          resource: "expenses",
          affectedResources: ["expenses"],
          operation: "upsert",
          table: "expenses",
          recordId: payload.id,
          payload,
        });
        continue;
      }

      if (!supabase) return false;
      const result = await saveExpense(supabase, payload);
      if (result.error && isOfflineLikeError(result.error)) {
        await onQueueOfflineMutation({
          resource: "expenses",
          affectedResources: ["expenses"],
          operation: "upsert",
          table: "expenses",
          recordId: payload.id,
          payload,
        });
        continue;
      }
      if (result.error) return false;
    }

    return true;
  }

  function collectionStatusFor(record: BillingRecord): string {
    return collectionStatusForRecord(record, collections, record.collection_id);
  }

  function collectiblesStatusFor(record: BillingRecord): string {
    return collectionStatusForRecord(record, collections, record.collectibles_collection_id);
  }

  function openQuickCollect(record: BillingRecord, which: "collection" | "collectible") {
    const collectionId = which === "collection" ? record.collection_id : record.collectibles_collection_id;
    if (!collectionId) return;
    const collection = collections.find((item) => item.id === collectionId);
    if (!collection || collection.outstanding_balance <= 0) return;
    setQuickCollecting({ record, collection });
  }

  async function quickCollect(collection: CollectionReminder, method: CollectionPayment["payment_method"]) {
    if (!supabase) return;
    const amount = collection.outstanding_balance;
    const id = crypto.randomUUID();
    const rpcPayload = {
      collection_record_id: collection.id,
      payment_record_id: id,
      payment_amount: amount,
      paid_on: todayKey(),
      method,
      payment_reference: "",
      payment_notes: "",
    };
    if (!navigator.onLine) {
      await onQueueOfflineMutation({
        resource: "collections",
        affectedResources: ["collections", "dashboardSummary"],
        operation: "collection_payment",
        table: "record_collection_payment",
        recordId: id,
        payload: rpcPayload,
      });
      setQuickCollecting(null);
      NotificationService.showSuccess("Marked as collected (will sync when online).");
      return;
    }
    const values: CollectionPaymentFormValues = {
      amount: String(amount),
      payment_date: todayKey(),
      payment_method: method,
      reference_number: "",
      notes: "",
    };
    const result = await recordReceivablePayment(supabase, collection.id, id, values);
    if (result.error) {
      NotificationService.showError((result.error as { message?: string }).message ?? "Failed to record collection.");
      return;
    }
    setQuickCollecting(null);
    NotificationService.showSuccess("Collection marked as collected.");
    await onChange();
  }

  function buildArtifacts(
    values: BillingFormValues,
    ids: {
      billingId: string;
      collectionId: string;
      collectiblesCollectionId: string;
    },
  ) {
    const month = Number(values.billing_month);
    const year = Number(values.billing_year);
    const period = values.billing_period;
    const periodLabel = billingPeriodLabel(period);

    const installTickets = Number(values.install_tickets) || 0;
    const repairTickets = Number(values.repair_tickets) || 0;
    const disputedInstall = Number(values.disputed_install) || 0;
    const disputedRepair = Number(values.disputed_repair) || 0;
    const totalTickets = installTickets + repairTickets;
    const disputedTickets = disputedInstall + disputedRepair;
    const billableInstall = Math.max(0, installTickets - disputedInstall);
    const billableRepair = Math.max(0, repairTickets - disputedRepair);
    const billableTickets = billableInstall + billableRepair;
    const billingAmount = billableInstall * settings!.installation_rate + billableRepair * settings!.repair_rate;
    const collectionsAmount = Math.round((billingAmount * settings!.collections_pct) / 100 * 100) / 100;
    const collectiblesAmount = Math.round((billingAmount - collectionsAmount) * 100) / 100;
    const dueDate = values.due_date || addDays(todayKey(), 15);

    const subconItems: BillingSubconItem[] = values.subcon_items.map((item) => {
      const computed = computeSubconItem(
        Number(item.install_tickets) || 0,
        Number(item.repair_tickets) || 0,
        Number(item.disputed_install) || 0,
        Number(item.disputed_repair) || 0,
        Number(item.installation_rate) || 0,
        Number(item.repair_rate) || 0,
        Number(item.payable_pct) || 0,
      );
      return {
        id: item.id ?? crypto.randomUUID(),
        user_id: userId,
        billing_record_id: ids.billingId,
        subcontractor_id: item.subcontractor_id,
        subcon_name: item.subcon_name,
        install_tickets: Number(item.install_tickets) || 0,
        repair_tickets: Number(item.repair_tickets) || 0,
        disputed_install: Number(item.disputed_install) || 0,
        disputed_repair: Number(item.disputed_repair) || 0,
        installation_rate: Number(item.installation_rate) || 0,
        repair_rate: Number(item.repair_rate) || 0,
        billable_tickets: computed.billableTickets,
        billing_amount: computed.billingAmount,
        payable_pct: Number(item.payable_pct) || 0,
        payable_amount: computed.payableAmount,
        collection_amount: computed.collectionAmount,
        created_at: "",
      };
    });

    const billingPayload: Omit<BillingRecord, "created_at" | "updated_at" | "invoice_no"> = {
      id: ids.billingId,
      user_id: userId,
      billing_month: month,
      billing_year: year,
      billing_period: period,
      install_tickets: installTickets,
      repair_tickets: repairTickets,
      disputed_install: disputedInstall,
      disputed_repair: disputedRepair,
      total_tickets: totalTickets,
      disputed_tickets: disputedTickets,
      billable_tickets: billableTickets,
      billing_rate: 0,
      billing_amount: billingAmount,
      collections_pct: settings!.collections_pct,
      collections_amount: collectionsAmount,
      collectibles_amount: collectiblesAmount,
      collection_id: ids.collectionId,
      collectibles_collection_id: ids.collectiblesCollectionId,
      due_date: dueDate,
      subcon_items: subconItems,
      notes: values.notes.trim(),
    };

    const collectionPayload = {
      id: ids.collectionId,
      user_id: userId,
      title: `Billing ${monthNames[month - 1]} ${year} (${periodLabel}) - ${settings!.collections_pct}%`,
      client_name: settings!.client_name || "Client",
      external_reference: "",
      issue_date: todayKey(),
      amount: collectionsAmount,
      due_date: dueDate,
      status: "pending" as const,
      notes: `Auto-created from billing ${monthNames[month - 1]} ${year} (${periodLabel}).`,
    };

    const collectiblesCollectionPayload = {
      id: ids.collectiblesCollectionId,
      user_id: userId,
      title: `Billing ${monthNames[month - 1]} ${year} (${periodLabel}) - ${100 - settings!.collections_pct}%`,
      client_name: settings!.client_name || "Client",
      external_reference: "",
      issue_date: todayKey(),
      amount: collectiblesAmount,
      due_date: dueDate,
      status: "pending" as const,
      notes: `Auto-created from billing ${monthNames[month - 1]} ${year} (${periodLabel}) - ${100 - settings!.collections_pct}% collectible.`,
    };

    const subconItemIds = new Set(subconItems.map((item) => item.id));
    const { payoutPayloads, advanceUpdates } = buildSubcontractorPayoutArtifacts({
      billingMonth: month,
      billingYear: year,
      billingPeriod: period,
      dueDate,
      items: subconItems,
      existingPayments: payments.filter(
        (p) => p.type === "subcontractor" && p.billing_subcon_item_id !== null && subconItemIds.has(p.billing_subcon_item_id!),
      ),
      userId,
      monthName: monthNames[month - 1],
      subcontractorAdvances,
    });

    return { billingPayload, collectionPayload, collectiblesCollectionPayload, payoutPayloads, advanceUpdates };
  }

  async function persistBillingArtifacts(
    billingPayload: Omit<BillingRecord, "created_at" | "updated_at" | "invoice_no">,
    collectionPayload: Record<string, unknown>,
    collectiblesCollectionPayload: Record<string, unknown>,
    payoutPayloads: Array<Omit<PaymentReminder, "created_at" | "updated_at" | "payments">>,
    advanceUpdates: Array<{ id: string; payload: Pick<SubcontractorAdvance, "balance" | "status"> }>,
    isUpdate: boolean,
  ) {
    if (!supabase) return { error: { message: "Supabase unavailable." } };

    const collectionTable = supabase.from("collection_reminders");
    const primaryResult = isUpdate
      ? await collectionTable.update(collectionPayload).eq("id", billingPayload.collection_id!)
      : await collectionTable.insert(collectionPayload);
    if (primaryResult.error) return primaryResult;

    const payableResult = isUpdate
      ? await collectionTable.update(collectiblesCollectionPayload).eq("id", billingPayload.collectibles_collection_id!)
      : await collectionTable.insert(collectiblesCollectionPayload);
    if (payableResult.error) return payableResult;

    const billingResult = await saveBillingRecord(supabase, billingPayload);
    if (billingResult.error) return billingResult;

    const subconResult = await saveBillingSubconItems(supabase, billingPayload.id, billingPayload.subcon_items);
    if (subconResult.error) return subconResult;

    const payoutResult = await saveSubconPaymentReminders(supabase, payoutPayloads);
    if (payoutResult.error) return payoutResult;

    for (const update of advanceUpdates) {
      const advanceResult = await supabase.from("subcontractor_advances").update(update.payload).eq("id", update.id);
      if (advanceResult.error) return advanceResult;
    }

    return { error: null };
  }

  async function createBilling(
    values: BillingFormValues,
    onProgress?: (progress: ActionProgressState | null) => void,
  ) {
    if (!supabase || !settings) return;
    const reportProgress = (progress: ActionProgressState | null) => onProgress?.(progress);
    const month = Number(values.billing_month);
    const year = Number(values.billing_year);
    const period = values.billing_period;
    const periodLabel = billingPeriodLabel(period);
    const existing = billingRecords.find(
      (record) => record.billing_month === month && record.billing_year === year && record.billing_period === period,
    );
    if (existing) {
      NotificationService.showError(`Billing for ${monthNames[month - 1]} ${year} (${periodLabel}) already exists.`);
      return;
    }

    const confirmed = await NotificationService.showConfirm({
      title: "Create billing",
      message: `Create billing for ${monthNames[month - 1]} ${year} (${periodLabel})? This generates collections and subcontractor payouts for the period.`,
    });
    if (!confirmed) return;

    const ids = {
      billingId: crypto.randomUUID(),
      collectionId: crypto.randomUUID(),
      collectiblesCollectionId: crypto.randomUUID(),
    };
    reportProgress({
      title: "Creating billing",
      description: "Preparing billing totals, collections, and payout records.",
      completed: 1,
      total: 4,
    });
    const { billingPayload, collectionPayload, collectiblesCollectionPayload, payoutPayloads, advanceUpdates } = buildArtifacts(values, ids);
    const payoutExpenses = remindersForExpenseSync(payoutPayloads);

    if (!navigator.onLine) {
      const optimistic = {
        ...billingPayload,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as BillingRecord;
      onLocalBillingRecordsChange([optimistic, ...billingRecords]);
      await onQueueOfflineMutation({
        resource: "billingRecords",
        affectedResources: ["billingRecords", "collections", "dashboardSummary", "payments", "subcontractorAdvances"],
        operation: "billing_group",
        table: "billing_records",
        recordId: billingPayload.id,
        payload: {
          billingPayload,
          collectionPayload,
          collectiblesCollectionPayload,
          subconItemPayloads: billingPayload.subcon_items,
          subcontractorPaymentPayloads: payoutPayloads,
          subcontractorAdvanceUpdates: advanceUpdates,
        },
      });
      reportProgress({
        title: "Creating billing",
        description: "Syncing subcontractor payout expenses.",
        completed: 3,
        total: 4,
      });
      await syncSubcontractorPayoutExpenses(payoutExpenses);
      setFormOpen(false);
      NotificationService.showSuccess(`Billing for ${monthNames[month - 1]} ${year} (${periodLabel}) created.`);
      reportProgress(null);
      return;
    }

    reportProgress({
      title: "Creating billing",
      description: "Saving billing records and collection entries.",
      completed: 2,
      total: 4,
    });
    const result = await persistBillingArtifacts(
      billingPayload,
      collectionPayload,
      collectiblesCollectionPayload,
      payoutPayloads,
      advanceUpdates,
      false,
    );
    if (result.error) {
      if (isOfflineLikeError(result.error)) {
        const optimistic = {
          ...billingPayload,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as BillingRecord;
        onLocalBillingRecordsChange([optimistic, ...billingRecords]);
        await onQueueOfflineMutation({
          resource: "billingRecords",
          affectedResources: ["billingRecords", "collections", "dashboardSummary", "payments", "subcontractorAdvances"],
          operation: "billing_group",
          table: "billing_records",
          recordId: billingPayload.id,
          payload: {
            billingPayload,
            collectionPayload,
            collectiblesCollectionPayload,
            subconItemPayloads: billingPayload.subcon_items,
            subcontractorPaymentPayloads: payoutPayloads,
            subcontractorAdvanceUpdates: advanceUpdates,
          },
        });
        reportProgress({
          title: "Creating billing",
          description: "Syncing subcontractor payout expenses.",
          completed: 3,
          total: 4,
        });
        await syncSubcontractorPayoutExpenses(payoutExpenses);
        setFormOpen(false);
        reportProgress(null);
        return;
      }
      NotificationService.showError((result.error as { message?: string }).message ?? "Failed to create billing.");
      return;
    }

    reportProgress({
      title: "Creating billing",
      description: "Syncing subcontractor payout expenses.",
      completed: 3,
      total: 4,
    });
    const syncedExpenses = await syncSubcontractorPayoutExpenses(payoutExpenses);
    setFormOpen(false);
    NotificationService.showSuccess(`Billing for ${monthNames[month - 1]} ${year} (${periodLabel}) created.`);
    if (!syncedExpenses) {
      NotificationService.showError("Billing saved, but couldn't sync subcontractor payouts to Company Expenses.");
    }
    reportProgress({
      title: "Creating billing",
      description: "Refreshing billing data.",
      completed: 4,
      total: 4,
    });
    await onChange();
    reportProgress(null);
  }

  async function updateBilling(
    values: BillingFormValues,
    onProgress?: (progress: ActionProgressState | null) => void,
  ) {
    if (!supabase || !settings || !editingRecord) return;
    const reportProgress = (progress: ActionProgressState | null) => onProgress?.(progress);
    const periodLabel = billingPeriodLabel(values.billing_period);
    reportProgress({
      title: "Saving billing",
      description: "Preparing billing totals, collections, and payout records.",
      completed: 1,
      total: 4,
    });
    const { billingPayload, collectionPayload, collectiblesCollectionPayload, payoutPayloads, advanceUpdates } = buildArtifacts(values, {
      billingId: editingRecord.id,
      collectionId: editingRecord.collection_id ?? crypto.randomUUID(),
      collectiblesCollectionId: editingRecord.collectibles_collection_id ?? crypto.randomUUID(),
    });
    const payoutExpenses = remindersForExpenseSync(payoutPayloads);

    reportProgress({
      title: "Saving billing",
      description: "Saving billing records and collection entries.",
      completed: 2,
      total: 4,
    });
    const result = await persistBillingArtifacts(
      {
        ...billingPayload,
        collection_id: editingRecord.collection_id,
        collectibles_collection_id: editingRecord.collectibles_collection_id,
      },
      collectionPayload,
      collectiblesCollectionPayload,
      payoutPayloads,
      advanceUpdates,
      true,
    );
    if (result.error) {
      NotificationService.showError((result.error as { message?: string }).message ?? "Failed to update billing.");
      return;
    }

    reportProgress({
      title: "Saving billing",
      description: "Syncing subcontractor payout expenses.",
      completed: 3,
      total: 4,
    });
    const syncedExpenses = await syncSubcontractorPayoutExpenses(payoutExpenses);
    setEditingRecord(null);
    NotificationService.showSuccess(`Billing for ${monthNames[Number(values.billing_month) - 1]} ${values.billing_year} (${periodLabel}) updated.`);
    if (!syncedExpenses) {
      NotificationService.showError("Billing updated, but couldn't sync subcontractor payouts to Company Expenses.");
    }
    reportProgress({
      title: "Saving billing",
      description: "Refreshing billing data.",
      completed: 4,
      total: 4,
    });
    await onChange();
    reportProgress(null);
  }

  async function removeBilling(record: BillingRecord) {
    if (!supabase) return;
    const confirmed = await NotificationService.showConfirm({
      title: "Delete billing record",
      message: "Delete this billing record? This also removes its linked collections. This action cannot be undone.",
      danger: true,
    });
    if (!confirmed) return;
    const result = await deleteBillingRecord(
      supabase,
      record.id,
      record.collection_id,
      record.collectibles_collection_id ?? null,
    );
    if (result.error) {
      NotificationService.showError((result.error as { message?: string }).message ?? "Failed to delete billing.");
      return;
    }
    NotificationService.showSuccess("Billing record deleted.");
    await onChange();
  }

  const summary = useMemo(() => ({
    totalBilled: billingRecords.reduce((sum, record) => sum + record.billing_amount, 0),
    totalCollections: billingRecords.reduce((sum, record) => sum + record.collections_amount, 0),
    totalCollectibles: billingRecords.reduce((sum, record) => sum + record.collectibles_amount, 0),
  }), [billingRecords]);
  const pageCount = Math.max(1, Math.ceil(billingRecords.length / BILLING_PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, pageCount);
  const pageStart = (safeCurrentPage - 1) * BILLING_PAGE_SIZE;
  const pageEnd = Math.min(pageStart + BILLING_PAGE_SIZE, billingRecords.length);
  const paginatedBillingRecords = billingRecords.slice(pageStart, pageEnd);

  useEffect(() => {
    if (currentPage > pageCount) {
      setCurrentPage(pageCount);
    }
  }, [currentPage, pageCount]);

  useEffect(() => {
    if (expandedRecordId && !paginatedBillingRecords.some((record) => record.id === expandedRecordId)) {
      setExpandedRecordId(null);
    }
  }, [expandedRecordId, paginatedBillingRecords]);

  return (
    <div className="billing-page">
      <PageHeader
        action={(
          <div className="billing-header-actions">
            <button className="billing-btn primary" onClick={() => setFormOpen(true)} type="button">
              <Plus size={15} /> New billing
            </button>
          </div>
        )}
        eyebrow="Semi-monthly invoicing"
        title="Billing"
        text="Generate billing by period, track collections, and connect subcontractor net pay to payouts."
      />

      <section className="billing-summary">
        <div className="billing-stat accent">
          <div className="billing-stat-icon"><BadgeDollarSign size={21} /></div>
          <div className="billing-stat-text">
            <span className="billing-stat-label">Total billed</span>
            <strong className="billing-stat-value">{currency.format(summary.totalBilled)}</strong>
            <span className="billing-stat-helper">All billing periods</span>
          </div>
        </div>
        <div className="billing-summary-split">
          <div className="billing-stat billing-stat-collection">
            <div className="billing-stat-icon"><CheckCircle2 size={21} /></div>
            <div className="billing-stat-text">
              <span className="billing-stat-label">Collection</span>
              <strong className="billing-stat-value">{currency.format(summary.totalCollections)}</strong>
              <span className="billing-stat-helper">First to collect from client</span>
            </div>
          </div>
          <div className="billing-stat billing-stat-payable">
            <div className="billing-stat-icon"><Send size={21} /></div>
            <div className="billing-stat-text">
              <span className="billing-stat-label">Collectibles</span>
              <strong className="billing-stat-value">{currency.format(summary.totalCollectibles)}</strong>
              <span className="billing-stat-helper">Retained from client, still to collect</span>
            </div>
          </div>
        </div>
      </section>

      {billingRecords.length === 0 ? (
        <div className="billing-empty">
          <FileText size={32} />
          <p>No billing records yet</p>
          <span>Create your first billing to start tracking invoices.</span>
        </div>
      ) : (
        <>
          <div className="billing-table-wrap">
            <table className="billing-table">
              <thead>
                <tr>
                  <th>Invoice No.</th>
                  <th>Period</th>
                  <th className="num">Tickets</th>
                  <th className="num">Disputed</th>
                  <th className="num">Billable</th>
                  <th className="num">Amount</th>
                  <th className="num">Payable</th>
                  <th className="num">Collection</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {paginatedBillingRecords.map((record) => {
                  const expanded = expandedRecordId === record.id;
                  const isFullyPaid =
                    billingPaidState(collectionStatusFor(record)) === "paid" &&
                    (!record.collectibles_collection_id || billingPaidState(collectiblesStatusFor(record)) === "paid");
                  return (
                    <>
                      <tr className="expandable" key={record.id}>
                        <td className="billing-invoice-no">{record.invoice_no}</td>
                        <td>
                          <div className="billing-period-cell">
                            <button
                              className="billing-expand-btn"
                              onClick={() => setExpandedRecordId(expanded ? null : record.id)}
                              type="button"
                            >
                              <ChevronDown className={expanded ? "expanded" : ""} size={15} />
                            </button>
                            <div>
                              <strong className="billing-period-month">{monthNames[record.billing_month - 1]} {record.billing_year}</strong>
                              <span className="billing-period-half">{billingPeriodLabel(record.billing_period)}</span>
                            </div>
                          </div>
                        </td>
                        <td className="num">
                          <div className="billing-cell-breakdown">
                            <strong>{record.total_tickets}</strong>
                            <span>I:{record.install_tickets} R:{record.repair_tickets}</span>
                          </div>
                        </td>
                        <td className="num">
                          <div className="billing-cell-breakdown">
                            <strong>{record.disputed_tickets}</strong>
                            <span>I:{record.disputed_install} R:{record.disputed_repair}</span>
                          </div>
                        </td>
                        <td className="num">
                          <div className="billing-cell-breakdown">
                            <strong>{record.billable_tickets}</strong>
                            <span>
                              I:{Math.max(0, record.install_tickets - record.disputed_install)} R:{Math.max(0, record.repair_tickets - record.disputed_repair)}
                            </span>
                          </div>
                        </td>
                        <td className="num">{currency.format(record.billing_amount)}</td>
                        <td className="num">{currency.format(record.collectibles_amount)}</td>
                        <td className="num">{currency.format(record.collections_amount)}</td>
                        <td>
                          <span className={`collection-status ${isFullyPaid ? "collected" : "pending"}`}>
                            {isFullyPaid ? "Paid" : "Unpaid"}
                          </span>
                        </td>
                        <td>
                          <div className="billing-row-actions">
                            <button aria-label="View details" onClick={() => setDetailsRecord(record)} type="button" title="View details">
                              <Eye size={14} />
                            </button>
                            <button aria-label="Edit" onClick={() => setEditingRecord(record)} type="button" title="Edit">
                              <Pencil size={14} />
                            </button>
                            <button aria-label="Delete" onClick={() => void removeBilling(record)} type="button" title="Delete">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="subcon-detail-row" key={`${record.id}-subcon`}>
                          <td colSpan={10}>
                            <table className="billing-subcon-detail-table">
                              <thead>
                                <tr>
                                  <th>Subcontractor</th>
                                  <th className="num">Tickets</th>
                                  <th className="num">Gross</th>
                                  <th className="num">Net payable</th>
                                  <th>Payout</th>
                                  <th>Action</th>
                                </tr>
                              </thead>
                              <tbody>
                                {record.subcon_items.length === 0 ? (
                                  <tr>
                                    <td colSpan={6}>No subcontractor billing rows for this billing period.</td>
                                  </tr>
                                ) : (
                                  record.subcon_items.map((item) => {
                                    const payment = paymentByItemId.get(item.id);
                                    return (
                                      <tr key={item.id}>
                                        <td className="subcon-detail-name">{item.subcon_name}</td>
                                        <td className="num">{item.install_tickets + item.repair_tickets}</td>
                                        <td className="num">{currency.format(item.billing_amount)}</td>
                                        <td className="num"><strong>{currency.format(item.payable_amount)}</strong></td>
                                        <td>
                                          {payment ? (
                                            <button
                                              className="billing-subcon-status-link"
                                              onClick={() => onOpenSubcontractorAccount(item.subcontractor_id)}
                                              type="button"
                                            >
                                              {payment.status}
                                            </button>
                                          ) : (
                                            <span className="subcon-missing-payment">Missing payout</span>
                                          )}
                                        </td>
                                        <td>
                                          <div className="billing-row-actions">
                                            <button onClick={() => onOpenSubcontractorAccount(item.subcontractor_id)} type="button">
                                              View account
                                            </button>
                                            {payment?.status === "pending" && (
                                              <button onClick={() => void markPayoutPaid(payment, userId, onChange)} type="button">
                                                Mark paid
                                              </button>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })
                                )}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
          {billingRecords.length > BILLING_PAGE_SIZE && (
            <div className="attendance-footer">
              <span>
                Showing {pageStart + 1} to {pageEnd} of {billingRecords.length} billing record{billingRecords.length === 1 ? "" : "s"}
              </span>
              <div>
                <button
                  disabled={safeCurrentPage === 1}
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  type="button"
                >
                  {"<"}
                </button>
                {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
                  <button
                    className={page === safeCurrentPage ? "active" : undefined}
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    type="button"
                  >
                    {page}
                  </button>
                ))}
                <button
                  disabled={safeCurrentPage === pageCount}
                  onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))}
                  type="button"
                >
                  {">"}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {formOpen && settings && (
        <BillingForm
          dailyTicketEntries={dailyTicketEntries}
          settings={settings}
          subconDailyTickets={subconDailyTickets}
          subcontractors={subcontractors}
          onClose={() => setFormOpen(false)}
          onSubmit={createBilling}
        />
      )}
      {editingRecord && settings && (
        <BillingForm
          initial={editingRecord}
          dailyTicketEntries={dailyTicketEntries}
          settings={settings}
          subconDailyTickets={subconDailyTickets}
          subcontractors={subcontractors}
          onClose={() => setEditingRecord(null)}
          onSubmit={updateBilling}
        />
      )}
      {quickCollecting && (
        <BillingQuickCollectModal
          collection={quickCollecting.collection}
          onClose={() => setQuickCollecting(null)}
          onConfirm={(method) => quickCollect(quickCollecting.collection, method)}
        />
      )}
      {detailsRecord && settings && (
        <BillingDetailsModal
          dailyTicketEntries={dailyTicketEntries}
          onClose={() => setDetailsRecord(null)}
          payments={payments}
          record={detailsRecord}
          settings={settings}
        />
      )}
    </div>
  );
}

function billingPaidState(status: string): "paid" | "pending" {
  return status === "collected" ? "paid" : "pending";
}

async function markPayoutPaid(
  payment: PaymentReminder,
  userId: string,
  onChange: () => Promise<void>,
) {
  if (!supabase) return;
  const remainingBalance = paymentReminderRemainingBalance(payment, payment.payments);
  const confirmed = await NotificationService.showConfirm({
    title: "Mark payout as paid",
    message: `Record a full payment of ${currency.format(remainingBalance)} for ${payment.title}?`,
  });
  if (!confirmed) return;
  const paymentResult = await recordPaymentReminderPayment(supabase, userId, payment.id, {
    amount: remainingBalance,
    payment_date: todayKey(),
    payment_method: "cash",
    reference_number: "",
    notes: "",
  });
  if (paymentResult.error) {
    NotificationService.showError((paymentResult.error as { message?: string }).message ?? "Failed to record the payment.");
    return;
  }
  const completionResult = await updatePaymentReminderCompletion(supabase, payment.id, "paid");
  if (completionResult.error) {
    NotificationService.showError((completionResult.error as { message?: string }).message ?? "Payment recorded, but failed to mark the payout complete.");
    await onChange();
    return;
  }
  NotificationService.showSuccess(`${payment.title} payout marked paid.`);
  await onChange();
}

function BillingDetailsModal({
  dailyTicketEntries,
  onClose,
  payments,
  record,
  settings,
}: {
  dailyTicketEntries: DailyTicketEntry[];
  onClose: () => void;
  payments: PaymentReminder[];
  record: BillingRecord;
  settings: BillingSettings;
}) {
  const employeeRows = employeeTicketRowsForPeriod(
    dailyTicketEntries,
    settings,
    record.billing_month,
    record.billing_year,
    record.billing_period,
  );
  const employeeTotals = employeeRows.reduce(
    (sum, row) => ({
      install: sum.install + row.install,
      repair: sum.repair + row.repair,
      tickets: sum.tickets + row.install + row.repair,
      gross: sum.gross + row.gross,
    }),
    { install: 0, repair: 0, tickets: 0, gross: 0 },
  );
  const subconTotals = record.subcon_items.reduce(
    (sum, item) => ({
      install: sum.install + item.install_tickets,
      repair: sum.repair + item.repair_tickets,
      disputedInstall: sum.disputedInstall + item.disputed_install,
      disputedRepair: sum.disputedRepair + item.disputed_repair,
      billableTickets: sum.billableTickets + item.billable_tickets,
      gross: sum.gross + item.billing_amount,
      payable: sum.payable + item.payable_amount,
    }),
    { install: 0, repair: 0, disputedInstall: 0, disputedRepair: 0, billableTickets: 0, gross: 0, payable: 0 },
  );
  const paymentByItemId = new Map(
    payments
      .filter((payment) => payment.type === "subcontractor" && payment.billing_subcon_item_id)
      .map((payment) => [payment.billing_subcon_item_id!, payment]),
  );
  const billingLevelDisputes = record.disputed_install + record.disputed_repair;
  const subcontractorDisputes = subconTotals.disputedInstall + subconTotals.disputedRepair;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal billing-details-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Billing details · {record.invoice_no}</p>
            <h3>{monthNames[record.billing_month - 1]} {record.billing_year} · {billingPeriodLabel(record.billing_period)}</h3>
          </div>
          <button onClick={onClose} type="button" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="billing-details-body">
          <section className="billing-details-hero">
            <div className="billing-details-hero-main">
              <span>Total Billing Amount</span>
              <strong>{currency.format(record.billing_amount)}</strong>
            </div>
            <div className="billing-details-hero-split">
              <div>
                <span>Collection</span>
                <strong>{currency.format(record.collections_amount)}</strong>
              </div>
              <div>
                <span>Collectibles</span>
                <strong>{currency.format(record.collectibles_amount)}</strong>
              </div>
            </div>
          </section>

          <section className="billing-details-summary">
            <div><span>Total tickets</span><strong>{record.total_tickets}</strong></div>
            <div><span>Disputed</span><strong>{record.disputed_tickets}</strong></div>
            <div><span>Billable</span><strong>{record.billable_tickets}</strong></div>
          </section>

          <section className="billing-details-section">
            <div className="billing-details-section-head">
              <div>
                <h4>Employee Tickets</h4>
                <p>Closed employee ticket entries included in this billing period.</p>
              </div>
              <strong>{employeeTotals.tickets} tickets · {currency.format(employeeTotals.gross)}</strong>
            </div>
            <div className="billing-details-table-wrap">
              <table className="billing-details-table">
                <colgroup>
                  <col style={{ width: "40%" }} />
                  <col style={{ width: "15%" }} />
                  <col style={{ width: "15%" }} />
                  <col style={{ width: "15%" }} />
                  <col style={{ width: "15%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th className="num">Install</th>
                    <th className="num">Repair</th>
                    <th className="num">Total</th>
                    <th className="num">Gross</th>
                  </tr>
                </thead>
                <tbody>
                  {employeeRows.length === 0 ? (
                    <tr><td colSpan={5}>No employee ticket entries for this period.</td></tr>
                  ) : employeeRows.map((row) => (
                    <tr key={row.employeeId}>
                      <td>{row.employeeName}</td>
                      <td className="num">{row.install}</td>
                      <td className="num">{row.repair}</td>
                      <td className="num">{row.install + row.repair}</td>
                      <td className="num">{currency.format(row.gross)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="billing-details-section">
            <div className="billing-details-section-head">
              <div>
                <h4>Subcontractor Tickets</h4>
                <p>Subcontractor rows include their own disputes, billable tickets, payable split, and payout status.</p>
              </div>
              <strong>{subconTotals.billableTickets} billable · {currency.format(subconTotals.payable)} payable</strong>
            </div>
            <div className="billing-details-table-wrap">
              <table className="billing-details-table">
                <thead>
                  <tr>
                    <th>Subcontractor</th>
                    <th className="num">Tickets</th>
                    <th className="num">Disputed</th>
                    <th className="num">Billable</th>
                    <th className="num">Gross</th>
                    <th className="num">Payable</th>
                    <th className="num">Collection</th>
                    <th>Payout</th>
                  </tr>
                </thead>
                <tbody>
                  {record.subcon_items.length === 0 ? (
                    <tr><td colSpan={7}>No subcontractor rows for this billing.</td></tr>
                  ) : record.subcon_items.map((item) => {
                    const payment = paymentByItemId.get(item.id);
                    return (
                      <tr key={item.id}>
                        <td>{item.subcon_name}</td>
                        <td className="num">{item.install_tickets + item.repair_tickets} <span>I:{item.install_tickets} R:{item.repair_tickets}</span></td>
                        <td className="num">{item.disputed_install + item.disputed_repair} <span>I:{item.disputed_install} R:{item.disputed_repair}</span></td>
                        <td className="num">{item.billable_tickets}</td>
                        <td className="num">{currency.format(item.billing_amount)}</td>
                        <td className="num">{currency.format(item.payable_amount)}</td>
                        <td className="num">{currency.format(item.collection_amount)}</td>
                        <td>
                          {payment ? (
                            <>
                              <span className={`billing-payout-status ${payment.status}`}>{payment.status}</span>
                              <span className="billing-payout-amount">{currency.format(payment.amount)}</span>
                            </>
                          ) : (
                            <span className="billing-payout-status missing">Missing payout</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className={`billing-details-section billing-details-disputes${billingLevelDisputes + subcontractorDisputes === 0 ? " clear" : ""}`}>
            <div className="billing-details-section-head">
              <div>
                <h4>Dispute Details</h4>
                <p>Billing-level disputes are stored as totals. Subcontractor disputes are stored per subcontractor row.</p>
              </div>
              {billingLevelDisputes + subcontractorDisputes === 0 ? (
                <strong className="billing-details-dispute-badge clear">
                  <CheckCircle2 size={14} /> No disputes
                </strong>
              ) : (
                <strong className="billing-details-dispute-badge">{billingLevelDisputes + subcontractorDisputes} disputed</strong>
              )}
            </div>
            <div className="billing-details-summary compact">
              <div><span>Billing-level install disputes</span><strong>{record.disputed_install}</strong></div>
              <div><span>Billing-level repair disputes</span><strong>{record.disputed_repair}</strong></div>
              <div><span>Subcon install disputes</span><strong>{subconTotals.disputedInstall}</strong></div>
              <div><span>Subcon repair disputes</span><strong>{subconTotals.disputedRepair}</strong></div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function employeeTicketRowsForPeriod(
  dailyTicketEntries: DailyTicketEntry[],
  settings: BillingSettings,
  month: number,
  year: number,
  period: BillingRecord["billing_period"],
) {
  const rows = new Map<string, { employeeId: string; employeeName: string; install: number; repair: number; gross: number }>();
  const matchesPeriod = (entryDate: string) => {
    const [entryYear, entryMonth, entryDay] = entryDate.split("-").map(Number);
    if (entryYear !== year || entryMonth !== month) return false;
    return period === "first_half" ? entryDay <= 15 : entryDay >= 16;
  };

  dailyTicketEntries.filter((entry) => matchesPeriod(entry.entry_date)).forEach((entry) => {
    const details = entry.details ?? [];
    const rawInstall = details.length > 0
      ? details.filter((detail) => (detail.ticket_type ?? "installation") === "installation").reduce((sum, detail) => sum + detail.ticket_count, 0)
      : entry.installation_tickets;
    const rawRepair = details.length > 0
      ? details.filter((detail) => detail.ticket_type === "repair").reduce((sum, detail) => sum + detail.ticket_count, 0)
      : entry.repair_tickets;
    const install = Math.max(0, rawInstall - Math.min(rawInstall, entry.disputed_install ?? 0));
    const repair = Math.max(0, rawRepair - Math.min(rawRepair, entry.disputed_repair ?? 0));
    const current = rows.get(entry.employee_id) ?? {
      employeeId: entry.employee_id,
      employeeName: entry.employee_name,
      install: 0,
      repair: 0,
      gross: 0,
    };
    current.install += install;
    current.repair += repair;
    current.gross += install * settings.installation_rate + repair * settings.repair_rate;
    rows.set(entry.employee_id, current);
  });

  return Array.from(rows.values()).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

function BillingQuickCollectModal({
  collection,
  onClose,
  onConfirm,
}: {
  collection: CollectionReminder;
  onClose: () => void;
  onConfirm: (method: CollectionPayment["payment_method"]) => Promise<void>;
}) {
  const [method, setMethod] = useState<CollectionPayment["payment_method"]>("cash");
  const [busy, setBusy] = useState(false);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal billing-form-modal" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-header">
          <h3>Mark as Collected</h3>
          <button onClick={onClose} type="button" aria-label="Close"><X size={18} /></button>
        </div>
        <form
          className="billing-form-body"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            await onConfirm(method);
            setBusy(false);
          }}
        >
          <div className="billing-quick-collect-info">
            <CheckCircle2 size={22} />
            <div>
              <strong>{collection.collection_no ?? collection.title}</strong>
              <span>{collection.client_name}</span>
            </div>
          </div>
          <div className="billing-quick-collect-amount">
            <span>Full balance to collect</span>
            <strong>{currency.format(collection.outstanding_balance)}</strong>
          </div>
          <div className="billing-form-fields" style={{ marginTop: 0 }}>
            <label style={{ gridColumn: "1 / -1" }}>
              Payment method
              <select value={method} onChange={(event) => setMethod(event.target.value as CollectionPayment["payment_method"])}>
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="check">Check</option>
                <option value="e_wallet">E-wallet</option>
                <option value="card">Card</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>
          <div className="form-actions">
            <button className="billing-btn outline" onClick={onClose} type="button">Cancel</button>
            <button className="billing-btn primary" disabled={busy} type="submit">
              {busy ? "Saving..." : "Confirm Collection"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function BillingForm({
  initial,
  dailyTicketEntries,
  settings,
  subconDailyTickets,
  subcontractors,
  onClose,
  onSubmit,
}: {
  initial?: BillingRecord;
  dailyTicketEntries: DailyTicketEntry[];
  settings: BillingSettings;
  subconDailyTickets: SubconDailyTicket[];
  subcontractors: Subcontractor[];
  onClose: () => void;
  onSubmit: (values: BillingFormValues, onProgress?: (progress: ActionProgressState | null) => void) => Promise<void>;
}) {
  const today = new Date();
  const defaultPeriod = (today.getDate() <= 15 ? "first_half" : "second_half") as BillingFormValues["billing_period"];

  function buildSubconItems(month: number, year: number, period: BillingFormValues["billing_period"]) {
    const sourceSubcontractors = new Map<string, Subcontractor>();
    subcontractors.forEach((subcontractor) => {
      if (subcontractor.status === "active" || initial?.subcon_items.some((item) => item.subcontractor_id === subcontractor.id)) {
        sourceSubcontractors.set(subcontractor.id, subcontractor);
      }
    });
    initial?.subcon_items.forEach((item) => {
      if (!sourceSubcontractors.has(item.subcontractor_id)) {
        sourceSubcontractors.set(item.subcontractor_id, {
          id: item.subcontractor_id,
          user_id: item.user_id,
          name: item.subcon_name,
          installation_rate: item.installation_rate,
          repair_rate: item.repair_rate,
          payable_pct: item.payable_pct,
          status: "archived",
          created_at: item.created_at,
          updated_at: item.created_at,
        });
      }
    });

    return Array.from(sourceSubcontractors.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((subcontractor) => {
        const existing = initial?.subcon_items.find((item) => item.subcontractor_id === subcontractor.id);
        const counts = countSubconTickets(subconDailyTickets, subcontractor.id, month, year, period);
        return {
          id: existing?.id,
          subcontractor_id: subcontractor.id,
          subcon_name: subcontractor.name,
          install_tickets: String(existing?.install_tickets ?? counts.install),
          repair_tickets: String(existing?.repair_tickets ?? counts.repair),
          disputed_install: String(existing?.disputed_install ?? 0),
          disputed_repair: String(existing?.disputed_repair ?? 0),
          installation_rate: String(existing?.installation_rate ?? subcontractor.installation_rate),
          repair_rate: String(existing?.repair_rate ?? subcontractor.repair_rate),
          payable_pct: String(existing?.payable_pct ?? subcontractor.payable_pct),
        };
      });
  }

  function buildInitialValues(): BillingFormValues {
    if (initial) {
      return {
        billing_month: String(initial.billing_month),
        billing_year: String(initial.billing_year),
        billing_period: initial.billing_period,
        install_tickets: String(initial.install_tickets),
        repair_tickets: String(initial.repair_tickets),
        disputed_install: String(initial.disputed_install),
        disputed_repair: String(initial.disputed_repair),
        due_date: initial.due_date ?? "",
        subcon_items: buildSubconItems(initial.billing_month, initial.billing_year, initial.billing_period),
        notes: initial.notes,
      };
    }
    const month = Number(currentMonth());
    const year = Number(currentYear());
    const employeeCounts = countTicketsByType(dailyTicketEntries, month, year, defaultPeriod);
    const subconItems = buildSubconItems(month, year, defaultPeriod);
    const subconInstall = subconItems.reduce((sum, item) => sum + (Number(item.install_tickets) || 0), 0);
    const subconRepair = subconItems.reduce((sum, item) => sum + (Number(item.repair_tickets) || 0), 0);
    return {
      billing_month: String(month),
      billing_year: String(year),
      billing_period: defaultPeriod,
      install_tickets: String(employeeCounts.installation + subconInstall),
      repair_tickets: String(employeeCounts.repair + subconRepair),
      disputed_install: "0",
      disputed_repair: "0",
      due_date: addDays(todayKey(), 15),
      subcon_items: subconItems,
      notes: "",
    };
  }

  const [values, setValues] = useState<BillingFormValues>(buildInitialValues);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ActionProgressState | null>(null);

  useEffect(() => {
    if (initial) return;
    const month = Number(values.billing_month);
    const year = Number(values.billing_year);
    const employeeCounts = countTicketsByType(dailyTicketEntries, month, year, values.billing_period);
    const subconItems = buildSubconItems(month, year, values.billing_period);
    const subconInstall = subconItems.reduce((sum, item) => sum + (Number(item.install_tickets) || 0), 0);
    const subconRepair = subconItems.reduce((sum, item) => sum + (Number(item.repair_tickets) || 0), 0);
    setValues((current) => ({
      ...current,
      install_tickets: String(employeeCounts.installation + subconInstall),
      repair_tickets: String(employeeCounts.repair + subconRepair),
      subcon_items: subconItems,
    }));
  }, [dailyTicketEntries, initial, subconDailyTickets, subcontractors, values.billing_month, values.billing_period, values.billing_year]);

  const employeeCounts = countTicketsByType(
    dailyTicketEntries,
    Number(values.billing_month),
    Number(values.billing_year),
    values.billing_period,
  );
  const employeeRows = employeeTicketRowsForPeriod(
    dailyTicketEntries,
    settings,
    Number(values.billing_month),
    Number(values.billing_year),
    values.billing_period,
  );
  const employeeTotals = employeeRows.reduce(
    (sum, row) => ({
      install: sum.install + row.install,
      repair: sum.repair + row.repair,
      tickets: sum.tickets + row.install + row.repair,
      gross: sum.gross + row.gross,
    }),
    { install: 0, repair: 0, tickets: 0, gross: 0 },
  );
  const subconInstall = values.subcon_items.reduce((sum, item) => sum + (Number(item.install_tickets) || 0), 0);
  const subconRepair = values.subcon_items.reduce((sum, item) => sum + (Number(item.repair_tickets) || 0), 0);
  const installTickets = Math.max(0, Number(values.install_tickets) || 0);
  const repairTickets = Math.max(0, Number(values.repair_tickets) || 0);
  const disputedInstall = Math.min(installTickets, Number(values.disputed_install) || 0);
  const disputedRepair = Math.min(repairTickets, Number(values.disputed_repair) || 0);
  const employeeDisplayInstall = Math.max(0, employeeTotals.install - disputedInstall);
  const employeeDisplayRepair = Math.max(0, employeeTotals.repair - disputedRepair);
  const employeeDisplayTickets = employeeDisplayInstall + employeeDisplayRepair;
  const employeeDisplayGross = employeeDisplayInstall * settings.installation_rate + employeeDisplayRepair * settings.repair_rate;
  const billableInstall = installTickets - disputedInstall;
  const billableRepair = repairTickets - disputedRepair;
  const billableTickets = billableInstall + billableRepair;
  const billingAmount = billableInstall * settings.installation_rate + billableRepair * settings.repair_rate;
  const collectionsAmount = Math.round((billingAmount * settings.collections_pct) / 100 * 100) / 100;
  const collectiblesAmount = Math.round((billingAmount - collectionsAmount) * 100) / 100;
  const totalSubconNet = values.subcon_items.reduce((sum, item) => {
    const computed = computeSubconItem(
      Number(item.install_tickets) || 0,
      Number(item.repair_tickets) || 0,
      Number(item.disputed_install) || 0,
      Number(item.disputed_repair) || 0,
      Number(item.installation_rate) || 0,
      Number(item.repair_rate) || 0,
      Number(item.payable_pct) || 0,
    );
    return sum + computed.payableAmount;
  }, 0);

  function updateSubconItem(index: number, patch: Partial<BillingFormValues["subcon_items"][number]>) {
    setValues((current) => ({
      ...current,
      subcon_items: current.subcon_items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await onSubmit(values, setProgress);
    } finally {
      setProgress(null);
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal cbf-modal" onClick={(event) => event.stopPropagation()}>
        <div className="cbf-header">
          <div>
            <h3 className="cbf-title">{initial ? "Edit Billing" : "New Billing"}</h3>
            <p className="cbf-eyebrow">Semi-Monthly Invoicing</p>
          </div>
          <button className="cbf-close-btn" onClick={onClose} type="button" aria-label="Close"><X size={18} /></button>
        </div>

        <form className="cbf-form action-progress-shell" onSubmit={handleSubmit}>
          {busy && (
            <ActionProgress
              description={progress?.description ?? (initial ? "Updating billing totals, collections, and payout records." : "Building billing totals, collections, and payout records.")}
              progress={progress ? (progress.completed / Math.max(progress.total, 1)) * 100 : undefined}
              progressLabel={progress ? `${progress.completed} of ${progress.total} steps` : undefined}
              title={progress?.title ?? (initial ? "Saving billing" : "Creating billing")}
            />
          )}
          <div className="cbf-cols">
            <div className="cbf-left">
              <section className="cbf-section cbf-section-card">
                <div className="cbf-section-heading">
                  <p className="cbf-section-label">Billing Period</p>
                </div>
                <div className="cbf-period-row">
                  <select className="cbf-select" value={values.billing_month} onChange={(event) => setValues({ ...values, billing_month: event.target.value })}>
                    {monthNames.map((name, index) => <option key={name} value={String(index + 1)}>{name}</option>)}
                  </select>
                  <input
                    className="cbf-input cbf-year-input"
                    max="2200"
                    min="2020"
                    onChange={(event) => setValues({ ...values, billing_year: event.target.value })}
                    required
                    type="number"
                    value={values.billing_year}
                  />
                </div>
                <div className="cbf-half-toggle">
                  <button
                    className={values.billing_period === "first_half" ? "cbf-half-btn cbf-half-btn--active" : "cbf-half-btn"}
                    onClick={() => setValues({ ...values, billing_period: "first_half" })}
                    type="button"
                  >
                    1st - 15th
                  </button>
                  <button
                    className={values.billing_period === "second_half" ? "cbf-half-btn cbf-half-btn--active" : "cbf-half-btn"}
                    onClick={() => setValues({ ...values, billing_period: "second_half" })}
                    type="button"
                  >
                    16th - End
                  </button>
                </div>
                <div className="cbf-due-date-row">
                  <label className="cbf-field-label" htmlFor="billing-due-date">Due date</label>
                  <input
                    className="cbf-input"
                    id="billing-due-date"
                    onChange={(event) => setValues({ ...values, due_date: event.target.value })}
                    type="date"
                    value={values.due_date}
                  />
                </div>
              </section>

              <section className="cbf-section cbf-section-card">
                <div className="cbf-section-heading">
                  <p className="cbf-section-label">Ticket Sources</p>
                </div>
                <div className="billing-ticket-source-grid">
                  <div className="billing-ticket-source-card">
                    <span className="billing-ticket-source-title">Employees</span>
                    <strong className="billing-ticket-source-total">{employeeCounts.installation + employeeCounts.repair}</strong>
                    <div className="billing-ticket-source-breakdown">
                      <small>Install: {employeeCounts.installation}</small>
                      <small>Repair: {employeeCounts.repair}</small>
                    </div>
                  </div>
                  <div className="billing-ticket-source-card">
                    <span className="billing-ticket-source-title">Subcontractors</span>
                    <strong className="billing-ticket-source-total">{subconInstall + subconRepair}</strong>
                    <div className="billing-ticket-source-breakdown">
                      <small>Install: {subconInstall}</small>
                      <small>Repair: {subconRepair}</small>
                    </div>
                  </div>
                  <div className="billing-ticket-source-card emphasis">
                    <span className="billing-ticket-source-title">Combined</span>
                    <strong className="billing-ticket-source-total">{installTickets + repairTickets}</strong>
                    <div className="billing-ticket-source-breakdown">
                      <small>Install: {installTickets}</small>
                      <small>Repair: {repairTickets}</small>
                    </div>
                  </div>
                </div>
              </section>

              <section className="cbf-section cbf-section-card">
                <div className="cbf-section-heading">
                  <p className="cbf-section-label">Employee Tickets</p>
                </div>
                <div className="billing-details-section-head">
                  <div>
                    <h4>Employee Ticket Reference</h4>
                    <p>Closed employee tickets included in this billing period.</p>
                  </div>
                  <strong>{employeeDisplayTickets} tickets · {currency.format(employeeDisplayGross)}</strong>
                </div>
                <div className="billing-details-table-wrap">
                  <table className="billing-details-table billing-employee-reference-table">
                    <colgroup>
                      <col style={{ width: "40%" }} />
                      <col style={{ width: "15%" }} />
                      <col style={{ width: "15%" }} />
                      <col style={{ width: "15%" }} />
                      <col style={{ width: "15%" }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th className="billing-col-center">Install</th>
                        <th className="billing-col-center">Repair</th>
                        <th className="billing-col-center">Total</th>
                        <th className="billing-col-right">Gross</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employeeRows.length === 0 ? (
                        <tr><td colSpan={5}>No employee ticket entries for this period.</td></tr>
                      ) : employeeRows.map((row) => (
                        <tr key={row.employeeId}>
                          <td className="billing-col-left">{row.employeeName}</td>
                          <td className="billing-col-center">{row.install}</td>
                          <td className="billing-col-center">{row.repair}</td>
                          <td className="billing-col-center">{row.install + row.repair}</td>
                          <td className="billing-col-right">{currency.format(row.gross)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="cbf-section cbf-section-card cbf-section--dispute">
                <div className="cbf-section-heading">
                  <p className="cbf-section-label">Disputed Totals <span className="cbf-section-sub">deducted from billable</span></p>
                </div>
                <div className="cbf-dispute-summary">
                  <div className="cbf-dispute-summary-item">
                    <span>Installation tickets</span>
                    <strong>{installTickets}</strong>
                  </div>
                  <div className="cbf-dispute-summary-item">
                    <span>Repair tickets</span>
                    <strong>{repairTickets}</strong>
                  </div>
                </div>
                <div className="cbf-ticket-pair">
                  <div className="cbf-ticket-card cbf-ticket-card--dispute">
                    <label className="cbf-ticket-field">
                      <span className="cbf-ticket-type">Installation</span>
                      <span className="cbf-ticket-input-wrap">
                        <input
                          className="cbf-ticket-input cbf-ticket-input--dispute"
                          disabled={installTickets === 0}
                          max={installTickets}
                          min="0"
                          type="number"
                          value={String(disputedInstall)}
                          onChange={(event) => setValues({ ...values, disputed_install: String(Math.max(0, Math.min(installTickets, Number(event.target.value) || 0))) })}
                        />
                      </span>
                    </label>
                  </div>
                  <div className="cbf-ticket-card cbf-ticket-card--dispute">
                    <label className="cbf-ticket-field">
                      <span className="cbf-ticket-type">Repair</span>
                      <span className="cbf-ticket-input-wrap">
                        <input
                          className="cbf-ticket-input cbf-ticket-input--dispute"
                          disabled={repairTickets === 0}
                          max={repairTickets}
                          min="0"
                          type="number"
                          value={String(disputedRepair)}
                          onChange={(event) => setValues({ ...values, disputed_repair: String(Math.max(0, Math.min(repairTickets, Number(event.target.value) || 0))) })}
                        />
                      </span>
                    </label>
                  </div>
                </div>
              </section>

              <section className="cbf-section cbf-section-card">
                <div className="cbf-section-heading">
                  <p className="cbf-section-label">Subcontractor Tickets</p>
                </div>
                <div className="billing-subcon-form-scroll">
                  <div className="billing-subcon-form-table">
                  <div className="billing-subcon-form-head">
                    <span>Subcontractor</span>
                    <span>Install</span>
                    <span>Repair</span>
                    <span>Disputed Install</span>
                    <span>Disputed Repair</span>
                    <span>Net Amount</span>
                    <span>Collectibles Amount</span>
                  </div>
                  {values.subcon_items.length === 0 ? (
                    <div className="billing-subcon-form-empty">No active subcontractors yet.</div>
                  ) : (
                    values.subcon_items.map((item, index) => {
                      const itemInstallTickets = Number(item.install_tickets) || 0;
                      const itemRepairTickets = Number(item.repair_tickets) || 0;
                      const itemDisputedInstall = Math.max(0, Math.min(itemInstallTickets, Number(item.disputed_install) || 0));
                      const itemDisputedRepair = Math.max(0, Math.min(itemRepairTickets, Number(item.disputed_repair) || 0));
                      const computed = computeSubconItem(
                        itemInstallTickets,
                        itemRepairTickets,
                        itemDisputedInstall,
                        itemDisputedRepair,
                        Number(item.installation_rate) || 0,
                        Number(item.repair_rate) || 0,
                        Number(item.payable_pct) || 0,
                      );
                      return (
                        <div className="billing-subcon-form-row" key={item.subcontractor_id}>
                          <div className="billing-subcon-name-cell">
                            <strong>{item.subcon_name}</strong>
                            <span>Install rate: {currency.format(Number(item.installation_rate) || 0)}</span>
                            <span>Repair rate: {currency.format(Number(item.repair_rate) || 0)}</span>
                          </div>
                          <div className="billing-subcon-inline-values"><span>{item.install_tickets}</span></div>
                          <div className="billing-subcon-inline-values"><span>{item.repair_tickets}</span></div>
                          <div className="billing-subcon-dispute-cell">
                            <input
                              disabled={itemInstallTickets === 0}
                              max={itemInstallTickets}
                              min="0"
                              type="number"
                              value={String(itemDisputedInstall)}
                              onChange={(event) => updateSubconItem(index, { disputed_install: String(Math.max(0, Math.min(itemInstallTickets, Number(event.target.value) || 0))) })}
                            />
                          </div>
                          <div className="billing-subcon-dispute-cell">
                            <input
                              disabled={itemRepairTickets === 0}
                              max={itemRepairTickets}
                              min="0"
                              type="number"
                              value={String(itemDisputedRepair)}
                              onChange={(event) => updateSubconItem(index, { disputed_repair: String(Math.max(0, Math.min(itemRepairTickets, Number(event.target.value) || 0))) })}
                            />
                          </div>
                          <div className="billing-subcon-amount">
                            <strong>{currency.format(computed.billingAmount)}</strong>
                            <span>{computed.billableTickets} billable tickets</span>
                          </div>
                          <div className="billing-subcon-amount billing-subcon-amount-payable">
                            <strong>{currency.format(computed.payableAmount)}</strong>
                            <span>{item.payable_pct}% payable</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                </div>
              </section>

              <section className="cbf-section cbf-section-card">
                <label className="cbf-section-label">
                  Notes <span className="cbf-section-sub">optional</span>
                  <textarea className="cbf-textarea" rows={2} value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} />
                </label>
              </section>
            </div>

            <div className="cbf-right">
              <div className="cbf-statement">
                <div className="cbf-stmt-head">
                  <div>
                    <p className="cbf-stmt-period">{monthNames[Number(values.billing_month) - 1]} {values.billing_year}</p>
                    <p className="cbf-stmt-half">{billingPeriodLabel(values.billing_period)}</p>
                  </div>
                  <span className="cbf-draft-badge">Draft</span>
                </div>
                <div className="cbf-stmt-body">
                  <div className="cbf-stmt-hero">
                    <span className="cbf-stmt-hero-label">Total Billable</span>
                    <strong className="cbf-stmt-hero-amount">{currency.format(billingAmount)}</strong>
                  </div>
                  <div className="cbf-stmt-group">
                    <p className="cbf-stmt-group-label">Billable Breakdown</p>
                    <div className="cbf-stmt-row"><span>Install: {billableInstall} tickets</span><span>{currency.format(billableInstall * settings.installation_rate)}</span></div>
                    <div className="cbf-stmt-row"><span>Repair: {billableRepair} tickets</span><span>{currency.format(billableRepair * settings.repair_rate)}</span></div>
                    <div className="cbf-stmt-row cbf-stmt-row--total"><span>Total tickets</span><span>{billableTickets}</span></div>
                  </div>
                  <div className="cbf-stmt-group">
                    <p className="cbf-stmt-group-label">Subcontractor payout</p>
                    <div className="cbf-stmt-row"><span>Rows</span><span>{values.subcon_items.length}</span></div>
                    <div className="cbf-stmt-row"><span>Pending payable total</span><span>{currency.format(totalSubconNet)}</span></div>
                  </div>
                  <div className="cbf-stmt-group">
                    <p className="cbf-stmt-group-label">Split</p>
                    <div className="cbf-split-labels">
                      <div className="cbf-split-item cbf-split-item--collection">
                      <div>
                        <p className="cbf-split-label">Collection</p>
                        <strong className="cbf-split-amount">{currency.format(collectionsAmount)}</strong>
                      </div>
                      </div>
                      <div className="cbf-split-item cbf-split-item--payable">
                      <div>
                        <p className="cbf-split-label">Collectibles</p>
                        <strong className="cbf-split-amount">{currency.format(collectiblesAmount)}</strong>
                      </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="cbf-actions">
            <button className="cbf-btn-cancel" disabled={busy} onClick={onClose} type="button">Cancel</button>
            <button className="cbf-btn-submit" disabled={busy} type="submit">{busy ? "Saving..." : initial ? "Update Billing" : "Create Billing"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function BillingSettingsManager({
  billingSettings,
  onChange,
  userId,
}: {
  billingSettings: BillingSettings | null;
  onChange: () => Promise<void>;
  userId: string;
}) {
  const [settings, setSettings] = useState<BillingSettings | null>(billingSettings);

  useEffect(() => {
    setSettings(billingSettings);
  }, [billingSettings]);

  useEffect(() => {
    if (!supabase || settings) return;
    void ensureBillingSettings(supabase, userId).then(({ data }) => {
      if (data) setSettings(data);
    });
  }, [settings, userId]);

  async function updateSettings(payload: {
    installation_rate: number;
    repair_rate: number;
    collections_pct: number;
    client_name: string;
  }) {
    if (!supabase) return;
    const result = await saveBillingSettings(supabase, userId, payload);
    if (result.error) {
      NotificationService.showError("Failed to save settings.");
      return;
    }
    setSettings((current) => (current ? { ...current, ...payload } : current));
    NotificationService.showSuccess("Billing settings saved.");
    await onChange();
  }

  if (!settings) {
    return (
      <div className="page-stack">
        <PageHeader
          eyebrow="Settings"
          title="Billing Settings"
          text="Configure ticket rates, collection split, and client defaults."
        />
        <div className="billing-empty">
          <FileText size={32} />
          <p>Loading billing settings</p>
          <span>Please wait while your billing configuration is prepared.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Settings"
        title="Billing Settings"
        text="Configure ticket rates, collection split, client defaults, and subcontractor billing setup."
      />
      <BillingSettingsContent
        onSubmit={updateSettings}
        settings={settings}
      />
    </div>
  );
}

function BillingSettingsContent({
  settings,
  onSubmit,
}: {
  settings: BillingSettings;
  onSubmit: (payload: { installation_rate: number; repair_rate: number; collections_pct: number; client_name: string }) => Promise<void>;
}) {
  const [installationRate, setInstallationRate] = useState(String(settings.installation_rate));
  const [repairRate, setRepairRate] = useState(String(settings.repair_rate));
  const [pct, setPct] = useState(String(settings.collections_pct));
  const [clientName, setClientName] = useState(settings.client_name);
  const [busy, setBusy] = useState(false);

  return (
    <div className="billing-settings-page">
      <div className="billing-settings-body">
        <form
          className="form-grid"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            await onSubmit({
              installation_rate: Number(installationRate) || 0,
              repair_rate: Number(repairRate) || 0,
              collections_pct: Number(pct) || 0,
              client_name: clientName,
            });
            setBusy(false);
          }}
        >
          <MoneyField label="Installation rate (PHP per ticket)" value={installationRate} onChange={setInstallationRate} required />
          <MoneyField label="Repair rate (PHP per ticket)" value={repairRate} onChange={setRepairRate} required />
          <label>
            Collections %
            <input max="100" min="0" type="number" value={pct} onChange={(event) => setPct(event.target.value)} required />
          </label>
          <label className="full">
            Client name
            <input type="text" value={clientName} onChange={(event) => setClientName(event.target.value)} />
          </label>
          <div className="form-actions full">
            <button className="billing-btn primary" disabled={busy} type="submit">{busy ? "Saving..." : "Save Settings"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
