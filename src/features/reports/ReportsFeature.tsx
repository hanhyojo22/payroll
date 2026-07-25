import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BarChart3,
  CalendarRange,
  Download,
  FileDown,
  FileSpreadsheet,
  Filter,
  Printer,
  ReceiptText,
  Search,
  Ticket,
  TrendingUp,
  Users,
} from "lucide-react";
import { collectionStatus } from "../../domain/collections";
import {
  expenseDisplayStatus,
  expensePaymentsTotal,
  expenseRemainingBalance,
  expenseTotalAmount,
  isExpenseOverdue,
} from "../../domain/expenses";
import { PageHeader } from "../../shared/components/PageLayout";
import { NotificationService } from "../../shared/notifications/NotificationService";
import { currency, formatMoney } from "../../shared/utils/currency";
import { monthNames, todayKey } from "../../shared/utils/dates";
import type {
  BillingRecord,
  BillingSettings,
  CollectionReminder,
  DailyTicketEntry,
  Employee,
  Expense,
  PayrollHistoryRow,
  SubconDailyTicket,
} from "../../types";

type ReportKey = "payroll" | "billing" | "collections" | "tickets" | "expenses";
type SortDirection = "asc" | "desc";

type FilterState = {
  endDate: string;
  entity: string;
  query: string;
  startDate: string;
  status: string;
};

type TableColumn<Row> = {
  align?: "left" | "right";
  id: string;
  label: string;
  render?: (row: Row) => ReactNode;
  sortValue?: (row: Row) => number | string;
};

type SummaryMetric = {
  helper: string;
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger";
  value: string;
};

type TrendPoint = {
  label: string;
  value: number;
};

type BreakdownPoint = {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger";
  value: number;
};

type TrendVariant = "bars" | "line";

type OverviewMetric = {
  daily: string;
  icon: "money" | "collections" | "tickets" | "subcon";
  label: string;
  monthly: string;
  weekly: string;
};

type PayrollReportRow = PayrollHistoryRow & {
  employeeStatus: string;
};

type BillingReportRow = BillingRecord & {
  billedOn: string;
  clientName: string;
  statusLabel: string;
};

type CollectionReportRow = CollectionReminder & {
  statusLabel: string;
};

type TicketReportRow = DailyTicketEntry & {
  disputedTickets: number;
  grossValue: number;
  statusLabel: string;
  totalTickets: number;
};

type ExpenseReportRow = Expense & {
  displayAmount: number;
  ownerName: string;
  paidAmount: number;
  remainingAmount: number;
  reportDate: string;
  statusLabel: string;
};

const REPORT_TABS: { description: string; key: ReportKey; label: string }[] = [
  { key: "payroll", label: "Payroll Report", description: "Net pay, deductions, payout completion, and department trends." },
  { key: "billing", label: "Billing Report", description: "Invoice totals, collectible balances, and billing cycle performance." },
  { key: "collections", label: "Collection Report", description: "Customer aging, cash recovery, and receivable progress." },
  { key: "tickets", label: "Closed Ticket Report", description: "Closed ticket volume, disputes, and employee output patterns." },
  { key: "expenses", label: "Expense Report", description: "Expense totals, payment progress, category mix, and overdue exposure." },
];

const defaultFilters = (): Record<ReportKey, FilterState> => {
  const endDate = todayKey();
  const startDate = `${endDate.slice(0, 4)}-01-01`;
  return {
    payroll: { startDate, endDate, entity: "all", status: "all", query: "" },
    billing: { startDate, endDate, entity: "all", status: "all", query: "" },
    collections: { startDate, endDate, entity: "all", status: "all", query: "" },
    tickets: { startDate, endDate, entity: "all", status: "all", query: "" },
    expenses: { startDate, endDate, entity: "all", status: "all", query: "" },
  };
};

const defaultSorts: Record<ReportKey, { column: string; direction: SortDirection }> = {
  payroll: { column: "processedDate", direction: "desc" },
  billing: { column: "billedOn", direction: "desc" },
  collections: { column: "due_date", direction: "desc" },
  tickets: { column: "entry_date", direction: "desc" },
  expenses: { column: "reportDate", direction: "desc" },
};

const REPORTS_PAGE_SIZE = 10;

export function ReportsFeature({
  billingRecords,
  billingSettings,
  collections,
  dailyTicketEntries,
  employees,
  expenses,
  payrollHistoryRows,
  subconDailyTickets,
}: {
  billingRecords: BillingRecord[];
  billingSettings: BillingSettings | null;
  collections: CollectionReminder[];
  dailyTicketEntries: DailyTicketEntry[];
  employees: Employee[];
  expenses: Expense[];
  payrollHistoryRows: PayrollHistoryRow[];
  subconDailyTickets: SubconDailyTicket[];
}) {
  const [activeReport, setActiveReport] = useState<ReportKey>("payroll");
  const [filters, setFilters] = useState<Record<ReportKey, FilterState>>(defaultFilters);
  const [pages, setPages] = useState<Record<ReportKey, number>>({
    payroll: 1,
    billing: 1,
    collections: 1,
    tickets: 1,
    expenses: 1,
  });
  const [sorts, setSorts] = useState(defaultSorts);
  const employeeStatusByName = useMemo(
    () =>
      new Map(
        employees.map((employee) => [
          employee.full_name,
          employee.status === "active" ? "Active" : "Inactive",
        ]),
      ),
    [employees],
  );
  const collectionsById = useMemo(() => new Map(collections.map((collection) => [collection.id, collection])), [collections]);

  const payrollRows = useMemo<PayrollReportRow[]>(
    () =>
      payrollHistoryRows.map((row) => ({
        ...row,
        employeeStatus: employeeStatusByName.get(row.employeeName) ?? "Unknown",
      })),
    [employeeStatusByName, payrollHistoryRows],
  );

  const billingRows = useMemo<BillingReportRow[]>(
    () =>
      billingRecords.map((record) => {
        const relatedCollection = collectionsById.get(record.collection_id ?? "") ?? collectionsById.get(record.collectibles_collection_id ?? "");
        const currentCollectionStatus = relatedCollection ? collectionStatus(relatedCollection) : null;
        return {
          ...record,
          billedOn: record.created_at.slice(0, 10),
          clientName: relatedCollection?.client_name || billingSettings?.client_name || "General account",
          statusLabel:
            currentCollectionStatus === "collected"
              ? "Collected"
              : currentCollectionStatus === "partial"
                ? "Partial"
                : relatedCollection && currentCollectionStatus === "overdue"
                  ? "Overdue"
                  : record.due_date < todayKey()
                    ? "Due"
                    : "Open",
        };
      }),
    [billingRecords, billingSettings?.client_name, collectionsById],
  );

  const collectionRows = useMemo<CollectionReportRow[]>(
    () =>
      collections.map((collection) => ({
        ...collection,
        statusLabel: collectionStatus(collection).replace(/^./, (value) => value.toUpperCase()),
      })),
    [collections],
  );

  const ticketRows = useMemo<TicketReportRow[]>(
    () =>
      dailyTicketEntries.map((entry) => {
        const disputedTickets = Number(entry.disputed_install ?? 0) + Number(entry.disputed_repair ?? 0);
        // nap_rehab_tickets/nap_rehab_rate may be absent on entries cached (IndexedDB) or
        // fetched before those columns existed -- coerce so downstream .toLocaleString()
        // calls and sum reduces on the row can't crash or go NaN.
        const napRehabTickets = Number(entry.nap_rehab_tickets) || 0;
        const napRehabRate = Number(entry.nap_rehab_rate) || 0;
        const totalTickets = entry.installation_tickets + entry.repair_tickets + napRehabTickets;
        return {
          ...entry,
          disputedTickets,
          grossValue:
            entry.installation_tickets * entry.installation_rate +
            entry.repair_tickets * entry.repair_rate +
            napRehabTickets * napRehabRate,
          nap_rehab_tickets: napRehabTickets,
          nap_rehab_rate: napRehabRate,
          statusLabel: disputedTickets > 0 ? "Disputed" : totalTickets >= 10 ? "High Volume" : "Clean",
          totalTickets,
        };
      }),
    [dailyTicketEntries],
  );

  const expenseRows = useMemo<ExpenseReportRow[]>(
    () =>
      expenses.map((expense) => {
        const paidAmount = expensePaymentsTotal(expense.installment_payments);
        const remainingAmount = expenseRemainingBalance(expense, expense.installment_payments) ?? 0;
        const baseStatus = expenseDisplayStatus(expense, expense.installment_payments);
        const statusLabel =
          baseStatus === "cancelled"
            ? "Cancelled"
            : isExpenseOverdue(expense, expense.installment_payments, todayKey())
              ? "Overdue"
              : baseStatus === "paid"
                ? "Paid"
                : baseStatus === "partial"
                  ? "Partial"
                  : "Unpaid";
        return {
          ...expense,
          displayAmount: expenseTotalAmount(expense) ?? expense.amount,
          ownerName: expense.employee_name || "Company",
          paidAmount,
          remainingAmount,
          reportDate: expense.expense_date,
          statusLabel,
        };
      }),
    [expenses],
  );
  const overviewMetrics = useMemo<OverviewMetric[]>(() => {
    const today = todayKey();
    const weekStart = startOfWeek(today);
    const monthKey = today.slice(0, 7);

    const inDay = (value: string) => value === today;
    const inWeek = (value: string) => value >= weekStart && value <= today;
    const inMonth = (value: string) => value.slice(0, 7) === monthKey;

    const expenseDaily = expenseRows
      .filter((row) => inDay(row.reportDate))
      .reduce((sum, row) => sum + row.displayAmount, 0);
    const expenseWeekly = expenseRows
      .filter((row) => inWeek(row.reportDate))
      .reduce((sum, row) => sum + row.displayAmount, 0);
    const expenseMonthly = expenseRows
      .filter((row) => inMonth(row.reportDate))
      .reduce((sum, row) => sum + row.displayAmount, 0);

    const collectionPayments = collections.flatMap((collection) =>
      collection.payments
        .filter((payment) => !payment.is_void)
        .map((payment) => ({
          amount: payment.amount,
          paymentDate: payment.payment_date,
        })),
    );
    const collectionDaily = collectionPayments
      .filter((payment) => inDay(payment.paymentDate))
      .reduce((sum, payment) => sum + payment.amount, 0);
    const collectionWeekly = collectionPayments
      .filter((payment) => inWeek(payment.paymentDate))
      .reduce((sum, payment) => sum + payment.amount, 0);
    const collectionMonthly = collectionPayments
      .filter((payment) => inMonth(payment.paymentDate))
      .reduce((sum, payment) => sum + payment.amount, 0);

    const closedTicketCount = (entry: DailyTicketEntry) =>
      Math.max(
        entry.installation_tickets + entry.repair_tickets + (Number(entry.nap_rehab_tickets) || 0)
          - Number(entry.disputed_install ?? 0) - Number(entry.disputed_repair ?? 0),
        0,
      );
    const ticketDaily = dailyTicketEntries
      .filter((entry) => inDay(entry.entry_date))
      .reduce((sum, entry) => sum + closedTicketCount(entry), 0);
    const ticketWeekly = dailyTicketEntries
      .filter((entry) => inWeek(entry.entry_date))
      .reduce((sum, entry) => sum + closedTicketCount(entry), 0);
    const ticketMonthly = dailyTicketEntries
      .filter((entry) => inMonth(entry.entry_date))
      .reduce((sum, entry) => sum + closedTicketCount(entry), 0);

    const closedSubconTicketCount = (entry: SubconDailyTicket) =>
      Math.max(
        entry.install_tickets + entry.repair_tickets - Number(entry.disputed_install ?? 0) - Number(entry.disputed_repair ?? 0),
        0,
      );
    const subconDaily = subconDailyTickets
      .filter((entry) => inDay(entry.entry_date))
      .reduce((sum, entry) => sum + closedSubconTicketCount(entry), 0);
    const subconWeekly = subconDailyTickets
      .filter((entry) => inWeek(entry.entry_date))
      .reduce((sum, entry) => sum + closedSubconTicketCount(entry), 0);
    const subconMonthly = subconDailyTickets
      .filter((entry) => inMonth(entry.entry_date))
      .reduce((sum, entry) => sum + closedSubconTicketCount(entry), 0);

    return [
      {
        label: "Expenses",
        icon: "money",
        daily: currency.format(expenseDaily),
        weekly: currency.format(expenseWeekly),
        monthly: currency.format(expenseMonthly),
      },
      {
        label: "Collections",
        icon: "collections",
        daily: currency.format(collectionDaily),
        weekly: currency.format(collectionWeekly),
        monthly: currency.format(collectionMonthly),
      },
      {
        label: "Closed Tickets",
        icon: "tickets",
        daily: String(ticketDaily),
        weekly: String(ticketWeekly),
        monthly: String(ticketMonthly),
      },
      {
        label: "Subcontractor",
        icon: "subcon",
        daily: String(subconDaily),
        weekly: String(subconWeekly),
        monthly: String(subconMonthly),
      },
    ];
  }, [collections, dailyTicketEntries, expenseRows, subconDailyTickets]);

  const activeFilters = filters[activeReport];
  const activeSort = sorts[activeReport];
  const activeTab = REPORT_TABS.find((tab) => tab.key === activeReport) ?? REPORT_TABS[0];

  const payrollView = useMemo(
    () =>
      buildPayrollView(payrollRows, filters.payroll, sorts.payroll, (column) => updateSort("payroll", column)),
    [filters.payroll, payrollRows, sorts.payroll],
  );
  const billingView = useMemo(
    () =>
      buildBillingView(billingRows, filters.billing, sorts.billing, (column) => updateSort("billing", column)),
    [billingRows, filters.billing, sorts.billing],
  );
  const collectionView = useMemo(
    () =>
      buildCollectionView(collectionRows, filters.collections, sorts.collections, (column) => updateSort("collections", column)),
    [collectionRows, filters.collections, sorts.collections],
  );
  const ticketView = useMemo(
    () =>
      buildTicketView(ticketRows, filters.tickets, sorts.tickets, (column) => updateSort("tickets", column)),
    [filters.tickets, sorts.tickets, ticketRows],
  );
  const expenseView = useMemo(
    () =>
      buildExpenseView(expenseRows, filters.expenses, sorts.expenses, (column) => updateSort("expenses", column)),
    [expenseRows, filters.expenses, sorts.expenses],
  );

  const reportConfig: {
    chartValueFormatter: (value: number) => string;
    breakdown: BreakdownPoint[];
    breakdownTitle: string;
    columns: TableColumn<any>[];
    emptyMessage: string;
    entityLabel: string;
    entityOptions: string[];
    exportColumns: { format?: (row: any) => string; key: string; label: string }[];
    filteredCount: number;
    metrics: SummaryMetric[];
    onSort: (column: string) => void;
    rows: any[];
    searchPlaceholder: string;
    statusOptions: string[];
    tableTitle: string;
    totalCount: number;
    totals: { label: string; value: string }[];
    trend: TrendPoint[];
    trendTitle: string;
    trendVariant?: TrendVariant;
  } = {
    payroll: payrollView,
    billing: billingView,
    collections: collectionView,
    tickets: ticketView,
    expenses: expenseView,
  }[activeReport];
  const pageCount = Math.max(1, Math.ceil(reportConfig.rows.length / REPORTS_PAGE_SIZE));
  const safeCurrentPage = Math.min(pages[activeReport], pageCount);
  const pageStart = (safeCurrentPage - 1) * REPORTS_PAGE_SIZE;
  const pageEnd = Math.min(pageStart + REPORTS_PAGE_SIZE, reportConfig.rows.length);
  const paginatedRows = reportConfig.rows.slice(pageStart, pageEnd);

  useEffect(() => {
    if (pages[activeReport] > pageCount) {
      setPages((current) => ({ ...current, [activeReport]: pageCount }));
    }
  }, [activeReport, pageCount, pages]);

  function updateFilters(next: Partial<FilterState>) {
    setFilters((current) => ({
      ...current,
      [activeReport]: {
        ...current[activeReport],
        ...next,
      },
    }));
    setPages((current) => ({ ...current, [activeReport]: 1 }));
  }

  function updateSort(report: ReportKey, column: string) {
    setSorts((current) => {
      const previous = current[report];
      const direction: SortDirection =
        previous.column === column && previous.direction === "asc" ? "desc" : "asc";
      return {
        ...current,
        [report]: { column, direction },
      };
    });
    setPages((current) => ({ ...current, [report]: 1 }));
  }

  function resetActiveFilters() {
    setFilters((current) => ({
      ...current,
      [activeReport]: defaultFilters()[activeReport],
    }));
    setPages((current) => ({ ...current, [activeReport]: 1 }));
  }

  function buildExportSubtitleLines() {
    const lines = [`Generated on ${new Date().toLocaleString()}`];

    if (activeReport === "payroll" || activeReport === "tickets") {
      if (activeFilters.entity !== "all") {
        lines.push(`Employee: ${activeFilters.entity}`);
      } else {
        const employeeNames = new Set(
          reportConfig.rows.map((row) =>
            activeReport === "payroll"
              ? String((row as PayrollReportRow).employeeName)
              : String((row as TicketReportRow).employee_name),
          ),
        );
        lines.push(`Employees: ${employeeNames.size}`);
      }
    }

    return lines;
  }

  function handleExport(format: "csv" | "excel" | "pdf" | "print") {
    const title = REPORT_TABS.find((tab) => tab.key === activeReport)?.label ?? "Report";
    const subtitleLines = buildExportSubtitleLines();
    if (reportConfig.rows.length === 0) {
      NotificationService.showWarning("There is no filtered data to export.");
      return;
    }

    if (format === "csv") {
      downloadCsv(`${slugify(title)}.csv`, reportConfig.exportColumns, reportConfig.rows);
      NotificationService.showSuccess(`${title} exported as CSV.`);
      return;
    }

    if (format === "excel") {
      downloadExcel(`${slugify(title)}.xls`, reportConfig.exportColumns, reportConfig.rows);
      NotificationService.showSuccess(`${title} exported for Excel.`);
      return;
    }

    if (format === "pdf") {
      downloadPdf(`${slugify(title)}.pdf`, reportConfig.exportColumns, reportConfig.rows, title, subtitleLines);
      NotificationService.showSuccess(`${title} exported as PDF.`);
      return;
    }

    openPrintPreview({
      columns: reportConfig.exportColumns,
      title,
      rows: reportConfig.rows,
      subtitleLines,
      promptPdf: false,
    });
    NotificationService.showInfo("Print preview opened.");
  }

  return (
    <div className="reports-page">
      <PageHeader
        action={(
          <div className="reports-header-actions">
            <button className="secondary-button" onClick={() => handleExport("pdf")} type="button">
              <FileDown size={16} />
              PDF
            </button>
            <button className="secondary-button" onClick={() => handleExport("excel")} type="button">
              <FileSpreadsheet size={16} />
              Excel
            </button>
            <button className="secondary-button" onClick={() => handleExport("csv")} type="button">
              <Download size={16} />
              CSV
            </button>
            <button className="primary-button" onClick={() => handleExport("print")} type="button">
              <Printer size={16} />
              Print
            </button>
          </div>
        )}
        eyebrow="Business intelligence"
        title="Reports"
        text="Analyze payroll, billing, collections, and ticket performance with enterprise-grade filters, tables, and visual summaries."
      />

      <section className="reports-overview-card">
        <div className="reports-card-header">
          <div>
            <p className="eyebrow">Overview</p>
            <h3>Daily, weekly, and monthly summary</h3>
          </div>
          <span className="reports-card-chip subtle">
            <CalendarRange size={14} />
            Based on today
          </span>
        </div>
        <div className="reports-overview-grid">
          {overviewMetrics.map((metric) => (
            <OverviewCard key={metric.label} metric={metric} />
          ))}
        </div>
      </section>

      <section className="reports-tabbar" aria-label="Report pages">
        {REPORT_TABS.map((tab) => (
          <button
            className={tab.key === activeReport ? "active" : ""}
            key={tab.key}
            onClick={() => setActiveReport(tab.key)}
            role="tab"
            aria-selected={tab.key === activeReport}
            type="button"
          >
            <strong>{tab.label}</strong>
          </button>
        ))}
      </section>

      <section className="reports-filter-card">
        <div className="reports-filter-header">
          <div>
            <p className="eyebrow">Advanced filters</p>
            <h2>{activeTab.label}</h2>
            <span>Slice the dataset by period, entity, status, and keyword.</span>
          </div>
          <div className="reports-filter-actions">
            <div className="reports-filter-badge">
              <Filter size={15} />
              {reportConfig.filteredCount} of {reportConfig.totalCount} rows
            </div>
            <button className="secondary-button compact" onClick={resetActiveFilters} type="button">
              Reset
            </button>
          </div>
        </div>

        <div className="reports-filter-grid">
          <label className="reports-field">
            Start date
            <div className="reports-input with-icon">
              <CalendarRange size={16} />
              <input
                type="date"
                value={activeFilters.startDate}
                onChange={(event) => updateFilters({ startDate: event.target.value })}
              />
            </div>
          </label>
          <label className="reports-field">
            End date
            <div className="reports-input with-icon">
              <CalendarRange size={16} />
              <input
                type="date"
                value={activeFilters.endDate}
                onChange={(event) => updateFilters({ endDate: event.target.value })}
              />
            </div>
          </label>
          <label className="reports-field">
            {reportConfig.entityLabel}
            <select
              value={activeFilters.entity}
              onChange={(event) => updateFilters({ entity: event.target.value })}
            >
              <option value="all">All {reportConfig.entityLabel.toLowerCase()}s</option>
              {reportConfig.entityOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="reports-field">
            Status
            <select
              value={activeFilters.status}
              onChange={(event) => updateFilters({ status: event.target.value })}
            >
              <option value="all">All statuses</option>
              {reportConfig.statusOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="reports-filter-search">
            Search
            <div className="reports-input with-icon">
              <Search size={16} />
              <input
                placeholder={reportConfig.searchPlaceholder}
                type="search"
                value={activeFilters.query}
                onChange={(event) => updateFilters({ query: event.target.value })}
              />
            </div>
          </label>
        </div>
      </section>

      <section className="reports-kpi-grid">
        {reportConfig.metrics.map((metric) => (
          <MetricCard key={metric.label} metric={metric} />
        ))}
      </section>

      <section className="reports-chart-grid">
        <div className="reports-chart-card">
          <div className="reports-card-header">
            <div>
              <p className="eyebrow">Trend</p>
              <h3>{reportConfig.trendTitle}</h3>
            </div>
            <span className="reports-card-chip">
              <TrendingUp size={14} />
              Last 6 periods
            </span>
          </div>
          <TrendChart
            data={reportConfig.trend}
            formatValue={reportConfig.chartValueFormatter}
            variant={reportConfig.trendVariant ?? "line"}
          />
        </div>
        <div className="reports-chart-card">
          <div className="reports-card-header">
            <div>
              <p className="eyebrow">Breakdown</p>
              <h3>{reportConfig.breakdownTitle}</h3>
            </div>
            <span className="reports-card-chip subtle">
              <BarChart3 size={14} />
              Distribution
            </span>
          </div>
          <BreakdownChart data={reportConfig.breakdown} formatValue={reportConfig.chartValueFormatter} />
        </div>
      </section>

      <section className="reports-table-card">
        <div className="reports-card-header">
          <div>
            <p className="eyebrow">Detailed records</p>
            <h3>{reportConfig.tableTitle}</h3>
          </div>
          <span className="reports-card-chip">
            <ReceiptText size={14} />
            {REPORTS_PAGE_SIZE} rows per page
          </span>
        </div>
        <ReportTable
          columns={reportConfig.columns}
          rows={paginatedRows}
          emptyMessage={reportConfig.emptyMessage}
          onSort={reportConfig.onSort}
          sortColumn={activeSort.column}
          sortDirection={activeSort.direction}
        />
        {reportConfig.rows.length > REPORTS_PAGE_SIZE && (
          <div className="attendance-footer">
            <span>
              Showing {pageStart + 1} to {pageEnd} of {reportConfig.rows.length} record{reportConfig.rows.length === 1 ? "" : "s"}
            </span>
            <div>
              <button
                disabled={safeCurrentPage === 1}
                onClick={() => setPages((current) => ({ ...current, [activeReport]: Math.max(1, safeCurrentPage - 1) }))}
                type="button"
              >
                Previous
              </button>
              {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
                <button
                  className={page === safeCurrentPage ? "active" : undefined}
                  key={page}
                  onClick={() => setPages((current) => ({ ...current, [activeReport]: page }))}
                  type="button"
                >
                  {page}
                </button>
              ))}
              <button
                disabled={safeCurrentPage === pageCount}
                onClick={() => setPages((current) => ({ ...current, [activeReport]: Math.min(pageCount, safeCurrentPage + 1) }))}
                type="button"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function buildPayrollView(
  rows: PayrollReportRow[],
  filters: FilterState,
  sort: { column: string; direction: SortDirection },
  onSort: (column: string) => void,
) {
  const filtered = rows.filter((row) => {
    const query = filters.query.trim().toLowerCase();
    const matchesDate = dateInRange(row.processedDate, filters.startDate, filters.endDate);
    const matchesEntity = filters.entity === "all" || row.employeeName === filters.entity;
    const matchesStatus = filters.status === "all" || row.status === filters.status;
    const matchesQuery =
      !query ||
      `${row.payrollNo} ${row.employeeName} ${row.department} ${row.payPeriod}`.toLowerCase().includes(query);
    return matchesDate && matchesEntity && matchesStatus && matchesQuery;
  });

  const sorted = sortRows(filtered, sort, {
    payrollNo: (row) => row.payrollNo,
    employeeName: (row) => row.employeeName,
    department: (row) => row.department,
    payPeriod: (row) => row.payPeriod,
    grossPay: (row) => row.grossPay,
    deductions: (row) => row.deductions,
    netPay: (row) => row.netPay,
    processedDate: (row) => row.processedDate,
    status: (row) => row.status,
  });

  const totalGross = sorted.reduce((sum, row) => sum + row.grossPay, 0);
  const totalNet = sorted.reduce((sum, row) => sum + row.netPay, 0);
  const totalDeductions = sorted.reduce((sum, row) => sum + row.deductions, 0);
  const paidRows = sorted.filter((row) => row.status === "paid").length;

  return {
    rows: sorted,
    totalCount: rows.length,
    filteredCount: sorted.length,
    entityLabel: "Employee",
    entityOptions: uniqueValues(rows.map((row) => row.employeeName)),
    statusOptions: uniqueValues(rows.map((row) => row.status)),
    searchPlaceholder: "Search payroll no., employee, department, or period",
    metrics: [
      { label: "Net payroll", value: currency.format(totalNet), helper: `${sorted.length} line items`, tone: "neutral" as const },
      { label: "Gross pay", value: currency.format(totalGross), helper: "Before deductions", tone: "success" as const },
      { label: "Deductions", value: currency.format(totalDeductions), helper: "Statutory and manual", tone: "warning" as const },
      { label: "Paid rate", value: `${sorted.length ? Math.round((paidRows / sorted.length) * 100) : 0}%`, helper: `${paidRows} paid out`, tone: paidRows === sorted.length ? "success" as const : "danger" as const },
    ],
    trendTitle: "Monthly net pay movement",
    trend: buildMonthlyTrend(sorted, (row) => row.processedDate, (row) => row.netPay),
    trendVariant: "line" as const,
    breakdownTitle: "Department payroll mix",
    breakdown: buildBreakdown(sorted, (row) => row.department || "Unassigned", (row) => row.netPay),
    chartValueFormatter: (value: number) => currency.format(value),
    tableTitle: "Payroll register",
    emptyMessage: "No payroll rows match the current filters.",
    onSort,
    columns: [
      { id: "payrollNo", label: "Payroll No.", sortValue: (row: PayrollReportRow) => row.payrollNo },
      { id: "employeeName", label: "Employee", sortValue: (row: PayrollReportRow) => row.employeeName, render: (row: PayrollReportRow) => <StackedCell title={row.employeeName} subtitle={row.employeeId ?? row.employeeStatus} /> },
      { id: "department", label: "Department", sortValue: (row: PayrollReportRow) => row.department },
      { id: "payPeriod", label: "Pay period", sortValue: (row: PayrollReportRow) => row.payPeriod },
      { id: "grossPay", label: "Gross", align: "right" as const, sortValue: (row: PayrollReportRow) => row.grossPay, render: (row: PayrollReportRow) => formatMoney(row.grossPay) },
      { id: "deductions", label: "Deductions", align: "right" as const, sortValue: (row: PayrollReportRow) => row.deductions, render: (row: PayrollReportRow) => formatMoney(row.deductions) },
      { id: "netPay", label: "Net", align: "right" as const, sortValue: (row: PayrollReportRow) => row.netPay, render: (row: PayrollReportRow) => <strong>{formatMoney(row.netPay)}</strong> },
      { id: "status", label: "Status", sortValue: (row: PayrollReportRow) => row.status, render: (row: PayrollReportRow) => <StatusPill value={row.status} /> },
      { id: "processedDate", label: "Processed", sortValue: (row: PayrollReportRow) => row.processedDate },
    ] satisfies TableColumn<PayrollReportRow>[],
    exportColumns: [
      { key: "payrollNo", label: "Payroll No." },
      { key: "employeeName", label: "Employee" },
      { key: "department", label: "Department" },
      { key: "payPeriod", label: "Pay Period" },
      { key: "grossPay", label: "Gross Pay", format: (row: PayrollReportRow) => row.grossPay.toFixed(2) },
      { key: "deductions", label: "Deductions", format: (row: PayrollReportRow) => row.deductions.toFixed(2) },
      { key: "netPay", label: "Net Pay", format: (row: PayrollReportRow) => row.netPay.toFixed(2) },
      { key: "status", label: "Status" },
      { key: "processedDate", label: "Processed Date" },
    ],
    totals: [
      { label: "Rows", value: String(sorted.length) },
      { label: "Gross total", value: currency.format(totalGross) },
      { label: "Deduction total", value: currency.format(totalDeductions) },
      { label: "Net total", value: currency.format(totalNet) },
    ],
  };
}

function buildBillingView(
  rows: BillingReportRow[],
  filters: FilterState,
  sort: { column: string; direction: SortDirection },
  onSort: (column: string) => void,
) {
  const filtered = rows.filter((row) => {
    const query = filters.query.trim().toLowerCase();
    const matchesDate = dateInRange(row.billedOn, filters.startDate, filters.endDate);
    const matchesEntity = filters.entity === "all" || row.clientName === filters.entity;
    const matchesStatus = filters.status === "all" || row.statusLabel === filters.status;
    const matchesQuery =
      !query ||
      `${row.invoice_no} ${row.clientName} ${row.notes} ${row.billing_year} ${row.billing_period}`.toLowerCase().includes(query);
    return matchesDate && matchesEntity && matchesStatus && matchesQuery;
  });

  const sorted = sortRows(filtered, sort, {
    invoice_no: (row) => row.invoice_no,
    clientName: (row) => row.clientName,
    billing_period: (row) => `${row.billing_year}-${row.billing_month}-${row.billing_period}`,
    total_tickets: (row) => row.total_tickets,
    billing_amount: (row) => row.billing_amount,
    collections_amount: (row) => row.collections_amount,
    collectibles_amount: (row) => row.collectibles_amount,
    due_date: (row) => row.due_date,
    statusLabel: (row) => row.statusLabel,
    billedOn: (row) => row.billedOn,
  });

  const totalBilling = sorted.reduce((sum, row) => sum + row.billing_amount, 0);
  const totalCollectibles = sorted.reduce((sum, row) => sum + row.collectibles_amount, 0);
  const totalCollections = sorted.reduce((sum, row) => sum + row.collections_amount, 0);
  const averageInvoice = sorted.length ? totalBilling / sorted.length : 0;

  return {
    rows: sorted,
    totalCount: rows.length,
    filteredCount: sorted.length,
    entityLabel: "Customer",
    entityOptions: uniqueValues(rows.map((row) => row.clientName)),
    statusOptions: uniqueValues(rows.map((row) => row.statusLabel)),
    searchPlaceholder: "Search invoice, customer, notes, or billing period",
    metrics: [
      { label: "Billed revenue", value: currency.format(totalBilling), helper: `${sorted.length} invoices`, tone: "neutral" as const },
      { label: "Collection share", value: currency.format(totalCollections), helper: "Collection allocation", tone: "success" as const },
      { label: "Collectibles", value: currency.format(totalCollectibles), helper: "Pending customer balance", tone: "warning" as const },
      { label: "Average invoice", value: currency.format(averageInvoice), helper: "Across filtered records", tone: "neutral" as const },
    ],
    trendTitle: "Billing value by month",
    trend: buildMonthlyTrend(sorted, (row) => row.billedOn, (row) => row.billing_amount),
    breakdownTitle: "Invoice status mix",
    breakdown: buildBreakdown(sorted, (row) => row.statusLabel, (row) => row.billing_amount),
    chartValueFormatter: (value: number) => currency.format(value),
    tableTitle: "Billing ledger",
    emptyMessage: "No billing records match the current filters.",
    onSort,
    columns: [
      { id: "invoice_no", label: "Invoice", sortValue: (row: BillingReportRow) => row.invoice_no, render: (row: BillingReportRow) => <StackedCell title={row.invoice_no} subtitle={formatBillingPeriod(row)} /> },
      { id: "clientName", label: "Customer", sortValue: (row: BillingReportRow) => row.clientName },
      { id: "total_tickets", label: "Tickets", align: "right" as const, sortValue: (row: BillingReportRow) => row.total_tickets, render: (row: BillingReportRow) => row.total_tickets.toLocaleString() },
      { id: "billing_amount", label: "Billed", align: "right" as const, sortValue: (row: BillingReportRow) => row.billing_amount, render: (row: BillingReportRow) => formatMoney(row.billing_amount) },
      { id: "collections_amount", label: "Collection", align: "right" as const, sortValue: (row: BillingReportRow) => row.collections_amount, render: (row: BillingReportRow) => formatMoney(row.collections_amount) },
      { id: "collectibles_amount", label: "Collectibles", align: "right" as const, sortValue: (row: BillingReportRow) => row.collectibles_amount, render: (row: BillingReportRow) => <strong>{formatMoney(row.collectibles_amount)}</strong> },
      { id: "due_date", label: "Due date", sortValue: (row: BillingReportRow) => row.due_date },
      { id: "statusLabel", label: "Status", sortValue: (row: BillingReportRow) => row.statusLabel, render: (row: BillingReportRow) => <StatusPill value={row.statusLabel} /> },
    ] satisfies TableColumn<BillingReportRow>[],
    exportColumns: [
      { key: "invoice_no", label: "Invoice" },
      { key: "clientName", label: "Customer" },
      { key: "total_tickets", label: "Total Tickets" },
      { key: "billing_amount", label: "Billed Amount", format: (row: BillingReportRow) => row.billing_amount.toFixed(2) },
      { key: "collections_amount", label: "Collection Amount", format: (row: BillingReportRow) => row.collections_amount.toFixed(2) },
      { key: "collectibles_amount", label: "Collectibles Amount", format: (row: BillingReportRow) => row.collectibles_amount.toFixed(2) },
      { key: "due_date", label: "Due Date" },
      { key: "statusLabel", label: "Status" },
    ],
    totals: [
      { label: "Invoices", value: String(sorted.length) },
      { label: "Billed total", value: currency.format(totalBilling) },
      { label: "Collection total", value: currency.format(totalCollections) },
      { label: "Collectibles total", value: currency.format(totalCollectibles) },
    ],
  };
}

function buildCollectionView(
  rows: CollectionReportRow[],
  filters: FilterState,
  sort: { column: string; direction: SortDirection },
  onSort: (column: string) => void,
) {
  const filtered = rows.filter((row) => {
    const query = filters.query.trim().toLowerCase();
    const matchesDate = dateInRange(row.issue_date, filters.startDate, filters.endDate);
    const matchesEntity = filters.entity === "all" || row.client_name === filters.entity;
    const matchesStatus = filters.status === "all" || row.statusLabel === filters.status;
    const matchesQuery =
      !query ||
      `${row.collection_no ?? ""} ${row.client_name} ${row.title} ${row.external_reference}`.toLowerCase().includes(query);
    return matchesDate && matchesEntity && matchesStatus && matchesQuery;
  });

  const sorted = sortRows(filtered, sort, {
    collection_no: (row) => row.collection_no ?? "",
    client_name: (row) => row.client_name,
    issue_date: (row) => row.issue_date,
    due_date: (row) => row.due_date,
    amount: (row) => row.amount,
    amount_paid: (row) => row.amount_paid,
    outstanding_balance: (row) => row.outstanding_balance,
    statusLabel: (row) => row.statusLabel,
  });

  const totalReceivable = sorted.reduce((sum, row) => sum + row.amount, 0);
  const totalPaid = sorted.reduce((sum, row) => sum + row.amount_paid, 0);
  const totalOutstanding = sorted.reduce((sum, row) => sum + row.outstanding_balance, 0);
  const overdueBalance = sorted
    .filter((row) => row.due_date < todayKey() && row.outstanding_balance > 0)
    .reduce((sum, row) => sum + row.outstanding_balance, 0);

  return {
    rows: sorted,
    totalCount: rows.length,
    filteredCount: sorted.length,
    entityLabel: "Customer",
    entityOptions: uniqueValues(rows.map((row) => row.client_name)),
    statusOptions: uniqueValues(rows.map((row) => row.statusLabel)),
    searchPlaceholder: "Search collection no., customer, title, or reference",
    metrics: [
      { label: "Receivables", value: currency.format(totalReceivable), helper: `${sorted.length} records`, tone: "neutral" as const },
      { label: "Collected", value: currency.format(totalPaid), helper: "Posted customer payments", tone: "success" as const },
      { label: "Outstanding", value: currency.format(totalOutstanding), helper: "Still to collect", tone: "warning" as const },
      { label: "Overdue", value: currency.format(overdueBalance), helper: "Past due exposure", tone: overdueBalance > 0 ? "danger" as const : "success" as const },
    ],
    trendTitle: "Receivable issuance by month",
    trend: buildMonthlyTrend(sorted, (row) => row.issue_date, (row) => row.amount),
    breakdownTitle: "Aging and status exposure",
    breakdown: buildBreakdown(sorted, (row) => row.statusLabel, (row) => row.outstanding_balance || row.amount),
    chartValueFormatter: (value: number) => currency.format(value),
    tableTitle: "Collection register",
    emptyMessage: "No collection rows match the current filters.",
    onSort,
    columns: [
      { id: "collection_no", label: "Collection", sortValue: (row: CollectionReportRow) => row.collection_no ?? "", render: (row: CollectionReportRow) => <StackedCell title={row.collection_no ?? "Pending sync"} subtitle={row.title} /> },
      { id: "client_name", label: "Customer", sortValue: (row: CollectionReportRow) => row.client_name },
      { id: "issue_date", label: "Issued", sortValue: (row: CollectionReportRow) => row.issue_date },
      { id: "due_date", label: "Due", sortValue: (row: CollectionReportRow) => row.due_date },
      { id: "amount", label: "Amount", align: "right" as const, sortValue: (row: CollectionReportRow) => row.amount, render: (row: CollectionReportRow) => formatMoney(row.amount) },
      { id: "amount_paid", label: "Paid", align: "right" as const, sortValue: (row: CollectionReportRow) => row.amount_paid, render: (row: CollectionReportRow) => formatMoney(row.amount_paid) },
      { id: "outstanding_balance", label: "Balance", align: "right" as const, sortValue: (row: CollectionReportRow) => row.outstanding_balance, render: (row: CollectionReportRow) => <strong>{formatMoney(row.outstanding_balance)}</strong> },
      { id: "statusLabel", label: "Status", sortValue: (row: CollectionReportRow) => row.statusLabel, render: (row: CollectionReportRow) => <StatusPill value={row.statusLabel} /> },
    ] satisfies TableColumn<CollectionReportRow>[],
    exportColumns: [
      { key: "collection_no", label: "Collection No." },
      { key: "title", label: "Title" },
      { key: "client_name", label: "Customer" },
      { key: "issue_date", label: "Issue Date" },
      { key: "due_date", label: "Due Date" },
      { key: "amount", label: "Amount", format: (row: CollectionReportRow) => row.amount.toFixed(2) },
      { key: "amount_paid", label: "Paid", format: (row: CollectionReportRow) => row.amount_paid.toFixed(2) },
      { key: "outstanding_balance", label: "Outstanding", format: (row: CollectionReportRow) => row.outstanding_balance.toFixed(2) },
      { key: "statusLabel", label: "Status" },
    ],
    totals: [
      { label: "Records", value: String(sorted.length) },
      { label: "Receivable total", value: currency.format(totalReceivable) },
      { label: "Collected total", value: currency.format(totalPaid) },
      { label: "Outstanding total", value: currency.format(totalOutstanding) },
    ],
  };
}

function buildTicketView(
  rows: TicketReportRow[],
  filters: FilterState,
  sort: { column: string; direction: SortDirection },
  onSort: (column: string) => void,
) {
  const filtered = rows.filter((row) => {
    const query = filters.query.trim().toLowerCase();
    const matchesDate = dateInRange(row.entry_date, filters.startDate, filters.endDate);
    const matchesEntity = filters.entity === "all" || row.employee_name === filters.entity;
    const matchesStatus = filters.status === "all" || row.statusLabel === filters.status;
    const matchesQuery =
      !query ||
      `${row.employee_name} ${row.position_name} ${row.entry_date}`.toLowerCase().includes(query);
    return matchesDate && matchesEntity && matchesStatus && matchesQuery;
  });

  const sorted = sortRows(filtered, sort, {
    entry_date: (row) => row.entry_date,
    employee_name: (row) => row.employee_name,
    position_name: (row) => row.position_name,
    installation_tickets: (row) => row.installation_tickets,
    repair_tickets: (row) => row.repair_tickets,
    nap_rehab_tickets: (row) => row.nap_rehab_tickets,
    totalTickets: (row) => row.totalTickets,
    disputedTickets: (row) => row.disputedTickets,
    grossValue: (row) => row.grossValue,
    statusLabel: (row) => row.statusLabel,
  });

  const totalTickets = sorted.reduce((sum, row) => sum + row.totalTickets, 0);
  const installTickets = sorted.reduce((sum, row) => sum + row.installation_tickets, 0);
  const repairTickets = sorted.reduce((sum, row) => sum + row.repair_tickets, 0);
  const napRehabTickets = sorted.reduce((sum, row) => sum + row.nap_rehab_tickets, 0);
  const disputedTickets = sorted.reduce((sum, row) => sum + row.disputedTickets, 0);
  const totalValue = sorted.reduce((sum, row) => sum + row.grossValue, 0);

  return {
    rows: sorted,
    totalCount: rows.length,
    filteredCount: sorted.length,
    entityLabel: "Employee",
    entityOptions: uniqueValues(rows.map((row) => row.employee_name)),
    statusOptions: uniqueValues(rows.map((row) => row.statusLabel)),
    searchPlaceholder: "Search employee, position, or ticket date",
    metrics: [
      { label: "Closed tickets", value: totalTickets.toLocaleString(), helper: `${sorted.length} daily rows`, tone: "neutral" as const },
      { label: "Installation", value: installTickets.toLocaleString(), helper: "Installation volume", tone: "success" as const },
      { label: "Repair", value: repairTickets.toLocaleString(), helper: "Repair volume", tone: "warning" as const },
      { label: "Nap Rehab", value: napRehabTickets.toLocaleString(), helper: "Nap Rehab volume", tone: "neutral" as const },
      { label: "Disputed", value: disputedTickets.toLocaleString(), helper: `Equivalent value ${currency.format(totalValue)}`, tone: disputedTickets > 0 ? "danger" as const : "success" as const },
    ],
    trendTitle: "Closed ticket volume by month",
    trend: buildMonthlyTrend(sorted, (row) => row.entry_date, (row) => row.totalTickets),
    breakdownTitle: "Top employee output",
    breakdown: buildBreakdown(sorted, (row) => row.employee_name, (row) => row.totalTickets).slice(0, 6),
    chartValueFormatter: (value: number) => value.toLocaleString(),
    tableTitle: "Closed ticket detail",
    emptyMessage: "No ticket rows match the current filters.",
    onSort,
    columns: [
      { id: "entry_date", label: "Date", sortValue: (row: TicketReportRow) => row.entry_date },
      { id: "employee_name", label: "Employee", sortValue: (row: TicketReportRow) => row.employee_name, render: (row: TicketReportRow) => <StackedCell title={row.employee_name} subtitle={row.position_name} /> },
      { id: "installation_tickets", label: "Install", align: "right" as const, sortValue: (row: TicketReportRow) => row.installation_tickets, render: (row: TicketReportRow) => row.installation_tickets.toLocaleString() },
      { id: "repair_tickets", label: "Repair", align: "right" as const, sortValue: (row: TicketReportRow) => row.repair_tickets, render: (row: TicketReportRow) => row.repair_tickets.toLocaleString() },
      { id: "nap_rehab_tickets", label: "Nap Rehab", align: "right" as const, sortValue: (row: TicketReportRow) => row.nap_rehab_tickets, render: (row: TicketReportRow) => row.nap_rehab_tickets.toLocaleString() },
      { id: "totalTickets", label: "Total", align: "right" as const, sortValue: (row: TicketReportRow) => row.totalTickets, render: (row: TicketReportRow) => <strong>{row.totalTickets.toLocaleString()}</strong> },
      { id: "disputedTickets", label: "Disputed", align: "right" as const, sortValue: (row: TicketReportRow) => row.disputedTickets, render: (row: TicketReportRow) => row.disputedTickets.toLocaleString() },
      { id: "grossValue", label: "Value", align: "right" as const, sortValue: (row: TicketReportRow) => row.grossValue, render: (row: TicketReportRow) => formatMoney(row.grossValue) },
      { id: "statusLabel", label: "Status", sortValue: (row: TicketReportRow) => row.statusLabel, render: (row: TicketReportRow) => <StatusPill value={row.statusLabel} /> },
    ] satisfies TableColumn<TicketReportRow>[],
    exportColumns: [
      { key: "entry_date", label: "Entry Date" },
      { key: "employee_name", label: "Employee" },
      { key: "position_name", label: "Position" },
      { key: "installation_tickets", label: "Installation Tickets" },
      { key: "repair_tickets", label: "Repair Tickets" },
      { key: "nap_rehab_tickets", label: "Nap Rehab Tickets" },
      { key: "totalTickets", label: "Total Tickets" },
      { key: "disputedTickets", label: "Disputed Tickets" },
      { key: "grossValue", label: "Gross Value", format: (row: TicketReportRow) => row.grossValue.toFixed(2) },
      { key: "statusLabel", label: "Status" },
    ],
    totals: [
      { label: "Rows", value: String(sorted.length) },
      { label: "Total tickets", value: totalTickets.toLocaleString() },
      { label: "Disputed", value: disputedTickets.toLocaleString() },
      { label: "Estimated value", value: currency.format(totalValue) },
    ],
  };
}

function buildExpenseView(
  rows: ExpenseReportRow[],
  filters: FilterState,
  sort: { column: string; direction: SortDirection },
  onSort: (column: string) => void,
) {
  const filtered = rows.filter((row) => {
    const query = filters.query.trim().toLowerCase();
    const matchesDate = dateInRange(row.reportDate, filters.startDate, filters.endDate);
    const matchesEntity = filters.entity === "all" || row.category_name === filters.entity;
    const matchesStatus = filters.status === "all" || row.statusLabel === filters.status;
    const matchesQuery =
      !query ||
      `${row.ownerName} ${row.category_name} ${row.notes} ${row.frequency}`.toLowerCase().includes(query);
    return matchesDate && matchesEntity && matchesStatus && matchesQuery;
  });

  const sorted = sortRows(filtered, sort, {
    reportDate: (row) => row.reportDate,
    ownerName: (row) => row.ownerName,
    category_name: (row) => row.category_name,
    frequency: (row) => row.frequency,
    displayAmount: (row) => row.displayAmount,
    paidAmount: (row) => row.paidAmount,
    remainingAmount: (row) => row.remainingAmount,
    statusLabel: (row) => row.statusLabel,
  });

  const totalExpenses = sorted.reduce((sum, row) => sum + row.displayAmount, 0);
  const totalPaid = sorted.reduce((sum, row) => sum + row.paidAmount, 0);
  const totalOutstanding = sorted.reduce((sum, row) => sum + row.remainingAmount, 0);
  const overdueTotal = sorted
    .filter((row) => row.statusLabel === "Overdue")
    .reduce((sum, row) => sum + row.remainingAmount, 0);

  return {
    rows: sorted,
    totalCount: rows.length,
    filteredCount: sorted.length,
    entityLabel: "Category",
    entityOptions: uniqueValues(rows.map((row) => row.category_name)),
    statusOptions: uniqueValues(rows.map((row) => row.statusLabel)),
    searchPlaceholder: "Search payee, category, notes, or frequency",
    metrics: [
      { label: "Expense total", value: currency.format(totalExpenses), helper: `${sorted.length} records`, tone: "neutral" as const },
      { label: "Paid amount", value: currency.format(totalPaid), helper: "Recorded payments", tone: "success" as const },
      { label: "Outstanding", value: currency.format(totalOutstanding), helper: "Remaining balance", tone: "warning" as const },
      { label: "Overdue", value: currency.format(overdueTotal), helper: "Past due expenses", tone: overdueTotal > 0 ? "danger" as const : "success" as const },
    ],
    trendTitle: "Expense value by month",
    trend: buildMonthlyTrend(sorted, (row) => row.reportDate, (row) => row.displayAmount),
    breakdownTitle: "Expense category mix",
    breakdown: buildBreakdown(sorted, (row) => row.category_name || "Uncategorized", (row) => row.displayAmount),
    chartValueFormatter: (value: number) => currency.format(value),
    tableTitle: "Expense register",
    emptyMessage: "No expense rows match the current filters.",
    onSort,
    columns: [
      { id: "reportDate", label: "Date", sortValue: (row: ExpenseReportRow) => row.reportDate },
      { id: "ownerName", label: "Payee", sortValue: (row: ExpenseReportRow) => row.ownerName },
      { id: "category_name", label: "Category", sortValue: (row: ExpenseReportRow) => row.category_name },
      { id: "frequency", label: "Frequency", sortValue: (row: ExpenseReportRow) => row.frequency },
      { id: "displayAmount", label: "Amount", align: "right" as const, sortValue: (row: ExpenseReportRow) => row.displayAmount, render: (row: ExpenseReportRow) => formatMoney(row.displayAmount) },
      { id: "paidAmount", label: "Paid", align: "right" as const, sortValue: (row: ExpenseReportRow) => row.paidAmount, render: (row: ExpenseReportRow) => formatMoney(row.paidAmount) },
      { id: "remainingAmount", label: "Balance", align: "right" as const, sortValue: (row: ExpenseReportRow) => row.remainingAmount, render: (row: ExpenseReportRow) => <strong>{formatMoney(row.remainingAmount)}</strong> },
      { id: "statusLabel", label: "Status", sortValue: (row: ExpenseReportRow) => row.statusLabel, render: (row: ExpenseReportRow) => <StatusPill value={row.statusLabel} /> },
    ] satisfies TableColumn<ExpenseReportRow>[],
    exportColumns: [
      { key: "reportDate", label: "Expense Date" },
      { key: "ownerName", label: "Payee" },
      { key: "category_name", label: "Category" },
      { key: "frequency", label: "Frequency" },
      { key: "displayAmount", label: "Amount", format: (row: ExpenseReportRow) => row.displayAmount.toFixed(2) },
      { key: "paidAmount", label: "Paid Amount", format: (row: ExpenseReportRow) => row.paidAmount.toFixed(2) },
      { key: "remainingAmount", label: "Remaining Balance", format: (row: ExpenseReportRow) => row.remainingAmount.toFixed(2) },
      { key: "statusLabel", label: "Status" },
    ],
    totals: [
      { label: "Records", value: String(sorted.length) },
      { label: "Expense total", value: currency.format(totalExpenses) },
      { label: "Paid total", value: currency.format(totalPaid) },
      { label: "Outstanding total", value: currency.format(totalOutstanding) },
    ],
  };
}

function MetricCard({ metric }: { metric: SummaryMetric }) {
  return (
    <article className={`reports-metric-card ${metric.tone ?? "neutral"}`}>
      <div className="reports-metric-icon">
        {metric.label.includes("ticket") ? <Ticket size={18} /> : metric.label.includes("Customer") ? <Users size={18} /> : <BarChart3 size={18} />}
      </div>
      <div className="reports-metric-content">
        <p>{metric.label}</p>
        <strong>{metric.value}</strong>
        <span>{metric.helper}</span>
      </div>
    </article>
  );
}

function OverviewCard({ metric }: { metric: OverviewMetric }) {
  return (
    <article className="reports-overview-item">
      <div className="reports-overview-item-header">
        <div className={`reports-overview-icon ${metric.icon}`}>
          {metric.icon === "tickets" ? <Ticket size={18} /> : metric.icon === "subcon" ? <Users size={18} /> : <BarChart3 size={18} />}
        </div>
        <div>
          <p>{metric.label}</p>
          <strong>Overview</strong>
        </div>
      </div>
      <div className="reports-overview-stats">
        <div>
          <span>Daily</span>
          <strong>{metric.daily}</strong>
        </div>
        <div>
          <span>Weekly</span>
          <strong>{metric.weekly}</strong>
        </div>
        <div>
          <span>Monthly</span>
          <strong>{metric.monthly}</strong>
        </div>
      </div>
    </article>
  );
}

function TrendChart({
  data,
  formatValue,
  variant,
}: {
  data: TrendPoint[];
  formatValue: (value: number) => string;
  variant: TrendVariant;
}) {
  if (variant === "line") {
    return <LineTrendChart data={data} formatValue={formatValue} />;
  }
  const max = Math.max(...data.map((item) => item.value), 1);
  return (
    <div className="reports-trend-chart">
      {data.map((item) => (
        <div className="reports-trend-bar-wrap" key={item.label}>
          <span>{formatValue(item.value)}</span>
          <div className="reports-trend-rail">
            <div
              className="reports-trend-bar"
              style={{ height: `${Math.max((item.value / max) * 100, item.value > 0 ? 12 : 0)}%` }}
            />
          </div>
          <strong>{item.label}</strong>
        </div>
      ))}
    </div>
  );
}

function LineTrendChart({
  data,
  formatValue,
}: {
  data: TrendPoint[];
  formatValue: (value: number) => string;
}) {
  const chartWidth = 640;
  const chartHeight = 220;
  const paddingX = 20;
  const paddingTop = 18;
  const paddingBottom = 36;
  const innerWidth = chartWidth - paddingX * 2;
  const innerHeight = chartHeight - paddingTop - paddingBottom;
  const max = Math.max(...data.map((item) => item.value), 1);
  const step = data.length > 1 ? innerWidth / (data.length - 1) : 0;

  const points = data.map((item, index) => {
    const x = paddingX + step * index;
    const y = paddingTop + innerHeight - (item.value / max) * innerHeight;
    return {
      ...item,
      x,
      y,
    };
  });

  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
  const areaPath = points.length
    ? `${linePath} L ${points[points.length - 1].x} ${chartHeight - paddingBottom} L ${points[0].x} ${chartHeight - paddingBottom} Z`
    : "";

  return (
    <div className="reports-line-chart">
      <svg
        aria-hidden="true"
        className="reports-line-chart-svg"
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = paddingTop + innerHeight - innerHeight * ratio;
          return <line className="reports-line-grid" key={ratio} x1={paddingX} x2={chartWidth - paddingX} y1={y} y2={y} />;
        })}
        {areaPath ? <path className="reports-line-area" d={areaPath} /> : null}
        {linePath ? <path className="reports-line-path" d={linePath} /> : null}
        {points.map((point) => (
          <circle className="reports-line-point" cx={point.x} cy={point.y} key={point.label} r="4.5" />
        ))}
      </svg>
      <div className="reports-line-chart-labels">
        {points.map((point) => (
          <div className="reports-line-chart-label" key={point.label}>
            <span>{formatValue(point.value)}</span>
            <strong>{point.label}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function BreakdownChart({
  data,
  formatValue,
}: {
  data: BreakdownPoint[];
  formatValue: (value: number) => string;
}) {
  const max = Math.max(...data.map((item) => item.value), 1);
  return (
    <div className="reports-breakdown-list">
      {data.map((item) => (
        <div className="reports-breakdown-row" key={item.label}>
          <div className="reports-breakdown-meta">
            <span>{item.label}</span>
            <strong>{formatValue(item.value)}</strong>
          </div>
          <div className="reports-breakdown-track">
            <div
              className={`reports-breakdown-fill ${item.tone ?? "neutral"}`}
              style={{ width: `${(item.value / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function ReportTable<Row extends object>({
  columns,
  emptyMessage,
  onSort,
  rows,
  sortColumn,
  sortDirection,
}: {
  columns: TableColumn<Row>[];
  emptyMessage: string;
  onSort: (column: string) => void;
  rows: Row[];
  sortColumn: string;
  sortDirection: SortDirection;
}) {
  return (
    <div className="reports-table-wrap">
      <table className="reports-table">
        <thead>
          <tr>
            {columns.map((column) => {
              const isActive = sortColumn === column.id;
              return (
                <th
                  className={column.align === "right" ? "num" : undefined}
                  key={column.label}
                >
                  {column.sortValue ? (
                    <button
                      className={isActive ? "active" : ""}
                      onClick={() => onSort(column.id)}
                      type="button"
                    >
                      {column.label}
                      <span>{isActive ? (sortDirection === "asc" ? "^" : "v") : "+/-"}</span>
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="reports-empty-cell" colSpan={columns.length}>
                <EmptyState message={emptyMessage} />
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={index}>
                {columns.map((column) => (
                  <td className={column.align === "right" ? "num" : undefined} data-label={column.label} key={column.label}>
                    {column.render ? column.render(row) : String((row as Record<string, unknown>)[column.id] ?? "")}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="reports-empty-state">
      <div className="reports-empty-icon">
        <BarChart3 size={20} />
      </div>
      <strong>No records found</strong>
      <p>{message}</p>
    </div>
  );
}

function StackedCell({ subtitle, title }: { subtitle: string; title: string }) {
  return (
    <div className="reports-stacked-cell">
      <strong>{title}</strong>
      <span>{subtitle}</span>
    </div>
  );
}

function StatusPill({ value }: { value: string }) {
  const tone =
    /paid|collected|clean|active/i.test(value)
      ? "success"
      : /overdue|disputed|inactive/i.test(value)
        ? "danger"
        : /partial|due|high volume/i.test(value)
          ? "warning"
          : "neutral";
  return <span className={`reports-status-pill ${tone}`}>{value}</span>;
}

function uniqueValues(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function startOfWeek(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

function dateInRange(value: string, startDate: string, endDate: string) {
  if (!value) return false;
  if (startDate && value < startDate) return false;
  if (endDate && value > endDate) return false;
  return true;
}

function buildMonthlyTrend<Row>(rows: Row[], getDate: (row: Row) => string, getValue: (row: Row) => number) {
  const totals = new Map<string, number>();
  rows.forEach((row) => {
    const value = getDate(row);
    if (!value) return;
    const key = value.slice(0, 7);
    totals.set(key, (totals.get(key) ?? 0) + getValue(row));
  });
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-6)
    .map(([key, value]) => ({
      label: `${monthNames[Number(key.slice(5, 7)) - 1].slice(0, 3)} ${key.slice(2, 4)}`,
      value,
    }));
}

function buildBreakdown<Row>(rows: Row[], getLabel: (row: Row) => string, getValue: (row: Row) => number) {
  const totals = new Map<string, number>();
  rows.forEach((row) => {
    const label = getLabel(row) || "Unspecified";
    totals.set(label, (totals.get(label) ?? 0) + getValue(row));
  });
  return [...totals.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 6);
}

function sortRows<Row>(
  rows: Row[],
  sort: { column: string; direction: SortDirection },
  accessors: Record<string, (row: Row) => number | string>,
) {
  const accessor = accessors[sort.column];
  if (!accessor) return rows;
  return [...rows].sort((left, right) => {
    const leftValue = accessor(left);
    const rightValue = accessor(right);
    const comparison = compareValues(leftValue, rightValue);
    return sort.direction === "asc" ? comparison : -comparison;
  });
}

function compareValues(left: number | string, right: number | string) {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
}

function formatBillingPeriod(row: BillingReportRow) {
  return `${monthNames[row.billing_month - 1]} ${row.billing_year} - ${row.billing_period === "first_half" ? "1st half" : "2nd half"}`;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function downloadCsv<Row extends object>(
  filename: string,
  columns: { format?: (row: Row) => string; key: string; label: string }[],
  rows: Row[],
) {
  const csv = [
    columns.map((column) => escapeCsv(column.label)).join(","),
    ...rows.map((row) =>
      columns.map((column) => escapeCsv(column.format ? column.format(row) : String((row as Record<string, unknown>)[column.key] ?? ""))).join(","),
    ),
  ].join("\n");
  downloadBlob(filename, "text/csv;charset=utf-8;", csv);
}

function downloadExcel<Row extends object>(
  filename: string,
  columns: { format?: (row: Row) => string; key: string; label: string }[],
  rows: Row[],
) {
  const html = `
    <table>
      <thead>
        <tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) =>
              `<tr>${columns
                .map((column) => `<td>${escapeHtml(column.format ? column.format(row) : String((row as Record<string, unknown>)[column.key] ?? ""))}</td>`)
                .join("")}</tr>`,
          )
          .join("")}
      </tbody>
    </table>
  `;
  downloadBlob(filename, "application/vnd.ms-excel", html);
}

function downloadPdf<Row extends object>(
  filename: string,
  columns: { format?: (row: Row) => string; key: string; label: string }[],
  rows: Row[],
  title: string,
  subtitleLines: string[],
) {
  const pdfContent = buildPdfLines(columns, rows, title, subtitleLines);
  const pdfBytes = createSimplePdf(pdfContent);
  downloadBlob(filename, "application/pdf", pdfBytes);
}

function openPrintPreview<Row extends object>({
  columns,
  promptPdf,
  rows,
  subtitleLines,
  title,
}: {
  columns: { format?: (row: Row) => string; key: string; label: string }[];
  promptPdf: boolean;
  rows: Row[];
  subtitleLines: string[];
  title: string;
}) {
  const popup = window.open("", "_blank", "width=1200,height=800");
  if (!popup) {
    NotificationService.showError("Allow pop-ups to open the print preview.");
    return;
  }

  popup.document.write(`
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
        <link
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <style>
          body { font-family: "Poppins", "Helvetica Neue", Helvetica, Arial, sans-serif; color: #0f172a; margin: 32px; }
          h1 { margin: 0 0 8px; }
          p { color: #475569; margin: 0 0 24px; }
          p.meta-line { margin: 0 0 6px; }
          p.meta-line:last-of-type { margin: 0 0 24px; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #cbd5e1; padding: 10px 12px; text-align: left; font-size: 12px; }
          thead { background: #eff6ff; }
          @media print {
            body { margin: 20px; }
          }
        </style>
        <script>
          window.addEventListener("load", function () {
            window.setTimeout(function () {
              window.focus();
              window.print();
            }, 250);
          });
        </script>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        ${subtitleLines.map((line, index) => `<p class="meta-line">${escapeHtml(line)}${promptPdf && index === subtitleLines.length - 1 ? " - Use Save as PDF in the print dialog." : ""}</p>`).join("")}
        <table>
          <thead>
            <tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (row) =>
                  `<tr>${columns
                    .map((column) => `<td>${escapeHtml(column.format ? column.format(row) : String((row as Record<string, unknown>)[column.key] ?? ""))}</td>`)
                    .join("")}</tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </body>
    </html>
  `);
  popup.document.close();
}

function buildPdfLines<Row extends object>(
  columns: { format?: (row: Row) => string; key: string; label: string }[],
  rows: Row[],
  title: string,
  subtitleLines: string[],
) {
  const portraitWidth = 96;
  const landscapeWidth = 132;
  const widths = columns.map((column) =>
    Math.min(
      24,
      Math.max(
        column.label.length,
        ...rows.slice(0, 30).map((row) =>
          String(column.format ? column.format(row) : (row as Record<string, unknown>)[column.key] ?? "").length,
        ),
      ),
    ),
  );
  const totalWidth = widths.reduce((sum, width) => sum + width, 0) + Math.max(columns.length - 1, 0) * 3;
  const orientation: "landscape" | "portrait" = totalWidth > portraitWidth ? "landscape" : "portrait";
  const pageWidth = orientation === "landscape" ? landscapeWidth : portraitWidth;
  if (totalWidth > pageWidth) {
    let overflow = totalWidth - pageWidth;
    for (let index = widths.length - 1; index >= 0 && overflow > 0; index -= 1) {
      const nextWidth = Math.max(8, widths[index] - overflow);
      overflow -= widths[index] - nextWidth;
      widths[index] = nextWidth;
    }
  }

  const fit = (value: string, width: number) => {
    if (value.length <= width) return value.padEnd(width, " ");
    if (width <= 1) return value.slice(0, width);
    if (width <= 3) return value.slice(0, width);
    return `${value.slice(0, width - 3)}...`;
  };

  const header = columns.map((column, index) => fit(column.label, widths[index])).join(" | ");
  const divider = widths.map((width) => "-".repeat(width)).join("-+-");
  const body = rows.map((row) =>
    columns
      .map((column, index) =>
        fit(String(column.format ? column.format(row) : (row as Record<string, unknown>)[column.key] ?? ""), widths[index]))
      .join(" | "),
  );
  return {
    lines: [title, ...subtitleLines, "", header, divider, ...body],
    orientation,
  };
}

function createSimplePdf({
  lines,
  orientation,
}: {
  lines: string[];
  orientation: "landscape" | "portrait";
}) {
  const encoder = new TextEncoder();
  const escapePdfText = (value: string) => value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const pageWidth = orientation === "landscape" ? 842 : 612;
  const pageHeight = orientation === "landscape" ? 612 : 842;
  const startX = 40;
  const startY = pageHeight - 42;
  const lineHeight = 15;
  const maxLinesPerPage = Math.max(1, Math.floor((pageHeight - 80) / lineHeight));
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += maxLinesPerPage) {
    pages.push(lines.slice(index, index + maxLinesPerPage));
  }

  const objects: string[] = [];
  const addObject = (content: string) => {
    objects.push(content);
    return objects.length;
  };

  const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");
  const contentIds = pages.map((pageLines) => {
    const text = [
      "BT",
      "/F1 9 Tf",
      `${startX} ${startY} Td`,
      ...pageLines.flatMap((line, lineIndex) =>
        lineIndex === 0
          ? [`(${escapePdfText(line)}) Tj`]
          : [`0 -${lineHeight} Td`, `(${escapePdfText(line)}) Tj`],
      ),
      "ET",
    ].join("\n");
    const stream = encoder.encode(text);
    return addObject(`<< /Length ${stream.length} >>\nstream\n${text}\nendstream`);
  });

  const pageIds = contentIds.map((contentId) =>
    addObject(`<< /Type /Page /Parent PAGES_ID 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`),
  );
  const pagesId = addObject(`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`);

  pageIds.forEach((id, index) => {
    objects[id - 1] = objects[id - 1].replace("PAGES_ID", String(pagesId));
  });

  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return encoder.encode(pdf);
}

function downloadBlob(filename: string, mimeType: string, content: BlobPart) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function escapeCsv(value: string) {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
