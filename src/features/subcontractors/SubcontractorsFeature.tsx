import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, Pencil, Plus, ReceiptText, Ticket, Trash2, WalletCards, X } from "lucide-react";
import {
  billingPeriodLabel,
  buildSubcontractorAccountSummary,
  filterSubcontractorDailyTickets,
} from "../../domain/billing";
import { markSubconPaymentReminderPaid, saveSubcontractor } from "../billing/billingRepository";
import { supabase } from "../../supabase";
import { DataTable } from "../../shared/components/DataTable";
import { MoneyField } from "../../shared/components/MoneyField";
import { PageHeader, Toolbar } from "../../shared/components/PageLayout";
import { StatusBadge } from "../../shared/components/StatusBadge";
import type { Notice } from "../../shared/types";
import { currency } from "../../shared/utils/currency";
import { monthNames, todayKey } from "../../shared/utils/dates";
import type { BillingPeriod, BillingRecord, PaymentReminder, SubconDailyTicket, Subcontractor } from "../../types";

type AccountTab = "daily" | "billing" | "payouts";

export function SubcontractorsFeature({
  billingRecords,
  initialTab,
  onChange,
  onSelectSubcontractor,
  payments,
  selectedSubcontractorId,
  setNotice,
  subconDailyTickets,
  subcontractors,
  userId,
}: {
  billingRecords: BillingRecord[];
  initialTab?: AccountTab;
  onChange: () => Promise<void>;
  onSelectSubcontractor: (subcontractorId: string) => void;
  payments: PaymentReminder[];
  selectedSubcontractorId: string | null;
  setNotice: (notice: Notice) => void;
  subconDailyTickets: SubconDailyTicket[];
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

  const filtered = useMemo(() => {
    return subcontractors.filter((subcontractor) =>
      subcontractor.name.toLowerCase().includes(query.toLowerCase()),
    );
  }, [query, subcontractors]);

  const selected = useMemo(() => {
    return subcontractors.find((subcontractor) => subcontractor.id === selectedSubcontractorId)
      ?? filtered[0]
      ?? null;
  }, [filtered, selectedSubcontractorId, subcontractors]);

  useEffect(() => {
    if (!selectedSubcontractorId && filtered[0]) {
      onSelectSubcontractor(filtered[0].id);
    }
  }, [filtered, onSelectSubcontractor, selectedSubcontractorId]);

  const listRows = useMemo(() => {
    return filtered.map((subcontractor) => {
      const account = buildSubcontractorAccountSummary({
        subcontractor,
        billingRecords,
        dailyTickets: subconDailyTickets,
        payments,
      });
      return { subcontractor, pending: account.netPending, tickets: account.ticketsThisPeriod };
    });
  }, [billingRecords, filtered, payments, subconDailyTickets]);

  async function toggleArchive(subcontractor: Subcontractor) {
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
    setNotice({ type: "success", text: nextStatus === "archived" ? "Subcontractor archived." : "Subcontractor restored." });
    await onChange();
  }

  async function markPaymentPaid(payment: PaymentReminder) {
    if (!supabase) return;
    const result = await markSubconPaymentReminderPaid(supabase, payment.id);
    if (result.error) {
      setNotice({ type: "error", text: (result.error as { message?: string }).message ?? "Failed to mark payout paid." });
      return;
    }
    setNotice({ type: "success", text: `Marked ${payment.title} payout paid.` });
    await onChange();
  }

  async function markLatestPendingPaid() {
    if (!selected) return;
    const latestPending = payments
      .filter((payment) => payment.type === "subcontractor" && payment.subcontractor_id === selected.id && payment.status === "pending")
      .sort((a, b) =>
        `${b.billing_year ?? 0}-${String(b.billing_month ?? 0).padStart(2, "0")}-${b.billing_period ?? ""}`.localeCompare(
          `${a.billing_year ?? 0}-${String(a.billing_month ?? 0).padStart(2, "0")}-${a.billing_period ?? ""}`,
        ),
      )[0];
    if (!latestPending) return;
    await markPaymentPaid(latestPending);
  }

  return (
    <div className="page-stack subcon-workspace-page">
      <PageHeader
        eyebrow="Partner accounts"
        title="Subcontractors"
        text="Review each subcontractor's ticket history, net payable, and payout status in one workspace."
        action={(
          <button className="primary-button compact" onClick={() => { setEditing(null); setFormOpen(true); }} type="button">
            <Plus size={16} />
            Add subcontractor
          </button>
        )}
      />

      <div className="subcon-workspace">
        <aside className="subcon-rail">
          <Toolbar query={query} setQuery={setQuery} />
          <div className="subcon-rail-list">
            {listRows.length === 0 ? (
              <div className="subcon-empty-state">
                <p>No subcontractors found.</p>
                <span>Try a different search or add a new subcontractor.</span>
              </div>
            ) : (
              listRows.map(({ subcontractor, pending, tickets }) => (
                <button
                  className={selected?.id === subcontractor.id ? "subcon-rail-card active" : "subcon-rail-card"}
                  key={subcontractor.id}
                  onClick={() => onSelectSubcontractor(subcontractor.id)}
                  type="button"
                >
                  <div className="subcon-rail-card-head">
                    <strong>{subcontractor.name}</strong>
                    <StatusBadge status={subcontractor.status} />
                  </div>
                  <div className="subcon-rail-card-meta">
                    <span>{tickets} tickets this period</span>
                    <strong>{currency.format(pending)}</strong>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="subcon-account-panel">
          {!selected ? (
            <div className="billing-empty">
              <WalletCards size={32} />
              <p>Select a subcontractor</p>
              <span>Select a subcontractor to view tickets, net pay, and payout status.</span>
            </div>
          ) : (
            <SubcontractorAccountPanel
              billingRecords={billingRecords}
              onArchive={toggleArchive}
              onEdit={(subcontractor) => { setEditing(subcontractor); setFormOpen(true); }}
              onMarkPaymentPaid={markPaymentPaid}
              onMarkLatestPendingPaid={markLatestPendingPaid}
              onOpenBillingRow={setDrawerRow}
              payments={payments}
              selected={selected}
              setTab={setTab}
              subconDailyTickets={subconDailyTickets}
              tab={tab}
            />
          )}
        </section>
      </div>

      {formOpen && (
        <SubcontractorProfileModal
          initial={editing}
          onClose={() => setFormOpen(false)}
          onSaved={async () => {
            setFormOpen(false);
            await onChange();
          }}
          setNotice={setNotice}
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
    </div>
  );
}

function SubcontractorAccountPanel({
  billingRecords,
  onArchive,
  onEdit,
  onMarkLatestPendingPaid,
  onMarkPaymentPaid,
  onOpenBillingRow,
  payments,
  selected,
  setTab,
  subconDailyTickets,
  tab,
}: {
  billingRecords: BillingRecord[];
  onArchive: (subcontractor: Subcontractor) => Promise<void>;
  onEdit: (subcontractor: Subcontractor) => void;
  onMarkLatestPendingPaid: () => Promise<void>;
  onMarkPaymentPaid: (payment: PaymentReminder) => Promise<void>;
  onOpenBillingRow: (row: BillingRecord["subcon_items"][number] & { billing_month: number; billing_year: number; billing_period: BillingPeriod }) => void;
  payments: PaymentReminder[];
  selected: Subcontractor;
  setTab: (tab: AccountTab) => void;
  subconDailyTickets: SubconDailyTicket[];
  tab: AccountTab;
}) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [periodFilter, setPeriodFilter] = useState<"all" | BillingPeriod>("all");
  const [activeCalendar, setActiveCalendar] = useState<"start" | "end" | null>(null);
  const [calendarYear, setCalendarYear] = useState(() => Number(todayKey().split("-")[0]));
  const [calendarMonth, setCalendarMonth] = useState(() => Number(todayKey().split("-")[1]));
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
  }), [billingRecords, payments, selected, subconDailyTickets]);

  const filteredTickets = useMemo(() => {
    return filterSubcontractorDailyTickets(subconDailyTickets, selected.id, startDate || undefined, endDate || undefined)
      .filter((entry) => isMatchingPeriod(entry.entry_date))
      .sort((a, b) => b.entry_date.localeCompare(a.entry_date));
  }, [endDate, periodFilter, selected.id, startDate, subconDailyTickets]);

  const subconPayments = useMemo(() => {
    return payments
      .filter((payment) => payment.type === "subcontractor" && payment.subcontractor_id === selected.id)
      .sort((a, b) =>
        `${b.billing_year ?? 0}-${String(b.billing_month ?? 0).padStart(2, "0")}-${b.billing_period ?? ""}`.localeCompare(
          `${a.billing_year ?? 0}-${String(a.billing_month ?? 0).padStart(2, "0")}-${a.billing_period ?? ""}`,
        ),
      );
  }, [payments, selected.id]);

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
      .filter((payment) => payment.status === "pending")
      .reduce((sum, payment) => sum + payment.amount, 0);
    const pendingFromUntrackedBilling = billingRows
      .filter((row) => !filteredPaymentByItemId.has(row.id))
      .reduce((sum, row) => sum + row.payable_amount, 0);
    const paidThisMonth = filteredPayments
      .filter((payment) => payment.status === "paid")
      .reduce((sum, payment) => sum + payment.amount, 0);

    return {
      ...summary,
      billingRows,
      lastPayoutStatus: filteredPayments[0]?.status ?? "none",
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
    <>
      <div className="subcon-account-header">
        <div>
          <p className="eyebrow">Subcontractor account</p>
          <h2>{selected.name}</h2>
        </div>
        <div className="subcon-account-actions">
          <button className="secondary-button compact" onClick={() => onEdit(selected)} type="button"><Pencil size={16} /> Edit profile</button>
          <button className="secondary-button compact" onClick={() => void onArchive(selected)} type="button">
            {selected.status === "active" ? <><Trash2 size={16} /> Archive</> : <><Plus size={16} /> Restore</>}
          </button>
          <button className="primary-button compact" disabled={displaySummary.netPending <= 0} onClick={() => void onMarkLatestPendingPaid()} type="button">
            <CheckCircle2 size={16} />
            Mark latest payout paid
          </button>
        </div>
      </div>

      <div className="subcon-kpi-grid">
        <KpiCard icon={<Ticket size={18} />} label="Tickets this period" value={String(displaySummary.ticketsThisPeriod)} />
        <KpiCard icon={<WalletCards size={18} />} label="Net pending" value={currency.format(displaySummary.netPending)} emphasis />
        <KpiCard icon={<CheckCircle2 size={18} />} label="Paid this month" value={currency.format(displaySummary.paidThisMonth)} />
        <KpiCard icon={<ReceiptText size={18} />} label="Last payout status" value={displaySummary.lastPayoutStatus || "No payouts yet"} />
      </div>

      <div className="page-tabs subcon-account-tabs" role="tablist">
        <button className={tab === "daily" ? "active" : ""} onClick={() => setTab("daily")} role="tab" type="button">Daily Tickets</button>
        <button className={tab === "billing" ? "active" : ""} onClick={() => setTab("billing")} role="tab" type="button">Billing & Net</button>
        <button className={tab === "payouts" ? "active" : ""} onClick={() => setTab("payouts")} role="tab" type="button">Payouts</button>
      </div>

      {tab === "daily" && (
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
            rows={filteredTickets.map((entry) => [
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
        </div>
      )}

      {tab === "billing" && (
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
                ? <StatusBadge key={`${row.id}-status`} status={payment.status} />
                : <span className="subcon-missing-payment"><AlertTriangle size={14} /> Missing payout</span>,
            ];
          })}
        />
      )}

      {tab === "payouts" && (
        <DataTable
          empty="No payout records yet."
          headers={["Period", "Net amount", "Due date", "Status", "Paid date", "Notes", "Action"]}
          rows={subconPayments.map((payment) => [
            payment.billing_month != null
              ? `${monthNames[payment.billing_month - 1]} ${payment.billing_year} · ${billingPeriodLabel(payment.billing_period!)}`
              : payment.notes || "—",
            <strong className="subcon-net-value" key={`${payment.id}-net`}>{currency.format(payment.amount)}</strong>,
            payment.due_date,
            <StatusBadge key={`${payment.id}-status`} status={payment.status} />,
            payment.status === "paid" ? payment.updated_at.slice(0, 10) : "—",
            payment.notes || "—",
            payment.status === "pending"
              ? <button className="secondary-button compact" key={`${payment.id}-action`} onClick={() => void onMarkPaymentPaid(payment)} type="button">Mark paid</button>
              : "—",
          ])}
        />
      )}
    </>
  );
}

function KpiCard({ emphasis, icon, label, value }: { emphasis?: boolean; icon: ReactNode; label: string; value: string }) {
  return (
    <div className={emphasis ? "subcon-kpi-card emphasis" : "subcon-kpi-card"}>
      <div className="subcon-kpi-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SubcontractorProfileModal({
  initial,
  onClose,
  onSaved,
  setNotice,
  userId,
}: {
  initial: Subcontractor | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  setNotice: (notice: Notice) => void;
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
      setNotice({ type: "error", text: (result.error as { message?: string }).message ?? "Failed to save subcontractor." });
      return;
    }
    setNotice({ type: "success", text: initial ? "Subcontractor updated." : "Subcontractor added." });
    await onSaved();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h3>{initial ? "Edit subcontractor" : "Add subcontractor"}</h3>
          <button onClick={onClose} type="button" aria-label="Close"><X size={18} /></button>
        </div>
        <form className="form-grid" onSubmit={handleSubmit} style={{ padding: 20 }}>
          <label className="full">
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
          <div className="form-actions full">
            <button className="secondary-button" onClick={onClose} type="button">Cancel</button>
            <button className="primary-button" disabled={busy} type="submit">{busy ? "Saving..." : initial ? "Update" : "Add"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
