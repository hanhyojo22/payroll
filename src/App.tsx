import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  BadgeDollarSign,
  ArrowLeft,
  Bell,
  Briefcase,
  CalendarClock,
  ChevronDown,
  CheckCircle2,
  CreditCard,
  Download,
  Eye,
  FileText,
  HelpCircle,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Pencil,
  Plus,
  Printer,
  Save,
  Search,
  Settings,
  Trash2,
  Upload,
  Users,
  Wrench,
  X,
} from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { hasSupabaseConfig, supabase } from "./supabase";
import {
  dailyTicketEntriesForPayrollPeriod,
  payPeriodLabel,
  payrollItemPayloadForEmployee,
} from "./domain/payroll";
import {
  INSTALLATION_RATE,
  NEW_EMPLOYEE_REPAIR_RATE,
  employeeInstallationRate,
  employeeRepairRate,
  netPay,
  normalizeTicketCount,
  repairRateForWageCategory,
  ticketGrossPay,
  toNumber,
  wageCategoryLabel,
} from "./domain/tickets";
import {
  loadAttendanceEntries,
  loadDashboardSummary,
  loadCollections,
  loadDailyTicketEntries,
  loadEmployeePayrollRuns,
  loadEmployees,
  loadPayments,
  loadPayrollHistoryRows,
  loadPayrollRunItems,
  loadPayrollRuns,
  loadPositions,
  loadSalaryBonds,
} from "./lib/supabaseData";
import { queueMutation, readCachedResource, writeCachedResource, type PendingMutation } from "./lib/offlineDb";
import { flushPendingMutations, isOfflineLikeError } from "./lib/offlineSync";
import type {
  AttendanceEntry,
  CollectionFormValues,
  CollectionReminder,
  DashboardSummary,
  DailyTicketEntry,
  Employee,
  EmployeeFormValues,
  PaymentFormValues,
  PaymentReminder,
  PayrollHistoryRow,
  PayrollRun,
  PayrollRunFormValues,
  PayrollRunItem,
  PayrollRunWithItems,
  Position,
  PositionFormValues,
  ResourceKey,
  SalaryBond,
  SalaryBondFormValues,
} from "./types";

type View =
  | "dashboard"
  | "employees"
  | "employee-add"
  | "compensation"
  | "daily-tickets"
  | "salary-bonds"
  | "payroll"
  | "payroll-history"
  | "payments"
  | "payment-history"
  | "collections"
  | "collection-history";
type ResourceStatus = "idle" | "loading" | "ready";
type Notice = { type: "success" | "error"; text: string } | null;
type AppError = { message?: string; code?: string; details?: string | null };
type QueueOfflineMutation = (mutation: Omit<PendingMutation, "id" | "createdAt" | "status" | "attempts" | "userId">) => Promise<void>;

const initialResourceStatuses: Record<ResourceKey, ResourceStatus> = {
  attendanceEntries: "idle",
  collections: "idle",
  dashboardSummary: "idle",
  dailyTicketEntries: "idle",
  employees: "idle",
  payments: "idle",
  payrollHistory: "idle",
  payrollRuns: "idle",
  positions: "idle",
  salaryBonds: "idle",
};

const initialResourceHydration: Record<ResourceKey, boolean> = {
  attendanceEntries: false,
  collections: false,
  dashboardSummary: false,
  dailyTicketEntries: false,
  employees: false,
  payments: false,
  payrollHistory: false,
  payrollRuns: false,
  positions: false,
  salaryBonds: false,
};

const viewPaths: Record<View, string> = {
  dashboard: "/dashboard",
  employees: "/employees",
  "employee-add": "/employees/new",
  compensation: "/positions",
  "daily-tickets": "/daily-tickets",
  "salary-bonds": "/salary-bonds",
  payroll: "/payroll",
  "payroll-history": "/payroll/history",
  payments: "/payments",
  "payment-history": "/payments/history",
  collections: "/collections",
  "collection-history": "/collections/history",
};

const viewResources: Record<View, ResourceKey[]> = {
  dashboard: ["dashboardSummary"],
  employees: ["employees", "payrollRuns", "salaryBonds"],
  "employee-add": ["employees", "payrollRuns", "salaryBonds"],
  compensation: ["positions", "employees"],
  "daily-tickets": ["positions", "employees", "dailyTicketEntries"],
  "salary-bonds": ["employees", "salaryBonds"],
  payroll: ["positions", "employees", "dailyTicketEntries", "payrollRuns", "salaryBonds"],
  "payroll-history": ["payrollHistory"],
  payments: ["payments"],
  "payment-history": ["payments"],
  collections: ["collections"],
  "collection-history": ["collections"],
};

const emptyDashboardSummary: DashboardSummary = {
  activeEmployeeCount: 0,
  currentPayrollItemCount: 0,
  pendingPayroll: 0,
  paidPayroll: 0,
  pendingCollections: 0,
  collectedTotal: 0,
  latestRun: null,
  dueTodayPayments: [],
  overduePayments: [],
  dueTodayCollections: [],
  overdueCollections: [],
};

const currency = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const todayKey = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => String(new Date().getMonth() + 1);
const currentYear = () => String(new Date().getFullYear());
const isBeforeToday = (date: string) => date < todayKey();
const isToday = (date: string) => date === todayKey();
const viewFromPath = (path: string): View => {
  const match = Object.entries(viewPaths).find(([, routePath]) => routePath === path);
  return (match?.[0] as View | undefined) ?? "dashboard";
};
const friendlyError = (error: AppError | null | undefined, fallback = "Something went wrong. Please try again.") => {
  const message = `${error?.message ?? ""} ${error?.details ?? ""}`.toLowerCase();

  if (message.includes("payroll_runs_user_id_period_month_period_year_pay_period_key")) {
    return "Payroll for that month and pay period already exists. Select it from Payroll history instead.";
  }
  if (message.includes("payroll_runs_user_id_period_month_period_year_key")) {
    return "Payroll for that month already exists. Select it from Payroll history, or use the other pay period.";
  }
  if (message.includes("payment_reminders") && message.includes("schema cache")) {
    return "Payment tables are not ready yet. Run the latest Supabase SQL setup, then refresh the app.";
  }
  if (message.includes("collection_reminders") && message.includes("schema cache")) {
    return "Collection tables are not ready yet. Run the latest Supabase SQL setup, then refresh the app.";
  }
  if (message.includes("daily_ticket_entries") && message.includes("schema cache")) {
    return "Daily ticket tables are not ready yet. Run the latest Supabase SQL setup, then refresh the app.";
  }
  if ((message.includes("positions") || message.includes("position_ticket_categories")) && message.includes("schema cache")) {
    return "Position compensation tables are not ready yet. Run the latest Supabase SQL setup, then refresh the app.";
  }
  if (
    (message.includes("employees") || message.includes("payroll_runs") || message.includes("payroll_run_items")) &&
    message.includes("schema cache")
  ) {
    return "Payroll tables are not ready yet. Run the latest Supabase SQL setup, then refresh the app.";
  }
  if (message.includes("row-level security") || message.includes("violates row-level security")) {
    return "This record could not be saved for your account. Please sign in again and retry.";
  }
  if (message.includes("invalid login credentials")) {
    return "Email or password is incorrect.";
  }
  if (message.includes("email not confirmed")) {
    return "Please confirm your email before signing in.";
  }
  if (message.includes("failed to fetch") || message.includes("network")) {
    return "Unable to connect. Check your internet connection and Supabase settings.";
  }
  if (error?.code === "REQUEST_TIMEOUT" || message.includes("request timed out")) {
    return error?.details || error?.message || "A cloud request timed out. Please try again.";
  }
  if (message.includes("duplicate key")) {
    return "This record already exists. Check the selected month, pay period, or existing records.";
  }
  if (message.includes("jwt") || message.includes("refresh token")) {
    return "Your session expired. Please sign in again.";
  }
  if (message.includes("invalid api key") || message.includes("api key")) {
    return "Supabase credentials look incorrect. Check your .env file and restart the app.";
  }
  if (message.includes("permission denied")) {
    return "You do not have permission to do that. Please check your account or database policies.";
  }
  if (message.includes("null value in column")) {
    return error?.message ?? "A required database field is missing.";
  }
  if (message.includes("violates not-null constraint")) {
    return error?.message ?? "A required database field is missing.";
  }
  if (message.includes("check constraint")) {
    return error?.message ?? "A saved value does not match the database rules.";
  }

  return error?.message || fallback;
};

const emptyPayment: PaymentFormValues = {
  title: "",
  type: "loan",
  amount: "",
  due_date: todayKey(),
  status: "pending",
  notes: "",
};

const emptyCollection: CollectionFormValues = {
  title: "",
  client_name: "",
  amount: "",
  due_date: todayKey(),
  status: "pending",
  notes: "",
};

const emptySalaryBond: SalaryBondFormValues = {
  employee_id: "",
  bond_type: "Salary Advance",
  date_granted: todayKey(),
  start_deduction: todayKey(),
  purpose: "",
  amount: "",
  balance: "",
  deduction_per_payroll: "",
  status: "active",
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
  monthly_salary: "",
  sss_number: "",
  philhealth_number: "",
  pagibig_number: "",
  tin_number: "",
  notes: "",
};

const emptyPayrollRun: PayrollRunFormValues = {
  period_month: currentMonth(),
  period_year: currentYear(),
  pay_period: "first_half",
  generated_date: todayKey(),
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
          {title.toLowerCase().includes("loading") ? <Spinner /> : <CalendarClock size={30} />}
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
  const [notice, setNotice] = useState<Notice>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setNotice(null);

    const result =
      mode === "sign-in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    if (result.error) {
      setNotice({ type: "error", text: friendlyError(result.error) });
    } else if (mode === "sign-up" && !result.data.session) {
      setNotice({
        type: "success",
        text: "Account created. Check your email if confirmation is enabled.",
      });
    }
    setBusy(false);
  }

  return (
    <main className="center-screen login-screen">
      <section className="auth-panel">
        <div className="brand-row">
          <div className="brand-mark">
            <CalendarClock size={28} />
          </div>
          <div>
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
          <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} />
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
  const [employeeMenuOpen, setEmployeeMenuOpen] = useState(false);
  const [dailyTicketMenuOpen, setDailyTicketMenuOpen] = useState(false);
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary>(emptyDashboardSummary);
  const [payments, setPayments] = useState<PaymentReminder[]>([]);
  const [collections, setCollections] = useState<CollectionReminder[]>([]);
  const [attendanceEntries, setAttendanceEntries] = useState<AttendanceEntry[]>([]);
  const [dailyTicketEntries, setDailyTicketEntries] = useState<DailyTicketEntry[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [payrollRuns, setPayrollRuns] = useState<PayrollRunWithItems[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [payrollHistoryRows, setPayrollHistoryRows] = useState<PayrollHistoryRow[]>([]);
  const [salaryBonds, setSalaryBonds] = useState<SalaryBond[]>([]);
  const [resourceStatuses, setResourceStatuses] = useState(initialResourceStatuses);
  const [resourceHydration, setResourceHydration] = useState(initialResourceHydration);
  const [notice, setNotice] = useState<Notice>(null);

  async function queueOfflineMutation(mutation: Omit<PendingMutation, "id" | "createdAt" | "status" | "attempts" | "userId">) {
    await queueMutation({ ...mutation, userId: session.user.id });
    setNotice({ type: "success", text: "Saved locally. It will sync when online." });
  }

  async function syncQueuedMutations(showToast = false) {
    if (!supabase || !navigator.onLine) return;
    const result = await flushPendingMutations(supabase, session.user.id);
    if (result.failed.length > 0) {
      setNotice({ type: "error", text: `${result.failed.length} offline change could not sync. Check the record and try again.` });
    } else if (showToast && result.synced.length > 0) {
      setNotice({ type: "success", text: `${result.synced.length} offline change${result.synced.length === 1 ? "" : "s"} synced.` });
    }
    if (result.synced.length > 0) {
      const affected = Array.from(new Set(result.synced.flatMap((mutation) => mutation.affectedResources)));
      await Promise.all(affected.map((resource) => loadResource(resource, true)));
    }
  }

  function navigate(nextView: View) {
    setView(nextView);
    const nextPath = viewPaths[nextView];
    if (window.location.pathname !== nextPath) {
      window.history.pushState(null, "", nextPath);
    }
  }

  async function loadResource(resource: ResourceKey, force = false) {
    if (!supabase) return;
    if (!force && (resourceStatuses[resource] === "loading" || resourceStatuses[resource] === "ready")) return;
    const previousStatus = resourceStatuses[resource];
    const cached = !force ? await readCachedResource<unknown>(resource, session.user.id) : null;

    if (cached) {
      switch (resource) {
        case "attendanceEntries":
          setAttendanceEntries(cached as AttendanceEntry[]);
          break;
        case "collections":
          setCollections(cached as CollectionReminder[]);
          break;
        case "dashboardSummary":
          setDashboardSummary(cached as DashboardSummary);
          break;
        case "dailyTicketEntries":
          setDailyTicketEntries(cached as DailyTicketEntry[]);
          break;
        case "employees":
          setEmployees(cached as Employee[]);
          break;
        case "payments":
          setPayments(cached as PaymentReminder[]);
          break;
        case "payrollHistory":
          setPayrollHistoryRows(cached as PayrollHistoryRow[]);
          break;
        case "payrollRuns":
          setPayrollRuns(cached as PayrollRunWithItems[]);
          break;
        case "positions":
          setPositions(cached as Position[]);
          break;
        case "salaryBonds":
          setSalaryBonds(cached as SalaryBond[]);
          break;
      }
      setResourceHydration((current) => ({ ...current, [resource]: true }));
    }

    setResourceStatuses((current) => current[resource] === "ready" ? current : { ...current, [resource]: "loading" });

    try {
      const result = await (async () => {
        switch (resource) {
          case "attendanceEntries":
            return loadAttendanceEntries(supabase);
          case "collections":
            return loadCollections(supabase);
          case "dashboardSummary":
            return loadDashboardSummary(supabase);
          case "dailyTicketEntries":
            return loadDailyTicketEntries(supabase);
          case "employees":
            return loadEmployees(supabase);
          case "payments":
            return loadPayments(supabase);
          case "payrollHistory":
            return loadPayrollHistoryRows(supabase);
          case "payrollRuns":
            return loadPayrollRuns(supabase);
          case "positions":
            return loadPositions(supabase);
          case "salaryBonds":
            return loadSalaryBonds(supabase);
        }
      })();

      if (result.error) {
        setResourceStatuses((current) => ({ ...current, [resource]: previousStatus === "ready" ? "ready" : "idle" }));
        return;
      }

      switch (resource) {
        case "attendanceEntries":
          setAttendanceEntries(result.data as AttendanceEntry[]);
          break;
        case "collections":
          setCollections(result.data as CollectionReminder[]);
          break;
        case "dashboardSummary":
          setDashboardSummary(result.data as DashboardSummary);
          break;
        case "dailyTicketEntries":
          setDailyTicketEntries(result.data as DailyTicketEntry[]);
          break;
        case "employees":
          setEmployees(result.data as Employee[]);
          break;
        case "payments":
          setPayments(result.data as PaymentReminder[]);
          break;
        case "payrollHistory":
          setPayrollHistoryRows(result.data as PayrollHistoryRow[]);
          break;
        case "payrollRuns":
          setPayrollRuns(result.data as PayrollRunWithItems[]);
          break;
        case "positions":
          setPositions(result.data as Position[]);
          break;
        case "salaryBonds":
          setSalaryBonds(result.data as SalaryBond[]);
          break;
      }

      await writeCachedResource(resource, session.user.id, result.data);
      setResourceHydration((current) => ({ ...current, [resource]: true }));
      setResourceStatuses((current) => ({ ...current, [resource]: "ready" }));
    } catch (error) {
      setResourceStatuses((current) => ({ ...current, [resource]: previousStatus === "ready" ? "ready" : "idle" }));
    }
  }

  async function ensurePayrollRunItems(payrollRunId: string) {
    if (!supabase || !payrollRunId) return;
    const existingRun = payrollRuns.find((run) => run.id === payrollRunId);
    if (existingRun && existingRun.items.length > 0) return;

    const result = await loadPayrollRunItems(supabase, payrollRunId);
    if (result.error) {
      setNotice({ type: "error", text: friendlyError(result.error) });
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
      loadResource("salaryBonds", true),
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
      loadResource("dashboardSummary", true),
    ]);
  }

  async function refreshPayrollPage() {
    await Promise.all([
      loadResource("payrollRuns", true),
      loadResource("salaryBonds", true),
      loadResource("payrollHistory", true),
      loadResource("dashboardSummary", true),
    ]);
  }

  async function refreshPaymentsPage() {
    await Promise.all([
      loadResource("payments", true),
      loadResource("dashboardSummary", true),
    ]);
  }

  async function refreshCollectionsPage() {
    await Promise.all([
      loadResource("collections", true),
      loadResource("dashboardSummary", true),
    ]);
  }

  async function refreshSalaryBonds() {
    await Promise.all([
      loadResource("salaryBonds", true),
      loadResource("dashboardSummary", true),
    ]);
  }

  useEffect(() => {
    const handlePopState = () => setView(viewFromPath(window.location.pathname));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

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

  const currentViewResources = viewResources[view];
  const pageLoading = currentViewResources.some((resource) => resourceStatuses[resource] === "loading");
  const pageHydrated = currentViewResources.length === 0 ||
    currentViewResources.every((resource) => resourceHydration[resource]);
  const showPageSkeleton = pageLoading && !pageHydrated;
  const showSyncIndicator = pageLoading && pageHydrated;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-row sidebar-brand">
          <div className="brand-mark">
            <CalendarClock size={24} />
          </div>
          <div>
            <h1>Payroll System</h1>
          </div>
        </div>
        <nav className="nav-list" aria-label="Main navigation">
          <NavButton active={view === "dashboard"} icon={<LayoutDashboard size={18} />} label="Dashboard" onClick={() => navigate("dashboard")} />
          <div className="nav-group">
            <button
              className={view === "employees" || view === "employee-add" ? "nav-button active" : "nav-button"}
              onClick={() => setEmployeeMenuOpen((open) => !open)}
              type="button"
            >
              <Users size={18} />
              Employees
              <ChevronDown className={employeeMenuOpen ? "nav-chevron open" : "nav-chevron"} size={16} />
            </button>
            {employeeMenuOpen && (
              <div className="nav-submenu">
                <button className={view === "employees" ? "active" : ""} onClick={() => navigate("employees")} type="button">
                  Employee List
                </button>
                <button className={view === "employee-add" ? "active" : ""} onClick={() => navigate("employee-add")} type="button">
                  Add Employee
                </button>
              </div>
            )}
          </div>
          <NavButton active={view === "compensation"} icon={<Briefcase size={18} />} label="Positions" onClick={() => navigate("compensation")} />
          <div className="nav-group">
            <button
              className={view === "daily-tickets" ? "nav-button active" : "nav-button"}
              onClick={() => setDailyTicketMenuOpen((open) => !open)}
              type="button"
            >
              <CalendarClock size={18} />
              Daily Tickets
              <ChevronDown className={dailyTicketMenuOpen ? "nav-chevron open" : "nav-chevron"} size={16} />
            </button>
            {dailyTicketMenuOpen && (
              <div className="nav-submenu">
                <button className={view === "daily-tickets" ? "active" : ""} onClick={() => navigate("daily-tickets")} type="button">
                  Daily Ticket Entry
                </button>
                <button onClick={() => navigate("daily-tickets")} type="button">
                  Daily Ticket List
                </button>
                <button onClick={() => navigate("daily-tickets")} type="button">
                  Ticket Summary
                </button>
              </div>
            )}
          </div>
          <NavButton active={view === "payroll"} icon={<BadgeDollarSign size={18} />} label="Payroll" onClick={() => navigate("payroll")} />
          <NavButton active={view === "salary-bonds"} icon={<CreditCard size={18} />} label="Salary Bond" onClick={() => navigate("salary-bonds")} />
          <NavButton active={view === "payroll-history"} icon={<History size={18} />} label="Pay History" onClick={() => navigate("payroll-history")} />
          <NavButton active={view === "payments"} icon={<CreditCard size={18} />} label="Payments" onClick={() => navigate("payments")} />
          <NavButton active={view === "payment-history"} icon={<CalendarClock size={18} />} label="Bill History" onClick={() => navigate("payment-history")} />
          <NavButton active={view === "collections"} icon={<BadgeDollarSign size={18} />} label="Collections" onClick={() => navigate("collections")} />
          <NavButton active={view === "collection-history"} icon={<History size={18} />} label="Collection History" onClick={() => navigate("collection-history")} />
          <NavButton active={false} icon={<FileText size={18} />} label="Reports" onClick={() => navigate("compensation")} />
          <NavButton active={false} icon={<Bell size={18} />} label="Reminders" onClick={() => navigate("dashboard")} />
          <NavButton active={false} icon={<Settings size={18} />} label="Settings" onClick={() => navigate("dashboard")} />
        </nav>
        <div className="help-card">
          <HelpCircle size={24} />
          <div>
            <strong>Need Help?</strong>
            <p>Check our documentation</p>
          </div>
          <ChevronDown size={16} />
        </div>
        <div className="sidebar-footer">
          <p>{session.user.email}</p>
          <button className="icon-text-button" onClick={signOut} type="button">
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <button aria-label="Toggle navigation" className="topbar-icon" type="button">
            <Menu size={21} />
          </button>
          <label className="topbar-search">
            <input placeholder="Search employees, tickets..." type="search" />
            <Search size={18} />
          </label>
          <button aria-label="Notifications" className="topbar-icon notification-button" type="button">
            <Bell size={19} />
            <span>3</span>
          </button>
          <div className="admin-chip">
            <div className="avatar">A</div>
            <strong>Admin User</strong>
            <ChevronDown size={16} />
          </div>
        </header>
        <section className="content">
          <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} />
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
                  onChange={refreshEmployeesPage}
                  onLocalEmployeesChange={setEmployees}
                  onQueueOfflineMutation={queueOfflineMutation}
                  payrollRuns={payrollRuns}
                  positions={positions}
                  salaryBonds={salaryBonds}
                  setNotice={setNotice}
                  userId={session.user.id}
                />
            )}
            {view === "employee-add" && (
              <EmployeesView
                employees={employees}
                mode="add"
                onChange={refreshEmployeesPage}
                onExitForm={() => navigate("employees")}
                onLocalEmployeesChange={setEmployees}
                onQueueOfflineMutation={queueOfflineMutation}
                payrollRuns={payrollRuns}
                positions={positions}
                salaryBonds={salaryBonds}
                setNotice={setNotice}
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
                  setNotice={setNotice}
                  userId={session.user.id}
                />
              )}
              {view === "daily-tickets" && (
                <DailyTicketEntryView
                  dailyTicketEntries={dailyTicketEntries}
                  employees={employees}
                  positions={positions}
                  onChange={refreshDailyTicketsPage}
                  onQueueOfflineMutation={queueOfflineMutation}
                  setNotice={setNotice}
                  userId={session.user.id}
                />
              )}
              {view === "salary-bonds" && (
                <SalaryBondsView
                  employees={employees}
                  onChange={refreshSalaryBonds}
                  onQueueOfflineMutation={queueOfflineMutation}
                  setNotice={setNotice}
                  userId={session.user.id}
                />
              )}
              {view === "payroll" && (
                <PayrollView
                  dailyTicketEntries={dailyTicketEntries}
                  employees={employees}
                  ensurePayrollRunItems={ensurePayrollRunItems}
                  onLocalPayrollRunsChange={setPayrollRuns}
                  onChange={refreshPayrollPage}
                  onQueueOfflineMutation={queueOfflineMutation}
                  payrollRuns={payrollRuns}
                  positions={positions}
                  salaryBonds={salaryBonds}
                  setNotice={setNotice}
                  userId={session.user.id}
                />
              )}
              {view === "payroll-history" && (
                <PayrollHistoryView rows={payrollHistoryRows} />
              )}
              {view === "payments" && (
                <PaymentsView
                  onChange={refreshPaymentsPage}
                  onLocalPaymentsChange={setPayments}
                  onQueueOfflineMutation={queueOfflineMutation}
                  payments={payments}
                  setNotice={setNotice}
                  userId={session.user.id}
                />
              )}
              {view === "payment-history" && (
                <PaymentHistoryView payments={payments} />
              )}
              {view === "collections" && (
                <CollectionsView
                  collections={collections}
                  onChange={refreshCollectionsPage}
                  onLocalCollectionsChange={setCollections}
                  onQueueOfflineMutation={queueOfflineMutation}
                  setNotice={setNotice}
                  userId={session.user.id}
                />
              )}
              {view === "collection-history" && (
                <CollectionHistoryView collections={collections} />
              )}
          </>
          )}
        </section>
      </div>
    </main>
  );
}

function NavButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={active ? "nav-button active" : "nav-button"} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

function NoticeBanner({
  notice,
  onDismiss,
}: {
  notice: Notice;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (notice?.type !== "success") return;

    const timeout = window.setTimeout(onDismiss, 3000);
    return () => window.clearTimeout(timeout);
  }, [notice, onDismiss]);

  if (!notice) return null;

  return (
    <div className={`notice ${notice.type}`} role={notice.type === "error" ? "alert" : "status"}>
      <div>
        <strong>{notice.type === "error" ? "Action needed" : "Done"}</strong>
        <p>{notice.text}</p>
      </div>
      <button aria-label="Dismiss message" onClick={onDismiss} type="button">
        <X size={16} />
      </button>
    </div>
  );
}

function Spinner({ size = "default" }: { size?: "small" | "default" }) {
  return <span aria-hidden="true" className={`spinner ${size}`} />;
}

function SyncIndicator({ text }: { text: string }) {
  return (
    <div className="sync-indicator" role="status">
      <Spinner size="small" />
      <span>{text}</span>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="page-skeleton" aria-label="Loading page">
      <div className="skeleton-header">
        <span />
        <strong />
        <p />
      </div>
      <div className="skeleton-metric-grid">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="skeleton-card" key={index}>
            <span />
            <strong />
          </div>
        ))}
      </div>
      <div className="skeleton-band" />
      <div className="skeleton-table">
        {Array.from({ length: 5 }, (_, index) => (
          <span key={index} />
        ))}
      </div>
    </div>
  );
}

function Dashboard({ summary }: { summary: DashboardSummary }) {
  const latestRun = summary.latestRun;
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Payroll overview"
        title="Dashboard"
        text="Monitor employees, payroll runs, payment reminders, and receivables."
      />
      <section className="metric-grid">
        <Metric icon={<Users />} label="Active employees" value={summary.activeEmployeeCount} />
        <Metric icon={<CalendarClock />} label="Current payroll" value={summary.currentPayrollItemCount} />
        <Metric icon={<BadgeDollarSign />} label="Pending payroll" value={currency.format(summary.pendingPayroll)} />
        <Metric icon={<CheckCircle2 />} label="Paid payroll" value={currency.format(summary.paidPayroll)} tone="success" />
        <Metric icon={<BadgeDollarSign />} label="Pending collections" value={currency.format(summary.pendingCollections)} />
        <Metric icon={<CheckCircle2 />} label="Collected total" value={currency.format(summary.collectedTotal)} tone="success" />
      </section>
      <section className="summary-band">
        <div>
          <p className="eyebrow">Latest generated date</p>
          <h2>{latestRun ? latestRun.generated_date : "No payroll yet"}</h2>
        </div>
        <p>
          {latestRun
            ? `${monthNames[latestRun.period_month - 1]} ${latestRun.period_year} - ${payPeriodLabel(latestRun.pay_period)} has ${latestRun.item_count} payroll items.`
            : "Create employees first, then generate a monthly payroll run."}
        </p>
      </section>
      <section className="two-column">
        <DueList title="Payments due today" rows={summary.dueTodayPayments} />
        <DueList title="Overdue payments" rows={summary.overduePayments} empty="No overdue payment reminders." />
        <DueList title="Collections due today" rows={summary.dueTodayCollections} />
        <DueList title="Overdue collections" rows={summary.overdueCollections} empty="No overdue collections." />
      </section>
    </div>
  );
}

function Metric({
  icon,
  label,
  tone,
  value,
}: {
  icon: ReactNode;
  label: string;
  tone?: "danger" | "success";
  value: number | string;
}) {
  return (
    <div className={`metric ${tone ?? ""}`}>
      <div className="metric-icon">{icon}</div>
      <p>{label}</p>
      <strong>{value}</strong>
    </div>
  );
}

function DueList({
  empty = "Nothing due today.",
  rows,
  title,
}: {
  empty?: string;
  rows: Array<PaymentReminder | CollectionReminder>;
  title: string;
}) {
  return (
    <div className="panel">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <div className="mini-list">
          {rows.map((row) => (
            <div className="mini-row" key={row.id}>
              <div>
                <strong>{row.title}</strong>
                <p>{row.due_date}</p>
              </div>
              <span>{currency.format(toNumber(row.amount))}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SalaryBondsView({
  employees,
  onChange,
  onQueueOfflineMutation,
  setNotice,
  userId,
}: {
  employees: Employee[];
  onChange: () => Promise<void>;
  onQueueOfflineMutation: QueueOfflineMutation;
  setNotice: (notice: Notice) => void;
  userId: string;
}) {
  const [bondForm, setBondForm] = useState<SalaryBondFormValues>(emptySalaryBond);
  const selectedEmployee = employees.find((item) => item.id === bondForm.employee_id);
  const amount = toNumber(bondForm.amount);
  const deductionPerPayroll = toNumber(bondForm.deduction_per_payroll);
  const estimatedDeductions = deductionPerPayroll > 0 ? Math.ceil(amount / deductionPerPayroll) : 0;
  const remainingAfterPayoff = Math.max(0, amount - estimatedDeductions * deductionPerPayroll);
  const estimatedPayoffDate = (() => {
    if (!bondForm.start_deduction || estimatedDeductions === 0) return "Not available";
    const date = new Date(`${bondForm.start_deduction}T00:00:00`);
    date.setDate(date.getDate() + Math.max(0, estimatedDeductions - 1) * 15);
    return date.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
  })();
  const displayDateGranted = bondForm.date_granted
    ? new Date(`${bondForm.date_granted}T00:00:00`).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })
    : "Not set";
  const displayStartDeduction = bondForm.start_deduction
    ? new Date(`${bondForm.start_deduction}T00:00:00`).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })
    : "Not set";

  async function saveSalaryBond(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    if (!selectedEmployee) {
      setNotice({ type: "error", text: "Select an employee for the salary bond." });
      return;
    }

    const balance = bondForm.balance ? toNumber(bondForm.balance) : amount;
    const generatedBondId = `SB-${Date.now().toString(36).toUpperCase()}`;
    const payload = {
      user_id: userId,
      employee_id: selectedEmployee.id,
      employee_name: selectedEmployee.full_name,
      bond_id: generatedBondId,
      bond_type: bondForm.bond_type,
      date_granted: bondForm.date_granted,
      start_deduction: bondForm.start_deduction,
      purpose: bondForm.purpose.trim(),
      amount,
      balance,
      deduction_per_payroll: deductionPerPayroll,
      status: bondForm.status,
      notes: bondForm.notes.trim(),
    };
    if (!navigator.onLine) {
      await onQueueOfflineMutation({
        resource: "salaryBonds",
        affectedResources: ["salaryBonds", "dashboardSummary"],
        operation: "insert",
        table: "salary_bonds",
        payload,
      });
      setBondForm(emptySalaryBond);
      await onChange();
      return;
    }

    const result = await supabase.from("salary_bonds").insert(payload);

    if (result.error) {
      if (isOfflineLikeError(result.error)) {
        await onQueueOfflineMutation({
          resource: "salaryBonds",
          affectedResources: ["salaryBonds", "dashboardSummary"],
          operation: "insert",
          table: "salary_bonds",
          payload,
        });
        setBondForm(emptySalaryBond);
        await onChange();
        return;
      }
      setNotice({ type: "error", text: friendlyError(result.error) });
      return;
    }

    setBondForm(emptySalaryBond);
    setNotice({ type: "success", text: "Salary bond saved." });
    await onChange();
  }

  return (
    <div className="salary-bond-create-page">
      <div className="salary-bond-breadcrumb">
        <span>Salary Bonds</span>
        <ChevronDown size={14} />
        <strong>New Salary Bond</strong>
      </div>
      <PageHeader
        eyebrow=""
        title="Add Salary Bond"
        text="Create a salary bond or advance for an employee."
      />

      <div className="salary-bond-create-layout">
        <section className="salary-bond-create-card">
          <form className="salary-bond-create-form" onSubmit={saveSalaryBond}>
            <label>
              Employee <span>*</span>
              <select
                required
                value={bondForm.employee_id}
                onChange={(event) => setBondForm({ ...bondForm, employee_id: event.target.value })}
              >
                <option value="">Search Employee</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>{employee.full_name}</option>
                ))}
              </select>
            </label>
            <label>
              Bond Type <span>*</span>
              <select value={bondForm.bond_type} onChange={(event) => setBondForm({ ...bondForm, bond_type: event.target.value })}>
                <option value="Salary Advance">Salary Advance</option>
                <option value="Emergency Loan">Emergency Loan</option>
                <option value="Equipment Bond">Equipment Bond</option>
                <option value="Other">Other</option>
              </select>
            </label>

            {selectedEmployee && (
              <div className="salary-bond-selected-employee">
                <div className="avatar">{selectedEmployee.full_name.slice(0, 1).toUpperCase()}</div>
                <div>
                  <strong>{selectedEmployee.full_name}</strong>
                  <span>EMP-{selectedEmployee.created_at?.slice(0, 4) || "2024"}-0001 - {selectedEmployee.role || "Employee"}</span>
                </div>
                <button aria-label="Clear employee" onClick={() => setBondForm({ ...bondForm, employee_id: "" })} type="button">
                  <X size={15} />
                </button>
              </div>
            )}

            <label>
              Date Granted <span>*</span>
              <input required type="date" value={bondForm.date_granted} onChange={(event) => setBondForm({ ...bondForm, date_granted: event.target.value })} />
            </label>
            <label>
              Amount <span>*</span>
              <input min="0" required type="number" value={bondForm.amount} onChange={(event) => setBondForm({ ...bondForm, amount: event.target.value, balance: event.target.value })} />
            </label>
            <label>
              Deduction Per Payroll <span>*</span>
              <input min="0" required type="number" value={bondForm.deduction_per_payroll} onChange={(event) => setBondForm({ ...bondForm, deduction_per_payroll: event.target.value })} />
              <small>This amount will be deducted in every payroll run.</small>
            </label>
            <label>
              Start Deduction <span>*</span>
              <input required type="date" value={bondForm.start_deduction} onChange={(event) => setBondForm({ ...bondForm, start_deduction: event.target.value })} />
              <small>The deduction will start on this date.</small>
            </label>
            <label className="salary-bond-form-wide">
              Purpose
              <input value={bondForm.purpose} onChange={(event) => setBondForm({ ...bondForm, purpose: event.target.value })} />
            </label>
            <label className="salary-bond-form-wide">
              Notes <small>(Optional)</small>
              <textarea placeholder="Enter any additional notes..." value={bondForm.notes} onChange={(event) => setBondForm({ ...bondForm, notes: event.target.value })} />
              <small>Optional notes about this bond.</small>
            </label>
            <div className="salary-bond-form-actions">
              <button className="secondary-button compact" onClick={() => setBondForm(emptySalaryBond)} type="button">
                Cancel
              </button>
              <button className="primary-button compact" type="submit">
                <Save size={16} />
                Save Bond
              </button>
            </div>
          </form>
        </section>

        <aside className="salary-bond-summary-card">
          <h2>Bond Summary</h2>
          <div className="salary-bond-active-banner">
            <CreditCard size={22} />
            <span>This bond will be active once saved.</span>
            <StatusPill status="active" />
          </div>
          <div className="salary-bond-summary-list">
            <div><span>Employee</span><strong>{selectedEmployee?.full_name || "Not selected"}</strong></div>
            <div><span>Bond Type</span><strong>{bondForm.bond_type}</strong></div>
            <div><span>Date Granted</span><strong>{displayDateGranted}</strong></div>
            <div><span>Amount Granted</span><strong>{currency.format(amount)}</strong></div>
            <div><span>Deduction Per Payroll</span><strong>{currency.format(deductionPerPayroll)}</strong></div>
            <div><span>Start Deduction</span><strong>{displayStartDeduction}</strong></div>
          </div>
          <div className="salary-bond-estimate-card">
            <strong>Estimated Summary</strong>
            <div><span>Estimated Number of Deductions</span><b>{estimatedDeductions} payroll(s)</b></div>
            <div><span>Estimated Payoff Date</span><b>{estimatedPayoffDate}</b></div>
            <div><span>Total Deduction</span><b>{currency.format(estimatedDeductions * deductionPerPayroll)}</b></div>
            <div><span>Remaining Balance After Payoff</span><b>{currency.format(remainingAfterPayoff)}</b></div>
          </div>
          <div className="salary-bond-warning">
            The actual payoff date may vary depending on the payroll schedule and any additional payments.
          </div>
        </aside>
      </div>
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
  const repairEarnings = repairTickets * NEW_EMPLOYEE_REPAIR_RATE;
  const installationEarnings = installationTickets * INSTALLATION_RATE;
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
              <strong>{currency.format(NEW_EMPLOYEE_REPAIR_RATE)}</strong>
            </div>
            <div>
              <span className="ticket-chip installation"><Briefcase size={15} /> Installation</span>
              <strong>{currency.format(INSTALLATION_RATE)}</strong>
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
              rate={NEW_EMPLOYEE_REPAIR_RATE}
              tickets={repairTickets}
              tone="repair"
              type="Repair"
            />
            <EarningsBreakdown
              earnings={installationEarnings}
              rate={INSTALLATION_RATE}
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
  setNotice,
  userId,
}: {
  employees: Employee[];
  onChange: () => Promise<void>;
  onLocalPositionsChange: (positions: Position[]) => void;
  onQueueOfflineMutation: QueueOfflineMutation;
  positions: Position[];
  setNotice: (notice: Notice) => void;
  userId: string;
}) {
  const [editing, setEditing] = useState<Position | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Position | null>(null);
  const [query, setQuery] = useState("");
  const rows = positions.filter((position) =>
    `${position.name} ${position.department} ${position.pay_mode}`.toLowerCase().includes(query.toLowerCase())
  );

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
        display_order: index,
        status: category.status,
      }))
      .filter((category) => category.name);
    if (!values.name.trim()) {
      setNotice({ type: "error", text: "Position name is required." });
      return;
    }
    if (needsTickets && categories.filter((category) => category.status === "active").length === 0) {
      setNotice({ type: "error", text: "Ticket and hybrid positions need at least one active ticket category." });
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
      setNotice({ type: "error", text: friendlyError(positionResult.error) });
      return;
    }
    if (categoryPayloads.length > 0) {
      const categoryResult = await supabase.from("position_ticket_categories").upsert(categoryPayloads, { onConflict: "id" });
      if (categoryResult.error) {
        setNotice({ type: "error", text: friendlyError(categoryResult.error) });
        return;
      }
    }
    if (removedCategories.length > 0) {
      const archiveResult = await supabase
        .from("position_ticket_categories")
        .update({ status: "archived" })
        .in("id", removedCategories.map((category) => category.id));
      if (archiveResult.error) {
        setNotice({ type: "error", text: friendlyError(archiveResult.error) });
        return;
      }
    }
    setNotice({ type: "success", text: "Position saved." });
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
      setNotice({ type: "error", text: `Reassign ${assignedActiveEmployees} active employee${assignedActiveEmployees === 1 ? "" : "s"} before archiving this position.` });
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
    setNotice(error ? { type: "error", text: friendlyError(error) } : { type: "success", text: `Position ${status}.` });
    if (!error) await onChange();
  }

  async function deletePosition(position: Position) {
    if (!supabase) return;
    const assignedEmployees = employees.filter((e) => e.position_id === position.id).length;
    if (assignedEmployees > 0) {
      setNotice({ type: "error", text: `Cannot delete "${position.name}" — ${assignedEmployees} employee${assignedEmployees === 1 ? " is" : "s are"} still assigned. Reassign them first.` });
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
      setNotice({ type: "error", text: friendlyError(catResult.error) });
      return;
    }
    const { error } = await supabase.from("positions").delete().eq("id", position.id);
    if (error) {
      setNotice({ type: "error", text: friendlyError(error) });
      return;
    }
    setNotice({ type: "success", text: `"${position.name}" deleted.` });
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
            <button aria-label="Delete position" className="delete-action" onClick={() => setConfirmDelete(position)} title="Delete" type="button"><Trash2 size={16} /></button>
          </div>,
        ])}
      />
      {formOpen && <PositionForm initial={editing} onClose={() => { setFormOpen(false); setEditing(null); }} onSubmit={savePosition} />}
      {confirmDelete && (
        <div className="modal-backdrop" role="presentation">
          <section aria-label="Delete position" aria-modal="true" className="modal confirm-modal" role="dialog">
            <div className="confirm-icon-wrap danger">
              <Trash2 size={24} />
            </div>
            <h2>Delete position</h2>
            <p>Are you sure you want to permanently delete <strong>{confirmDelete.name}</strong>? This action cannot be undone.</p>
            {employees.filter((e) => e.position_id === confirmDelete.id).length > 0 && (
              <div className="confirm-warning">
                <span>{employees.filter((e) => e.position_id === confirmDelete.id).length} employee{employees.filter((e) => e.position_id === confirmDelete.id).length === 1 ? "" : "s"} assigned — reassign before deleting.</span>
              </div>
            )}
            <div className="confirm-actions">
              <button className="secondary-button" onClick={() => setConfirmDelete(null)} type="button">Cancel</button>
              <button
                className="primary-button danger-button"
                disabled={employees.filter((e) => e.position_id === confirmDelete.id).length > 0}
                onClick={async () => {
                  await deletePosition(confirmDelete);
                  setConfirmDelete(null);
                }}
                type="button"
              >
                <Trash2 size={15} />
                Delete
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function PositionForm({
  initial,
  onClose,
  onSubmit,
}: {
  initial: Position | null;
  onClose: () => void;
  onSubmit: (values: PositionFormValues) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState<PositionFormValues>(initial ? {
    name: initial.name,
    department: initial.department,
    description: initial.description,
    status: initial.status,
    pay_mode: initial.pay_mode,
    monthly_base_salary: String(initial.monthly_base_salary),
    daily_rate: String(initial.daily_rate ?? 0),
    categories: initial.categories.map((category) => ({ id: category.id, name: category.name, rate: String(category.rate), status: category.status })),
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

  return (
    <Modal title={initial ? "Edit position" : "Add position"} onClose={onClose}>
      <form className="form-grid" onSubmit={async (event) => { event.preventDefault(); setBusy(true); await onSubmit(values); setBusy(false); }}>
        <TextField label="Position name" value={values.name} onChange={(name) => setValues({ ...values, name })} required />
        <TextField label="Department" value={values.department} onChange={(department) => setValues({ ...values, department })} />
        <label>
          Pay method
          <select value={values.pay_mode} onChange={(event) => setValues({ ...values, pay_mode: event.target.value as PositionFormValues["pay_mode"] })}>
            <option value="fixed">Fixed salary</option>
            <option value="ticket">Per closed ticket</option>
            <option value="hybrid">Base salary + tickets</option>
            <option value="daily">Daily wage</option>
          </select>
        </label>
        {(values.pay_mode === "fixed" || values.pay_mode === "hybrid") && <TextField label="Monthly base salary" min="0" step="0.01" type="number" value={values.monthly_base_salary} onChange={(monthly_base_salary) => setValues({ ...values, monthly_base_salary })} required />}
        {values.pay_mode === "daily" && <TextField label="Daily rate" min="0" step="0.01" type="number" value={values.daily_rate} onChange={(daily_rate) => setValues({ ...values, daily_rate })} required />}
        <label className="full">
          Description
          <textarea rows={3} value={values.description} onChange={(event) => setValues({ ...values, description: event.target.value })} />
        </label>
        {usesTickets && (
          <section className="full stack">
            <div className="section-heading"><div><p className="eyebrow">Ticket compensation</p><h3>Closed-ticket categories</h3></div><button className="secondary-button compact" onClick={() => setValues({ ...values, categories: [...values.categories, { name: "", rate: "", status: "active" }] })} type="button"><Plus size={15} /> Add category</button></div>
            {values.categories.map((category, index) => (
              <div className="inline-fields" key={category.id ?? index}>
                <input aria-label="Category name" placeholder="Category name" value={category.name} onChange={(event) => setValues({ ...values, categories: values.categories.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} />
                <input aria-label="Rate" min="0" placeholder="Rate" step="0.01" type="number" value={category.rate} onChange={(event) => setValues({ ...values, categories: values.categories.map((item, itemIndex) => itemIndex === index ? { ...item, rate: event.target.value } : item) })} />
                <select aria-label="Category status" value={category.status} onChange={(event) => setValues({ ...values, categories: values.categories.map((item, itemIndex) => itemIndex === index ? { ...item, status: event.target.value as PositionFormValues["categories"][number]["status"] } : item) })}><option value="active">Active</option><option value="archived">Archived</option></select>
                <button aria-label="Remove category" onClick={() => setValues({ ...values, categories: values.categories.filter((_, itemIndex) => itemIndex !== index) })} type="button"><Trash2 size={16} /></button>
              </div>
            ))}
          </section>
        )}
        <FormActions busy={busy} onClose={onClose} />
      </form>
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
  positions,
  onChange,
  onQueueOfflineMutation,
  setNotice,
  userId,
}: {
  dailyTicketEntries: DailyTicketEntry[];
  employees: Employee[];
  positions: Position[];
  onChange: () => Promise<void>;
  onQueueOfflineMutation: QueueOfflineMutation;
  setNotice: (notice: Notice) => void;
  userId: string;
}) {
  const [entryDate, setEntryDate] = useState(todayKey());
  const [draftCounts, setDraftCounts] = useState<Record<string, Record<string, number>>>({});
  const [busyEmployeeId, setBusyEmployeeId] = useState("");
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

  async function saveDraft(draft: PositionTicketDraft) {
    if (!supabase) return;
    setBusyEmployeeId(draft.employee.id);
    const entryId = draft.entry?.id ?? crypto.randomUUID();
    const activeCategories = draft.position.categories.filter((category) => category.status === "active");
    const headerPayload = {
      id: entryId,
      user_id: userId,
      entry_date: entryDate,
      employee_id: draft.employee.id,
      employee_name: draft.employee.full_name,
      position_id: draft.position.id,
      position_name: draft.position.name,
      installation_tickets: 0,
      repair_tickets: 0,
      installation_rate: 0,
      repair_rate: 0,
    };
    const detailPayloads = activeCategories.map((category) => {
      const existingDetail = draft.entry?.details?.find((detail) => detail.position_ticket_category_id === category.id);
      return {
      id: existingDetail?.id ?? crypto.randomUUID(),
      user_id: userId,
      daily_ticket_entry_id: entryId,
      position_ticket_category_id: category.id,
      category_name: category.name,
      ticket_count: normalizeTicketCount(draft.counts[category.id]),
      rate: toNumber(existingDetail?.rate ?? category.rate),
    };
    });
    const optimisticEntry: DailyTicketEntry = {
      ...headerPayload,
      details: detailPayloads.map((detail) => ({
        ...detail,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })),
      created_at: draft.entry?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

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
      setNotice({ type: "success", text: `${draft.employee.full_name}'s ticket counts were saved locally.` });
      setBusyEmployeeId("");
      return;
    }

    const headerResult = await supabase.from("daily_ticket_entries").upsert(headerPayload, { onConflict: "user_id,entry_date,employee_id" });
    if (headerResult.error) {
      setNotice({ type: "error", text: friendlyError(headerResult.error) });
      setBusyEmployeeId("");
      return;
    }
    const deleteResult = await supabase.from("daily_ticket_entry_items").delete().eq("daily_ticket_entry_id", entryId);
    if (deleteResult.error) {
      setNotice({ type: "error", text: friendlyError(deleteResult.error) });
      setBusyEmployeeId("");
      return;
    }
    if (detailPayloads.length > 0) {
      const detailsResult = await supabase.from("daily_ticket_entry_items").insert(detailPayloads);
      if (detailsResult.error) {
        setNotice({ type: "error", text: friendlyError(detailsResult.error) });
        setBusyEmployeeId("");
        return;
      }
    }
    setNotice({ type: "success", text: `${draft.employee.full_name}'s ticket counts were saved.` });
    setBusyEmployeeId("");
    await onChange();
  }

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Daily operations" title="Daily closed tickets" text="Record category totals using the employee's assigned position and current rates." />
      <section className="panel">
        <label className="date-field">Entry date<input type="date" value={entryDate} onChange={(event) => { setEntryDate(event.target.value); setDraftCounts({}); }} /></label>
      </section>
      {employees.some((employee) => employee.status === "active" && !employee.position_id) && <NoticeBanner notice={{ type: "error", text: "Some active employees have no position and cannot receive ticket entries." }} onDismiss={() => undefined} />}
      <div className="ticket-entry-grid">
        {drafts.map((draft) => {
          const ticketPay = draft.position.categories
            .filter((category) => category.status === "active")
            .reduce((sum, category) => sum + normalizeTicketCount(draft.counts[category.id]) * toNumber(category.rate), 0);
          return (
            <section className="panel stack" key={draft.employee.id}>
              <div className="section-heading">
                <div><p className="eyebrow">{draft.position.name}</p><h3>{draft.employee.full_name}</h3></div>
                <strong>{currency.format(ticketPay)}</strong>
              </div>
              {draft.position.categories.filter((category) => category.status === "active").map((category) => (
                <label key={category.id}>
                  {category.name} · {currency.format(toNumber(category.rate))} per ticket
                  <input min="0" step="1" type="number" value={draft.counts[category.id] ?? 0} onChange={(event) => setDraftCounts((current) => ({ ...current, [draft.employee.id]: { ...(current[draft.employee.id] ?? draft.counts), [category.id]: normalizeTicketCount(event.target.value) } }))} />
                </label>
              ))}
              <button className="primary-button compact" disabled={busyEmployeeId === draft.employee.id} onClick={() => saveDraft(draft)} type="button">
                {busyEmployeeId === draft.employee.id ? <Spinner size="small" /> : <Save size={16} />} {draft.entry ? "Update entry" : "Save entry"}
              </button>
            </section>
          );
        })}
      </div>
      {drafts.length === 0 && <div className="panel"><p className="muted">No active employees currently have a ticket or hybrid position.</p></div>}
    </div>
  );
}

function LegacyDailyTicketEntryView({
  dailyTicketEntries,
  employees,
  onChange,
  onQueueOfflineMutation,
  setNotice,
  userId,
}: {
  dailyTicketEntries: DailyTicketEntry[];
  employees: Employee[];
  onChange: () => Promise<void>;
  onQueueOfflineMutation: QueueOfflineMutation;
  setNotice: (notice: Notice) => void;
  userId: string;
}) {
  const activeEmployees = employees.filter((employee) => employee.status === "active");
  const sourceEmployees = activeEmployees.length > 0 ? activeEmployees : employees;
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [department, setDepartment] = useState("all");
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [ticketDrafts, setTicketDrafts] = useState<Record<string, { installation: number; repair: number }>>({});
  const [pendingTicketEdits, setPendingTicketEdits] = useState<Record<string, boolean>>({});
  const [localSavedTickets, setLocalSavedTickets] = useState<Record<string, { entryDate: string; installation: number; repair: number }>>({});
  const departments = Array.from(new Set(sourceEmployees.map((employee) => employee.department).filter(Boolean))).sort();

  const rows: DailyTicketDraft[] = sourceEmployees
    .filter((employee) => department === "all" || employee.department === department)
    .filter((employee) => `${employee.full_name} ${employee.role} ${employee.department}`.toLowerCase().includes(employeeQuery.toLowerCase()))
    .map((employee, index) => {
      const savedEntry = dailyTicketEntries.find((entry) => entry.entry_date === selectedDate && entry.employee_id === employee.id);
      const localSaved = localSavedTickets[employee.id]?.entryDate === selectedDate ? localSavedTickets[employee.id] : undefined;
      const savedValues = savedEntry
        ? {
            installation: normalizeTicketCount(savedEntry.installation_tickets),
            repair: normalizeTicketCount(savedEntry.repair_tickets),
          }
        : localSaved
          ? {
              installation: normalizeTicketCount(localSaved.installation),
              repair: normalizeTicketCount(localSaved.repair),
            }
          : undefined;
      const draft = ticketDrafts[employee.id] ?? savedValues ?? { repair: 0, installation: 0 };
      const installation = normalizeTicketCount(draft.installation);
      const repair = normalizeTicketCount(draft.repair);
      const isPendingEdit = Boolean(pendingTicketEdits[employee.id]);

      return {
        employee,
        employeeCode: `EMP-${new Date(employee.created_at || selectedDate).getFullYear()}-${String(index + 12).padStart(4, "0")}`,
        installation,
        repair,
        savedValues,
        status: savedValues &&
            !isPendingEdit &&
            installation === savedValues.installation &&
            repair === savedValues.repair
          ? "saved"
          : "pending",
      };
    });
  const totalRepair = rows.reduce((sum, row) => sum + row.repair, 0);
  const totalInstallation = rows.reduce((sum, row) => sum + row.installation, 0);
  const totalClosed = totalRepair + totalInstallation;
  const totalRepairEarnings = rows.reduce(
    (sum, row) => sum + row.repair * employeeRepairRate(row.employee),
    0,
  );
  const totalInstallationEarnings = rows.reduce(
    (sum, row) => sum + row.installation * employeeInstallationRate(row.employee),
    0,
  );
  const totalEarnings = totalRepairEarnings + totalInstallationEarnings;
  const formattedDate = new Date(`${selectedDate}T00:00:00`).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    weekday: "long",
    year: "numeric",
  });
  const recentEntries = useMemo(() => {
    const grouped = dailyTicketEntries.reduce<Record<string, { date: string; repair: number; installation: number; earnings: number; encodedBy: string }>>(
      (current, entry) => {
        const existing = current[entry.entry_date] ?? {
          date: entry.entry_date,
          encodedBy: "Admin User",
          installation: 0,
          repair: 0,
          earnings: 0,
        };

        existing.installation += normalizeTicketCount(entry.installation_tickets);
        existing.repair += normalizeTicketCount(entry.repair_tickets);
        existing.earnings +=
          normalizeTicketCount(entry.repair_tickets) * toNumber(entry.repair_rate) +
          normalizeTicketCount(entry.installation_tickets) * toNumber(entry.installation_rate);
        current[entry.entry_date] = existing;
        return current;
      },
      {},
    );

    return Object.values(grouped)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5);
  }, [dailyTicketEntries]);

  function updateTickets(
    employeeId: string,
    field: "installation" | "repair",
    value: number,
    fallback: { installation: number; repair: number },
  ) {
    setPendingTicketEdits((current) => ({
      ...current,
      [employeeId]: true,
    }));
    setTicketDrafts((current) => ({
      ...current,
      [employeeId]: {
        installation: current[employeeId]?.installation ?? fallback.installation,
        repair: current[employeeId]?.repair ?? fallback.repair,
        [field]: normalizeTicketCount(value),
      },
    }));
  }

  async function saveDailyTickets() {
    if (!supabase) return;
    if (rows.length === 0) {
      setNotice({ type: "error", text: "No employees match this daily ticket entry." });
      return;
    }

    const payload = rows.map((row) => {
      const repairRate = employeeRepairRate(row.employee);
      const installationRate = employeeInstallationRate(row.employee);

      return {
        user_id: userId,
        entry_date: selectedDate,
        employee_id: row.employee.id,
        employee_name: row.employee.full_name,
        installation_tickets: row.installation,
        repair_tickets: row.repair,
        installation_rate: installationRate,
        repair_rate: repairRate,
      };
    });
    if (!navigator.onLine) {
      await onQueueOfflineMutation({
        resource: "dailyTicketEntries",
        affectedResources: ["dailyTicketEntries", "dashboardSummary"],
        operation: "upsert",
        table: "daily_ticket_entries",
        payload,
        options: { onConflict: "user_id,entry_date,employee_id" },
      });
      setLocalSavedTickets((current) => {
        const next = { ...current };
        rows.forEach((row) => {
          next[row.employee.id] = {
            entryDate: selectedDate,
            installation: row.installation,
            repair: row.repair,
          };
        });
        return next;
      });
      setPendingTicketEdits((current) => {
        const next = { ...current };
        rows.forEach((row) => {
          next[row.employee.id] = false;
        });
        return next;
      });
      setTicketDrafts({});
      return;
    }

    const { error } = await supabase
      .from("daily_ticket_entries")
      .upsert(payload, { onConflict: "user_id,entry_date,employee_id" });

    if (error) {
      if (isOfflineLikeError(error)) {
        await onQueueOfflineMutation({
          resource: "dailyTicketEntries",
          affectedResources: ["dailyTicketEntries", "dashboardSummary"],
          operation: "upsert",
          table: "daily_ticket_entries",
          payload,
          options: { onConflict: "user_id,entry_date,employee_id" },
        });
        return;
      }
      setNotice({ type: "error", text: friendlyError(error) });
      return;
    }

    setNotice({ type: "success", text: "Daily tickets saved and ready for payroll." });
    setLocalSavedTickets((current) => {
      const next = { ...current };
      rows.forEach((row) => {
        next[row.employee.id] = {
          entryDate: selectedDate,
          installation: row.installation,
          repair: row.repair,
        };
      });
      return next;
    });
    setPendingTicketEdits((current) => {
      const next = { ...current };
      rows.forEach((row) => {
        next[row.employee.id] = false;
      });
      return next;
    });
    setTicketDrafts({});
    await onChange();
  }

  async function saveTicketRow(row: DailyTicketDraft) {
    if (!supabase) return;
    const repairRate = employeeRepairRate(row.employee);
    const installationRate = employeeInstallationRate(row.employee);
    const payload = {
      user_id: userId,
      entry_date: selectedDate,
      employee_id: row.employee.id,
      employee_name: row.employee.full_name,
      installation_tickets: row.installation,
      repair_tickets: row.repair,
      installation_rate: installationRate,
      repair_rate: repairRate,
    };
    if (!navigator.onLine) {
      await onQueueOfflineMutation({
        resource: "dailyTicketEntries",
        affectedResources: ["dailyTicketEntries", "dashboardSummary"],
        operation: "upsert",
        table: "daily_ticket_entries",
        payload,
        options: { onConflict: "user_id,entry_date,employee_id" },
      });
      setLocalSavedTickets((current) => ({
        ...current,
        [row.employee.id]: {
          entryDate: selectedDate,
          installation: row.installation,
          repair: row.repair,
        },
      }));
      setPendingTicketEdits((current) => ({
        ...current,
        [row.employee.id]: false,
      }));
      return;
    }

    const { error } = await supabase
      .from("daily_ticket_entries")
      .upsert(payload, { onConflict: "user_id,entry_date,employee_id" });

    if (error) {
      if (isOfflineLikeError(error)) {
        await onQueueOfflineMutation({
          resource: "dailyTicketEntries",
          affectedResources: ["dailyTicketEntries", "dashboardSummary"],
          operation: "upsert",
          table: "daily_ticket_entries",
          payload,
          options: { onConflict: "user_id,entry_date,employee_id" },
        });
        return;
      }
      setNotice({ type: "error", text: friendlyError(error) });
      return;
    }

    setLocalSavedTickets((current) => ({
      ...current,
      [row.employee.id]: {
        entryDate: selectedDate,
        installation: row.installation,
        repair: row.repair,
      },
    }));
    setPendingTicketEdits((current) => ({
      ...current,
      [row.employee.id]: false,
    }));
    setNotice({ type: "success", text: `${row.employee.full_name}'s ticket entry saved.` });
    await onChange();
  }

  function editTicketRow(row: DailyTicketDraft) {
    setTicketDrafts((current) => ({
      ...current,
      [row.employee.id]: {
        installation: row.installation,
        repair: row.repair,
      },
    }));
    setPendingTicketEdits((current) => ({
      ...current,
      [row.employee.id]: true,
    }));
    setNotice({
      type: "success",
      text: `${row.employee.full_name}'s ticket entry is ready to edit.`,
    });
  }

  return (
    <div className="daily-ticket-page">
      <PageHeader
        action={
          <div className="page-actions">
            <button className="secondary-button compact" type="button">
              <Upload size={16} />
              Import from Excel
            </button>
            <button
              className="primary-button compact"
              onClick={saveDailyTickets}
              type="button"
            >
              <CalendarClock size={16} />
              Save Daily Tickets
            </button>
          </div>
        }
        eyebrow="Closed-ticket payroll"
        title="Daily Ticket Entry"
        text="Enter the number of closed tickets for each employee for the selected date."
      />

      <section className="daily-ticket-filters">
        <label>
          Date
          <input value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} type="date" />
        </label>
        <label>
          Department
          <select value={department} onChange={(event) => setDepartment(event.target.value)}>
            <option value="all">All Departments</option>
            {departments.map((departmentName) => (
              <option key={departmentName} value={departmentName}>{departmentName}</option>
            ))}
          </select>
        </label>
        <label>
          Search Employee
          <div className="field-with-icon">
            <input placeholder="Search employee..." value={employeeQuery} onChange={(event) => setEmployeeQuery(event.target.value)} />
            <Search size={17} />
          </div>
        </label>
      </section>

      <div className="daily-ticket-layout">
        <section className="daily-ticket-card daily-ticket-entry-card">
          <h2>Enter Closed Tickets</h2>
          <div className="daily-ticket-table">
            <div className="daily-ticket-row daily-ticket-head">
              <span>Employee</span>
              <span><Wrench size={18} /> Repair <small>Closed Tickets (employee rate)</small></span>
              <span><Settings size={18} /> Installation <small>Closed Tickets (employee rate)</small></span>
              <span>Total Closed Tickets <small>(Auto)</small></span>
              <span>Daily Earnings <small>(Auto)</small></span>
              <span>Status</span>
              <span>Action</span>
            </div>
            {rows.map((row) => {
              const initials = row.employee.full_name
                .split(" ")
                .filter(Boolean)
                .slice(0, 2)
                .map((part) => part[0])
                .join("")
                .toUpperCase() || "E";
              const total = row.repair + row.installation;
              const repairRate = employeeRepairRate(row.employee);
              const installationRate = employeeInstallationRate(row.employee);
              const earnings = row.repair * repairRate + row.installation * installationRate;

              return (
                <div className="daily-ticket-row" key={row.employee.id}>
                  <div className="daily-ticket-employee">
                    <div className="daily-ticket-avatar">
                      {row.employee.profile_photo_url ? <img alt="" src={row.employee.profile_photo_url} /> : <span>{initials}</span>}
                    </div>
                    <div>
                      <strong>{row.employee.full_name}</strong>
                      <span>{row.employeeCode}</span>
                    </div>
                  </div>
                  <input
                    disabled={row.status === "saved"}
                    min="0"
                    onChange={(event) => updateTickets(row.employee.id, "repair", Number(event.target.value), row)}
                    type="number"
                    value={row.repair}
                  />
                  <input
                    disabled={row.status === "saved"}
                    min="0"
                    onChange={(event) => updateTickets(row.employee.id, "installation", Number(event.target.value), row)}
                    type="number"
                    value={row.installation}
                  />
                  <strong>{total}</strong>
                  <strong className="daily-ticket-money">{currency.format(earnings)}</strong>
                  <span className={`status ${row.status}`}>{row.status}</span>
                  <button
                    aria-label={`${row.status === "saved" ? "Edit" : "Save"} ${row.employee.full_name} ticket entry`}
                    className="daily-ticket-more"
                    onClick={() => row.status === "saved" ? editTicketRow(row) : saveTicketRow(row)}
                    title={row.status === "saved" ? "Edit ticket entry" : "Save ticket entry"}
                    type="button"
                  >
                    {row.status === "saved" ? <Pencil size={16} /> : <Save size={17} />}
                  </button>
                </div>
              );
            })}
            <div className="daily-ticket-row daily-ticket-total">
              <strong>Total</strong>
              <strong>{totalRepair}</strong>
              <strong>{totalInstallation}</strong>
              <strong>{totalClosed}</strong>
              <strong>{currency.format(totalEarnings)}</strong>
              <span />
              <span />
            </div>
          </div>
          <div className="daily-ticket-note">
            <CheckCircle2 size={16} />
            Only closed tickets are included in the payroll computation.
          </div>
        </section>

        <aside className="daily-summary-panel">
          <section className="daily-ticket-card">
            <h2>Daily Summary</h2>
            <p>{formattedDate}</p>
            <DailySummaryMetric
              earnings={totalRepairEarnings}
              icon={<Wrench size={18} />}
              label="Repair Tickets Closed"
              rateLabel="By employee wage category"
              tone="repair"
              value={totalRepair}
            />
            <DailySummaryMetric
              earnings={totalInstallationEarnings}
              icon={<Settings size={18} />}
              label="Installation Tickets Closed"
              rate={INSTALLATION_RATE}
              tone="installation"
              value={totalInstallation}
            />
            <div className="daily-total-card">
              <span>Total Closed Tickets</span>
              <strong>{totalClosed}</strong>
              <span>Total Earnings</span>
              <strong>{currency.format(totalEarnings)}</strong>
            </div>
          </section>
          <section className="daily-help-card">
            <CheckCircle2 size={17} />
            <div>
              <strong>How it works</strong>
              <p>Enter closed tickets per employee for each service type. Earnings are automatically computed based on the rates.</p>
            </div>
          </section>
        </aside>
      </div>

      <section className="daily-ticket-card">
        <h2>Recent Daily Entries</h2>
        <DataTable
          empty="No recent daily entries."
          headers={["Date", "Total Repair Tickets", "Total Installation Tickets", "Total Closed Tickets", "Total Earnings", "Encoded By", "Actions"]}
          rows={recentEntries.map((entry) => {
            const total = entry.repair + entry.installation;
            const displayDate = new Date(`${entry.date}T00:00:00`).toLocaleDateString("en-US", {
              day: "numeric",
              month: "short",
              weekday: "short",
              year: "numeric",
            });

            return [
              displayDate,
              entry.repair,
              entry.installation,
              total,
              currency.format(entry.earnings),
              entry.encodedBy,
              <button className="secondary-button compact" key="view" type="button"><Eye size={15} /> View</button>,
            ];
          })}
        />
        <div className="daily-ticket-footer">
          <button className="secondary-button compact" type="button">
            <FileText size={16} />
            View All Daily Entries
            <ChevronDown size={15} />
          </button>
        </div>
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
  mode = "list",
  onChange,
  onExitForm,
  onLocalEmployeesChange,
  onQueueOfflineMutation,
  payrollRuns,
  positions,
  salaryBonds,
  setNotice,
  userId,
}: {
  employees: Employee[];
  mode?: "list" | "add";
  onChange: () => Promise<void>;
  onExitForm?: () => void;
  onLocalEmployeesChange: (employees: Employee[]) => void;
  onQueueOfflineMutation: QueueOfflineMutation;
  payrollRuns: PayrollRunWithItems[];
  positions: Position[];
  salaryBonds: SalaryBond[];
  setNotice: (notice: Notice) => void;
  userId: string;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [editing, setEditing] = useState<Employee | null>(null);
  const [formOpen, setFormOpen] = useState(mode === "add");
  const [detailsEmployee, setDetailsEmployee] = useState<Employee | null>(null);

  useEffect(() => {
    if (mode === "add") {
      setEditing(null);
      setFormOpen(true);
    }
  }, [mode]);

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

  if (detailsEmployee) {
    return (
      <EmployeeDetailsView
        employee={detailsEmployee}
        onChange={onChange}
        onBack={() => setDetailsEmployee(null)}
        onEmployeeUpdate={setDetailsEmployee}
        onQueueOfflineMutation={onQueueOfflineMutation}
        payrollRuns={payrollRuns}
        positions={positions}
        salaryBonds={salaryBonds}
        setNotice={setNotice}
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
      setNotice({ type: "error", text: "Select an active position before saving this employee." });
      return;
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
      monthly_salary: toNumber(values.monthly_salary),
      sss_number: values.sss_number.trim(),
      philhealth_number: values.philhealth_number.trim(),
      pagibig_number: values.pagibig_number.trim(),
      tin_number: values.tin_number.trim(),
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
      setNotice({ type: "success", text: "Employee saved locally. It will sync when online." });
      closeForm();
      return;
    }

    const result = editing
      ? await supabase.from("employees").update(payload).eq("id", editing.id)
      : await supabase.from("employees").insert(payload);

    if (result.error) {
      if (isOfflineLikeError(result.error)) {
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
        closeForm();
        return;
      }
      setNotice({ type: "error", text: friendlyError(result.error) });
      return;
    }
    setNotice({ type: "success", text: "Employee saved." });
    closeForm();
    await onChange();
  }

  return (
    <div className="page-stack">
      <PageHeader
        action={
          <button className="primary-button compact" onClick={() => { setEditing(null); setFormOpen(true); }} type="button">
            <Plus size={16} />
            Add employee
          </button>
        }
        eyebrow="HR profiles"
        title="Employees"
        text="Maintain active staff profiles and ticket wage settings."
      />
      <Toolbar query={query} setQuery={setQuery}>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
          <option value="all">All employees</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </Toolbar>
      <DataTable
        empty="No employees yet."
        headers={["Employee", "Department", "Position", "Status"]}
        onRowClick={(index) => setDetailsEmployee(rows[index])}
        rows={rows.map((employee) => [
          <RecordTitle key="title" title={employee.full_name} notes={employee.email || "No email"} />,
          employee.department || "Unassigned",
          employee.role || "Unassigned",
          <StatusPill key="status" status={employee.status} />,
        ])}
      />
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
  onEmployeeUpdate,
  onQueueOfflineMutation,
  payrollRuns,
  positions,
  salaryBonds,
  setNotice,
}: {
  employee: Employee;
  onChange: () => Promise<void>;
  onBack: () => void;
  onEmployeeUpdate: (employee: Employee) => void;
  onQueueOfflineMutation: QueueOfflineMutation;
  payrollRuns: PayrollRunWithItems[];
  positions: Position[];
  salaryBonds: SalaryBond[];
  setNotice: (notice: Notice) => void;
}) {
  const [activeTab, setActiveTab] = useState<"information" | "payroll" | "tickets" | "salary-bond" | "payments" | "documents">("tickets");
  const [currentEmployee, setCurrentEmployee] = useState(employee);
  const [employeePayrollRuns, setEmployeePayrollRuns] = useState<PayrollRunWithItems[]>([]);
  const [editingRate, setEditingRate] = useState<"installation" | "repair" | null>(null);
  const [rateDrafts, setRateDrafts] = useState({ installation: "", repair: "" });

  useEffect(() => {
    setCurrentEmployee(employee);
  }, [employee]);

  useEffect(() => {
    setRateDrafts({
      installation: String(employeeInstallationRate(currentEmployee)),
      repair: String(employeeRepairRate(currentEmployee)),
    });
  }, [currentEmployee]);

  useEffect(() => {
    if (!supabase) return;

    loadEmployeePayrollRuns(supabase, currentEmployee.id).then((result) => {
      if (result.error) {
        setNotice({ type: "error", text: friendlyError(result.error) });
        return;
      }
      setEmployeePayrollRuns(result.data);
    });
  }, [currentEmployee.id]);

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
      setNotice({ type: "error", text: friendlyError(error) });
      return;
    }

    const nextEmployee = data as Employee;
    setCurrentEmployee(nextEmployee);
    onEmployeeUpdate(nextEmployee);
    setEditingRate(null);
    setNotice({ type: "success", text: `${type === "installation" ? "Installation" : "Repair"} ticket wage saved.` });
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
  const repairRate = employeeRepairRate(currentEmployee);
  const installationRate = employeeInstallationRate(currentEmployee);
  const repairEarnings = ticketTotals.repair * repairRate;
  const installationEarnings = ticketTotals.installation * installationRate;
  const totalTicketEarnings = repairEarnings + installationEarnings;
  const closedTickets = ticketTotals.repair + ticketTotals.installation;
  const employeeSalaryBonds = salaryBonds
    .filter((bond) => bond.employee_id === currentEmployee.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const tabs = [
    { id: "information", icon: <Users size={16} />, label: "Information" },
    { id: "payroll", icon: <Briefcase size={16} />, label: "Payroll" },
    { id: "tickets", icon: <BadgeDollarSign size={16} />, label: "Tickets" },
    { id: "salary-bond", icon: <CreditCard size={16} />, label: "Salary Bond" },
    { id: "payments", icon: <CreditCard size={16} />, label: "Payments" },
    { id: "documents", icon: <FileText size={16} />, label: "Documents" },
  ] as const;
  const initials = currentEmployee.full_name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "E";
  const currentPosition = positions.find((position) => position.id === currentEmployee.position_id);

  return (
    <div className="page-stack employee-details-page">
      <div className="employee-details">
        <section className="employee-detail-hero">
          <div className="employee-detail-profile">
            <div className="employee-detail-avatar">
              {currentEmployee.profile_photo_url ? (
                <img alt={`${currentEmployee.full_name} profile`} src={currentEmployee.profile_photo_url} />
              ) : (
                <span>{initials}</span>
              )}
            </div>
            <div>
              <div className="employee-detail-name">
                <h2>{currentEmployee.full_name}</h2>
                <StatusPill status={currentEmployee.status} />
              </div>
              <p>
                <Users size={14} />
                {currentEmployee.role || "Unassigned"}
                <span />
                <FileText size={14} />
                {currentEmployee.email || "No email"}
              </p>
            </div>
          </div>
          <div className="employee-detail-actions">
            <button className="secondary-button compact" onClick={onBack} type="button">
              <ArrowLeft size={15} />
              Back to Employee
            </button>
            <button className="primary-button compact" type="button">
              <Save size={15} />
              Save Changes
            </button>
          </div>
        </section>

        <div className="employee-detail-tabs" role="tablist" aria-label="Employee details sections">
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

        {activeTab === "information" && (
          <section className="employee-detail-card">
            <h3>Employee Information</h3>
            <div className="details-grid">
              <DetailItem label="Position" value={currentEmployee.role || "Unassigned"} />
              <DetailItem label="Department" value={currentEmployee.department || "Unassigned"} />
              <DetailItem label="Status" value={<StatusPill status={currentEmployee.status} />} />
              <DetailItem label="Email" value={currentEmployee.email || "No email"} />
              <DetailItem label="Contact number" value={currentEmployee.contact_number || "Not provided"} />
              <DetailItem label="Hire date" value={currentEmployee.hire_date || "Not provided"} />
              <DetailItem label="Pay method" value={currentPosition?.pay_mode === "fixed" ? "Fixed salary" : currentPosition?.pay_mode === "hybrid" ? "Base + tickets" : currentPosition?.pay_mode === "daily" ? "Daily wage" : "Per ticket"} />
              <DetailItem label="Position monthly base" value={currency.format(toNumber(currentPosition?.monthly_base_salary))} />
              <DetailItem label="Address" value={currentEmployee.address || "Not provided"} />
              <DetailItem label="Notes" value={currentEmployee.notes || "No notes"} />
            </div>
          </section>
        )}

        {activeTab === "payroll" && (
          <section className="employee-detail-card history-stack">
            <h3>Employment Details</h3>
            <section className="history-summary">
              <div>
                <p className="eyebrow">Total net pay</p>
                <strong>{currency.format(totals.net)}</strong>
              </div>
              <div>
                <p className="eyebrow">Paid</p>
                <strong>{currency.format(totals.paid)}</strong>
              </div>
              <div>
                <p className="eyebrow">Pending</p>
                <strong>{currency.format(totals.pending)}</strong>
              </div>
            </section>
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
          <section className="employee-detail-card history-stack">
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

        {activeTab === "salary-bond" && (
          <section className="employee-detail-card history-stack">
            <div className="ticket-section-heading">
              <div>
                <h3>Salary Bond</h3>
                <p>Track employee salary bonds and payroll deductions.</p>
              </div>
              <button className="primary-button compact" type="button">
                <Plus size={15} />
                Add Salary Bond
              </button>
            </div>
            <DataTable
              empty="No salary bonds for this employee yet."
              headers={["Employee", "Purpose", "Amount", "Balance", "Deduction/Payroll", "Status", "Action"]}
              rows={employeeSalaryBonds.map((bond) => [
                currentEmployee.full_name,
                bond.purpose || bond.bond_type || bond.bond_id,
                currency.format(toNumber(bond.amount)),
                currency.format(toNumber(bond.balance)),
                currency.format(toNumber(bond.deduction_per_payroll)),
                <StatusPill key="status" status={bond.status} />,
                <div className="salary-bond-actions" key="actions">
                  <button
                    onClick={() => setNotice({ type: "success", text: `${bond.bond_id} details selected.` })}
                    type="button"
                  >
                    View Details
                  </button>
                  <button
                    onClick={() => setNotice({ type: "success", text: `${bond.bond_id} is ready to edit.` })}
                    type="button"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setNotice({ type: "success", text: `${bond.bond_id} marked completed.` })}
                    type="button"
                  >
                    Mark Completed
                  </button>
                  <button
                    onClick={() => setNotice({ type: "success", text: `${bond.bond_id} archived.` })}
                    type="button"
                  >
                    Archive
                  </button>
                </div>,
              ])}
            />
          </section>
        )}

        {activeTab === "payments" && (
          <section className="employee-detail-card history-stack">
            <h3>Payments</h3>
            <section className="history-summary">
              <div>
                <p className="eyebrow">Paid</p>
                <strong>{currency.format(totals.paid)}</strong>
              </div>
              <div>
                <p className="eyebrow">Pending</p>
                <strong>{currency.format(totals.pending)}</strong>
              </div>
              <div>
                <p className="eyebrow">Total deductions</p>
                <strong>{currency.format(totals.deductions)}</strong>
              </div>
            </section>
            <DataTable
              empty="No payment records for this employee yet."
              headers={["Period", "Net", "Paid date", "Status", "Notes"]}
              rows={history.map(({ item, run }) => [
                `${monthNames[run.period_month - 1]} ${run.period_year} - ${payPeriodLabel(run.pay_period)}`,
                currency.format(toNumber(item.net_pay)),
                item.paid_date || "Not paid",
                <StatusPill key="status" status={item.status} />,
                item.notes || "No notes",
              ])}
            />
          </section>
        )}

        {activeTab === "documents" && (
          <section className="employee-detail-card">
            <h3>Documents</h3>
            <div className="details-grid">
              <DetailItem label="SSS number" value={currentEmployee.sss_number || "Not provided"} />
              <DetailItem label="PhilHealth number" value={currentEmployee.philhealth_number || "Not provided"} />
              <DetailItem label="Pag-IBIG number" value={currentEmployee.pagibig_number || "Not provided"} />
              <DetailItem label="TIN number" value={currentEmployee.tin_number || "Not provided"} />
            </div>
          </section>
        )}
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

function DetailItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="detail-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

type SalaryBondPayrollDeduction = {
  amount: number;
  bond: SalaryBond;
};

function salaryBondDeductionsForEmployee(
  salaryBonds: SalaryBond[],
  employee: Employee,
  payrollDate: string,
) {
  return salaryBonds
    .filter((bond) =>
      bond.status === "active" &&
      bond.employee_id === employee.id &&
      toNumber(bond.balance) > 0 &&
      toNumber(bond.deduction_per_payroll) > 0 &&
      (!bond.start_deduction || bond.start_deduction <= payrollDate)
    )
    .map((bond) => ({
      amount: Math.min(toNumber(bond.balance), toNumber(bond.deduction_per_payroll)),
      bond,
    }))
    .filter((deduction) => deduction.amount > 0);
}

function payrollItemPayloadForEmployeeWithSalaryBonds(
  employee: Employee,
  position: Position | undefined,
  payrollRunId: string,
  userId: string,
  dailyTicketEntries: DailyTicketEntry[],
  salaryBonds: SalaryBond[],
  payrollDate: string,
) {
  const payload = payrollItemPayloadForEmployee(employee, payrollRunId, userId, dailyTicketEntries, position);
  const bondDeductions = salaryBondDeductionsForEmployee(salaryBonds, employee, payrollDate);
  const salaryBondDeduction = bondDeductions.reduce((sum, deduction) => sum + deduction.amount, 0);

  if (salaryBondDeduction === 0) {
    return { bondDeductions, payload };
  }

  const deductions = toNumber(payload.deductions) + salaryBondDeduction;
  const note = `Salary bond deduction: ${currency.format(salaryBondDeduction)}`;

  return {
    bondDeductions,
    payload: {
      ...payload,
      deductions,
      net_pay: netPay(toNumber(payload.gross_pay), toNumber(payload.allowances), deductions),
      notes: [payload.notes, note].filter(Boolean).join(" | "),
    },
  };
}

async function applySalaryBondPayrollDeductions(deductions: SalaryBondPayrollDeduction[]) {
  if (!supabase || deductions.length === 0) return null;
  const client = supabase;

  const updates = deductions.map(({ amount, bond }) => {
    const balance = Math.max(0, toNumber(bond.balance) - amount);
    return client
      .from("salary_bonds")
      .update({
        balance,
        status: balance === 0 ? "completed" : bond.status,
      })
      .eq("id", bond.id);
  });
  const results = await Promise.all(updates);
  return results.find((result) => result.error)?.error ?? null;
}

export function PayrollView({
  dailyTicketEntries,
  employees,
  ensurePayrollRunItems,
  onLocalPayrollRunsChange,
  onChange,
  onQueueOfflineMutation,
  payrollRuns,
  positions,
  salaryBonds,
  setNotice,
  userId,
}: {
  dailyTicketEntries: DailyTicketEntry[];
  employees: Employee[];
  ensurePayrollRunItems: (payrollRunId: string) => Promise<void>;
  onLocalPayrollRunsChange: (payrollRuns: PayrollRunWithItems[]) => void;
  onChange: () => Promise<void>;
  onQueueOfflineMutation: QueueOfflineMutation;
  payrollRuns: PayrollRunWithItems[];
  positions: Position[];
  salaryBonds: SalaryBond[];
  setNotice: (notice: Notice) => void;
  userId: string;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState(payrollRuns[0]?.id ?? "");
  const selectedRun = payrollRuns.find((run) => run.id === selectedRunId) ?? payrollRuns[0];
  const activeEmployees = employees.filter((employee) => employee.status === "active");
  const existingEmployeeIds = new Set(
    (selectedRun?.items ?? [])
      .map((item) => item.employee_id)
      .filter((id): id is string => Boolean(id)),
  );
  const missingEmployees = selectedRun
    ? activeEmployees.filter((employee) => !existingEmployeeIds.has(employee.id))
    : [];

  useEffect(() => {
    if (!selectedRunId && payrollRuns[0]) {
      setSelectedRunId(payrollRuns[0].id);
    }
  }, [payrollRuns, selectedRunId]);

  useEffect(() => {
    if (selectedRun?.id && selectedRun.items.length === 0) {
      void ensurePayrollRunItems(selectedRun.id);
    }
  }, [selectedRun?.id, selectedRun?.items.length]);

  function createOfflinePayrollItems(payloads: Array<Omit<PayrollRunItem, "id" | "created_at" | "updated_at">>) {
    const now = new Date().toISOString();
    const detailPayloads: Array<Record<string, unknown>> = [];
    const items = payloads.map((payload) => {
      const id = crypto.randomUUID();
      const ticketDetails = payload.ticket_details.map((detail) => {
        const savedDetail = {
          ...detail,
          id: crypto.randomUUID(),
          payroll_run_item_id: id,
          created_at: now,
        };
        detailPayloads.push(savedDetail);
        return savedDetail;
      });
      return { ...payload, id, ticket_details: ticketDetails, created_at: now, updated_at: now } as PayrollRunItem;
    });
    const itemPayloads = items.map(({ ticket_details: _ticketDetails, created_at: _createdAt, updated_at: _updatedAt, ...item }) => item);
    return { detailPayloads, itemPayloads, items };
  }

  async function insertPayrollItems(payloads: Array<Omit<PayrollRunItem, "id" | "created_at" | "updated_at">>) {
    if (!supabase) return { error: null };
    for (const payload of payloads) {
      const { ticket_details: ticketDetails, ...itemPayload } = payload;
      const itemResult = await supabase.from("payroll_run_items").insert(itemPayload).select("id").single();
      if (itemResult.error) return { error: itemResult.error };
      if (ticketDetails.length > 0) {
        const detailResult = await supabase.from("payroll_run_item_ticket_details").insert(
          ticketDetails.map(({ id: _id, created_at: _createdAt, ...detail }) => ({
            ...detail,
            id: crypto.randomUUID(),
            payroll_run_item_id: itemResult.data.id,
          })),
        );
        if (detailResult.error) return { error: detailResult.error };
      }
    }
    return { error: null };
  }

  async function createRun(values: PayrollRunFormValues) {
    if (!supabase) return;
    const activeEmployees = employees.filter((employee) => employee.status === "active");
    if (activeEmployees.length === 0) {
      setNotice({ type: "error", text: "Add at least one active employee first." });
      return;
    }
    const invalidEmployees = activeEmployees.filter((employee) => {
      const position = positions.find((item) => item.id === employee.position_id);
      return !position || position.status !== "active";
    });
    if (invalidEmployees.length > 0) {
      setNotice({ type: "error", text: `Assign an active position to: ${invalidEmployees.map((employee) => employee.full_name).join(", ")}.` });
      return;
    }

    const runPayload = {
      user_id: userId,
      period_month: Number(values.period_month),
      period_year: Number(values.period_year),
      pay_period: values.pay_period,
      generated_date: values.generated_date,
      notes: values.notes.trim(),
    };
    const existingRun = payrollRuns.find(
      (run) =>
        run.period_month === runPayload.period_month &&
        run.period_year === runPayload.period_year &&
        run.pay_period === runPayload.pay_period,
    );
    if (existingRun) {
      setSelectedRunId(existingRun.id);
      setFormOpen(false);
      setNotice({ type: "success", text: "Payroll for this pay period already exists and is now selected." });
      return;
    }

    if (!navigator.onLine) {
      const offlineRunId = crypto.randomUUID();
      const offlineRun = {
        ...runPayload,
        id: offlineRunId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as PayrollRun;
      const periodDailyEntries = dailyTicketEntriesForPayrollPeriod(
        dailyTicketEntries,
        offlineRun.period_month,
        offlineRun.period_year,
        offlineRun.pay_period,
      );
      const employeePayrollItems = activeEmployees.map((employee) =>
        payrollItemPayloadForEmployeeWithSalaryBonds(
          employee,
          positions.find((position) => position.id === employee.position_id),
          offlineRun.id,
          userId,
          periodDailyEntries,
          salaryBonds,
          offlineRun.generated_date,
        )
      );
      const { detailPayloads, itemPayloads, items: offlineItems } = createOfflinePayrollItems(employeePayrollItems.map((item) => item.payload));
      const salaryBondUpdates = employeePayrollItems
        .flatMap((item) => item.bondDeductions)
        .map(({ amount, bond }) => {
          const balance = Math.max(0, toNumber(bond.balance) - amount);
          return {
            id: bond.id,
            payload: {
              balance,
              status: balance === 0 ? "completed" : bond.status,
            },
          };
        });

      await onQueueOfflineMutation({
        resource: "payrollRuns",
        affectedResources: ["payrollRuns", "payrollHistory", "salaryBonds", "dashboardSummary"],
        operation: "payroll_group",
        table: "payroll_runs",
        payload: {
          runPayload: offlineRun,
          itemPayloads,
          detailPayloads,
          salaryBondUpdates,
        },
      });
      onLocalPayrollRunsChange([
        { ...offlineRun, items: offlineItems },
        ...payrollRuns,
      ]);
      setFormOpen(false);
      setSelectedRunId(offlineRunId);
      return;
    }

    const runResult = await supabase.from("payroll_runs").insert(runPayload).select().single();
    if (runResult.error) {
      if (isOfflineLikeError(runResult.error)) {
        const offlineRunId = crypto.randomUUID();
        const offlineRun = {
          ...runPayload,
          id: offlineRunId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as PayrollRun;
        const periodDailyEntries = dailyTicketEntriesForPayrollPeriod(
          dailyTicketEntries,
          offlineRun.period_month,
          offlineRun.period_year,
          offlineRun.pay_period,
        );
        const employeePayrollItems = activeEmployees.map((employee) =>
          payrollItemPayloadForEmployeeWithSalaryBonds(
            employee,
            positions.find((position) => position.id === employee.position_id),
            offlineRun.id,
            userId,
            periodDailyEntries,
            salaryBonds,
            offlineRun.generated_date,
          )
        );
        const { detailPayloads, itemPayloads, items: offlineItems } = createOfflinePayrollItems(employeePayrollItems.map((item) => item.payload));
        const salaryBondUpdates = employeePayrollItems
          .flatMap((item) => item.bondDeductions)
          .map(({ amount, bond }) => {
            const balance = Math.max(0, toNumber(bond.balance) - amount);
            return {
              id: bond.id,
              payload: {
                balance,
                status: balance === 0 ? "completed" : bond.status,
              },
            };
          });

        await onQueueOfflineMutation({
          resource: "payrollRuns",
          affectedResources: ["payrollRuns", "payrollHistory", "salaryBonds", "dashboardSummary"],
          operation: "payroll_group",
          table: "payroll_runs",
          payload: {
            runPayload: offlineRun,
            itemPayloads,
            detailPayloads,
            salaryBondUpdates,
          },
        });
        onLocalPayrollRunsChange([
          { ...offlineRun, items: offlineItems },
          ...payrollRuns,
        ]);
        setFormOpen(false);
        setSelectedRunId(offlineRunId);
        return;
      }
      setNotice({ type: "error", text: friendlyError(runResult.error) });
      return;
    }

    const newRun = runResult.data as PayrollRun;
    const periodDailyEntries = dailyTicketEntriesForPayrollPeriod(
      dailyTicketEntries,
      newRun.period_month,
      newRun.period_year,
      newRun.pay_period,
    );
    const employeePayrollItems = activeEmployees.map((employee) =>
      payrollItemPayloadForEmployeeWithSalaryBonds(
        employee,
        positions.find((position) => position.id === employee.position_id),
        newRun.id,
        userId,
        periodDailyEntries,
        salaryBonds,
        newRun.generated_date,
      )
    );
    const itemPayloads = employeePayrollItems.map((item) => item.payload);
    const itemResult = await insertPayrollItems(itemPayloads);
    if (itemResult.error) {
      setNotice({ type: "error", text: friendlyError(itemResult.error) });
      return;
    }

    const bondDeductions = employeePayrollItems.flatMap((item) => item.bondDeductions);
    const bondError = await applySalaryBondPayrollDeductions(bondDeductions);
    if (bondError) {
      setNotice({ type: "error", text: friendlyError(bondError) });
      return;
    }

    setNotice({ type: "success", text: "Payroll run generated." });
    setFormOpen(false);
    setSelectedRunId(newRun.id);
    await onChange();
  }

  async function updateItem(item: PayrollRunItem, patch: Partial<PayrollRunItem>) {
    if (!supabase) return;
    const installationTickets = normalizeTicketCount(patch.installation_tickets ?? item.installation_tickets);
    const repairTickets = normalizeTicketCount(patch.repair_tickets ?? item.repair_tickets);
    const installationRate = toNumber(patch.installation_rate ?? item.installation_rate ?? INSTALLATION_RATE);
    const repairRate = toNumber(patch.repair_rate ?? item.repair_rate ?? NEW_EMPLOYEE_REPAIR_RATE);
    const allowances = toNumber(patch.allowances ?? item.allowances);
    const deductions = toNumber(patch.deductions ?? item.deductions);
    const legacyTicketFieldsChanged = patch.installation_tickets !== undefined || patch.repair_tickets !== undefined ||
      patch.installation_rate !== undefined || patch.repair_rate !== undefined;
    const ticketPay = legacyTicketFieldsChanged
      ? ticketGrossPay(installationTickets, repairTickets, installationRate, repairRate)
      : toNumber(item.ticket_pay);
    const basePay = toNumber(item.base_pay);
    const gross = basePay + ticketPay;
    const payload = {
      ...patch,
      installation_tickets: installationTickets,
      repair_tickets: repairTickets,
      installation_rate: installationRate,
      repair_rate: repairRate,
      base_pay: basePay,
      ticket_pay: ticketPay,
      gross_pay: gross,
      net_pay: netPay(gross, allowances, deductions),
    };
    if (!navigator.onLine) {
      onLocalPayrollRunsChange(payrollRuns.map((run) => ({
        ...run,
        items: run.items.map((runItem) => runItem.id === item.id ? { ...runItem, ...payload } : runItem),
      })));
      await onQueueOfflineMutation({
        resource: "payrollRuns",
        affectedResources: ["payrollRuns", "payrollHistory", "dashboardSummary"],
        operation: "update",
        table: "payroll_run_items",
        recordId: item.id,
        payload,
      });
      return;
    }
    const { error } = await supabase.from("payroll_run_items").update(payload).eq("id", item.id);
    if (error && isOfflineLikeError(error)) {
      onLocalPayrollRunsChange(payrollRuns.map((run) => ({
        ...run,
        items: run.items.map((runItem) => runItem.id === item.id ? { ...runItem, ...payload } : runItem),
      })));
      await onQueueOfflineMutation({
        resource: "payrollRuns",
        affectedResources: ["payrollRuns", "payrollHistory", "dashboardSummary"],
        operation: "update",
        table: "payroll_run_items",
        recordId: item.id,
        payload,
      });
      return;
    }
    setNotice(error ? { type: "error", text: friendlyError(error) } : { type: "success", text: "Payroll item updated." });
    await onChange();
  }

  async function addMissingEmployees() {
    if (!supabase || !selectedRun || missingEmployees.length === 0) return;

    const periodDailyEntries = dailyTicketEntriesForPayrollPeriod(
      dailyTicketEntries,
      selectedRun.period_month,
      selectedRun.period_year,
      selectedRun.pay_period,
    );
    const employeePayrollItems = missingEmployees.map((employee) =>
      payrollItemPayloadForEmployeeWithSalaryBonds(
        employee,
        positions.find((position) => position.id === employee.position_id),
        selectedRun.id,
        userId,
        periodDailyEntries,
        salaryBonds,
        selectedRun.generated_date,
      )
    );
    const itemPayloads = employeePayrollItems.map((item) => item.payload);
    if (!navigator.onLine) {
      const { detailPayloads, itemPayloads: offlineItemPayloads, items: offlineItems } = createOfflinePayrollItems(itemPayloads);
      onLocalPayrollRunsChange(payrollRuns.map((run) =>
        run.id === selectedRun.id ? { ...run, items: [...run.items, ...offlineItems] } : run,
      ));
      await onQueueOfflineMutation({
        resource: "payrollRuns",
        affectedResources: ["payrollRuns", "payrollHistory", "salaryBonds", "dashboardSummary"],
        operation: "payroll_items_group",
        table: "payroll_run_items",
        payload: { itemPayloads: offlineItemPayloads, detailPayloads },
      });
      return;
    }
    const { error } = await insertPayrollItems(itemPayloads);
    if (error) {
      if (isOfflineLikeError(error)) {
        const { detailPayloads, itemPayloads: offlineItemPayloads, items: offlineItems } = createOfflinePayrollItems(itemPayloads);
        onLocalPayrollRunsChange(payrollRuns.map((run) =>
          run.id === selectedRun.id ? { ...run, items: [...run.items, ...offlineItems] } : run,
        ));
        await onQueueOfflineMutation({
          resource: "payrollRuns",
          affectedResources: ["payrollRuns", "payrollHistory", "salaryBonds", "dashboardSummary"],
          operation: "payroll_items_group",
          table: "payroll_run_items",
          payload: { itemPayloads: offlineItemPayloads, detailPayloads },
        });
        return;
      }
      setNotice({ type: "error", text: friendlyError(error) });
      return;
    }

    const bondDeductions = employeePayrollItems.flatMap((item) => item.bondDeductions);
    const bondError = await applySalaryBondPayrollDeductions(bondDeductions);
    if (bondError) {
      setNotice({ type: "error", text: friendlyError(bondError) });
      return;
    }

    setNotice({
      type: "success",
      text: `${missingEmployees.length} employee${missingEmployees.length === 1 ? "" : "s"} added to payroll.`,
    });
    await onChange();
  }

  const pendingPayrollItems = selectedRun?.items.filter((item) => item.status !== "paid") ?? [];
  const totals = pendingPayrollItems.reduce(
    (sum, item) => ({
      gross: sum.gross + toNumber(item.gross_pay),
      allowances: sum.allowances + toNumber(item.allowances),
      deductions: sum.deductions + toNumber(item.deductions),
      net: sum.net + toNumber(item.net_pay),
    }),
    { gross: 0, allowances: 0, deductions: 0, net: 0 },
  );

  return (
    <div className="page-stack">
      <PageHeader
        action={
          <button className="primary-button compact" onClick={() => setFormOpen(true)} type="button">
            <Plus size={16} />
            Generate payroll
          </button>
        }
        eyebrow="Pay-period runs"
        title="Payroll"
        text="Generate first-half or second-half payroll for all active employees."
      />
      <div className="summary-band">
        <label>
          Payroll history
          <select value={selectedRun?.id ?? ""} onChange={(event) => setSelectedRunId(event.target.value)}>
            {payrollRuns.length === 0 && <option value="">No payroll runs</option>}
            {payrollRuns.map((run) => (
              <option key={run.id} value={run.id}>
                {monthNames[run.period_month - 1]} {run.period_year} - {payPeriodLabel(run.pay_period)} - generated {run.generated_date}
              </option>
            ))}
          </select>
        </label>
        <div className="totals-grid">
          <span>Gross {currency.format(totals.gross)}</span>
          <span>Allowances {currency.format(totals.allowances)}</span>
          <span>Deductions {currency.format(totals.deductions)}</span>
          <strong>Net {currency.format(totals.net)}</strong>
        </div>
      </div>
      {selectedRun && missingEmployees.length > 0 && (
        <section className="action-band">
          <div>
            <p className="eyebrow">Missing active employees</p>
            <h2>{missingEmployees.length} not included in this payroll run</h2>
            <p>Add them using their position's base salary and saved closed-ticket totals.</p>
          </div>
          <button className="primary-button compact" onClick={addMissingEmployees} type="button">
            <Plus size={16} />
            Add missing employees
          </button>
        </section>
      )}
      {selectedRun ? (
        <PayrollItemsTable items={pendingPayrollItems} onUpdate={updateItem} />
      ) : (
        <div className="panel">
          <p className="muted">No payroll has been generated yet.</p>
        </div>
      )}
      {formOpen && (
        <PayrollRunForm onClose={() => setFormOpen(false)} onSubmit={createRun} />
      )}
    </div>
  );
}

function PayrollItemsTable({
  items,
  onUpdate,
}: {
  items: PayrollRunItem[];
  onUpdate: (item: PayrollRunItem, patch: Partial<PayrollRunItem>) => Promise<void>;
}) {
  return (
    <DataTable
      empty="No pending payroll items in this run."
      headers={["Employee", "Position", "Base pay", "Ticket pay", "Ticket breakdown", "Gross", "Allowance", "Deduction", "Net", "Status", "Actions"]}
      rows={items.map((item) => [
        <RecordTitle
          key="employee"
          title={item.employee_name}
          notes={item.notes || (item.pay_mode === "fixed" ? "Fixed salary" : item.pay_mode === "hybrid" ? "Base + tickets" : item.pay_mode === "daily" ? "Daily wage" : "Per ticket")}
        />,
        item.position_name || "Legacy",
        currency.format(toNumber(item.base_pay)),
        currency.format(toNumber(item.ticket_pay)),
        item.ticket_details?.map((detail) => `${detail.category_name}: ${detail.ticket_count} × ${currency.format(toNumber(detail.rate))}`).join("; ") || "—",
        currency.format(toNumber(item.gross_pay)),
        currency.format(toNumber(item.allowances)),
        currency.format(toNumber(item.deductions)),
        currency.format(toNumber(item.net_pay)),
        <StatusPill key="status" status={item.status} />,
        <div className="row-actions" key="actions">
          {item.status !== "paid" ? (
            <button
              aria-label="Mark paid"
              onClick={() => onUpdate(item, { status: "paid", paid_date: todayKey() })}
              title="Mark paid"
              type="button"
            >
              <CheckCircle2 size={16} />
            </button>
          ) : (
            <button
              aria-label="Mark pending"
              onClick={() => onUpdate(item, { status: "pending", paid_date: null })}
              title="Mark pending"
              type="button"
            >
              <CalendarClock size={16} />
            </button>
          )}
        </div>,
      ])}
    />
  );
}

function PayrollHistoryView({ rows }: { rows: PayrollHistoryRow[] }) {
  const [query, setQuery] = useState("");
  const filteredRows = rows
    .filter((row) => row.searchText.includes(query.toLowerCase()))
    .map((row) => [
      row.payrollNo,
      row.payPeriod,
      row.employeeName,
      row.department,
      currency.format(row.grossPay),
      currency.format(row.deductions),
      currency.format(row.netPay),
      <StatusPill key="status" status={row.status} />,
      row.processedDate,
    ]);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Payroll records"
        title="Payroll History"
        text="Review every employee payroll record by pay period."
      />
      <Toolbar query={query} setQuery={setQuery} />
      <DataTable
        empty="No paid payroll history yet."
        headers={[
          "Payroll No.",
          "Pay Period",
          "Employee",
          "Department",
          "Gross Pay",
          "Deductions",
          "Net Pay",
          "Status",
          "Date Processed",
        ]}
        rows={filteredRows}
      />
    </div>
  );
}

function PaymentHistoryView({ payments }: { payments: PaymentReminder[] }) {
  const rows = payments
    .filter((payment) => payment.status === "paid")
    .sort((a, b) => b.due_date.localeCompare(a.due_date))
    .map((payment) => [
      <RecordTitle key="title" title={payment.title} notes={payment.notes} />,
      payment.type,
      currency.format(toNumber(payment.amount)),
      payment.due_date,
      <StatusPill key="status" status={payment.status} />,
    ]);
  const paidTotal = payments
    .filter((payment) => payment.status === "paid")
    .reduce((sum, payment) => sum + toNumber(payment.amount), 0);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Completed reminders"
        title="Payment History"
        text="Review loan and bill reminders that were marked paid."
      />
      <section className="summary-band">
        <div>
          <p className="eyebrow">Paid total</p>
          <h2>{currency.format(paidTotal)}</h2>
        </div>
        <p>Only reminders marked paid appear here. Pending and overdue reminders stay in Payments.</p>
      </section>
      <DataTable
        empty="No paid payment reminders yet."
        headers={["Title", "Type", "Amount", "Due date", "Status"]}
        rows={rows}
      />
    </div>
  );
}

function PaymentsView({
  onChange,
  onLocalPaymentsChange,
  onQueueOfflineMutation,
  payments,
  setNotice,
  userId,
}: {
  onChange: () => Promise<void>;
  onLocalPaymentsChange: (payments: PaymentReminder[]) => void;
  onQueueOfflineMutation: QueueOfflineMutation;
  payments: PaymentReminder[];
  setNotice: (notice: Notice) => void;
  userId: string;
}) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "loan" | "bill">("all");
  const [editing, setEditing] = useState<PaymentReminder | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const rows = useMemo(() => {
    return payments.filter((payment) => {
      const matchesQuery = `${payment.title} ${payment.notes}`.toLowerCase().includes(query.toLowerCase());
      const matchesType = typeFilter === "all" || payment.type === typeFilter;
      return matchesQuery && matchesType;
    });
  }, [payments, query, typeFilter]);

  async function savePayment(values: PaymentFormValues) {
    if (!supabase) return;
    const payload = {
      ...(editing ? {} : { id: crypto.randomUUID() }),
      title: values.title.trim(),
      type: values.type,
      amount: toNumber(values.amount),
      due_date: values.due_date,
      status: values.status,
      notes: values.notes.trim(),
      user_id: userId,
    };
    const optimisticPayment = {
      ...(editing ?? {}),
      ...payload,
      id: editing?.id ?? payload.id,
      created_at: editing?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as PaymentReminder;

    if (!navigator.onLine) {
      onLocalPaymentsChange(
        editing
          ? payments.map((payment) => payment.id === editing.id ? optimisticPayment : payment)
          : [optimisticPayment, ...payments],
      );
      await onQueueOfflineMutation({
        resource: "payments",
        affectedResources: ["payments", "dashboardSummary"],
        operation: editing ? "update" : "insert",
        table: "payment_reminders",
        recordId: editing?.id,
        payload,
      });
      setEditing(null);
      setFormOpen(false);
      return;
    }

    const result = editing
      ? await supabase.from("payment_reminders").update(payload).eq("id", editing.id)
      : await supabase.from("payment_reminders").insert(payload);

    if (result.error) {
      if (isOfflineLikeError(result.error)) {
        onLocalPaymentsChange(
          editing
            ? payments.map((payment) => payment.id === editing.id ? optimisticPayment : payment)
            : [optimisticPayment, ...payments],
        );
        await onQueueOfflineMutation({
          resource: "payments",
          affectedResources: ["payments", "dashboardSummary"],
          operation: editing ? "update" : "insert",
          table: "payment_reminders",
          recordId: editing?.id,
          payload,
        });
        setEditing(null);
        setFormOpen(false);
        return;
      }
      setNotice({ type: "error", text: friendlyError(result.error) });
      return;
    }
    setNotice({ type: "success", text: "Payment reminder saved." });
    setEditing(null);
    setFormOpen(false);
    await onChange();
  }

  async function markPaid(id: string) {
    if (!supabase) return;
    if (!navigator.onLine) {
      onLocalPaymentsChange(payments.map((payment) => payment.id === id ? { ...payment, status: "paid" } : payment));
      await onQueueOfflineMutation({
        resource: "payments",
        affectedResources: ["payments", "dashboardSummary"],
        operation: "update",
        table: "payment_reminders",
        recordId: id,
        payload: { status: "paid" },
      });
      return;
    }
    const { error } = await supabase.from("payment_reminders").update({ status: "paid" }).eq("id", id);
    if (error && isOfflineLikeError(error)) {
      onLocalPaymentsChange(payments.map((payment) => payment.id === id ? { ...payment, status: "paid" } : payment));
      await onQueueOfflineMutation({
        resource: "payments",
        affectedResources: ["payments", "dashboardSummary"],
        operation: "update",
        table: "payment_reminders",
        recordId: id,
        payload: { status: "paid" },
      });
      return;
    }
    setNotice(error ? { type: "error", text: friendlyError(error) } : { type: "success", text: "Marked paid." });
    await onChange();
  }

  async function remove(id: string) {
    if (!supabase || !window.confirm("Delete this payment reminder?")) return;
    if (!navigator.onLine) {
      onLocalPaymentsChange(payments.filter((payment) => payment.id !== id));
      await onQueueOfflineMutation({
        resource: "payments",
        affectedResources: ["payments", "dashboardSummary"],
        operation: "delete",
        table: "payment_reminders",
        recordId: id,
      });
      return;
    }
    const { error } = await supabase.from("payment_reminders").delete().eq("id", id);
    if (error && isOfflineLikeError(error)) {
      onLocalPaymentsChange(payments.filter((payment) => payment.id !== id));
      await onQueueOfflineMutation({
        resource: "payments",
        affectedResources: ["payments", "dashboardSummary"],
        operation: "delete",
        table: "payment_reminders",
        recordId: id,
      });
      return;
    }
    setNotice(error ? { type: "error", text: friendlyError(error) } : { type: "success", text: "Payment reminder deleted." });
    await onChange();
  }

  return (
    <div className="page-stack">
      <PageHeader
        action={
          <button className="primary-button compact" onClick={() => { setEditing(null); setFormOpen(true); }} type="button">
            <Plus size={16} />
            Add payment
          </button>
        }
        eyebrow="Loans and bills"
        title="Payments"
        text="Track manual due dates outside payroll."
      />
      <Toolbar query={query} setQuery={setQuery}>
        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}>
          <option value="all">All types</option>
          <option value="loan">Loans</option>
          <option value="bill">Bills</option>
        </select>
      </Toolbar>
      <DataTable
        empty="No payment reminders yet."
        headers={["Title", "Type", "Amount", "Due date", "Status", "Actions"]}
        rows={rows.map((payment) => [
          <RecordTitle key="title" title={payment.title} notes={payment.notes} />,
          payment.type,
          currency.format(toNumber(payment.amount)),
          payment.due_date,
          <StatusPill key="status" status={computedPaymentStatus(payment)} />,
          <RowActions
            key="actions"
            canMarkPaid={payment.status !== "paid"}
            onDelete={() => remove(payment.id)}
            onEdit={() => { setEditing(payment); setFormOpen(true); }}
            onMarkPaid={() => markPaid(payment.id)}
          />,
        ])}
      />
      {formOpen && (
        <PaymentForm
          initial={editing}
          onClose={() => { setEditing(null); setFormOpen(false); }}
          onSubmit={savePayment}
        />
      )}
    </div>
  );
}

function computedPaymentStatus(payment: PaymentReminder) {
  if (payment.status === "paid") return "paid";
  if (payment.status === "overdue" || isBeforeToday(payment.due_date)) return "overdue";
  if (isToday(payment.due_date)) return "due today";
  return "pending";
}

function CollectionHistoryView({ collections }: { collections: CollectionReminder[] }) {
  const rows = collections
    .filter((collection) => collection.status === "collected")
    .sort((a, b) => b.due_date.localeCompare(a.due_date))
    .map((collection) => [
      <RecordTitle key="title" title={collection.title} notes={collection.client_name} />,
      currency.format(toNumber(collection.amount)),
      collection.due_date,
      <StatusPill key="status" status={collection.status} />,
    ]);
  const collectedTotal = collections
    .filter((collection) => collection.status === "collected")
    .reduce((sum, collection) => sum + toNumber(collection.amount), 0);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Completed receivables"
        title="Collection History"
        text="Review customer receivables that were marked collected."
      />
      <section className="summary-band">
        <div>
          <p className="eyebrow">Collected total</p>
          <h2>{currency.format(collectedTotal)}</h2>
        </div>
        <p>Only receivables marked collected appear here. Pending and overdue receivables stay in Collections.</p>
      </section>
      <DataTable
        empty="No collected receivables yet."
        headers={["Title", "Amount", "Due date", "Status"]}
        rows={rows}
      />
    </div>
  );
}

function CollectionsView({
  collections,
  onChange,
  onLocalCollectionsChange,
  onQueueOfflineMutation,
  setNotice,
  userId,
}: {
  collections: CollectionReminder[];
  onChange: () => Promise<void>;
  onLocalCollectionsChange: (collections: CollectionReminder[]) => void;
  onQueueOfflineMutation: QueueOfflineMutation;
  setNotice: (notice: Notice) => void;
  userId: string;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<CollectionReminder | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const rows = useMemo(() => {
    return collections.filter((collection) => {
      const matchesQuery = `${collection.title} ${collection.client_name} ${collection.notes}`
        .toLowerCase()
        .includes(query.toLowerCase());
      return collection.status !== "collected" && matchesQuery;
    });
  }, [collections, query]);

  async function saveCollection(values: CollectionFormValues) {
    if (!supabase) return;
    const payload = {
      ...(editing ? {} : { id: crypto.randomUUID() }),
      title: values.title.trim(),
      client_name: values.client_name.trim(),
      amount: toNumber(values.amount),
      due_date: values.due_date,
      status: values.status,
      notes: values.notes.trim(),
      user_id: userId,
    };
    const optimisticCollection = {
      ...(editing ?? {}),
      ...payload,
      id: editing?.id ?? payload.id,
      created_at: editing?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as CollectionReminder;

    if (!navigator.onLine) {
      onLocalCollectionsChange(
        editing
          ? collections.map((collection) => collection.id === editing.id ? optimisticCollection : collection)
          : [optimisticCollection, ...collections],
      );
      await onQueueOfflineMutation({
        resource: "collections",
        affectedResources: ["collections", "dashboardSummary"],
        operation: editing ? "update" : "insert",
        table: "collection_reminders",
        recordId: editing?.id,
        payload,
      });
      setEditing(null);
      setFormOpen(false);
      return;
    }

    const result = editing
      ? await supabase.from("collection_reminders").update(payload).eq("id", editing.id)
      : await supabase.from("collection_reminders").insert(payload);

    if (result.error) {
      if (isOfflineLikeError(result.error)) {
        onLocalCollectionsChange(
          editing
            ? collections.map((collection) => collection.id === editing.id ? optimisticCollection : collection)
            : [optimisticCollection, ...collections],
        );
        await onQueueOfflineMutation({
          resource: "collections",
          affectedResources: ["collections", "dashboardSummary"],
          operation: editing ? "update" : "insert",
          table: "collection_reminders",
          recordId: editing?.id,
          payload,
        });
        setEditing(null);
        setFormOpen(false);
        return;
      }
      setNotice({ type: "error", text: friendlyError(result.error) });
      return;
    }
    setNotice({ type: "success", text: "Collection reminder saved." });
    setEditing(null);
    setFormOpen(false);
    await onChange();
  }

  async function markCollected(id: string) {
    if (!supabase) return;
    if (!navigator.onLine) {
      onLocalCollectionsChange(collections.map((collection) => collection.id === id ? { ...collection, status: "collected" } : collection));
      await onQueueOfflineMutation({
        resource: "collections",
        affectedResources: ["collections", "dashboardSummary"],
        operation: "update",
        table: "collection_reminders",
        recordId: id,
        payload: { status: "collected" },
      });
      return;
    }
    const { error } = await supabase.from("collection_reminders").update({ status: "collected" }).eq("id", id);
    if (error && isOfflineLikeError(error)) {
      onLocalCollectionsChange(collections.map((collection) => collection.id === id ? { ...collection, status: "collected" } : collection));
      await onQueueOfflineMutation({
        resource: "collections",
        affectedResources: ["collections", "dashboardSummary"],
        operation: "update",
        table: "collection_reminders",
        recordId: id,
        payload: { status: "collected" },
      });
      return;
    }
    setNotice(error ? { type: "error", text: friendlyError(error) } : { type: "success", text: "Marked collected." });
    await onChange();
  }

  async function remove(id: string) {
    if (!supabase || !window.confirm("Delete this collection reminder?")) return;
    if (!navigator.onLine) {
      onLocalCollectionsChange(collections.filter((collection) => collection.id !== id));
      await onQueueOfflineMutation({
        resource: "collections",
        affectedResources: ["collections", "dashboardSummary"],
        operation: "delete",
        table: "collection_reminders",
        recordId: id,
      });
      return;
    }
    const { error } = await supabase.from("collection_reminders").delete().eq("id", id);
    if (error && isOfflineLikeError(error)) {
      onLocalCollectionsChange(collections.filter((collection) => collection.id !== id));
      await onQueueOfflineMutation({
        resource: "collections",
        affectedResources: ["collections", "dashboardSummary"],
        operation: "delete",
        table: "collection_reminders",
        recordId: id,
      });
      return;
    }
    setNotice(error ? { type: "error", text: friendlyError(error) } : { type: "success", text: "Collection reminder deleted." });
    await onChange();
  }

  return (
    <div className="page-stack">
      <PageHeader
        action={
          <button className="primary-button compact" onClick={() => { setEditing(null); setFormOpen(true); }} type="button">
            <Plus size={16} />
            Add collection
          </button>
        }
        eyebrow="Customer receivables"
        title="Collections"
        text="Track incoming amounts expected from clients and customers."
      />
      <Toolbar query={query} setQuery={setQuery} />
      <DataTable
        empty="No open collection reminders yet."
        headers={["Title", "Client", "Amount", "Due date", "Status", "Actions"]}
        rows={rows.map((collection) => [
          <RecordTitle key="title" title={collection.title} notes={collection.notes} />,
          collection.client_name,
          currency.format(toNumber(collection.amount)),
          collection.due_date,
          <StatusPill key="status" status={computedCollectionStatus(collection)} />,
          <RowActions
            key="actions"
            canMarkPaid={collection.status !== "collected"}
            markActionLabel="Mark collected"
            onDelete={() => remove(collection.id)}
            onEdit={() => { setEditing(collection); setFormOpen(true); }}
            onMarkPaid={() => markCollected(collection.id)}
          />,
        ])}
      />
      {formOpen && (
        <CollectionForm
          initial={editing}
          onClose={() => { setEditing(null); setFormOpen(false); }}
          onSubmit={saveCollection}
        />
      )}
    </div>
  );
}

function computedCollectionStatus(collection: CollectionReminder) {
  if (collection.status === "collected") return "collected";
  if (collection.status === "overdue" || isBeforeToday(collection.due_date)) return "overdue";
  if (isToday(collection.due_date)) return "due today";
  return "pending";
}

function PageHeader({
  action,
  eyebrow,
  text,
  title,
}: {
  action?: ReactNode;
  eyebrow: string;
  text: string;
  title: string;
}) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {action}
    </header>
  );
}

function Toolbar({
  children,
  query,
  setQuery,
}: {
  children?: ReactNode;
  query: string;
  setQuery: (query: string) => void;
}) {
  return (
    <div className="toolbar">
      <label className="search-box">
        <Search size={17} />
        <input
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search records"
          type="search"
          value={query}
        />
      </label>
      {children}
    </div>
  );
}

function DataTable({
  empty,
  headers,
  onRowClick,
  rows,
}: {
  empty: string;
  headers: string[];
  onRowClick?: (rowIndex: number) => void;
  rows: ReactNode[][];
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="empty-table" colSpan={headers.length}>
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr
                className={onRowClick ? "clickable-row" : undefined}
                key={index}
                onClick={onRowClick ? () => onRowClick(index) : undefined}
                onKeyDown={onRowClick ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onRowClick(index);
                  }
                } : undefined}
                tabIndex={onRowClick ? 0 : undefined}
              >
                {row.map((cell, cellIndex) => (
                  <td data-label={headers[cellIndex]} key={cellIndex}>
                    {cell}
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

function RecordTitle({ notes, title }: { notes: string; title: string }) {
  return (
    <div className="record-title">
      <strong>{title}</strong>
      {notes && <span>{notes}</span>}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  return <span className={`status ${status.replace(" ", "-")}`}>{status}</span>;
}

function RowActions({
  canMarkPaid,
  markActionLabel = "Mark paid",
  onDelete,
  onEdit,
  onHistory,
  onMarkPaid,
}: {
  canMarkPaid?: boolean;
  markActionLabel?: string;
  onDelete: () => void;
  onEdit: () => void;
  onHistory?: () => void;
  onMarkPaid?: () => void;
}) {
  return (
    <div className="row-actions">
      {canMarkPaid && onMarkPaid && (
        <button aria-label={markActionLabel} onClick={onMarkPaid} title={markActionLabel} type="button">
          <CheckCircle2 size={16} />
        </button>
      )}
      <button aria-label="Edit" onClick={onEdit} title="Edit" type="button">
        <Pencil size={16} />
      </button>
      {onHistory && (
        <button aria-label="Payroll history" onClick={onHistory} title="Payroll history" type="button">
          <CalendarClock size={16} />
        </button>
      )}
      <button aria-label="Delete" onClick={onDelete} title="Delete" type="button">
        <Trash2 size={16} />
      </button>
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
  type FormTab = "personal" | "employment" | "documents";
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
          monthly_salary: String(initial.monthly_salary),
          sss_number: initial.sss_number,
          philhealth_number: initial.philhealth_number,
          pagibig_number: initial.pagibig_number,
          tin_number: initial.tin_number,
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
  const completedFields = [values.full_name, values.position_id, values.email, values.contact_number, values.hire_date, values.sss_number, values.philhealth_number, values.pagibig_number, values.tin_number].filter(Boolean).length;
  const totalFields = 9;

  const tabs: { id: FormTab; icon: ReactNode; label: string }[] = [
    { id: "personal", icon: <Users size={16} />, label: "Personal" },
    { id: "employment", icon: <Briefcase size={16} />, label: "Employment" },
    { id: "documents", icon: <FileText size={16} />, label: "Documents" },
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
                  <TextField label="Email address" type="email" value={values.email} onChange={(email) => setValues({ ...values, email })} />
                  <TextField label="Contact number" value={values.contact_number} onChange={(contact_number) => setValues({ ...values, contact_number })} />
                  <label className="full">
                    Address
                    <textarea rows={2} value={values.address} onChange={(event) => setValues({ ...values, address: event.target.value })} placeholder="Street, city, province" />
                  </label>
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
                        setValues({
                          ...values,
                          position_id: event.target.value,
                          role: position?.name ?? "",
                          department: position?.department ?? "",
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
              <strong>{values.contact_number || "—"}</strong>
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
        <TextField label="Contact number" value={values.contact_number} onChange={(contact_number) => setValues({ ...values, contact_number })} />
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

function PayrollRunForm({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (values: PayrollRunFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState<PayrollRunFormValues>(emptyPayrollRun);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    await onSubmit(values);
    setBusy(false);
  }

  return (
    <Modal title="Generate payroll" onClose={onClose}>
      <form className="form-grid" onSubmit={handleSubmit}>
        <label>
          Payroll month
          <select value={values.period_month} onChange={(event) => setValues({ ...values, period_month: event.target.value })}>
            {monthNames.map((month, index) => (
              <option key={month} value={index + 1}>
                {month}
              </option>
            ))}
          </select>
        </label>
        <TextField label="Payroll year" min="1900" max="2200" type="number" value={values.period_year} onChange={(period_year) => setValues({ ...values, period_year })} required />
        <label>
          Pay period
          <select value={values.pay_period} onChange={(event) => setValues({ ...values, pay_period: event.target.value as PayrollRunFormValues["pay_period"] })}>
            <option value="first_half">First half</option>
            <option value="second_half">Second half</option>
          </select>
        </label>
        <TextField label="Generated date" type="date" value={values.generated_date} onChange={(generated_date) => setValues({ ...values, generated_date })} required />
        <label className="full">
          Notes
          <textarea rows={3} value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} />
        </label>
        <FormActions busy={busy} onClose={onClose} />
      </form>
    </Modal>
  );
}

function PaymentForm({
  initial,
  onClose,
  onSubmit,
}: {
  initial: PaymentReminder | null;
  onClose: () => void;
  onSubmit: (values: PaymentFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState<PaymentFormValues>(
    initial
      ? {
          title: initial.title,
          type: initial.type,
          amount: String(initial.amount),
          due_date: initial.due_date,
          status: initial.status,
          notes: initial.notes,
        }
      : emptyPayment,
  );
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!values.title.trim() || !values.amount || !values.due_date) return;
    setBusy(true);
    await onSubmit(values);
    setBusy(false);
  }

  return (
    <Modal title={initial ? "Edit payment" : "Add payment"} onClose={onClose}>
      <form className="form-grid" onSubmit={handleSubmit}>
        <TextField label="Title" value={values.title} onChange={(title) => setValues({ ...values, title })} required />
        <label>
          Type
          <select value={values.type} onChange={(event) => setValues({ ...values, type: event.target.value as PaymentFormValues["type"] })}>
            <option value="loan">Loan</option>
            <option value="bill">Bill</option>
          </select>
        </label>
        <TextField label="Amount" min="0" step="0.01" type="number" value={values.amount} onChange={(amount) => setValues({ ...values, amount })} required />
        <TextField label="Due date" type="date" value={values.due_date} onChange={(due_date) => setValues({ ...values, due_date })} required />
        <label>
          Status
          <select value={values.status} onChange={(event) => setValues({ ...values, status: event.target.value as PaymentFormValues["status"] })}>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="overdue">Overdue</option>
          </select>
        </label>
        <label className="full">
          Notes
          <textarea rows={4} value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} />
        </label>
        <FormActions busy={busy} onClose={onClose} />
      </form>
    </Modal>
  );
}

function CollectionForm({
  initial,
  onClose,
  onSubmit,
}: {
  initial: CollectionReminder | null;
  onClose: () => void;
  onSubmit: (values: CollectionFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState<CollectionFormValues>(
    initial
      ? {
          title: initial.title,
          client_name: initial.client_name,
          amount: String(initial.amount),
          due_date: initial.due_date,
          status: initial.status,
          notes: initial.notes,
        }
      : emptyCollection,
  );
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!values.title.trim() || !values.client_name.trim() || !values.amount || !values.due_date) return;
    setBusy(true);
    await onSubmit(values);
    setBusy(false);
  }

  return (
    <Modal title={initial ? "Edit collection" : "Add collection"} onClose={onClose}>
      <form className="form-grid" onSubmit={handleSubmit}>
        <TextField label="Title" value={values.title} onChange={(title) => setValues({ ...values, title })} required />
        <TextField label="Client / customer" value={values.client_name} onChange={(client_name) => setValues({ ...values, client_name })} required />
        <TextField label="Amount" min="0" step="0.01" type="number" value={values.amount} onChange={(amount) => setValues({ ...values, amount })} required />
        <TextField label="Due date" type="date" value={values.due_date} onChange={(due_date) => setValues({ ...values, due_date })} required />
        <label>
          Status
          <select value={values.status} onChange={(event) => setValues({ ...values, status: event.target.value as CollectionFormValues["status"] })}>
            <option value="pending">Pending</option>
            <option value="collected">Collected</option>
            <option value="overdue">Overdue</option>
          </select>
        </label>
        <label className="full">
          Notes
          <textarea rows={4} value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} />
        </label>
        <FormActions busy={busy} onClose={onClose} />
      </form>
    </Modal>
  );
}

function TextField({
  label,
  max,
  min,
  onChange,
  required,
  step,
  type = "text",
  value,
}: {
  label: string;
  max?: string;
  min?: string;
  onChange: (value: string) => void;
  required?: boolean;
  step?: string;
  type?: string;
  value: string;
}) {
  return (
    <label>
      {label}
      <input
        max={max}
        min={min}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        step={step}
        type={type}
        value={value}
      />
    </label>
  );
}

function Modal({
  children,
  onClose,
  title,
}: {
  children: ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-label={title} aria-modal="true" className="modal" role="dialog">
        <header>
          <h2>{title}</h2>
          <button aria-label="Close" onClick={onClose} type="button">
            x
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function FormActions({ busy, onClose }: { busy: boolean; onClose: () => void }) {
  return (
    <div className="form-actions full">
      <button className="secondary-button" onClick={onClose} type="button">
        Cancel
      </button>
      <button className="primary-button compact" disabled={busy} type="submit">
        {busy && <Spinner size="small" />}
        {busy ? "Saving..." : "Save"}
      </button>
    </div>
  );
}
