import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, FileText, Pencil, Plus, Settings, Trash2, X } from "lucide-react";
import { countTicketsByType, lastDayOfMonth } from "../../domain/billing";
import { isOfflineLikeError } from "../../lib/offlineSync";
import { supabase } from "../../supabase";
import { MoneyField } from "../../shared/components/MoneyField";
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
  SubconDailyTicket,
  Subcontractor,
} from "../../types";
import {
  deleteBillingRecord,
  ensureBillingSettings,
  saveBillingRecord,
  saveBillingSettings,
  saveSubcontractor,
} from "./billingRepository";
import { recordReceivablePayment } from "../collections/collectionRepository";

export type BillingFeatureProps = {
  billingRecords: BillingRecord[];
  billingSettings: BillingSettings | null;
  collections: CollectionReminder[];
  dailyTicketEntries: DailyTicketEntry[];
  subconDailyTickets: SubconDailyTicket[];
  onChange: () => Promise<void>;
  onLocalBillingRecordsChange: (records: BillingRecord[]) => void;
  onQueueOfflineMutation: QueueOfflineMutation;
  setNotice: (notice: Notice) => void;
  subcontractors: Subcontractor[];
  userId: string;
};

export function BillingFeature({
  billingRecords,
  billingSettings,
  collections,
  dailyTicketEntries,
  subconDailyTickets,
  onChange,
  onLocalBillingRecordsChange,
  onQueueOfflineMutation,
  setNotice,
  subcontractors,
  userId,
}: BillingFeatureProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<BillingRecord | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<BillingSettings | null>(billingSettings);
  const [quickCollecting, setQuickCollecting] = useState<{ record: BillingRecord; collection: CollectionReminder } | null>(null);

  useEffect(() => { setSettings(billingSettings); }, [billingSettings]);

  useEffect(() => {
    if (!supabase || settings) return;
    void ensureBillingSettings(supabase, userId).then(({ data }) => { if (data) setSettings(data); });
  }, [settings, userId]);

  function collectionStatusFor(record: BillingRecord): string {
    if (!record.collection_id) return "—";
    const collection = collections.find((c) => c.id === record.collection_id);
    if (!collection) return "pending";
    return collection.status === "legacy_pending" ? "pending" : collection.status;
  }

  function collectiblesStatusFor(record: BillingRecord): string {
    if (!record.collectibles_collection_id) return "—";
    const collection = collections.find((c) => c.id === record.collectibles_collection_id);
    if (!collection) return "pending";
    return collection.status === "legacy_pending" ? "pending" : collection.status;
  }

  function openQuickCollect(record: BillingRecord, which: "collection" | "collectible") {
    const collectionId = which === "collection" ? record.collection_id : record.collectibles_collection_id;
    if (!collectionId) return;
    const collection = collections.find((c) => c.id === collectionId);
    if (!collection || collection.outstanding_balance <= 0) return;
    setQuickCollecting({ record, collection });
  }

  async function quickCollect(collection: CollectionReminder, method: CollectionPayment["payment_method"]) {
    if (!supabase) return;
    const amount = collection.outstanding_balance;
    const id = crypto.randomUUID();
    const optimisticPayment: CollectionPayment = {
      id, user_id: collection.user_id, collection_id: collection.id, amount,
      payment_date: todayKey(), payment_method: method,
      reference_number: "", notes: "", is_void: false,
      void_reason: "", voided_at: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    const rpcPayload = {
      collection_record_id: collection.id, payment_record_id: id, payment_amount: amount,
      paid_on: todayKey(), method, payment_reference: "", payment_notes: "",
    };
    if (!navigator.onLine) {
      await onQueueOfflineMutation({ resource: "collections", affectedResources: ["collections", "dashboardSummary"], operation: "collection_payment", table: "record_collection_payment", recordId: id, payload: rpcPayload });
      setQuickCollecting(null);
      setNotice({ type: "success", text: "Marked as collected (will sync when online)." });
      return;
    }
    const values: CollectionPaymentFormValues = { amount: String(amount), payment_date: todayKey(), payment_method: method, reference_number: "", notes: "" };
    const result = await recordReceivablePayment(supabase, collection.id, id, values);
    if (result.error) { setNotice({ type: "error", text: (result.error as { message?: string }).message ?? "Failed." }); return; }
    setNotice({ type: "success", text: "Collection marked as collected." });
    setQuickCollecting(null);
    await onChange();
  }

  async function createBilling(values: BillingFormValues) {
    if (!supabase || !settings) return;
    const month = Number(values.billing_month);
    const year = Number(values.billing_year);
    const period = values.billing_period;
    const periodLabel = period === "first_half" ? "1st–15th" : "16th–end";

    const installTickets = Number(values.install_tickets) || 0;
    const repairTickets = Number(values.repair_tickets) || 0;
    const disputedInstall = Number(values.disputed_install) || 0;
    const disputedRepair = Number(values.disputed_repair) || 0;
    const totalTickets = installTickets + repairTickets;
    const disputedTickets = disputedInstall + disputedRepair;
    const billableInstall = Math.max(0, installTickets - disputedInstall);
    const billableRepair = Math.max(0, repairTickets - disputedRepair);
    const billableTickets = billableInstall + billableRepair;
    const billingAmount = billableInstall * settings.installation_rate + billableRepair * settings.repair_rate;
    const collectionsAmount = Math.round(billingAmount * settings.collections_pct / 100 * 100) / 100;
    const collectiblesAmount = Math.round((billingAmount - collectionsAmount) * 100) / 100;

    const existing = billingRecords.find((r) => r.billing_month === month && r.billing_year === year && r.billing_period === period);
    if (existing) {
      setNotice({ type: "error", text: `Billing for ${monthNames[month - 1]} ${year} (${periodLabel}) already exists.` });
      return;
    }

    const periodEnd = period === "first_half" ? `${year}-${String(month).padStart(2, "0")}-15` : lastDayOfMonth(month, year);
    const today = todayKey();
    const dueDateStr = periodEnd < today ? today : periodEnd;
    const collectionId = crypto.randomUUID();
    const collectiblesCollectionId = crypto.randomUUID();
    const billingId = crypto.randomUUID();

    const collectionPayload = {
      id: collectionId, user_id: userId,
      title: `Billing ${monthNames[month - 1]} ${year} (${periodLabel}) — ${settings.collections_pct}%`,
      client_name: settings.client_name || "Client", external_reference: "",
      issue_date: todayKey(), amount: collectionsAmount, due_date: dueDateStr,
      status: "pending" as const,
      notes: `Auto-created from billing ${monthNames[month - 1]} ${year} (${periodLabel}).`,
    };

    const collectiblesCollectionPayload = {
      id: collectiblesCollectionId, user_id: userId,
      title: `Billing ${monthNames[month - 1]} ${year} (${periodLabel}) — ${100 - settings.collections_pct}%`,
      client_name: settings.client_name || "Client", external_reference: "",
      issue_date: todayKey(), amount: collectiblesAmount, due_date: dueDateStr,
      status: "pending" as const,
      notes: `Auto-created from billing ${monthNames[month - 1]} ${year} (${periodLabel}) — ${100 - settings.collections_pct}% collectible.`,
    };

    const billingPayload: Omit<BillingRecord, "created_at" | "updated_at"> = {
      id: billingId, user_id: userId, billing_month: month, billing_year: year, billing_period: period,
      install_tickets: installTickets,
      repair_tickets: repairTickets,
      disputed_install: disputedInstall,
      disputed_repair: disputedRepair,
      total_tickets: totalTickets, disputed_tickets: disputedTickets, billable_tickets: billableTickets,
      billing_rate: 0, billing_amount: billingAmount,
      collections_pct: settings.collections_pct, collections_amount: collectionsAmount, collectibles_amount: collectiblesAmount,
      collection_id: collectionId, collectibles_collection_id: collectiblesCollectionId,
      subcon_items: [], notes: values.notes.trim(),
    };

    if (!navigator.onLine) {
      const optimistic = { ...billingPayload, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as BillingRecord;
      onLocalBillingRecordsChange([optimistic, ...billingRecords]);
      await onQueueOfflineMutation({
        resource: "billingRecords", affectedResources: ["billingRecords", "collections", "dashboardSummary"],
        operation: "billing_group", table: "billing_records", recordId: billingId,
        payload: { billingPayload, collectionPayload, collectiblesCollectionPayload },
      });
      setFormOpen(false);
      setNotice({ type: "success", text: `Billing for ${monthNames[month - 1]} ${year} (${periodLabel}) created.` });
      return;
    }

    const collectionResult = await supabase.from("collection_reminders").insert(collectionPayload);
    if (collectionResult.error) {
      if (isOfflineLikeError(collectionResult.error)) {
        const optimistic = { ...billingPayload, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as BillingRecord;
        onLocalBillingRecordsChange([optimistic, ...billingRecords]);
        await onQueueOfflineMutation({
          resource: "billingRecords", affectedResources: ["billingRecords", "collections", "dashboardSummary"],
          operation: "billing_group", table: "billing_records", recordId: billingId,
          payload: { billingPayload, collectionPayload, collectiblesCollectionPayload },
        });
        setFormOpen(false);
        return;
      }
      setNotice({ type: "error", text: collectionResult.error.message ?? "Failed to create receivable." });
      return;
    }

    const collectiblesResult = await supabase.from("collection_reminders").insert(collectiblesCollectionPayload);
    if (collectiblesResult.error) {
      setNotice({ type: "error", text: collectiblesResult.error.message ?? "Failed to create collectibles receivable." });
      return;
    }

    const billingResult = await saveBillingRecord(supabase, billingPayload);
    if (billingResult.error) {
      setNotice({ type: "error", text: (billingResult.error as { message?: string }).message ?? "Failed to save billing record." });
      return;
    }

    setFormOpen(false);
    setNotice({ type: "success", text: `Billing for ${monthNames[month - 1]} ${year} (${periodLabel}) created.` });
    await onChange();
  }

  async function updateBilling(values: BillingFormValues) {
    if (!supabase || !settings || !editingRecord) return;
    const month = Number(values.billing_month);
    const year = Number(values.billing_year);
    const period = values.billing_period;
    const periodLabel = period === "first_half" ? "1st–15th" : "16th–end";

    const installTickets = Number(values.install_tickets) || 0;
    const repairTickets = Number(values.repair_tickets) || 0;
    const disputedInstall = Number(values.disputed_install) || 0;
    const disputedRepair = Number(values.disputed_repair) || 0;
    const totalTickets = installTickets + repairTickets;
    const disputedTickets = disputedInstall + disputedRepair;
    const billableInstall = Math.max(0, installTickets - disputedInstall);
    const billableRepair = Math.max(0, repairTickets - disputedRepair);
    const billableTickets = billableInstall + billableRepair;
    const billingAmount = billableInstall * settings.installation_rate + billableRepair * settings.repair_rate;
    const collectionsAmount = Math.round(billingAmount * settings.collections_pct / 100 * 100) / 100;
    const collectiblesAmount = Math.round((billingAmount - collectionsAmount) * 100) / 100;

    const payload: Omit<BillingRecord, "created_at" | "updated_at"> = {
      ...editingRecord, billing_month: month, billing_year: year, billing_period: period,
      install_tickets: installTickets,
      repair_tickets: repairTickets,
      disputed_install: disputedInstall,
      disputed_repair: disputedRepair,
      total_tickets: totalTickets, disputed_tickets: disputedTickets, billable_tickets: billableTickets,
      billing_rate: 0, billing_amount: billingAmount,
      collections_pct: settings.collections_pct, collections_amount: collectionsAmount, collectibles_amount: collectiblesAmount,
      notes: values.notes.trim(),
    };

    const result = await saveBillingRecord(supabase, payload);
    if (result.error) {
      setNotice({ type: "error", text: (result.error as { message?: string }).message ?? "Failed to update billing." });
      return;
    }

    setEditingRecord(null);
    setNotice({ type: "success", text: `Billing for ${monthNames[month - 1]} ${year} (${periodLabel}) updated.` });
    await onChange();
  }

  async function removeBilling(record: BillingRecord) {
    if (!supabase) return;
    const result = await deleteBillingRecord(supabase, record.id, record.collection_id, record.collectibles_collection_id ?? null);
    if (result.error) {
      setNotice({ type: "error", text: (result.error as { message?: string }).message ?? "Failed to delete billing." });
      return;
    }
    setNotice({ type: "success", text: "Billing record deleted." });
    await onChange();
  }

  async function updateSettings(payload: { installation_rate: number; repair_rate: number; collections_pct: number; client_name: string }) {
    if (!supabase) return;
    const result = await saveBillingSettings(supabase, userId, payload);
    if (result.error) {
      setNotice({ type: "error", text: "Failed to save settings." });
      return;
    }
    setSettings((prev) => prev ? { ...prev, ...payload } : prev);
    setSettingsOpen(false);
    setNotice({ type: "success", text: "Billing settings saved." });
    await onChange();
  }

  const summary = useMemo(() => ({
    totalBilled: billingRecords.reduce((s, r) => s + r.billing_amount, 0),
    totalCollections: billingRecords.reduce((s, r) => s + r.collections_amount, 0),
    totalCollectibles: billingRecords.reduce((s, r) => s + r.collectibles_amount, 0),
  }), [billingRecords]);

  return (
    <div className="billing-page">
      <header className="billing-header">
        <div>
          <p className="eyebrow">Semi-monthly invoicing</p>
          <h2>Billing</h2>
        </div>
        <div className="billing-header-actions">
          <button className="billing-btn outline" onClick={() => setSettingsOpen(true)} type="button">
            <Settings size={15} /> Settings
          </button>
          <button className="billing-btn primary" onClick={() => setFormOpen(true)} type="button">
            <Plus size={15} /> New billing
          </button>
        </div>
      </header>

      <section className="billing-summary">
        <div className="billing-stat">
          <span className="billing-stat-label">Total billed</span>
          <strong className="billing-stat-value">{currency.format(summary.totalBilled)}</strong>
        </div>
        <div className="billing-summary-split">
          <div className="billing-stat billing-stat-collection">
            <span className="billing-stat-label">Collection — {settings?.collections_pct ?? 70}%</span>
            <strong className="billing-stat-value">{currency.format(summary.totalCollections)}</strong>
          </div>
          <div className="billing-stat billing-stat-payable">
            <span className="billing-stat-label">Payable — {100 - (settings?.collections_pct ?? 70)}%</span>
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
                <th className="num">Payable <span className="billing-pct-tag">{100 - (settings?.collections_pct ?? 70)}%</span></th>
                <th className="num">Collection <span className="billing-pct-tag">{settings?.collections_pct ?? 70}%</span></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {billingRecords.map((record) => {
                const colStatus = collectionStatusFor(record);
                const payStatus = collectiblesStatusFor(record);
                const canCollect70 = colStatus !== "—" && colStatus !== "collected" && colStatus !== "archived";
                const canCollect30 = payStatus !== "—" && payStatus !== "collected" && payStatus !== "archived";
                return (
                  <tr key={record.id}>
                    <td>
                      <div className="billing-period-cell">
                        <div>
                          <strong className="billing-period-month">{monthNames[record.billing_month - 1]} {record.billing_year}</strong>
                          <span className="billing-period-half">{record.billing_period === "first_half" ? "1st – 15th" : "16th – End"}</span>
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
                        <span>I:{Math.max(0, record.install_tickets - record.disputed_install)} R:{Math.max(0, record.repair_tickets - record.disputed_repair)}</span>
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {formOpen && settings && (
        <BillingForm
          dailyTicketEntries={dailyTicketEntries}
          subconDailyTickets={subconDailyTickets}
          settings={settings}
          onClose={() => setFormOpen(false)}
          onSubmit={createBilling}
        />
      )}
      {editingRecord && settings && (
        <BillingForm
          initial={editingRecord}
          dailyTicketEntries={dailyTicketEntries}
          subconDailyTickets={subconDailyTickets}
          settings={settings}
          onClose={() => setEditingRecord(null)}
          onSubmit={updateBilling}
        />
      )}
      {settingsOpen && settings && (
        <SettingsPanel
          settings={settings}
          subcontractors={subcontractors}
          onClose={() => setSettingsOpen(false)}
          onSubmit={updateSettings}
          onChange={onChange}
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

function BillingQuickCollectModal({ collection, onClose, onConfirm }: {
  collection: CollectionReminder;
  onClose: () => void;
  onConfirm: (method: CollectionPayment["payment_method"]) => Promise<void>;
}) {
  const [method, setMethod] = useState<CollectionPayment["payment_method"]>("cash");
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal billing-form-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-header">
          <h3>Mark as Collected</h3>
          <button onClick={onClose} type="button" aria-label="Close"><X size={18} /></button>
        </div>
        <form
          className="billing-form-body"
          onSubmit={async (e) => { e.preventDefault(); setBusy(true); await onConfirm(method); setBusy(false); }}
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
              <select value={method} onChange={(e) => setMethod(e.target.value as CollectionPayment["payment_method"])}>
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
  subconDailyTickets,
  settings,
  onClose,
  onSubmit,
}: {
  initial?: BillingRecord;
  dailyTicketEntries: DailyTicketEntry[];
  subconDailyTickets: SubconDailyTicket[];
  settings: BillingSettings;
  onClose: () => void;
  onSubmit: (values: BillingFormValues) => Promise<void>;
}) {
  const today = new Date();
  const defaultPeriod = today.getDate() <= 15 ? "first_half" : "second_half";
  const [values, setValues] = useState<BillingFormValues>(initial ? {
    billing_month: String(initial.billing_month),
    billing_year: String(initial.billing_year),
    billing_period: initial.billing_period,
    install_tickets: String(initial.install_tickets),
    repair_tickets: String(initial.repair_tickets),
    disputed_install: String(initial.disputed_install),
    disputed_repair: String(initial.disputed_repair),
    notes: initial.notes,
  } : (() => {
    const defaultMonth = Number(currentMonth());
    const defaultYear = Number(currentYear());
    const period = defaultPeriod as BillingFormValues["billing_period"];
    const counts = countTicketsByType(dailyTicketEntries, defaultMonth, defaultYear, period);
    const initSubcon = subconDailyTickets
      .filter((e) => {
        const [y, m, d] = e.entry_date.split("-").map(Number);
        if (y !== defaultYear || m !== defaultMonth) return false;
        return period === "first_half" ? d <= 15 : d >= 16;
      })
      .reduce((acc, e) => ({ install: acc.install + (e.install_tickets ?? 0), repair: acc.repair + (e.repair_tickets ?? 0) }), { install: 0, repair: 0 });
    return {
      billing_month: String(defaultMonth),
      billing_year: String(defaultYear),
      billing_period: defaultPeriod,
      install_tickets: String(counts.installation + initSubcon.install),
      repair_tickets: String(counts.repair + initSubcon.repair),
      disputed_install: "0",
      disputed_repair: "0",
      notes: "",
    };
  })());

  useEffect(() => {
    if (initial) return;
    const month = Number(values.billing_month);
    const year = Number(values.billing_year);
    const counts = countTicketsByType(dailyTicketEntries, month, year, values.billing_period);
    const effectSubcon = subconDailyTickets
      .filter((e) => {
        const [y, m, d] = e.entry_date.split("-").map(Number);
        if (y !== year || m !== month) return false;
        return values.billing_period === "first_half" ? d <= 15 : d >= 16;
      })
      .reduce((acc, e) => ({ install: acc.install + (e.install_tickets ?? 0), repair: acc.repair + (e.repair_tickets ?? 0) }), { install: 0, repair: 0 });
    setValues((prev) => ({
      ...prev,
      install_tickets: String(counts.installation + effectSubcon.install),
      repair_tickets: String(counts.repair + effectSubcon.repair),
    }));
  }, [values.billing_month, values.billing_year, values.billing_period]);

  const [busy, setBusy] = useState(false);

  const employeeCounts = countTicketsByType(
    dailyTicketEntries,
    Number(values.billing_month),
    Number(values.billing_year),
    values.billing_period,
  );

  const subconTotals = subconDailyTickets
    .filter((e) => {
      const [y, m, d] = e.entry_date.split("-").map(Number);
      if (y !== Number(values.billing_year) || m !== Number(values.billing_month)) return false;
      return values.billing_period === "first_half" ? d <= 15 : d >= 16;
    })
    .reduce((acc, e) => ({
      install: acc.install + (e.install_tickets ?? 0),
      repair: acc.repair + (e.repair_tickets ?? 0),
    }), { install: 0, repair: 0 });

  const installTickets = Math.max(0, Number(values.install_tickets) || 0);
  const repairTickets = Math.max(0, Number(values.repair_tickets) || 0);
  const disputedInstall = Math.min(installTickets, Number(values.disputed_install) || 0);
  const disputedRepair = Math.min(repairTickets, Number(values.disputed_repair) || 0);
  const billableInstall = installTickets - disputedInstall;
  const billableRepair = repairTickets - disputedRepair;
  const billableTickets = billableInstall + billableRepair;
  const billingAmount = billableInstall * settings.installation_rate + billableRepair * settings.repair_rate;
  const collectionsAmount = Math.round(billingAmount * settings.collections_pct / 100 * 100) / 100;
  const collectiblesAmount = Math.round((billingAmount - collectionsAmount) * 100) / 100;
  const collectionPct = settings.collections_pct;
  const payablePct = 100 - collectionPct;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal billing-form-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{initial ? "Edit Billing" : "Create Billing"}</h3>
          <button onClick={onClose} type="button" aria-label="Close"><X size={18} /></button>
        </div>
        <form className="billing-form-body" onSubmit={async (e) => { e.preventDefault(); setBusy(true); await onSubmit(values); setBusy(false); }}>
          <div className="billing-form-fields">
            <label>
              Month
              <select value={values.billing_month} onChange={(e) => setValues({ ...values, billing_month: e.target.value })}>
                {monthNames.map((name, i) => <option key={i} value={String(i + 1)}>{name}</option>)}
              </select>
            </label>
            <label>
              Year
              <input type="number" min="2020" max="2200" value={values.billing_year} onChange={(e) => setValues({ ...values, billing_year: e.target.value })} required />
            </label>
            <label style={{ gridColumn: "1 / -1" }}>
              Period
              <select value={values.billing_period} onChange={(e) => setValues({ ...values, billing_period: e.target.value as BillingFormValues["billing_period"] })}>
                <option value="first_half">1st – 15th</option>
                <option value="second_half">16th – End of month</option>
              </select>
            </label>
          </div>

          <div className="billing-form-tickets">
            <h4 className="billing-form-section-title">Tickets</h4>
            <div className="billing-form-fields">
              <label>
                Installation tickets
                <input type="number" min="0" value={values.install_tickets} onChange={(e) => setValues({ ...values, install_tickets: e.target.value })} />
              </label>
              <label>
                Repair tickets
                <input type="number" min="0" value={values.repair_tickets} onChange={(e) => setValues({ ...values, repair_tickets: e.target.value })} />
              </label>
              <label>
                Disputed installation
                <input type="number" min="0" value={values.disputed_install} onChange={(e) => setValues({ ...values, disputed_install: e.target.value })} />
              </label>
              <label>
                Disputed repair
                <input type="number" min="0" value={values.disputed_repair} onChange={(e) => setValues({ ...values, disputed_repair: e.target.value })} />
              </label>
            </div>
          </div>

          <div className="billing-form-ticket-ref">
            <span className="billing-form-ticket-ref-label">Employee tickets this period</span>
            <div className="billing-form-ticket-ref-row">
              <span>Install: <strong>{employeeCounts.installation}</strong></span>
              <span>Repair: <strong>{employeeCounts.repair}</strong></span>
              <span>Total: <strong>{employeeCounts.installation + employeeCounts.repair}</strong></span>
            </div>
            <span className="billing-form-ticket-ref-label">Subcon tickets this period</span>
            <div className="billing-form-ticket-ref-row">
              <span>Install: <strong>{subconTotals.install}</strong></span>
              <span>Repair: <strong>{subconTotals.repair}</strong></span>
              <span>Total: <strong>{subconTotals.install + subconTotals.repair}</strong></span>
            </div>
            <span className="billing-form-ticket-ref-label" style={{ borderTop: "1px solid var(--color-border, #e5e7eb)", paddingTop: 6, marginTop: 2, fontWeight: 600 }}>Combined total</span>
            <div className="billing-form-ticket-ref-row" style={{ fontWeight: 600 }}>
              <span>Install: <strong>{employeeCounts.installation + subconTotals.install}</strong></span>
              <span>Repair: <strong>{employeeCounts.repair + subconTotals.repair}</strong></span>
              <span>Total: <strong>{employeeCounts.installation + subconTotals.install + employeeCounts.repair + subconTotals.repair}</strong></span>
            </div>
          </div>

          <div className="billing-form-preview">
            <div className="billing-form-preview-row">
              <span>Installation amount</span>
              <strong>{currency.format(billableInstall * settings.installation_rate)}</strong>
            </div>
            <div className="billing-form-preview-row">
              <span>Repair amount</span>
              <strong>{currency.format(billableRepair * settings.repair_rate)}</strong>
            </div>
            <div className="billing-form-preview-row">
              <span>Billable tickets</span>
              <strong>{billableTickets}</strong>
            </div>
            <div className="billing-form-preview-row">
              <span>Total amount</span>
              <strong>{currency.format(billingAmount)}</strong>
            </div>
            <div className="billing-form-preview-row">
              <span>Collection ({collectionPct}%)</span>
              <strong>{currency.format(collectionsAmount)}</strong>
            </div>
            <div className="billing-form-preview-row">
              <span>Payable ({payablePct}%)</span>
              <strong>{currency.format(collectiblesAmount)}</strong>
            </div>
          </div>

          <label>
            Notes
            <textarea rows={2} value={values.notes} onChange={(e) => setValues({ ...values, notes: e.target.value })} />
          </label>

          <div className="form-actions">
            <button className="billing-btn outline" onClick={onClose} type="button">Cancel</button>
            <button className="billing-btn primary" disabled={busy} type="submit">{busy ? "Saving..." : initial ? "Update Billing" : "Create Billing"}</button>
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
      payable_pct: Number(subconForm.payable_pct) || 70,
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

  async function toggleSubconArchive(subcon: Subcontractor) {
    if (!supabase) return;
    const newStatus = subcon.status === "active" ? "archived" : "active";
    await saveSubcontractor(supabase, userId, { id: subcon.id, name: subcon.name, installation_rate: subcon.installation_rate, repair_rate: subcon.repair_rate, payable_pct: subcon.payable_pct, status: newStatus });
    await onChange();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal billing-settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Billing Settings</h3>
          <button onClick={onClose} type="button" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="billing-settings-body">
          <form className="form-grid" onSubmit={async (e) => { e.preventDefault(); setBusy(true); await onSubmit({ installation_rate: Number(installationRate), repair_rate: Number(repairRate), collections_pct: Number(pct), client_name: clientName }); setBusy(false); }}>
            <MoneyField label="Installation rate (PHP per ticket)" value={installationRate} onChange={setInstallationRate} required />
            <MoneyField label="Repair rate (PHP per ticket)" value={repairRate} onChange={setRepairRate} required />
            <label>
              Collections %
              <input type="number" min="0" max="100" value={pct} onChange={(e) => setPct(e.target.value)} required />
            </label>
            <label className="full">
              Client name
              <input type="text" value={clientName} onChange={(e) => setClientName(e.target.value)} />
            </label>
            <div className="form-actions full">
              <button className="billing-btn outline" onClick={onClose} type="button">Cancel</button>
              <button className="billing-btn primary" disabled={busy} type="submit">{busy ? "Saving..." : "Save Settings"}</button>
            </div>
          </form>

          <section className="billing-subcon-settings">
            <div className="billing-subcon-settings-header">
              <h4>Subcontractors</h4>
              <button className="billing-btn outline" onClick={() => setSubconForm({ name: "", installation_rate: "0", repair_rate: "0", payable_pct: "70" })} type="button"><Plus size={14} /> Add</button>
            </div>

            {subcontractors.length === 0 && !subconForm && (
              <p className="billing-no-subcons">No subcontractors yet.</p>
            )}

            {subcontractors.map((s) => (
              <div className="billing-subcon-row" key={s.id}>
                <div className="billing-subcon-info">
                  <strong>{s.name}</strong>
                  <span>Install: {currency.format(s.installation_rate)} · Repair: {currency.format(s.repair_rate)} · Payable: {s.payable_pct}%</span>
                </div>
                <div className="billing-row-actions">
                  <button onClick={() => setSubconForm({ id: s.id, name: s.name, installation_rate: String(s.installation_rate), repair_rate: String(s.repair_rate), payable_pct: String(s.payable_pct) })} type="button" title="Edit"><Pencil size={14} /></button>
                  <button onClick={() => toggleSubconArchive(s)} type="button" title={s.status === "active" ? "Archive" : "Restore"}>
                    {s.status === "active" ? <Trash2 size={14} /> : <Plus size={14} />}
                  </button>
                </div>
              </div>
            ))}

            {subconForm && (
              <div className="billing-subcon-form">
                <label>Name <input type="text" value={subconForm.name} onChange={(e) => setSubconForm({ ...subconForm, name: e.target.value })} required /></label>
                <MoneyField label="Install rate" value={subconForm.installation_rate} onChange={(v) => setSubconForm({ ...subconForm, installation_rate: v })} required />
                <MoneyField label="Repair rate" value={subconForm.repair_rate} onChange={(v) => setSubconForm({ ...subconForm, repair_rate: v })} required />
                <label>Payable % <input type="number" min="0" max="100" value={subconForm.payable_pct} onChange={(e) => setSubconForm({ ...subconForm, payable_pct: e.target.value })} required /></label>
                <div className="billing-subcon-form-actions">
                  <button className="billing-btn outline" onClick={() => setSubconForm(null)} type="button">Cancel</button>
                  <button className="billing-btn primary" disabled={subconBusy || !subconForm.name.trim()} onClick={saveSubcon} type="button">{subconBusy ? "Saving..." : "Save"}</button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
