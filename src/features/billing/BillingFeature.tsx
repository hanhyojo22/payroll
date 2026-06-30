import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CheckCircle2, ChevronDown, FileText, Pencil, Plus, Settings, Trash2, X } from "lucide-react";
import {
  billingPeriodLabel,
  buildSubcontractorPaymentPayloads,
  computeSubconItem,
  countSubconTickets,
  countTicketsByType,
  lastDayOfMonth,
} from "../../domain/billing";
import { isOfflineLikeError } from "../../lib/offlineSync";
import { supabase } from "../../supabase";
import { MoneyField } from "../../shared/components/MoneyField";
import { PageHeader } from "../../shared/components/PageLayout";
import type { Notice, QueueOfflineMutation } from "../../shared/types";
import { currency } from "../../shared/utils/currency";
import { currentMonth, currentYear, monthNames, todayKey } from "../../shared/utils/dates";
import type {
  BillingFormValues,
  BillingRecord,
  BillingSettings,
  BillingSubconItem,
  CollectionPayment,
  CollectionPaymentFormValues,
  CollectionReminder,
  DailyTicketEntry,
  PaymentReminder,
  SubconDailyTicket,
  Subcontractor,
} from "../../types";
import {
  deleteBillingRecord,
  ensureBillingSettings,
  markSubconPaymentReminderPaid,
  saveBillingRecord,
  saveBillingSettings,
  saveBillingSubconItems,
  saveSubconPaymentReminders,
  saveSubcontractor,
} from "./billingRepository";
import { recordReceivablePayment } from "../collections/collectionRepository";

export type BillingFeatureProps = {
  billingRecords: BillingRecord[];
  billingSettings: BillingSettings | null;
  collections: CollectionReminder[];
  dailyTicketEntries: DailyTicketEntry[];
  onChange: () => Promise<void>;
  onLocalBillingRecordsChange: (records: BillingRecord[]) => void;
  onOpenSubcontractorAccount: (subcontractorId: string) => void;
  onQueueOfflineMutation: QueueOfflineMutation;
  payments: PaymentReminder[];
  setNotice: (notice: Notice) => void;
  subconDailyTickets: SubconDailyTicket[];
  subcontractors: Subcontractor[];
  userId: string;
};

export function BillingFeature({
  billingRecords,
  billingSettings,
  collections,
  dailyTicketEntries,
  onChange,
  onLocalBillingRecordsChange,
  onOpenSubcontractorAccount,
  onQueueOfflineMutation,
  payments,
  setNotice,
  subconDailyTickets,
  subcontractors,
  userId,
}: BillingFeatureProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<BillingRecord | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<BillingSettings | null>(billingSettings);
  const [quickCollecting, setQuickCollecting] = useState<{ record: BillingRecord; collection: CollectionReminder } | null>(null);
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);

  useEffect(() => {
    setSettings(billingSettings);
  }, [billingSettings]);

  useEffect(() => {
    if (!supabase || settings) return;
    void ensureBillingSettings(supabase, userId).then(({ data }) => {
      if (data) setSettings(data);
    });
  }, [settings, userId]);

  const paymentByItemId = useMemo(
    () => new Map(
      payments
        .filter((p) => p.type === "subcontractor" && p.billing_subcon_item_id !== null)
        .map((p) => [p.billing_subcon_item_id!, p]),
    ),
    [payments],
  );

  function collectionStatusFor(record: BillingRecord): string {
    if (!record.collection_id) return "-";
    const collection = collections.find((item) => item.id === record.collection_id);
    if (!collection) return "pending";
    return collection.status === "legacy_pending" ? "pending" : collection.status;
  }

  function collectiblesStatusFor(record: BillingRecord): string {
    if (!record.collectibles_collection_id) return "-";
    const collection = collections.find((item) => item.id === record.collectibles_collection_id);
    if (!collection) return "pending";
    return collection.status === "legacy_pending" ? "pending" : collection.status;
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
      setNotice({ type: "success", text: "Marked as collected (will sync when online)." });
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
      setNotice({ type: "error", text: (result.error as { message?: string }).message ?? "Failed to record collection." });
      return;
    }
    setQuickCollecting(null);
    setNotice({ type: "success", text: "Collection marked as collected." });
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
    const periodEnd = period === "first_half" ? `${year}-${String(month).padStart(2, "0")}-15` : lastDayOfMonth(month, year);
    const dueDate = periodEnd < todayKey() ? todayKey() : periodEnd;

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

    const billingPayload: Omit<BillingRecord, "created_at" | "updated_at"> = {
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
    const payoutPayloads = buildSubcontractorPaymentPayloads({
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
    });

    return { billingPayload, collectionPayload, collectiblesCollectionPayload, payoutPayloads };
  }

  async function persistBillingArtifacts(
    billingPayload: Omit<BillingRecord, "created_at" | "updated_at">,
    collectionPayload: Record<string, unknown>,
    collectiblesCollectionPayload: Record<string, unknown>,
    payoutPayloads: Array<Omit<PaymentReminder, "created_at" | "updated_at">>,
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

    return { error: null };
  }

  async function createBilling(values: BillingFormValues) {
    if (!supabase || !settings) return;
    const month = Number(values.billing_month);
    const year = Number(values.billing_year);
    const period = values.billing_period;
    const periodLabel = billingPeriodLabel(period);
    const existing = billingRecords.find(
      (record) => record.billing_month === month && record.billing_year === year && record.billing_period === period,
    );
    if (existing) {
      setNotice({ type: "error", text: `Billing for ${monthNames[month - 1]} ${year} (${periodLabel}) already exists.` });
      return;
    }

    const ids = {
      billingId: crypto.randomUUID(),
      collectionId: crypto.randomUUID(),
      collectiblesCollectionId: crypto.randomUUID(),
    };
    const { billingPayload, collectionPayload, collectiblesCollectionPayload, payoutPayloads } = buildArtifacts(values, ids);

    if (!navigator.onLine) {
      const optimistic = {
        ...billingPayload,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as BillingRecord;
      onLocalBillingRecordsChange([optimistic, ...billingRecords]);
      await onQueueOfflineMutation({
        resource: "billingRecords",
        affectedResources: ["billingRecords", "collections", "dashboardSummary", "payments"],
        operation: "billing_group",
        table: "billing_records",
        recordId: billingPayload.id,
        payload: {
          billingPayload,
          collectionPayload,
          collectiblesCollectionPayload,
          subconItemPayloads: billingPayload.subcon_items,
          subcontractorPaymentPayloads: payoutPayloads,
        },
      });
      setFormOpen(false);
      setNotice({ type: "success", text: `Billing for ${monthNames[month - 1]} ${year} (${periodLabel}) created.` });
      return;
    }

    const result = await persistBillingArtifacts(
      billingPayload,
      collectionPayload,
      collectiblesCollectionPayload,
      payoutPayloads,
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
          affectedResources: ["billingRecords", "collections", "dashboardSummary", "payments"],
          operation: "billing_group",
          table: "billing_records",
          recordId: billingPayload.id,
          payload: {
            billingPayload,
            collectionPayload,
            collectiblesCollectionPayload,
            subconItemPayloads: billingPayload.subcon_items,
            subcontractorPaymentPayloads: payoutPayloads,
          },
        });
        setFormOpen(false);
        return;
      }
      setNotice({ type: "error", text: (result.error as { message?: string }).message ?? "Failed to create billing." });
      return;
    }

    setFormOpen(false);
    setNotice({ type: "success", text: `Billing for ${monthNames[month - 1]} ${year} (${periodLabel}) created.` });
    await onChange();
  }

  async function updateBilling(values: BillingFormValues) {
    if (!supabase || !settings || !editingRecord) return;
    const periodLabel = billingPeriodLabel(values.billing_period);
    const { billingPayload, collectionPayload, collectiblesCollectionPayload, payoutPayloads } = buildArtifacts(values, {
      billingId: editingRecord.id,
      collectionId: editingRecord.collection_id ?? crypto.randomUUID(),
      collectiblesCollectionId: editingRecord.collectibles_collection_id ?? crypto.randomUUID(),
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
      true,
    );
    if (result.error) {
      setNotice({ type: "error", text: (result.error as { message?: string }).message ?? "Failed to update billing." });
      return;
    }

    setEditingRecord(null);
    setNotice({
      type: "success",
      text: `Billing for ${monthNames[Number(values.billing_month) - 1]} ${values.billing_year} (${periodLabel}) updated.`,
    });
    await onChange();
  }

  async function removeBilling(record: BillingRecord) {
    if (!supabase) return;
    const result = await deleteBillingRecord(
      supabase,
      record.id,
      record.collection_id,
      record.collectibles_collection_id ?? null,
    );
    if (result.error) {
      setNotice({ type: "error", text: (result.error as { message?: string }).message ?? "Failed to delete billing." });
      return;
    }
    setNotice({ type: "success", text: "Billing record deleted." });
    await onChange();
  }

  async function updateSettings(payload: {
    installation_rate: number;
    repair_rate: number;
    collections_pct: number;
    client_name: string;
  }) {
    if (!supabase) return;
    const result = await saveBillingSettings(supabase, userId, payload);
    if (result.error) {
      setNotice({ type: "error", text: "Failed to save settings." });
      return;
    }
    setSettings((current) => (current ? { ...current, ...payload } : current));
    setSettingsOpen(false);
    setNotice({ type: "success", text: "Billing settings saved." });
    await onChange();
  }

  const summary = useMemo(() => ({
    totalBilled: billingRecords.reduce((sum, record) => sum + record.billing_amount, 0),
    totalCollections: billingRecords.reduce((sum, record) => sum + record.collections_amount, 0),
    totalCollectibles: billingRecords.reduce((sum, record) => sum + record.collectibles_amount, 0),
  }), [billingRecords]);

  return (
    <div className="billing-page">
      <PageHeader
        action={(
          <div className="billing-header-actions">
            <button className="billing-btn outline" onClick={() => setSettingsOpen(true)} type="button">
              <Settings size={15} /> Settings
            </button>
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
        <div className="billing-stat">
          <span className="billing-stat-label">Total billed</span>
          <strong className="billing-stat-value">{currency.format(summary.totalBilled)}</strong>
        </div>
        <div className="billing-summary-split">
          <div className="billing-stat billing-stat-collection">
            <span className="billing-stat-label">Collection - {settings?.collections_pct ?? 70}%</span>
            <strong className="billing-stat-value">{currency.format(summary.totalCollections)}</strong>
          </div>
          <div className="billing-stat billing-stat-payable">
            <span className="billing-stat-label">Payable - {100 - (settings?.collections_pct ?? 70)}%</span>
            <strong className="billing-stat-value">{currency.format(summary.totalCollectibles)}</strong>
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
        <div className="billing-table-wrap">
          <table className="billing-table">
            <thead>
              <tr>
                <th>Period</th>
                <th className="num">Tickets</th>
                <th className="num">Disputed</th>
                <th className="num">Billable</th>
                <th className="num">Amount</th>
                <th className="num">Payable</th>
                <th className="num">Collection</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {billingRecords.map((record) => {
                const expanded = expandedRecordId === record.id;
                const colStatus = collectionStatusFor(record);
                const payStatus = collectiblesStatusFor(record);
                const canCollect70 = colStatus !== "-" && colStatus !== "collected" && colStatus !== "archived";
                const canCollect30 = payStatus !== "-" && payStatus !== "collected" && payStatus !== "archived";
                return (
                  <>
                    <tr className="expandable" key={record.id}>
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
                        <div className="billing-row-actions">
                          {canCollect30 && (
                            <button
                              className="billing-collect-btn billing-collect-30"
                              onClick={() => openQuickCollect(record, "collectible")}
                              title={`Mark ${100 - (settings?.collections_pct ?? 70)}% as collected`}
                              type="button"
                            >
                              <CheckCircle2 size={14} />
                              <span>{100 - (settings?.collections_pct ?? 70)}%</span>
                            </button>
                          )}
                          {canCollect70 && (
                            <button
                              className="billing-collect-btn billing-collect-70"
                              onClick={() => openQuickCollect(record, "collection")}
                              title={`Mark ${settings?.collections_pct ?? 70}% as collected`}
                              type="button"
                            >
                              <CheckCircle2 size={14} />
                              <span>{settings?.collections_pct ?? 70}%</span>
                            </button>
                          )}
                          <button onClick={() => setEditingRecord(record)} type="button" title="Edit"><Pencil size={14} /></button>
                          <button onClick={() => void removeBilling(record)} type="button" title="Delete"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="subcon-detail-row" key={`${record.id}-subcon`}>
                        <td colSpan={8}>
                          <table className="billing-subcon-detail-table">
                            <thead>
                              <tr>
                                <th>Subcontractor</th>
                                <th className="num">Tickets</th>
                                <th className="num">Gross</th>
                                <th className="num">Net payable</th>
                                <th>Payout</th>
                                <th />
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
                                            <button onClick={() => void markPayoutPaid(payment, setNotice, onChange)} type="button">
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
      {settingsOpen && settings && (
        <SettingsPanel
          settings={settings}
          subcontractors={subcontractors}
          onChange={onChange}
          onClose={() => setSettingsOpen(false)}
          onSubmit={updateSettings}
          setNotice={setNotice}
          userId={userId}
        />
      )}
      {quickCollecting && (
        <BillingQuickCollectModal
          collection={quickCollecting.collection}
          onClose={() => setQuickCollecting(null)}
          onConfirm={(method) => quickCollect(quickCollecting.collection, method)}
        />
      )}
    </div>
  );
}

async function markPayoutPaid(
  payment: PaymentReminder,
  setNotice: (notice: Notice) => void,
  onChange: () => Promise<void>,
) {
  if (!supabase) return;
  const result = await markSubconPaymentReminderPaid(supabase, payment.id);
  if (result.error) {
    setNotice({ type: "error", text: (result.error as { message?: string }).message ?? "Failed to mark payout paid." });
    return;
  }
  setNotice({ type: "success", text: `${payment.title} payout marked paid.` });
  await onChange();
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
  onSubmit: (values: BillingFormValues) => Promise<void>;
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
      subcon_items: subconItems,
      notes: "",
    };
  }

  const [values, setValues] = useState<BillingFormValues>(buildInitialValues);
  const [busy, setBusy] = useState(false);

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
  const subconInstall = values.subcon_items.reduce((sum, item) => sum + (Number(item.install_tickets) || 0), 0);
  const subconRepair = values.subcon_items.reduce((sum, item) => sum + (Number(item.repair_tickets) || 0), 0);
  const installTickets = Math.max(0, Number(values.install_tickets) || 0);
  const repairTickets = Math.max(0, Number(values.repair_tickets) || 0);
  const disputedInstall = Math.min(installTickets, Number(values.disputed_install) || 0);
  const disputedRepair = Math.min(repairTickets, Number(values.disputed_repair) || 0);
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
    await onSubmit(values);
    setBusy(false);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal cbf-modal" onClick={(event) => event.stopPropagation()}>
        <div className="cbf-header">
          <div>
            <p className="cbf-eyebrow">Semi-monthly invoicing</p>
            <h3 className="cbf-title">{initial ? "Edit Billing" : "New Billing"}</h3>
          </div>
          <button className="cbf-close-btn" onClick={onClose} type="button" aria-label="Close"><X size={18} /></button>
        </div>

        <form className="cbf-form" onSubmit={handleSubmit}>
          <div className="cbf-cols">
            <div className="cbf-left">
              <div className="cbf-section">
                <p className="cbf-section-label">Billing Period</p>
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
              </div>

              <div className="cbf-section">
                <p className="cbf-section-label">Ticket Sources</p>
                <div className="billing-ticket-source-grid">
                  <div className="billing-ticket-source-card">
                    <span>Employees</span>
                    <strong>{employeeCounts.installation + employeeCounts.repair}</strong>
                    <small>I:{employeeCounts.installation} R:{employeeCounts.repair}</small>
                  </div>
                  <div className="billing-ticket-source-card">
                    <span>Subcontractors</span>
                    <strong>{subconInstall + subconRepair}</strong>
                    <small>I:{subconInstall} R:{subconRepair}</small>
                  </div>
                  <div className="billing-ticket-source-card emphasis">
                    <span>Combined</span>
                    <strong>{installTickets + repairTickets}</strong>
                    <small>I:{installTickets} R:{repairTickets}</small>
                  </div>
                </div>
              </div>

              <div className="cbf-section cbf-section--dispute">
                <p className="cbf-section-label">Disputed totals <span className="cbf-section-sub">deducted from billable</span></p>
                <div className="cbf-ticket-pair">
                  <div className="cbf-ticket-card cbf-ticket-card--dispute">
                    <span className="cbf-ticket-type">Installation</span>
                    <input className="cbf-ticket-input cbf-ticket-input--dispute" min="0" type="number" value={values.disputed_install} onChange={(event) => setValues({ ...values, disputed_install: event.target.value })} />
                    <span className="cbf-ticket-hint cbf-ticket-hint--dispute">max {installTickets}</span>
                  </div>
                  <div className="cbf-ticket-card cbf-ticket-card--dispute">
                    <span className="cbf-ticket-type">Repair</span>
                    <input className="cbf-ticket-input cbf-ticket-input--dispute" min="0" type="number" value={values.disputed_repair} onChange={(event) => setValues({ ...values, disputed_repair: event.target.value })} />
                    <span className="cbf-ticket-hint cbf-ticket-hint--dispute">max {repairTickets}</span>
                  </div>
                </div>
              </div>

              <div className="cbf-section">
                <p className="cbf-section-label">Subcontractor billing rows</p>
                <div className="billing-subcon-form-table">
                  <div className="billing-subcon-form-head">
                    <span>Subcontractor</span>
                    <span>Tickets</span>
                    <span>Disputed</span>
                    <span>Net</span>
                  </div>
                  {values.subcon_items.length === 0 ? (
                    <div className="billing-subcon-form-empty">No active subcontractors yet.</div>
                  ) : (
                    values.subcon_items.map((item, index) => {
                      const computed = computeSubconItem(
                        Number(item.install_tickets) || 0,
                        Number(item.repair_tickets) || 0,
                        Number(item.disputed_install) || 0,
                        Number(item.disputed_repair) || 0,
                        Number(item.installation_rate) || 0,
                        Number(item.repair_rate) || 0,
                        Number(item.payable_pct) || 0,
                      );
                      return (
                        <div className="billing-subcon-form-row" key={item.subcontractor_id}>
                          <div>
                            <strong>{item.subcon_name}</strong>
                            <span>I:{item.install_tickets} R:{item.repair_tickets}</span>
                          </div>
                          <div className="billing-subcon-inline-values">
                            <span>{(Number(item.install_tickets) || 0) + (Number(item.repair_tickets) || 0)}</span>
                          </div>
                          <div className="billing-subcon-dispute-inputs">
                            <input min="0" type="number" value={item.disputed_install} onChange={(event) => updateSubconItem(index, { disputed_install: event.target.value })} />
                            <input min="0" type="number" value={item.disputed_repair} onChange={(event) => updateSubconItem(index, { disputed_repair: event.target.value })} />
                          </div>
                          <div className="billing-subcon-net">
                            <strong>{currency.format(computed.payableAmount)}</strong>
                            <span>{item.payable_pct}% payable</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="cbf-section">
                <label className="cbf-section-label">
                  Notes <span className="cbf-section-sub">optional</span>
                  <textarea className="cbf-textarea" rows={3} value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} />
                </label>
              </div>
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
                  <div className="cbf-stmt-group">
                    <p className="cbf-stmt-group-label">Billable totals</p>
                    <div className="cbf-stmt-row"><span>Install ({billableInstall})</span><span>{currency.format(billableInstall * settings.installation_rate)}</span></div>
                    <div className="cbf-stmt-row"><span>Repair ({billableRepair})</span><span>{currency.format(billableRepair * settings.repair_rate)}</span></div>
                    <div className="cbf-stmt-row cbf-stmt-row--total"><span>{billableTickets} tickets</span><span /></div>
                  </div>
                  <div className="cbf-stmt-group">
                    <p className="cbf-stmt-group-label">Subcontractor payout</p>
                    <div className="cbf-stmt-row"><span>Pending payable total</span><span>{currency.format(totalSubconNet)}</span></div>
                    <div className="cbf-stmt-row"><span>Rows</span><span>{values.subcon_items.length}</span></div>
                  </div>
                </div>
                <div className="cbf-stmt-total">
                  <span>Total Amount</span>
                  <strong>{currency.format(billingAmount)}</strong>
                </div>
                <div className="cbf-split-wrap">
                  <div className="cbf-split-labels">
                    <div className="cbf-split-item cbf-split-item--collection">
                      <div>
                        <p className="cbf-split-label">Collection {settings.collections_pct}%</p>
                        <strong className="cbf-split-amount">{currency.format(collectionsAmount)}</strong>
                      </div>
                    </div>
                    <div className="cbf-split-item cbf-split-item--payable">
                      <div>
                        <p className="cbf-split-label">Payable {100 - settings.collections_pct}%</p>
                        <strong className="cbf-split-amount">{currency.format(collectiblesAmount)}</strong>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="cbf-actions">
            <button className="cbf-btn-cancel" onClick={onClose} type="button">Cancel</button>
            <button className="cbf-btn-submit" disabled={busy} type="submit">{busy ? "Saving..." : initial ? "Update Billing" : "Create Billing"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SettingsPanel({
  settings,
  subcontractors,
  onClose,
  onSubmit,
  onChange,
  setNotice,
  userId,
}: {
  settings: BillingSettings;
  subcontractors: Subcontractor[];
  onClose: () => void;
  onSubmit: (payload: { installation_rate: number; repair_rate: number; collections_pct: number; client_name: string }) => Promise<void>;
  onChange: () => Promise<void>;
  setNotice: (notice: Notice) => void;
  userId: string;
}) {
  const [installationRate, setInstallationRate] = useState(String(settings.installation_rate));
  const [repairRate, setRepairRate] = useState(String(settings.repair_rate));
  const [pct, setPct] = useState(String(settings.collections_pct));
  const [clientName, setClientName] = useState(settings.client_name);
  const [busy, setBusy] = useState(false);
  const [subconForm, setSubconForm] = useState<{ id?: string; name: string; installation_rate: string; repair_rate: string; payable_pct: string } | null>(null);
  const [subconBusy, setSubconBusy] = useState(false);

  async function saveSubcon() {
    if (!supabase || !subconForm) return;
    setSubconBusy(true);
    const result = await saveSubcontractor(supabase, userId, {
      id: subconForm.id,
      name: subconForm.name.trim(),
      installation_rate: Number(subconForm.installation_rate) || 0,
      repair_rate: Number(subconForm.repair_rate) || 0,
      payable_pct: Number(subconForm.payable_pct) || 30,
      status: "active",
    });
    setSubconBusy(false);
    if (result.error) {
      setNotice({ type: "error", text: (result.error as { message?: string }).message ?? "Failed to save subcontractor." });
      return;
    }
    setSubconForm(null);
    setNotice({ type: "success", text: "Subcontractor saved." });
    await onChange();
  }

  async function toggleSubconArchive(subcontractor: Subcontractor) {
    if (!supabase) return;
    const nextStatus = subcontractor.status === "active" ? "archived" : "active";
    const result = await saveSubcontractor(supabase, userId, {
      id: subcontractor.id,
      name: subcontractor.name,
      installation_rate: subcontractor.installation_rate,
      repair_rate: subcontractor.repair_rate,
      payable_pct: subcontractor.payable_pct,
      status: nextStatus,
    });
    if (result.error) {
      setNotice({ type: "error", text: (result.error as { message?: string }).message ?? "Failed to update subcontractor." });
      return;
    }
    await onChange();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal billing-settings-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h3>Billing Settings</h3>
          <button onClick={onClose} type="button" aria-label="Close"><X size={18} /></button>
        </div>
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
              <button className="billing-btn outline" onClick={onClose} type="button">Cancel</button>
              <button className="billing-btn primary" disabled={busy} type="submit">{busy ? "Saving..." : "Save Settings"}</button>
            </div>
          </form>

          <section className="billing-subcon-settings">
            <div className="billing-subcon-settings-header">
              <h4>Subcontractors</h4>
              <button className="billing-btn outline" onClick={() => setSubconForm({ name: "", installation_rate: "0", repair_rate: "0", payable_pct: "30" })} type="button">
                <Plus size={14} /> Add
              </button>
            </div>

            {subcontractors.length === 0 && !subconForm && <p className="billing-no-subcons">No subcontractors yet.</p>}

            {subcontractors.map((subcontractor) => (
              <div className="billing-subcon-row" key={subcontractor.id}>
                <div className="billing-subcon-info">
                  <strong>{subcontractor.name}</strong>
                </div>
                <div className="billing-row-actions">
                  <button
                    onClick={() => setSubconForm({
                      id: subcontractor.id,
                      name: subcontractor.name,
                      installation_rate: String(subcontractor.installation_rate),
                      repair_rate: String(subcontractor.repair_rate),
                      payable_pct: String(subcontractor.payable_pct),
                    })}
                    type="button"
                    title="Edit"
                  >
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => void toggleSubconArchive(subcontractor)} type="button" title={subcontractor.status === "active" ? "Archive" : "Restore"}>
                    {subcontractor.status === "active" ? <Trash2 size={14} /> : <Plus size={14} />}
                  </button>
                </div>
              </div>
            ))}

            {subconForm && (
              <div className="billing-subcon-form">
                <label>Name <input type="text" value={subconForm.name} onChange={(event) => setSubconForm({ ...subconForm, name: event.target.value })} required /></label>
                <MoneyField label="Install rate" value={subconForm.installation_rate} onChange={(value) => setSubconForm({ ...subconForm, installation_rate: value })} required />
                <MoneyField label="Repair rate" value={subconForm.repair_rate} onChange={(value) => setSubconForm({ ...subconForm, repair_rate: value })} required />
                <label>
                  Payable % (default 30)
                  <input max="100" min="0" type="number" value={subconForm.payable_pct} onChange={(event) => setSubconForm({ ...subconForm, payable_pct: event.target.value })} required />
                </label>
                <label>
                  Collection % (derived)
                  <input disabled type="number" value={100 - (Number(subconForm.payable_pct) || 0)} />
                </label>
                <div className="billing-subcon-form-actions">
                  <button className="billing-btn outline" onClick={() => setSubconForm(null)} type="button">Cancel</button>
                  <button className="billing-btn primary" disabled={subconBusy || !subconForm.name.trim()} onClick={() => void saveSubcon()} type="button">{subconBusy ? "Saving..." : "Save"}</button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
