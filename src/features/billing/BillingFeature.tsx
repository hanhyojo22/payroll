import { useDialog } from "../../shared/components/useDialog";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, BadgeDollarSign, CalendarDays, CheckCircle2, ChevronDown, Eye, FileText, MoreVertical, Pencil, Plus, ReceiptText, Send, Trash2, X } from "lucide-react";
import {
  billingPeriodLabel,
  buildSubcontractorPayoutArtifacts,
  computeClientBillingTotals,
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
import { currency, toNumber } from "../../shared/utils/currency";
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
  saveBillingSettings,
  updatePaymentReminderCompletion,
} from "./billingRepository";
import { useRepositories } from "../../app/RepositoriesProvider";
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
  // Billing settles receivables through the collections port rather than reaching into that
  // feature's repository, so the two features share a contract instead of an implementation.
  const repos = useRepositories();
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

  const paymentsByItemId = useMemo(
    () => {
      const map = new Map<string, PaymentReminder[]>();
      payments
        .filter((p) => p.type === "subcontractor" && p.billing_subcon_item_id !== null)
        .forEach((p) => {
          const list = map.get(p.billing_subcon_item_id!) ?? [];
          list.push(p);
          map.set(p.billing_subcon_item_id!, list);
        });
      return map;
    },
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

  function isRecordFullyPaid(record: BillingRecord): boolean {
    return billingPaidState(collectionStatusFor(record)) === "paid" &&
      (!record.collectibles_collection_id || billingPaidState(collectiblesStatusFor(record)) === "paid");
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
    const result = await repos.collections.recordPayment({ collectionId: collection.id, paymentId: id, values });
    if (result.error) {
      NotificationService.showError(result.error.message ?? "Failed to record collection.");
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

    const employeeSubconInstall = Number(values.install_tickets) || 0;
    const employeeSubconRepair = Number(values.repair_tickets) || 0;
    const employeeSubconNapRehab = Number(values.nap_rehab_tickets) || 0;
    const subconInstall = values.subcon_items.reduce((sum, item) => sum + (Number(item.install_tickets) || 0), 0);
    const subconRepair = values.subcon_items.reduce((sum, item) => sum + (Number(item.repair_tickets) || 0), 0);
    const subconNapRehab = values.subcon_items.reduce((sum, item) => sum + (Number(item.nap_rehab_tickets) || 0), 0);
    const subconDisputedInstall = values.subcon_items.reduce(
      (sum, item) => sum + Math.max(0, Math.min(Number(item.install_tickets) || 0, Number(item.disputed_install) || 0)),
      0,
    );
    const subconDisputedRepair = values.subcon_items.reduce(
      (sum, item) => sum + Math.max(0, Math.min(Number(item.repair_tickets) || 0, Number(item.disputed_repair) || 0)),
      0,
    );
    const subconDisputedNapRehab = values.subcon_items.reduce(
      (sum, item) => sum + Math.max(0, Math.min(Number(item.nap_rehab_tickets) || 0, Number(item.disputed_nap_rehab) || 0)),
      0,
    );
    const employeeInstall = Math.max(0, employeeSubconInstall - subconInstall);
    const employeeRepair = Math.max(0, employeeSubconRepair - subconRepair);
    const employeeNapRehab = Math.max(0, employeeSubconNapRehab - subconNapRehab);
    // Clamped against the current ticket totals (not just at input time) so a stale
    // disputed count left over from a since-lowered ticket count or a since-changed
    // billing period can never be persisted higher than the tickets it's disputing.
    const employeeDisputedInstall = Math.max(0, Math.min(employeeInstall, Number(values.disputed_install) || 0));
    const employeeDisputedRepair = Math.max(0, Math.min(employeeRepair, Number(values.disputed_repair) || 0));
    const employeeDisputedNapRehab = Math.max(0, Math.min(employeeNapRehab, Number(values.disputed_nap_rehab) || 0));
    const disputedInstall = employeeDisputedInstall + subconDisputedInstall;
    const disputedRepair = employeeDisputedRepair + subconDisputedRepair;
    const disputedNapRehab = employeeDisputedNapRehab + subconDisputedNapRehab;
    const companyInstall = Number(values.company_install_tickets) || 0;
    const companyRepair = Number(values.company_repair_tickets) || 0;
    const companyDisputedInstall = Math.min(companyInstall, Number(values.company_disputed_install) || 0);
    const companyDisputedRepair = Math.min(companyRepair, Number(values.company_disputed_repair) || 0);
    const companyNapRehab = Number(values.company_nap_rehab_tickets) || 0;
    const companyDisputedNapRehab = Math.min(companyNapRehab, Number(values.company_disputed_nap_rehab) || 0);
    const installTickets = employeeSubconInstall + companyInstall;
    const repairTickets = employeeSubconRepair + companyRepair;
    const napRehabTickets = employeeSubconNapRehab + companyNapRehab;
    const totalTickets = installTickets + repairTickets + napRehabTickets;
    const disputedTickets = disputedInstall + disputedRepair + disputedNapRehab + companyDisputedInstall + companyDisputedRepair + companyDisputedNapRehab;
    const billableInstall = Math.max(0, employeeSubconInstall - disputedInstall) + Math.max(0, companyInstall - companyDisputedInstall);
    const billableRepair = Math.max(0, employeeSubconRepair - disputedRepair) + Math.max(0, companyRepair - companyDisputedRepair);
    const billableNapRehab = Math.max(0, employeeSubconNapRehab - disputedNapRehab) + Math.max(0, companyNapRehab - companyDisputedNapRehab);
    const billableTickets = billableInstall + billableRepair + billableNapRehab;
    // Rates and the collections split come from `values`, not live `settings`, so
    // editing an existing record recomputes against the rate/pct that was actually
    // snapshotted onto it at creation -- not whatever billing_settings has been changed
    // to since. `buildInitialValues` seeds these from `initial` on edit, or from live
    // settings when creating a brand-new record.
    const effectiveInstallationRate = Number(values.installation_rate) || 0;
    const effectiveRepairRate = Number(values.repair_rate) || 0;
    const effectiveNapRehabRate = Number(values.nap_rehab_rate) || 0;
    const effectiveCollectionsPct = Number(values.collections_pct) || 0;
    const clientTotals = computeClientBillingTotals(
      [
        {
          install: employeeInstall,
          repair: employeeRepair,
          napRehab: employeeNapRehab,
          disputedInstall: employeeDisputedInstall,
          disputedRepair: employeeDisputedRepair,
          disputedNapRehab: employeeDisputedNapRehab,
        },
        {
          install: subconInstall,
          repair: subconRepair,
          napRehab: subconNapRehab,
          disputedInstall: subconDisputedInstall,
          disputedRepair: subconDisputedRepair,
          disputedNapRehab: subconDisputedNapRehab,
        },
        {
          install: companyInstall,
          repair: companyRepair,
          napRehab: companyNapRehab,
          disputedInstall: companyDisputedInstall,
          disputedRepair: companyDisputedRepair,
          disputedNapRehab: companyDisputedNapRehab,
        },
      ],
      { installation: effectiveInstallationRate, repair: effectiveRepairRate, napRehab: effectiveNapRehabRate },
      effectiveCollectionsPct,
    );
    const billingAmount = clientTotals.billingAmount;
    const collectionsAmount = clientTotals.collectionsAmount;
    const collectiblesAmount = clientTotals.collectiblesAmount;
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
        Number(item.nap_rehab_tickets) || 0,
        Number(item.disputed_nap_rehab) || 0,
        Number(item.nap_rehab_rate) || 0,
      );
      return {
        id: item.id ?? crypto.randomUUID(),
        user_id: userId,
        billing_record_id: ids.billingId,
        subcontractor_id: item.subcontractor_id,
        subcon_name: item.subcon_name,
        install_tickets: Number(item.install_tickets) || 0,
        repair_tickets: Number(item.repair_tickets) || 0,
        nap_rehab_tickets: Number(item.nap_rehab_tickets) || 0,
        disputed_install: Number(item.disputed_install) || 0,
        disputed_repair: Number(item.disputed_repair) || 0,
        disputed_nap_rehab: Number(item.disputed_nap_rehab) || 0,
        installation_rate: Number(item.installation_rate) || 0,
        repair_rate: Number(item.repair_rate) || 0,
        nap_rehab_rate: Number(item.nap_rehab_rate) || 0,
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
      disputed_install: employeeDisputedInstall,
      disputed_repair: employeeDisputedRepair,
      nap_rehab_tickets: napRehabTickets,
      disputed_nap_rehab: employeeDisputedNapRehab,
      company_install_tickets: companyInstall,
      company_repair_tickets: companyRepair,
      company_disputed_install: companyDisputedInstall,
      company_disputed_repair: companyDisputedRepair,
      company_nap_rehab_tickets: companyNapRehab,
      company_disputed_nap_rehab: companyDisputedNapRehab,
      total_tickets: totalTickets,
      disputed_tickets: disputedTickets,
      billable_tickets: billableTickets,
      billing_rate: 0,
      installation_rate: effectiveInstallationRate,
      repair_rate: effectiveRepairRate,
      nap_rehab_rate: effectiveNapRehabRate,
      billing_amount: billingAmount,
      collections_pct: effectiveCollectionsPct,
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
      title: `Billing ${monthNames[month - 1]} ${year} (${periodLabel}) - ${effectiveCollectionsPct}%`,
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
      title: `Billing ${monthNames[month - 1]} ${year} (${periodLabel}) - ${100 - effectiveCollectionsPct}%`,
      client_name: settings!.client_name || "Client",
      external_reference: "",
      issue_date: todayKey(),
      amount: collectiblesAmount,
      due_date: dueDate,
      status: "pending" as const,
      notes: `Auto-created from billing ${monthNames[month - 1]} ${year} (${periodLabel}) - ${100 - effectiveCollectionsPct}% collectible.`,
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
      today: todayKey(),
    });

    return { billingPayload, collectionPayload, collectiblesCollectionPayload, payoutPayloads, advanceUpdates };
  }

  async function persistBillingArtifacts(
    billingPayload: Omit<BillingRecord, "created_at" | "updated_at" | "invoice_no">,
    collectionPayload: Record<string, unknown>,
    collectiblesCollectionPayload: Record<string, unknown>,
    payoutPayloads: Array<Omit<PaymentReminder, "created_at" | "updated_at" | "payments">>,
    advanceUpdates: Array<{ id: string; payload: Pick<SubcontractorAdvance, "balance" | "status"> }>,
    _isUpdate: boolean,
  ) {
    if (!supabase) return { error: { message: "Supabase unavailable." } };
    return supabase.rpc("save_billing_bundle", {
      billing_payload: billingPayload,
      collection_payloads: [collectionPayload, collectiblesCollectionPayload],
      subcon_item_payloads: billingPayload.subcon_items,
      reminder_payloads: payoutPayloads,
      advance_updates: advanceUpdates,
    });
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
      </section>

      {billingRecords.length === 0 ? (
        <div className="billing-empty">
          <FileText size={32} />
          <p>No billing records yet</p>
          <span>Create your first billing to start tracking invoices.</span>
        </div>
      ) : (
        <>
          <div className="billing-table-wrap billing-desktop-table-wrap">
            <table className="billing-table">
              <thead>
                <tr>
                  <th>Invoice No.</th>
                  <th>Period</th>
                  <th className="num">Tickets</th>
                  <th className="num">Disputed</th>
                  <th className="num">Billable</th>
                  <th className="num">Amount</th>
                  <th className="num">Collectibles</th>
                  <th className="num">Collection</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {paginatedBillingRecords.map((record) => {
                  const expanded = expandedRecordId === record.id;
                  const isFullyPaid = isRecordFullyPaid(record);
                  // nap_rehab_* columns may be absent on records cached (IndexedDB) or
                  // fetched before they existed -- coerce so the breakdown spans below
                  // can't render "undefined"/"NaN".
                  const napRehabTickets = Number(record.nap_rehab_tickets) || 0;
                  const disputedNapRehab = Number(record.disputed_nap_rehab) || 0;
                  const companyDisputedNapRehab = Number(record.company_disputed_nap_rehab) || 0;
                  return (
                    <>
                      <tr className="expandable" key={record.id}>
                        <td className="billing-invoice-no" data-label="Invoice No.">{record.invoice_no}</td>
                        <td data-label="Period">
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
                        <td className="num" data-label="Tickets">
                          <div className="billing-cell-breakdown">
                            <strong>{record.total_tickets}</strong>
                            <span>I:{record.install_tickets} R:{record.repair_tickets} N:{napRehabTickets}</span>
                          </div>
                        </td>
                        <td className="num" data-label="Disputed">
                          <div className="billing-cell-breakdown">
                            <strong>{record.disputed_tickets}</strong>
                            <span>I:{record.disputed_install + record.company_disputed_install} R:{record.disputed_repair + record.company_disputed_repair} N:{disputedNapRehab + companyDisputedNapRehab}</span>
                          </div>
                        </td>
                        <td className="num" data-label="Billable">
                          <div className="billing-cell-breakdown">
                            <strong>{record.billable_tickets}</strong>
                            <span>
                              I:{Math.max(0, record.install_tickets - record.disputed_install - record.company_disputed_install)} R:{Math.max(0, record.repair_tickets - record.disputed_repair - record.company_disputed_repair)} N:{Math.max(0, napRehabTickets - disputedNapRehab - companyDisputedNapRehab)}
                            </span>
                          </div>
                        </td>
                        <td className="num" data-label="Amount">{currency.format(record.billing_amount)}</td>
                        <td className="num" data-label="Collectibles">{currency.format(record.collectibles_amount)}</td>
                        <td className="num" data-label="Collection">{currency.format(record.collections_amount)}</td>
                        <td data-label="Status">
                          <span className={`collection-status ${isFullyPaid ? "collected" : "pending"}`}>
                            {isFullyPaid ? "Paid" : "Unpaid"}
                          </span>
                        </td>
                        <td data-label="Action">
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
                                    const itemPayments = paymentsByItemId.get(item.id) ?? [];
                                    return (
                                      <tr key={item.id}>
                                        <td className="subcon-detail-name" data-label="Subcontractor">{item.subcon_name}</td>
                                        <td className="num" data-label="Tickets">{item.install_tickets + item.repair_tickets + (item.nap_rehab_tickets ?? 0)}</td>
                                        <td className="num" data-label="Gross">{currency.format(item.billing_amount)}</td>
                                        <td className="num" data-label="Net payable"><strong>{currency.format(item.payable_amount)}</strong></td>
                                        <td data-label="Payout">
                                          {itemPayments.length === 0 ? (
                                            <span className="subcon-missing-payment">Missing payout</span>
                                          ) : (
                                            <div className="billing-subcon-status-group">
                                              {itemPayments.map((payment) => (
                                                <button
                                                  className={`billing-payout-status billing-subcon-status-link ${payment.status}`}
                                                  key={payment.id}
                                                  onClick={() => onOpenSubcontractorAccount(item.subcontractor_id)}
                                                  type="button"
                                                >
                                                  {payment.payout_leg === "remainder" ? "2nd: " : "1st: "}{payment.status}
                                                </button>
                                              ))}
                                            </div>
                                          )}
                                        </td>
                                        <td data-label="Action">
                                          <div className="billing-row-actions">
                                            <button onClick={() => onOpenSubcontractorAccount(item.subcontractor_id)} type="button">
                                              View account
                                            </button>
                                            {itemPayments.filter((payment) => payment.status === "pending").map((payment) => (
                                              <button key={payment.id} onClick={() => void markPayoutPaid(payment, userId, onChange)} type="button">
                                                {payment.payout_leg === "remainder" ? "Mark 2nd paid" : "Mark paid"}
                                              </button>
                                            ))}
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
          <BillingMobileCardList
            isRecordFullyPaid={isRecordFullyPaid}
            onDelete={(record) => void removeBilling(record)}
            onEdit={setEditingRecord}
            onViewDetails={setDetailsRecord}
            records={paginatedBillingRecords}
          />
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

function BillingMobileCardList({
  isRecordFullyPaid,
  onDelete,
  onEdit,
  onViewDetails,
  records,
}: {
  isRecordFullyPaid: (record: BillingRecord) => boolean;
  onDelete: (record: BillingRecord) => void;
  onEdit: (record: BillingRecord) => void;
  onViewDetails: (record: BillingRecord) => void;
  records: BillingRecord[];
}) {
  const [openMenuId, setOpenMenuId] = useState("");
  const [menuOpensUp, setMenuOpensUp] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenuId) return;
    function handleClick(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpenMenuId("");
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openMenuId]);

  useLayoutEffect(() => {
    if (!openMenuId) {
      setMenuOpensUp(false);
      return;
    }
    const dropdown = menuRef.current?.querySelector<HTMLElement>(".ticket-menu-dropdown");
    if (!dropdown) return;
    setMenuOpensUp(dropdown.getBoundingClientRect().bottom > window.innerHeight);
  }, [openMenuId]);

  if (records.length === 0) return null;

  return (
    <div className="billing-mobile-list">
      {records.map((record) => {
        const isFullyPaid = isRecordFullyPaid(record);
        return (
          <div className="billing-mobile-card" key={record.id}>
            <div
              className="billing-mobile-tap"
              onClick={() => onViewDetails(record)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onViewDetails(record);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <div className="employee-list-avatar">
                <FileText size={18} />
              </div>
              <div className="billing-mobile-main">
                <div className="billing-mobile-title-row">
                  <strong>{record.invoice_no}</strong>
                  <span className={`collection-status ${isFullyPaid ? "collected" : "pending"}`}>
                    {isFullyPaid ? "Paid" : "Unpaid"}
                  </span>
                </div>
                <span className="billing-mobile-subtitle">
                  {monthNames[record.billing_month - 1]} {record.billing_year} · {billingPeriodLabel(record.billing_period)}
                </span>
                <span className="billing-mobile-meta">
                  {record.total_tickets} tickets · {record.disputed_tickets} disputed · {record.billable_tickets} billable
                </span>
              </div>
              <div className="billing-mobile-side">
                <strong>{currency.format(record.billing_amount)}</strong>
                <small>Collectibles {currency.format(record.collectibles_amount)}</small>
              </div>
            </div>
            <div className="ticket-menu-wrap billing-mobile-kebab-wrap" ref={openMenuId === record.id ? menuRef : undefined}>
              <button
                aria-label="More actions"
                className="expense-mobile-kebab"
                onClick={() => setOpenMenuId((prev) => prev === record.id ? "" : record.id)}
                type="button"
              >
                <MoreVertical size={16} />
              </button>
              {openMenuId === record.id && (
                <div className={`ticket-menu-dropdown${menuOpensUp ? " ticket-menu-dropdown--up" : ""}`}>
                  <button onClick={() => { onViewDetails(record); setOpenMenuId(""); }} type="button">
                    <Eye size={14} /> View details
                  </button>
                  <button onClick={() => { onEdit(record); setOpenMenuId(""); }} type="button">
                    <Pencil size={14} /> Edit
                  </button>
                  <button onClick={() => { onDelete(record); setOpenMenuId(""); }} type="button">
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
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
  const { backdropProps, dialogProps } = useDialog({ label: `Billing details ${record.invoice_no ?? ""}`.trim(), onClose });
  // Use the rate actually snapshotted onto this record, not live settings -- otherwise
  // viewing an old record's details after rates have changed would show a gross total
  // that doesn't match what was actually billed. Records saved before the snapshot
  // existed fall back to live settings (best available approximation). Checked with
  // `!= null` (not `||`) so a legitimately-saved 0 rate isn't mistaken for "unset".
  const employeeRows = employeeTicketRowsForPeriod(
    dailyTicketEntries,
    {
      installation: record.installation_rate != null ? record.installation_rate : settings.installation_rate,
      repair: record.repair_rate != null ? record.repair_rate : settings.repair_rate,
      napRehab: record.nap_rehab_rate != null ? record.nap_rehab_rate : settings.nap_rehab_rate,
    },
    record.billing_month,
    record.billing_year,
    record.billing_period,
  );
  const employeeTotals = employeeRows.reduce(
    (sum, row) => ({
      install: sum.install + row.install,
      repair: sum.repair + row.repair,
      napRehab: sum.napRehab + row.napRehab,
      tickets: sum.tickets + row.install + row.repair + row.napRehab,
      gross: sum.gross + row.gross,
    }),
    { install: 0, repair: 0, napRehab: 0, tickets: 0, gross: 0 },
  );
  const subconTotals = record.subcon_items.reduce(
    (sum, item) => ({
      install: sum.install + item.install_tickets,
      repair: sum.repair + item.repair_tickets,
      napRehab: sum.napRehab + (item.nap_rehab_tickets ?? 0),
      disputedInstall: sum.disputedInstall + item.disputed_install,
      disputedRepair: sum.disputedRepair + item.disputed_repair,
      disputedNapRehab: sum.disputedNapRehab + (item.disputed_nap_rehab ?? 0),
      billableTickets: sum.billableTickets + item.billable_tickets,
      gross: sum.gross + item.billing_amount,
      payable: sum.payable + item.payable_amount,
    }),
    { install: 0, repair: 0, napRehab: 0, disputedInstall: 0, disputedRepair: 0, disputedNapRehab: 0, billableTickets: 0, gross: 0, payable: 0 },
  );
  const paymentsByItemId = new Map<string, PaymentReminder[]>();
  payments
    .filter((payment) => payment.type === "subcontractor" && payment.billing_subcon_item_id)
    .forEach((payment) => {
      const list = paymentsByItemId.get(payment.billing_subcon_item_id!) ?? [];
      list.push(payment);
      paymentsByItemId.set(payment.billing_subcon_item_id!, list);
    });
  // nap_rehab_* columns may be absent on records cached (IndexedDB) or fetched before
  // they existed -- coerce so the dispute badge/totals below can't go NaN.
  const disputedNapRehab = Number(record.disputed_nap_rehab) || 0;
  const companyDisputedNapRehab = Number(record.company_disputed_nap_rehab) || 0;
  const billingLevelDisputes = record.disputed_install + record.disputed_repair + disputedNapRehab;
  const companyDisputes = record.company_disputed_install + record.company_disputed_repair + companyDisputedNapRehab;
  const subcontractorDisputes = subconTotals.disputedInstall + subconTotals.disputedRepair + subconTotals.disputedNapRehab;

  return (
    <div className="modal-backdrop" {...backdropProps}>
      <div className="modal billing-details-modal" {...dialogProps}>
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
                  <col style={{ width: "34%" }} />
                  <col style={{ width: "13%" }} />
                  <col style={{ width: "13%" }} />
                  <col style={{ width: "13%" }} />
                  <col style={{ width: "13%" }} />
                  <col style={{ width: "14%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th className="num">Install</th>
                    <th className="num">Repair</th>
                    <th className="num">Nap Rehab</th>
                    <th className="num">Total</th>
                    <th className="num">Gross</th>
                  </tr>
                </thead>
                <tbody>
                  {employeeRows.length === 0 ? (
                    <tr><td className="collection-empty" colSpan={6}>No employee ticket entries for this period.</td></tr>
                  ) : employeeRows.map((row) => (
                    <tr key={row.employeeId}>
                      <td data-label="Employee">{row.employeeName}</td>
                      <td className="num" data-label="Install">{row.install}</td>
                      <td className="num" data-label="Repair">{row.repair}</td>
                      <td className="num" data-label="Nap Rehab">{row.napRehab}</td>
                      <td className="num" data-label="Total">{row.install + row.repair + row.napRehab}</td>
                      <td className="num" data-label="Gross">{currency.format(row.gross)}</td>
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
                    <th className="num">1st Payout</th>
                    <th className="num">2nd Payout</th>
                    <th>Payout Status</th>
                  </tr>
                </thead>
                <tbody>
                  {record.subcon_items.length === 0 ? (
                    <tr><td className="collection-empty" colSpan={7}>No subcontractor rows for this billing.</td></tr>
                  ) : record.subcon_items.map((item) => {
                    const itemPayments = paymentsByItemId.get(item.id) ?? [];
                    return (
                      <tr key={item.id}>
                        <td data-label="Subcontractor">{item.subcon_name}</td>
                        <td className="num" data-label="Tickets">{item.install_tickets + item.repair_tickets + (item.nap_rehab_tickets ?? 0)} <span>I:{item.install_tickets} R:{item.repair_tickets} N:{item.nap_rehab_tickets ?? 0}</span></td>
                        <td className="num" data-label="Disputed">{item.disputed_install + item.disputed_repair} <span>I:{item.disputed_install} R:{item.disputed_repair}</span></td>
                        <td className="num" data-label="Billable">{item.billable_tickets}</td>
                        <td className="num" data-label="Gross">{currency.format(item.billing_amount)}</td>
                        <td className="num" data-label="1st Payout">{currency.format(item.payable_amount)}</td>
                        <td className="num" data-label="2nd Payout">{currency.format(item.collection_amount)}</td>
                        <td data-label="Payout Status">
                          {itemPayments.length === 0 ? (
                            <span className="billing-payout-status missing">Missing payout</span>
                          ) : (
                            itemPayments.map((payment) => (
                              <div key={payment.id}>
                                <span className={`billing-payout-status ${payment.status}`}>
                                  {payment.payout_leg === "remainder" ? "2nd: " : "1st: "}{payment.status}
                                </span>
                                <span className="billing-payout-amount">{currency.format(payment.amount)}</span>
                              </div>
                            ))
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className={`billing-details-section billing-details-disputes${billingLevelDisputes + companyDisputes + subcontractorDisputes === 0 ? " clear" : ""}`}>
            <div className="billing-details-section-head">
              <div>
                <h4>Dispute Details</h4>
                <p>Billing-level disputes are stored as totals. Subcontractor disputes are stored per subcontractor row.</p>
              </div>
              {billingLevelDisputes + companyDisputes + subcontractorDisputes === 0 ? (
                <strong className="billing-details-dispute-badge clear">
                  <CheckCircle2 size={14} /> No disputes
                </strong>
              ) : (
                <strong className="billing-details-dispute-badge">{billingLevelDisputes + companyDisputes + subcontractorDisputes} disputed</strong>
              )}
            </div>
            <div className="billing-details-summary compact">
              <div><span>Billing-level install disputes</span><strong>{record.disputed_install}</strong></div>
              <div><span>Billing-level repair disputes</span><strong>{record.disputed_repair}</strong></div>
              <div><span>Billing-level Nap Rehab disputes</span><strong>{disputedNapRehab}</strong></div>
              <div><span>Company install disputes</span><strong>{record.company_disputed_install}</strong></div>
              <div><span>Company repair disputes</span><strong>{record.company_disputed_repair}</strong></div>
              <div><span>Company Nap Rehab disputes</span><strong>{companyDisputedNapRehab}</strong></div>
              <div><span>Subcon install disputes</span><strong>{subconTotals.disputedInstall}</strong></div>
              <div><span>Subcon repair disputes</span><strong>{subconTotals.disputedRepair}</strong></div>
              <div><span>Subcon Nap Rehab disputes</span><strong>{subconTotals.disputedNapRehab}</strong></div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function employeeTicketRowsForPeriod(
  dailyTicketEntries: DailyTicketEntry[],
  rates: { installation: number; repair: number; napRehab: number },
  month: number,
  year: number,
  period: BillingRecord["billing_period"],
) {
  const rows = new Map<string, { employeeId: string; employeeName: string; install: number; repair: number; napRehab: number; gross: number }>();
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
    // Nap Rehab has no per-entry disputed_* column (disputes for it only exist at the
    // billing level, same as clampedBillableByType in domain/billing.ts), so it's never
    // reduced here.
    const rawNapRehab = details.length > 0
      ? details.filter((detail) => detail.ticket_type === "nap_rehab").reduce((sum, detail) => sum + detail.ticket_count, 0)
      : Number(entry.nap_rehab_tickets) || 0;
    const install = Math.max(0, rawInstall - Math.min(rawInstall, entry.disputed_install ?? 0));
    const repair = Math.max(0, rawRepair - Math.min(rawRepair, entry.disputed_repair ?? 0));
    const napRehab = Math.max(0, rawNapRehab);
    const current = rows.get(entry.employee_id) ?? {
      employeeId: entry.employee_id,
      employeeName: entry.employee_name,
      install: 0,
      repair: 0,
      napRehab: 0,
      gross: 0,
    };
    current.install += install;
    current.repair += repair;
    current.napRehab += napRehab;
    current.gross += install * rates.installation + repair * rates.repair + napRehab * rates.napRehab;
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
  const { backdropProps, dialogProps } = useDialog({ label: "Record collection", onClose });

  return (
    <div className="modal-backdrop" {...backdropProps}>
      <div className="modal billing-form-modal" {...dialogProps} style={{ maxWidth: 440 }}>
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

type BillingWizardStep = 1 | 2 | 3 | 4 | 5;

const WIZARD_STEPS: Array<{ id: BillingWizardStep; label: string }> = [
  { id: 1, label: "Billing Details" },
  { id: 2, label: "Employee Tickets" },
  { id: 3, label: "Subcontractors" },
  { id: 4, label: "Company & Disputes" },
  { id: 5, label: "Billable Summary" },
];

const WIZARD_STEP_DESCRIPTIONS: Record<BillingWizardStep, string> = {
  1: "Choose the coverage period and payment due date.",
  2: "Confirm employee work included in this billing cycle.",
  3: "Review subcontractor tickets, disputes, and payout amounts.",
  4: "Review company ticket sources and disputed work.",
  5: "Check the final client statement before creating the billing.",
};

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
  const { backdropProps, dialogProps } = useDialog({ labelledBy: "billing-modal-title", onClose });
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
          nap_rehab_rate: item.nap_rehab_rate ?? 0,
          payable_pct: item.payable_pct,
          status: "archived",
          email: "",
          contact_number: "",
          address: "",
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
          nap_rehab_tickets: String(existing?.nap_rehab_tickets ?? counts.napRehab),
          disputed_install: String(existing?.disputed_install ?? 0),
          disputed_repair: String(existing?.disputed_repair ?? 0),
          disputed_nap_rehab: String(existing?.disputed_nap_rehab ?? 0),
          installation_rate: String(existing?.installation_rate ?? subcontractor.installation_rate),
          repair_rate: String(existing?.repair_rate ?? subcontractor.repair_rate),
          nap_rehab_rate: String(existing?.nap_rehab_rate ?? subcontractor.nap_rehab_rate ?? 0),
          payable_pct: String(existing?.payable_pct ?? subcontractor.payable_pct),
        };
      });
  }

  function buildInitialValues(): BillingFormValues {
    if (initial) {
      // initial may come from an offline cache snapshot written before the company_*
      // columns existed, in which case they're missing entirely (undefined, not 0) --
      // guard with toNumber() so editing a stale cached record can't corrupt the form
      // with "NaN"/"undefined" instead of silently falling back to 0.
      const initialCompanyInstall = toNumber(initial.company_install_tickets);
      const initialCompanyRepair = toNumber(initial.company_repair_tickets);
      const initialCompanyNapRehab = toNumber(initial.company_nap_rehab_tickets);
      const initialSubconItems = buildSubconItems(initial.billing_month, initial.billing_year, initial.billing_period);
      return {
        billing_month: String(initial.billing_month),
        billing_year: String(initial.billing_year),
        billing_period: initial.billing_period,
        install_tickets: String(toNumber(initial.install_tickets) - initialCompanyInstall),
        repair_tickets: String(toNumber(initial.repair_tickets) - initialCompanyRepair),
        disputed_install: String(toNumber(initial.disputed_install)),
        disputed_repair: String(toNumber(initial.disputed_repair)),
        nap_rehab_tickets: String(toNumber(initial.nap_rehab_tickets) - initialCompanyNapRehab),
        disputed_nap_rehab: String(toNumber(initial.disputed_nap_rehab)),
        company_install_tickets: String(initialCompanyInstall),
        company_repair_tickets: String(initialCompanyRepair),
        company_disputed_install: String(toNumber(initial.company_disputed_install)),
        company_disputed_repair: String(toNumber(initial.company_disputed_repair)),
        company_nap_rehab_tickets: String(initialCompanyNapRehab),
        company_disputed_nap_rehab: String(toNumber(initial.company_disputed_nap_rehab)),
        // Reuse the rate/pct actually snapshotted onto this record at save time, not
        // live settings -- otherwise editing an old record (even for an unrelated
        // ticket-count fix) would silently reprice it at today's rate. Records saved
        // before this snapshot existed fall back to live settings, the best available
        // approximation for those (there's no way to recover their true original rate).
        // Must check `!= null` BEFORE coercing -- a `|| settings.X` fallback on the
        // already-coerced number would also swallow a legitimately-saved 0 (e.g. a
        // business that doesn't charge for Nap Rehab), silently repricing it too.
        installation_rate: String(initial.installation_rate != null ? initial.installation_rate : settings.installation_rate),
        repair_rate: String(initial.repair_rate != null ? initial.repair_rate : settings.repair_rate),
        nap_rehab_rate: String(initial.nap_rehab_rate != null ? initial.nap_rehab_rate : settings.nap_rehab_rate),
        collections_pct: String(initial.collections_pct != null ? initial.collections_pct : settings.collections_pct),
        due_date: initial.due_date ?? "",
        subcon_items: initialSubconItems,
        notes: initial.notes,
      };
    }
    const month = Number(currentMonth());
    const year = Number(currentYear());
    const employeeCounts = countTicketsByType(dailyTicketEntries, month, year, defaultPeriod);
    const subconItems = buildSubconItems(month, year, defaultPeriod);
    const subconInstall = subconItems.reduce((sum, item) => sum + (Number(item.install_tickets) || 0), 0);
    const subconRepair = subconItems.reduce((sum, item) => sum + (Number(item.repair_tickets) || 0), 0);
    const subconNapRehab = subconItems.reduce((sum, item) => sum + (Number(item.nap_rehab_tickets) || 0), 0);
    return {
      billing_month: String(month),
      billing_year: String(year),
      billing_period: defaultPeriod,
      install_tickets: String(employeeCounts.installation + subconInstall),
      repair_tickets: String(employeeCounts.repair + subconRepair),
      disputed_install: "0",
      disputed_repair: "0",
      nap_rehab_tickets: String(employeeCounts.nap_rehab + subconNapRehab),
      disputed_nap_rehab: "0",
      company_install_tickets: "0",
      company_repair_tickets: "0",
      company_disputed_install: "0",
      company_disputed_repair: "0",
      company_nap_rehab_tickets: "0",
      company_disputed_nap_rehab: "0",
      installation_rate: String(settings.installation_rate),
      repair_rate: String(settings.repair_rate),
      nap_rehab_rate: String(settings.nap_rehab_rate),
      collections_pct: String(settings.collections_pct),
      due_date: addDays(todayKey(), 15),
      subcon_items: subconItems,
      notes: "",
    };
  }

  const [values, setValues] = useState<BillingFormValues>(buildInitialValues);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ActionProgressState | null>(null);
  const [step, setStep] = useState<BillingWizardStep>(1);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

  function formatStatementDate(dateKey: string) {
    const [year, month, day] = dateKey.slice(0, 10).split("-").map(Number);
    if (!year || !month || !day) return "—";
    return `${monthNames[month - 1]} ${day}, ${year}`;
  }

  useEffect(() => {
    if (initial) return;
    const month = Number(values.billing_month);
    const year = Number(values.billing_year);
    const employeeCounts = countTicketsByType(dailyTicketEntries, month, year, values.billing_period);
    const subconItems = buildSubconItems(month, year, values.billing_period);
    const subconInstall = subconItems.reduce((sum, item) => sum + (Number(item.install_tickets) || 0), 0);
    const subconRepair = subconItems.reduce((sum, item) => sum + (Number(item.repair_tickets) || 0), 0);
    const subconNapRehab = subconItems.reduce((sum, item) => sum + (Number(item.nap_rehab_tickets) || 0), 0);
    setValues((current) => ({
      ...current,
      install_tickets: String(employeeCounts.installation + subconInstall),
      repair_tickets: String(employeeCounts.repair + subconRepair),
      nap_rehab_tickets: String(employeeCounts.nap_rehab + subconNapRehab),
      subcon_items: subconItems,
    }));
  }, [dailyTicketEntries, initial, subconDailyTickets, subcontractors, values.billing_month, values.billing_period, values.billing_year]);

  // Reuse the rate/pct snapshotted onto `values` (by buildInitialValues, from `initial`
  // on edit or live settings on create) rather than reading live `settings` directly, so
  // the preview always matches exactly what buildArtifacts will save.
  const effectiveInstallationRate = Number(values.installation_rate) || 0;
  const effectiveRepairRate = Number(values.repair_rate) || 0;
  const effectiveNapRehabRate = Number(values.nap_rehab_rate) || 0;
  const effectiveCollectionsPct = Number(values.collections_pct) || 0;
  const employeeCounts = countTicketsByType(
    dailyTicketEntries,
    Number(values.billing_month),
    Number(values.billing_year),
    values.billing_period,
  );
  const employeeRows = employeeTicketRowsForPeriod(
    dailyTicketEntries,
    { installation: effectiveInstallationRate, repair: effectiveRepairRate, napRehab: effectiveNapRehabRate },
    Number(values.billing_month),
    Number(values.billing_year),
    values.billing_period,
  );
  const employeeTotals = employeeRows.reduce(
    (sum, row) => ({
      install: sum.install + row.install,
      repair: sum.repair + row.repair,
      napRehab: sum.napRehab + row.napRehab,
      tickets: sum.tickets + row.install + row.repair + row.napRehab,
      gross: sum.gross + row.gross,
    }),
    { install: 0, repair: 0, napRehab: 0, tickets: 0, gross: 0 },
  );
  const subconInstall = values.subcon_items.reduce((sum, item) => sum + (Number(item.install_tickets) || 0), 0);
  const subconRepair = values.subcon_items.reduce((sum, item) => sum + (Number(item.repair_tickets) || 0), 0);
  const subconNapRehab = values.subcon_items.reduce((sum, item) => sum + (Number(item.nap_rehab_tickets) || 0), 0);
  const subconDisputedInstall = values.subcon_items.reduce(
    (sum, item) => sum + Math.max(0, Math.min(Number(item.install_tickets) || 0, Number(item.disputed_install) || 0)),
    0,
  );
  const subconDisputedRepair = values.subcon_items.reduce(
    (sum, item) => sum + Math.max(0, Math.min(Number(item.repair_tickets) || 0, Number(item.disputed_repair) || 0)),
    0,
  );
  const subconDisputedNapRehab = values.subcon_items.reduce(
    (sum, item) => sum + Math.max(0, Math.min(Number(item.nap_rehab_tickets) || 0, Number(item.disputed_nap_rehab) || 0)),
    0,
  );
  const installTickets = Math.max(0, Number(values.install_tickets) || 0);
  const repairTickets = Math.max(0, Number(values.repair_tickets) || 0);
  const napRehabTickets = Math.max(0, Number(values.nap_rehab_tickets) || 0);
  const employeeInstallTickets = Math.max(0, installTickets - subconInstall);
  const employeeRepairTickets = Math.max(0, repairTickets - subconRepair);
  const employeeNapRehabTickets = Math.max(0, napRehabTickets - subconNapRehab);
  const employeeDisputedInstall = Math.max(0, Math.min(employeeInstallTickets, Number(values.disputed_install) || 0));
  const employeeDisputedRepair = Math.max(0, Math.min(employeeRepairTickets, Number(values.disputed_repair) || 0));
  const employeeDisputedNapRehab = Math.max(0, Math.min(employeeNapRehabTickets, Number(values.disputed_nap_rehab) || 0));
  const disputedInstall = employeeDisputedInstall + subconDisputedInstall;
  const disputedRepair = employeeDisputedRepair + subconDisputedRepair;
  const disputedNapRehab = employeeDisputedNapRehab + subconDisputedNapRehab;
  const companyInstallTickets = Math.max(0, Number(values.company_install_tickets) || 0);
  const companyRepairTickets = Math.max(0, Number(values.company_repair_tickets) || 0);
  const companyDisputedInstall = Math.min(companyInstallTickets, Number(values.company_disputed_install) || 0);
  const companyDisputedRepair = Math.min(companyRepairTickets, Number(values.company_disputed_repair) || 0);
  const companyNapRehabTickets = Math.max(0, Number(values.company_nap_rehab_tickets) || 0);
  const companyDisputedNapRehab = Math.min(companyNapRehabTickets, Number(values.company_disputed_nap_rehab) || 0);
  const combinedInstallTickets = installTickets + companyInstallTickets;
  const combinedRepairTickets = repairTickets + companyRepairTickets;
  const combinedNapRehabTickets = napRehabTickets + companyNapRehabTickets;
  const employeeDisplayInstall = Math.max(0, employeeTotals.install - employeeDisputedInstall);
  const employeeDisplayRepair = Math.max(0, employeeTotals.repair - employeeDisputedRepair);
  const employeeDisplayNapRehab = Math.max(0, employeeTotals.napRehab - employeeDisputedNapRehab);
  const employeeDisplayTickets = employeeDisplayInstall + employeeDisplayRepair + employeeDisplayNapRehab;
  const employeeDisplayGross = employeeDisplayInstall * effectiveInstallationRate + employeeDisplayRepair * effectiveRepairRate + employeeDisplayNapRehab * effectiveNapRehabRate;
  const billableInstall = (installTickets - disputedInstall) + (companyInstallTickets - companyDisputedInstall);
  const billableRepair = (repairTickets - disputedRepair) + (companyRepairTickets - companyDisputedRepair);
  const billableNapRehab = (napRehabTickets - disputedNapRehab) + (companyNapRehabTickets - companyDisputedNapRehab);
  const billableTickets = billableInstall + billableRepair + billableNapRehab;
  const clientTotals = computeClientBillingTotals(
    [
      {
        install: employeeInstallTickets,
        repair: employeeRepairTickets,
        napRehab: employeeNapRehabTickets,
        disputedInstall: employeeDisputedInstall,
        disputedRepair: employeeDisputedRepair,
        disputedNapRehab: employeeDisputedNapRehab,
      },
      {
        install: subconInstall,
        repair: subconRepair,
        napRehab: subconNapRehab,
        disputedInstall: subconDisputedInstall,
        disputedRepair: subconDisputedRepair,
        disputedNapRehab: subconDisputedNapRehab,
      },
      {
        install: companyInstallTickets,
        repair: companyRepairTickets,
        napRehab: companyNapRehabTickets,
        disputedInstall: companyDisputedInstall,
        disputedRepair: companyDisputedRepair,
        disputedNapRehab: companyDisputedNapRehab,
      },
    ],
    { installation: effectiveInstallationRate, repair: effectiveRepairRate, napRehab: effectiveNapRehabRate },
    effectiveCollectionsPct,
  );
  const billingAmount = clientTotals.billingAmount;
  const collectionsAmount = clientTotals.collectionsAmount;
  const collectiblesAmount = clientTotals.collectiblesAmount;
  const totalSubconNet = values.subcon_items.reduce((sum, item) => {
    const computed = computeSubconItem(
      Number(item.install_tickets) || 0,
      Number(item.repair_tickets) || 0,
      Number(item.disputed_install) || 0,
      Number(item.disputed_repair) || 0,
      Number(item.installation_rate) || 0,
      Number(item.repair_rate) || 0,
      Number(item.payable_pct) || 0,
      Number(item.nap_rehab_tickets) || 0,
      Number(item.disputed_nap_rehab) || 0,
      Number(item.nap_rehab_rate) || 0,
    );
    return sum + computed.payableAmount;
  }, 0);

  function updateSubconItem(index: number, patch: Partial<BillingFormValues["subcon_items"][number]>) {
    setValues((current) => ({
      ...current,
      subcon_items: current.subcon_items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    }));
  }

  const statementDate = formatStatementDate(initial ? initial.created_at : todayKey());
  const statementPeriodLabel = `${billingPeriodLabel(values.billing_period)}, ${monthNames[Number(values.billing_month) - 1]} ${values.billing_year}`;

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
    <div className="modal-backdrop" {...backdropProps}>
      <div
        className="modal cbf-modal cbf-modal--compact"
        {...dialogProps}
      >
        <div className="cbf-header">
          <div className="cbf-header-main">
            <span className="cbf-header-icon" aria-hidden="true"><ReceiptText size={20} /></span>
            <div>
              <div className="cbf-title-row">
                <h3 className="cbf-title" id="billing-modal-title">{initial ? "Edit billing" : "Create billing"}</h3>
                <span className="cbf-status-pill">{initial ? "Editing" : "Draft"}</span>
              </div>
              <p className="cbf-eyebrow">Semi-monthly invoice - Step {step} of {WIZARD_STEPS.length}</p>
            </div>
          </div>
          <button ref={closeButtonRef} className="cbf-close-btn" onClick={onClose} type="button" aria-label="Close billing modal"><X size={18} /></button>
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
          <div className="cbf-stepper">
            {WIZARD_STEPS.map((wizardStep) => (
              <button
                aria-current={step === wizardStep.id ? "step" : undefined}
                className={`cbf-step${step === wizardStep.id ? " cbf-step--active" : ""}${step > wizardStep.id ? " cbf-step--done" : ""}`}
                disabled={busy}
                key={wizardStep.id}
                onClick={() => setStep(wizardStep.id)}
                type="button"
              >
                <span className="cbf-step-line" />
                <span className="cbf-step-circle">{step > wizardStep.id ? <CheckCircle2 size={16} /> : wizardStep.id}</span>
                <span className="cbf-step-label">{wizardStep.label}</span>
              </button>
            ))}
          </div>

          <div className="cbf-step-intro">
            <div>
              <span className="cbf-step-kicker">Step {step} of {WIZARD_STEPS.length}</span>
              <h4>{WIZARD_STEPS[step - 1].label}</h4>
              <p>{WIZARD_STEP_DESCRIPTIONS[step]}</p>
            </div>
            <div className="cbf-period-chip">
              <CalendarDays size={15} />
              <span>{monthNames[Number(values.billing_month) - 1]} {values.billing_year}</span>
              <small>{billingPeriodLabel(values.billing_period)}</small>
            </div>
          </div>

          {step === 1 && (
            <div className="cbf-step-panel">
              <div className="cbf-step-panel--narrow">
                <section className="cbf-section cbf-section-card">
                  <div className="cbf-section-heading">
                    <p className="cbf-section-label">
                      Billing Period
                      {initial && <span className="cbf-section-sub">locked — delete and recreate to change</span>}
                    </p>
                  </div>
                  <div className="cbf-period-row">
                    <select
                      className="cbf-select"
                      disabled={Boolean(initial)}
                      value={values.billing_month}
                      onChange={(event) => setValues({ ...values, billing_month: event.target.value })}
                    >
                      {monthNames.map((name, index) => <option key={name} value={String(index + 1)}>{name}</option>)}
                    </select>
                    <input
                      className="cbf-input cbf-year-input"
                      disabled={Boolean(initial)}
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
                      disabled={Boolean(initial)}
                      onClick={() => setValues({ ...values, billing_period: "first_half" })}
                      type="button"
                    >
                      1st - 15th
                    </button>
                    <button
                      className={values.billing_period === "second_half" ? "cbf-half-btn cbf-half-btn--active" : "cbf-half-btn"}
                      disabled={Boolean(initial)}
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
                  <label className="cbf-section-label cbf-notes-label">
                    Notes <span className="cbf-optional-pill">Optional</span>
                    <textarea className="cbf-textarea" rows={2} value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} />
                  </label>
                </section>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="cbf-step-panel">
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
                      <col className="col-employee" />
                      <col className="col-ins" />
                      <col className="col-rep" />
                      <col className="col-nap" />
                      <col className="col-tot" />
                      <col className="col-gross" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th className="billing-col-center"><span className="tbl-label-full">Install</span><span className="tbl-label-abbr">Ins</span></th>
                        <th className="billing-col-center"><span className="tbl-label-full">Repair</span><span className="tbl-label-abbr">Rep</span></th>
                        <th className="billing-col-center"><span className="tbl-label-full">Nap Rehab</span><span className="tbl-label-abbr">NR</span></th>
                        <th className="billing-col-center"><span className="tbl-label-full">Total</span><span className="tbl-label-abbr">Tot</span></th>
                        <th className="billing-col-right">Gross</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employeeRows.length === 0 ? (
                        <tr><td className="collection-empty" colSpan={6}>No employee ticket entries for this period.</td></tr>
                      ) : employeeRows.map((row) => (
                        <tr key={row.employeeId}>
                          <td className="billing-col-left" data-label="Employee">{row.employeeName}</td>
                          <td className="billing-col-center" data-label="Install">{row.install}</td>
                          <td className="billing-col-center" data-label="Repair">{row.repair}</td>
                          <td className="billing-col-center" data-label="Nap Rehab">{row.napRehab}</td>
                          <td className="billing-col-center" data-label="Total">{row.install + row.repair + row.napRehab}</td>
                          <td className="billing-col-right" data-label="Gross">{currency.format(row.gross)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="cbf-employee-disputes">
                  <div>
                    <strong>Employee disputes</strong>
                    <span>Only tickets rejected by the client</span>
                  </div>
                  <label>
                    <span>Install</span>
                    <input
                      disabled={employeeInstallTickets === 0}
                      max={employeeInstallTickets}
                      min="0"
                      onChange={(event) => setValues({ ...values, disputed_install: String(Math.max(0, Math.min(employeeInstallTickets, Number(event.target.value) || 0))) })}
                      type="number"
                      value={String(employeeDisputedInstall)}
                    />
                  </label>
                  <label>
                    <span>Repair</span>
                    <input
                      disabled={employeeRepairTickets === 0}
                      max={employeeRepairTickets}
                      min="0"
                      onChange={(event) => setValues({ ...values, disputed_repair: String(Math.max(0, Math.min(employeeRepairTickets, Number(event.target.value) || 0))) })}
                      type="number"
                      value={String(employeeDisputedRepair)}
                    />
                  </label>
                  <label>
                    <span>Nap Rehab</span>
                    <input
                      disabled={employeeNapRehabTickets === 0}
                      max={employeeNapRehabTickets}
                      min="0"
                      onChange={(event) => setValues({ ...values, disputed_nap_rehab: String(Math.max(0, Math.min(employeeNapRehabTickets, Number(event.target.value) || 0))) })}
                      type="number"
                      value={String(employeeDisputedNapRehab)}
                    />
                  </label>
                </div>
              </section>
            </div>
          )}

          {step === 4 && (
            <div className="cbf-step-panel">
              <section className="cbf-section cbf-section-card cbf-section--sources">
                <div className="cbf-section-heading">
                  <p className="cbf-section-label">Ticket Sources</p>
                </div>
                <div className="billing-ticket-source-grid">
                  <div className="billing-ticket-source-card">
                    <span className="billing-ticket-source-title">Employees</span>
                    <strong className="billing-ticket-source-total">{employeeCounts.installation + employeeCounts.repair + employeeCounts.nap_rehab}</strong>
                    <div className="billing-ticket-source-breakdown">
                      <small>Install: {employeeCounts.installation}</small>
                      <small>Repair: {employeeCounts.repair}</small>
                      <small>Nap Rehab: {employeeCounts.nap_rehab}</small>
                    </div>
                  </div>
                  <div className="billing-ticket-source-card">
                    <span className="billing-ticket-source-title">Subcontractors</span>
                    <strong className="billing-ticket-source-total">{subconInstall + subconRepair + subconNapRehab}</strong>
                    <div className="billing-ticket-source-breakdown">
                      <small>Install: {subconInstall}</small>
                      <small>Repair: {subconRepair}</small>
                      <small>Nap Rehab: {subconNapRehab}</small>
                    </div>
                  </div>
                  <div className="billing-ticket-source-card">
                    <span className="billing-ticket-source-title">Company</span>
                    <strong className="billing-ticket-source-total">{companyInstallTickets + companyRepairTickets + companyNapRehabTickets}</strong>
                    <div className="billing-ticket-source-breakdown">
                      <small>Install: {companyInstallTickets}</small>
                      <small>Repair: {companyRepairTickets}</small>
                      <small>Nap Rehab: {companyNapRehabTickets}</small>
                    </div>
                  </div>
                  <div className="billing-ticket-source-card emphasis">
                    <span className="billing-ticket-source-title">Combined</span>
                    <strong className="billing-ticket-source-total">{combinedInstallTickets + combinedRepairTickets + combinedNapRehabTickets}</strong>
                    <div className="billing-ticket-source-breakdown">
                      <small>Install: {combinedInstallTickets}</small>
                      <small>Repair: {combinedRepairTickets}</small>
                      <small>Nap Rehab: {combinedNapRehabTickets}</small>
                    </div>
                  </div>
                </div>
              </section>

              <section className="cbf-section cbf-section-card cbf-section--company">
                <div className="cbf-section-heading">
                  <p className="cbf-section-label">Company Tickets <span className="cbf-section-sub">closed by the company, not an employee</span></p>
                </div>
                <div className="cbf-ticket-pair">
                  <div className="cbf-ticket-card">
                    <label className="cbf-ticket-field">
                      <span className="cbf-ticket-type">Installation</span>
                      <span className="cbf-ticket-input-wrap">
                        <input
                          className="cbf-ticket-input"
                          min="0"
                          type="number"
                          value={values.company_install_tickets}
                          onChange={(event) => setValues({ ...values, company_install_tickets: String(Math.max(0, Number(event.target.value) || 0)) })}
                        />
                      </span>
                    </label>
                  </div>
                  <div className="cbf-ticket-card">
                    <label className="cbf-ticket-field">
                      <span className="cbf-ticket-type">Repair</span>
                      <span className="cbf-ticket-input-wrap">
                        <input
                          className="cbf-ticket-input"
                          min="0"
                          type="number"
                          value={values.company_repair_tickets}
                          onChange={(event) => setValues({ ...values, company_repair_tickets: String(Math.max(0, Number(event.target.value) || 0)) })}
                        />
                      </span>
                    </label>
                  </div>
                  <div className="cbf-ticket-card">
                    <label className="cbf-ticket-field">
                      <span className="cbf-ticket-type">Nap Rehab</span>
                      <span className="cbf-ticket-input-wrap">
                        <input
                          className="cbf-ticket-input"
                          min="0"
                          type="number"
                          value={values.company_nap_rehab_tickets}
                          onChange={(event) => setValues({ ...values, company_nap_rehab_tickets: String(Math.max(0, Number(event.target.value) || 0)) })}
                        />
                      </span>
                    </label>
                  </div>
                </div>
                <div className="cbf-section-heading">
                  <p className="cbf-section-label">Disputed <span className="cbf-section-sub">deducted from billable</span></p>
                </div>
                <div className="cbf-ticket-pair">
                  <div className="cbf-ticket-card cbf-ticket-card--dispute">
                    <label className="cbf-ticket-field">
                      <span className="cbf-ticket-type">Installation</span>
                      <span className="cbf-ticket-input-wrap">
                        <input
                          className="cbf-ticket-input cbf-ticket-input--dispute"
                          disabled={companyInstallTickets === 0}
                          max={companyInstallTickets}
                          min="0"
                          type="number"
                          value={String(companyDisputedInstall)}
                          onChange={(event) => setValues({ ...values, company_disputed_install: String(Math.max(0, Math.min(companyInstallTickets, Number(event.target.value) || 0))) })}
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
                          disabled={companyRepairTickets === 0}
                          max={companyRepairTickets}
                          min="0"
                          type="number"
                          value={String(companyDisputedRepair)}
                          onChange={(event) => setValues({ ...values, company_disputed_repair: String(Math.max(0, Math.min(companyRepairTickets, Number(event.target.value) || 0))) })}
                        />
                      </span>
                    </label>
                  </div>
                  <div className="cbf-ticket-card cbf-ticket-card--dispute">
                    <label className="cbf-ticket-field">
                      <span className="cbf-ticket-type">Nap Rehab</span>
                      <span className="cbf-ticket-input-wrap">
                        <input
                          className="cbf-ticket-input cbf-ticket-input--dispute"
                          disabled={companyNapRehabTickets === 0}
                          max={companyNapRehabTickets}
                          min="0"
                          type="number"
                          value={String(companyDisputedNapRehab)}
                          onChange={(event) => setValues({ ...values, company_disputed_nap_rehab: String(Math.max(0, Math.min(companyNapRehabTickets, Number(event.target.value) || 0))) })}
                        />
                      </span>
                    </label>
                  </div>
                </div>
              </section>

            </div>
          )}

          {step === 3 && (
            <div className="cbf-step-panel">
              <section className="cbf-section cbf-section-card">
                <div className="cbf-section-heading">
                  <p className="cbf-section-label">Subcontractor Tickets</p>
                </div>
                <div className="billing-subcon-form-scroll">
                  <div className="billing-subcon-form-table">
                  <div className="billing-subcon-form-head">
                    <span><span className="tbl-label-full">Subcontractor</span><span className="tbl-label-abbr">Subcon</span></span>
                    <span><span className="tbl-label-full">Install</span><span className="tbl-label-abbr">Ins</span></span>
                    <span><span className="tbl-label-full">Repair</span><span className="tbl-label-abbr">Rep</span></span>
                    <span><span className="tbl-label-full">Nap Rehab</span><span className="tbl-label-abbr">NR</span></span>
                    <span><span className="tbl-label-full">Disputed Install</span><span className="tbl-label-abbr">D.Ins</span></span>
                    <span><span className="tbl-label-full">Disputed Repair</span><span className="tbl-label-abbr">D.Rep</span></span>
                    <span><span className="tbl-label-full">Disputed Nap Rehab</span><span className="tbl-label-abbr">D.NR</span></span>
                    <span><span className="tbl-label-full">Net Amount</span><span className="tbl-label-abbr">Net</span></span>
                    <span><span className="tbl-label-full">Collectibles Amount</span><span className="tbl-label-abbr">Collect</span></span>
                  </div>
                  {values.subcon_items.length === 0 ? (
                    <div className="billing-subcon-form-empty">No active subcontractors yet.</div>
                  ) : (
                    values.subcon_items.map((item, index) => {
                      const itemInstallTickets = Number(item.install_tickets) || 0;
                      const itemRepairTickets = Number(item.repair_tickets) || 0;
                      const itemNapRehabTickets = Number(item.nap_rehab_tickets) || 0;
                      const itemDisputedInstall = Math.max(0, Math.min(itemInstallTickets, Number(item.disputed_install) || 0));
                      const itemDisputedRepair = Math.max(0, Math.min(itemRepairTickets, Number(item.disputed_repair) || 0));
                      const itemDisputedNapRehab = Math.max(0, Math.min(itemNapRehabTickets, Number(item.disputed_nap_rehab) || 0));
                      const computed = computeSubconItem(
                        itemInstallTickets,
                        itemRepairTickets,
                        itemDisputedInstall,
                        itemDisputedRepair,
                        Number(item.installation_rate) || 0,
                        Number(item.repair_rate) || 0,
                        Number(item.payable_pct) || 0,
                        itemNapRehabTickets,
                        itemDisputedNapRehab,
                        Number(item.nap_rehab_rate) || 0,
                      );
                      return (
                        <div className="billing-subcon-form-row" key={item.subcontractor_id}>
                          <div className="billing-subcon-name-cell">
                            <strong>{item.subcon_name}</strong>
                            <span>Install rate: {currency.format(Number(item.installation_rate) || 0)}</span>
                            <span>Repair rate: {currency.format(Number(item.repair_rate) || 0)}</span>
                            <span>Nap Rehab rate: {currency.format(Number(item.nap_rehab_rate) || 0)}</span>
                          </div>
                          <div className="billing-subcon-inline-values"><span>{item.install_tickets}</span></div>
                          <div className="billing-subcon-inline-values"><span>{item.repair_tickets}</span></div>
                          <div className="billing-subcon-inline-values"><span>{item.nap_rehab_tickets}</span></div>
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
                          <div className="billing-subcon-dispute-cell">
                            <input
                              disabled={itemNapRehabTickets === 0}
                              max={itemNapRehabTickets}
                              min="0"
                              type="number"
                              value={String(itemDisputedNapRehab)}
                              onChange={(event) => updateSubconItem(index, { disputed_nap_rehab: String(Math.max(0, Math.min(itemNapRehabTickets, Number(event.target.value) || 0))) })}
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
            </div>
          )}

          {step === 5 && (
            <div className="cbf-step-panel">
              <div className="cbf-invoice">
                <h3 className="cbf-invoice-title">Billing Statement</h3>

                <p className="cbf-invoice-section-label">Client Information</p>
                <p className="cbf-invoice-line"><b>Billed To:</b></p>
                <p className="cbf-invoice-line"><b>Name:</b> {settings.client_name || "—"}</p>

                <hr className="cbf-invoice-hr" />

                <p className="cbf-invoice-section-label">Billing Information</p>
                <div className="cbf-invoice-meta">
                  <span className="cbf-invoice-meta-label">Date of Issue:</span>
                  <span className="cbf-invoice-meta-val">{statementDate}</span>
                  <span className="cbf-invoice-meta-label">Billing Statement No.:</span>
                  <span className="cbf-invoice-meta-val">
                    {initial ? initial.invoice_no : <span className="cbf-invoice-draft">DRAFT — assigned on save</span>}
                  </span>
                  <span className="cbf-invoice-meta-label">Due Date:</span>
                  <span className="cbf-invoice-meta-val">{values.due_date ? formatStatementDate(values.due_date) : "—"}</span>
                  <span className="cbf-invoice-meta-label">Period:</span>
                  <span className="cbf-invoice-meta-val">{statementPeriodLabel}</span>
                </div>

                <hr className="cbf-invoice-hr" />

                <p className="cbf-invoice-section-label">Itemized Charges</p>
                <table className="cbf-invoice-table">
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th className="cbf-invoice-num">Quantity</th>
                      <th className="cbf-invoice-num">Unit Price</th>
                      <th className="cbf-invoice-num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="cbf-invoice-desc">Installation Tickets</td>
                      <td className="cbf-invoice-num">{billableInstall}</td>
                      <td className="cbf-invoice-num">{currency.format(effectiveInstallationRate)}</td>
                      <td className="cbf-invoice-num">{currency.format(billableInstall * effectiveInstallationRate)}</td>
                    </tr>
                    <tr>
                      <td className="cbf-invoice-desc">Repair Tickets</td>
                      <td className="cbf-invoice-num">{billableRepair}</td>
                      <td className="cbf-invoice-num">{currency.format(effectiveRepairRate)}</td>
                      <td className="cbf-invoice-num">{currency.format(billableRepair * effectiveRepairRate)}</td>
                    </tr>
                    <tr>
                      <td className="cbf-invoice-desc">Nap Rehab Tickets</td>
                      <td className="cbf-invoice-num">{billableNapRehab}</td>
                      <td className="cbf-invoice-num">{currency.format(effectiveNapRehabRate)}</td>
                      <td className="cbf-invoice-num">{currency.format(billableNapRehab * effectiveNapRehabRate)}</td>
                    </tr>
                    <tr className="cbf-invoice-subtotal-row">
                      <td colSpan={3}>Subtotal</td>
                      <td className="cbf-invoice-num">{currency.format(billingAmount)}</td>
                    </tr>
                    <tr className="cbf-invoice-grand-row">
                      <td colSpan={3}>Total Amount Due</td>
                      <td className="cbf-invoice-num">{currency.format(billingAmount)}</td>
                    </tr>
                  </tbody>
                </table>

                <div className="cbf-invoice-note">
                  <span className="cbf-invoice-note-label">Payment split (internal tracking)</span>
                  <div className="cbf-invoice-note-row"><span>Collection</span><span>{currency.format(collectionsAmount)}</span></div>
                  <div className="cbf-invoice-note-row"><span>Collectibles</span><span>{currency.format(collectiblesAmount)}</span></div>
                  <div className="cbf-invoice-note-row"><span>Subcontractor payout (not billed to client)</span><span>{currency.format(totalSubconNet)}</span></div>
                </div>
              </div>
            </div>
          )}

          <div className="cbf-actions">
            <button className="cbf-btn-cancel" disabled={busy} onClick={onClose} type="button">Cancel</button>
            <div className="cbf-nav-right">
              {step > 1 && (
                <button className="cbf-btn-back" disabled={busy} key="back" onClick={() => setStep((current) => (current - 1) as BillingWizardStep)} type="button"><ArrowLeft size={15} /> Back</button>
              )}
              {step < WIZARD_STEPS.length ? (
                <button className="cbf-btn-next" disabled={busy} key="next" onClick={() => setStep((current) => (current + 1) as BillingWizardStep)} type="button">Continue <ArrowRight size={15} /></button>
              ) : (
                <button className="cbf-btn-submit" disabled={busy} key="submit" type="submit"><BadgeDollarSign size={16} />{busy ? "Saving..." : initial ? "Update Billing" : "Create Billing"}</button>
              )}
            </div>
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
    nap_rehab_rate: number;
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
  onSubmit: (payload: { installation_rate: number; repair_rate: number; nap_rehab_rate: number; collections_pct: number; client_name: string }) => Promise<void>;
}) {
  const [installationRate, setInstallationRate] = useState(String(settings.installation_rate));
  const [repairRate, setRepairRate] = useState(String(settings.repair_rate));
  const [napRehabRate, setNapRehabRate] = useState(String(Number(settings.nap_rehab_rate) || 0));
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
              nap_rehab_rate: Number(napRehabRate) || 0,
              collections_pct: Number(pct) || 0,
              client_name: clientName,
            });
            setBusy(false);
          }}
        >
          <MoneyField label="Installation rate (PHP per ticket)" value={installationRate} onChange={setInstallationRate} required />
          <MoneyField label="Repair rate (PHP per ticket)" value={repairRate} onChange={setRepairRate} required />
          <MoneyField label="Nap Rehab rate (PHP per ticket)" value={napRehabRate} onChange={setNapRehabRate} required />
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
