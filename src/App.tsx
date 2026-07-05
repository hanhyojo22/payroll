import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import {
  BadgeDollarSign,
  ArrowLeft,
  BadgeInfo,
  Bell,
  Briefcase,
  CalendarClock,
  CalendarOff,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  CreditCard,
  Download,
  Eye,
  FileText,
  Filter,
  Heart,
  HelpCircle,
  History,
  LayoutDashboard,
  LogOut,
  Mail,
  MapPin,
  Maximize2,
  MoreVertical,
  Pencil,
  Phone,
  Plus,
  Printer,
  RotateCw,
  Save,
  Search,
  Settings,
  Trash2,
  Upload,
  UserCheck,
  UserRound,
  Users,
  UserX,
  Wrench,
  X,
} from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { hasSupabaseConfig, supabase } from "./supabase";
import {
  attendanceTotalsForEmployee,
  dailyTicketEntriesForPayrollPeriod,
  payPeriodLabel,
  payrollItemPayloadForEmployee,
} from "./domain/payroll";
import {
  netPay,
  normalizeTicketCount,
  ticketGrossPay,
} from "./domain/tickets";
import { expenseOverdueReferenceDate } from "./domain/expenses";
import {
  loadAttendanceEntries,
  loadBillingRecords,
  loadBillingSettings,
  loadSubconDailyTickets,
  loadSubcontractors,
  loadSubcontractorAdvances,
  loadDashboardSummary,
  loadCollections,
  loadDailyTicketEntries,
  loadEmployeePayrollRuns,
  loadEmployees,
  loadExpenseCategories,
  loadExpenses,
  loadPayments,
  loadPayrollHistoryRows,
  loadPayrollRunItems,
  loadPayrollRuns,
  loadPayrollSettings,
  loadPositions,
  loadEmployeeAdvances,
} from "./lib/supabaseData";
import { queueMutation, readCachedResource, writeCachedResource } from "./lib/offlineDb";
import { flushPendingMutations, isOfflineLikeError } from "./lib/offlineSync";
import { BillingFeature, BillingHistoryFeature, BillingSettingsManager } from "./features/billing/BillingFeature";
import { saveSubcontractor } from "./features/billing/billingRepository";
import { saveSubconDailyTicket } from "./features/billing/subconTicketRepository";
import { CollectionHistoryFeature, CollectionsFeature } from "./features/collections/CollectionsFeature";
import { normalizeReceivable } from "./features/collections/collectionRepository";
import { ExpenseCategoriesManager, ExpensesFeature } from "./features/expenses/ExpensesFeature";
import { PaymentsFeature } from "./features/payments/PaymentsFeature";
import { EmployeeAdvancesFeature } from "./features/payroll/EmployeeAdvancesFeature";
import { PayrollFeature, PayrollHistoryFeature, PayrollSettingsManager } from "./features/payroll/PayrollFeature";
import { SubcontractorsFeature } from "./features/subcontractors/SubcontractorsFeature";
import { Sidebar } from "./Sidebar";
import { MoneyField as MoneyInput } from "./shared/components/MoneyField";
import { NotificationService } from "./shared/notifications/NotificationService";
import { Spinner, SyncIndicator, PageSkeleton } from "./shared/components/Spinner";
import { StatusBadge as StatusPill } from "./shared/components/StatusBadge";
import { DataTable } from "./shared/components/DataTable";
import { PageHeader, RecordTitle, Toolbar } from "./shared/components/PageLayout";
import { FormActions, Modal, RowActions, TextField } from "./shared/components/FormLayout";
import type { QueueOfflineMutation } from "./shared/types";
import { currency, formatMoney, toNumber } from "./shared/utils/currency";
import { currentMonth, currentYear, isBeforeToday, isToday, monthNames, todayKey } from "./shared/utils/dates";
import { friendlyError } from "./shared/utils/errors";
import { formatPhoneNumber, normalizePhoneDigits } from "./shared/utils/phone";
import type {
  AttendanceEntry,
  AttendanceStatus,
  BillingRecord,
  BillingSettings,
  Subcontractor,
  SubcontractorAdvance,
  CollectionReminder,
  DashboardSummary,
  DailyTicketEntry,
  EmployeeAdvance,
  Expense,
  ExpenseCategory,
  SubconDailyTicket,
  Employee,
  EmployeeFormValues,
  PaymentFormValues,
  PaymentReminder,
  PayrollHistoryRow,
  PayrollRun,
  PayrollRunFormValues,
  PayrollRunItem,
  PayrollPayPeriod,
  PayrollRunWithItems,
  PayrollSettings,
  Position,
  PositionFormValues,
  ResourceKey,
} from "./types";

type View =
  | "attendance"
  | "billing"
  | "billing-history"
  | "billing-settings"
  | "dashboard"
  | "employees"
  | "employee-add"
  | "expenses"
  | "personal-expenses"
  | "expense-categories"
  | "compensation"
  | "daily-tickets"
  | "daily-tickets-subcon"
  | "payroll"
  | "payroll-settings"
  | "payroll-history"
  | "payments"
  | "collections"
  | "collection-history"
  | "subcontractors";
type ResourceStatus = "idle" | "loading" | "ready";

const initialResourceStatuses: Record<ResourceKey, ResourceStatus> = {
  attendanceEntries: "idle",
  billingRecords: "idle",
  billingSettings: "idle",
  collections: "idle",
  dashboardSummary: "idle",
  dailyTicketEntries: "idle",
  expenseCategories: "idle",
  expenses: "idle",
  subconDailyTickets: "idle",
  employees: "idle",
  payments: "idle",
  payrollHistory: "idle",
  payrollRuns: "idle",
  payrollSettings: "idle",
  positions: "idle",
  employeeAdvances: "idle",
  subcontractorAdvances: "idle",
  subcontractors: "idle",
};

const initialResourceHydration: Record<ResourceKey, boolean> = {
  attendanceEntries: false,
  billingRecords: false,
  billingSettings: false,
  collections: false,
  dashboardSummary: false,
  dailyTicketEntries: false,
  expenseCategories: false,
  expenses: false,
  subconDailyTickets: false,
  employees: false,
  payments: false,
  payrollHistory: false,
  payrollRuns: false,
  payrollSettings: false,
  positions: false,
  employeeAdvances: false,
  subcontractorAdvances: false,
  subcontractors: false,
};

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${period}`;
}

const STANDARD_WORK_HOURS = 8;

function hoursBetween(timeIn: string, timeOut: string): number {
  if (!timeIn || !timeOut) return 0;
  const [inH, inM] = timeIn.split(":").map(Number);
  const [outH, outM] = timeOut.split(":").map(Number);
  const minutes = (outH * 60 + outM) - (inH * 60 + inM);
  return minutes > 0 ? minutes / 60 : 0;
}

function computeDailyEarnings(dailyRate: number, status: AttendanceStatus | "", timeIn: string, timeOut: string): number {
  if (status !== "present" && status !== "half_day") return 0;
  const hoursWorked = hoursBetween(timeIn, timeOut);
  if (hoursWorked <= 0) return 0;
  return dailyRate * Math.min(hoursWorked / STANDARD_WORK_HOURS, 1);
}

const viewPaths: Record<View, string> = {
  attendance: "/attendance",
  billing: "/billing",
  "billing-history": "/billing/history",
  "billing-settings": "/settings/billing",
  dashboard: "/dashboard",
  employees: "/employees",
  "employee-add": "/employees/new",
  expenses: "/expenses",
  "personal-expenses": "/personal/expenses",
  "expense-categories": "/settings/expense-categories",
  compensation: "/positions",
  "daily-tickets": "/daily-tickets",
  "daily-tickets-subcon": "/daily-tickets/subcontractors",
  payroll: "/payroll",
  "payroll-settings": "/settings/payroll",
  "payroll-history": "/payroll/history",
  payments: "/payments",
  collections: "/collections",
  "collection-history": "/collections/history",
  subcontractors: "/subcontractors",
};

const viewResources: Record<View, ResourceKey[]> = {
  attendance: ["positions", "employees", "attendanceEntries"],
  billing: ["billingRecords", "billingSettings", "dailyTicketEntries", "collections", "subcontractors", "subcontractorAdvances", "subconDailyTickets", "payments"],
  "billing-history": ["billingRecords", "billingSettings", "dailyTicketEntries", "collections", "subcontractors", "subcontractorAdvances", "subconDailyTickets", "payments"],
  "billing-settings": ["billingSettings", "subcontractors"],
  dashboard: ["dashboardSummary"],
  employees: ["employees", "positions", "payrollRuns", "employeeAdvances"],
  "employee-add": ["employees", "positions", "payrollRuns", "employeeAdvances"],
  expenses: ["employees", "expenses", "expenseCategories"],
  "personal-expenses": ["employees", "expenses", "expenseCategories"],
  "expense-categories": ["expenseCategories"],
  compensation: ["positions", "employees"],
  "daily-tickets": ["positions", "employees", "dailyTicketEntries", "subcontractors", "subconDailyTickets", "payrollRuns"],
  "daily-tickets-subcon": ["positions", "employees", "dailyTicketEntries", "subcontractors", "subconDailyTickets", "payrollRuns"],
  payroll: ["positions", "employees", "attendanceEntries", "dailyTicketEntries", "payrollRuns", "employeeAdvances", "payrollHistory", "payrollSettings"],
  "payroll-settings": ["payrollSettings"],
  "payroll-history": ["positions", "employees", "attendanceEntries", "dailyTicketEntries", "payrollRuns", "employeeAdvances", "payrollHistory", "payrollSettings"],
  payments: ["expenses", "expenseCategories"],
  collections: ["collections"],
  "collection-history": ["collections"],
  subcontractors: ["subcontractors", "subcontractorAdvances", "subconDailyTickets", "billingRecords", "payments"],
};

type BreadcrumbItem = {
  label: string;
  view?: View;
};

type GlobalSearchResult = {
  id: string;
  label: string;
  detail: string;
  type: "employee" | "subcontractor";
};

const viewBreadcrumbs: Record<View, BreadcrumbItem[]> = {
  attendance: [{ label: "Dashboard", view: "dashboard" }, { label: "Attendance", view: "attendance" }],
  billing: [{ label: "Dashboard", view: "dashboard" }, { label: "Billing", view: "billing" }],
  "billing-history": [{ label: "Dashboard", view: "dashboard" }, { label: "Billing", view: "billing" }, { label: "History", view: "billing-history" }],
  "billing-settings": [{ label: "Dashboard", view: "dashboard" }, { label: "Settings" }, { label: "Billing Settings", view: "billing-settings" }],
  dashboard: [{ label: "Dashboard", view: "dashboard" }],
  employees: [{ label: "Dashboard", view: "dashboard" }, { label: "Employees", view: "employees" }],
  "employee-add": [{ label: "Dashboard", view: "dashboard" }, { label: "Employees", view: "employees" }, { label: "Add employee", view: "employee-add" }],
  expenses: [{ label: "Dashboard", view: "dashboard" }, { label: "Expenses", view: "expenses" }],
  "personal-expenses": [{ label: "Dashboard", view: "dashboard" }, { label: "Personal", view: "personal-expenses" }, { label: "Expenses", view: "personal-expenses" }],
  "expense-categories": [{ label: "Dashboard", view: "dashboard" }, { label: "Settings" }, { label: "Expense Categories", view: "expense-categories" }],
  compensation: [{ label: "Dashboard", view: "dashboard" }, { label: "Settings" }, { label: "Positions", view: "compensation" }],
  "daily-tickets": [{ label: "Dashboard", view: "dashboard" }, { label: "Daily Tickets", view: "daily-tickets" }, { label: "Employees", view: "daily-tickets" }],
  "daily-tickets-subcon": [{ label: "Dashboard", view: "dashboard" }, { label: "Daily Tickets", view: "daily-tickets" }, { label: "Subcontractors", view: "daily-tickets-subcon" }],
  payroll: [{ label: "Dashboard", view: "dashboard" }, { label: "Payroll", view: "payroll" }],
  "payroll-settings": [{ label: "Dashboard", view: "dashboard" }, { label: "Settings" }, { label: "Payroll Settings", view: "payroll-settings" }],
  "payroll-history": [{ label: "Dashboard", view: "dashboard" }, { label: "Payroll", view: "payroll" }, { label: "History", view: "payroll-history" }],
  payments: [{ label: "Dashboard", view: "dashboard" }, { label: "Payment History", view: "payments" }],
  collections: [{ label: "Dashboard", view: "dashboard" }, { label: "Collections", view: "collections" }],
  "collection-history": [{ label: "Dashboard", view: "dashboard" }, { label: "Collections", view: "collections" }, { label: "History", view: "collection-history" }],
  subcontractors: [{ label: "Dashboard", view: "dashboard" }, { label: "Subcontractors", view: "subcontractors" }],
};

const emptyDashboardSummary: DashboardSummary = {
  activeEmployeeCount: 0,
  currentPayrollItemCount: 0,
  pendingPayroll: 0,
  paidPayroll: 0,
  pendingCollections: 0,
  collectedTotal: 0,
  overdueCollectionBalance: 0,
  collectedThisMonth: 0,
  collectionAging: { current: 0, days1To30: 0, days31To60: 0, days61To90: 0, daysOver90: 0 },
  latestRun: null,
  dueTodayPayments: [],
  overduePayments: [],
  dueTodayCollections: [],
  overdueCollections: [],
  dueTodayExpenses: [],
  overdueExpenses: [],
};

const viewFromPath = (path: string): View => {
  const match = Object.entries(viewPaths).find(([, routePath]) => routePath === path);
  return (match?.[0] as View | undefined) ?? "dashboard";
};

function AppBreadcrumbs({
  extraItems,
  navigate,
  view,
}: {
  extraItems?: BreadcrumbItem[];
  navigate: (view: View) => void;
  view: View;
}) {
  const items = extraItems?.length ? [...viewBreadcrumbs[view], ...extraItems] : viewBreadcrumbs[view];
  const backTarget = [...items]
    .slice(0, -1)
    .reverse()
    .find((item) => item.view)?.view;
  const canGoBack = Boolean(backTarget);

  return (
    <nav aria-label="Breadcrumb" className="app-breadcrumb-bar">
      <button
        className="breadcrumb-back-button"
        disabled={!canGoBack}
        onClick={() => {
          if (backTarget) navigate(backTarget);
        }}
        type="button"
      >
        <ArrowLeft size={16} />
        Back
      </button>
      <ol className="breadcrumb-list">
        {items.map((item, index) => {
          const isCurrent = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`}>
              {index > 0 && <ChevronRight aria-hidden="true" size={14} />}
              {item.view && !isCurrent ? (
                <button onClick={() => navigate(item.view!)} type="button">
                  {item.label}
                </button>
              ) : (
                <span aria-current={isCurrent ? "page" : undefined}>{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

const emptyPayment: PaymentFormValues = {
  title: "",
  type: "loan",
  amount: "",
  due_date: todayKey(),
  status: "pending",
  notes: "",
};

const emptyEmployee: EmployeeFormValues = {
  full_name: "",
  role: "",
  position_id: "",
  department: "",
  contact_number: "",
  email: "",
  address: "",
  profile_photo_url: "",
  hire_date: todayKey(),
  status: "active",
  wage_category: "new",
  gender: "",
  monthly_salary: "",
  sss_number: "",
  philhealth_number: "",
  pagibig_number: "",
  sss_deduction: "",
  philhealth_deduction: "",
  pagibig_deduction: "",
  withholding_tax: "",
  tin_number: "",
  emergency_contact_name: "",
  emergency_contact_number: "",
  emergency_contact_relation: "",
  notes: "",
};


export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoadingSession(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoadingSession(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (!hasSupabaseConfig) {
    return (
      <FullPageMessage
        title="Supabase is not configured"
        text="Create a .env file from .env.example, add your Supabase URL and anon key, then restart the dev server."
      />
    );
  }

  if (loadingSession) {
    return <FullPageMessage title="Loading workspace" text="Checking session..." />;
  }

  if (!session) {
    return <Login />;
  }

  return <Workspace session={session} />;
}
function FullPageMessage({ title, text }: { title: string; text: string }) {
  return (
    <main className="center-screen">
      <section className="auth-panel">
        <div className="brand-mark">
          {title.toLowerCase().includes("loading")
            ? <Spinner />
            : <img className="brand-logo mark-logo" src="/logo.png" alt="JMSolution Information Services" />}
        </div>
        <h1>{title}</h1>
        <p>{text}</p>
      </section>
    </main>
  );
}
function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);

    const result =
      mode === "sign-in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    if (result.error) {
      NotificationService.showError(friendlyError(result.error));
    } else if (mode === "sign-up" && !result.data.session) {
      NotificationService.showSuccess("Account created. Check your email if confirmation is enabled.");
    }
    setBusy(false);
  }

  return (
    <main className="center-screen login-screen">
      <section className="auth-panel">
        <div className="brand-row auth-brand-row">
          <div className="brand-mark logo-brand-mark">
            <img className="brand-logo mark-logo" src="/logo.png" alt="JMSolution Information Services" />
          </div>
          <div className="auth-brand-copy">
            <p className="eyebrow">Payroll workspace</p>
            <h1>Payroll System</h1>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="stack">
          <label>
            Email
            <input
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label>
            Password
            <input
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              minLength={6}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          <button className="primary-button" disabled={busy} type="submit">
            {busy && <Spinner size="small" />}
            {busy ? "Please wait..." : mode === "sign-in" ? "Sign in" : "Create admin"}
          </button>
        </form>
        <button
          className="text-button"
          onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
          type="button"
        >
          {mode === "sign-in" ? "Create the admin account" : "Use existing account"}
        </button>
      </section>
    </main>
  );
}

function Workspace({ session }: { session: Session }) {
  const [view, setView] = useState<View>(() => viewFromPath(window.location.pathname));
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary>(emptyDashboardSummary);
  const [payments, setPayments] = useState<PaymentReminder[]>([]);
  const [collections, setCollections] = useState<CollectionReminder[]>([]);
  const [attendanceEntries, setAttendanceEntries] = useState<AttendanceEntry[]>([]);
  const [dailyTicketEntries, setDailyTicketEntries] = useState<DailyTicketEntry[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [subconDailyTickets, setSubconDailyTickets] = useState<SubconDailyTicket[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [payrollRuns, setPayrollRuns] = useState<PayrollRunWithItems[]>([]);
  const [payrollSettings, setPayrollSettings] = useState<PayrollSettings | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [payrollHistoryRows, setPayrollHistoryRows] = useState<PayrollHistoryRow[]>([]);
  const [employeeAdvances, setEmployeeAdvances] = useState<EmployeeAdvance[]>([]);
  const [subcontractorAdvances, setSubcontractorAdvances] = useState<SubcontractorAdvance[]>([]);
  const [billingRecords, setBillingRecords] = useState<BillingRecord[]>([]);
  const [billingSettings, setBillingSettings] = useState<BillingSettings | null>(null);
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);
  const [selectedEmployeeDetailId, setSelectedEmployeeDetailId] = useState<string | null>(null);
  const [selectedEmployeeDetailNonce, setSelectedEmployeeDetailNonce] = useState(0);
  const [employeeDetailOpen, setEmployeeDetailOpen] = useState(false);
  const [selectedSubcontractorId, setSelectedSubcontractorId] = useState<string | null>(null);
  const [subcontractorAccountTab, setSubcontractorAccountTab] = useState<"daily" | "billing" | "payouts" | "advances">("daily");
  const [resourceStatuses, setResourceStatuses] = useState(initialResourceStatuses);
  const [resourceHydration, setResourceHydration] = useState(initialResourceHydration);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const globalSearchRef = useRef<HTMLDivElement | null>(null);

  const resourceSetters: Record<ResourceKey, (data: unknown) => void> = {
    attendanceEntries: (data) => setAttendanceEntries(data as AttendanceEntry[]),
    billingRecords: (data) => setBillingRecords(data as BillingRecord[]),
    billingSettings: (data) => setBillingSettings(data as BillingSettings | null),
    collections: (data) => setCollections((data as CollectionReminder[]).map(normalizeReceivable)),
    dashboardSummary: (data) => setDashboardSummary({
      ...emptyDashboardSummary,
      ...(data as DashboardSummary),
      collectionAging: {
        ...emptyDashboardSummary.collectionAging,
        ...(data as DashboardSummary).collectionAging,
      },
    }),
    dailyTicketEntries: (data) => setDailyTicketEntries(data as DailyTicketEntry[]),
    employees: (data) => setEmployees(data as Employee[]),
    expenseCategories: (data) => setExpenseCategories(data as ExpenseCategory[]),
    expenses: (data) => setExpenses(data as Expense[]),
    payments: (data) => setPayments(data as PaymentReminder[]),
    payrollHistory: (data) => setPayrollHistoryRows(data as PayrollHistoryRow[]),
    payrollRuns: (data) => setPayrollRuns(data as PayrollRunWithItems[]),
    payrollSettings: (data) => setPayrollSettings(data as PayrollSettings | null),
    positions: (data) => setPositions(data as Position[]),
    employeeAdvances: (data) => setEmployeeAdvances(data as EmployeeAdvance[]),
    subcontractorAdvances: (data) => setSubcontractorAdvances(data as SubcontractorAdvance[]),
    subconDailyTickets: (data) => setSubconDailyTickets(data as SubconDailyTicket[]),
    subcontractors: (data) => setSubcontractors(data as Subcontractor[]),
  };

  const resourceLoaders: Record<ResourceKey, () => Promise<{ data: unknown; error: unknown }>> = {
    attendanceEntries: async () => loadAttendanceEntries(supabase!),
    billingRecords: async () => loadBillingRecords(supabase!),
    billingSettings: async () => loadBillingSettings(supabase!),
    collections: async () => loadCollections(supabase!),
    dashboardSummary: async () => loadDashboardSummary(supabase!),
    dailyTicketEntries: async () => loadDailyTicketEntries(supabase!),
    employees: async () => loadEmployees(supabase!),
    expenseCategories: async () => loadExpenseCategories(supabase!),
    expenses: async () => loadExpenses(supabase!),
    payments: async () => loadPayments(supabase!),
    payrollHistory: async () => loadPayrollHistoryRows(supabase!),
    payrollRuns: async () => loadPayrollRuns(supabase!),
    payrollSettings: async () => loadPayrollSettings(supabase!),
    positions: async () => loadPositions(supabase!),
    employeeAdvances: async () => loadEmployeeAdvances(supabase!),
    subcontractorAdvances: async () => loadSubcontractorAdvances(supabase!),
    subconDailyTickets: async () => loadSubconDailyTickets(supabase!),
    subcontractors: async () => loadSubcontractors(supabase!),
  };

  const queueOfflineMutation: QueueOfflineMutation = async (mutation) => {
    await queueMutation({ ...mutation, userId: session.user.id });
    NotificationService.showSuccess("Saved locally. It will sync when online.");
  };

  async function syncQueuedMutations(showToast = false) {
    if (!supabase || !navigator.onLine) return;
    const result = await flushPendingMutations(supabase, session.user.id);
    if (result.failed.length > 0) {
      NotificationService.showError(`${result.failed.length} offline change could not sync. Check the record and try again.`);
    } else if (showToast && result.synced.length > 0) {
      NotificationService.showSuccess(`${result.synced.length} offline change${result.synced.length === 1 ? "" : "s"} synced.`);
    }
    if (result.synced.length > 0) {
      const affected = Array.from(new Set(result.synced.flatMap((mutation) => mutation.affectedResources)));
      await Promise.all(affected.map((resource) => loadResource(resource, true)));
    }
  }

  function navigate(nextView: View) {
    setView(nextView);
    if (window.innerWidth <= 900) {
      setSidebarCollapsed(true);
      setMobileNavOpen(false);
    }
    const nextPath = viewPaths[nextView];
    if (window.location.pathname !== nextPath) {
      window.history.pushState(null, "", nextPath);
    }
  }

  async function loadResource(resource: ResourceKey, force = false) {
    if (!supabase) return;
    if (!force && (resourceStatuses[resource] === "loading" || resourceStatuses[resource] === "ready")) return;
    const previousStatus = resourceStatuses[resource];
    const setResourceData = resourceSetters[resource];
    const cached = !force ? await readCachedResource<unknown>(resource, session.user.id) : null;

    if (cached) {
      setResourceData(cached);
      setResourceHydration((current) => ({ ...current, [resource]: true }));
    }

    setResourceStatuses((current) => current[resource] === "ready" ? current : { ...current, [resource]: "loading" });

    try {
      const result = await resourceLoaders[resource]();

      if (result.error) {
        setResourceStatuses((current) => ({ ...current, [resource]: previousStatus === "ready" ? "ready" : "idle" }));
        return;
      }

      setResourceData(result.data);
      await writeCachedResource(resource, session.user.id, result.data);
      setResourceHydration((current) => ({ ...current, [resource]: true }));
      setResourceStatuses((current) => ({ ...current, [resource]: "ready" }));
    } catch {
      setResourceStatuses((current) => ({ ...current, [resource]: previousStatus === "ready" ? "ready" : "idle" }));
    }
  }

  async function ensurePayrollRunItems(payrollRunId: string) {
    if (!supabase || !payrollRunId) return;
    const existingRun = payrollRuns.find((run) => run.id === payrollRunId);
    if (existingRun && existingRun.items.length > 0) return;

    const result = await loadPayrollRunItems(supabase, payrollRunId);
    if (result.error) {
      NotificationService.showError(friendlyError(result.error));
      return;
    }

    setPayrollRuns((current) => {
      const next = current.map((run) =>
        run.id === payrollRunId ? { ...run, items: result.data } : run,
      );
      void writeCachedResource("payrollRuns", session.user.id, next);
      return next;
    });
  }

  async function loadPageData(targetView: View, force = false) {
    await Promise.all(viewResources[targetView].map((resource) => loadResource(resource, force)));
  }

  async function refreshEmployeesPage() {
    await Promise.all([
      loadResource("employees", true),
      loadResource("positions", true),
      loadResource("payrollRuns", true),
      loadResource("employeeAdvances", true),
      loadResource("dashboardSummary", true),
    ]);
  }

  async function refreshPositionsPage() {
    await Promise.all([
      loadResource("positions", true),
      loadResource("employees", true),
    ]);
  }

  async function refreshDailyTicketsPage() {
    await Promise.all([
      loadResource("dailyTicketEntries", true),
      loadResource("subconDailyTickets", true),
      loadResource("subcontractors", true),
      loadResource("dashboardSummary", true),
    ]);
  }

  async function refreshAttendancePage() {
    await loadResource("attendanceEntries", true);
  }

  async function refreshPayrollPage() {
    await Promise.all([
      loadResource("payrollRuns", true),
      loadResource("employeeAdvances", true),
      loadResource("payrollHistory", true),
      loadResource("payrollSettings", true),
      loadResource("dashboardSummary", true),
    ]);
  }

  async function refreshExpensesPage() {
    await Promise.all([
      loadResource("employees", true),
      loadResource("expenses", true),
      loadResource("expenseCategories", true),
      loadResource("dashboardSummary", true),
    ]);
  }

  async function refreshCollectionsPage() {
    await Promise.all([
      loadResource("collections", true),
      loadResource("dashboardSummary", true),
    ]);
  }

  async function refreshBillingPage() {
    await Promise.all([
      loadResource("billingRecords", true),
      loadResource("billingSettings", true),
      loadResource("collections", true),
      loadResource("subcontractors", true),
      loadResource("subcontractorAdvances", true),
      loadResource("subconDailyTickets", true),
      loadResource("payments", true),
    ]);
  }

  async function refreshEmployeeAdvances() {
    await Promise.all([
      loadResource("employeeAdvances", true),
      loadResource("dashboardSummary", true),
    ]);
  }

  useEffect(() => {
    if (view !== "employees") {
      setEmployeeDetailOpen(false);
    }
  }, [view]);

  useEffect(() => {
    const handlePopState = () => {
      setView(viewFromPath(window.location.pathname));
      if (window.innerWidth <= 900) {
        setSidebarCollapsed(true);
        setMobileNavOpen(false);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (sidebarCollapsed) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSidebarCollapsed(true);
        setMobileNavOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!accountMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setAccountMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [accountMenuOpen]);

  useEffect(() => {
    if (!globalSearchOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!globalSearchRef.current?.contains(event.target as Node)) {
        setGlobalSearchOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [globalSearchOpen]);

  useEffect(() => {
    void loadPageData(view);
  }, [view]);

  useEffect(() => {
    void syncQueuedMutations(false);

    const handleOnline = () => void syncQueuedMutations(true);
    const handleFocus = () => void syncQueuedMutations(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("focus", handleFocus);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  async function signOut() {
    await supabase?.auth.signOut();
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }

      await document.documentElement.requestFullscreen();
    } catch {
      NotificationService.showError("Fullscreen is not available in this browser.");
    }
  }

  const currentViewResources = viewResources[view];
  const pageLoading = currentViewResources.some((resource) => resourceStatuses[resource] === "loading");
  const pageHydrated = currentViewResources.length === 0 ||
    currentViewResources.every((resource) => resourceHydration[resource]);
  const showPageSkeleton = pageLoading && !pageHydrated;
  const showSyncIndicator = pageLoading && pageHydrated;
  const accountName =
    typeof session.user.user_metadata?.full_name === "string" && session.user.user_metadata.full_name.trim()
      ? session.user.user_metadata.full_name.trim()
      : session.user.email ?? "Admin account";
  const accountInitial = accountName.trim().charAt(0).toUpperCase() || "A";
  const normalizedGlobalSearch = globalSearchQuery.trim().toLowerCase();
  const globalSearchResults = useMemo<GlobalSearchResult[]>(() => {
    if (!normalizedGlobalSearch) return [];

    const employeeResults = employees
      .filter((employee) =>
        [
          employee.full_name,
          employee.role,
          employee.department,
          employee.email,
        ].some((value) => value.toLowerCase().includes(normalizedGlobalSearch)),
      )
      .slice(0, 6)
      .map((employee) => ({
        id: employee.id,
        label: employee.full_name,
        detail: employee.role || employee.department || employee.email || "Employee",
        type: "employee" as const,
      }));

    const subcontractorResults = subcontractors
      .filter((subcontractor) =>
        [
          subcontractor.name,
          subcontractor.status,
        ].some((value) => value.toLowerCase().includes(normalizedGlobalSearch)),
      )
      .slice(0, 6)
      .map((subcontractor) => ({
        id: subcontractor.id,
        label: subcontractor.name,
        detail: `${subcontractor.status === "archived" ? "Archived" : "Active"} subcontractor`,
        type: "subcontractor" as const,
      }));

    return [...employeeResults, ...subcontractorResults].slice(0, 8);
  }, [employees, normalizedGlobalSearch, subcontractors]);

  function prepareGlobalSearch() {
    setGlobalSearchOpen(true);
    void Promise.all([
      loadResource("employees"),
      loadResource("subcontractors"),
    ]);
  }

  function openGlobalSearchResult(result: GlobalSearchResult) {
    setGlobalSearchQuery("");
    setGlobalSearchOpen(false);
    if (result.type === "subcontractor") {
      setSelectedSubcontractorId(result.id);
      setSubcontractorAccountTab("daily");
      navigate("subcontractors");
      return;
    }

    navigate("employees");
    setSelectedEmployeeDetailId(result.id);
    setSelectedEmployeeDetailNonce((current) => current + 1);
  }

  function handleGlobalSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setGlobalSearchOpen(false);
      return;
    }

    if (event.key === "Enter" && globalSearchResults[0]) {
      event.preventDefault();
      openGlobalSearchResult(globalSearchResults[0]);
    }
  }

  return (
    <main className={sidebarCollapsed ? "app-shell sidebar-collapsed-shell" : "app-shell"}>
      <Sidebar
        collapsed={sidebarCollapsed}
        email={session.user.email ?? ""}
        mobileNavOpen={mobileNavOpen}
        navigate={navigate}
        onCloseMobile={() => setMobileNavOpen(false)}
        onSignOut={signOut}
        onToggleMobileNav={() => {
          setSidebarCollapsed((collapsed) => {
            const nextCollapsed = !collapsed;
            setMobileNavOpen(!nextCollapsed);
            return nextCollapsed;
          });
        }}
        view={view}
      />
      {!sidebarCollapsed && <button aria-label="Close navigation" className="sidebar-backdrop" onClick={() => {
        setSidebarCollapsed(true);
        setMobileNavOpen(false);
      }} type="button" />}

      <div className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <div className="topbar-search-wrap" ref={globalSearchRef}>
              <label className="topbar-search">
                <span className="sr-only">Search workspace</span>
                <Search aria-hidden="true" size={17} />
                <input
                  aria-label="Search employee or subcontractor"
                  autoComplete="off"
                  onChange={(event) => {
                    setGlobalSearchQuery(event.target.value);
                    setGlobalSearchOpen(true);
                  }}
                  onFocus={prepareGlobalSearch}
                  onKeyDown={handleGlobalSearchKeyDown}
                  placeholder="Search employee or subcon..."
                  type="search"
                  value={globalSearchQuery}
                />
              </label>
              {globalSearchOpen && (
                <div className="global-search-dropdown">
                  {!normalizedGlobalSearch ? (
                    <p className="global-search-empty">Search employee name or subcontractor name.</p>
                  ) : globalSearchResults.length > 0 ? (
                    globalSearchResults.map((result) => (
                      <button
                        className="global-search-result"
                        key={`${result.type}-${result.id}`}
                        onClick={() => openGlobalSearchResult(result)}
                        type="button"
                      >
                        <span className={`global-search-icon ${result.type}`}>
                          {result.type === "employee" ? <UserRound size={15} /> : <Briefcase size={15} />}
                        </span>
                        <span>
                          <strong>{result.label}</strong>
                          <small>{result.detail}</small>
                        </span>
                        <em>{result.type === "employee" ? "Employee" : "Subcon"}</em>
                      </button>
                    ))
                  ) : (
                    <p className="global-search-empty">No employee or subcontractor found.</p>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="topbar-actions">
            <button className="topbar-icon notification-button" aria-label="Notifications" type="button">
              <Bell size={19} />
              <span>3</span>
            </button>
            <button className="topbar-icon" aria-label="Fullscreen" onClick={toggleFullscreen} type="button">
              <Maximize2 size={18} />
            </button>
            <div className="account-menu" ref={accountMenuRef}>
              <button
                aria-expanded={accountMenuOpen}
                aria-haspopup="menu"
                className="admin-chip"
                onClick={() => setAccountMenuOpen((open) => !open)}
                type="button"
              >
                <span className="avatar">{accountInitial}</span>
                <span className="admin-chip-copy">
                  <strong>{accountName}</strong>
                  <span>Administrator</span>
                </span>
                <ChevronDown className={accountMenuOpen ? "rotate-chevron" : undefined} size={15} />
              </button>
              {accountMenuOpen && (
                <div className="account-dropdown" role="menu">
                  <div className="account-dropdown-header">
                    <strong>{accountName}</strong>
                    <span>{session.user.email ?? "Administrator"}</span>
                  </div>
                  <button
                    className="account-dropdown-item danger"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      void signOut();
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <LogOut size={16} />
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <section className="content">
          {view !== "dashboard" && (
            <AppBreadcrumbs
              extraItems={view === "employees" && employeeDetailOpen ? [{ label: "Employee Details" }] : undefined}
              navigate={navigate}
              view={view}
            />
          )}
          {showSyncIndicator && <SyncIndicator text="Syncing latest data..." />}
          {showPageSkeleton ? (
            <PageSkeleton />
          ) : (
          <>
              {view === "dashboard" && (
                <Dashboard summary={dashboardSummary} />
              )}
              {view === "employees" && (
                <EmployeesView
                  employees={employees}
                  initialDetailsEmployeeId={selectedEmployeeDetailId}
                  initialDetailsEmployeeNonce={selectedEmployeeDetailNonce}
                  onChange={refreshEmployeesPage}
                  onClearInitialDetailsEmployee={() => setSelectedEmployeeDetailId(null)}
                  onDetailsOpenChange={setEmployeeDetailOpen}
                  onLocalEmployeesChange={setEmployees}
                  onQueueOfflineMutation={queueOfflineMutation}
                  payrollRuns={payrollRuns}
                  positions={positions}
                  employeeAdvances={employeeAdvances}
                  userId={session.user.id}
                />
            )}
            {view === "employee-add" && (
              <EmployeesView
                employees={employees}
                initialDetailsEmployeeId={selectedEmployeeDetailId}
                initialDetailsEmployeeNonce={selectedEmployeeDetailNonce}
                mode="add"
                onChange={refreshEmployeesPage}
                onClearInitialDetailsEmployee={() => setSelectedEmployeeDetailId(null)}
                onExitForm={() => navigate("employees")}
                onLocalEmployeesChange={setEmployees}
                onQueueOfflineMutation={queueOfflineMutation}
                payrollRuns={payrollRuns}
                positions={positions}
                employeeAdvances={employeeAdvances}
                userId={session.user.id}
              />
            )}
              {view === "compensation" && (
                <PositionsView
                  employees={employees}
                  onChange={refreshPositionsPage}
                  onLocalPositionsChange={setPositions}
                  onQueueOfflineMutation={queueOfflineMutation}
                  positions={positions}
                  userId={session.user.id}
                />
              )}
              {(view === "daily-tickets" || view === "daily-tickets-subcon") && (
                <>
                  <PageHeader
                    eyebrow="Daily operations"
                    title={view === "daily-tickets" ? "Daily closed tickets" : "Subcontractor daily tickets"}
                    text={
                      view === "daily-tickets"
                        ? "Record closed ticket counts per employee. Tab across rows, then Save All."
                        : "Record closed ticket counts per subcontractor. Tab across rows, then Save All."
                    }
                  />
                  <div className="page-tabs" role="tablist">
                    <button className={view === "daily-tickets" ? "active" : ""} onClick={() => navigate("daily-tickets")} role="tab" type="button"><Users size={14} />Employees</button>
                    <button className={view === "daily-tickets-subcon" ? "active" : ""} onClick={() => navigate("daily-tickets-subcon")} role="tab" type="button"><Wrench size={14} />Subcontractors</button>
                  </div>
                  {view === "daily-tickets" ? (
                    <DailyTicketEntryView
                      dailyTicketEntries={dailyTicketEntries}
                      employees={employees}
                      payrollRuns={payrollRuns}
                      positions={positions}
                      onChange={refreshDailyTicketsPage}
                      onQueueOfflineMutation={queueOfflineMutation}
                      userId={session.user.id}
                    />
                  ) : (
                    <SubconDailyTicketView
                      onChange={refreshDailyTicketsPage}
                      onQueueOfflineMutation={queueOfflineMutation}
                      subconDailyTickets={subconDailyTickets}
                      subcontractors={subcontractors}
                      userId={session.user.id}
                    />
                  )}
                </>
              )}
              {view === "attendance" && (
                <AttendanceView
                  attendanceEntries={attendanceEntries}
                  employees={employees}
                  positions={positions}
                  onChange={refreshAttendancePage}
                  onQueueOfflineMutation={queueOfflineMutation}
                  userId={session.user.id}
                />
              )}
              {(view === "payroll" || view === "payroll-history") && (
                <>
                  {view === "payroll" ? (
                    <PayrollFeature
                      attendanceEntries={attendanceEntries}
                      dailyTicketEntries={dailyTicketEntries}
                      employees={employees}
                      ensurePayrollRunItems={ensurePayrollRunItems}
                      onLocalPayrollRunsChange={setPayrollRuns}
                      onChange={refreshPayrollPage}
                      onQueueOfflineMutation={queueOfflineMutation}
                      payrollSettings={payrollSettings}
                      payrollRuns={payrollRuns}
                      positions={positions}
                      employeeAdvances={employeeAdvances}
                      tabs={(
                        <div className="page-tabs" role="tablist">
                          <button className="active" onClick={() => navigate("payroll")} role="tab" type="button">Payroll</button>
                          <button onClick={() => navigate("payroll-history")} role="tab" type="button">History</button>
                        </div>
                      )}
                      userId={session.user.id}
                    />
                  ) : (
                    <PayrollHistoryFeature
                      employees={employees}
                      rows={payrollHistoryRows}
                      tabs={(
                        <div className="page-tabs" role="tablist">
                          <button onClick={() => navigate("payroll")} role="tab" type="button">Payroll</button>
                          <button className="active" onClick={() => navigate("payroll-history")} role="tab" type="button">History</button>
                        </div>
                      )}
                    />
                  )}
                </>
              )}
              {view === "payments" && <PaymentsFeature expenseCategories={expenseCategories} expenses={expenses} />}
              {(view === "billing" || view === "billing-history") && (
                view === "billing" ? (
                  <BillingFeature
                    billingRecords={billingRecords}
                    billingSettings={billingSettings}
                    collections={collections}
                    dailyTicketEntries={dailyTicketEntries}
                    onOpenSubcontractorAccount={(subcontractorId) => {
                      setSelectedSubcontractorId(subcontractorId);
                      setSubcontractorAccountTab("billing");
                      navigate("subcontractors");
                    }}
                    onChange={refreshBillingPage}
                    onLocalBillingRecordsChange={setBillingRecords}
                    onQueueOfflineMutation={queueOfflineMutation}
                    payments={payments}
                    subconDailyTickets={subconDailyTickets}
                    subcontractorAdvances={subcontractorAdvances}
                    subcontractors={subcontractors}
                    tabs={(
                      <div className="page-tabs" role="tablist">
                        <button className="active" onClick={() => navigate("billing")} role="tab" type="button">Billing</button>
                        <button onClick={() => navigate("billing-history")} role="tab" type="button">History</button>
                      </div>
                    )}
                    userId={session.user.id}
                  />
                ) : (
                  <BillingHistoryFeature
                    billingRecords={billingRecords}
                    billingSettings={billingSettings}
                    collections={collections}
                    dailyTicketEntries={dailyTicketEntries}
                    payments={payments}
                    tabs={(
                      <div className="page-tabs" role="tablist">
                        <button onClick={() => navigate("billing")} role="tab" type="button">Billing</button>
                        <button className="active" onClick={() => navigate("billing-history")} role="tab" type="button">History</button>
                      </div>
                    )}
                  />
                )
              )}
              {view === "billing-settings" && (
                <BillingSettingsManager
                  billingSettings={billingSettings}
                  onChange={refreshBillingPage}
                  userId={session.user.id}
                />
              )}
              {view === "payroll-settings" && (
                <PayrollSettingsManager
                  employees={employees}
                  onChange={refreshPayrollPage}
                  payrollSettings={payrollSettings}
                  userId={session.user.id}
                />
              )}
              {view === "expenses" && (
                <ExpensesFeature
                  categoryScope="company"
                  employees={employees}
                  expenseCategories={expenseCategories}
                  expenses={expenses}
                  onChange={refreshExpensesPage}
                  onQueueOfflineMutation={queueOfflineMutation}
                  userId={session.user.id}
                />
              )}
              {view === "personal-expenses" && (
                <ExpensesFeature
                  categoryScope="personal"
                  employees={employees}
                  expenseCategories={expenseCategories}
                  expenses={expenses}
                  onChange={refreshExpensesPage}
                  onQueueOfflineMutation={queueOfflineMutation}
                  userId={session.user.id}
                />
              )}
              {view === "expense-categories" && (
                <ExpenseCategoriesManager
                  categories={expenseCategories}
                  onChange={refreshExpensesPage}
                  onQueueOfflineMutation={queueOfflineMutation}
                  userId={session.user.id}
                />
              )}
              {view === "subcontractors" && (
                <SubcontractorsFeature
                  billingRecords={billingRecords}
                  initialTab={subcontractorAccountTab}
                  onChange={async () => {
                    await Promise.all([
                      loadResource("subcontractors", true),
                      loadResource("subcontractorAdvances", true),
                      loadResource("subconDailyTickets", true),
                      loadResource("billingRecords", true),
                      loadResource("payments", true),
                    ]);
                  }}
                  onSelectSubcontractor={(subcontractorId) => {
                    setSelectedSubcontractorId(subcontractorId);
                  }}
                  onQueueOfflineMutation={queueOfflineMutation}
                  payments={payments}
                  selectedSubcontractorId={selectedSubcontractorId}
                  subconDailyTickets={subconDailyTickets}
                  subcontractorAdvances={subcontractorAdvances}
                  subcontractors={subcontractors}
                  userId={session.user.id}
                />
              )}
              {(view === "collections" || view === "collection-history") && (
                <>
                  <div className="page-tabs" role="tablist">
                    <button className={view === "collections" ? "active" : ""} onClick={() => navigate("collections")} role="tab" type="button">Collections</button>
                    <button className={view === "collection-history" ? "active" : ""} onClick={() => navigate("collection-history")} role="tab" type="button">History</button>
                  </div>
                  {view === "collections" ? (
                    <CollectionsFeature
                      collections={collections}
                      onChange={refreshCollectionsPage}
                      onLocalCollectionsChange={setCollections}
                      onQueueOfflineMutation={queueOfflineMutation}
                      userId={session.user.id}
                    />
                  ) : (
                    <CollectionHistoryFeature
                      collections={collections}
                      onChange={refreshCollectionsPage}
                      onLocalCollectionsChange={setCollections}
                      onQueueOfflineMutation={queueOfflineMutation}
                      userId={session.user.id}
                    />
                  )}
                </>
              )}
          </>
          )}
        </section>
      </div>
    </main>
  );
}

function Dashboard({ summary }: { summary: DashboardSummary }) {
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

  for (const c of summary.overdueCollections) {
    const days = Math.max(1, Math.floor((now.getTime() - new Date(c.due_date).getTime()) / 86400000));
    actionItems.push({ id: c.id, title: c.title, amount: toNumber(c.outstanding_balance), urgency: "overdue", daysInfo: `${days}d overdue`, kind: "collection" });
  }
  for (const p of summary.overduePayments) {
    const days = Math.max(1, Math.floor((now.getTime() - new Date(p.due_date).getTime()) / 86400000));
    actionItems.push({ id: p.id, title: p.title, amount: toNumber(p.amount), urgency: "overdue", daysInfo: `${days}d overdue`, kind: "bill" });
  }
  for (const e of summary.overdueExpenses) {
    const referenceDate = expenseOverdueReferenceDate(e, todayKey());
    const days = referenceDate ? Math.max(1, Math.floor((now.getTime() - new Date(`${referenceDate}T00:00:00`).getTime()) / 86400000)) : 1;
    actionItems.push({ id: e.id, title: `${e.category_name} — ${e.employee_name}`, amount: toNumber(e.amount), urgency: "overdue", daysInfo: `${days}d overdue`, kind: "expense" });
  }
  for (const c of summary.dueTodayCollections) {
    actionItems.push({ id: c.id, title: c.title, amount: toNumber(c.outstanding_balance), urgency: "today", daysInfo: "due today", kind: "collection" });
  }
  for (const p of summary.dueTodayPayments) {
    actionItems.push({ id: p.id, title: p.title, amount: toNumber(p.amount), urgency: "today", daysInfo: "due today", kind: "bill" });
  }
  for (const e of summary.dueTodayExpenses) {
    actionItems.push({ id: e.id, title: `${e.category_name} — ${e.employee_name}`, amount: toNumber(e.amount), urgency: "today", daysInfo: "due today", kind: "expense" });
  }

  const agingValues = [
    summary.collectionAging.current,
    summary.collectionAging.days1To30,
    summary.collectionAging.days31To60,
    summary.collectionAging.days61To90,
    summary.collectionAging.daysOver90,
  ];
  const agingTotal = agingValues.reduce((s, v) => s + v, 0);
  const agingBuckets = [
    { label: "Current", value: summary.collectionAging.current, tone: "ag-current" },
    { label: "1–30d", value: summary.collectionAging.days1To30, tone: "ag-warm" },
    { label: "31–60d", value: summary.collectionAging.days31To60, tone: "ag-warm" },
    { label: "61–90d", value: summary.collectionAging.days61To90, tone: "ag-hot" },
    { label: "90d+", value: summary.collectionAging.daysOver90, tone: "ag-hot" },
  ];

  return (
    <div className="page-stack dash">
      <PageHeader
        eyebrow="Dashboard"
        title={greeting}
        text={dateStr}
      />

      <section className="dash-pulse">
        <div className="dash-pulse-card receivables">
          <span className="dash-pulse-label">Receivables</span>
          <strong className="dash-pulse-value">{currency.format(summary.pendingCollections)}</strong>
          <span className="dash-pulse-sub">
            {summary.overdueCollections.length > 0
              ? `${summary.overdueCollections.length} overdue`
              : "all current"}
          </span>
        </div>
        <div className="dash-pulse-card collected">
          <span className="dash-pulse-label">Collected</span>
          <strong className="dash-pulse-value">{currency.format(summary.collectedThisMonth)}</strong>
          <span className="dash-pulse-sub">this month</span>
        </div>
        <div className="dash-pulse-card bills">
          <span className="dash-pulse-label">Bills due</span>
          <strong className="dash-pulse-value">
            {currency.format(
              summary.dueTodayPayments.reduce((s, p) => s + toNumber(p.amount), 0) +
              summary.overduePayments.reduce((s, p) => s + toNumber(p.amount), 0) +
              summary.dueTodayExpenses.reduce((s, e) => s + toNumber(e.amount), 0) +
              summary.overdueExpenses.reduce((s, e) => s + toNumber(e.amount), 0),
            )}
          </strong>
          <span className="dash-pulse-sub">
            {summary.dueTodayPayments.length + summary.overduePayments.length + summary.dueTodayExpenses.length + summary.overdueExpenses.length} pending
          </span>
        </div>
      </section>

      <section className="dash-actions">
        <div className="dash-actions-header">
          <h2>Needs attention</h2>
          <span className="dash-actions-count">{actionItems.length}</span>
        </div>
        {actionItems.length === 0 ? (
          <p className="dash-actions-empty">Nothing needs your attention right now.</p>
        ) : (
          <div className="dash-actions-list">
            {actionItems.map((item) => (
              <div className="dash-action-row" key={item.id}>
                <span className={`dash-action-dot ${item.urgency}`} />
                <div className="dash-action-info">
                  <strong>{item.title}</strong>
                  <span className="dash-action-meta">
                    {actionKindLabels[item.kind]} · {item.daysInfo}
                  </span>
                </div>
                <span className="dash-action-amount">{currency.format(item.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="dash-aging">
        <h2 className="dash-aging-title">Collection aging</h2>
        {agingTotal > 0 && (
          <div className="dash-aging-bar">
            {agingBuckets.map((b) =>
              b.value > 0 ? (
                <div
                  className={`dash-aging-segment ${b.tone}`}
                  key={b.label}
                  style={{ flex: b.value / agingTotal }}
                  title={`${b.label}: ${currency.format(b.value)}`}
                />
              ) : null,
            )}
          </div>
        )}
        <div className="dash-aging-legend">
          {agingBuckets.map((b) => (
            <div className="dash-aging-item" key={b.label}>
              <span className={`dash-aging-swatch ${b.tone}`} />
              <span className="dash-aging-bucket-label">{b.label}</span>
              <strong>{currency.format(b.value)}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="dash-secondary">
        <div className="dash-secondary-card">
          <span className="dash-secondary-value">{summary.activeEmployeeCount}</span>
          <span className="dash-secondary-label">Employees</span>
        </div>
        <div className="dash-secondary-card">
          <span className="dash-secondary-value">{currency.format(summary.pendingPayroll)}</span>
          <span className="dash-secondary-label">Pending payroll</span>
        </div>
        <div className="dash-secondary-card">
          <span className="dash-secondary-value">{latestRunDate}</span>
          <span className="dash-secondary-label">Last payroll</span>
        </div>
      </section>
    </div>
  );
}

function Metric({
  helperText,
  icon,
  label,
  tone,
  value,
}: {
  helperText?: string;
  icon: ReactNode;
  label: string;
  tone?: "danger" | "success" | "warning";
  value: number | string;
}) {
  return (
    <div className={`metric ${tone ?? ""}`}>
      <div className="metric-icon">{icon}</div>
      <p>{label}</p>
      <strong>{value}</strong>
      {helperText ? <span className="metric-helper">{helperText}</span> : null}
    </div>
  );
}

function SubcontractorsView({
  onChange,
  subcontractors,
  userId,
}: {
  onChange: () => Promise<void>;
  subcontractors: Subcontractor[];
  userId: string;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Subcontractor | null>(null);
  const [name, setName] = useState("");
  const [installRate, setInstallRate] = useState("0");
  const [repairRate, setRepairRate] = useState("0");
  const [payablePct, setPayablePct] = useState("70");
  const [busy, setBusy] = useState(false);

  function openAdd() {
    setEditing(null);
    setName("");
    setInstallRate("0");
    setRepairRate("0");
    setPayablePct("70");
    setFormOpen(true);
  }

  function openEdit(s: Subcontractor) {
    setEditing(s);
    setName(s.name);
    setInstallRate(String(s.installation_rate));
    setRepairRate(String(s.repair_rate));
    setPayablePct(String(s.payable_pct));
    setFormOpen(true);
  }

  async function save() {
    if (!supabase || !name.trim()) return;
    setBusy(true);
    const result = await saveSubcontractor(supabase, userId, {
      id: editing?.id,
      name: name.trim(),
      installation_rate: Number(installRate) || 0,
      repair_rate: Number(repairRate) || 0,
      payable_pct: Number(payablePct) || 70,
      status: "active",
    });
    setBusy(false);
    if (result.error) {
      NotificationService.showError((result.error as { message?: string }).message ?? "Failed to save subcontractor.");
      return;
    }
    setFormOpen(false);
    NotificationService.showSuccess(editing ? "Subcontractor updated." : "Subcontractor added.");
    await onChange();
  }

  async function toggleArchive(s: Subcontractor) {
    if (!supabase) return;
    const newStatus = s.status === "active" ? "archived" : "active";
    await saveSubcontractor(supabase, userId, { id: s.id, name: s.name, installation_rate: s.installation_rate, repair_rate: s.repair_rate, payable_pct: s.payable_pct, status: newStatus });
    NotificationService.showSuccess(newStatus === "archived" ? "Subcontractor archived." : "Subcontractor restored.");
    await onChange();
  }

  const active = subcontractors.filter((s) => s.status === "active");
  const archived = subcontractors.filter((s) => s.status === "archived");

  return (
    <div className="billing-page">
      <header className="billing-header">
        <div>
          <p className="eyebrow">Manage partners</p>
          <h2>Subcontractors</h2>
        </div>
        <button className="billing-btn primary" onClick={openAdd} type="button">
          <Plus size={15} /> Add subcontractor
        </button>
      </header>

      {subcontractors.length === 0 && !formOpen && (
        <div className="billing-empty">
          <Users size={32} />
          <p>No subcontractors yet</p>
          <span>Add your first subcontractor to start tracking their billing.</span>
        </div>
      )}

      {active.length > 0 && (
        <div className="billing-table-wrap">
          <table className="billing-table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="num">Install Rate</th>
                <th className="num">Repair Rate</th>
                <th className="num">Payable %</th>
                <th className="num">Collection %</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {active.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong></td>
                  <td className="num">{currency.format(s.installation_rate)}</td>
                  <td className="num">{currency.format(s.repair_rate)}</td>
                  <td className="num">{s.payable_pct}%</td>
                  <td className="num">{100 - s.payable_pct}%</td>
                  <td>
                    <div className="billing-row-actions">
                      <button onClick={() => openEdit(s)} type="button" title="Edit"><Pencil size={14} /></button>
                      <button onClick={() => toggleArchive(s)} type="button" title="Archive"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {archived.length > 0 && (
        <>
          <p className="eyebrow" style={{ marginTop: 16 }}>Archived</p>
          <div className="billing-table-wrap">
            <table className="billing-table">
              <tbody>
                {archived.map((s) => (
                  <tr key={s.id} style={{ opacity: 0.6 }}>
                    <td><strong>{s.name}</strong></td>
                    <td className="num">{currency.format(s.installation_rate)}</td>
                    <td className="num">{currency.format(s.repair_rate)}</td>
                    <td className="num">{s.payable_pct}%</td>
                    <td className="num">{100 - s.payable_pct}%</td>
                    <td>
                      <div className="billing-row-actions">
                        <button onClick={() => toggleArchive(s)} type="button" title="Restore"><Plus size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {formOpen && (
        <div className="modal-backdrop" onClick={() => setFormOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editing ? "Edit Subcontractor" : "Add Subcontractor"}</h3>
              <button onClick={() => setFormOpen(false)} type="button" aria-label="Close"><X size={18} /></button>
            </div>
            <div className="form-grid" style={{ padding: 20 }}>
              <label className="full">
                Name
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
              </label>
              <MoneyInput label="Installation rate (PHP)" value={installRate} onChange={setInstallRate} required />
              <MoneyInput label="Repair rate (PHP)" value={repairRate} onChange={setRepairRate} required />
              <label>
                Payable %
                <input type="number" min="0" max="100" value={payablePct} onChange={(e) => setPayablePct(e.target.value)} required />
              </label>
              <label>
                Collection %
                <input type="number" value={100 - (Number(payablePct) || 0)} disabled />
              </label>
              <div className="form-actions full">
                <button className="secondary-button" onClick={() => setFormOpen(false)} type="button">Cancel</button>
                <button className="primary-button" disabled={busy || !name.trim()} onClick={save} type="button">{busy ? "Saving..." : editing ? "Update" : "Add"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const compensationTickets = [
  { id: "TCK-1048", customer: "Santos Residence", type: "Repair", dateClosed: "2026-06-03", earnings: 200 },
  { id: "TCK-1051", customer: "Metro Fiber Hub", type: "Installation", dateClosed: "2026-06-05", earnings: 600 },
  { id: "TCK-1056", customer: "Cruz Apartment", type: "Repair", dateClosed: "2026-06-08", earnings: 200 },
  { id: "TCK-1062", customer: "Northline Office", type: "Installation", dateClosed: "2026-06-11", earnings: 600 },
  { id: "TCK-1068", customer: "Reyes Store", type: "Repair", dateClosed: "2026-06-14", earnings: 200 },
];

function EmployeeCompensationSetupView() {
  const repairTickets = 12;
  const installationTickets = 5;
  const repairRate = 200;
  const installationRate = 600;
  const repairEarnings = repairTickets * repairRate;
  const installationEarnings = installationTickets * installationRate;
  const totalPayroll = repairEarnings + installationEarnings;
  const totalTickets = repairTickets + installationTickets;

  return (
    <div className="compensation-page">
      <div className="compensation-main">
        <PageHeader
          eyebrow="Closed-ticket payroll"
          title="Employee Compensation Setup"
          text="Configure ticket rates and preview payroll earnings for the current 15-day period."
          action={
            <div className="page-actions">
              <button className="secondary-button compact" type="button"><Printer size={16} /> Print Payroll</button>
              <button className="secondary-button compact" type="button"><Download size={16} /> Export PDF</button>
              <button className="primary-button compact" type="button"><BadgeDollarSign size={16} /> Generate Payroll</button>
            </div>
          }
        />

        <section className="compensation-toolbar">
          <label>
            Payroll Period
            <select defaultValue="jun-1-15">
              <option value="jun-1-15">June 1 - June 15, 2026</option>
              <option value="jun-16-30">June 16 - June 30, 2026</option>
              <option value="may-16-31">May 16 - May 31, 2026</option>
            </select>
          </label>
          <label>
            Date Range
            <input defaultValue="2026-06-01 to 2026-06-15" />
          </label>
        </section>

        <section className="employee-info-card">
          <div className="employee-photo">JR</div>
          <div>
            <p className="eyebrow">Employee ID</p>
            <strong>EMP-2026-014</strong>
          </div>
          <div>
            <p className="eyebrow">Employee Name</p>
            <strong>Juan Reyes</strong>
          </div>
          <div>
            <p className="eyebrow">Position</p>
            <strong>Field Technician</strong>
          </div>
          <div>
            <p className="eyebrow">Employment Status</p>
            <span className="status active">Active</span>
          </div>
        </section>

        <section className="comp-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Compensation Configuration</p>
              <h2>Ticket Type Rates</h2>
            </div>
            <div className="page-actions">
              <button className="secondary-button compact" type="button"><Pencil size={16} /> Edit Wage</button>
              <button className="primary-button compact" type="button"><CheckCircle2 size={16} /> Save Changes</button>
            </div>
          </div>
          <div className="rate-table">
            <div>
              <span className="ticket-chip repair"><Wrench size={15} /> Repair</span>
              <strong>{currency.format(repairRate)}</strong>
            </div>
            <div>
              <span className="ticket-chip installation"><Briefcase size={15} /> Installation</span>
              <strong>{currency.format(installationRate)}</strong>
            </div>
          </div>
        </section>

        <section className="comp-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Payroll Earnings Preview</p>
              <h2>June 1 - June 15, 2026</h2>
            </div>
            <span className="period-pill"><CalendarClock size={16} /> 15-day payroll period</span>
          </div>
          <div className="earnings-grid">
            <EarningsBreakdown
              earnings={repairEarnings}
              rate={repairRate}
              tickets={repairTickets}
              tone="repair"
              type="Repair"
            />
            <EarningsBreakdown
              earnings={installationEarnings}
              rate={installationRate}
              tickets={installationTickets}
              tone="installation"
              type="Installation"
            />
          </div>
          <div className="payroll-total-row">
            <span>Total Payroll</span>
            <strong>{currency.format(totalPayroll)}</strong>
          </div>
        </section>

        <section className="comp-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Recent Closed Tickets</p>
              <h2>Ticket earnings log</h2>
            </div>
            <button className="secondary-button compact" type="button"><FileText size={16} /> View Report</button>
          </div>
          <DataTable
            empty="No closed tickets in this period."
            headers={["Ticket #", "Customer", "Type", "Date Closed", "Earnings"]}
            rows={compensationTickets.map((ticket) => [
              ticket.id,
              ticket.customer,
              <span className={`ticket-chip ${ticket.type === "Repair" ? "repair" : "installation"}`} key="type">{ticket.type}</span>,
              ticket.dateClosed,
              <strong className="earning-value" key="earnings">{currency.format(ticket.earnings)}</strong>,
            ])}
          />
        </section>
      </div>

      <aside className="payroll-summary-panel">
        <div>
          <p className="eyebrow">Payroll Summary</p>
          <h2>{currency.format(totalPayroll)}</h2>
          <span>Projected payout for June 1 - June 15, 2026</span>
        </div>
        <div className="summary-stat-list">
          <SummaryStat label="Total Closed Tickets" value={totalTickets} />
          <SummaryStat label="Total Earnings" value={currency.format(totalPayroll)} />
          <SummaryStat label="Average Earnings Per Day" value={currency.format(totalPayroll / 15)} />
          <SummaryStat label="Last Payroll Date" value="May 31, 2026" />
        </div>
        <button className="primary-button" type="button"><BadgeDollarSign size={16} /> Generate Payroll</button>
      </aside>
    </div>
  );
}

function EarningsBreakdown({
  earnings,
  rate,
  tickets,
  tone,
  type,
}: {
  earnings: number;
  rate: number;
  tickets: number;
  tone: "repair" | "installation";
  type: string;
}) {
  return (
    <div className={`earnings-card ${tone}`}>
      <span className={`ticket-chip ${tone}`}>{type}</span>
      <dl>
        <div><dt>Closed Tickets</dt><dd>{tickets}</dd></div>
        <div><dt>Rate</dt><dd>{currency.format(rate)}</dd></div>
        <div><dt>Earnings</dt><dd>{currency.format(earnings)}</dd></div>
      </dl>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="summary-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PositionsView({
  employees,
  onChange,
  onLocalPositionsChange,
  onQueueOfflineMutation,
  positions,
  userId,
}: {
  employees: Employee[];
  onChange: () => Promise<void>;
  onLocalPositionsChange: (positions: Position[]) => void;
  onQueueOfflineMutation: QueueOfflineMutation;
  positions: Position[];
  userId: string;
}) {
  const [editing, setEditing] = useState<Position | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rows = positions.filter((position) =>
    `${position.name} ${position.department} ${position.pay_mode}`.toLowerCase().includes(query.toLowerCase())
  );
  const existingDepartments = Array.from(
    new Set(positions.map((position) => position.department).filter((department) => department && department.trim())),
  ).sort((a, b) => a.localeCompare(b));

  async function savePosition(values: PositionFormValues) {
    if (!supabase) return;
    const needsTickets = values.pay_mode === "ticket" || values.pay_mode === "hybrid";
    const categories = values.categories
      .map((category, index) => ({
        id: category.id ?? crypto.randomUUID(),
        user_id: userId,
        position_id: editing?.id ?? "",
        name: category.name.trim(),
        rate: toNumber(category.rate),
        ticket_type: category.ticket_type,
        display_order: index,
        status: category.status,
      }))
      .filter((category) => category.name);
    if (!values.name.trim()) {
      NotificationService.showError("Position name is required.");
      return;
    }
    if (needsTickets && categories.filter((category) => category.status === "active").length === 0) {
      NotificationService.showError("Ticket and hybrid positions need at least one active ticket category.");
      return;
    }
    const positionId = editing?.id ?? crypto.randomUUID();
    const payload = {
      id: positionId,
      user_id: userId,
      name: values.name.trim(),
      department: values.department.trim(),
      description: values.description.trim(),
      status: values.status,
      pay_mode: values.pay_mode,
      monthly_base_salary: (values.pay_mode === "fixed" || values.pay_mode === "hybrid") ? toNumber(values.monthly_base_salary) : 0,
      daily_rate: values.pay_mode === "daily" ? toNumber(values.daily_rate) : 0,
    };
    const categoryPayloads = categories.map((category) => ({ ...category, position_id: positionId }));
    const removedCategories = editing?.categories.filter(
      (existing) => !categoryPayloads.some((category) => category.id === existing.id),
    ) ?? [];
    const optimistic: Position = {
      ...(editing ?? {} as Position),
      ...payload,
      created_at: editing?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
      categories: categoryPayloads.map((category) => ({
        ...category,
        created_at: editing?.categories.find((item) => item.id === category.id)?.created_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })),
    };

    if (!navigator.onLine) {
      onLocalPositionsChange(editing
        ? positions.map((position) => position.id === positionId ? optimistic : position)
        : [optimistic, ...positions]);
      await onQueueOfflineMutation({
        resource: "positions",
        affectedResources: ["positions", "employees", "dailyTicketEntries", "payrollRuns"],
        operation: "upsert",
        table: "positions",
        recordId: positionId,
        payload,
        options: { onConflict: "id" },
      });
      if (categoryPayloads.length > 0) {
        await onQueueOfflineMutation({
          resource: "positions",
          affectedResources: ["positions"],
          operation: "upsert",
          table: "position_ticket_categories",
          payload: categoryPayloads,
          options: { onConflict: "id" },
        });
      }
      for (const category of removedCategories) {
        await onQueueOfflineMutation({
          resource: "positions",
          affectedResources: ["positions"],
          operation: "update",
          table: "position_ticket_categories",
          recordId: category.id,
          payload: { status: "archived" },
        });
      }
      setFormOpen(false);
      setEditing(null);
      return;
    }

    const positionResult = await supabase.from("positions").upsert(payload, { onConflict: "id" });
    if (positionResult.error) {
      NotificationService.showError(friendlyError(positionResult.error));
      return;
    }
    if (categoryPayloads.length > 0) {
      const categoryResult = await supabase.from("position_ticket_categories").upsert(categoryPayloads, { onConflict: "id" });
      if (categoryResult.error) {
        NotificationService.showError(friendlyError(categoryResult.error));
        return;
      }
    }
    if (removedCategories.length > 0) {
      const archiveResult = await supabase
        .from("position_ticket_categories")
        .update({ status: "archived" })
        .in("id", removedCategories.map((category) => category.id));
      if (archiveResult.error) {
        NotificationService.showError(friendlyError(archiveResult.error));
        return;
      }
    }
    NotificationService.showSuccess("Position saved.");
    setFormOpen(false);
    setEditing(null);
    await onChange();
  }

  async function toggleArchive(position: Position) {
    if (!supabase) return;
    const status = position.status === "active" ? "archived" : "active";
    const assignedActiveEmployees = employees.filter(
      (employee) => employee.position_id === position.id && employee.status === "active",
    ).length;
    if (status === "archived" && assignedActiveEmployees > 0) {
      NotificationService.showError(`Reassign ${assignedActiveEmployees} active employee${assignedActiveEmployees === 1 ? "" : "s"} before archiving this position.`);
      return;
    }
    const optimistic = positions.map((item) => item.id === position.id ? { ...item, status } as Position : item);
    if (!navigator.onLine) {
      onLocalPositionsChange(optimistic);
      await onQueueOfflineMutation({
        resource: "positions",
        affectedResources: ["positions"],
        operation: "update",
        table: "positions",
        recordId: position.id,
        payload: { status },
      });
      return;
    }
    const { error } = await supabase.from("positions").update({ status }).eq("id", position.id);
    if (error) {
      NotificationService.showError(friendlyError(error));
    } else {
      NotificationService.showSuccess(`Position ${status}.`);
    }
    if (!error) await onChange();
  }

  async function handleDeletePosition(position: Position) {
    const assignedCount = employees.filter((e) => e.position_id === position.id).length;
    if (assignedCount > 0) {
      NotificationService.showWarning(`${assignedCount} employee${assignedCount === 1 ? " is" : "s are"} still assigned — reassign before deleting.`);
      return;
    }
    const confirmed = await NotificationService.showConfirm({
      title: "Delete position",
      message: `Are you sure you want to permanently delete "${position.name}"? This action cannot be undone.`,
      danger: true,
    });
    if (!confirmed) return;
    await deletePosition(position);
  }

  async function deletePosition(position: Position) {
    if (!supabase) return;
    const assignedEmployees = employees.filter((e) => e.position_id === position.id).length;
    if (assignedEmployees > 0) {
      NotificationService.showError(`Cannot delete "${position.name}" — ${assignedEmployees} employee${assignedEmployees === 1 ? " is" : "s are"} still assigned. Reassign them first.`);
      return;
    }
    if (!navigator.onLine) {
      onLocalPositionsChange(positions.filter((p) => p.id !== position.id));
      await onQueueOfflineMutation({
        resource: "positions",
        affectedResources: ["positions", "employees", "dailyTicketEntries", "payrollRuns"],
        operation: "delete",
        table: "position_ticket_categories",
        payload: { position_id: position.id },
      });
      await onQueueOfflineMutation({
        resource: "positions",
        affectedResources: ["positions", "employees", "dailyTicketEntries", "payrollRuns"],
        operation: "delete",
        table: "positions",
        recordId: position.id,
      });
      return;
    }
    const catResult = await supabase.from("position_ticket_categories").delete().eq("position_id", position.id);
    if (catResult.error) {
      NotificationService.showError(friendlyError(catResult.error));
      return;
    }
    const { error } = await supabase.from("positions").delete().eq("id", position.id);
    if (error) {
      NotificationService.showError(friendlyError(error));
      return;
    }
    NotificationService.showSuccess(`"${position.name}" deleted.`);
    await onChange();
  }

  return (
    <div className="page-stack">
      <PageHeader
        action={<button className="primary-button compact" onClick={() => { setEditing(null); setFormOpen(true); }} type="button"><Plus size={16} /> Add position</button>}
        eyebrow="Compensation setup"
        title="Positions"
        text="Define a position's base salary and ticket categories once, then assign it to employees."
      />
      <Toolbar query={query} setQuery={setQuery} />
      <DataTable
        empty="No positions yet. Create one before adding active employees."
        headers={["Position", "Department", "Pay method", "Base salary", "Ticket categories", "Employees", "Status", "Actions"]}
        rows={rows.map((position) => [
          <RecordTitle key="name" title={position.name} notes={position.description || "No description"} />,
          position.department || "Unassigned",
          position.pay_mode === "fixed" ? "Fixed salary" : position.pay_mode === "ticket" ? "Per ticket" : position.pay_mode === "daily" ? "Daily wage" : "Base + ticket",
          currency.format(toNumber(position.monthly_base_salary)),
          position.categories.filter((category) => category.status === "active").map((category) => `${category.name} (${currency.format(toNumber(category.rate))})`).join(", ") || "None",
          employees.filter((employee) => employee.position_id === position.id).length,
          <StatusPill key="status" status={position.status} />,
          <div className="row-actions" key="actions">
            <button aria-label="Edit position" onClick={() => { setEditing(position); setFormOpen(true); }} title="Edit" type="button"><Pencil size={16} /></button>
            <button aria-label={position.status === "active" ? "Archive position" : "Restore position"} onClick={() => toggleArchive(position)} title={position.status === "active" ? "Archive" : "Restore"} type="button"><History size={16} /></button>
            <button aria-label="Delete position" className="delete-action" onClick={() => void handleDeletePosition(position)} title="Delete" type="button"><Trash2 size={16} /></button>
          </div>,
        ])}
      />
      {formOpen && <PositionForm existingDepartments={existingDepartments} initial={editing} onClose={() => { setFormOpen(false); setEditing(null); }} onSubmit={savePosition} />}
    </div>
  );
}

function PositionForm({
  existingDepartments,
  initial,
  onClose,
  onSubmit,
}: {
  existingDepartments: string[];
  initial: Position | null;
  onClose: () => void;
  onSubmit: (values: PositionFormValues) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [showDepartmentPopup, setShowDepartmentPopup] = useState(false);
  const [newDepartmentName, setNewDepartmentName] = useState("");
  const [values, setValues] = useState<PositionFormValues>(initial ? {
    name: initial.name,
    department: initial.department,
    description: initial.description,
    status: initial.status,
    pay_mode: initial.pay_mode,
    monthly_base_salary: String(initial.monthly_base_salary),
    daily_rate: String(initial.daily_rate ?? 0),
    categories: initial.categories.map((category) => ({ id: category.id, name: category.name, rate: String(category.rate), ticket_type: category.ticket_type ?? "installation", status: category.status })),
  } : {
    name: "",
    department: "",
    description: "",
    status: "active",
    pay_mode: "fixed",
    monthly_base_salary: "",
    daily_rate: "",
    categories: [],
  });
  const usesTickets = values.pay_mode === "ticket" || values.pay_mode === "hybrid";
  const departmentOptions = Array.from(
    new Set([...existingDepartments, ...(values.department.trim() ? [values.department.trim()] : [])]),
  ).sort((a, b) => a.localeCompare(b));

  return (
    <Modal title={initial ? "Edit position" : "Add position"} onClose={onClose}>
      <form className="form-grid" onSubmit={async (event) => { event.preventDefault(); setBusy(true); await onSubmit(values); setBusy(false); }}>
        <TextField label="Position name" value={values.name} onChange={(name) => setValues({ ...values, name })} required />
        <label>
          Department
          <div className="department-field">
            <select
              value={values.department}
              onChange={(event) => setValues({ ...values, department: event.target.value })}
            >
              <option value="">No department</option>
              {departmentOptions.map((department) => (
                <option key={department} value={department}>{department}</option>
              ))}
            </select>
            <button
              aria-label="Add new department"
              className="secondary-button compact"
              onClick={() => { setNewDepartmentName(""); setShowDepartmentPopup(true); }}
              type="button"
            >
              <Plus size={15} /> New
            </button>
          </div>
        </label>
        <label>
          Pay method
          <select value={values.pay_mode} onChange={(event) => setValues({ ...values, pay_mode: event.target.value as PositionFormValues["pay_mode"] })}>
            <option value="fixed">Fixed salary</option>
            <option value="ticket">Per closed ticket</option>
            <option value="hybrid">Base salary + tickets</option>
            <option value="daily">Daily wage</option>
          </select>
        </label>
        {(values.pay_mode === "fixed" || values.pay_mode === "hybrid") && <MoneyInput label="Monthly base salary" value={values.monthly_base_salary} onChange={(monthly_base_salary) => setValues({ ...values, monthly_base_salary })} required />}
        {values.pay_mode === "daily" && <MoneyInput label="Daily rate" value={values.daily_rate} onChange={(daily_rate) => setValues({ ...values, daily_rate })} required />}
        <label className="full">
          Description
          <textarea rows={3} value={values.description} onChange={(event) => setValues({ ...values, description: event.target.value })} />
        </label>
        {usesTickets && (
          <section className="full stack">
            <div className="section-heading"><div><p className="eyebrow">Ticket compensation</p><h3>Closed-ticket categories</h3></div><button className="secondary-button compact" onClick={() => setValues({ ...values, categories: [...values.categories, { name: "", rate: "", ticket_type: "installation" as const, status: "active" }] })} type="button"><Plus size={15} /> Add category</button></div>
            {values.categories.map((category, index) => (
              <div className="inline-fields" key={category.id ?? index}>
                <input aria-label="Category name" placeholder="Category name" value={category.name} onChange={(event) => setValues({ ...values, categories: values.categories.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} />
                <MoneyInput value={category.rate} placeholder="Rate" onChange={(rate) => setValues({ ...values, categories: values.categories.map((item, itemIndex) => itemIndex === index ? { ...item, rate } : item) })} />
                <select aria-label="Ticket type" value={category.ticket_type} onChange={(event) => setValues({ ...values, categories: values.categories.map((item, itemIndex) => itemIndex === index ? { ...item, ticket_type: event.target.value as "installation" | "repair" } : item) })}><option value="installation">Installation</option><option value="repair">Repair</option></select>
                <select aria-label="Category status" value={category.status} onChange={(event) => setValues({ ...values, categories: values.categories.map((item, itemIndex) => itemIndex === index ? { ...item, status: event.target.value as PositionFormValues["categories"][number]["status"] } : item) })}><option value="active">Active</option><option value="archived">Archived</option></select>
                <button aria-label="Remove category" onClick={() => setValues({ ...values, categories: values.categories.filter((_, itemIndex) => itemIndex !== index) })} type="button"><Trash2 size={16} /></button>
              </div>
            ))}
          </section>
        )}
        <FormActions busy={busy} onClose={onClose} />
      </form>
      {showDepartmentPopup && (
        <Modal title="New department" onClose={() => setShowDepartmentPopup(false)}>
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = newDepartmentName.trim();
              if (!trimmed) return;
              setValues((current) => ({ ...current, department: trimmed }));
              setShowDepartmentPopup(false);
            }}
          >
            <TextField
              autoFocus
              label="Department name"
              value={newDepartmentName}
              onChange={setNewDepartmentName}
              required
            />
            <div className="form-actions full">
              <button className="secondary-button" onClick={() => setShowDepartmentPopup(false)} type="button">
                Cancel
              </button>
              <button className="primary-button compact" disabled={!newDepartmentName.trim()} type="submit">
                Add department
              </button>
            </div>
          </form>
        </Modal>
      )}
    </Modal>
  );
}

type DailyTicketDraft = {
  employee: Employee;
  employeeCode: string;
  installation: number;
  repair: number;
  savedValues?: { installation: number; repair: number };
  status: "pending" | "saved";
};

type PositionTicketDraft = {
  employee: Employee;
  position: Position;
  counts: Record<string, number>;
  entry?: DailyTicketEntry;
};

export function DailyTicketEntryView({
  dailyTicketEntries,
  employees,
  payrollRuns,
  positions,
  onChange,
  onQueueOfflineMutation,
  userId,
}: {
  dailyTicketEntries: DailyTicketEntry[];
  employees: Employee[];
  payrollRuns: PayrollRunWithItems[];
  positions: Position[];
  onChange: () => Promise<void>;
  onQueueOfflineMutation: QueueOfflineMutation;
  userId: string;
}) {
  const [entryDate, setEntryDate] = useState(todayKey());
  const [draftCounts, setDraftCounts] = useState<Record<string, Record<string, number>>>({});
  const [draftDisputes, setDraftDisputes] = useState<Record<string, { install: number; repair: number }>>({});
  const [busyEmployeeId, setBusyEmployeeId] = useState("");
  const [query, setQuery] = useState("");
  const [savingAll, setSavingAll] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [activePositionId, setActivePositionId] = useState("");
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarYear, setCalendarYear] = useState(() => Number(entryDate.split("-")[0]));
  const [calendarMonth, setCalendarMonth] = useState(() => Number(entryDate.split("-")[1]));
  const calendarRef = useRef<HTMLDivElement>(null);
  const [detailEmployee, setDetailEmployee] = useState<Employee | null>(null);
  const [openMenuId, setOpenMenuId] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const employeeNumberMap = useMemo(() => {
    const sorted = [...employees].sort((a, b) => a.created_at.localeCompare(b.created_at));
    return new Map(sorted.map((e, i) => [e.id, String(i + 1).padStart(3, "0")]));
  }, [employees]);

  useEffect(() => {
    if (!showCalendar) return;
    function handleClick(e: MouseEvent) {
      if (calendarRef.current && !calendarRef.current.contains(e.target as Node)) setShowCalendar(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showCalendar]);

  useEffect(() => {
    if (!openMenuId) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenuId("");
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openMenuId]);

  useEffect(() => {
    const [y, m] = entryDate.split("-").map(Number);
    setCalendarYear(y);
    setCalendarMonth(m);
  }, [entryDate]);

  const datesWithEntries = useMemo(
    () => new Set(dailyTicketEntries.map((e) => e.entry_date)),
    [dailyTicketEntries],
  );

  function getCalendarDays(year: number, month: number) {
    const firstDow = new Date(year, month - 1, 1).getDay();
    const startOffset = (firstDow + 6) % 7;
    const daysInMonth = new Date(year, month, 0).getDate();
    const days: Array<{ dateKey: string; day: number; currentMonth: boolean }> = [];
    const pad = (n: number) => String(n).padStart(2, "0");
    for (let i = startOffset; i > 0; i--) {
      const d = new Date(year, month - 1, 1 - i);
      days.push({ dateKey: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, day: d.getDate(), currentMonth: false });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      days.push({ dateKey: `${year}-${pad(month)}-${pad(d)}`, day: d, currentMonth: true });
    }
    const remaining = (7 - (days.length % 7)) % 7;
    for (let d = 1; d <= remaining; d++) {
      const nextMonth = month === 12 ? 1 : month + 1;
      const nextYear = month === 12 ? year + 1 : year;
      days.push({ dateKey: `${nextYear}-${pad(nextMonth)}-${pad(d)}`, day: d, currentMonth: false });
    }
    return days;
  }

  function prevCalendarMonth() {
    if (calendarMonth === 1) { setCalendarMonth(12); setCalendarYear((y) => y - 1); }
    else setCalendarMonth((m) => m - 1);
  }

  function nextCalendarMonth() {
    if (calendarMonth === 12) { setCalendarMonth(1); setCalendarYear((y) => y + 1); }
    else setCalendarMonth((m) => m + 1);
  }
  const activePositions = new Map(positions.map((position) => [position.id, position]));
  const drafts: PositionTicketDraft[] = employees
    .filter((employee) => employee.status === "active")
    .flatMap((employee) => {
      const entry = dailyTicketEntries.find((item) => item.employee_id === employee.id && item.entry_date === entryDate);
      const effectivePositionId = entry?.position_id ?? employee.position_id;
      const position = effectivePositionId ? activePositions.get(effectivePositionId) : undefined;
      if (!position || (!entry && position.status !== "active") || position.pay_mode === "fixed" || position.pay_mode === "daily") return [];
      const counts = Object.fromEntries(
        position.categories
          .filter((category) => category.status === "active")
          .map((category) => [
            category.id,
            draftCounts[employee.id]?.[category.id] ??
              entry?.details?.find((detail) => detail.position_ticket_category_id === category.id)?.ticket_count ?? 0,
          ]),
      );
      return [{ employee, position, counts, entry }];
    });

  const filteredDrafts = query.trim()
    ? drafts.filter((d) => d.employee.full_name.toLowerCase().includes(query.trim().toLowerCase()))
    : drafts;

  const grouped = filteredDrafts.reduce<Record<string, { position: Position; drafts: PositionTicketDraft[] }>>(
    (acc, draft) => {
      const key = draft.position.id;
      if (!acc[key]) acc[key] = { position: draft.position, drafts: [] };
      acc[key].drafts.push(draft);
      return acc;
    },
    {},
  );

  // All positions (no search filter) — used for the tab bar
  const positionGroups = drafts.reduce<Record<string, { position: Position; count: number }>>(
    (acc, draft) => {
      const key = draft.position.id;
      if (!acc[key]) acc[key] = { position: draft.position, count: 0 };
      acc[key].count++;
      return acc;
    },
    {},
  );
  const positionKeys = Object.keys(positionGroups);
  const effectiveTabId = (activePositionId && positionGroups[activePositionId])
    ? activePositionId
    : positionKeys[0] ?? "";

  function activeCategories(position: Position) {
    return position.categories
      .filter((c) => c.status === "active")
      .sort((a, b) => {
        const rank = (c: typeof a) => (c.ticket_type === "repair" ? 0 : 1);
        return rank(a) - rank(b);
      });
  }

  function distributeRemainingDraftCounts(
    items: Array<{ count: number }>,
    disputedCount: number,
  ) {
    const total = items.reduce((sum, item) => sum + normalizeTicketCount(item.count), 0);
    const clampedDisputed = Math.min(total, Math.max(0, normalizeTicketCount(disputedCount)));
    const targetRemaining = total - clampedDisputed;
    if (targetRemaining <= 0) return items.map(() => 0);
    if (targetRemaining >= total) return items.map((item) => normalizeTicketCount(item.count));

    const scaled = items.map((item, index) => {
      const originalCount = normalizeTicketCount(item.count);
      const exact = originalCount * targetRemaining / total;
      const remainingCount = Math.floor(exact);
      return { index, originalCount, remainingCount, fraction: exact - remainingCount };
    });

    let remainder = targetRemaining - scaled.reduce((sum, item) => sum + item.remainingCount, 0);
    scaled
      .slice()
      .sort((a, b) => {
        if (b.fraction !== a.fraction) return b.fraction - a.fraction;
        return a.index - b.index;
      })
      .forEach((item) => {
        if (remainder <= 0) return;
        if (item.remainingCount < item.originalCount) {
          item.remainingCount += 1;
          remainder -= 1;
        }
      });

    return scaled.sort((a, b) => a.index - b.index).map((item) => item.remainingCount);
  }

  function draftBillableSnapshot(draft: PositionTicketDraft) {
    const categories = activeCategories(draft.position);
    const disputes = disputeValuesFor(draft);
    const installationItems = categories
      .filter((cat) => (cat.ticket_type ?? "installation") === "installation")
      .map((cat) => ({ category: cat, count: normalizeTicketCount(draft.counts[cat.id]) }));
    const repairItems = categories
      .filter((cat) => cat.ticket_type === "repair")
      .map((cat) => ({ category: cat, count: normalizeTicketCount(draft.counts[cat.id]) }));
    const adjustedInstall = distributeRemainingDraftCounts(installationItems, disputes.install);
    const adjustedRepair = distributeRemainingDraftCounts(repairItems, disputes.repair);

    const installationGross = installationItems.reduce(
      (sum, item, index) => sum + adjustedInstall[index] * toNumber(item.category.rate),
      0,
    );
    const repairGross = repairItems.reduce(
      (sum, item, index) => sum + adjustedRepair[index] * toNumber(item.category.rate),
      0,
    );

    return {
      installationTickets: adjustedInstall.reduce((sum, count) => sum + count, 0),
      repairTickets: adjustedRepair.reduce((sum, count) => sum + count, 0),
      gross: installationGross + repairGross,
    };
  }

  function entryBillableSnapshot(entry: DailyTicketEntry) {
    const details = entry.details ?? [];
    if (details.length > 0) {
      const installationDetails = details
        .filter((detail) => (detail.ticket_type ?? "installation") === "installation")
        .map((detail) => ({ detail, count: normalizeTicketCount(detail.ticket_count) }));
      const repairDetails = details
        .filter((detail) => detail.ticket_type === "repair")
        .map((detail) => ({ detail, count: normalizeTicketCount(detail.ticket_count) }));
      const adjustedInstall = distributeRemainingDraftCounts(installationDetails, entry.disputed_install ?? 0);
      const adjustedRepair = distributeRemainingDraftCounts(repairDetails, entry.disputed_repair ?? 0);
      const installationTickets = adjustedInstall.reduce((sum, count) => sum + count, 0);
      const repairTickets = adjustedRepair.reduce((sum, count) => sum + count, 0);
      const gross = installationDetails.reduce(
        (sum, item, index) => sum + adjustedInstall[index] * toNumber(item.detail.rate),
        0,
      ) + repairDetails.reduce(
        (sum, item, index) => sum + adjustedRepair[index] * toNumber(item.detail.rate),
        0,
      );
      return { installationTickets, repairTickets, total: installationTickets + repairTickets, gross };
    }

    const installationTickets = Math.max(
      0,
      normalizeTicketCount(entry.installation_tickets) - Math.min(normalizeTicketCount(entry.installation_tickets), normalizeTicketCount(entry.disputed_install ?? 0)),
    );
    const repairTickets = Math.max(
      0,
      normalizeTicketCount(entry.repair_tickets) - Math.min(normalizeTicketCount(entry.repair_tickets), normalizeTicketCount(entry.disputed_repair ?? 0)),
    );
    const gross = installationTickets * toNumber(entry.installation_rate) + repairTickets * toNumber(entry.repair_rate);
    return { installationTickets, repairTickets, total: installationTickets + repairTickets, gross };
  }

  function grossFor(draft: PositionTicketDraft) {
    return draftBillableSnapshot(draft).gross;
  }

  function disputeValuesFor(draft: PositionTicketDraft) {
    return {
      install: draftDisputes[draft.employee.id]?.install ?? draft.entry?.disputed_install ?? 0,
      repair: draftDisputes[draft.employee.id]?.repair ?? draft.entry?.disputed_repair ?? 0,
    };
  }

  function isDirty(draft: PositionTicketDraft) {
    const countDirty = activeCategories(draft.position).some((cat) => {
      const current = normalizeTicketCount(draft.counts[cat.id]);
      const saved = draft.entry?.details?.find((d) => d.position_ticket_category_id === cat.id)?.ticket_count ?? 0;
      return current !== saved;
    });
    const disputes = disputeValuesFor(draft);
    return (
      countDirty ||
      normalizeTicketCount(disputes.install) !== (draft.entry?.disputed_install ?? 0) ||
      normalizeTicketCount(disputes.repair) !== (draft.entry?.disputed_repair ?? 0)
    );
  }

  async function saveDraftAndMark(draft: PositionTicketDraft) {
    await saveDraft(draft);
    setSavedIds((prev) => new Set([...prev, draft.employee.id]));
    setTimeout(() => setSavedIds((prev) => { const next = new Set(prev); next.delete(draft.employee.id); return next; }), 2000);
  }

  async function saveAll() {
    const dirty = drafts.filter((d) => {
      const disputes = disputeValuesFor(d);
      return (
        isDirty(d) ||
        Object.values(d.counts).some((c) => c > 0) ||
        normalizeTicketCount(disputes.install) > 0 ||
        normalizeTicketCount(disputes.repair) > 0
      );
    });
    if (dirty.length === 0) return;
    setSavingAll(true);
    for (const draft of dirty) await saveDraft(draft);
    setSavedIds(new Set(dirty.map((d) => d.employee.id)));
    setTimeout(() => setSavedIds(new Set()), 2000);
    setSavingAll(false);
  }

  async function saveDraft(draft: PositionTicketDraft) {
    if (!supabase) return;
    setBusyEmployeeId(draft.employee.id);
    const entryId = draft.entry?.id ?? crypto.randomUUID();
    const activeCategories = draft.position.categories.filter((category) => category.status === "active");
    const installCategories = activeCategories.filter((c) => (c.ticket_type ?? "installation") === "installation");
    const repairCategories = activeCategories.filter((c) => c.ticket_type === "repair");
    const computedInstall = installCategories.reduce((s, c) => s + normalizeTicketCount(draft.counts[c.id]), 0);
    const computedRepair = repairCategories.reduce((s, c) => s + normalizeTicketCount(draft.counts[c.id]), 0);
    const disputes = disputeValuesFor(draft);
    const installRate = installCategories[0] ? toNumber(installCategories[0].rate) : 0;
    const repairRate = repairCategories[0] ? toNumber(repairCategories[0].rate) : 0;
    const headerPayload = {
      id: entryId,
      user_id: userId,
      entry_date: entryDate,
      employee_id: draft.employee.id,
      employee_name: draft.employee.full_name,
      position_id: draft.position.id,
      position_name: draft.position.name,
      installation_tickets: computedInstall,
      repair_tickets: computedRepair,
      disputed_install: normalizeTicketCount(disputes.install),
      disputed_repair: normalizeTicketCount(disputes.repair),
      installation_rate: installRate,
      repair_rate: repairRate,
    };
    const buildDetailPayloads = (dailyTicketEntryId: string) => activeCategories.map((category) => {
      const existingDetail = draft.entry?.details?.find((detail) => detail.position_ticket_category_id === category.id);
      return {
        id: existingDetail?.id ?? crypto.randomUUID(),
        user_id: userId,
        daily_ticket_entry_id: dailyTicketEntryId,
        position_ticket_category_id: category.id,
        category_name: category.name,
        ticket_count: normalizeTicketCount(draft.counts[category.id]),
        rate: toNumber(existingDetail?.rate ?? category.rate),
        ticket_type: category.ticket_type ?? "installation",
      };
    });
    const detailPayloads = buildDetailPayloads(entryId);

    if (!navigator.onLine) {
      await onQueueOfflineMutation({
        resource: "dailyTicketEntries",
        affectedResources: ["dailyTicketEntries", "payrollRuns", "dashboardSummary"],
        operation: "upsert",
        table: "daily_ticket_entries",
        recordId: entryId,
        payload: headerPayload,
        options: { onConflict: "user_id,entry_date,employee_id" },
      });
      await onQueueOfflineMutation({
        resource: "dailyTicketEntries",
        affectedResources: ["dailyTicketEntries", "payrollRuns"],
        operation: "delete",
        table: "daily_ticket_entry_items",
        match: { daily_ticket_entry_id: entryId },
      });
      if (detailPayloads.length > 0) {
        await onQueueOfflineMutation({
          resource: "dailyTicketEntries",
          affectedResources: ["dailyTicketEntries", "payrollRuns"],
          operation: "insert",
          table: "daily_ticket_entry_items",
          payload: detailPayloads,
        });
      }
      // Cache is refreshed by the standard offline queue after synchronization.
      NotificationService.showSuccess(`${draft.employee.full_name}'s ticket counts were saved locally.`);
      setBusyEmployeeId("");
      return;
    }

    const headerResult = await supabase
      .from("daily_ticket_entries")
      .upsert(headerPayload, { onConflict: "user_id,entry_date,employee_id" })
      .select("id")
      .single();
    if (headerResult.error) {
      NotificationService.showError(friendlyError(headerResult.error));
      setBusyEmployeeId("");
      return;
    }
    const persistedEntryId = headerResult.data.id;
    const deleteResult = await supabase.from("daily_ticket_entry_items").delete().eq("daily_ticket_entry_id", persistedEntryId);
    if (deleteResult.error) {
      NotificationService.showError(friendlyError(deleteResult.error));
      setBusyEmployeeId("");
      return;
    }
    const persistedDetailPayloads = buildDetailPayloads(persistedEntryId);
    if (persistedDetailPayloads.length > 0) {
      const detailsResult = await supabase.from("daily_ticket_entry_items").insert(persistedDetailPayloads);
      if (detailsResult.error) {
        NotificationService.showError(friendlyError(detailsResult.error));
        setBusyEmployeeId("");
        return;
      }
    }
    NotificationService.showSuccess(`${draft.employee.full_name}'s ticket counts were saved.`);
    setBusyEmployeeId("");
    await onChange();
  }

  const loggedCount = drafts.filter((draft) => draft.entry).length;
  const totalGrossForDate = drafts.reduce((sum, draft) => sum + draftBillableSnapshot(draft).gross, 0);

  return (
    <div className="page-stack">
      {employees.some((employee) => employee.status === "active" && !employee.position_id) && (
        <div className="notice error" role="alert">
          <div>
            <strong>Action needed</strong>
            <p>Some active employees have no position and cannot receive ticket entries.</p>
          </div>
        </div>
      )}
      <section className="subcon-ticket-stats">
        <div className="subcon-ticket-stat">
          <span>Employees</span>
          <strong>{drafts.length}</strong>
          <span className="subcon-ticket-stat-helper">Eligible for entries</span>
        </div>
        <div className="subcon-ticket-stat logged">
          <span>Logged for this date</span>
          <strong>{loggedCount}</strong>
          <span className="subcon-ticket-stat-helper">Entries saved today</span>
        </div>
        <div className="subcon-ticket-stat total">
          <span>Total gross</span>
          <strong>{currency.format(totalGrossForDate)}</strong>
          <span className="subcon-ticket-stat-helper">For selected date</span>
        </div>
      </section>
      <div className="ticket-toolbar">
        <div className="att-cal-wrap" ref={calendarRef}>
          <button
            className="ticket-date-field att-cal-trigger"
            type="button"
            onClick={() => setShowCalendar((s) => !s)}
          >
            <CalendarClock size={15} />
            <span>{new Date(`${entryDate}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span>
          </button>
          {showCalendar && (
            <div className="att-cal">
              <div className="att-cal-header">
                <button type="button" onClick={prevCalendarMonth}><ChevronLeft size={14} /></button>
                <span>{monthNames[calendarMonth - 1]} {calendarYear}</span>
                <button type="button" onClick={nextCalendarMonth}><ChevronRight size={14} /></button>
              </div>
              <div className="att-cal-grid">
                {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
                  <span key={d} className="att-cal-day-name">{d}</span>
                ))}
                {getCalendarDays(calendarYear, calendarMonth).map(({ dateKey, day, currentMonth }) => (
                  <button
                    key={dateKey}
                    type="button"
                    className={[
                      "att-cal-day",
                      !currentMonth ? "other-month" : "",
                      dateKey === entryDate ? "selected" : "",
                      dateKey === todayKey() ? "today" : "",
                      datesWithEntries.has(dateKey) ? "has-entry" : "",
                    ].filter(Boolean).join(" ")}
                    onClick={() => { setEntryDate(dateKey); setDraftCounts({}); setDraftDisputes({}); setSavedIds(new Set()); setShowCalendar(false); }}
                  >
                    {day}
                  </button>
                ))}
              </div>
              <div className="att-cal-footer">
                <span>Today: {new Date(`${todayKey()}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span>
                <button
                  type="button"
                  onClick={() => {
                    const today = todayKey();
                    const [year, month] = today.split("-").map(Number);
                    setCalendarYear(year);
                    setCalendarMonth(month);
                    setEntryDate(today);
                    setDraftCounts({});
                    setDraftDisputes({});
                    setSavedIds(new Set());
                    setShowCalendar(false);
                  }}
                >
                  Go to today
                </button>
              </div>
            </div>
          )}
        </div>
        <label className="ticket-search-field">
          <Search size={15} />
          <input placeholder="Search employees…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && (
            <button aria-label="Clear search" className="ticket-search-clear" onClick={() => setQuery("")} type="button">
              <X size={13} />
            </button>
          )}
        </label>
        <button
          className="primary-button compact"
          disabled={savingAll}
          onClick={saveAll}
          type="button"
        >
          {savingAll ? <Spinner size="small" /> : <Save size={15} />} Save All
        </button>
        <button className="icon-button" onClick={() => void onChange()} type="button" aria-label="Refresh">
          <RotateCw size={15} />
        </button>
      </div>

      {drafts.length === 0 ? (
        <div className="panel"><p className="muted">No active employees currently have a ticket or hybrid position.</p></div>
      ) : (
        <>
          {/* Position tabs */}
          {positionKeys.length > 1 && (
            <div className="ticket-tabs" role="tablist">
              {positionKeys.map((key) => {
                const { position, count } = positionGroups[key];
                const isActive = key === effectiveTabId;
                return (
                  <button
                    key={key}
                    aria-selected={isActive}
                    className={`ticket-tab${isActive ? " active" : ""}`}
                    onClick={() => setActivePositionId(key)}
                    role="tab"
                    type="button"
                  >
                    <Briefcase size={13} />
                    {position.name}
                    <span className="ticket-tab-badge">{count}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Active position table */}
          {(() => {
            const activeGroup = grouped[effectiveTabId];
            const activePosition = positionGroups[effectiveTabId]?.position;
            if (!activePosition) return null;
            if (!activeGroup) {
              return <div className="panel"><p className="muted">No employees match your search.</p></div>;
            }
            const cats = activeCategories(activePosition);
            const groupTotal = activeGroup.drafts.reduce((sum, d) => sum + grossFor(d), 0);
            return (
              <section className="ticket-position-group">
                <div className="ticket-position-heading">
                  <span>{activePosition.name}</span>
                  <span className="ticket-position-total">{currency.format(groupTotal)}</span>
                </div>
                <div className="table-wrap">
                  <table className="ticket-table">
                    <thead>
                      <tr>
                        <th className="ticket-no-col">No.</th>
                        <th className="ticket-empid-col">Employee ID</th>
                        <th className="ticket-employee-col">Employee</th>
                        {cats.map((cat) => (
                          <th className="ticket-rate-col" key={cat.id}>
                            {cat.name}
                            <span className="ticket-rate-label">₱{toNumber(cat.rate).toLocaleString()}/ticket</span>
                          </th>
                        ))}
                        <th className="ticket-dispute-col">Disputed Install</th>
                        <th className="ticket-dispute-col">Disputed Repair</th>
                        <th className="ticket-gross-col">Gross</th>
                        <th className="ticket-action-col" />
                      </tr>
                    </thead>
                    <tbody>
                      {activeGroup.drafts.map((draft, index) => {
                        const dirty = isDirty(draft);
                        const busy = busyEmployeeId === draft.employee.id;
                        const saved = savedIds.has(draft.employee.id);
                        const disputes = disputeValuesFor(draft);
                        return (
                          <tr key={draft.employee.id} className={dirty ? "ticket-row-dirty" : saved ? "ticket-row-saved" : ""}>
                            <td className="ticket-no-col">{index + 1}</td>
                            <td className="ticket-empid-col">{`EMP-${employeeNumberMap.get(draft.employee.id) ?? "000"}`}</td>
                            <td className="ticket-employee-name">
                              <div className="employee-list-identity">
                                <div className="employee-list-avatar">
                                  {draft.employee.profile_photo_url
                                    ? <img alt="" src={draft.employee.profile_photo_url} />
                                    : <span>{draft.employee.full_name.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "E"}</span>}
                                </div>
                                <RecordTitle title={draft.employee.full_name} notes={draft.employee.email || "No email"} />
                              </div>
                            </td>
                            {cats.map((cat) => (
                              <td key={cat.id} className="ticket-count-cell">
                                <input
                                  aria-label={`${cat.name} tickets for ${draft.employee.full_name}`}
                                  min="0"
                                  step="1"
                                  type="number"
                                  value={draft.counts[cat.id] ?? 0}
                                  onChange={(e) => setDraftCounts((current) => ({
                                    ...current,
                                    [draft.employee.id]: {
                                      ...(current[draft.employee.id] ?? draft.counts),
                                      [cat.id]: normalizeTicketCount(e.target.value),
                                    },
                                  }))}
                                />
                              </td>
                            ))}
                            <td className="ticket-count-cell ticket-count-cell--dispute">
                              <input
                                aria-label={`Disputed installation tickets for ${draft.employee.full_name}`}
                                min="0"
                                step="1"
                                type="number"
                                value={disputes.install}
                                onChange={(e) => setDraftDisputes((current) => ({
                                  ...current,
                                  [draft.employee.id]: {
                                    install: normalizeTicketCount(e.target.value),
                                    repair: current[draft.employee.id]?.repair ?? draft.entry?.disputed_repair ?? 0,
                                  },
                                }))}
                              />
                            </td>
                            <td className="ticket-count-cell ticket-count-cell--dispute">
                              <input
                                aria-label={`Disputed repair tickets for ${draft.employee.full_name}`}
                                min="0"
                                step="1"
                                type="number"
                                value={disputes.repair}
                                onChange={(e) => setDraftDisputes((current) => ({
                                  ...current,
                                  [draft.employee.id]: {
                                    install: current[draft.employee.id]?.install ?? draft.entry?.disputed_install ?? 0,
                                    repair: normalizeTicketCount(e.target.value),
                                  },
                                }))}
                              />
                            </td>
                            <td className="ticket-gross-cell">
                              <strong>{currency.format(grossFor(draft))}</strong>
                            </td>
                            <td className="ticket-action-cell">
                              <div className="ticket-row-actions">
                                {busy ? (
                                  <Spinner size="small" />
                                ) : saved ? (
                                  <CheckCircle2 size={16} className="ticket-saved-icon" />
                                ) : (
                                  <button
                                    aria-label={`Save ${draft.employee.full_name}`}
                                    className="icon-button"
                                    disabled={!dirty}
                                    onClick={() => void saveDraftAndMark(draft)}
                                    title="Save this row"
                                    type="button"
                                  >
                                    <Save size={15} />
                                  </button>
                                )}
                                <div className="ticket-menu-wrap" ref={openMenuId === draft.employee.id ? menuRef : undefined}>
                                  <button
                                    className="icon-button"
                                    type="button"
                                    aria-label="More actions"
                                    onClick={() => setOpenMenuId((prev) => prev === draft.employee.id ? "" : draft.employee.id)}
                                  >
                                    <MoreVertical size={15} />
                                  </button>
                                  {openMenuId === draft.employee.id && (
                                    <div className="ticket-menu-dropdown">
                                      <button
                                        type="button"
                                        onClick={() => { setDetailEmployee(draft.employee); setOpenMenuId(""); }}
                                      >
                                        <Eye size={14} /> View details
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })()}
        </>
      )}

      {detailEmployee && (() => {
        // Build a map of period key → payroll status for this employee
        const periodStatusMap = new Map<string, "paid" | "pending">();
        for (const run of payrollRuns) {
          const item = run.items.find((i) => i.employee_id === detailEmployee.id);
          if (!item) continue;
          const key = `${run.period_year}-${run.period_month}-${run.pay_period}`;
          periodStatusMap.set(key, item.status === "paid" ? "paid" : "pending");
        }
        const periodStatusFor = (dateStr: string): "paid" | "pending" | null => {
          const [y, m, d] = dateStr.split("-").map(Number);
          for (const run of payrollRuns) {
            if (run.period_year !== y || run.period_month !== m) continue;
            const inPeriod = run.pay_period === "first_half" ? d <= 15 : d >= 16;
            if (!inPeriod) continue;
            const item = run.items.find((i) => i.employee_id === detailEmployee.id);
            return item ? (item.status === "paid" ? "paid" : "pending") : null;
          }
          return null;
        };
        const empEntries = dailyTicketEntries
          .filter((e) => e.employee_id === detailEmployee.id)
          .sort((a, b) => b.entry_date.localeCompare(a.entry_date));
        const position = positions.find((p) => p.id === detailEmployee.position_id);
        const cats = position?.categories.filter((c) => c.status === "active") ?? [];
        const totalGross = empEntries.reduce((sum, entry) => sum + entryBillableSnapshot(entry).gross, 0);
        return (
          <div className="modal-backdrop" onClick={() => setDetailEmployee(null)}>
            <div className="modal ticket-detail-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>{detailEmployee.full_name} — Ticket History</h2>
                <button className="icon-button" type="button" onClick={() => setDetailEmployee(null)}>
                  <X size={18} />
                </button>
              </div>
              <p className="ticket-detail-sub">{empEntries.length} entr{empEntries.length !== 1 ? "ies" : "y"} · Total gross <strong>{currency.format(totalGross)}</strong></p>
              {empEntries.length === 0 ? (
                <p className="muted" style={{ padding: "16px 0" }}>No ticket entries found for this employee.</p>
              ) : (
                <div className="table-wrap">
                  <table className="ticket-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        {cats.map((cat) => <th key={cat.id}>{cat.name}</th>)}
                        <th>Disputed Install</th>
                        <th>Disputed Repair</th>
                        <th>Total</th>
                        <th>Gross</th>
                        <th>Payroll</th>
                      </tr>
                    </thead>
                    <tbody>
                      {empEntries.map((entry) => {
                        const snapshot = entryBillableSnapshot(entry);
                        const ps = periodStatusFor(entry.entry_date);
                        return (
                          <tr key={entry.id}>
                            <td>{entry.entry_date}</td>
                            {cats.map((cat) => {
                              const detail = entry.details.find((d) => d.position_ticket_category_id === cat.id);
                              return <td key={cat.id}>{detail?.ticket_count ?? 0}</td>;
                            })}
                            <td>{entry.disputed_install ?? 0}</td>
                            <td>{entry.disputed_repair ?? 0}</td>
                            <td>{snapshot.total}</td>
                            <td><strong>{currency.format(snapshot.gross)}</strong></td>
                            <td>
                              {ps === "paid" && <span className="emp-status-pill active">Paid</span>}
                              {ps === "pending" && <span className="emp-status-pill inactive">Pending</span>}
                              {ps === null && <span className="muted" style={{ fontSize: 12 }}>—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function SubconDailyTicketView({
  onChange,
  onQueueOfflineMutation,
  subconDailyTickets,
  subcontractors,
  userId,
}: {
  onChange: () => Promise<void>;
  onQueueOfflineMutation: QueueOfflineMutation;
  subconDailyTickets: SubconDailyTicket[];
  subcontractors: Subcontractor[];
  userId: string;
}) {
  const [entryDate, setEntryDate] = useState(todayKey());
  const [drafts, setDrafts] = useState<Record<string, { install: number; repair: number; disputedInstall: number; disputedRepair: number }>>({});
  const [busySubconId, setBusySubconId] = useState("");
  const [query, setQuery] = useState("");
  const [savingAll, setSavingAll] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarYear, setCalendarYear] = useState(() => Number(entryDate.split("-")[0]));
  const [calendarMonth, setCalendarMonth] = useState(() => Number(entryDate.split("-")[1]));
  const calendarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showCalendar) return;
    function handleClick(e: MouseEvent) {
      if (calendarRef.current && !calendarRef.current.contains(e.target as Node)) setShowCalendar(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showCalendar]);

  useEffect(() => {
    const [y, m] = entryDate.split("-").map(Number);
    setCalendarYear(y);
    setCalendarMonth(m);
  }, [entryDate]);

  const datesWithEntries = useMemo(
    () => new Set(subconDailyTickets.map((e) => e.entry_date)),
    [subconDailyTickets],
  );

  function getCalendarDays(year: number, month: number) {
    const firstDow = new Date(year, month - 1, 1).getDay();
    const startOffset = (firstDow + 6) % 7;
    const daysInMonth = new Date(year, month, 0).getDate();
    const days: Array<{ dateKey: string; day: number; currentMonth: boolean }> = [];
    const pad = (n: number) => String(n).padStart(2, "0");
    for (let i = startOffset; i > 0; i--) {
      const d = new Date(year, month - 1, 1 - i);
      days.push({ dateKey: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, day: d.getDate(), currentMonth: false });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      days.push({ dateKey: `${year}-${pad(month)}-${pad(d)}`, day: d, currentMonth: true });
    }
    const remaining = (7 - (days.length % 7)) % 7;
    for (let d = 1; d <= remaining; d++) {
      const nextMonth = month === 12 ? 1 : month + 1;
      const nextYear = month === 12 ? year + 1 : year;
      days.push({ dateKey: `${nextYear}-${pad(nextMonth)}-${pad(d)}`, day: d, currentMonth: false });
    }
    return days;
  }

  function prevCalendarMonth() {
    if (calendarMonth === 1) { setCalendarMonth(12); setCalendarYear((y) => y - 1); }
    else setCalendarMonth((m) => m - 1);
  }

  function nextCalendarMonth() {
    if (calendarMonth === 12) { setCalendarMonth(1); setCalendarYear((y) => y + 1); }
    else setCalendarMonth((m) => m + 1);
  }

  const activeSubcons = subcontractors.filter((s) => s.status === "active");
  const filteredSubcons = query.trim()
    ? activeSubcons.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase()))
    : activeSubcons;

  function existingEntryFor(subcontractorId: string) {
    return subconDailyTickets.find((e) => e.subcontractor_id === subcontractorId && e.entry_date === entryDate);
  }

  function draftValuesFor(subcontractorId: string) {
    const saved = existingEntryFor(subcontractorId);
    return {
      install: drafts[subcontractorId]?.install ?? saved?.install_tickets ?? 0,
      repair: drafts[subcontractorId]?.repair ?? saved?.repair_tickets ?? 0,
      disputedInstall: drafts[subcontractorId]?.disputedInstall ?? saved?.disputed_install ?? 0,
      disputedRepair: drafts[subcontractorId]?.disputedRepair ?? saved?.disputed_repair ?? 0,
    };
  }

  function isDirty(subcontractor: Subcontractor) {
    const saved = existingEntryFor(subcontractor.id);
    const values = draftValuesFor(subcontractor.id);
    return (
      normalizeTicketCount(values.install) !== (saved?.install_tickets ?? 0) ||
      normalizeTicketCount(values.repair) !== (saved?.repair_tickets ?? 0) ||
      normalizeTicketCount(values.disputedInstall) !== (saved?.disputed_install ?? 0) ||
      normalizeTicketCount(values.disputedRepair) !== (saved?.disputed_repair ?? 0)
    );
  }

  async function saveRow(subcontractor: Subcontractor) {
    if (!supabase) return;
    setBusySubconId(subcontractor.id);
    const currentDraft = draftValuesFor(subcontractor.id);
    const payload = {
      id: existingEntryFor(subcontractor.id)?.id ?? crypto.randomUUID(),
      user_id: userId,
      entry_date: entryDate,
      subcontractor_id: subcontractor.id,
      subcon_name: subcontractor.name,
      install_tickets: normalizeTicketCount(currentDraft.install),
      repair_tickets: normalizeTicketCount(currentDraft.repair),
      disputed_install: normalizeTicketCount(currentDraft.disputedInstall),
      disputed_repair: normalizeTicketCount(currentDraft.disputedRepair),
      installation_rate: toNumber(subcontractor.installation_rate),
      repair_rate: toNumber(subcontractor.repair_rate),
    };

    if (!navigator.onLine) {
      await onQueueOfflineMutation({
        resource: "subconDailyTickets",
        affectedResources: ["subconDailyTickets", "billingRecords", "dashboardSummary"],
        operation: "upsert",
        table: "subcon_daily_tickets",
        recordId: payload.id,
        payload,
        options: { onConflict: "user_id,entry_date,subcontractor_id" },
      });
      NotificationService.showSuccess(`${subcontractor.name}'s subcontractor tickets were saved locally.`);
      setBusySubconId("");
      return;
    }

    const result = await saveSubconDailyTicket(supabase, payload);
    if (result.error) {
      if (isOfflineLikeError(result.error)) {
        await onQueueOfflineMutation({
          resource: "subconDailyTickets",
          affectedResources: ["subconDailyTickets", "billingRecords", "dashboardSummary"],
          operation: "upsert",
          table: "subcon_daily_tickets",
          recordId: payload.id,
          payload,
          options: { onConflict: "user_id,entry_date,subcontractor_id" },
        });
        NotificationService.showSuccess(`${subcontractor.name}'s subcontractor tickets were saved locally.`);
        setBusySubconId("");
        return;
      }
      NotificationService.showError(friendlyError(result.error));
      setBusySubconId("");
      return;
    }

    NotificationService.showSuccess(`${subcontractor.name}'s subcontractor tickets were saved.`);
    setBusySubconId("");
    await onChange();
  }

  async function saveRowAndMark(subcontractor: Subcontractor) {
    await saveRow(subcontractor);
    setSavedIds((prev) => new Set([...prev, subcontractor.id]));
    setTimeout(() => setSavedIds((prev) => { const next = new Set(prev); next.delete(subcontractor.id); return next; }), 2000);
  }

  async function saveAll() {
    const dirty = activeSubcons.filter((s) => isDirty(s) || draftValuesFor(s.id).install > 0 || draftValuesFor(s.id).repair > 0);
    if (dirty.length === 0) return;
    setSavingAll(true);
    for (const subcon of dirty) await saveRow(subcon);
    setSavedIds(new Set(dirty.map((s) => s.id)));
    setTimeout(() => setSavedIds(new Set()), 2000);
    setSavingAll(false);
  }

  const loggedCount = activeSubcons.filter((s) => existingEntryFor(s.id)).length;
  const totalGrossForDate = activeSubcons.reduce((sum, s) => sum + billableGrossFor(s), 0);

  function billableGrossFor(subcontractor: Subcontractor) {
    const values = draftValuesFor(subcontractor.id);
    const billableInstall = Math.max(0, normalizeTicketCount(values.install) - normalizeTicketCount(values.disputedInstall));
    const billableRepair = Math.max(0, normalizeTicketCount(values.repair) - normalizeTicketCount(values.disputedRepair));
    return billableInstall * toNumber(subcontractor.installation_rate) + billableRepair * toNumber(subcontractor.repair_rate);
  }

  return (
    <div className="page-stack">
      <section className="subcon-ticket-stats">
        <div className="subcon-ticket-stat">
          <span>Subcontractors</span>
          <strong>{activeSubcons.length}</strong>
          <span className="subcon-ticket-stat-helper">Active subcontractors</span>
        </div>
        <div className="subcon-ticket-stat logged">
          <span>Logged for this date</span>
          <strong>{loggedCount}</strong>
          <span className="subcon-ticket-stat-helper">Entries saved today</span>
        </div>
        <div className="subcon-ticket-stat total">
          <span>Total gross</span>
          <strong>{currency.format(totalGrossForDate)}</strong>
          <span className="subcon-ticket-stat-helper">For selected date</span>
        </div>
      </section>
      <div className="ticket-toolbar">
        <div className="att-cal-wrap" ref={calendarRef}>
          <button
            className="ticket-date-field att-cal-trigger"
            type="button"
            onClick={() => setShowCalendar((s) => !s)}
          >
            <CalendarClock size={15} />
            <span>{new Date(`${entryDate}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span>
          </button>
          {showCalendar && (
            <div className="att-cal">
              <div className="att-cal-header">
                <button type="button" onClick={prevCalendarMonth}><ChevronLeft size={14} /></button>
                <span>{monthNames[calendarMonth - 1]} {calendarYear}</span>
                <button type="button" onClick={nextCalendarMonth}><ChevronRight size={14} /></button>
              </div>
              <div className="att-cal-grid">
                {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
                  <span key={d} className="att-cal-day-name">{d}</span>
                ))}
                {getCalendarDays(calendarYear, calendarMonth).map(({ dateKey, day, currentMonth }) => (
                  <button
                    key={dateKey}
                    type="button"
                    className={[
                      "att-cal-day",
                      !currentMonth ? "other-month" : "",
                      dateKey === entryDate ? "selected" : "",
                      dateKey === todayKey() ? "today" : "",
                      datesWithEntries.has(dateKey) ? "has-entry" : "",
                    ].filter(Boolean).join(" ")}
                    onClick={() => { setEntryDate(dateKey); setDrafts({}); setSavedIds(new Set()); setShowCalendar(false); }}
                  >
                    {day}
                  </button>
                ))}
              </div>
              <div className="att-cal-footer">
                <span>Today: {new Date(`${todayKey()}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span>
                <button
                  type="button"
                  onClick={() => {
                    const today = todayKey();
                    const [year, month] = today.split("-").map(Number);
                    setCalendarYear(year);
                    setCalendarMonth(month);
                    setEntryDate(today);
                    setDrafts({});
                    setSavedIds(new Set());
                    setShowCalendar(false);
                  }}
                >
                  Go to today
                </button>
              </div>
            </div>
          )}
        </div>
        <label className="ticket-search-field">
          <Search size={15} />
          <input placeholder="Search subcontractors…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && (
            <button aria-label="Clear search" className="ticket-search-clear" onClick={() => setQuery("")} type="button">
              <X size={13} />
            </button>
          )}
        </label>
        <button className="primary-button compact" disabled={savingAll} onClick={() => void saveAll()} type="button">
          {savingAll ? <Spinner size="small" /> : <Save size={15} />} Save All
        </button>
        <button className="icon-button" onClick={() => void onChange()} type="button" aria-label="Refresh">
          <RotateCw size={15} />
        </button>
      </div>

      {activeSubcons.length === 0 ? (
        <div className="panel"><p className="muted">No active subcontractors are available yet.</p></div>
      ) : filteredSubcons.length === 0 ? (
        <div className="panel"><p className="muted">No subcontractors match your search.</p></div>
      ) : (
        <div className="table-wrap">
          <table className="ticket-table">
            <thead>
              <tr>
                <th className="ticket-employee-col">Subcontractor</th>
                <th className="ticket-rate-col">
                  Repair
                  <span className="ticket-rate-label">rate varies</span>
                </th>
                <th className="ticket-rate-col">
                  Installation
                  <span className="ticket-rate-label">rate varies</span>
                </th>
                <th className="ticket-dispute-col">Disputed Install</th>
                <th className="ticket-dispute-col">Disputed Repair</th>
                <th className="ticket-gross-col">Gross</th>
                <th className="ticket-action-col" />
              </tr>
            </thead>
            <tbody>
              {filteredSubcons.map((subcontractor) => {
                const values = draftValuesFor(subcontractor.id);
                const gross = billableGrossFor(subcontractor);
                const dirty = isDirty(subcontractor);
                const busy = busySubconId === subcontractor.id;
                const saved = savedIds.has(subcontractor.id);
                return (
                  <tr key={subcontractor.id} className={dirty ? "ticket-row-dirty" : saved ? "ticket-row-saved" : ""}>
                    <td className="ticket-employee-name">
                      {subcontractor.name}
                      <span className="ticket-rate-label">
                        Install ₱{toNumber(subcontractor.installation_rate).toLocaleString()} · Repair ₱{toNumber(subcontractor.repair_rate).toLocaleString()}
                      </span>
                    </td>
                    <td className="ticket-count-cell">
                      <input
                        aria-label={`Repair tickets for ${subcontractor.name}`}
                        min="0"
                        step="1"
                        type="number"
                        value={values.repair}
                        onChange={(e) => setDrafts((current) => ({
                          ...current,
                          [subcontractor.id]: { ...draftValuesFor(subcontractor.id), repair: normalizeTicketCount(e.target.value) },
                        }))}
                      />
                    </td>
                    <td className="ticket-count-cell">
                      <input
                        aria-label={`Install tickets for ${subcontractor.name}`}
                        min="0"
                        step="1"
                        type="number"
                        value={values.install}
                        onChange={(e) => setDrafts((current) => ({
                          ...current,
                          [subcontractor.id]: { ...draftValuesFor(subcontractor.id), install: normalizeTicketCount(e.target.value) },
                        }))}
                      />
                    </td>
                    <td className="ticket-count-cell ticket-count-cell--dispute">
                      <input
                        aria-label={`Disputed install tickets for ${subcontractor.name}`}
                        min="0"
                        step="1"
                        type="number"
                        value={values.disputedInstall}
                        onChange={(e) => setDrafts((current) => ({
                          ...current,
                          [subcontractor.id]: { ...draftValuesFor(subcontractor.id), disputedInstall: normalizeTicketCount(e.target.value) },
                        }))}
                      />
                    </td>
                    <td className="ticket-count-cell ticket-count-cell--dispute">
                      <input
                        aria-label={`Disputed repair tickets for ${subcontractor.name}`}
                        min="0"
                        step="1"
                        type="number"
                        value={values.disputedRepair}
                        onChange={(e) => setDrafts((current) => ({
                          ...current,
                          [subcontractor.id]: { ...draftValuesFor(subcontractor.id), disputedRepair: normalizeTicketCount(e.target.value) },
                        }))}
                      />
                    </td>
                    <td className="ticket-gross-cell">
                      <strong>{currency.format(gross)}</strong>
                    </td>
                    <td className="ticket-action-cell">
                      {busy ? (
                        <Spinner size="small" />
                      ) : saved ? (
                        <CheckCircle2 size={16} className="ticket-saved-icon" />
                      ) : (
                        <button
                          aria-label={`Save ${subcontractor.name}`}
                          className="icon-button"
                          disabled={!dirty}
                          onClick={() => void saveRowAndMark(subcontractor)}
                          title="Save this row"
                          type="button"
                        >
                          <Save size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AttendanceView({
  attendanceEntries,
  employees,
  positions,
  onChange,
  onQueueOfflineMutation,
  userId,
}: {
  attendanceEntries: AttendanceEntry[];
  employees: Employee[];
  positions: Position[];
  onChange: () => Promise<void>;
  onQueueOfflineMutation: QueueOfflineMutation;
  userId: string;
}) {
  const [entryDate, setEntryDate] = useState(todayKey());
  const [drafts, setDrafts] = useState<Record<string, AttendanceStatus>>({});
  const [timeDrafts, setTimeDrafts] = useState<Record<string, { time_in: string; time_out: string }>>({});
  const [busyEmployeeId, setBusyEmployeeId] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | AttendanceStatus | "unmarked">("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [attendancePage, setAttendancePage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarYear, setCalendarYear] = useState(() => Number(entryDate.split("-")[0]));
  const [calendarMonth, setCalendarMonth] = useState(() => Number(entryDate.split("-")[1]));
  const calendarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showCalendar) return;
    function handleClickOutside(e: MouseEvent) {
      if (calendarRef.current && !calendarRef.current.contains(e.target as Node)) {
        setShowCalendar(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showCalendar]);

  useEffect(() => {
    const [y, m] = entryDate.split("-").map(Number);
    setCalendarYear(y);
    setCalendarMonth(m);
  }, [entryDate]);

  const datesWithEntries = useMemo(
    () => new Set(attendanceEntries.map((e) => e.entry_date)),
    [attendanceEntries],
  );

  function getCalendarDays(year: number, month: number) {
    const firstDow = new Date(year, month - 1, 1).getDay();
    const startOffset = (firstDow + 6) % 7;
    const daysInMonth = new Date(year, month, 0).getDate();
    const days: Array<{ dateKey: string; day: number; currentMonth: boolean }> = [];
    const pad = (n: number) => String(n).padStart(2, "0");
    for (let i = startOffset; i > 0; i--) {
      const d = new Date(year, month - 1, 1 - i);
      days.push({ dateKey: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, day: d.getDate(), currentMonth: false });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      days.push({ dateKey: `${year}-${pad(month)}-${pad(d)}`, day: d, currentMonth: true });
    }
    const remaining = (7 - (days.length % 7)) % 7;
    for (let d = 1; d <= remaining; d++) {
      const nextMonth = month === 12 ? 1 : month + 1;
      const nextYear = month === 12 ? year + 1 : year;
      days.push({ dateKey: `${nextYear}-${pad(nextMonth)}-${pad(d)}`, day: d, currentMonth: false });
    }
    return days;
  }

  function prevCalendarMonth() {
    if (calendarMonth === 1) { setCalendarMonth(12); setCalendarYear((y) => y - 1); }
    else setCalendarMonth((m) => m - 1);
  }

  function nextCalendarMonth() {
    if (calendarMonth === 12) { setCalendarMonth(1); setCalendarYear((y) => y + 1); }
    else setCalendarMonth((m) => m + 1);
  }

  const dailyEmployees = employees.filter((emp) => {
    if (emp.status !== "active") return false;
    const pos = positions.find((p) => p.id === emp.position_id);
    return pos?.pay_mode === "daily" && pos.status === "active";
  });

  const existingEntries = new Map(
    attendanceEntries
      .filter((e) => e.entry_date === entryDate)
      .map((e) => [e.employee_id, e]),
  );

  const departments = Array.from(
    new Set(dailyEmployees.map((emp) => emp.department || "Unassigned")),
  ).sort((a, b) => a.localeCompare(b));

  const filteredEmployees = dailyEmployees.filter((emp) => {
    const pos = positions.find((p) => p.id === emp.position_id);
    const currentStatus = statusFor(emp.id);
    const searchTarget = `${emp.full_name} ${emp.role} ${pos?.name ?? ""} ${emp.department}`.toLowerCase();
    const matchesQuery = searchTarget.includes(query.trim().toLowerCase());
    const matchesStatus = statusFilter === "all" || (statusFilter === "unmarked" ? !currentStatus : currentStatus === statusFilter);
    const matchesDepartment = departmentFilter === "all" || (emp.department || "Unassigned") === departmentFilter;
    return matchesQuery && matchesStatus && matchesDepartment;
  });

  const presentCount = dailyEmployees.filter((emp) => statusFor(emp.id) === "present").length;
  const leaveCount = dailyEmployees.filter((emp) => statusFor(emp.id) === "half_day").length;
  const absentCount = dailyEmployees.filter((emp) => statusFor(emp.id) === "absent").length;
  const attendancePageSize = 10;
  const attendancePageCount = Math.max(1, Math.ceil(filteredEmployees.length / attendancePageSize));
  const paginatedEmployees = filteredEmployees.slice((attendancePage - 1) * attendancePageSize, attendancePage * attendancePageSize);

  function statusFor(employeeId: string): AttendanceStatus | "" {
    if (drafts[employeeId] !== undefined) return drafts[employeeId];
    const entry = existingEntries.get(employeeId);
    return entry?.status ?? "";
  }

  function setStatus(employeeId: string, status: AttendanceStatus) {
    setDrafts((prev) => ({ ...prev, [employeeId]: status }));
  }

  function timeInFor(employeeId: string): string {
    if (timeDrafts[employeeId]?.time_in !== undefined) return timeDrafts[employeeId].time_in;
    return existingEntries.get(employeeId)?.time_in || "08:00";
  }

  function timeOutFor(employeeId: string): string {
    if (timeDrafts[employeeId]?.time_out !== undefined) return timeDrafts[employeeId].time_out;
    return existingEntries.get(employeeId)?.time_out || "17:00";
  }

  function setTime(employeeId: string, field: "time_in" | "time_out", value: string) {
    setTimeDrafts((prev) => {
      const base = prev[employeeId] ?? { time_in: timeInFor(employeeId), time_out: timeOutFor(employeeId) };
      return { ...prev, [employeeId]: { ...base, [field]: value } };
    });
  }

  function requiresTimeTracking(status: AttendanceStatus | "") {
    return status === "present" || status === "half_day";
  }

  function markAllPresent() {
    const newDrafts: Record<string, AttendanceStatus> = {};
    dailyEmployees.forEach((emp) => {
      if (!existingEntries.has(emp.id)) {
        newDrafts[emp.id] = "present";
      }
    });
    setDrafts((prev) => ({ ...prev, ...newDrafts }));
  }

  async function saveEntry(emp: Employee) {
    const status = statusFor(emp.id);
    if (!status) return;
    const trackTime = requiresTimeTracking(status);
    const timeIn = trackTime ? timeInFor(emp.id) : "";
    const timeOut = trackTime ? timeOutFor(emp.id) : "";
    if (trackTime && (!timeIn || !timeOut)) {
      NotificationService.showError(`Enter Time In and Time Out for ${emp.full_name} before saving.`);
      return;
    }
    setBusyEmployeeId(emp.id);
    const pos = positions.find((p) => p.id === emp.position_id);
    const existing = existingEntries.get(emp.id);
    const payload = {
      user_id: userId,
      employee_id: emp.id,
      employee_name: emp.full_name,
      position_id: emp.position_id,
      position_name: pos?.name ?? "",
      entry_date: entryDate,
      status,
      time_in: trackTime ? timeIn : null,
      time_out: trackTime ? timeOut : null,
    };

    if (!navigator.onLine || !supabase) {
      await onQueueOfflineMutation({
        resource: "attendanceEntries",
        affectedResources: ["attendanceEntries"],
        operation: existing ? "update" : "upsert",
        table: "attendance_entries",
        recordId: existing?.id,
        payload,
        options: existing ? undefined : { onConflict: "user_id,entry_date,employee_id" },
      });
      setDrafts((prev) => { const next = { ...prev }; delete next[emp.id]; return next; });
      setTimeDrafts((prev) => { const next = { ...prev }; delete next[emp.id]; return next; });
      setBusyEmployeeId("");
      return;
    }

    const result = existing
      ? await supabase.from("attendance_entries").update({ status, time_in: payload.time_in, time_out: payload.time_out }).eq("id", existing.id)
      : await supabase.from("attendance_entries").upsert(payload, { onConflict: "user_id,entry_date,employee_id" });

    if (result.error) {
      if (isOfflineLikeError(result.error)) {
        await onQueueOfflineMutation({
          resource: "attendanceEntries",
          affectedResources: ["attendanceEntries"],
          operation: existing ? "update" : "upsert",
          table: "attendance_entries",
          recordId: existing?.id,
          payload,
          options: existing ? undefined : { onConflict: "user_id,entry_date,employee_id" },
        });
      } else {
        NotificationService.showError(result.error.message ?? "Failed to save attendance.");
      }
    } else {
      setDrafts((prev) => { const next = { ...prev }; delete next[emp.id]; return next; });
      setTimeDrafts((prev) => { const next = { ...prev }; delete next[emp.id]; return next; });
    }
    setBusyEmployeeId("");
    await onChange();
  }

  async function saveAll() {
    const pendingEmployees = dailyEmployees.filter((emp) => statusFor(emp.id));
    const missingTime = pendingEmployees.filter((emp) => {
      const status = statusFor(emp.id);
      return requiresTimeTracking(status) && (!timeInFor(emp.id) || !timeOutFor(emp.id));
    });
    if (missingTime.length > 0) {
      const names = missingTime.slice(0, 3).map((emp) => emp.full_name).join(", ");
      const extra = missingTime.length > 3 ? ` and ${missingTime.length - 3} more` : "";
      NotificationService.showError(`Fill in Time In and Time Out for: ${names}${extra} before saving all.`);
      return;
    }
    for (const emp of pendingEmployees) {
      await saveEntry(emp);
    }
    NotificationService.showSuccess("Attendance saved.");
  }

  useEffect(() => {
    setDrafts({});
    setTimeDrafts({});
  }, [entryDate]);

  useEffect(() => {
    setAttendancePage(1);
  }, [query, statusFilter, departmentFilter, entryDate]);

  useEffect(() => {
    setAttendancePage((page) => Math.min(page, attendancePageCount));
  }, [attendancePageCount]);

  function statusLabel(status: AttendanceStatus | "") {
    if (status === "present") return "Present";
    if (status === "absent") return "Absent";
    if (status === "half_day") return "On Leave";
    return "No Entry";
  }

  function employeeCode(index: number) {
    return `EMP-${String(index + 1).padStart(4, "0")}`;
  }

  function initials(name: string) {
    return name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("");
  }

  function displayDate(dateKey: string) {
    return new Date(`${dateKey}T00:00:00`).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }

  return (
    <div className="attendance-page">
      <PageHeader
        eyebrow="Workforce"
        title="Attendance"
        text="Track daily employee attendance, filter records, and save updates in one place."
      />

      <section className="attendance-top-grid">
        <div className="attendance-stat-card present">
          <span className="attendance-stat-icon present"><UserCheck size={21} /></span>
          <div>
            <p>Present</p>
            <strong>{presentCount}</strong>
            <span className="attendance-stat-helper">Marked present today</span>
          </div>
        </div>
        <div className="attendance-stat-card leave">
          <span className="attendance-stat-icon leave"><CalendarOff size={21} /></span>
          <div>
            <p>On Leave</p>
            <strong>{leaveCount}</strong>
            <span className="attendance-stat-helper">Approved or pending leave</span>
          </div>
        </div>
        <div className="attendance-stat-card absent">
          <span className="attendance-stat-icon absent"><UserX size={21} /></span>
          <div>
            <p>Absent</p>
            <strong>{absentCount}</strong>
            <span className="attendance-stat-helper">No attendance recorded</span>
          </div>
        </div>
        <div className="attendance-stat-card total">
          <span className="attendance-stat-icon total"><Users size={21} /></span>
          <div>
            <p>Total employees</p>
            <strong>{dailyEmployees.length}</strong>
            <span className="attendance-stat-helper">All active employees</span>
          </div>
        </div>
      </section>

      <section className="attendance-shell">
        <div className="attendance-toolbar">
          <div className="attendance-filter-fields">
          <div className="attendance-field-group">
            <span className="attendance-field-label">Date</span>
            <div className="att-cal-wrap" ref={calendarRef}>
              <button
                className="attendance-date-field att-cal-trigger"
                type="button"
                onClick={() => setShowCalendar((s) => !s)}
              >
                <CalendarClock size={16} />
                <span>{displayDate(entryDate)}</span>
              </button>
              {showCalendar && (
                <div className="att-cal">
                  <div className="att-cal-header">
                    <button type="button" onClick={prevCalendarMonth}><ChevronLeft size={14} /></button>
                    <span>{monthNames[calendarMonth - 1]} {calendarYear}</span>
                    <button type="button" onClick={nextCalendarMonth}><ChevronRight size={14} /></button>
                  </div>
                  <div className="att-cal-grid">
                    {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
                      <span key={d} className="att-cal-day-name">{d}</span>
                    ))}
                    {getCalendarDays(calendarYear, calendarMonth).map(({ dateKey, day, currentMonth }) => (
                      <button
                        key={dateKey}
                        type="button"
                        className={[
                          "att-cal-day",
                          !currentMonth ? "other-month" : "",
                          dateKey === entryDate ? "selected" : "",
                          dateKey === todayKey() ? "today" : "",
                          datesWithEntries.has(dateKey) ? "has-entry" : "",
                        ].filter(Boolean).join(" ")}
                        onClick={() => { setEntryDate(dateKey); setShowCalendar(false); }}
                        >
                          {day}
                        </button>
                      ))}
                  </div>
                  <div className="att-cal-footer">
                    <span>Today: {new Date(`${todayKey()}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span>
                    <button
                      type="button"
                      onClick={() => {
                        const today = todayKey();
                        const [year, month] = today.split("-").map(Number);
                        setCalendarYear(year);
                        setCalendarMonth(month);
                        setEntryDate(today);
                        setShowCalendar(false);
                      }}
                    >
                      Go to today
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="attendance-field-group">
            <span className="attendance-field-label">Search employee</span>
            <label className="attendance-search-field">
              <Search size={16} />
              <input
                placeholder="Search by name, employee ID or position..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
          <label className="attendance-field-group">
            <span className="attendance-field-label">Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
              <option value="all">All Status</option>
              <option value="present">Present</option>
              <option value="half_day">On Leave</option>
              <option value="absent">Absent</option>
              <option value="unmarked">No Entry</option>
            </select>
          </label>
          <label className="attendance-field-group">
            <span className="attendance-field-label">Department</span>
            <select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}>
              <option value="all">All Departments</option>
              {departments.map((department) => (
                <option key={department} value={department}>{department}</option>
              ))}
            </select>
          </label>
          </div>
          <div className="attendance-toolbar-actions">
          <button className="attendance-tool-button" type="button">
            <Filter size={15} /> More Filters
          </button>
          <button className="attendance-tool-button" onClick={markAllPresent} type="button">
            <CheckCircle2 size={15} /> Bulk Actions
          </button>
          <button
            className="attendance-icon-button"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true);
              setDrafts({});
              await onChange();
              setRefreshing(false);
              NotificationService.showSuccess("Attendance refreshed.");
            }}
            type="button"
            aria-label="Refresh attendance"
          >
            <RotateCw size={16} className={refreshing ? "spin" : ""} />
          </button>
          <button className="attendance-save-button" onClick={saveAll} type="button">
            <Save size={15} /> Save all
          </button>
          </div>
        </div>

        {dailyEmployees.length === 0 ? (
          <p className="attendance-empty">No employees with daily-wage positions found.</p>
        ) : (
          <div className="attendance-table-wrap">
            <table className="attendance-table">
              <thead>
                <tr>
                  <th className="att-no-cell">
                    <span className="att-row-no">No.</span>
                  </th>
                  <th>Employee ID</th>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>Status</th>
                  <th>Time In</th>
                  <th>Time Out</th>
                  <th>Daily Earnings</th>
                  <th>Remarks</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedEmployees.map((emp) => {
                  const pos = positions.find((p) => p.id === emp.position_id);
                  const current = statusFor(emp.id);
                  const saved = existingEntries.has(emp.id);
                  const dirty = drafts[emp.id] !== undefined || timeDrafts[emp.id] !== undefined;
                  const dailyRate = Number(pos?.daily_rate ?? 0);
                  const earnings = computeDailyEarnings(dailyRate, current, timeInFor(emp.id), timeOutFor(emp.id));
                  const employeeIndex = dailyEmployees.findIndex((item) => item.id === emp.id);
                  return (
                    <tr key={emp.id}>
                      <td className="att-no-cell">
                        <span className="att-row-no">{employeeIndex + 1}</span>
                      </td>
                      <td>{employeeCode(employeeIndex)}</td>
                      <td>
                        <div className="employee-list-identity">
                          <div className="employee-list-avatar">
                            {emp.profile_photo_url ? <img src={emp.profile_photo_url} alt="" /> : <span>{initials(emp.full_name)}</span>}
                          </div>
                          <div className="record-title">
                            <strong>{emp.full_name}</strong>
                            {emp.email && <span>{emp.email}</span>}
                          </div>
                        </div>
                      </td>
                      <td>{emp.department || "Unassigned"}</td>
                      <td>
                        <div className={`attendance-status-control ${current || "unmarked"}`}>
                          <span>{statusLabel(current)}</span>
                          <select
                            value={current}
                            onChange={(e) => setStatus(emp.id, e.target.value as AttendanceStatus)}
                            aria-label={`Attendance status for ${emp.full_name}`}
                          >
                            <option value="">No Entry</option>
                            <option value="present">Present</option>
                            <option value="absent">Absent</option>
                            <option value="half_day">On Leave</option>
                          </select>
                        </div>
                      </td>
                      <td>
                        {requiresTimeTracking(current) ? (
                          <input
                            type="time"
                            className={`attendance-time-input${!timeInFor(emp.id) ? " missing" : ""}`}
                            value={timeInFor(emp.id)}
                            onChange={(e) => setTime(emp.id, "time_in", e.target.value)}
                            aria-label={`Time in for ${emp.full_name}`}
                          />
                        ) : "--"}
                      </td>
                      <td>
                        {requiresTimeTracking(current) ? (
                          <input
                            type="time"
                            className={`attendance-time-input${!timeOutFor(emp.id) ? " missing" : ""}`}
                            value={timeOutFor(emp.id)}
                            onChange={(e) => setTime(emp.id, "time_out", e.target.value)}
                            aria-label={`Time out for ${emp.full_name}`}
                          />
                        ) : "--"}
                      </td>
                      <td><strong>{formatMoney(earnings)}</strong></td>
                      <td>{current === "absent" ? "No Entry" : current === "half_day" ? "Half Day" : "--"}</td>
                      <td>
                        <div className="attendance-row-actions">
                          <button
                            disabled={!dirty || busyEmployeeId === emp.id}
                            onClick={() => saveEntry(emp)}
                            type="button"
                            aria-label={`Save attendance for ${emp.full_name}`}
                          >
                            <Save size={15} />
                          </button>
                          <button type="button" aria-label={`Edit ${emp.full_name} attendance`}>
                            <Pencil size={15} />
                          </button>
                        </div>
                        {saved && !dirty && <span className="attendance-saved-text">Saved</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredEmployees.length === 0 && (
              <p className="attendance-empty">No employees match the selected filters.</p>
            )}
            {attendancePageCount > 1 && (
              <div className="attendance-footer">
                <span>Showing {(attendancePage - 1) * attendancePageSize + 1} to {Math.min(attendancePage * attendancePageSize, filteredEmployees.length)} of {filteredEmployees.length} employees</span>
                <div>
                  <button type="button">{attendancePageSize} / page</button>
                  <button type="button" disabled={attendancePage === 1} onClick={() => setAttendancePage((page) => Math.max(1, page - 1))}>{"<"}</button>
                  {Array.from({ length: attendancePageCount }, (_, index) => index + 1).map((page) => (
                    <button
                      className={page === attendancePage ? "active" : undefined}
                      key={page}
                      onClick={() => setAttendancePage(page)}
                      type="button"
                    >
                      {page}
                    </button>
                  ))}
                  <button type="button" disabled={attendancePage === attendancePageCount} onClick={() => setAttendancePage((page) => Math.min(attendancePageCount, page + 1))}>{">"}</button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

    </div>
  );

}

function DailySummaryMetric({
  earnings,
  icon,
  label,
  rate,
  rateLabel,
  tone,
  value,
}: {
  earnings: number;
  icon: ReactNode;
  label: string;
  rate?: number;
  rateLabel?: string;
  tone: "installation" | "repair";
  value: number;
}) {
  return (
    <div className={`daily-summary-metric ${tone}`}>
      {icon}
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <p>Rate: {rateLabel ?? `${currency.format(toNumber(rate))} / ticket`}</p>
        <p>Earnings: <b>{currency.format(earnings)}</b></p>
      </div>
    </div>
  );
}

export function EmployeesView({
  employees,
  initialDetailsEmployeeId,
  initialDetailsEmployeeNonce = 0,
  mode = "list",
  onChange,
  onClearInitialDetailsEmployee,
  onDetailsOpenChange,
  onExitForm,
  onLocalEmployeesChange,
  onQueueOfflineMutation,
  payrollRuns,
  positions,
  employeeAdvances,
  userId,
}: {
  employees: Employee[];
  initialDetailsEmployeeId?: string | null;
  initialDetailsEmployeeNonce?: number;
  mode?: "list" | "add";
  onChange: () => Promise<void>;
  onClearInitialDetailsEmployee?: () => void;
  onDetailsOpenChange?: (open: boolean) => void;
  onExitForm?: () => void;
  onLocalEmployeesChange: (employees: Employee[]) => void;
  onQueueOfflineMutation: QueueOfflineMutation;
  payrollRuns: PayrollRunWithItems[];
  positions: Position[];
  employeeAdvances: EmployeeAdvance[];
  userId: string;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("active");
  const [editing, setEditing] = useState<Employee | null>(null);
  const [formOpen, setFormOpen] = useState(mode === "add");
  const [detailsEmployee, setDetailsEmployee] = useState<Employee | null>(null);

  useEffect(() => {
    onDetailsOpenChange?.(Boolean(detailsEmployee));
  }, [detailsEmployee, onDetailsOpenChange]);

  useEffect(() => {
    if (mode === "add") {
      setEditing(null);
      setFormOpen(true);
    }
  }, [mode]);

  useEffect(() => {
    if (!initialDetailsEmployeeId) return;
    const employee = employees.find((item) => item.id === initialDetailsEmployeeId);
    if (!employee) return;
    setFormOpen(false);
    setEditing(null);
    setDetailsEmployee(employee);
    onClearInitialDetailsEmployee?.();
  }, [employees, initialDetailsEmployeeId, initialDetailsEmployeeNonce, onClearInitialDetailsEmployee]);

  function closeForm() {
    setEditing(null);
    setFormOpen(false);
    onExitForm?.();
  }

  const rows = employees.filter((employee) => {
    const matchesQuery = `${employee.full_name} ${employee.role} ${employee.department} ${employee.email}`
      .toLowerCase()
      .includes(query.toLowerCase());
    const matchesStatus = statusFilter === "all" || employee.status === statusFilter;
    return matchesQuery && matchesStatus;
  });
  const totalEmployees = employees.length;
  const activeEmployees = employees.filter((employee) => employee.status === "active").length;
  const inactiveEmployees = employees.filter((employee) => employee.status === "inactive").length;
  const employeesOnLeave = 0;
  const employeeNumberMap = useMemo(() => {
    const sorted = [...employees].sort((a, b) => a.created_at.localeCompare(b.created_at));
    return new Map(sorted.map((e, i) => [e.id, String(i + 1).padStart(3, "0")]));
  }, [employees]);
  const employeeCodeFor = (employee: Employee) => `EMP-${employeeNumberMap.get(employee.id) ?? "000"}`;
  const employeeInitialsFor = (employee: Employee) => employee.full_name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "E";

  if (detailsEmployee) {
    return (
      <EmployeeDetailsView
        employee={detailsEmployee}
        onChange={onChange}
        onBack={() => setDetailsEmployee(null)}
        onEdit={(emp) => { setEditing(emp); setFormOpen(true); setDetailsEmployee(null); }}
        onEmployeeUpdate={setDetailsEmployee}
        onQueueOfflineMutation={onQueueOfflineMutation}
        payrollRuns={payrollRuns}
        positions={positions}
        employeeAdvances={employeeAdvances}
        userId={userId}
      />
    );
  }

  if (formOpen) {
    return (
      <EmployeeForm
        embedded
        initial={editing}
        onClose={closeForm}
        onSubmit={saveEmployee}
        positions={positions}
      />
    );
  }

  async function saveEmployee(values: EmployeeFormValues) {
    if (!supabase) return;
    const selectedPosition = positions.find((position) => position.id === values.position_id && position.status === "active");
    if (!selectedPosition) {
      NotificationService.showError("Select an active position before saving this employee.");
      return;
    }
    for (const [field, label] of [["contact_number", "Contact number"], ["emergency_contact_number", "Emergency contact number"]] as const) {
      const digits = values[field];
      if (digits && digits.length !== 10) {
        NotificationService.showError(`${label} must be a valid 10-digit Philippine mobile number.`);
        return;
      }
    }
    const payload = {
      ...(editing ? {} : { id: crypto.randomUUID() }),
      full_name: values.full_name.trim(),
      role: selectedPosition.name,
      position_id: selectedPosition.id,
      department: selectedPosition.department,
      contact_number: values.contact_number.trim(),
      email: values.email.trim(),
      address: values.address.trim(),
      profile_photo_url: values.profile_photo_url,
      hire_date: values.hire_date || null,
      status: values.status,
      wage_category: values.wage_category,
      monthly_salary: (selectedPosition.pay_mode === "fixed" || selectedPosition.pay_mode === "hybrid")
        ? toNumber(selectedPosition.monthly_base_salary)
        : 0,
      sss_number: values.sss_number.trim(),
      philhealth_number: values.philhealth_number.trim(),
      pagibig_number: values.pagibig_number.trim(),
      sss_deduction: toNumber(values.sss_deduction),
      philhealth_deduction: toNumber(values.philhealth_deduction),
      pagibig_deduction: toNumber(values.pagibig_deduction),
      withholding_tax: toNumber(values.withholding_tax),
      tin_number: values.tin_number.trim(),
      gender: values.gender,
      emergency_contact_name: values.emergency_contact_name.trim(),
      emergency_contact_number: values.emergency_contact_number.trim(),
      emergency_contact_relation: values.emergency_contact_relation.trim(),
      notes: values.notes.trim(),
      user_id: userId,
    };
    const optimisticEmployee = {
      ...(editing ?? {}),
      ...payload,
      id: editing?.id ?? payload.id,
      created_at: editing?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as Employee;

    if (!navigator.onLine) {
      onLocalEmployeesChange(
        editing
          ? employees.map((employee) => employee.id === editing.id ? optimisticEmployee : employee)
          : [optimisticEmployee, ...employees],
      );
      await onQueueOfflineMutation({
        resource: "employees",
        affectedResources: ["employees", "dashboardSummary"],
        operation: editing ? "update" : "insert",
        table: "employees",
        recordId: editing?.id,
        payload,
      });
      NotificationService.showSuccess("Employee saved locally. It will sync when online.");
      closeForm();
      return;
    }

    onLocalEmployeesChange(
      editing
        ? employees.map((employee) => employee.id === editing.id ? optimisticEmployee : employee)
        : [optimisticEmployee, ...employees],
    );

    const result = editing
      ? await supabase.from("employees").update(payload).eq("id", editing.id)
      : await supabase.from("employees").insert(payload);

    if (result.error) {
      if (isOfflineLikeError(result.error)) {
        await onQueueOfflineMutation({
          resource: "employees",
          affectedResources: ["employees", "dashboardSummary"],
          operation: editing ? "update" : "insert",
          table: "employees",
          recordId: editing?.id,
          payload,
        });
        closeForm();
        return;
      }
      onLocalEmployeesChange(employees);
      NotificationService.showError(friendlyError(result.error));
      return;
    }
    NotificationService.showSuccess("Employee saved.");
    closeForm();
    await onChange();
  }

  return (
    <div className="page-stack">
      <PageHeader
        action={
          <button className="primary-button compact employee-add-button" onClick={() => { setEditing(null); setFormOpen(true); }} type="button">
            <Plus size={16} />
            Add employee
          </button>
        }
        eyebrow="HR profiles"
        title="Employees"
        text="Maintain active staff profiles and ticket wage settings."
      />
      <section className="metric-grid employee-summary-grid">
        <Metric helperText="All active employees" icon={<Users size={18} />} label="Total employees" value={totalEmployees} />
        <Metric helperText="Current Active" icon={<UserRound size={18} />} label="Active employees" tone="success" value={activeEmployees} />
        <Metric helperText="On Leave" icon={<CalendarClock size={18} />} label="On leave" tone="warning" value={employeesOnLeave} />
        <Metric helperText="No Longer Active" icon={<BadgeInfo size={18} />} label="Inactive" tone="danger" value={inactiveEmployees} />
      </section>
      <section className="panel employee-list-panel">
        <Toolbar query={query} setQuery={setQuery}>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
            <option value="all">All employees</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </Toolbar>
        <DataTable
          empty="No employees yet."
          headers={["No.", "Employee ID", "Employee", "Department", "Position", "Date Hired", "Status"]}
          onRowClick={(index) => setDetailsEmployee(rows[index])}
          rows={rows.map((employee, index) => [
            index + 1,
            employeeCodeFor(employee),
            <div className="employee-list-identity" key="title">
              <div className="employee-list-avatar">
                {employee.profile_photo_url ? <img alt="" src={employee.profile_photo_url} /> : <span>{employeeInitialsFor(employee)}</span>}
              </div>
              <RecordTitle title={employee.full_name} notes={employee.email || "No email"} />
            </div>,
            employee.department || "Unassigned",
            employee.role || "Unassigned",
            (() => {
              if (!employee.hire_date) return "—";
              const [y, m, d] = employee.hire_date.split("-").map(Number);
              const abbr = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1];
              return `${abbr} ${d}, ${y}`;
            })(),
            <span className={employee.status === "active" ? "emp-status-pill active" : "emp-status-pill inactive"} key="status">
              {employee.status === "active" ? "Active" : "Inactive"}
            </span>,
          ])}
        />
      </section>
      {formOpen && (
        <EmployeeForm
          initial={editing}
          onClose={closeForm}
          onSubmit={saveEmployee}
          positions={positions}
        />
      )}
    </div>
  );
}

export function EmployeeDetailsView({
  employee,
  onChange,
  onBack,
  onEdit,
  onEmployeeUpdate,
  onQueueOfflineMutation,
  payrollRuns,
  positions,
  employeeAdvances,
  userId,
}: {
  employee: Employee;
  onChange: () => Promise<void>;
  onBack: () => void;
  onEdit: (employee: Employee) => void;
  onEmployeeUpdate: (employee: Employee) => void;
  onQueueOfflineMutation: QueueOfflineMutation;
  payrollRuns: PayrollRunWithItems[];
  positions: Position[];
  employeeAdvances: EmployeeAdvance[];
  userId: string;
}) {
  const [activeTab, setActiveTab] = useState<"information" | "payroll" | "tickets" | "employee-advances" | "payments" | "documents" | "government-deduction" | "attendance">("information");
  const [currentEmployee, setCurrentEmployee] = useState(employee);
  const [employeePayrollRuns, setEmployeePayrollRuns] = useState<PayrollRunWithItems[]>([]);
  const [editingRate, setEditingRate] = useState<"installation" | "repair" | null>(null);
  const [rateDrafts, setRateDrafts] = useState({ installation: "", repair: "" });
  const [empAttendance, setEmpAttendance] = useState<AttendanceEntry[]>([]);
  const [empTickets, setEmpTickets] = useState<DailyTicketEntry[]>([]);
  const [empAttendanceLoading, setEmpAttendanceLoading] = useState(false);
  const [empAttendancePage, setEmpAttendancePage] = useState(1);

  useEffect(() => {
    setCurrentEmployee(employee);
  }, [employee]);

  useEffect(() => {
    setRateDrafts({
      installation: String(toNumber(currentEmployee.installation_rate)),
      repair: String(toNumber(currentEmployee.repair_rate)),
    });
  }, [currentEmployee]);

  useEffect(() => {
    if (!supabase) return;

    loadEmployeePayrollRuns(supabase, currentEmployee.id).then((result) => {
      if (result.error) {
        NotificationService.showError(friendlyError(result.error));
        return;
      }
      setEmployeePayrollRuns(result.data);
    });
  }, [currentEmployee.id]);

  useEffect(() => {
    if (activeTab !== "attendance" || !supabase) return;
    setEmpAttendancePage(1);
    setEmpAttendanceLoading(true);
    const pos = positions.find((p) => p.id === currentEmployee.position_id);
    const isTicket = pos?.pay_mode === "ticket" || pos?.pay_mode === "hybrid";
    if (isTicket) {
      supabase
        .from("daily_ticket_entries")
        .select("id,user_id,employee_id,employee_name,position_id,position_name,entry_date,installation_tickets,repair_tickets,disputed_install,disputed_repair,installation_rate,repair_rate,created_at,updated_at,details:daily_ticket_entry_items(id,user_id,daily_ticket_entry_id,position_ticket_category_id,category_name,ticket_count,rate,created_at)")
        .eq("employee_id", currentEmployee.id)
        .order("entry_date", { ascending: false })
        .limit(200)
        .then(({ data, error }) => {
          if (!error) setEmpTickets((data ?? []) as DailyTicketEntry[]);
          setEmpAttendanceLoading(false);
        });
    } else {
      supabase
        .from("attendance_entries")
        .select("id,user_id,employee_id,employee_name,position_id,position_name,entry_date,status,time_in,time_out,created_at,updated_at")
        .eq("employee_id", currentEmployee.id)
        .order("entry_date", { ascending: false })
        .limit(200)
        .then(({ data, error }) => {
          if (!error) setEmpAttendance((data ?? []) as AttendanceEntry[]);
          setEmpAttendanceLoading(false);
        });
    }
  }, [activeTab, currentEmployee.id, currentEmployee.position_id]);

  async function saveTicketRate(type: "installation" | "repair") {
    if (!supabase) return;
    const value = Math.max(0, toNumber(rateDrafts[type]));
    const column = type === "installation" ? "installation_rate" : "repair_rate";
    if (!navigator.onLine) {
      const nextEmployee = { ...currentEmployee, [column]: value, updated_at: new Date().toISOString() };
      setCurrentEmployee(nextEmployee);
      onEmployeeUpdate(nextEmployee);
      setEditingRate(null);
      await onQueueOfflineMutation({
        resource: "employees",
        affectedResources: ["employees", "dashboardSummary"],
        operation: "update",
        table: "employees",
        recordId: currentEmployee.id,
        payload: { [column]: value },
      });
      return;
    }
    const { data, error } = await supabase
      .from("employees")
      .update({ [column]: value })
      .eq("id", currentEmployee.id)
      .select()
      .single();

    if (error) {
      if (isOfflineLikeError(error)) {
        const nextEmployee = { ...currentEmployee, [column]: value, updated_at: new Date().toISOString() };
        setCurrentEmployee(nextEmployee);
        onEmployeeUpdate(nextEmployee);
        setEditingRate(null);
        await onQueueOfflineMutation({
          resource: "employees",
          affectedResources: ["employees", "dashboardSummary"],
          operation: "update",
          table: "employees",
          recordId: currentEmployee.id,
          payload: { [column]: value },
        });
        return;
      }
      NotificationService.showError(friendlyError(error));
      return;
    }

    const nextEmployee = data as Employee;
    setCurrentEmployee(nextEmployee);
    onEmployeeUpdate(nextEmployee);
    setEditingRate(null);
    NotificationService.showSuccess(`${type === "installation" ? "Installation" : "Repair"} ticket wage saved.`);
    await onChange();
  }


  const detailPayrollRuns = employeePayrollRuns.length > 0 ? employeePayrollRuns : payrollRuns;
  const history = detailPayrollRuns
    .flatMap((run) =>
      run.items
        .filter((item) => item.employee_id === currentEmployee.id)
        .map((item) => ({ item, run })),
    )
    .sort((a, b) => {
      const yearDiff = b.run.period_year - a.run.period_year;
      if (yearDiff !== 0) return yearDiff;
      const monthDiff = b.run.period_month - a.run.period_month;
      if (monthDiff !== 0) return monthDiff;
      return b.run.pay_period.localeCompare(a.run.pay_period);
    });
  const totals = history.reduce(
    (sum, row) => ({
      gross: sum.gross + toNumber(row.item.gross_pay),
      allowances: sum.allowances + toNumber(row.item.allowances),
      deductions: sum.deductions + toNumber(row.item.deductions),
      net: sum.net + toNumber(row.item.net_pay),
      paid: sum.paid + (row.item.status === "paid" ? toNumber(row.item.net_pay) : 0),
      pending: sum.pending + (row.item.status !== "paid" ? toNumber(row.item.net_pay) : 0),
    }),
    { gross: 0, allowances: 0, deductions: 0, net: 0, paid: 0, pending: 0 },
  );
  const ticketTotals = history.reduce(
    (sum, row) => ({
      installation: sum.installation + normalizeTicketCount(row.item.installation_tickets),
      repair: sum.repair + normalizeTicketCount(row.item.repair_tickets),
    }),
    { installation: 0, repair: 0 },
  );
  const repairRate = toNumber(currentEmployee.repair_rate);
  const installationRate = toNumber(currentEmployee.installation_rate);
  const repairEarnings = ticketTotals.repair * repairRate;
  const installationEarnings = ticketTotals.installation * installationRate;
  const totalTicketEarnings = repairEarnings + installationEarnings;
  const closedTickets = ticketTotals.repair + ticketTotals.installation;
  const initials = currentEmployee.full_name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "E";
  const currentPosition = positions.find((position) => position.id === currentEmployee.position_id);
  const isTicketBased = currentPosition?.pay_mode === "ticket" || currentPosition?.pay_mode === "hybrid";
  const employeeCode = `EMP-${currentEmployee.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase() || "000001"}`;
  const payMethodLabel =
    currentPosition?.pay_mode === "fixed"
      ? "Fixed salary"
      : currentPosition?.pay_mode === "hybrid"
        ? "Base + tickets"
        : currentPosition?.pay_mode === "daily"
          ? "Daily wage"
          : "Per ticket";
  const tabs = [
    { id: "information", icon: <Users size={16} />, label: "Personal Info" },
    { id: "payroll", icon: <Briefcase size={16} />, label: "Salary History" },
    ...(isTicketBased ? [{ id: "tickets" as const, icon: <BadgeDollarSign size={16} />, label: "Ticket Earnings" }] : []),
    { id: "attendance", icon: <CalendarClock size={16} />, label: "Attendance" },
    { id: "employee-advances", icon: <CreditCard size={16} />, label: "Employee Advances" },
    { id: "documents", icon: <FileText size={16} />, label: "Documents" },
    { id: "government-deduction", icon: <BadgeDollarSign size={16} />, label: "Government Deduction" },
  ] as const;

  return (
    <div className="page-stack employee-details-page">
      <div className="employee-details">
        <header className="emp-header">
          <button className="emp-back" onClick={onBack} type="button">
            <ArrowLeft size={16} />
          </button>
          <div className="emp-identity">
            <div className="emp-avatar-group">
              <div className="emp-avatar">
                {currentEmployee.profile_photo_url ? (
                  <img alt={`${currentEmployee.full_name} profile`} src={currentEmployee.profile_photo_url} />
                ) : (
                  <span>{initials}</span>
                )}
              </div>
            </div>
            <div className="emp-name-group">
              <strong className="emp-name">{currentEmployee.full_name}</strong>
              <span className={currentEmployee.status === "active" ? "emp-status-pill active" : "emp-status-pill inactive"}>
                {currentEmployee.status === "active" ? "Active" : "Inactive"}
              </span>
              <span className="emp-position-label">{currentEmployee.role || "Unassigned position"}</span>
              <div className="emp-meta-row">
                <div className="emp-meta-item">
                  <span>Employee ID</span>
                  <strong>{employeeCode}</strong>
                </div>
                <div className="emp-meta-item">
                  <span>Date Hired</span>
                  <strong>{currentEmployee.hire_date || "Not provided"}</strong>
                </div>
                <div className="emp-meta-item">
                  <span>Department</span>
                  <strong>{currentEmployee.department || "Unassigned"}</strong>
                </div>
                <div className="emp-meta-item">
                  <span>Pay Method</span>
                  <strong>{payMethodLabel}</strong>
                </div>
              </div>
            </div>
          </div>
          <div className="emp-header-actions">
            <button className="primary-button compact" onClick={() => onEdit(currentEmployee)} type="button">
              <Pencil size={14} />
              Edit Employee
            </button>
          </div>
        </header>

        <nav className="emp-tabs" role="tablist" aria-label="Employee details sections">
          {tabs.map((tab) => (
            <button
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? "active" : ""}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              type="button"
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>

        {activeTab === "information" && (
          <section className="emp-content-card">
            <div className="emp-panels">
              <div className="emp-panel">
                <div className="emp-panel-heading">
                  <h3>Personal Information</h3>
                </div>
                <div className="emp-info-grid">
                  <DetailItem icon={<Users size={15} />} label="Full Name" value={currentEmployee.full_name} />
                  <DetailItem icon={<Mail size={15} />} label="Email" value={currentEmployee.email || "Not provided"} />
                  <DetailItem icon={<Phone size={15} />} label="Contact Number" value={currentEmployee.contact_number ? formatPhoneNumber(currentEmployee.contact_number) : "Not provided"} />
                  <DetailItem icon={<MapPin size={15} />} label="Address" value={currentEmployee.address || "Not provided"} />
                  <DetailItem icon={<Users size={15} />} label="Emergency Contact" value={currentEmployee.emergency_contact_name || "Not provided"} />
                  <DetailItem icon={<Phone size={15} />} label="Emergency Number" value={currentEmployee.emergency_contact_number ? formatPhoneNumber(currentEmployee.emergency_contact_number) : "Not provided"} />
                  <DetailItem icon={<Heart size={15} />} label="Relation" value={currentEmployee.emergency_contact_relation || "Not provided"} />
                  <DetailItem icon={<FileText size={15} />} label="Notes" value={currentEmployee.notes || "No notes"} />
                </div>
              </div>

              <div className="emp-panel">
                <div className="emp-panel-heading">
                  <h3>Employment Information</h3>
                </div>
                <div className="emp-info-grid">
                  <DetailItem icon={<Briefcase size={15} />} label="Position" value={currentEmployee.role || "Unassigned"} />
                  <DetailItem icon={<LayoutDashboard size={15} />} label="Department" value={currentEmployee.department || "Unassigned"} />
                  <DetailItem icon={<CalendarClock size={15} />} label="Date Hired" value={currentEmployee.hire_date || "Not provided"} />
                  <DetailItem icon={<BadgeInfo size={15} />} label="Employment Status" value={<StatusPill status={currentEmployee.status} />} />
                  <DetailItem icon={<CreditCard size={15} />} label="Pay Method" value={payMethodLabel} />
                  <DetailItem icon={<BadgeDollarSign size={15} />} label="Monthly Base" value={currency.format(toNumber(currentPosition?.monthly_base_salary))} />
                  <DetailItem icon={<BadgeDollarSign size={15} />} label="Daily Rate" value={currency.format(toNumber(currentPosition?.daily_rate))} />
                  <DetailItem icon={<Wrench size={15} />} label="Wage Category" value={currentEmployee.wage_category === "special_old" ? "Special Old" : "New"} />
                </div>
                <div className="emp-divider" />
                <div className="emp-subsection">
                  <h4>Government IDs</h4>
                  <div className="emp-info-grid">
                    <DetailItem icon={<BadgeInfo size={15} />} label="SSS Number" value={currentEmployee.sss_number || "Not provided"} />
                    <DetailItem icon={<BadgeInfo size={15} />} label="PhilHealth Number" value={currentEmployee.philhealth_number || "Not provided"} />
                    <DetailItem icon={<BadgeInfo size={15} />} label="Pag-IBIG Number" value={currentEmployee.pagibig_number || "Not provided"} />
                    <DetailItem icon={<BadgeInfo size={15} />} label="TIN" value={currentEmployee.tin_number || "Not provided"} />
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === "payroll" && (
          <section className="emp-content-card history-stack">
            <div className="emp-summary-cards">
              <div className="emp-summary-card">
                <span>Total Gross</span>
                <strong>{currency.format(totals.gross)}</strong>
              </div>
              <div className="emp-summary-card">
                <span>Total Paid</span>
                <strong>{currency.format(totals.paid)}</strong>
              </div>
              <div className="emp-summary-card">
                <span>Pending Salary</span>
                <strong>{currency.format(totals.pending)}</strong>
              </div>
            </div>
            <h3>Salary History</h3>
            <DataTable
              empty="No payroll records for this employee yet."
              headers={["Period", "Generated", "Gross", "Allowance", "Deduction", "Net", "Status"]}
              rows={history.map(({ item, run }) => [
                `${monthNames[run.period_month - 1]} ${run.period_year} - ${payPeriodLabel(run.pay_period)}`,
                run.generated_date,
                currency.format(toNumber(item.gross_pay)),
                currency.format(toNumber(item.allowances)),
                currency.format(toNumber(item.deductions)),
                currency.format(toNumber(item.net_pay)),
                <StatusPill key="status" status={item.status} />,
              ])}
            />
          </section>
        )}

        {activeTab === "tickets" && (
          <section className="emp-content-card history-stack">
            <div className="ticket-section-heading">
              <div>
                <h3>{currentPosition?.name ?? "Unassigned position"} ticket compensation</h3>
                <p>Rates are controlled by the assigned position. Employee-specific overrides are not used.</p>
              </div>
            </div>
            <DataTable
              empty="This position has no ticket categories."
              headers={["Category", "Rate", "Status"]}
              rows={(currentPosition?.categories ?? []).map((category) => [
                category.name,
                currency.format(toNumber(category.rate)),
                <StatusPill key="status" status={category.status} />,
              ])}
            />
            <h3>Payroll ticket history</h3>
            <DataTable
              empty="No ticket-based payroll records for this employee yet."
              headers={["Period", "Category", "Closed", "Saved rate", "Earned"]}
              rows={history.flatMap(({ item, run }) => (item.ticket_details ?? []).map((detail) => [
                `${monthNames[run.period_month - 1]} ${run.period_year} - ${payPeriodLabel(run.pay_period)}`,
                detail.category_name,
                detail.ticket_count,
                currency.format(toNumber(detail.rate)),
                currency.format(toNumber(detail.amount)),
              ]))}
            />
            <div className="detail-note">
              <CheckCircle2 size={16} />
              <p>Saved payroll rates are snapshots. Editing the position affects only future daily entries.</p>
            </div>
          </section>
        )}

        {activeTab === "employee-advances" && (
          <EmployeeAdvancesFeature
            employee={currentEmployee}
            employeeAdvances={employeeAdvances}
            onChange={onChange}
            onQueueOfflineMutation={onQueueOfflineMutation}
            userId={userId}
          />
        )}


        {activeTab === "documents" && (
          <section className="emp-content-card">
            <h3>Documents</h3>
            <div className="emp-info-grid">
              <DetailItem icon={<BadgeInfo size={15} />} label="SSS Number" value={currentEmployee.sss_number || "Not provided"} />
              <DetailItem icon={<BadgeInfo size={15} />} label="PhilHealth Number" value={currentEmployee.philhealth_number || "Not provided"} />
              <DetailItem icon={<BadgeInfo size={15} />} label="Pag-IBIG Number" value={currentEmployee.pagibig_number || "Not provided"} />
              <DetailItem icon={<BadgeInfo size={15} />} label="TIN Number" value={currentEmployee.tin_number || "Not provided"} />
            </div>
          </section>
        )}

        {activeTab === "government-deduction" && (
          <section className="emp-content-card">
            <h3>Government Deduction</h3>
            <div className="emp-info-grid">
              <DetailItem icon={<BadgeDollarSign size={15} />} label="SSS" value={currency.format(toNumber(currentEmployee.sss_deduction))} />
              <DetailItem icon={<BadgeDollarSign size={15} />} label="PhilHealth" value={currency.format(toNumber(currentEmployee.philhealth_deduction))} />
              <DetailItem icon={<BadgeDollarSign size={15} />} label="Pag-IBIG" value={currency.format(toNumber(currentEmployee.pagibig_deduction))} />
              <DetailItem icon={<BadgeDollarSign size={15} />} label="Withholding Tax" value={currency.format(toNumber(currentEmployee.withholding_tax))} />
            </div>
          </section>
        )}

        {activeTab === "attendance" && (() => {
          const isTicket = currentPosition?.pay_mode === "ticket" || currentPosition?.pay_mode === "hybrid";
          const dailyRate = toNumber(currentPosition?.daily_rate ?? 0);
          const attendancePageSize = 10;
          const attendanceTotal = isTicket ? empTickets.length : empAttendance.length;
          const attendancePageCount = Math.max(1, Math.ceil(attendanceTotal / attendancePageSize));
          const safeAttendancePage = Math.min(empAttendancePage, attendancePageCount);
          const pageStart = (safeAttendancePage - 1) * attendancePageSize;
          const pageEnd = Math.min(pageStart + attendancePageSize, attendanceTotal);
          const paginatedTickets = empTickets.slice(pageStart, pageEnd);
          const paginatedAttendance = empAttendance.slice(pageStart, pageEnd);
          const attendanceFooter = attendanceTotal > attendancePageSize && (
            <div className="attendance-footer emp-attendance-footer">
              <span>
                Showing {pageStart + 1} to {pageEnd} of {attendanceTotal} {isTicket ? "ticket" : "attendance"} records
              </span>
              <div>
                <button type="button">{attendancePageSize} / page</button>
                <button type="button" disabled={safeAttendancePage === 1} onClick={() => setEmpAttendancePage((page) => Math.max(1, page - 1))}>{"<"}</button>
                {Array.from({ length: attendancePageCount }, (_, index) => index + 1).map((page) => (
                  <button
                    className={page === safeAttendancePage ? "active" : undefined}
                    key={page}
                    onClick={() => setEmpAttendancePage(page)}
                    type="button"
                  >
                    {page}
                  </button>
                ))}
                <button type="button" disabled={safeAttendancePage === attendancePageCount} onClick={() => setEmpAttendancePage((page) => Math.min(attendancePageCount, page + 1))}>{">"}</button>
              </div>
            </div>
          );
          return (
            <section className="emp-content-card">
              <h3>Attendance &amp; Earnings History</h3>
              {empAttendanceLoading ? (
                <p className="muted">Loading…</p>
              ) : isTicket ? (
                empTickets.length === 0 ? (
                  <p className="muted">No ticket entries recorded yet.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="emp-attendance-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Tickets</th>
                          <th>Daily Earnings</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedTickets.map((entry) => {
                          const totalTickets = entry.details && entry.details.length > 0
                            ? entry.details.reduce((s, d) => s + (d.ticket_count ?? 0), 0)
                            : normalizeTicketCount(entry.installation_tickets) + normalizeTicketCount(entry.repair_tickets);
                          const earnings = entry.details && entry.details.length > 0
                            ? entry.details.reduce((s, d) => s + (d.ticket_count ?? 0) * toNumber(d.rate), 0)
                            : normalizeTicketCount(entry.installation_tickets) * toNumber(entry.installation_rate) + normalizeTicketCount(entry.repair_tickets) * toNumber(entry.repair_rate);
                          return (
                            <tr key={entry.id}>
                              <td>{new Date(`${entry.entry_date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                              <td>{totalTickets}</td>
                              <td><strong>{currency.format(earnings)}</strong></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {attendanceFooter}
                  </div>
                )
              ) : (
                empAttendance.length === 0 ? (
                  <p className="muted">No attendance entries recorded yet.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="emp-attendance-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Time In</th>
                          <th>Time Out</th>
                          <th>Status</th>
                          <th>Daily Earnings</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedAttendance.map((entry) => {
                          const earnings = computeDailyEarnings(dailyRate, entry.status, entry.time_in ?? "08:00", entry.time_out ?? "17:00");
                          return (
                            <tr key={entry.id} className={entry.status === "absent" ? "emp-att-absent" : entry.status === "half_day" ? "emp-att-leave" : ""}>
                              <td>{new Date(`${entry.entry_date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                              <td>{entry.status === "absent" ? "—" : formatTime(entry.time_in ?? "08:00")}</td>
                              <td>{entry.status === "absent" ? "—" : formatTime(entry.time_out ?? "17:00")}</td>
                              <td>
                                <span className={`att-history-badge ${entry.status}`}>
                                  {entry.status === "present" ? "Present" : entry.status === "absent" ? "Absent" : "On Leave"}
                                </span>
                              </td>
                              <td><strong>{entry.status === "absent" ? "—" : currency.format(earnings)}</strong></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {attendanceFooter}
                  </div>
                )
              )}
            </section>
          );
        })()}
      </div>
    </div>
  );
}

function TicketRateRow({
  description,
  draftValue,
  editing,
  icon,
  onDraftChange,
  onEdit,
  onSave,
  rate,
  title,
  tone,
}: {
  description: string;
  draftValue: string;
  editing: boolean;
  icon: ReactNode;
  onDraftChange: (value: string) => void;
  onEdit: () => void;
  onSave: () => void;
  rate: number;
  title: string;
  tone: "blue" | "green";
}) {
  return (
    <div className="ticket-rate-row">
      <div className="ticket-rate-title">
        <span className={`ticket-rate-icon ${tone}`}>{icon}</span>
        <strong>{title}</strong>
      </div>
      <p>{description}</p>
      <div className="ticket-rate-input">
        <span>PHP</span>
        {editing ? (
          <input
            aria-label={`${title} wage per closed ticket`}
            min="0"
            onChange={(event) => onDraftChange(event.target.value)}
            step="0.01"
            type="number"
            value={draftValue}
          />
        ) : (
          <strong>{rate.toFixed(2)}</strong>
        )}
      </div>
      <StatusPill status="active" />
      <div className="ticket-rate-actions">
        <button
          aria-label={editing ? `Save ${title}` : `Edit ${title}`}
          onClick={editing ? onSave : onEdit}
          title={editing ? `Save ${title}` : `Edit ${title}`}
          type="button"
        >
          {editing ? <Save size={15} /> : <Pencil size={15} />}
        </button>
      </div>
    </div>
  );
}

function DetailItem({ icon, label, value }: { icon?: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="detail-item">
      <span>
        {icon && <i className="detail-item-icon" aria-hidden="true">{icon}</i>}
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

function EmployeeForm({
  embedded = false,
  initial,
  onClose,
  onSubmit,
  positions,
}: {
  embedded?: boolean;
  initial: Employee | null;
  onClose: () => void;
  onSubmit: (values: EmployeeFormValues) => Promise<void>;
  positions: Position[];
}) {
  type FormTab = "personal" | "employment" | "documents" | "government-deduction";
  const [activeTab, setActiveTab] = useState<FormTab>("personal");
  const [values, setValues] = useState<EmployeeFormValues>(
    initial
      ? {
          full_name: initial.full_name,
          role: initial.role,
          position_id: initial.position_id ?? "",
          department: initial.department,
          contact_number: initial.contact_number,
          email: initial.email,
          address: initial.address,
          profile_photo_url: initial.profile_photo_url ?? "",
          hire_date: initial.hire_date ?? "",
          status: initial.status,
          wage_category: initial.wage_category ?? "new",
          gender: initial.gender ?? "",
          monthly_salary: String(initial.monthly_salary),
          sss_number: initial.sss_number,
          philhealth_number: initial.philhealth_number,
          pagibig_number: initial.pagibig_number,
          sss_deduction: String(initial.sss_deduction ?? 0),
          philhealth_deduction: String(initial.philhealth_deduction ?? 0),
          pagibig_deduction: String(initial.pagibig_deduction ?? 0),
          withholding_tax: String(initial.withholding_tax ?? 0),
          tin_number: initial.tin_number,
          emergency_contact_name: initial.emergency_contact_name ?? "",
          emergency_contact_number: initial.emergency_contact_number ?? "",
          emergency_contact_relation: initial.emergency_contact_relation ?? "",
          notes: initial.notes,
        }
      : emptyEmployee,
  );
  const [busy, setBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");

  function handlePhotoFile(file: File | null) {
    if (!file) return;
    const allowedTypes = ["image/png", "image/jpeg"];
    if (!allowedTypes.includes(file.type)) {
      setPhotoError("Upload a PNG or JPG image.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setPhotoError("Profile photo must be 2MB or smaller.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setValues((current) => ({ ...current, profile_photo_url: String(reader.result ?? "") }));
      setPhotoError("");
    };
    reader.onerror = () => setPhotoError("Unable to read that image. Try another file.");
    reader.readAsDataURL(file);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!values.full_name.trim()) return;
    setBusy(true);
    await onSubmit(values);
    setBusy(false);
  }

  const selectedPosition = positions.find((p) => p.id === values.position_id);
  const initials = values.full_name.trim().split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const completedFields = [
    values.full_name,
    values.position_id,
    values.email,
    values.contact_number,
    values.hire_date,
    values.sss_number,
    values.philhealth_number,
    values.pagibig_number,
    values.sss_deduction,
    values.philhealth_deduction,
    values.pagibig_deduction,
    values.withholding_tax,
    values.tin_number,
  ].filter(Boolean).length;
  const totalFields = 13;

  const tabs: { id: FormTab; icon: ReactNode; label: string }[] = [
    { id: "personal", icon: <Users size={16} />, label: "Personal" },
    { id: "employment", icon: <Briefcase size={16} />, label: "Employment" },
    { id: "documents", icon: <FileText size={16} />, label: "Documents" },
    { id: "government-deduction", icon: <BadgeDollarSign size={16} />, label: "Government Deduction" },
  ];

  const formContent = (
    <form className="emp-form-wizard" onSubmit={handleSubmit}>
      <div className="emp-form-body">
        <div className="emp-form-main">
          <div className="emp-form-tabs" role="tablist" aria-label="Employee form sections">
            {tabs.map((tab) => (
              <button
                aria-selected={activeTab === tab.id}
                className={activeTab === tab.id ? "active" : ""}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                role="tab"
                type="button"
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "personal" && (
            <div className="emp-form-section">
              <div className="emp-form-photo-hero">
                <label
                  className={values.profile_photo_url ? "emp-photo-upload has-photo" : "emp-photo-upload"}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    handlePhotoFile(event.dataTransfer.files[0] ?? null);
                  }}
                >
                  <input
                    accept="image/png,image/jpeg"
                    onChange={(event) => handlePhotoFile(event.target.files?.[0] ?? null)}
                    type="file"
                  />
                  <div className="emp-photo-circle">
                    {values.profile_photo_url ? (
                      <img alt="Preview" src={values.profile_photo_url} />
                    ) : (
                      <span className="emp-photo-placeholder">
                        {initials || <Plus size={28} />}
                      </span>
                    )}
                    <div className="emp-photo-overlay">
                      <Upload size={18} />
                    </div>
                  </div>
                  <p className="emp-photo-hint">{values.profile_photo_url ? "Change photo" : "Upload photo"}</p>
                  {photoError && <small className="emp-photo-error">{photoError}</small>}
                </label>
              </div>

              <div className="emp-form-group">
                <h3>Basic Information</h3>
                <div className="emp-form-fields">
                  <TextField label="Full name" value={values.full_name} onChange={(full_name) => setValues({ ...values, full_name })} required />
                  <label>
                    Gender
                    <select value={values.gender} onChange={(event) => setValues({ ...values, gender: event.target.value })}>
                      <option value="">Not specified</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <TextField label="Email address" type="email" value={values.email} onChange={(email) => setValues({ ...values, email })} />
                  <TextField label="Contact number" type="tel" placeholder="+63 XXXX XXX XXXX" value={formatPhoneNumber(values.contact_number)} onChange={(v) => setValues({ ...values, contact_number: normalizePhoneDigits(v) })} />
                  <label className="full">
                    Address
                    <textarea rows={2} value={values.address} onChange={(event) => setValues({ ...values, address: event.target.value })} placeholder="Street, city, province" />
                  </label>
                </div>
              </div>
              <div className="emp-form-group">
                <h3>Emergency Contact</h3>
                <div className="emp-form-fields">
                  <TextField label="Contact person" value={values.emergency_contact_name} onChange={(emergency_contact_name) => setValues({ ...values, emergency_contact_name })} />
                  <TextField label="Contact number" type="tel" placeholder="+63 XXXX XXX XXXX" value={formatPhoneNumber(values.emergency_contact_number)} onChange={(v) => setValues({ ...values, emergency_contact_number: normalizePhoneDigits(v) })} />
                  <TextField label="Relation (e.g., Spouse, Parent)" value={values.emergency_contact_relation} onChange={(emergency_contact_relation) => setValues({ ...values, emergency_contact_relation })} />
                </div>
              </div>
            </div>
          )}

          {activeTab === "employment" && (
            <div className="emp-form-section">
              <div className="emp-form-group">
                <h3>Position & Department</h3>
                <div className="emp-form-fields">
                  <label>
                    Position
                    <select
                      required
                      value={values.position_id}
                      onChange={(event) => {
                        const position = positions.find((item) => item.id === event.target.value);
                        const salary = (position?.pay_mode === "fixed" || position?.pay_mode === "hybrid")
                          ? String(position.monthly_base_salary)
                          : "0";
                        setValues({
                          ...values,
                          position_id: event.target.value,
                          role: position?.name ?? "",
                          department: position?.department ?? "",
                          monthly_salary: salary,
                        });
                      }}
                    >
                      <option value="">Select a position</option>
                      {positions
                        .filter((position) => position.status === "active" || position.id === initial?.position_id)
                        .map((position) => (
                          <option key={position.id} value={position.id}>
                            {position.name}{position.status === "archived" ? " (Archived)" : ""}
                          </option>
                        ))}
                    </select>
                  </label>
                  <TextField label="Department" value={values.department} onChange={() => undefined} />
                </div>
                {selectedPosition && (
                  <div className="emp-position-badge">
                    <Briefcase size={14} />
                    <span>{selectedPosition.pay_mode === "fixed" ? "Fixed salary" : selectedPosition.pay_mode === "hybrid" ? "Base + ticket" : selectedPosition.pay_mode === "daily" ? "Daily wage" : "Per ticket"}</span>
                    {selectedPosition.monthly_base_salary > 0 && (
                      <>
                        <span className="emp-position-sep" />
                        <span>Base {currency.format(toNumber(selectedPosition.monthly_base_salary))}/mo</span>
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className="emp-form-group">
                <h3>Employment Status</h3>
                <div className="emp-form-fields">
                  <label>
                    Status
                    <select value={values.status} onChange={(event) => setValues({ ...values, status: event.target.value as EmployeeFormValues["status"] })}>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </label>
                  <TextField label="Hire date" type="date" value={values.hire_date} onChange={(hire_date) => setValues({ ...values, hire_date })} />
                </div>
              </div>
              <div className="emp-form-group">
                <h3>Additional</h3>
                <div className="emp-form-fields">
                  <label className="full">
                    Notes
                    <textarea rows={3} value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} placeholder="Any additional notes about this employee" />
                  </label>
                </div>
              </div>
            </div>
          )}

          {activeTab === "documents" && (
            <div className="emp-form-section">
              <div className="emp-form-group">
                <h3>Government IDs</h3>
                <p className="emp-form-group-desc">Required for payroll compliance and statutory deductions.</p>
                <div className="emp-form-fields">
                  <TextField label="SSS number" value={values.sss_number} onChange={(sss_number) => setValues({ ...values, sss_number })} />
                  <TextField label="PhilHealth number" value={values.philhealth_number} onChange={(philhealth_number) => setValues({ ...values, philhealth_number })} />
                  <TextField label="Pag-IBIG number" value={values.pagibig_number} onChange={(pagibig_number) => setValues({ ...values, pagibig_number })} />
                  <TextField label="TIN number" value={values.tin_number} onChange={(tin_number) => setValues({ ...values, tin_number })} />
                </div>
              </div>
            </div>
          )}

          {activeTab === "government-deduction" && (
            <div className="emp-form-section">
              <div className="emp-form-group">
                <h3>Government Deduction</h3>
                <p className="emp-form-group-desc">Per-payroll statutory deduction amounts.</p>
                <div className="emp-form-fields">
                  <MoneyInput label="SSS" value={values.sss_deduction} onChange={(sss_deduction) => setValues({ ...values, sss_deduction })} />
                  <MoneyInput label="PhilHealth" value={values.philhealth_deduction} onChange={(philhealth_deduction) => setValues({ ...values, philhealth_deduction })} />
                  <MoneyInput label="Pag-IBIG" value={values.pagibig_deduction} onChange={(pagibig_deduction) => setValues({ ...values, pagibig_deduction })} />
                  <MoneyInput label="Withholding Tax" value={values.withholding_tax} onChange={(withholding_tax) => setValues({ ...values, withholding_tax })} />
                </div>
              </div>
            </div>
          )}
        </div>

        <aside className="emp-form-sidebar">
          <div className="emp-form-preview">
            <div className="emp-preview-avatar">
              {values.profile_photo_url ? (
                <img alt="Preview" src={values.profile_photo_url} />
              ) : (
                <span>{initials || "?"}</span>
              )}
            </div>
            <strong className="emp-preview-name">{values.full_name || "Employee name"}</strong>
            <span className="emp-preview-role">{selectedPosition?.name || "No position"}</span>
            <StatusPill status={values.status} />
          </div>

          <div className="emp-form-progress">
            <div className="emp-progress-header">
              <span>Profile completion</span>
              <strong>{Math.round((completedFields / totalFields) * 100)}%</strong>
            </div>
            <div className="emp-progress-bar">
              <div className="emp-progress-fill" style={{ width: `${(completedFields / totalFields) * 100}%` }} />
            </div>
          </div>

          <div className="emp-form-summary">
            <div className="emp-summary-row">
              <span>Position</span>
              <strong>{selectedPosition?.name || "—"}</strong>
            </div>
            <div className="emp-summary-row">
              <span>Department</span>
              <strong>{values.department || "—"}</strong>
            </div>
            <div className="emp-summary-row">
              <span>Email</span>
              <strong>{values.email || "—"}</strong>
            </div>
            <div className="emp-summary-row">
              <span>Phone</span>
              <strong>{values.contact_number ? formatPhoneNumber(values.contact_number) : "—"}</strong>
            </div>
            <div className="emp-summary-row">
              <span>Hire date</span>
              <strong>{values.hire_date || "—"}</strong>
            </div>
          </div>

          <div className="emp-form-actions-sticky">
            <button className="secondary-button" onClick={onClose} type="button">Cancel</button>
            <button className="primary-button" disabled={busy} type="submit">
              {busy && <Spinner size="small" />}
              {busy ? "Saving..." : initial ? "Save Changes" : "Add Employee"}
            </button>
          </div>
        </aside>
      </div>
    </form>
  );

  if (embedded) {
    return (
      <div className="page-stack">
        <header className="emp-form-header">
          <div>
            <button className="text-button" onClick={onClose} type="button">
              <ArrowLeft size={16} />
              Back to Employees
            </button>
            <h1>{initial ? "Edit Employee" : "Add New Employee"}</h1>
            <p>{initial ? "Update this employee's information." : "Fill in the details to add a new team member."}</p>
          </div>
        </header>
        {formContent}
      </div>
    );
  }

  return (
    <Modal title={initial ? "Edit employee" : "Add employee"} onClose={onClose}>
      <form className="form-grid" onSubmit={handleSubmit}>
        <TextField label="Full name" value={values.full_name} onChange={(full_name) => setValues({ ...values, full_name })} required />
        <label>
          Position
          <select
            required
            value={values.position_id}
            onChange={(event) => {
              const position = positions.find((item) => item.id === event.target.value);
              setValues({ ...values, position_id: event.target.value, role: position?.name ?? "", department: position?.department ?? "" });
            }}
          >
            <option value="">Select a position</option>
            {positions.filter((p) => p.status === "active" || p.id === initial?.position_id).map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.status === "archived" ? " (Archived)" : ""}</option>
            ))}
          </select>
        </label>
        <TextField label="Contact number" type="tel" placeholder="+63 XXXX XXX XXXX" value={formatPhoneNumber(values.contact_number)} onChange={(v) => setValues({ ...values, contact_number: normalizePhoneDigits(v) })} />
        <TextField label="Email" type="email" value={values.email} onChange={(email) => setValues({ ...values, email })} />
        <label>
          Status
          <select value={values.status} onChange={(event) => setValues({ ...values, status: event.target.value as EmployeeFormValues["status"] })}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <TextField label="Hire date" type="date" value={values.hire_date} onChange={(hire_date) => setValues({ ...values, hire_date })} />
        <TextField label="SSS number" value={values.sss_number} onChange={(sss_number) => setValues({ ...values, sss_number })} />
        <TextField label="PhilHealth number" value={values.philhealth_number} onChange={(philhealth_number) => setValues({ ...values, philhealth_number })} />
        <TextField label="Pag-IBIG number" value={values.pagibig_number} onChange={(pagibig_number) => setValues({ ...values, pagibig_number })} />
        <MoneyInput label="SSS deduction" value={values.sss_deduction} onChange={(sss_deduction) => setValues({ ...values, sss_deduction })} />
        <MoneyInput label="PhilHealth deduction" value={values.philhealth_deduction} onChange={(philhealth_deduction) => setValues({ ...values, philhealth_deduction })} />
        <MoneyInput label="Pag-IBIG deduction" value={values.pagibig_deduction} onChange={(pagibig_deduction) => setValues({ ...values, pagibig_deduction })} />
        <MoneyInput label="Withholding tax" value={values.withholding_tax} onChange={(withholding_tax) => setValues({ ...values, withholding_tax })} />
        <TextField label="TIN number" value={values.tin_number} onChange={(tin_number) => setValues({ ...values, tin_number })} />
        <label className="full">
          Address
          <textarea rows={2} value={values.address} onChange={(event) => setValues({ ...values, address: event.target.value })} />
        </label>
        <label className="full">
          Notes
          <textarea rows={2} value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} />
        </label>
        <FormActions busy={busy} onClose={onClose} />
      </form>
    </Modal>
  );
}
