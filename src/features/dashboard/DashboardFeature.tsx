import { useMemo, type ReactNode } from "react";
import {
  BadgeDollarSign,
  Bell,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  FileText,
  Users,
  Wrench,
} from "lucide-react";
import { expenseOverdueReferenceDate } from "../../domain/expenses";
import { PageHeader } from "../../shared/components/PageLayout";
import { currency, toNumber } from "../../shared/utils/currency";
import { todayKey } from "../../shared/utils/dates";
import type { DailyTicketEntry, DashboardSummary, Employee, SubconDailyTicket } from "../../types";

function DashboardModern({
  dailyTicketEntries,
  employees,
  onOpenLeaderboard,
  onOpenSubcontractorLeaderboard,
  subconDailyTickets,
  summary,
}: {
  dailyTicketEntries: DailyTicketEntry[];
  employees: Employee[];
  onOpenLeaderboard: () => void;
  onOpenSubcontractorLeaderboard: () => void;
  subconDailyTickets: SubconDailyTicket[];
  summary: DashboardSummary;
}) {
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  const latestRun = summary.latestRun;
  const latestRunDate = latestRun
    ? new Date(`${latestRun.generated_date}T00:00:00`).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })
    : "None";

  const actionItems: Array<{ id: string; title: string; amount: number; urgency: "overdue" | "today"; daysInfo: string; kind: "collection" | "bill" | "expense" }> = [];
  const actionKindLabels: Record<"collection" | "bill" | "expense", string> = {
    collection: "Collection",
    bill: "Bill",
    expense: "Expense",
  };

  for (const collection of summary.overdueCollections) {
    const days = Math.max(1, Math.floor((now.getTime() - new Date(collection.due_date).getTime()) / 86400000));
    actionItems.push({ id: collection.id, title: collection.title, amount: toNumber(collection.outstanding_balance), urgency: "overdue", daysInfo: `${days}d overdue`, kind: "collection" });
  }
  for (const payment of summary.overduePayments) {
    const days = Math.max(1, Math.floor((now.getTime() - new Date(payment.due_date).getTime()) / 86400000));
    actionItems.push({ id: payment.id, title: payment.title, amount: toNumber(payment.amount), urgency: "overdue", daysInfo: `${days}d overdue`, kind: "bill" });
  }
  for (const expense of summary.overdueExpenses) {
    const referenceDate = expenseOverdueReferenceDate(expense, todayKey());
    const days = referenceDate ? Math.max(1, Math.floor((now.getTime() - new Date(`${referenceDate}T00:00:00`).getTime()) / 86400000)) : 1;
    actionItems.push({ id: expense.id, title: `${expense.category_name} - ${expense.employee_name}`, amount: toNumber(expense.amount), urgency: "overdue", daysInfo: `${days}d overdue`, kind: "expense" });
  }
  for (const collection of summary.dueTodayCollections) {
    actionItems.push({ id: collection.id, title: collection.title, amount: toNumber(collection.outstanding_balance), urgency: "today", daysInfo: "due today", kind: "collection" });
  }
  for (const payment of summary.dueTodayPayments) {
    actionItems.push({ id: payment.id, title: payment.title, amount: toNumber(payment.amount), urgency: "today", daysInfo: "due today", kind: "bill" });
  }
  for (const expense of summary.dueTodayExpenses) {
    actionItems.push({ id: expense.id, title: `${expense.category_name} - ${expense.employee_name}`, amount: toNumber(expense.amount), urgency: "today", daysInfo: "due today", kind: "expense" });
  }

  const billsDueTotal =
    summary.dueTodayPayments.reduce((sum, payment) => sum + toNumber(payment.amount), 0) +
    summary.overduePayments.reduce((sum, payment) => sum + toNumber(payment.amount), 0) +
    summary.dueTodayExpenses.reduce((sum, expense) => sum + toNumber(expense.amount), 0) +
    summary.overdueExpenses.reduce((sum, expense) => sum + toNumber(expense.amount), 0);
  const billsDueCount =
    summary.dueTodayPayments.length +
    summary.overduePayments.length +
    summary.dueTodayExpenses.length +
    summary.overdueExpenses.length;
  const totalTrackedAmount = summary.pendingCollections + summary.collectedThisMonth + billsDueTotal;
  const chartSegments = [
    {
      color: "#2563eb",
      helper: summary.overdueCollections.length > 0 ? `${summary.overdueCollections.length} overdue invoices` : "All current receivables",
      label: "Receivables",
      value: summary.pendingCollections,
    },
    {
      color: "#059669",
      helper: "Cash collected in the current month",
      label: "Collected",
      value: summary.collectedThisMonth,
    },
    {
      color: "#d97706",
      helper: billsDueCount > 0 ? `${billsDueCount} bills waiting` : "No bills due right now",
      label: "Bills due",
      value: billsDueTotal,
    },
  ];
  const topMetrics = [
    {
      accent: "receivables",
      helper: summary.overdueCollections.length > 0 ? `${summary.overdueCollections.length} overdue to follow up` : "Healthy collection pipeline",
      icon: <CreditCard size={18} />,
      label: "Receivables",
      value: currency.format(summary.pendingCollections),
    },
    {
      accent: "collected",
      helper: "Cash in for this month",
      icon: <CheckCircle2 size={18} />,
      label: "Collected this month",
      value: currency.format(summary.collectedThisMonth),
    },
    {
      accent: "bills",
      helper: billsDueCount > 0 ? `${billsDueCount} unpaid items` : "Nothing due right now",
      icon: <Bell size={18} />,
      label: "Bills due",
      value: currency.format(billsDueTotal),
    },
    {
      accent: "payroll",
      helper: summary.currentPayrollItemCount > 0 ? `${summary.currentPayrollItemCount} payroll item${summary.currentPayrollItemCount === 1 ? "" : "s"} in cycle` : "No current payroll items",
      icon: <Briefcase size={18} />,
      label: "Pending payroll",
      value: currency.format(summary.pendingPayroll),
    },
  ];
  const miniStats = [
    {
      helper: "Workforce base",
      icon: <Users size={16} />,
      label: "Active employees",
      value: String(summary.activeEmployeeCount),
    },
    {
      helper: "In the current payroll cycle",
      icon: <FileText size={16} />,
      label: "Payroll items",
      value: String(summary.currentPayrollItemCount),
    },
    {
      helper: "Require attention",
      icon: <CalendarClock size={16} />,
      label: "Overdue collections",
      value: String(summary.overdueCollections.length),
    },
    {
      helper: "Total overdue value",
      icon: <BadgeDollarSign size={16} />,
      label: "Overdue amount",
      value: currency.format(summary.overdueCollectionBalance),
    },
  ];
  const agingValues = [
    summary.collectionAging.current,
    summary.collectionAging.days1To30,
    summary.collectionAging.days31To60,
    summary.collectionAging.days61To90,
    summary.collectionAging.daysOver90,
  ];
  const agingTotal = agingValues.reduce((sum, value) => sum + value, 0);
  const paidPayrollLabel = summary.paidPayroll > 0 ? currency.format(summary.paidPayroll) : "No paid payroll yet";
  const dashboardHeadline = totalTrackedAmount > 0
    ? `${currency.format(totalTrackedAmount)} is being tracked across receivables, collected cash, and due bills.`
    : "No financial activity is being tracked on the dashboard yet.";
  const snapshotCards: Array<{
    accent: "bills" | "payroll" | "receivables";
    helper: string;
    icon: ReactNode;
    title: string;
    trendValues: number[];
    value: string;
  }> = [
    {
      accent: "receivables",
      helper: `${summary.overdueCollections.length} overdue collection${summary.overdueCollections.length === 1 ? "" : "s"}`,
      icon: <CreditCard size={16} />,
      title: "Collection status",
      trendValues: agingValues.map((value) => value || 0),
      value: agingTotal > 0 && summary.collectionAging.current === agingTotal ? "All current" : "Needs review",
    },
    {
      accent: "payroll",
      helper: summary.pendingPayroll > 0 ? "Current payroll unpaid" : "All current payroll paid",
      icon: <Briefcase size={16} />,
      title: "Payroll progress",
      trendValues: [
        summary.paidPayroll || 0,
        summary.pendingPayroll || 0,
        summary.paidPayroll || 0,
        summary.pendingPayroll || 0,
      ],
      value: paidPayrollLabel,
    },
    {
      accent: "bills",
      helper: billsDueCount > 0 ? `${billsDueCount} due bill${billsDueCount === 1 ? "" : "s"} today` : "No due bills today",
      icon: <BadgeDollarSign size={16} />,
      title: "Expense pressure",
      trendValues: [billsDueTotal || 0, summary.pendingCollections || 0, billsDueTotal || 0, summary.collectedThisMonth || 0],
      value: currency.format(billsDueTotal),
    },
  ];
  const topEmployeeRows = useMemo(() => {
    const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
    const totals = new Map<string, {
      employeeId: string;
      employeeName: string;
      install: number;
      repair: number;
      napRehab: number;
      totalTickets: number;
      earnings: number;
      profilePhotoUrl: string;
    }>();

    for (const entry of dailyTicketEntries) {
      const existing = totals.get(entry.employee_id) ?? {
        employeeId: entry.employee_id,
        employeeName: entry.employee_name,
        install: 0,
        repair: 0,
        napRehab: 0,
        totalTickets: 0,
        earnings: 0,
        profilePhotoUrl: employeeById.get(entry.employee_id)?.profile_photo_url ?? "",
      };
      existing.install += entry.installation_tickets;
      existing.repair += entry.repair_tickets;
      existing.napRehab += toNumber(entry.nap_rehab_tickets);
      existing.totalTickets += entry.installation_tickets + entry.repair_tickets + toNumber(entry.nap_rehab_tickets);
      existing.earnings +=
        entry.installation_tickets * entry.installation_rate +
        entry.repair_tickets * entry.repair_rate +
        toNumber(entry.nap_rehab_tickets) * toNumber(entry.nap_rehab_rate);
      totals.set(entry.employee_id, existing);
    }

    return [...totals.values()]
      .sort((left, right) => right.totalTickets - left.totalTickets || right.earnings - left.earnings || left.employeeName.localeCompare(right.employeeName))
      .slice(0, 5);
  }, [dailyTicketEntries, employees]);
  const topSubcontractorRows = useMemo(() => {
    const totals = new Map<string, {
      subcontractorId: string;
      subcontractorName: string;
      install: number;
      repair: number;
      totalTickets: number;
      earnings: number;
    }>();

    for (const entry of subconDailyTickets) {
      const existing = totals.get(entry.subcontractor_id) ?? {
        subcontractorId: entry.subcontractor_id,
        subcontractorName: entry.subcon_name,
        install: 0,
        repair: 0,
        totalTickets: 0,
        earnings: 0,
      };
      existing.install += entry.install_tickets;
      existing.repair += entry.repair_tickets;
      existing.totalTickets += entry.install_tickets + entry.repair_tickets;
      existing.earnings +=
        entry.install_tickets * entry.installation_rate +
        entry.repair_tickets * entry.repair_rate;
      totals.set(entry.subcontractor_id, existing);
    }

    return [...totals.values()]
      .sort((left, right) => right.totalTickets - left.totalTickets || right.earnings - left.earnings || left.subcontractorName.localeCompare(right.subcontractorName))
      .slice(0, 5);
  }, [subconDailyTickets]);

  return (
    <div className="page-stack dash dash-modern">
      <PageHeader
        eyebrow="Executive dashboard"
        title={greeting}
        text={dateStr}
      />

      <section className="dash-modern-kpis">
        {topMetrics.map((metric) => (
          <article className={`dash-modern-kpi ${metric.accent}`} key={metric.label}>
            <div className={`dash-modern-kpi-icon ${metric.accent}`}>{metric.icon}</div>
            <div className="dash-modern-kpi-text">
              <span className="dash-modern-kpi-label">{metric.label}</span>
              <strong className="dash-modern-kpi-value">{metric.value}</strong>
              <span className="dash-modern-kpi-helper">{metric.helper}</span>
            </div>
          </article>
        ))}
      </section>

      <section className="dash-modern-analytics-grid">
        <article className="dash-modern-card dash-modern-chart-card">
          <div className="dash-modern-card-header">
            <div>
              <span className="dash-modern-section-label">Collections mix</span>
              <h2>Receivables vs cash vs bills</h2>
            </div>
            <span className="dash-modern-card-chip">Live summary</span>
          </div>
          <div className="dash-modern-chart-layout">
            <DashboardDonutChart segments={chartSegments} total={totalTrackedAmount} />
            <div className="dash-modern-chart-legend">
              {chartSegments.map((segment) => {
                const percent = totalTrackedAmount > 0 ? `${Math.round((segment.value / totalTrackedAmount) * 100)}%` : "0%";
                return (
                  <div className="dash-modern-legend-item" key={segment.label}>
                    <span className="dash-modern-legend-dot" style={{ background: segment.color }} />
                    <div className="dash-modern-legend-copy">
                      <span>{segment.label}</span>
                      <small>{segment.helper}</small>
                    </div>
                    <div className="dash-modern-legend-metric">
                      <strong>{currency.format(segment.value)}</strong>
                      <small>{percent}</small>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="dash-modern-mini-stats">
            {miniStats.map((stat) => (
              <div className="dash-modern-mini-stat" key={stat.label}>
                <div className="dash-modern-mini-stat-icon">{stat.icon}</div>
                <div className="dash-modern-mini-stat-copy">
                  <strong>{stat.value}</strong>
                  <span>{stat.label}</span>
                  <small>{stat.helper}</small>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="dash-modern-card dash-modern-insights-card">
          <div className="dash-modern-card-header">
            <div>
              <span className="dash-modern-section-label">Operational snapshot</span>
              <h2>Key signals</h2>
            </div>
          </div>
          <div className="dash-modern-insight-list">
            {snapshotCards.map((card) => (
              <div className="dash-modern-insight-item" key={card.title}>
                <div className={`dash-modern-insight-icon ${card.accent}`}>{card.icon}</div>
                <div className="dash-modern-insight-copy">
                  <span>{card.title}</span>
                  <strong>{card.value}</strong>
                  <small>{card.helper}</small>
                </div>
                <DashboardSparkline accent={card.accent} values={card.trendValues} />
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="dash-modern-bottom-grid">
        <article className="dash-modern-card dash-modern-top-employees">
          <div className="dash-modern-card-header">
            <div>
              <span className="dash-modern-section-label">Leaderboard</span>
              <h2>Top Employees</h2>
            </div>
            <span className="dash-modern-card-chip subtle">Closed tickets</span>
          </div>
          {topEmployeeRows.length === 0 ? (
            <div className="dash-modern-reminders-empty">
              <div className="dash-modern-reminders-empty-icon"><Users size={18} /></div>
              <strong>No closed tickets yet</strong>
              <span>Employee leaderboard will appear once tickets are recorded.</span>
            </div>
          ) : (
            <>
              <div className="dash-modern-top-table-wrap">
                <table className="dash-modern-top-table">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th className="num">Install</th>
                      <th className="num">Repair</th>
                      <th className="num">Total Tickets</th>
                      <th className="num">Total Earnings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topEmployeeRows.map((row) => (
                      <tr key={row.employeeId}>
                        <td data-label="Employee">
                          <div className="dash-modern-top-employee">
                            <div className="dash-modern-top-avatar">
                              {row.profilePhotoUrl ? <img alt="" src={row.profilePhotoUrl} /> : <span>{row.employeeName.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "E"}</span>}
                            </div>
                            <strong>{row.employeeName}</strong>
                          </div>
                        </td>
                        <td className="num" data-label="Install">{row.install}</td>
                        <td className="num" data-label="Repair">{row.repair}</td>
                        <td className="num" data-label="Total Tickets">{row.totalTickets}</td>
                        <td className="num" data-label="Total Earnings">{currency.format(row.earnings)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="dash-modern-top-footer">
                <button className="text-button" onClick={onOpenLeaderboard} type="button">
                  View full leaderboard
                </button>
                <button className="dash-modern-top-link" onClick={onOpenLeaderboard} type="button" aria-label="Open leaderboard">
                  <ChevronRight size={16} />
                </button>
              </div>
            </>
          )}
        </article>

        <article className="dash-modern-card dash-modern-top-subcontractors">
          <div className="dash-modern-card-header">
            <div>
              <span className="dash-modern-section-label">Partner leaderboard</span>
              <h2>Top Subcontractors</h2>
            </div>
            <span className="dash-modern-card-chip subtle">Closed tickets</span>
          </div>
          {topSubcontractorRows.length === 0 ? (
            <div className="dash-modern-reminders-empty">
              <div className="dash-modern-reminders-empty-icon"><Wrench size={18} /></div>
              <strong>No subcontractor tickets yet</strong>
              <span>Subcontractor leaderboard will appear once tickets are recorded.</span>
            </div>
          ) : (
            <>
              <div className="dash-modern-top-table-wrap">
                <table className="dash-modern-top-table">
                  <thead>
                    <tr>
                      <th>Subcontractor</th>
                      <th className="num">Install</th>
                      <th className="num">Repair</th>
                      <th className="num">Total Tickets</th>
                      <th className="num">Total Earnings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topSubcontractorRows.map((row) => (
                      <tr key={row.subcontractorId}>
                        <td data-label="Subcontractor">
                          <div className="dash-modern-top-employee">
                            <div className="dash-modern-top-avatar dash-modern-top-avatar-subcon">
                              <span>{row.subcontractorName.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "S"}</span>
                            </div>
                            <strong>{row.subcontractorName}</strong>
                          </div>
                        </td>
                        <td className="num" data-label="Install">{row.install}</td>
                        <td className="num" data-label="Repair">{row.repair}</td>
                        <td className="num" data-label="Total Tickets">{row.totalTickets}</td>
                        <td className="num" data-label="Total Earnings">{currency.format(row.earnings)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="dash-modern-top-footer">
                <button className="text-button" onClick={onOpenSubcontractorLeaderboard} type="button">
                  View subcontractor leaderboard
                </button>
                <button className="dash-modern-top-link" onClick={onOpenSubcontractorLeaderboard} type="button" aria-label="Open subcontractor leaderboard">
                  <ChevronRight size={16} />
                </button>
              </div>
            </>
          )}
        </article>
      </section>
    </div>
  );
}

function DashboardSparkline({
  accent,
  values,
}: {
  accent: "bills" | "collected" | "payroll" | "receivables";
  values: number[];
}) {
  const safeValues = values.length > 1 ? values : [0, 0, 0, 0];
  const max = Math.max(...safeValues, 1);
  const points = safeValues.map((value, index) => {
    const x = (index / (safeValues.length - 1)) * 96;
    const y = 36 - (value / max) * 28;
    return `${x},${y}`;
  }).join(" ");
  const areaPoints = `0,36 ${points} 96,36`;

  return (
    <svg className={`dash-modern-sparkline ${accent}`} viewBox="0 0 96 36" aria-hidden="true">
      <polygon className="dash-modern-sparkline-area" points={areaPoints} />
      <polyline className="dash-modern-sparkline-line" points={points} />
    </svg>
  );
}

function DashboardDonutChart({
  segments,
  total,
}: {
  segments: Array<{ color: string; label: string; value: number }>;
  total: number;
}) {
  const radius = 72;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="dash-modern-donut-wrap" role="img" aria-label="Collections mix chart">
      <svg className="dash-modern-donut" viewBox="0 0 220 220">
        <defs>
          <filter id="dash-modern-donut-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="rgba(15, 23, 42, 0.14)" />
          </filter>
        </defs>
        <circle className="dash-modern-donut-track" cx="110" cy="110" r={radius} />
        {total > 0 ? segments.map((segment) => {
          const segmentLength = (segment.value / total) * circumference;
          const circle = (
            <circle
              key={segment.label}
              className="dash-modern-donut-segment"
              cx="110"
              cy="110"
              r={radius}
              stroke={segment.color}
              strokeDasharray={`${segmentLength} ${circumference - segmentLength}`}
              strokeDashoffset={-offset}
            />
          );
          offset += segmentLength;
          return circle;
        }) : null}
        <circle className="dash-modern-donut-center-ring" cx="110" cy="110" r="48" filter="url(#dash-modern-donut-shadow)" />
      </svg>
      <div className="dash-modern-donut-center">
        <span>{total > 0 ? "Tracked total" : "No data"}</span>
        <strong>{total > 0 ? currency.format(total) : "Waiting for activity"}</strong>
      </div>
    </div>
  );
}


export default DashboardModern;
