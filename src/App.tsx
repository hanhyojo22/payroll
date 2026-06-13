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
  loadCollections,
  loadDailyTicketEntries,
  loadEmployees,
  loadPayments,
  loadPayrollRuns,
  loadSalaryBonds,
} from "./lib/supabaseData";
import type {
  CollectionFormValues,
  CollectionReminder,
  DailyTicketEntry,
  Employee,
  EmployeeFormValues,
  PaymentFormValues,
  PaymentReminder,
  PayrollRun,
  PayrollRunFormValues,
  PayrollRunItem,
  PayrollRunWithItems,
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
type ResourceKey = "collections" | "dailyTicketEntries" | "employees" | "payments" | "payrollRuns" | "salaryBonds";
type ResourceStatus = "idle" | "loading" | "ready";
type Notice = { type: "success" | "error"; text: string } | null;
type AppError = { message?: string; code?: string; details?: string | null };

const initialResourceStatuses: Record<ResourceKey, ResourceStatus> = {
  collections: "idle",
  dailyTicketEntries: "idle",
  employees: "idle",
  payments: "idle",
  payrollRuns: "idle",
  salaryBonds: "idle",
};

const viewPaths: Record<View, string> = {
  dashboard: "/dashboard",
  employees: "/employees",
  "employee-add": "/employees/new",
  compensation: "/compensation",
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
  dashboard: ["employees", "payrollRuns", "payments", "collections"],
  employees: ["employees", "payrollRuns"],
  "employee-add": ["employees", "payrollRuns"],
  compensation: [],
  "daily-tickets": ["employees", "dailyTicketEntries"],
  "salary-bonds": ["employees", "salaryBonds"],
  payroll: ["employees", "dailyTicketEntries", "payrollRuns"],
  "payroll-history": ["employees", "payrollRuns"],
  payments: ["payments"],
  "payment-history": ["payments"],
  collections: ["collections"],
  "collection-history": ["collections"],
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
  bond_id: "",
  amount: "",
  balance: "",
  deduction_per_payroll: "",
  status: "active",
  notes: "",
};

const emptyEmployee: EmployeeFormValues = {
  full_name: "",
  role: "",
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
          <CalendarClock size={30} />
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
  const [payments, setPayments] = useState<PaymentReminder[]>([]);
  const [collections, setCollections] = useState<CollectionReminder[]>([]);
  const [dailyTicketEntries, setDailyTicketEntries] = useState<DailyTicketEntry[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [payrollRuns, setPayrollRuns] = useState<PayrollRunWithItems[]>([]);
  const [salaryBonds, setSalaryBonds] = useState<SalaryBond[]>([]);
  const [resourceStatuses, setResourceStatuses] = useState(initialResourceStatuses);
  const [notice, setNotice] = useState<Notice>(null);

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

    setResourceStatuses((current) => current[resource] === "ready" ? current : { ...current, [resource]: "loading" });

    try {
      const result = await (async () => {
        switch (resource) {
          case "collections":
            return loadCollections(supabase);
          case "dailyTicketEntries":
            return loadDailyTicketEntries(supabase);
          case "employees":
            return loadEmployees(supabase);
          case "payments":
            return loadPayments(supabase);
          case "payrollRuns":
            return loadPayrollRuns(supabase);
          case "salaryBonds":
            return loadSalaryBonds(supabase);
        }
      })();

      if (result.error) {
        setResourceStatuses((current) => ({ ...current, [resource]: previousStatus === "ready" ? "ready" : "idle" }));
        return;
      }

      switch (resource) {
        case "collections":
          setCollections(result.data as CollectionReminder[]);
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
        case "payrollRuns":
          setPayrollRuns(result.data as PayrollRunWithItems[]);
          break;
        case "salaryBonds":
          setSalaryBonds(result.data as SalaryBond[]);
          break;
      }

      setResourceStatuses((current) => ({ ...current, [resource]: "ready" }));
    } catch (error) {
      setResourceStatuses((current) => ({ ...current, [resource]: previousStatus === "ready" ? "ready" : "idle" }));
    }
  }

  async function loadPageData(targetView: View, force = false) {
    await Promise.all(viewResources[targetView].map((resource) => loadResource(resource, force)));
  }

  async function refreshEmployeesPage() {
    await Promise.all([loadResource("employees", true), loadResource("payrollRuns", true)]);
  }

  async function refreshDailyTicketsPage() {
    await loadResource("dailyTicketEntries", true);
  }

  async function refreshPayrollPage() {
    await loadResource("payrollRuns", true);
  }

  async function refreshPaymentsPage() {
    await loadResource("payments", true);
  }

  async function refreshCollectionsPage() {
    await loadResource("collections", true);
  }

  async function refreshSalaryBonds() {
    await loadResource("salaryBonds", true);
  }

  useEffect(() => {
    const handlePopState = () => setView(viewFromPath(window.location.pathname));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    void loadPageData(view);
  }, [view]);

  async function signOut() {
    await supabase?.auth.signOut();
  }

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
          <NavButton active={view === "compensation"} icon={<Briefcase size={18} />} label="Compensation" onClick={() => navigate("compensation")} />
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
          <>
              {view === "dashboard" && (
                <Dashboard collections={collections} employees={employees} payments={payments} payrollRuns={payrollRuns} />
              )}
              {view === "employees" && (
                <EmployeesView
                  employees={employees}
                  onChange={refreshEmployeesPage}
                  payrollRuns={payrollRuns}
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
                payrollRuns={payrollRuns}
                setNotice={setNotice}
                userId={session.user.id}
              />
            )}
              {view === "compensation" && (
                <EmployeeCompensationSetupView />
              )}
              {view === "daily-tickets" && (
                <DailyTicketEntryView
                  dailyTicketEntries={dailyTicketEntries}
                  employees={employees}
                  onChange={refreshDailyTicketsPage}
                  setNotice={setNotice}
                  userId={session.user.id}
                />
              )}
              {view === "salary-bonds" && (
                <SalaryBondsView
                  employees={employees}
                  onChange={refreshSalaryBonds}
                  salaryBonds={salaryBonds}
                  setNotice={setNotice}
                  userId={session.user.id}
                />
              )}
              {view === "payroll" && (
                <PayrollView
                  dailyTicketEntries={dailyTicketEntries}
                  employees={employees}
                  onChange={refreshPayrollPage}
                  payrollRuns={payrollRuns}
                  setNotice={setNotice}
                  userId={session.user.id}
                />
              )}
              {view === "payroll-history" && (
                <PayrollHistoryView employees={employees} payrollRuns={payrollRuns} />
              )}
              {view === "payments" && (
                <PaymentsView
                  onChange={refreshPaymentsPage}
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
                  setNotice={setNotice}
                  userId={session.user.id}
                />
              )}
              {view === "collection-history" && (
                <CollectionHistoryView collections={collections} />
              )}
          </>
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

function Dashboard({
  collections,
  employees,
  payments,
  payrollRuns,
}: {
  collections: CollectionReminder[];
  employees: Employee[];
  payments: PaymentReminder[];
  payrollRuns: PayrollRunWithItems[];
}) {
  const activeEmployees = employees.filter((employee) => employee.status === "active");
  const latestRun = payrollRuns[0];
  const currentRuns = payrollRuns.filter(
    (run) =>
      run.period_month === Number(currentMonth()) &&
      run.period_year === Number(currentYear()),
  );
  const currentItems = currentRuns.flatMap((run) => run.items);
  const pendingPayroll = currentItems
    .filter((item) => item.status !== "paid")
    .reduce((sum, item) => sum + toNumber(item.net_pay), 0);
  const paidPayroll = currentItems
    .filter((item) => item.status === "paid")
    .reduce((sum, item) => sum + toNumber(item.net_pay), 0);
  const unpaidPayments = payments.filter((item) => item.status !== "paid");
  const overduePayments = unpaidPayments.filter((item) => isBeforeToday(item.due_date));
  const dueTodayPayments = unpaidPayments.filter((item) => isToday(item.due_date));
  const openCollections = collections.filter((item) => item.status !== "collected");
  const pendingCollections = openCollections.reduce((sum, item) => sum + toNumber(item.amount), 0);
  const collectedTotal = collections
    .filter((item) => item.status === "collected")
    .reduce((sum, item) => sum + toNumber(item.amount), 0);
  const overdueCollections = openCollections.filter((item) => isBeforeToday(item.due_date));
  const dueTodayCollections = openCollections.filter((item) => isToday(item.due_date));

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Payroll overview"
        title="Dashboard"
        text="Monitor employees, payroll runs, payment reminders, and receivables."
      />
      <section className="metric-grid">
        <Metric icon={<Users />} label="Active employees" value={activeEmployees.length} />
        <Metric icon={<CalendarClock />} label="Current payroll" value={currentItems.length} />
        <Metric icon={<BadgeDollarSign />} label="Pending payroll" value={currency.format(pendingPayroll)} />
        <Metric icon={<CheckCircle2 />} label="Paid payroll" value={currency.format(paidPayroll)} tone="success" />
        <Metric icon={<BadgeDollarSign />} label="Pending collections" value={currency.format(pendingCollections)} />
        <Metric icon={<CheckCircle2 />} label="Collected total" value={currency.format(collectedTotal)} tone="success" />
      </section>
      <section className="summary-band">
        <div>
          <p className="eyebrow">Latest generated date</p>
          <h2>{latestRun ? latestRun.generated_date : "No payroll yet"}</h2>
        </div>
        <p>
          {latestRun
            ? `${monthNames[latestRun.period_month - 1]} ${latestRun.period_year} - ${payPeriodLabel(latestRun.pay_period)} has ${latestRun.items.length} payroll items.`
            : "Create employees first, then generate a monthly payroll run."}
        </p>
      </section>
      <section className="two-column">
        <DueList title="Payments due today" rows={dueTodayPayments} />
        <DueList title="Overdue payments" rows={overduePayments} empty="No overdue payment reminders." />
        <DueList title="Collections due today" rows={dueTodayCollections} />
        <DueList title="Overdue collections" rows={overdueCollections} empty="No overdue collections." />
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
  salaryBonds,
  setNotice,
  userId,
}: {
  employees: Employee[];
  onChange: () => Promise<void>;
  salaryBonds: SalaryBond[];
  setNotice: (notice: Notice) => void;
  userId: string;
}) {
  const [bondForm, setBondForm] = useState<SalaryBondFormValues>(emptySalaryBond);
  const [editingBond, setEditingBond] = useState<SalaryBond | null>(null);
  const activeSalaryBonds = salaryBonds.filter((bond) => bond.status !== "archived");
  const salaryBondBalance = activeSalaryBonds.reduce((sum, bond) => sum + toNumber(bond.balance), 0);

  async function saveSalaryBond(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    const employee = employees.find((item) => item.id === bondForm.employee_id);
    if (!employee) {
      setNotice({ type: "error", text: "Select an employee for the salary bond." });
      return;
    }

    const amount = toNumber(bondForm.amount);
    const balance = bondForm.balance ? toNumber(bondForm.balance) : amount;
    const payload = {
      user_id: userId,
      employee_id: employee.id,
      employee_name: employee.full_name,
      bond_id: bondForm.bond_id.trim(),
      purpose: bondForm.bond_id.trim(),
      amount,
      balance,
      deduction_per_payroll: toNumber(bondForm.deduction_per_payroll),
      status: bondForm.status,
      notes: bondForm.notes.trim(),
    };
    const result = editingBond
      ? await supabase.from("salary_bonds").update(payload).eq("id", editingBond.id)
      : await supabase.from("salary_bonds").insert(payload);

    if (result.error) {
      setNotice({ type: "error", text: friendlyError(result.error) });
      return;
    }

    setBondForm(emptySalaryBond);
    setEditingBond(null);
    setNotice({ type: "success", text: "Salary bond saved." });
    await onChange();
  }

  async function updateSalaryBondStatus(bond: SalaryBond, status: SalaryBond["status"]) {
    if (!supabase) return;
    const payload = status === "completed" ? { status, balance: 0 } : { status };
    const { error } = await supabase.from("salary_bonds").update(payload).eq("id", bond.id);
    if (error) {
      setNotice({ type: "error", text: friendlyError(error) });
      return;
    }

    setNotice({ type: "success", text: `${bond.bond_id} updated.` });
    await onChange();
  }

  function editSalaryBond(bond: SalaryBond) {
    setEditingBond(bond);
    setBondForm({
      amount: String(bond.amount),
      balance: String(bond.balance),
      deduction_per_payroll: String(bond.deduction_per_payroll),
      employee_id: bond.employee_id ?? "",
      notes: bond.notes,
      bond_id: bond.bond_id,
      status: bond.status,
    });
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Employee salary bond"
        title="Salary Bond"
        text="Create, monitor, and update employee salary bond deductions."
      />
      <section className="metric-grid">
        <Metric icon={<CreditCard />} label="Active bonds" value={activeSalaryBonds.length} />
        <Metric icon={<BadgeDollarSign />} label="Open balance" value={currency.format(salaryBondBalance)} />
      </section>
      <section className="panel salary-bond-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Bond Details</p>
            <h2>{editingBond ? "Edit Salary Bond" : "New Salary Bond"}</h2>
          </div>
          {editingBond && (
            <button className="secondary-button compact" onClick={() => { setEditingBond(null); setBondForm(emptySalaryBond); }} type="button">
              Cancel Edit
            </button>
          )}
        </div>
        <form className="salary-bond-form" onSubmit={saveSalaryBond}>
          <label>
            Employee
            <select
              required
              value={bondForm.employee_id}
              onChange={(event) => setBondForm({ ...bondForm, employee_id: event.target.value })}
            >
              <option value="">Select employee</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.full_name}</option>
              ))}
            </select>
          </label>
          <label>
            Bond ID
            <input required value={bondForm.bond_id} onChange={(event) => setBondForm({ ...bondForm, bond_id: event.target.value })} />
          </label>
          <label>
            Amount
            <input min="0" required type="number" value={bondForm.amount} onChange={(event) => setBondForm({ ...bondForm, amount: event.target.value })} />
          </label>
          <label>
            Balance
            <input min="0" type="number" value={bondForm.balance} onChange={(event) => setBondForm({ ...bondForm, balance: event.target.value })} />
          </label>
          <label>
            Deduction/Payroll
            <input min="0" required type="number" value={bondForm.deduction_per_payroll} onChange={(event) => setBondForm({ ...bondForm, deduction_per_payroll: event.target.value })} />
          </label>
          <label>
            Status
            <select value={bondForm.status} onChange={(event) => setBondForm({ ...bondForm, status: event.target.value as SalaryBond["status"] })}>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <button className="primary-button compact" type="submit">
            <Save size={16} />
            {editingBond ? "Save Bond" : "Add Bond"}
          </button>
        </form>
        <DataTable
          empty="No salary bonds yet."
          headers={["Employee", "Bond ID", "Amount", "Balance", "Deduction/Payroll", "Status", "Action"]}
          rows={activeSalaryBonds.map((bond) => [
            bond.employee_name,
            bond.bond_id,
            currency.format(toNumber(bond.amount)),
            currency.format(toNumber(bond.balance)),
            currency.format(toNumber(bond.deduction_per_payroll)),
            <StatusPill key="status" status={bond.status} />,
            <div className="salary-bond-actions" key="actions">
              <button onClick={() => setNotice({ type: "success", text: `${bond.bond_id}: ${bond.notes || bond.purpose}` })} type="button">
                View Details
              </button>
              <button onClick={() => editSalaryBond(bond)} type="button">Edit</button>
              <button onClick={() => updateSalaryBondStatus(bond, "completed")} type="button">Mark Completed</button>
              <button onClick={() => updateSalaryBondStatus(bond, "archived")} type="button">Archive</button>
            </div>,
          ])}
        />
      </section>
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

type DailyTicketDraft = {
  employee: Employee;
  employeeCode: string;
  installation: number;
  repair: number;
  savedValues?: { installation: number; repair: number };
  status: "pending" | "saved";
};

export function DailyTicketEntryView({
  dailyTicketEntries,
  employees,
  onChange,
  setNotice,
  userId,
}: {
  dailyTicketEntries: DailyTicketEntry[];
  employees: Employee[];
  onChange: () => Promise<void>;
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
    const { error } = await supabase
      .from("daily_ticket_entries")
      .upsert(payload, { onConflict: "user_id,entry_date,employee_id" });

    if (error) {
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
    const { error } = await supabase
      .from("daily_ticket_entries")
      .upsert(payload, { onConflict: "user_id,entry_date,employee_id" });

    if (error) {
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
  payrollRuns,
  setNotice,
  userId,
}: {
  employees: Employee[];
  mode?: "list" | "add";
  onChange: () => Promise<void>;
  onExitForm?: () => void;
  payrollRuns: PayrollRunWithItems[];
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
        payrollRuns={payrollRuns}
        setNotice={setNotice}
      />
    );
  }

  if (formOpen) {
    return (
      <div className="page-stack">
        <header className="employee-form-heading">
          <button className="text-button" onClick={() => { setEditing(null); setFormOpen(false); }} type="button">
            Employees
          </button>
          <h1>{editing ? "Edit Employee" : "Add New Employee"}</h1>
          <p>
            <span>Dashboard</span>
            <ChevronDown size={14} />
            <span>Employees</span>
            <ChevronDown size={14} />
            <strong>{editing ? "Edit" : "Add New"}</strong>
          </p>
        </header>
        <div className="employee-entry-layout">
          <EmployeeForm
            embedded
            initial={editing}
            onClose={closeForm}
            onSubmit={saveEmployee}
          />
          <EmployeePositionPanel />
        </div>
      </div>
    );
  }

  async function saveEmployee(values: EmployeeFormValues) {
    if (!supabase) return;
    const payload = {
      full_name: values.full_name.trim(),
      role: values.role.trim(),
      department: values.department.trim(),
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
    const result = editing
      ? await supabase.from("employees").update(payload).eq("id", editing.id)
      : await supabase.from("employees").insert(payload);

    if (result.error) {
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
  payrollRuns,
  setNotice,
}: {
  employee: Employee;
  onChange: () => Promise<void>;
  onBack: () => void;
  onEmployeeUpdate: (employee: Employee) => void;
  payrollRuns: PayrollRunWithItems[];
  setNotice: (notice: Notice) => void;
}) {
  const [activeTab, setActiveTab] = useState<"information" | "payroll" | "tickets" | "salary-bond" | "payments" | "documents">("tickets");
  const [currentEmployee, setCurrentEmployee] = useState(employee);
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

  async function saveTicketRate(type: "installation" | "repair") {
    if (!supabase) return;
    const value = Math.max(0, toNumber(rateDrafts[type]));
    const column = type === "installation" ? "installation_rate" : "repair_rate";
    const { data, error } = await supabase
      .from("employees")
      .update({ [column]: value })
      .eq("id", currentEmployee.id)
      .select()
      .single();

    if (error) {
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

  const history = payrollRuns
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
  const salaryBonds = history
    .filter(({ item }) => toNumber(item.deductions) > 0)
    .map(({ item, run }, index) => {
      const period = `${monthNames[run.period_month - 1]} ${run.period_year} - ${payPeriodLabel(run.pay_period)}`;
      const amount = toNumber(item.deductions);
      const status = item.status === "paid" ? "completed" : "active";

      return {
        amount,
        balance: status === "completed" ? 0 : amount,
        bondId: `SB-${run.period_year}-${String(run.period_month).padStart(2, "0")}-${String(index + 1).padStart(3, "0")}`,
        deductionPayroll: `${currency.format(amount)} / ${period}`,
        purpose: item.notes || "Salary bond",
        status,
      };
    });
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
              <DetailItem label="Monthly salary" value={currency.format(toNumber(currentEmployee.monthly_salary))} />
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
          <div className="ticket-wages-layout">
            <section className="employee-detail-card ticket-wages-main">
              <div className="ticket-section-heading">
                <div>
                  <h3>Commission per Closed Ticket</h3>
                  <p>Define the wage/commission for each ticket type when closed.</p>
                </div>
                <button className="primary-button compact" type="button">
                  <Plus size={15} />
                  Add Ticket Type
                </button>
              </div>
              <div className="ticket-rate-list">
                <div className="ticket-rate-header">
                  <span>Ticket Type</span>
                  <span>Description</span>
                  <span>Wage per Closed Ticket</span>
                  <span>Status</span>
                  <span>Actions</span>
                </div>
                <TicketRateRow
                  description="Repair and troubleshooting services"
                  draftValue={rateDrafts.repair}
                  editing={editingRate === "repair"}
                  icon={<Wrench size={16} />}
                  onDraftChange={(value) => setRateDrafts((current) => ({ ...current, repair: value }))}
                  onEdit={() => setEditingRate("repair")}
                  onSave={() => saveTicketRate("repair")}
                  rate={repairRate}
                  title="Repair"
                  tone="green"
                />
                <TicketRateRow
                  description="Installation services for products/equipment"
                  draftValue={rateDrafts.installation}
                  editing={editingRate === "installation"}
                  icon={<Settings size={16} />}
                  onDraftChange={(value) => setRateDrafts((current) => ({ ...current, installation: value }))}
                  onEdit={() => setEditingRate("installation")}
                  onSave={() => saveTicketRate("installation")}
                  rate={installationRate}
                  title="Installation"
                  tone="blue"
                />
              </div>
              <div className="detail-note">
                <CheckCircle2 size={16} />
                <p>
                  <strong>How it works</strong>
                  Employee earnings are computed based on the number of closed tickets per type.
                  Example: 1 Repair ({currency.format(repairRate)}) + 1 Installation ({currency.format(installationRate)}) = {currency.format(repairRate + installationRate)}
                </p>
              </div>
              <div className="recent-ticket-table">
                <h3>Recent Closed Tickets</h3>
                <DataTable
                  empty="No closed tickets for this employee yet."
                  headers={["Ticket #", "Customer", "Ticket Type", "Closed Date", "Amount Earned"]}
                  rows={history.flatMap(({ item, run }) => {
                    return [
                      ...Array.from({ length: Math.min(3, normalizeTicketCount(item.repair_tickets)) }, (_, index) => [
                        `TK-${run.period_year}-${String(run.period_month).padStart(2, "0")}-R${index + 1}`,
                        currentEmployee.full_name,
                        <span className="ticket-type repair" key="type">Repair</span>,
                        run.generated_date,
                        currency.format(toNumber(item.repair_rate)),
                      ]),
                      ...Array.from({ length: Math.min(3, normalizeTicketCount(item.installation_tickets)) }, (_, index) => [
                        `TK-${run.period_year}-${String(run.period_month).padStart(2, "0")}-I${index + 1}`,
                        currentEmployee.full_name,
                        <span className="ticket-type installation" key="type">Installation</span>,
                        run.generated_date,
                        currency.format(toNumber(item.installation_rate)),
                      ]),
                    ];
                  }).slice(0, 6)}
                />
              </div>
            </section>
            <aside className="ticket-wages-side">
              <section className="employee-detail-card">
                <div className="side-card-heading">
                  <h3>Earnings Preview</h3>
                  <button className="secondary-button compact" type="button">
                    <CalendarClock size={14} />
                    This Month
                  </button>
                </div>
                <div className="earnings-list">
                  <div><span>Repair</span><span>{ticketTotals.repair}</span><strong>{currency.format(repairEarnings)}</strong></div>
                  <div><span>Installation</span><span>{ticketTotals.installation}</span><strong>{currency.format(installationEarnings)}</strong></div>
                  <div><strong>Total Estimated Earnings</strong><strong>{currency.format(totalTicketEarnings)}</strong></div>
                </div>
              </section>
              <section className="employee-detail-card">
                <h3>Summary</h3>
                <div className="summary-list">
                  <div><span>Total Closed Tickets</span><strong>{closedTickets}</strong></div>
                  <div><span>Average per Day</span><strong>{(closedTickets / 20).toFixed(2)}</strong></div>
                  <div><span>Commission Rate Basis</span><strong>Per Closed Ticket</strong></div>
                  <div><span>Last Updated</span><strong>{currentEmployee.updated_at ? new Date(currentEmployee.updated_at).toLocaleDateString() : "Not available"}</strong></div>
                  <div><span>Updated By</span><strong>Admin User</strong></div>
                </div>
                <div className="detail-note compact-note">
                  <CheckCircle2 size={16} />
                  <p>Changes to wages apply to tickets closed after the update.</p>
                </div>
              </section>
            </aside>
          </div>
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
              headers={["Employee", "Bond ID", "Purpose", "Amount", "Balance", "Deduction/Payroll", "Status", "Action"]}
              rows={salaryBonds.map((bond) => [
                currentEmployee.full_name,
                bond.bondId,
                bond.purpose,
                currency.format(bond.amount),
                currency.format(bond.balance),
                bond.deductionPayroll,
                <StatusPill key="status" status={bond.status} />,
                <div className="salary-bond-actions" key="actions">
                  <button
                    onClick={() => setNotice({ type: "success", text: `${bond.bondId} details selected.` })}
                    type="button"
                  >
                    View Details
                  </button>
                  <button
                    onClick={() => setNotice({ type: "success", text: `${bond.bondId} is ready to edit.` })}
                    type="button"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setNotice({ type: "success", text: `${bond.bondId} marked completed.` })}
                    type="button"
                  >
                    Mark Completed
                  </button>
                  <button
                    onClick={() => setNotice({ type: "success", text: `${bond.bondId} archived.` })}
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

export function PayrollView({
  dailyTicketEntries,
  employees,
  onChange,
  payrollRuns,
  setNotice,
  userId,
}: {
  dailyTicketEntries: DailyTicketEntry[];
  employees: Employee[];
  onChange: () => Promise<void>;
  payrollRuns: PayrollRunWithItems[];
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

  async function createRun(values: PayrollRunFormValues) {
    if (!supabase) return;
    const activeEmployees = employees.filter((employee) => employee.status === "active");
    if (activeEmployees.length === 0) {
      setNotice({ type: "error", text: "Add at least one active employee first." });
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

    const runResult = await supabase.from("payroll_runs").insert(runPayload).select().single();
    if (runResult.error) {
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
    const itemPayloads = activeEmployees.map((employee) =>
      payrollItemPayloadForEmployee(employee, newRun.id, userId, periodDailyEntries)
    );
    const itemResult = await supabase.from("payroll_run_items").insert(itemPayloads);
    if (itemResult.error) {
      setNotice({ type: "error", text: friendlyError(itemResult.error) });
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
    const gross = ticketGrossPay(installationTickets, repairTickets, installationRate, repairRate);
    const payload = {
      ...patch,
      installation_tickets: installationTickets,
      repair_tickets: repairTickets,
      installation_rate: installationRate,
      repair_rate: repairRate,
      gross_pay: gross,
      net_pay: netPay(gross, allowances, deductions),
    };
    const { error } = await supabase.from("payroll_run_items").update(payload).eq("id", item.id);
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
    const itemPayloads = missingEmployees.map((employee) =>
      payrollItemPayloadForEmployee(employee, selectedRun.id, userId, periodDailyEntries)
    );
    const { error } = await supabase.from("payroll_run_items").insert(itemPayloads);
    if (error) {
      setNotice({ type: "error", text: friendlyError(error) });
      return;
    }

    setNotice({
      type: "success",
      text: `${missingEmployees.length} employee${missingEmployees.length === 1 ? "" : "s"} added to payroll.`,
    });
    await onChange();
  }

  const totals = selectedRun?.items.reduce(
    (sum, item) => ({
      gross: sum.gross + toNumber(item.gross_pay),
      allowances: sum.allowances + toNumber(item.allowances),
      deductions: sum.deductions + toNumber(item.deductions),
      net: sum.net + toNumber(item.net_pay),
    }),
    { gross: 0, allowances: 0, deductions: 0, net: 0 },
  ) ?? { gross: 0, allowances: 0, deductions: 0, net: 0 };

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
            <p>Add them with daily ticket totals and rates based on each employee wage category.</p>
          </div>
          <button className="primary-button compact" onClick={addMissingEmployees} type="button">
            <Plus size={16} />
            Add missing employees
          </button>
        </section>
      )}
      {selectedRun ? (
        <PayrollItemsTable items={selectedRun.items} onUpdate={updateItem} />
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
      empty="No payroll items in this run."
      headers={["Employee", "Install tickets", "Repair tickets", "Gross", "Allowance", "Deduction", "Net", "Status", "Actions"]}
      rows={items.map((item) => [
        <RecordTitle
          key="employee"
          title={item.employee_name}
          notes={`Install ${currency.format(toNumber(item.installation_rate))} | Repair ${currency.format(toNumber(item.repair_rate))}${item.notes ? ` | ${item.notes}` : ""}`}
        />,
        <MoneyInput key="installation_tickets" step="1" value={item.installation_tickets} onSave={(value) => onUpdate(item, { installation_tickets: value })} />,
        <MoneyInput key="repair_tickets" step="1" value={item.repair_tickets} onSave={(value) => onUpdate(item, { repair_tickets: value })} />,
        currency.format(toNumber(item.gross_pay)),
        <MoneyInput key="allowances" value={item.allowances} onSave={(value) => onUpdate(item, { allowances: value })} />,
        <MoneyInput key="deductions" value={item.deductions} onSave={(value) => onUpdate(item, { deductions: value })} />,
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

function MoneyInput({
  onSave,
  step = "0.01",
  value,
}: {
  onSave: (value: number) => Promise<void>;
  step?: string;
  value: number;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  return (
    <input
      className="table-input"
      min="0"
      onBlur={() => {
        if (toNumber(draft) !== toNumber(value)) {
          onSave(toNumber(draft));
        }
      }}
      onChange={(event) => setDraft(event.target.value)}
      step={step}
      type="number"
      value={draft}
    />
  );
}

function PayrollHistoryView({
  employees,
  payrollRuns,
}: {
  employees: Employee[];
  payrollRuns: PayrollRunWithItems[];
}) {
  const [query, setQuery] = useState("");
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const rows = payrollRuns.flatMap((run) =>
    run.items.filter((item) => item.status === "paid").map((item, itemIndex) => {
      const employee = item.employee_id ? employeeById.get(item.employee_id) : undefined;
      const payrollNo = `${run.period_year}-${String(run.period_month).padStart(2, "0")}-${run.pay_period === "first_half" ? "1" : "2"}-${String(itemIndex + 1).padStart(3, "0")}`;
      const payPeriod = `${monthNames[run.period_month - 1]} ${run.period_year} - ${payPeriodLabel(run.pay_period)}`;
      const department = employee?.department || "Unassigned";
      const processedDate = item.paid_date || run.generated_date;
      return {
        cells: [
          payrollNo,
          payPeriod,
          item.employee_name,
          department,
          currency.format(toNumber(item.gross_pay)),
          currency.format(toNumber(item.deductions)),
          currency.format(toNumber(item.net_pay)),
          <StatusPill key="status" status={item.status} />,
          processedDate,
        ],
        searchText: `${payrollNo} ${payPeriod} ${item.employee_name} ${department} ${item.status} ${processedDate}`.toLowerCase(),
      };
    }),
  );
  const filteredRows = rows
    .filter((row) => row.searchText.includes(query.toLowerCase()))
    .map((row) => row.cells);

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
  payments,
  setNotice,
  userId,
}: {
  onChange: () => Promise<void>;
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
      title: values.title.trim(),
      type: values.type,
      amount: toNumber(values.amount),
      due_date: values.due_date,
      status: values.status,
      notes: values.notes.trim(),
      user_id: userId,
    };
    const result = editing
      ? await supabase.from("payment_reminders").update(payload).eq("id", editing.id)
      : await supabase.from("payment_reminders").insert(payload);

    if (result.error) {
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
    const { error } = await supabase.from("payment_reminders").update({ status: "paid" }).eq("id", id);
    setNotice(error ? { type: "error", text: friendlyError(error) } : { type: "success", text: "Marked paid." });
    await onChange();
  }

  async function remove(id: string) {
    if (!supabase || !window.confirm("Delete this payment reminder?")) return;
    const { error } = await supabase.from("payment_reminders").delete().eq("id", id);
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
  setNotice,
  userId,
}: {
  collections: CollectionReminder[];
  onChange: () => Promise<void>;
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
      title: values.title.trim(),
      client_name: values.client_name.trim(),
      amount: toNumber(values.amount),
      due_date: values.due_date,
      status: values.status,
      notes: values.notes.trim(),
      user_id: userId,
    };
    const result = editing
      ? await supabase.from("collection_reminders").update(payload).eq("id", editing.id)
      : await supabase.from("collection_reminders").insert(payload);

    if (result.error) {
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
    const { error } = await supabase.from("collection_reminders").update({ status: "collected" }).eq("id", id);
    setNotice(error ? { type: "error", text: friendlyError(error) } : { type: "success", text: "Marked collected." });
    await onChange();
  }

  async function remove(id: string) {
    if (!supabase || !window.confirm("Delete this collection reminder?")) return;
    const { error } = await supabase.from("collection_reminders").delete().eq("id", id);
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
}: {
  embedded?: boolean;
  initial: Employee | null;
  onClose: () => void;
  onSubmit: (values: EmployeeFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState<EmployeeFormValues>(
    initial
      ? {
          full_name: initial.full_name,
          role: initial.role,
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

  const form = (
    <form className={embedded ? "form-grid employee-form-grid" : "form-grid"} onSubmit={handleSubmit}>
      {embedded && (
        <>
          <div className="form-tabs full">
            <button className="active" type="button"><Users size={18} /> Personal Information</button>
            <button type="button"><CalendarClock size={18} /> Employment Details</button>
            <button type="button"><BadgeDollarSign size={18} /> Compensation</button>
            <button type="button"><CreditCard size={18} /> Documents</button>
          </div>
          <label
            className={values.profile_photo_url ? "profile-upload has-photo" : "profile-upload"}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              handlePhotoFile(event.dataTransfer.files[0] ?? null);
            }}
          >
            <span>Profile Photo</span>
            <input
              accept="image/png,image/jpeg"
              onChange={(event) => handlePhotoFile(event.target.files?.[0] ?? null)}
              type="file"
            />
            <div>
              {values.profile_photo_url ? (
                <img alt="Employee profile preview" src={values.profile_photo_url} />
              ) : (
                <>
                  <Plus size={30} />
                  <strong>Click to upload</strong>
                  <p>or drag and drop<br />PNG, JPG up to 2MB</p>
                </>
              )}
            </div>
            {photoError && <small>{photoError}</small>}
          </label>
        </>
      )}
      <TextField label="Full name" value={values.full_name} onChange={(full_name) => setValues({ ...values, full_name })} required />
      <TextField label="Role" value={values.role} onChange={(role) => setValues({ ...values, role })} />
      <TextField label="Department" value={values.department} onChange={(department) => setValues({ ...values, department })} />
      <TextField label="Contact number" value={values.contact_number} onChange={(contact_number) => setValues({ ...values, contact_number })} />
      <TextField label="Email" type="email" value={values.email} onChange={(email) => setValues({ ...values, email })} />
      <label>
        Status
        <select value={values.status} onChange={(event) => setValues({ ...values, status: event.target.value as EmployeeFormValues["status"] })}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </label>
      <label>
        Wage category
        <select value={values.wage_category} onChange={(event) => setValues({ ...values, wage_category: event.target.value as EmployeeFormValues["wage_category"] })}>
          <option value="new">New employee</option>
          <option value="special_old">Special/Old employee</option>
        </select>
      </label>
      <TextField label="Monthly salary" min="0" step="0.01" type="number" value={values.monthly_salary} onChange={(monthly_salary) => setValues({ ...values, monthly_salary })} />
      <TextField label="Hire date" type="date" value={values.hire_date} onChange={(hire_date) => setValues({ ...values, hire_date })} />
      <TextField label="SSS number" value={values.sss_number} onChange={(sss_number) => setValues({ ...values, sss_number })} />
      <TextField label="PhilHealth number" value={values.philhealth_number} onChange={(philhealth_number) => setValues({ ...values, philhealth_number })} />
      <TextField label="Pag-IBIG number" value={values.pagibig_number} onChange={(pagibig_number) => setValues({ ...values, pagibig_number })} />
      <TextField label="TIN number" value={values.tin_number} onChange={(tin_number) => setValues({ ...values, tin_number })} />
      <label className="full">
        Address
        <textarea rows={3} value={values.address} onChange={(event) => setValues({ ...values, address: event.target.value })} />
      </label>
      <label className="full">
        Notes
        <textarea rows={3} value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} />
      </label>
      <FormActions busy={busy} onClose={onClose} />
    </form>
  );

  if (embedded) {
    return <section className="employee-form-card">{form}</section>;
  }

  return (
    <Modal title={initial ? "Edit employee" : "Add employee"} onClose={onClose}>
      {form}
    </Modal>
  );
}

function EmployeePositionPanel() {
  return (
    <aside className="position-panel">
      <section>
        <h2>Position</h2>
        <label>
          Select Position <span>*</span>
          <select defaultValue="Software Developer">
            <option>Software Developer</option>
            <option>HR Manager</option>
            <option>Accountant</option>
          </select>
        </label>
      </section>
      <section>
        <h2>Department</h2>
        <label>
          Select Department <span>*</span>
          <select defaultValue="Information Technology">
            <option>Information Technology</option>
            <option>Operations</option>
            <option>Finance</option>
          </select>
        </label>
      </section>
      <section>
        <h2>Employment Type</h2>
        <label>
          Select Employment Type <span>*</span>
          <select defaultValue="Full-time">
            <option>Full-time</option>
            <option>Part-time</option>
            <option>Contract</option>
          </select>
        </label>
      </section>
      <div className="position-description">
        <strong>Position Description</strong>
        <p>Develops, tests, and maintains software applications and systems. Works with teams to deliver high-quality solutions.</p>
        <span>Reports to: IT Manager</span>
      </div>
      <div className="other-positions">
        <h3>Other Positions (Examples)</h3>
        {["HR Manager", "Accountant", "Sales Executive", "Customer Support", "Warehouse Staff"].map((position) => (
          <p key={position}><Plus size={14} /> {position}</p>
        ))}
        <button className="text-button" type="button">View all positions</button>
      </div>
    </aside>
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
        {busy ? "Saving..." : "Save"}
      </button>
    </div>
  );
}
