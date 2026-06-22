import { useEffect, useMemo, useState } from "react";
import { FileText, Plus, Settings, Trash2 } from "lucide-react";
import { computeBilling, countTicketsForMonth, lastDayOfMonth } from "../../domain/billing";
import type { PendingMutation } from "../../lib/offlineDb";
import { isOfflineLikeError } from "../../lib/offlineSync";
import { supabase } from "../../supabase";
import type {
  BillingFormValues,
  BillingRecord,
  BillingSettings,
  CollectionReminder,
  DailyTicketEntry,
} from "../../types";
import {
  deleteBillingRecord,
  ensureBillingSettings,
  saveBillingRecord,
  saveBillingSettings,
} from "./billingRepository";

type Notice = { type: "success" | "error"; text: string } | null;
type QueueOfflineMutation = (mutation: Omit<PendingMutation, "id" | "createdAt" | "status" | "attempts" | "userId">) => Promise<void>;

const currency = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const currentMonth = () => new Date().getMonth() + 1;
const currentYear = () => new Date().getFullYear();
const todayKey = () => new Date().toISOString().slice(0, 10);

export type BillingFeatureProps = {
  billingRecords: BillingRecord[];
  billingSettings: BillingSettings | null;
  collections: CollectionReminder[];
  dailyTicketEntries: DailyTicketEntry[];
  onChange: () => Promise<void>;
  onLocalBillingRecordsChange: (records: BillingRecord[]) => void;
  onQueueOfflineMutation: QueueOfflineMutation;
  setNotice: (notice: Notice) => void;
  userId: string;
};

export function BillingFeature({
  billingRecords,
  billingSettings,
  collections,
  dailyTicketEntries,
  onChange,
  onLocalBillingRecordsChange,
  onQueueOfflineMutation,
  setNotice,
  userId,
}: BillingFeatureProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<BillingSettings | null>(billingSettings);

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

  async function createBilling(values: BillingFormValues) {
    if (!supabase || !settings) return;
    const month = Number(values.billing_month);
    const year = Number(values.billing_year);
    const totalTickets = countTicketsForMonth(dailyTicketEntries, month, year);
    const disputed = Math.max(0, Math.min(totalTickets, Number(values.disputed_tickets) || 0));
    const billing = computeBilling(totalTickets, disputed, settings.billing_rate, settings.collections_pct);

    const existing = billingRecords.find((r) => r.billing_month === month && r.billing_year === year);
    if (existing) {
      setNotice({ type: "error", text: `Billing for ${monthNames[month - 1]} ${year} already exists.` });
      return;
    }

    const collectionId = crypto.randomUUID();
    const billingId = crypto.randomUUID();
    const collectionPayload = {
      id: collectionId,
      user_id: userId,
      title: `Billing ${monthNames[month - 1]} ${year}`,
      client_name: settings.client_name || "Client",
      external_reference: "",
      issue_date: todayKey(),
      amount: billing.collectionsAmount,
      due_date: lastDayOfMonth(month, year),
      status: "pending" as const,
      notes: `Auto-created from billing ${monthNames[month - 1]} ${year}.`,
    };
    const billingPayload: Omit<BillingRecord, "created_at" | "updated_at"> = {
      id: billingId,
      user_id: userId,
      billing_month: month,
      billing_year: year,
      total_tickets: totalTickets,
      disputed_tickets: disputed,
      billable_tickets: billing.billableTickets,
      billing_rate: settings.billing_rate,
      billing_amount: billing.billingAmount,
      collections_pct: settings.collections_pct,
      collections_amount: billing.collectionsAmount,
      collectibles_amount: billing.collectiblesAmount,
      collection_id: collectionId,
      notes: values.notes.trim(),
    };

    if (!navigator.onLine) {
      const optimistic = { ...billingPayload, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as BillingRecord;
      onLocalBillingRecordsChange([optimistic, ...billingRecords]);
      await onQueueOfflineMutation({
        resource: "billingRecords",
        affectedResources: ["billingRecords", "collections", "dashboardSummary"],
        operation: "billing_group",
        table: "billing_records",
        recordId: billingId,
        payload: { billingPayload, collectionPayload },
      });
      setFormOpen(false);
      setNotice({ type: "success", text: `Billing for ${monthNames[month - 1]} ${year} created.` });
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
          payload: { billingPayload, collectionPayload },
        });
        setFormOpen(false);
        return;
      }
      setNotice({ type: "error", text: collectionResult.error.message ?? "Failed to create receivable." });
      return;
    }

    const billingResult = await saveBillingRecord(supabase, billingPayload);
    if (billingResult.error) {
      setNotice({ type: "error", text: (billingResult.error as { message?: string }).message ?? "Failed to save billing record." });
      return;
    }

    setFormOpen(false);
    setNotice({ type: "success", text: `Billing for ${monthNames[month - 1]} ${year} created.` });
    await onChange();
  }

  async function removeBilling(record: BillingRecord) {
    if (!supabase) return;
    const result = await deleteBillingRecord(supabase, record.id, record.collection_id);
    if (result.error) {
      setNotice({ type: "error", text: (result.error as { message?: string }).message ?? "Failed to delete billing." });
      return;
    }
    setNotice({ type: "success", text: "Billing record deleted." });
    await onChange();
  }

  async function updateSettings(rate: number, pct: number, clientName: string) {
    if (!supabase) return;
    const result = await saveBillingSettings(supabase, userId, { billing_rate: rate, collections_pct: pct, client_name: clientName });
    if (result.error) {
      setNotice({ type: "error", text: "Failed to save settings." });
      return;
    }
    setSettings((prev) => prev ? { ...prev, billing_rate: rate, collections_pct: pct, client_name: clientName } : prev);
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
    <div className="stack">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Monthly invoicing</p>
          <h2>Billing</h2>
        </div>
        <div className="inline-actions">
          <button className="secondary-button compact" onClick={() => setSettingsOpen(true)} type="button">
            <Settings size={15} /> Settings
          </button>
          <button className="primary-button compact" onClick={() => setFormOpen(true)} type="button">
            <Plus size={15} /> Create billing
          </button>
        </div>
      </div>
      <div className="stats-row">
        <div className="stat-card"><span>Total billed</span><strong>{currency.format(summary.totalBilled)}</strong></div>
        <div className="stat-card"><span>Collections ({settings?.collections_pct ?? 70}%)</span><strong>{currency.format(summary.totalCollections)}</strong></div>
        <div className="stat-card"><span>Collectibles ({100 - (settings?.collections_pct ?? 70)}%)</span><strong>{currency.format(summary.totalCollectibles)}</strong></div>
      </div>
      {billingRecords.length === 0 ? (
        <p className="muted-text">No billing records yet. Create your first monthly billing above.</p>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Month/Year</th>
                <th>Total Tickets</th>
                <th>Disputed</th>
                <th>Billable</th>
                <th>Billing Amount</th>
                <th>Collections</th>
                <th>Collectibles</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {billingRecords.map((record) => (
                <tr key={record.id}>
                  <td><strong>{monthNames[record.billing_month - 1]} {record.billing_year}</strong></td>
                  <td>{record.total_tickets}</td>
                  <td>{record.disputed_tickets}</td>
                  <td>{record.billable_tickets}</td>
                  <td>{currency.format(record.billing_amount)}</td>
                  <td>{currency.format(record.collections_amount)}</td>
                  <td>{currency.format(record.collectibles_amount)}</td>
                  <td><span className={`badge ${collectionStatusFor(record)}`}>{collectionStatusFor(record)}</span></td>
                  <td>
                    <button className="secondary-button compact" onClick={() => removeBilling(record)} type="button" title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {formOpen && settings && (
        <BillingForm
          dailyTicketEntries={dailyTicketEntries}
          settings={settings}
          onClose={() => setFormOpen(false)}
          onSubmit={createBilling}
        />
      )}
      {settingsOpen && settings && (
        <SettingsPanel
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSubmit={updateSettings}
        />
      )}
    </div>
  );
}

function BillingForm({
  dailyTicketEntries,
  settings,
  onClose,
  onSubmit,
}: {
  dailyTicketEntries: DailyTicketEntry[];
  settings: BillingSettings;
  onClose: () => void;
  onSubmit: (values: BillingFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState<BillingFormValues>({
    billing_month: String(currentMonth()),
    billing_year: String(currentYear()),
    disputed_tickets: "0",
    notes: "",
  });
  const [busy, setBusy] = useState(false);

  const totalTickets = countTicketsForMonth(dailyTicketEntries, Number(values.billing_month), Number(values.billing_year));
  const preview = computeBilling(totalTickets, Number(values.disputed_tickets) || 0, settings.billing_rate, settings.collections_pct);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Create Monthly Billing</h3>
          <button onClick={onClose} type="button">&times;</button>
        </div>
        <form className="form-grid" onSubmit={async (e) => { e.preventDefault(); setBusy(true); await onSubmit(values); setBusy(false); }}>
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
          <div className="full detail-row">
            <div><span className="muted-text">Total tickets</span><strong>{totalTickets}</strong></div>
            <div><span className="muted-text">Rate</span><strong>{currency.format(settings.billing_rate)}/ticket</strong></div>
          </div>
          <label>
            Disputed tickets
            <input type="number" min="0" max={totalTickets} value={values.disputed_tickets} onChange={(e) => setValues({ ...values, disputed_tickets: e.target.value })} />
          </label>
          <div className="full detail-row">
            <div><span className="muted-text">Billable</span><strong>{preview.billableTickets}</strong></div>
            <div><span className="muted-text">Billing amount</span><strong>{currency.format(preview.billingAmount)}</strong></div>
          </div>
          <div className="full detail-row">
            <div><span className="muted-text">Collections ({settings.collections_pct}%)</span><strong>{currency.format(preview.collectionsAmount)}</strong></div>
            <div><span className="muted-text">Collectibles ({100 - settings.collections_pct}%)</span><strong>{currency.format(preview.collectiblesAmount)}</strong></div>
          </div>
          <label className="full">
            Notes
            <textarea rows={3} value={values.notes} onChange={(e) => setValues({ ...values, notes: e.target.value })} />
          </label>
          <div className="form-actions full">
            <button className="secondary-button" onClick={onClose} type="button">Cancel</button>
            <button className="primary-button" disabled={busy || totalTickets === 0} type="submit">{busy ? "Saving..." : "Create Billing"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SettingsPanel({
  settings,
  onClose,
  onSubmit,
}: {
  settings: BillingSettings;
  onClose: () => void;
  onSubmit: (rate: number, pct: number, clientName: string) => Promise<void>;
}) {
  const [rate, setRate] = useState(String(settings.billing_rate));
  const [pct, setPct] = useState(String(settings.collections_pct));
  const [clientName, setClientName] = useState(settings.client_name);
  const [busy, setBusy] = useState(false);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Billing Settings</h3>
          <button onClick={onClose} type="button">&times;</button>
        </div>
        <form className="form-grid" onSubmit={async (e) => { e.preventDefault(); setBusy(true); await onSubmit(Number(rate), Number(pct), clientName); setBusy(false); }}>
          <label>
            Billing rate (PHP per ticket)
            <input type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} required />
          </label>
          <label>
            Collections %
            <input type="number" min="0" max="100" value={pct} onChange={(e) => setPct(e.target.value)} required />
          </label>
          <label className="full">
            Client name
            <input type="text" value={clientName} onChange={(e) => setClientName(e.target.value)} />
          </label>
          <div className="form-actions full">
            <button className="secondary-button" onClick={onClose} type="button">Cancel</button>
            <button className="primary-button" disabled={busy} type="submit">{busy ? "Saving..." : "Save Settings"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
