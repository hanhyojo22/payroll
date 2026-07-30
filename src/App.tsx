import { RepositoriesProvider, useRepositories } from "./app/RepositoriesProvider";
import { useDialog } from "./shared/components/useDialog";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import {
  BadgeDollarSign,
  ArrowLeft,
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
  HelpCircle,
  KeyRound,
  LogOut,
  Mail,
  Maximize2,
  Menu,
  MoreVertical,
  Pencil,
  Printer,
  RotateCw,
  Save,
  Search,
  Settings,
  Trash2,
  UserCheck,
  UserRound,
  Users,
  UserX,
  Wrench,
  X,
} from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { emailRedirectUrl, hasSupabaseConfig, supabase } from "./supabase";
import {
  netPay,
  normalizeTicketCount,
  ticketGrossPay,
} from "./domain/tickets";
import { computeSubconItem, countSubconTickets, countTicketsByType } from "./domain/billing";
import { expenseCyclesElapsedSince, expenseOverdueReferenceDate, expensePeriodDueDates } from "./domain/expenses";
import { computeDailyEarnings } from "./domain/attendance";
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
  loadSalaryBonds,
} from "./app/resources";
import { clearOfflineDataForUser, discardFailedMutations, getPendingMutations, queueMutation, readCachedResource, retryFailedMutations, writeCachedResource } from "./lib/offlineDb";
import { flushPendingMutations, isOfflineLikeError } from "./lib/offlineSync";
import { BillingFeature, BillingSettingsManager } from "./features/billing/BillingFeature";
import { CollectionHistoryFeature, CollectionsFeature } from "./features/collections/CollectionsFeature";
import { normalizeReceivable } from "./features/collections/mapping";
import { ExpenseCategoriesManager, ExpensesFeature } from "./features/expenses/ExpensesFeature";
import { PaymentsFeature } from "./features/payments/PaymentsFeature";
import { PayrollFeature, PayrollHistoryFeature, PayrollSettingsManager } from "./features/payroll/PayrollFeature";
import { ReportsFeature } from "./features/reports/ReportsFeature";
import { SalaryBondsFeature } from "./features/salaryBonds/SalaryBondsFeature";
import { normalizeSalaryBond } from "./features/salaryBonds/mapping";
import { SubcontractorsFeature } from "./features/subcontractors/SubcontractorsFeature";
import { Sidebar } from "./Sidebar";
import { NotificationService } from "./shared/notifications/NotificationService";
import { Spinner, SyncIndicator, PageSkeleton } from "./shared/components/Spinner";
// Lazy so the dashboard's own chart/icon code splits into its own chunk instead of shipping
// in the main bundle regardless of which view loads first.
const DashboardModern = lazy(() => import("./features/dashboard/DashboardFeature"));
const PositionsView = lazy(() => import("./features/positions/PositionsFeature"));
const EmployeesView = lazy(() => import("./features/employees/EmployeesFeature"));
import { DataTable } from "./shared/components/DataTable";
import { PageHeader, RecordTitle, Toolbar } from "./shared/components/PageLayout";
import { FormActions, Modal, PasswordField, RequiredMark, RowActions, TextField } from "./shared/components/FormLayout";
import type { QueueOfflineMutation } from "./shared/types";
import { currency, formatMoney, toNumber } from "./shared/utils/currency";
import { addDays, currentMonth, currentYear, isBeforeToday, isToday, monthNames, todayKey } from "./shared/utils/dates";
import { friendlyError, isConnectivityFailure, isInvalidCredentialsError } from "./shared/utils/errors";
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
  ResourceKey,
  SalaryBond,
} from "./types";

type View =
  | "attendance"
  | "billing"
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
  | "reports"
  | "payments"
  | "collections"
  | "collection-history"
  | "salary-bonds"
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
  salaryBonds: "idle",
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
  salaryBonds: false,
  subcontractorAdvances: false,
  subcontractors: false,
};

const viewPaths: Record<View, string> = {
  attendance: "/attendance",
  billing: "/billing",
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
  reports: "/reports",
  payments: "/payments",
  collections: "/collections",
  "collection-history": "/collections/history",
  "salary-bonds": "/salary-bonds",
  subcontractors: "/subcontractors",
};

const viewResources: Record<View, ResourceKey[]> = {
  attendance: ["positions", "employees", "attendanceEntries"],
  billing: ["billingRecords", "billingSettings", "dailyTicketEntries", "collections", "subcontractors", "subcontractorAdvances", "subconDailyTickets", "payments", "expenses", "expenseCategories"],
  "billing-settings": ["billingSettings", "subcontractors"],
  dashboard: ["dashboardSummary"],
  employees: ["employees", "positions", "payrollRuns", "employeeAdvances", "salaryBonds"],
  "employee-add": ["employees", "positions", "payrollRuns", "employeeAdvances", "salaryBonds"],
  expenses: ["employees", "expenses", "expenseCategories"],
  "personal-expenses": ["employees", "expenses", "expenseCategories"],
  "expense-categories": ["expenseCategories"],
  compensation: ["positions", "employees"],
  "daily-tickets": ["positions", "employees", "dailyTicketEntries", "subcontractors", "subconDailyTickets", "payrollRuns"],
  "daily-tickets-subcon": ["positions", "employees", "dailyTicketEntries", "subcontractors", "subconDailyTickets", "payrollRuns"],
  payroll: ["positions", "employees", "attendanceEntries", "dailyTicketEntries", "payrollRuns", "employeeAdvances", "salaryBonds", "payrollHistory", "payrollSettings", "expenses", "expenseCategories"],
  "payroll-settings": ["payrollSettings"],
  "payroll-history": ["positions", "employees", "attendanceEntries", "dailyTicketEntries", "payrollRuns", "employeeAdvances", "salaryBonds", "payrollHistory", "payrollSettings", "expenses", "expenseCategories"],
  reports: ["employees", "billingRecords", "billingSettings", "collections", "dailyTicketEntries", "payrollHistory", "expenses"],
  payments: ["expenses", "expenseCategories"],
  collections: ["collections"],
  "collection-history": ["collections"],
  "salary-bonds": ["employees", "salaryBonds"],
  subcontractors: ["subcontractors", "subcontractorAdvances", "subconDailyTickets", "billingRecords", "payments", "expenses", "expenseCategories"],
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

type HeaderNotificationItem = {
  amount: number;
  dateLabel: string;
  id: string;
  kind: "collection" | "expense" | "payment";
  title: string;
  urgency: "overdue" | "today" | "upcoming";
};

const viewBreadcrumbs: Record<View, BreadcrumbItem[]> = {
  attendance: [{ label: "Dashboard", view: "dashboard" }, { label: "Attendance", view: "attendance" }],
  billing: [{ label: "Dashboard", view: "dashboard" }, { label: "Billing", view: "billing" }],
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
  reports: [{ label: "Dashboard", view: "dashboard" }, { label: "Reports", view: "reports" }],
  payments: [{ label: "Dashboard", view: "dashboard" }, { label: "Payment History", view: "payments" }],
  collections: [{ label: "Dashboard", view: "dashboard" }, { label: "Collections", view: "collections" }],
  "collection-history": [{ label: "Dashboard", view: "dashboard" }, { label: "Collections", view: "collections" }, { label: "History", view: "collection-history" }],
  "salary-bonds": [{ label: "Dashboard", view: "dashboard" }, { label: "Salary Bonds", view: "salary-bonds" }],
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

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  // A password-recovery link logs the browser into a session scoped only to setting a new
  // password. Routing that straight into Workspace (as onAuthStateChange's session update
  // would otherwise do) would let a possibly-shared-computer recovery click land the visitor
  // in the full app with the previous owner's data, before the new password is even set.
  const [passwordRecovery, setPasswordRecovery] = useState(false);

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
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
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

  if (passwordRecovery && session) {
    return <ResetPassword onDone={() => setPasswordRecovery(false)} />;
  }

  if (!session) {
    return <Login />;
  }

  return (
    <RepositoriesProvider>
      <Workspace session={session} />
    </RepositoriesProvider>
  );
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
  const [mode, setMode] = useState<"sign-in" | "sign-up" | "forgot-password">("sign-in");
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [credentialsInvalid, setCredentialsInvalid] = useState(false);
  const rememberedEmailKey = "jms-login-email";
  // Defaults off for a fresh browser/first-time sign-in, which is the more privacy-conscious
  // choice on a shared computer -- but if an email was already remembered from a prior
  // session, keep the checkbox checked to match, so unchecking it reads as the deliberate
  // "forget this" action it actually is rather than a spontaneous mismatch with the prefilled field.
  const [rememberMe, setRememberMe] = useState(() =>
    typeof window !== "undefined" && Boolean(window.localStorage.getItem(rememberedEmailKey)));
  const authRedirectTo = emailRedirectUrl ?? (typeof window !== "undefined" ? window.location.origin : undefined);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const rememberedEmail = window.localStorage.getItem(rememberedEmailKey);
    if (rememberedEmail) setEmail(rememberedEmail);
  }, []);

  async function handleForgotPassword(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    const result = await supabase.auth.resetPasswordForEmail(email, { redirectTo: authRedirectTo });
    setBusy(false);
    // Neutral outcome regardless of whether the address is registered -- confirming or
    // denying that would let this form be used to check who has an account here.
    if (result.error && !isConnectivityFailure(result.error)) {
      NotificationService.showError(friendlyError(result.error));
      return;
    }
    setResetEmailSent(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);

    const result =
      mode === "sign-in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: authRedirectTo
              ? {
                  emailRedirectTo: authRedirectTo,
                }
              : undefined,
          });

    if (result.error) {
      // The invalid-credentials case gets its own dedicated inline message and red field
      // borders right where the user is looking, so it doesn't also need a toast repeating
      // the same thing. Every other sign-in failure (network, timeout, unconfirmed email)
      // has no such inline message, so it still needs the toast -- and previously always
      // showing "Incorrect email or password" here mislabeled those as a wrong password.
      if (mode === "sign-in" && isInvalidCredentialsError(result.error)) {
        setCredentialsInvalid(true);
        setPassword("");
      } else {
        NotificationService.showError(friendlyError(result.error));
        if (mode === "sign-in") setPassword("");
      }
    } else if (mode === "sign-up" && !result.data.session) {
      NotificationService.showSuccess("Account created. Please confirm your email before signing in.");
      setPassword("");
      setMode("sign-in");
    }
    if (!result.error && typeof window !== "undefined") {
      if (rememberMe) {
        window.localStorage.setItem(rememberedEmailKey, email);
      } else {
        window.localStorage.removeItem(rememberedEmailKey);
      }
    }
    setBusy(false);
  }

  if (mode === "forgot-password") {
    return (
      <main className="center-screen login-screen">
        <section className="auth-shell">
          <section className="auth-panel">
            <div className="auth-icon-badge" aria-hidden="true">
              <KeyRound size={28} />
            </div>
            <div className="auth-panel-copy">
              <p className="eyebrow">Payroll workspace</p>
              <h1>Reset Password</h1>
              <p>
                {resetEmailSent
                  ? "If an account exists for that email, a password reset link is on its way."
                  : "Enter your email and we'll send you a link to set a new password."}
              </p>
            </div>
            {resetEmailSent ? (
              <button
                className="primary-button auth-submit-button"
                onClick={() => { setMode("sign-in"); setResetEmailSent(false); }}
                type="button"
              >
                Back to sign in
              </button>
            ) : (
              <form onSubmit={handleForgotPassword} className="stack auth-form-stack">
                <div className="auth-input-shell">
                  <span className="auth-input-icon" aria-hidden="true"><Mail size={16} /></span>
                  <label>
                    Email Address<RequiredMark />
                    <input
                      autoComplete="email"
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="Enter your email"
                      required
                      type="email"
                      value={email}
                    />
                  </label>
                </div>
                <button className="primary-button auth-submit-button" disabled={busy} type="submit">
                  {busy && <Spinner size="small" />}
                  {busy ? "Please wait..." : "Send reset link"}
                </button>
                <p className="auth-footer-copy">
                  <button className="text-button auth-switch-button" onClick={() => setMode("sign-in")} type="button">
                    Back to sign in
                  </button>
                </p>
              </form>
            )}
          </section>
        </section>
      </main>
    );
  }

  return (
    <main className="center-screen login-screen">
      <section className="auth-shell">
        <section className="auth-panel">
          <div className="auth-icon-badge" aria-hidden="true">
            <KeyRound size={28} />
          </div>
          <div className="auth-panel-copy">
            <p className="eyebrow">Payroll workspace</p>
            <h1>{mode === "sign-in" ? "Welcome Back" : "Create Admin Account"}</h1>
            <p>
              {mode === "sign-in"
                ? "Sign in to your account to continue"
                : "Create the first admin account to start managing payroll, billing, and payouts."}
            </p>
          </div>
          <form onSubmit={handleSubmit} className="stack auth-form-stack">
            <div className="auth-input-shell">
              <span className="auth-input-icon" aria-hidden="true"><Mail size={16} /></span>
              <label>
                Email Address<RequiredMark />
                <input
                  autoComplete="email"
                  className={credentialsInvalid ? "field-invalid" : undefined}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setCredentialsInvalid(false);
                  }}
                  placeholder="Enter your email"
                  required
                  type="email"
                  value={email}
                />
              </label>
            </div>
            <div className="auth-input-shell auth-password-shell">
              <span className="auth-input-icon" aria-hidden="true"><KeyRound size={16} /></span>
              <PasswordField
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                className={credentialsInvalid ? "field-invalid" : undefined}
                label="Password"
                minLength={6}
                onChange={(value) => {
                  setPassword(value);
                  setCredentialsInvalid(false);
                }}
                placeholder="Enter your password"
                required
                value={password}
              />
            </div>
            {mode === "sign-in" ? (
              <div className="auth-utility-row">
                <label className="auth-checkbox">
                  <input
                    checked={rememberMe}
                    onChange={(event) => setRememberMe(event.target.checked)}
                    type="checkbox"
                  />
                  <span>Remember me</span>
                </label>
                <button
                  className="text-button auth-forgot-button"
                  onClick={() => { setMode("forgot-password"); setCredentialsInvalid(false); }}
                  type="button"
                >
                  Forgot password?
                </button>
              </div>
            ) : null}
            {credentialsInvalid ? (
              <p className="auth-inline-error">Incorrect email or password. Please try again.</p>
            ) : null}
            <button className="primary-button auth-submit-button" disabled={busy} type="submit">
              {busy && <Spinner size="small" />}
              {busy ? "Please wait..." : mode === "sign-in" ? "Sign in" : "Create admin"}
            </button>
            {mode === "sign-up" ? (
              <p className="auth-helper-copy">A confirmation email will be sent to this address after registration.</p>
            ) : null}
          </form>
          <p className="auth-footer-copy">
            {mode === "sign-in" ? "Need an account?" : "Already have an account?"}{" "}
            <button
              className="text-button auth-switch-button"
              onClick={() => {
                setMode(mode === "sign-in" ? "sign-up" : "sign-in");
                setCredentialsInvalid(false);
              }}
              type="button"
            >
              {mode === "sign-in" ? "Create admin account" : "Sign in"}
            </button>
          </p>
        </section>
      </section>
    </main>
  );
}

/**
 * Shown after clicking a password-recovery link. The recovery click already produced a valid
 * (recovery-scoped) session, so this only asks for the new password -- there is no "current
 * password" to verify, unlike ChangePasswordModal's voluntary change from inside the app.
 */
function ResetPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    if (password.length < 6) {
      NotificationService.showError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      NotificationService.showError("Passwords do not match.");
      return;
    }
    setBusy(true);
    const result = await supabase.auth.updateUser({ password });
    if (result.error) {
      setBusy(false);
      NotificationService.showError(friendlyError(result.error));
      return;
    }
    // The recovery-scoped session has done its job; sign out so the admin signs back in
    // normally with the new password rather than staying in on the recovery token.
    await supabase.auth.signOut();
    setBusy(false);
    NotificationService.showSuccess("Password updated. Please sign in with your new password.");
    onDone();
  }

  return (
    <main className="center-screen login-screen">
      <section className="auth-shell">
        <section className="auth-panel">
          <div className="auth-icon-badge" aria-hidden="true">
            <KeyRound size={28} />
          </div>
          <div className="auth-panel-copy">
            <p className="eyebrow">Payroll workspace</p>
            <h1>Set a New Password</h1>
            <p>Choose a new password for your account.</p>
          </div>
          <form onSubmit={handleSubmit} className="stack auth-form-stack">
            <div className="auth-input-shell auth-password-shell">
              <span className="auth-input-icon" aria-hidden="true"><KeyRound size={16} /></span>
              <PasswordField
                autoComplete="new-password"
                autoFocus
                label="New Password"
                minLength={6}
                onChange={setPassword}
                placeholder="Enter your new password"
                required
                value={password}
              />
            </div>
            <div className="auth-input-shell auth-password-shell">
              <span className="auth-input-icon" aria-hidden="true"><KeyRound size={16} /></span>
              <PasswordField
                autoComplete="new-password"
                label="Confirm Password"
                minLength={6}
                onChange={setConfirmPassword}
                placeholder="Re-enter your new password"
                required
                value={confirmPassword}
              />
            </div>
            <button className="primary-button auth-submit-button" disabled={busy} type="submit">
              {busy && <Spinner size="small" />}
              {busy ? "Please wait..." : "Set new password"}
            </button>
          </form>
        </section>
      </section>
    </main>
  );
}

function ChangePasswordModal({ onClose, userEmail }: { onClose: () => void; userEmail: string }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const { backdropProps, dialogProps } = useDialog({ label: "Change password", onClose });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    if (newPassword.length < 6) {
      NotificationService.showError("New password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      NotificationService.showError("New password and confirmation do not match.");
      return;
    }
    setBusy(true);
    const verify = await supabase.auth.signInWithPassword({ email: userEmail, password: currentPassword });
    if (verify.error) {
      setBusy(false);
      NotificationService.showError("Current password is incorrect.");
      return;
    }
    const result = await supabase.auth.updateUser({ password: newPassword });
    setBusy(false);
    if (result.error) {
      NotificationService.showError(result.error.message || "Failed to update password.");
      return;
    }
    NotificationService.showSuccess("Password updated.");
    onClose();
  }

  return (
    <div className="modal-backdrop" {...backdropProps}>
      <div className="modal billing-form-modal subcon-form-modal" {...dialogProps}>
        <div className="modal-header">
          <h3>Change Password</h3>
          <button aria-label="Close" onClick={onClose} type="button"><X size={18} /></button>
        </div>
        <form className="billing-form-body" onSubmit={handleSubmit}>
          <div className="billing-form-fields subcon-form-fields">
            <PasswordField
              autoComplete="current-password"
              autoFocus
              label="Current password"
              minLength={6}
              onChange={setCurrentPassword}
              required
              value={currentPassword}
            />
            <PasswordField
              autoComplete="new-password"
              label="New password"
              minLength={6}
              onChange={setNewPassword}
              required
              value={newPassword}
            />
            <PasswordField
              autoComplete="new-password"
              label="Confirm new password"
              minLength={6}
              onChange={setConfirmPassword}
              required
              value={confirmPassword}
            />
          </div>
          <div className="form-actions">
            <button className="billing-btn outline" onClick={onClose} type="button">
              Cancel
            </button>
            <button className="billing-btn primary" disabled={busy} type="submit">
              {busy ? "Saving..." : "Update password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Matches the tablet/mobile-nav breakpoint in styles.css (max-width: 900px)
// that switches the sidebar into an off-canvas drawer.
const MOBILE_NAV_BREAKPOINT = 900;

function Workspace({ session }: { session: Session }) {
  const repos = useRepositories();
  const [view, setView] = useState<View>(() => viewFromPath(window.location.pathname));
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => typeof window !== "undefined" && window.innerWidth <= MOBILE_NAV_BREAKPOINT);
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
  const [salaryBonds, setSalaryBonds] = useState<SalaryBond[]>([]);
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
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [notificationMenuOpen, setNotificationMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const notificationMenuRef = useRef<HTMLDivElement | null>(null);
  const syncInFlightRef = useRef<Promise<void> | null>(null);
  const resourceErrorNotifiedRef = useRef(new Set<ResourceKey>());
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
    salaryBonds: (data) => setSalaryBonds((data as SalaryBond[]).map(normalizeSalaryBond)),
    subcontractorAdvances: (data) => setSubcontractorAdvances(data as SubcontractorAdvance[]),
    subconDailyTickets: (data) => setSubconDailyTickets(data as SubconDailyTicket[]),
    subcontractors: (data) => setSubcontractors(data as Subcontractor[]),
  };

  const resourceLoaders: Record<ResourceKey, () => Promise<{ data: unknown; error: unknown }>> = {
    attendanceEntries: async () => loadAttendanceEntries(supabase!),
    billingRecords: async () => loadBillingRecords(supabase!),
    billingSettings: async () => loadBillingSettings(supabase!),
    collections: async () => loadCollections(supabase!),
    dashboardSummary: async () => loadDashboardSummary(supabase!, repos),
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
    salaryBonds: async () => loadSalaryBonds(supabase!),
    subcontractorAdvances: async () => loadSubcontractorAdvances(supabase!),
    subconDailyTickets: async () => loadSubconDailyTickets(supabase!),
    subcontractors: async () => loadSubcontractors(supabase!),
  };

  const queueOfflineMutation: QueueOfflineMutation = async (mutation) => {
    await queueMutation({ ...mutation, userId: session.user.id });
    NotificationService.showSuccess("Saved locally. It will sync when online.");
  };

  function syncQueuedMutations(showToast = false): Promise<void> {
    if (syncInFlightRef.current) return syncInFlightRef.current;
    if (!supabase || !navigator.onLine) return Promise.resolve();

    const syncTask = (async () => {
      const result = await flushPendingMutations(supabase, session.user.id);
      if (result.failed.length > 0) {
        NotificationService.showError(`${result.failed.length} offline change could not sync. Use “Retry offline changes” from the account menu after correcting the record.`);
      } else if (showToast && result.synced.length > 0) {
        NotificationService.showSuccess(`${result.synced.length} offline change${result.synced.length === 1 ? "" : "s"} synced.`);
      }
      if (result.synced.length > 0) {
        const affected = Array.from(new Set(result.synced.flatMap((mutation) => mutation.affectedResources)));
        await Promise.all(affected.map((resource) => loadResource(resource, true)));
      }
    })();

    syncInFlightRef.current = syncTask;
    const clearSyncTask = () => {
      if (syncInFlightRef.current === syncTask) syncInFlightRef.current = null;
    };
    void syncTask.then(clearSyncTask, clearSyncTask);
    return syncTask;
  }

  function toggleSidebarNav() {
    setSidebarCollapsed((collapsed) => {
      const nextCollapsed = !collapsed;
      setMobileNavOpen(!nextCollapsed);
      return nextCollapsed;
    });
  }

  function navigate(nextView: View) {
    setView(nextView);
    if (window.innerWidth <= MOBILE_NAV_BREAKPOINT) {
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
        if (!resourceErrorNotifiedRef.current.has(resource)) {
          resourceErrorNotifiedRef.current.add(resource);
          NotificationService.showError(`Could not refresh ${resource.replace(/([A-Z])/g, " $1").toLowerCase()}. ${cached ? "Showing saved data." : "Try again when the connection is stable."}`);
        }
        return;
      }

      setResourceData(result.data);
      resourceErrorNotifiedRef.current.delete(resource);
      await writeCachedResource(resource, session.user.id, result.data);
      setResourceHydration((current) => ({ ...current, [resource]: true }));
      setResourceStatuses((current) => ({ ...current, [resource]: "ready" }));
    } catch {
      setResourceStatuses((current) => ({ ...current, [resource]: previousStatus === "ready" ? "ready" : "idle" }));
      if (!resourceErrorNotifiedRef.current.has(resource)) {
        resourceErrorNotifiedRef.current.add(resource);
        NotificationService.showError(`Could not refresh ${resource.replace(/([A-Z])/g, " $1").toLowerCase()}. ${cached ? "Showing saved data." : "Try again when the connection is stable."}`);
      }
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
      loadResource("salaryBonds", true),
      loadResource("payrollHistory", true),
      loadResource("payrollSettings", true),
      loadResource("dashboardSummary", true),
      loadResource("expenses", true),
      loadResource("expenseCategories", true),
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
      loadResource("expenses", true),
      loadResource("expenseCategories", true),
    ]);
  }

  async function refreshEmployeeAdvances() {
    await Promise.all([
      loadResource("employeeAdvances", true),
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
    if (view !== "employees") {
      setEmployeeDetailOpen(false);
    }
  }, [view]);

  useEffect(() => {
    const prevWidthRef = { current: window.innerWidth };
    const handleResize = () => {
      const prevWidth = prevWidthRef.current;
      const width = window.innerWidth;
      if (width <= MOBILE_NAV_BREAKPOINT) {
        setSidebarCollapsed(true);
        setMobileNavOpen(false);
      } else if (prevWidth <= MOBILE_NAV_BREAKPOINT) {
        // returning from a narrow layout — restore the sidebar instead of
        // leaving it stuck collapsed on a wide monitor
        setSidebarCollapsed(false);
      }
      prevWidthRef.current = width;
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setView(viewFromPath(window.location.pathname));
      if (window.innerWidth <= MOBILE_NAV_BREAKPOINT) {
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
    if (!notificationMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!notificationMenuRef.current?.contains(event.target as Node)) {
        setNotificationMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [notificationMenuOpen]);

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
    // The offline cache holds employee names, salaries and government ID numbers, so it must
    // not outlive the session on a shared machine. Unsent writes die with it, so confirm first.
    const pending = await getPendingMutations(session.user.id);
    if (pending.length > 0) {
      const confirmed = await NotificationService.showConfirm({
        title: "Sign out with unsynced changes?",
        message: `${pending.length} offline change${pending.length === 1 ? "" : "s"} ${pending.length === 1 ? "has" : "have"} not reached the server yet. Signing out discards ${pending.length === 1 ? "it" : "them"}.`,
        danger: true,
      });
      if (!confirmed) return;
    }
    await clearOfflineDataForUser(session.user.id);
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

  const headerNotifications = useMemo<HeaderNotificationItem[]>(() => {
    const today = todayKey();
    const upcomingEndKey = addDays(today, 7);

    const items: HeaderNotificationItem[] = [];
    const addedExpenseIds = new Set<string>();

    for (const collection of dashboardSummary.overdueCollections) {
      const days = Math.max(1, Math.floor((Date.parse(`${today}T00:00:00`) - Date.parse(`${collection.due_date}T00:00:00`)) / 86400000));
      items.push({
        id: `collection-overdue-${collection.id}`,
        kind: "collection",
        title: collection.title,
        amount: toNumber(collection.outstanding_balance),
        urgency: "overdue",
        dateLabel: `${days}d overdue`,
      });
    }
    for (const payment of dashboardSummary.overduePayments) {
      const days = Math.max(1, Math.floor((Date.parse(`${today}T00:00:00`) - Date.parse(`${payment.due_date}T00:00:00`)) / 86400000));
      items.push({
        id: `payment-overdue-${payment.id}`,
        kind: "payment",
        title: payment.title,
        amount: toNumber(payment.amount),
        urgency: "overdue",
        dateLabel: `${days}d overdue`,
      });
    }
    for (const expense of dashboardSummary.overdueExpenses) {
      const referenceDate = expenseOverdueReferenceDate(expense, today);
      const days = referenceDate ? Math.max(1, Math.floor((Date.parse(`${today}T00:00:00`) - Date.parse(`${referenceDate}T00:00:00`)) / 86400000)) : 1;
      items.push({
        id: `expense-overdue-${expense.id}`,
        kind: "expense",
        title: `${expense.category_name} - ${expense.employee_name}`,
        amount: toNumber(expense.amount),
        urgency: "overdue",
        dateLabel: `${days}d overdue`,
      });
      addedExpenseIds.add(expense.id);
    }

    for (const collection of dashboardSummary.dueTodayCollections) {
      items.push({
        id: `collection-today-${collection.id}`,
        kind: "collection",
        title: collection.title,
        amount: toNumber(collection.outstanding_balance),
        urgency: "today",
        dateLabel: "due today",
      });
    }
    for (const payment of dashboardSummary.dueTodayPayments) {
      items.push({
        id: `payment-today-${payment.id}`,
        kind: "payment",
        title: payment.title,
        amount: toNumber(payment.amount),
        urgency: "today",
        dateLabel: "due today",
      });
    }
    for (const expense of dashboardSummary.dueTodayExpenses) {
      items.push({
        id: `expense-today-${expense.id}`,
        kind: "expense",
        title: `${expense.category_name} - ${expense.employee_name}`,
        amount: toNumber(expense.amount),
        urgency: "today",
        dateLabel: "due today",
      });
      addedExpenseIds.add(expense.id);
    }

    const upcomingCollections = collections.filter((collection) =>
      !collection.archived_at &&
      collection.outstanding_balance > 0 &&
      collection.due_date > today &&
      collection.due_date <= upcomingEndKey,
    );
    for (const collection of upcomingCollections) {
      const days = Math.max(1, Math.ceil((Date.parse(`${collection.due_date}T00:00:00`) - Date.parse(`${today}T00:00:00`)) / 86400000));
      items.push({
        id: `collection-upcoming-${collection.id}`,
        kind: "collection",
        title: collection.title,
        amount: toNumber(collection.outstanding_balance),
        urgency: "upcoming",
        dateLabel: `due in ${days}d`,
      });
    }

    const upcomingPayments = payments.filter((payment) =>
      payment.status !== "paid" &&
      payment.due_date > today &&
      payment.due_date <= upcomingEndKey,
    );
    for (const payment of upcomingPayments) {
      const days = Math.max(1, Math.ceil((Date.parse(`${payment.due_date}T00:00:00`) - Date.parse(`${today}T00:00:00`)) / 86400000));
      items.push({
        id: `payment-upcoming-${payment.id}`,
        kind: "payment",
        title: payment.title,
        amount: toNumber(payment.amount),
        urgency: "upcoming",
        dateLabel: `due in ${days}d`,
      });
    }

    const nextExpenseReminderDate = (expense: Expense) => {
      if (expense.status === "paid" || expense.status === "cancelled") return null;
      if (expense.due_date) {
        const dueDates = expensePeriodDueDates(expense);
        if (dueDates.length === 0) {
          return expense.due_date >= today ? expense.due_date : null;
        }
        return dueDates.find((dueDate) => dueDate >= today) ?? null;
      }
      if (expense.frequency === "monthly" && expense.payment_date) {
        const elapsed = expenseCyclesElapsedSince(expense.payment_date, today);
        if (elapsed.mostRecentDate === today) return today;
        const start = new Date(`${expense.payment_date}T00:00:00Z`);
        const startDay = start.getUTCDate();
        const todayDate = new Date(`${today}T00:00:00Z`);
        let year = todayDate.getUTCFullYear();
        let month = todayDate.getUTCMonth();
        for (let offset = 0; offset < 12; offset += 1) {
          const targetMonth = month + offset;
          const lastDay = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();
          const cycle = new Date(Date.UTC(year, targetMonth, Math.min(startDay, lastDay))).toISOString().slice(0, 10);
          if (cycle >= today) return cycle;
        }
      }
      return null;
    };

    for (const expense of expenses) {
      const nextReminderDate = nextExpenseReminderDate(expense);
      if (!nextReminderDate || nextReminderDate <= today || nextReminderDate > upcomingEndKey) continue;
      if (addedExpenseIds.has(expense.id)) continue;
      const days = Math.max(1, Math.ceil((Date.parse(`${nextReminderDate}T00:00:00`) - Date.parse(`${today}T00:00:00`)) / 86400000));
      items.push({
        id: `expense-upcoming-${expense.id}`,
        kind: "expense",
        title: `${expense.category_name} - ${expense.employee_name}`,
        amount: toNumber(expense.amount),
        urgency: "upcoming",
        dateLabel: `due in ${days}d`,
      });
      addedExpenseIds.add(expense.id);
    }

    const urgencyRank = { overdue: 0, today: 1, upcoming: 2 } as const;
    return items
      .sort((left, right) => urgencyRank[left.urgency] - urgencyRank[right.urgency] || right.amount - left.amount)
      .slice(0, 12);
  }, [collections, dashboardSummary.dueTodayCollections, dashboardSummary.dueTodayExpenses, dashboardSummary.dueTodayPayments, dashboardSummary.overdueCollections, dashboardSummary.overdueExpenses, dashboardSummary.overduePayments, expenses, payments]);

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

  function openNotificationItem(item: HeaderNotificationItem) {
    setNotificationMenuOpen(false);
    if (item.kind === "collection") {
      navigate("collections");
      return;
    }
    if (item.kind === "payment") {
      navigate("payments");
      return;
    }
    navigate("expenses");
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
        onToggleMobileNav={toggleSidebarNav}
        view={view}
      />
      {mobileNavOpen && <button aria-label="Close navigation" className="sidebar-backdrop" onClick={() => {
        setSidebarCollapsed(true);
        setMobileNavOpen(false);
      }} type="button" />}

      <div className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"} className="topbar-icon topbar-menu-button" onClick={toggleSidebarNav} type="button">
              <Menu size={19} />
            </button>
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
            <div className="notification-menu" ref={notificationMenuRef}>
              <button
                aria-expanded={notificationMenuOpen}
                aria-haspopup="menu"
                className="topbar-icon notification-button"
                onClick={() => {
                  setNotificationMenuOpen((open) => !open);
                  setAccountMenuOpen(false);
                }}
                type="button"
              >
                <Bell size={19} />
                {headerNotifications.length > 0 ? <span>{Math.min(headerNotifications.length, 9)}</span> : null}
              </button>
              {notificationMenuOpen && (
                <div className="notification-dropdown" role="menu">
                  <div className="notification-dropdown-header">
                    <strong>Notifications</strong>
                    <span>{headerNotifications.length === 0 ? "Nothing incoming" : `${headerNotifications.length} active reminder${headerNotifications.length === 1 ? "" : "s"}`}</span>
                  </div>
                  {headerNotifications.length === 0 ? (
                    <p className="notification-empty">No due dates or expense reminders in the next 7 days.</p>
                  ) : (
                    <div className="notification-list">
                      {headerNotifications.map((item) => (
                        <button
                          className="notification-item"
                          key={item.id}
                          onClick={() => openNotificationItem(item)}
                          role="menuitem"
                          type="button"
                        >
                          <span className={`notification-item-icon ${item.kind} ${item.urgency}`}>
                            {item.kind === "collection" ? <CreditCard size={15} /> : item.kind === "payment" ? <Bell size={15} /> : <CalendarClock size={15} />}
                          </span>
                          <span className="notification-item-copy">
                            <strong>{item.title}</strong>
                            <small>{item.dateLabel}</small>
                          </span>
                          <em>{currency.format(item.amount)}</em>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
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
                    className="account-dropdown-item"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      void retryFailedMutations(session.user.id).then((count) => {
                        if (count === 0) {
                          NotificationService.showSuccess("There are no failed offline changes to retry.");
                          return;
                        }
                        return syncQueuedMutations(true);
                      });
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <RotateCw size={16} />
                    Retry offline changes
                  </button>
                  <button
                    className="account-dropdown-item danger"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      void NotificationService.showConfirm({
                        title: "Discard failed offline changes",
                        message: "Discard changes that could not sync? This cannot be undone.",
                        danger: true,
                      }).then(async (confirmed) => {
                        if (!confirmed) return;
                        const count = await discardFailedMutations(session.user.id);
                        NotificationService.showSuccess(
                          count === 0 ? "There are no failed offline changes." : `${count} failed offline change${count === 1 ? "" : "s"} discarded.`,
                        );
                      });
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <Trash2 size={16} />
                    Discard failed offline changes
                  </button>
                  <button
                    className="account-dropdown-item"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      setChangePasswordOpen(true);
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <KeyRound size={16} />
                    Change password
                  </button>
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
          {changePasswordOpen && (
            <ChangePasswordModal onClose={() => setChangePasswordOpen(false)} userEmail={session.user.email ?? ""} />
          )}
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
                <Suspense fallback={<Spinner />}>
                  <DashboardModern
                    dailyTicketEntries={dailyTicketEntries}
                    employees={employees}
                    onOpenLeaderboard={() => navigate("daily-tickets")}
                    onOpenSubcontractorLeaderboard={() => navigate("subcontractors")}
                    subconDailyTickets={subconDailyTickets}
                    summary={dashboardSummary}
                  />
                </Suspense>
              )}
              {view === "employees" && (
                <Suspense fallback={<Spinner />}>
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
                    salaryBonds={salaryBonds}
                    userId={session.user.id}
                  />
                </Suspense>
            )}
            {view === "employee-add" && (
              <Suspense fallback={<Spinner />}>
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
                  salaryBonds={salaryBonds}
                  userId={session.user.id}
                />
              </Suspense>
            )}
              {view === "compensation" && (
                <Suspense fallback={<Spinner />}>
                  <PositionsView
                    employees={employees}
                    onChange={refreshPositionsPage}
                    onLocalPositionsChange={setPositions}
                    onQueueOfflineMutation={queueOfflineMutation}
                    positions={positions}
                    userId={session.user.id}
                  />
                </Suspense>
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
                      expenseCategories={expenseCategories}
                      onLocalPayrollRunsChange={setPayrollRuns}
                      onChange={refreshPayrollPage}
                      onQueueOfflineMutation={queueOfflineMutation}
                      payrollSettings={payrollSettings}
                      payrollRuns={payrollRuns}
                      positions={positions}
                      employeeAdvances={employeeAdvances}
                      salaryBonds={salaryBonds}
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
              {view === "reports" && (
                <ReportsFeature
                  billingRecords={billingRecords}
                  billingSettings={billingSettings}
                  collections={collections}
                  dailyTicketEntries={dailyTicketEntries}
                  employees={employees}
                  expenses={expenses}
                  payrollHistoryRows={payrollHistoryRows}
                  subconDailyTickets={subconDailyTickets}
                />
              )}
              {view === "payments" && <PaymentsFeature expenseCategories={expenseCategories} expenses={expenses} />}
              {view === "billing" && (
                <BillingFeature
                  billingRecords={billingRecords}
                  billingSettings={billingSettings}
                  collections={collections}
                  dailyTicketEntries={dailyTicketEntries}
                  expenseCategories={expenseCategories}
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
                  userId={session.user.id}
                />
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
                  expenseCategories={expenseCategories}
                  initialTab={subcontractorAccountTab}
                  onChange={async () => {
                    await Promise.all([
                      loadResource("subcontractors", true),
                      loadResource("subcontractorAdvances", true),
                      loadResource("subconDailyTickets", true),
                      loadResource("billingRecords", true),
                      loadResource("payments", true),
                      loadResource("expenses", true),
                      loadResource("expenseCategories", true),
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
              {view === "salary-bonds" && (
                <SalaryBondsFeature
                  employees={employees}
                  onChange={refreshSalaryBonds}
                  onQueueOfflineMutation={queueOfflineMutation}
                  salaryBonds={salaryBonds}
                  userId={session.user.id}
                />
              )}
          </>
          )}
        </section>
      </div>
    </main>
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
  const ticketDetailDialog = useDialog({
    label: `Ticket detail${detailEmployee ? `: ${detailEmployee.full_name}` : ""}`,
    onClose: () => setDetailEmployee(null),
    open: Boolean(detailEmployee),
  });
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
        const rank = (c: typeof a) => (c.ticket_type === "repair" ? 0 : c.ticket_type === "installation" ? 1 : 2);
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
    const napRehabItems = categories
      .filter((cat) => cat.ticket_type === "nap_rehab")
      .map((cat) => ({ category: cat, count: normalizeTicketCount(draft.counts[cat.id]) }));
    const adjustedInstall = distributeRemainingDraftCounts(installationItems, disputes.install);
    const adjustedRepair = distributeRemainingDraftCounts(repairItems, disputes.repair);
    const adjustedNapRehab = napRehabItems.map((item) => item.count);

    const installationGross = installationItems.reduce(
      (sum, item, index) => sum + adjustedInstall[index] * toNumber(item.category.rate),
      0,
    );
    const repairGross = repairItems.reduce(
      (sum, item, index) => sum + adjustedRepair[index] * toNumber(item.category.rate),
      0,
    );
    const napRehabGross = napRehabItems.reduce(
      (sum, item, index) => sum + adjustedNapRehab[index] * toNumber(item.category.rate),
      0,
    );

    return {
      installationTickets: adjustedInstall.reduce((sum, count) => sum + count, 0),
      repairTickets: adjustedRepair.reduce((sum, count) => sum + count, 0),
      napRehabTickets: adjustedNapRehab.reduce((sum, count) => sum + count, 0),
      installationAmount: installationGross,
      repairAmount: repairGross,
      napRehabAmount: napRehabGross,
      gross: installationGross + repairGross + napRehabGross,
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
      const napRehabDetails = details
        .filter((detail) => detail.ticket_type === "nap_rehab")
        .map((detail) => ({ detail, count: normalizeTicketCount(detail.ticket_count) }));
      const adjustedInstall = distributeRemainingDraftCounts(installationDetails, entry.disputed_install ?? 0);
      const adjustedRepair = distributeRemainingDraftCounts(repairDetails, entry.disputed_repair ?? 0);
      const adjustedNapRehab = napRehabDetails.map((item) => item.count);
      const installationTickets = adjustedInstall.reduce((sum, count) => sum + count, 0);
      const repairTickets = adjustedRepair.reduce((sum, count) => sum + count, 0);
      const napRehabTickets = adjustedNapRehab.reduce((sum, count) => sum + count, 0);
      const gross = installationDetails.reduce(
        (sum, item, index) => sum + adjustedInstall[index] * toNumber(item.detail.rate),
        0,
      ) + repairDetails.reduce(
        (sum, item, index) => sum + adjustedRepair[index] * toNumber(item.detail.rate),
        0,
      ) + napRehabDetails.reduce(
        (sum, item, index) => sum + adjustedNapRehab[index] * toNumber(item.detail.rate),
        0,
      );
      return {
        installationTickets,
        repairTickets,
        napRehabTickets,
        installationAmount: installationDetails.reduce(
          (sum, item, index) => sum + adjustedInstall[index] * toNumber(item.detail.rate),
          0,
        ),
        repairAmount: repairDetails.reduce(
          (sum, item, index) => sum + adjustedRepair[index] * toNumber(item.detail.rate),
          0,
        ),
        napRehabAmount: napRehabDetails.reduce(
          (sum, item, index) => sum + adjustedNapRehab[index] * toNumber(item.detail.rate),
          0,
        ),
        total: installationTickets + repairTickets + napRehabTickets,
        gross,
      };
    }

    const installationTickets = Math.max(
      0,
      normalizeTicketCount(entry.installation_tickets) - Math.min(normalizeTicketCount(entry.installation_tickets), normalizeTicketCount(entry.disputed_install ?? 0)),
    );
    const repairTickets = Math.max(
      0,
      normalizeTicketCount(entry.repair_tickets) - Math.min(normalizeTicketCount(entry.repair_tickets), normalizeTicketCount(entry.disputed_repair ?? 0)),
    );
    const napRehabTickets = normalizeTicketCount(entry.nap_rehab_tickets);
    const installationAmount = installationTickets * toNumber(entry.installation_rate);
    const repairAmount = repairTickets * toNumber(entry.repair_rate);
    const napRehabAmount = napRehabTickets * toNumber(entry.nap_rehab_rate);
    const gross = installationAmount + repairAmount + napRehabAmount;
    return { installationTickets, repairTickets, napRehabTickets, installationAmount, repairAmount, napRehabAmount, total: installationTickets + repairTickets + napRehabTickets, gross };
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
    const napRehabCategories = activeCategories.filter((c) => c.ticket_type === "nap_rehab");
    const computedInstall = installCategories.reduce((s, c) => s + normalizeTicketCount(draft.counts[c.id]), 0);
    const computedRepair = repairCategories.reduce((s, c) => s + normalizeTicketCount(draft.counts[c.id]), 0);
    const computedNapRehab = napRehabCategories.reduce((s, c) => s + normalizeTicketCount(draft.counts[c.id]), 0);
    const disputes = disputeValuesFor(draft);
    const installRate = installCategories[0] ? toNumber(installCategories[0].rate) : 0;
    const repairRate = repairCategories[0] ? toNumber(repairCategories[0].rate) : 0;
    const napRehabRate = napRehabCategories[0] ? toNumber(napRehabCategories[0].rate) : 0;
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
      nap_rehab_tickets: computedNapRehab,
      nap_rehab_rate: napRehabRate,
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

  const [entryYear, entryMonth, entryDay] = entryDate.split("-").map(Number);
  const entryBillingPeriod = entryDay <= 15 ? "first_half" : "second_half";
  const totalRepairForDate = drafts.reduce((sum, draft) => sum + draftBillableSnapshot(draft).repairTickets, 0);
  const totalRepairForBillingPeriod =
    countTicketsByType(
      dailyTicketEntries.filter((entry) => entry.entry_date !== entryDate),
      entryMonth,
      entryYear,
      entryBillingPeriod,
    ).repair + totalRepairForDate;
  const totalInstallationForDate = drafts.reduce((sum, draft) => sum + draftBillableSnapshot(draft).installationTickets, 0);
  const totalInstallationForBillingPeriod =
    countTicketsByType(
      dailyTicketEntries.filter((entry) => entry.entry_date !== entryDate),
      entryMonth,
      entryYear,
      entryBillingPeriod,
    ).installation + totalInstallationForDate;
  const totalNapRehabForDate = drafts.reduce((sum, draft) => sum + draftBillableSnapshot(draft).napRehabTickets, 0);
  const totalNapRehabForBillingPeriod =
    countTicketsByType(
      dailyTicketEntries.filter((entry) => entry.entry_date !== entryDate),
      entryMonth,
      entryYear,
      entryBillingPeriod,
    ).nap_rehab + totalNapRehabForDate;
  return (
    <div className="page-stack daily-ticket-page">
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
          <div className="subcon-ticket-stat-icon"><Users size={20} /></div>
          <div className="subcon-ticket-stat-text">
            <span>Employees</span>
            <strong>{drafts.length}</strong>
            <span className="subcon-ticket-stat-helper">Eligible for entries</span>
          </div>
        </div>
        <div className="subcon-ticket-stat logged">
          <div className="subcon-ticket-stat-icon"><Wrench size={20} /></div>
          <div className="subcon-ticket-stat-text">
            <span>Closed Repair Tickets</span>
            <strong>{totalRepairForBillingPeriod}</strong>
            <span className="subcon-ticket-stat-helper">Repair count for current billing period</span>
          </div>
        </div>
        <div className="subcon-ticket-stat total">
          <div className="subcon-ticket-stat-icon"><BadgeDollarSign size={20} /></div>
          <div className="subcon-ticket-stat-text">
            <span>Closed Installation Tickets</span>
            <strong>{totalInstallationForBillingPeriod}</strong>
            <span className="subcon-ticket-stat-helper">Installation count for current billing period</span>
          </div>
        </div>
        <div className="subcon-ticket-stat">
          <div className="subcon-ticket-stat-icon"><Wrench size={20} /></div>
          <div className="subcon-ticket-stat-text">
            <span>Closed Nap Rehab Tickets</span>
            <strong>{totalNapRehabForBillingPeriod}</strong>
            <span className="subcon-ticket-stat-helper">Nap Rehab count for current billing period</span>
          </div>
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
            const rows = activeGroup.drafts.map((draft, index) => {
              const dirty = isDirty(draft);
              const busy = busyEmployeeId === draft.employee.id;
              const saved = savedIds.has(draft.employee.id);
              const disputes = disputeValuesFor(draft);
              const installTotal = cats
                .filter((cat) => (cat.ticket_type ?? "installation") === "installation")
                .reduce((sum, cat) => sum + normalizeTicketCount(draft.counts[cat.id]), 0);
              const repairTotal = cats
                .filter((cat) => cat.ticket_type === "repair")
                .reduce((sum, cat) => sum + normalizeTicketCount(draft.counts[cat.id]), 0);
              return { draft, index, dirty, busy, saved, disputes, installTotal, repairTotal };
            });
            return (
              <section className="ticket-position-group">
                <div className="ticket-position-heading">
                  <span>{activePosition.name}</span>
                  <span className="ticket-position-total">{currency.format(groupTotal)}</span>
                </div>
                <div className="table-wrap ticket-table-wrap">
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
                      {rows.map(({ draft, index, dirty, busy, saved, disputes, installTotal, repairTotal }) => {
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
                                disabled={installTotal === 0}
                                max={installTotal}
                                min="0"
                                step="1"
                                type="number"
                                value={Math.min(installTotal, normalizeTicketCount(disputes.install))}
                                onChange={(e) => setDraftDisputes((current) => ({
                                  ...current,
                                  [draft.employee.id]: {
                                    install: Math.min(installTotal, normalizeTicketCount(e.target.value)),
                                    repair: current[draft.employee.id]?.repair ?? draft.entry?.disputed_repair ?? 0,
                                  },
                                }))}
                              />
                            </td>
                            <td className="ticket-count-cell ticket-count-cell--dispute">
                              <input
                                aria-label={`Disputed repair tickets for ${draft.employee.full_name}`}
                                disabled={repairTotal === 0}
                                max={repairTotal}
                                min="0"
                                step="1"
                                type="number"
                                value={Math.min(repairTotal, normalizeTicketCount(disputes.repair))}
                                onChange={(e) => setDraftDisputes((current) => ({
                                  ...current,
                                  [draft.employee.id]: {
                                    install: current[draft.employee.id]?.install ?? draft.entry?.disputed_install ?? 0,
                                    repair: Math.min(repairTotal, normalizeTicketCount(e.target.value)),
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
                <div className="ticket-mobile-list">
                  {rows.map(({ draft, index, dirty, busy, saved, disputes, installTotal, repairTotal }) => (
                    <div
                      className={`ticket-mobile-card${dirty ? " ticket-mobile-card--dirty" : saved ? " ticket-mobile-card--saved" : ""}`}
                      key={draft.employee.id}
                    >
                      <div className="ticket-mobile-card-header">
                        <span className="ticket-mobile-card-index">{index + 1}</span>
                        <div className="employee-list-identity">
                          <div className="employee-list-avatar">
                            {draft.employee.profile_photo_url
                              ? <img alt="" src={draft.employee.profile_photo_url} />
                              : <span>{draft.employee.full_name.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "E"}</span>}
                          </div>
                          <RecordTitle title={draft.employee.full_name} notes={draft.employee.email || "No email"} />
                        </div>
                        <strong className="ticket-mobile-card-gross">{currency.format(grossFor(draft))}</strong>
                      </div>
                      <div className="ticket-mobile-input-grid">
                        {cats.map((cat) => (
                          <label className="ticket-mobile-input-tile" key={cat.id}>
                            <span>{cat.name} <small>₱{toNumber(cat.rate).toLocaleString()}/ticket</small></span>
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
                          </label>
                        ))}
                        <label className="ticket-mobile-input-tile ticket-mobile-input-tile--dispute">
                          <span>Disputed Install</span>
                          <input
                            aria-label={`Disputed installation tickets for ${draft.employee.full_name}`}
                            disabled={installTotal === 0}
                            max={installTotal}
                            min="0"
                            step="1"
                            type="number"
                            value={Math.min(installTotal, normalizeTicketCount(disputes.install))}
                            onChange={(e) => setDraftDisputes((current) => ({
                              ...current,
                              [draft.employee.id]: {
                                install: Math.min(installTotal, normalizeTicketCount(e.target.value)),
                                repair: current[draft.employee.id]?.repair ?? draft.entry?.disputed_repair ?? 0,
                              },
                            }))}
                          />
                        </label>
                        <label className="ticket-mobile-input-tile ticket-mobile-input-tile--dispute">
                          <span>Disputed Repair</span>
                          <input
                            aria-label={`Disputed repair tickets for ${draft.employee.full_name}`}
                            disabled={repairTotal === 0}
                            max={repairTotal}
                            min="0"
                            step="1"
                            type="number"
                            value={Math.min(repairTotal, normalizeTicketCount(disputes.repair))}
                            onChange={(e) => setDraftDisputes((current) => ({
                              ...current,
                              [draft.employee.id]: {
                                install: current[draft.employee.id]?.install ?? draft.entry?.disputed_install ?? 0,
                                repair: Math.min(repairTotal, normalizeTicketCount(e.target.value)),
                              },
                            }))}
                          />
                        </label>
                      </div>
                      <div className="ticket-mobile-card-footer">
                        {busy ? (
                          <span className="ticket-mobile-save-status"><Spinner size="small" /> Saving…</span>
                        ) : saved ? (
                          <span className="ticket-mobile-save-status ticket-mobile-save-status--saved"><CheckCircle2 size={16} /> Saved</span>
                        ) : (
                          <button
                            className="ticket-mobile-save-button"
                            disabled={!dirty}
                            onClick={() => void saveDraftAndMark(draft)}
                            type="button"
                          >
                            <Save size={15} /> Save
                          </button>
                        )}
                        <div className="ticket-menu-wrap" ref={openMenuId === draft.employee.id ? menuRef : undefined}>
                          <button
                            aria-label="More actions"
                            className="expense-mobile-kebab"
                            onClick={() => setOpenMenuId((prev) => prev === draft.employee.id ? "" : draft.employee.id)}
                            type="button"
                          >
                            <MoreVertical size={15} />
                          </button>
                          {openMenuId === draft.employee.id && (
                            <div className="ticket-menu-dropdown">
                              <button onClick={() => { setDetailEmployee(draft.employee); setOpenMenuId(""); }} type="button">
                                <Eye size={14} /> View details
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
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
          <div className="modal-backdrop" {...ticketDetailDialog.backdropProps}>
            <div className="modal ticket-detail-modal" {...ticketDetailDialog.dialogProps}>
              <div className="modal-header">
                <h2>{detailEmployee.full_name} — Ticket History</h2>
                <button aria-label="Close" type="button" onClick={() => setDetailEmployee(null)}>
                  <X size={18} />
                </button>
              </div>
              <p className="ticket-detail-sub">{empEntries.length} entr{empEntries.length !== 1 ? "ies" : "y"} · Total Installation <strong>{currency.format(totalGross)}</strong></p>
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
  const repos = useRepositories();
  const [entryDate, setEntryDate] = useState(todayKey());
  const [drafts, setDrafts] = useState<Record<string, { install: number; repair: number; napRehab: number; disputedInstall: number; disputedRepair: number; disputedNapRehab: number }>>({});
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
      napRehab: drafts[subcontractorId]?.napRehab ?? saved?.nap_rehab_tickets ?? 0,
      disputedInstall: drafts[subcontractorId]?.disputedInstall ?? saved?.disputed_install ?? 0,
      disputedRepair: drafts[subcontractorId]?.disputedRepair ?? saved?.disputed_repair ?? 0,
      disputedNapRehab: drafts[subcontractorId]?.disputedNapRehab ?? saved?.disputed_nap_rehab ?? 0,
    };
  }

  function updateDraft(
    subcontractorId: string,
    patch: Partial<{ install: number; repair: number; napRehab: number; disputedInstall: number; disputedRepair: number; disputedNapRehab: number }>,
  ) {
    setDrafts((current) => {
      const saved = existingEntryFor(subcontractorId);
      const currentValues = current[subcontractorId] ?? {
        install: saved?.install_tickets ?? 0,
        repair: saved?.repair_tickets ?? 0,
        napRehab: saved?.nap_rehab_tickets ?? 0,
        disputedInstall: saved?.disputed_install ?? 0,
        disputedRepair: saved?.disputed_repair ?? 0,
        disputedNapRehab: saved?.disputed_nap_rehab ?? 0,
      };
      return {
        ...current,
        [subcontractorId]: { ...currentValues, ...patch },
      };
    });
  }

  function isDirty(subcontractor: Subcontractor) {
    const saved = existingEntryFor(subcontractor.id);
    const values = draftValuesFor(subcontractor.id);
    return (
      normalizeTicketCount(values.install) !== (saved?.install_tickets ?? 0) ||
      normalizeTicketCount(values.repair) !== (saved?.repair_tickets ?? 0) ||
      normalizeTicketCount(values.napRehab) !== (saved?.nap_rehab_tickets ?? 0) ||
      normalizeTicketCount(values.disputedInstall) !== (saved?.disputed_install ?? 0) ||
      normalizeTicketCount(values.disputedRepair) !== (saved?.disputed_repair ?? 0) ||
      normalizeTicketCount(values.disputedNapRehab) !== (saved?.disputed_nap_rehab ?? 0)
    );
  }

  async function saveRow(subcontractor: Subcontractor) {
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
      nap_rehab_tickets: normalizeTicketCount(currentDraft.napRehab),
      disputed_install: normalizeTicketCount(currentDraft.disputedInstall),
      disputed_repair: normalizeTicketCount(currentDraft.disputedRepair),
      disputed_nap_rehab: normalizeTicketCount(currentDraft.disputedNapRehab),
      installation_rate: toNumber(subcontractor.installation_rate),
      repair_rate: toNumber(subcontractor.repair_rate),
      nap_rehab_rate: toNumber(subcontractor.nap_rehab_rate),
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

    const result = await repos.subconDailyTickets.save(payload);
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
    const dirty = activeSubcons.filter((s) => isDirty(s) || draftValuesFor(s.id).install > 0 || draftValuesFor(s.id).repair > 0 || draftValuesFor(s.id).napRehab > 0);
    if (dirty.length === 0) return;
    setSavingAll(true);
    for (const subcon of dirty) await saveRow(subcon);
    setSavedIds(new Set(dirty.map((s) => s.id)));
    setTimeout(() => setSavedIds(new Set()), 2000);
    setSavingAll(false);
  }

  const [entryYear, entryMonth, entryDay] = entryDate.split("-").map(Number);
  const entryBillingPeriod = entryDay <= 15 ? "first_half" : "second_half";
  const totalInstallationForDate = activeSubcons.reduce((sum, s) => sum + normalizeTicketCount(draftValuesFor(s.id).install), 0);
  const totalRepairForDate = activeSubcons.reduce((sum, s) => sum + normalizeTicketCount(draftValuesFor(s.id).repair), 0);
  const totalNapRehabForDate = activeSubcons.reduce((sum, s) => sum + normalizeTicketCount(draftValuesFor(s.id).napRehab), 0);
  const totalInstallationForBillingPeriod =
    activeSubcons.reduce(
      (sum, subcontractor) =>
        sum + countSubconTickets(
          subconDailyTickets.filter((entry) => entry.entry_date !== entryDate),
          subcontractor.id,
          entryMonth,
          entryYear,
          entryBillingPeriod,
        ).install,
      0,
    ) + totalInstallationForDate;
  const totalRepairForBillingPeriod =
    activeSubcons.reduce(
      (sum, subcontractor) =>
        sum + countSubconTickets(
          subconDailyTickets.filter((entry) => entry.entry_date !== entryDate),
          subcontractor.id,
          entryMonth,
          entryYear,
          entryBillingPeriod,
        ).repair,
      0,
    ) + totalRepairForDate;
  const totalNapRehabForBillingPeriod =
    activeSubcons.reduce(
      (sum, subcontractor) =>
        sum + countSubconTickets(
          subconDailyTickets.filter((entry) => entry.entry_date !== entryDate),
          subcontractor.id,
          entryMonth,
          entryYear,
          entryBillingPeriod,
        ).napRehab,
      0,
    ) + totalNapRehabForDate;

  function subconEntryBillableSnapshot(entry: SubconDailyTicket) {
    const installationTickets = Math.max(
      0,
      normalizeTicketCount(entry.install_tickets) - Math.min(normalizeTicketCount(entry.install_tickets), normalizeTicketCount(entry.disputed_install ?? 0)),
    );
    const repairTickets = Math.max(
      0,
      normalizeTicketCount(entry.repair_tickets) - Math.min(normalizeTicketCount(entry.repair_tickets), normalizeTicketCount(entry.disputed_repair ?? 0)),
    );
    const napRehabTickets = Math.max(
      0,
      normalizeTicketCount(entry.nap_rehab_tickets ?? 0) - Math.min(normalizeTicketCount(entry.nap_rehab_tickets ?? 0), normalizeTicketCount(entry.disputed_nap_rehab ?? 0)),
    );
    const installationAmount = installationTickets * toNumber(entry.installation_rate);
    const repairAmount = repairTickets * toNumber(entry.repair_rate);
    const napRehabAmount = napRehabTickets * toNumber(entry.nap_rehab_rate);
    return { installationTickets, repairTickets, napRehabTickets, installationAmount, repairAmount, napRehabAmount, gross: installationAmount + repairAmount + napRehabAmount };
  }

  function billableSnapshotFor(subcontractor: Subcontractor) {
    const values = draftValuesFor(subcontractor.id);
    const billableInstall = Math.max(0, normalizeTicketCount(values.install) - normalizeTicketCount(values.disputedInstall));
    const billableRepair = Math.max(0, normalizeTicketCount(values.repair) - normalizeTicketCount(values.disputedRepair));
    const billableNapRehab = Math.max(0, normalizeTicketCount(values.napRehab) - normalizeTicketCount(values.disputedNapRehab));
    const savedEntry = existingEntryFor(subcontractor.id);
    const napRehabRate = subcontractor.nap_rehab_rate == null
      ? toNumber(savedEntry?.nap_rehab_rate)
      : toNumber(subcontractor.nap_rehab_rate);
    const computed = computeSubconItem(
      normalizeTicketCount(values.install),
      normalizeTicketCount(values.repair),
      normalizeTicketCount(values.disputedInstall),
      normalizeTicketCount(values.disputedRepair),
      toNumber(subcontractor.installation_rate),
      toNumber(subcontractor.repair_rate),
      100,
      normalizeTicketCount(values.napRehab),
      normalizeTicketCount(values.disputedNapRehab),
      napRehabRate,
    );
    return {
      installationTickets: billableInstall,
      repairTickets: billableRepair,
      napRehabTickets: billableNapRehab,
      installationAmount: billableInstall * toNumber(subcontractor.installation_rate),
      repairAmount: billableRepair * toNumber(subcontractor.repair_rate),
      napRehabAmount: billableNapRehab * napRehabRate,
      napRehabRate,
      gross: computed.billingAmount,
    };
  }

  return (
    <div className="page-stack daily-ticket-page">
      <section className="subcon-ticket-stats">
        <div className="subcon-ticket-stat">
          <div className="subcon-ticket-stat-icon"><Wrench size={20} /></div>
          <div className="subcon-ticket-stat-text">
            <span>Subcontractors</span>
            <strong>{activeSubcons.length}</strong>
            <span className="subcon-ticket-stat-helper">Active subcontractors</span>
          </div>
        </div>
        <div className="subcon-ticket-stat logged">
          <div className="subcon-ticket-stat-icon"><Wrench size={20} /></div>
          <div className="subcon-ticket-stat-text">
            <span>Closed Repair Tickets</span>
            <strong>{totalRepairForBillingPeriod}</strong>
            <span className="subcon-ticket-stat-helper">Repair count for current billing period</span>
          </div>
        </div>
        <div className="subcon-ticket-stat total">
          <div className="subcon-ticket-stat-icon"><BadgeDollarSign size={20} /></div>
          <div className="subcon-ticket-stat-text">
            <span>Closed Installation Tickets</span>
            <strong>{totalInstallationForBillingPeriod}</strong>
            <span className="subcon-ticket-stat-helper">Installation count for current billing period</span>
          </div>
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
        <div className="table-wrap ticket-table-wrap">
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
                <th className="ticket-rate-col">
                  Nap Rehab
                  <span className="ticket-rate-label">rate varies</span>
                </th>
                <th className="ticket-dispute-col">Disputed Install</th>
                <th className="ticket-dispute-col">Disputed Repair</th>
                <th className="ticket-dispute-col">Disputed Nap Rehab</th>
                <th className="ticket-gross-col">Gross</th>
                <th className="ticket-action-col" />
              </tr>
            </thead>
            <tbody>
              {filteredSubcons.map((subcontractor) => {
                const values = draftValuesFor(subcontractor.id);
                const snapshot = billableSnapshotFor(subcontractor);
                const gross = snapshot.gross;
                const dirty = isDirty(subcontractor);
                const busy = busySubconId === subcontractor.id;
                const saved = savedIds.has(subcontractor.id);
                return (
                  <tr key={subcontractor.id} className={dirty ? "ticket-row-dirty" : saved ? "ticket-row-saved" : ""}>
                    <td className="ticket-employee-name">
                      {subcontractor.name}
                      <span className="ticket-rate-label">
                        Install ₱{toNumber(subcontractor.installation_rate).toLocaleString()} · Repair ₱{toNumber(subcontractor.repair_rate).toLocaleString()} · Nap ₱{snapshot.napRehabRate.toLocaleString()}
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
                    <td className="ticket-count-cell">
                      <input
                        aria-label={`Nap Rehab tickets for ${subcontractor.name}`}
                        min="0"
                        step="1"
                        type="number"
                        value={values.napRehab}
                        onChange={(e) => updateDraft(subcontractor.id, { napRehab: normalizeTicketCount(e.target.value) })}
                      />
                    </td>
                    <td className="ticket-count-cell ticket-count-cell--dispute">
                      <input
                        aria-label={`Disputed install tickets for ${subcontractor.name}`}
                        disabled={normalizeTicketCount(values.install) === 0}
                        max={normalizeTicketCount(values.install)}
                        min="0"
                        step="1"
                        type="number"
                        value={Math.min(normalizeTicketCount(values.install), normalizeTicketCount(values.disputedInstall))}
                        onChange={(e) => setDrafts((current) => ({
                          ...current,
                          [subcontractor.id]: {
                            ...draftValuesFor(subcontractor.id),
                            disputedInstall: Math.min(normalizeTicketCount(values.install), normalizeTicketCount(e.target.value)),
                          },
                        }))}
                      />
                    </td>
                    <td className="ticket-count-cell ticket-count-cell--dispute">
                      <input
                        aria-label={`Disputed repair tickets for ${subcontractor.name}`}
                        disabled={normalizeTicketCount(values.repair) === 0}
                        max={normalizeTicketCount(values.repair)}
                        min="0"
                        step="1"
                        type="number"
                        value={Math.min(normalizeTicketCount(values.repair), normalizeTicketCount(values.disputedRepair))}
                        onChange={(e) => setDrafts((current) => ({
                          ...current,
                          [subcontractor.id]: {
                            ...draftValuesFor(subcontractor.id),
                            disputedRepair: Math.min(normalizeTicketCount(values.repair), normalizeTicketCount(e.target.value)),
                          },
                        }))}
                      />
                    </td>
                    <td className="ticket-count-cell ticket-count-cell--dispute">
                      <input
                        aria-label={`Disputed Nap Rehab tickets for ${subcontractor.name}`}
                        disabled={normalizeTicketCount(values.napRehab) === 0}
                        max={normalizeTicketCount(values.napRehab)}
                        min="0"
                        step="1"
                        type="number"
                        value={Math.min(normalizeTicketCount(values.napRehab), normalizeTicketCount(values.disputedNapRehab))}
                        onChange={(e) => setDrafts((current) => ({
                          ...current,
                          [subcontractor.id]: {
                            ...draftValuesFor(subcontractor.id),
                            disputedNapRehab: Math.min(normalizeTicketCount(values.napRehab), normalizeTicketCount(e.target.value)),
                          },
                        }))}
                      />
                    </td>
                    <td className="ticket-gross-cell">
                      <strong>{currency.format(gross)}</strong>
                      {normalizeTicketCount(values.napRehab) > 0 && snapshot.napRehabRate === 0 && (
                        <span className="ticket-rate-warning">Set Nap rate</span>
                      )}
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

      {filteredSubcons.length > 0 && (
        <div className="ticket-mobile-list">
          {filteredSubcons.map((subcontractor) => {
            const values = draftValuesFor(subcontractor.id);
            const snapshot = billableSnapshotFor(subcontractor);
            const gross = snapshot.gross;
            const dirty = isDirty(subcontractor);
            const busy = busySubconId === subcontractor.id;
            const saved = savedIds.has(subcontractor.id);
            return (
              <div
                className={`ticket-mobile-card${dirty ? " ticket-mobile-card--dirty" : saved ? " ticket-mobile-card--saved" : ""}`}
                key={subcontractor.id}
              >
                <div className="ticket-mobile-card-header">
                  <div className="employee-list-identity">
                    <div className="employee-list-avatar">
                      <span>{subcontractor.name.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "S"}</span>
                    </div>
                    <RecordTitle
                      notes={`Install ₱${toNumber(subcontractor.installation_rate).toLocaleString()} · Repair ₱${toNumber(subcontractor.repair_rate).toLocaleString()} · Nap ₱${snapshot.napRehabRate.toLocaleString()}`}
                      title={subcontractor.name}
                    />
                  </div>
                  <div>
                    <strong className="ticket-mobile-card-gross">{currency.format(gross)}</strong>
                    {normalizeTicketCount(values.napRehab) > 0 && snapshot.napRehabRate === 0 && (
                      <span className="ticket-rate-warning">Set Nap rate</span>
                    )}
                  </div>
                </div>
                <div className="ticket-mobile-input-grid">
                  <label className="ticket-mobile-input-tile">
                    <span>Repair</span>
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
                  </label>
                  <label className="ticket-mobile-input-tile">
                    <span>Installation</span>
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
                  </label>
                  <label className="ticket-mobile-input-tile">
                    <span>Nap Rehab</span>
                    <input
                      aria-label={`Nap Rehab tickets for ${subcontractor.name}`}
                      min="0"
                      step="1"
                      type="number"
                      value={values.napRehab}
                      onChange={(e) => updateDraft(subcontractor.id, { napRehab: normalizeTicketCount(e.target.value) })}
                    />
                  </label>
                  <label className="ticket-mobile-input-tile ticket-mobile-input-tile--dispute">
                    <span>Disputed Install</span>
                    <input
                      aria-label={`Disputed install tickets for ${subcontractor.name}`}
                      disabled={normalizeTicketCount(values.install) === 0}
                      max={normalizeTicketCount(values.install)}
                      min="0"
                      step="1"
                      type="number"
                      value={Math.min(normalizeTicketCount(values.install), normalizeTicketCount(values.disputedInstall))}
                      onChange={(e) => setDrafts((current) => ({
                        ...current,
                        [subcontractor.id]: {
                          ...draftValuesFor(subcontractor.id),
                          disputedInstall: Math.min(normalizeTicketCount(values.install), normalizeTicketCount(e.target.value)),
                        },
                      }))}
                    />
                  </label>
                  <label className="ticket-mobile-input-tile ticket-mobile-input-tile--dispute">
                    <span>Disputed Repair</span>
                    <input
                      aria-label={`Disputed repair tickets for ${subcontractor.name}`}
                      disabled={normalizeTicketCount(values.repair) === 0}
                      max={normalizeTicketCount(values.repair)}
                      min="0"
                      step="1"
                      type="number"
                      value={Math.min(normalizeTicketCount(values.repair), normalizeTicketCount(values.disputedRepair))}
                      onChange={(e) => setDrafts((current) => ({
                        ...current,
                        [subcontractor.id]: {
                          ...draftValuesFor(subcontractor.id),
                          disputedRepair: Math.min(normalizeTicketCount(values.repair), normalizeTicketCount(e.target.value)),
                        },
                      }))}
                    />
                  </label>
                  <label className="ticket-mobile-input-tile ticket-mobile-input-tile--dispute">
                    <span>Disputed Nap Rehab</span>
                    <input
                      aria-label={`Disputed Nap Rehab tickets for ${subcontractor.name}`}
                      disabled={normalizeTicketCount(values.napRehab) === 0}
                      max={normalizeTicketCount(values.napRehab)}
                      min="0"
                      step="1"
                      type="number"
                      value={Math.min(normalizeTicketCount(values.napRehab), normalizeTicketCount(values.disputedNapRehab))}
                      onChange={(e) => setDrafts((current) => ({
                        ...current,
                        [subcontractor.id]: {
                          ...draftValuesFor(subcontractor.id),
                          disputedNapRehab: Math.min(normalizeTicketCount(values.napRehab), normalizeTicketCount(e.target.value)),
                        },
                      }))}
                    />
                  </label>
                </div>
                <div className="ticket-mobile-card-footer">
                  {busy ? (
                    <span className="ticket-mobile-save-status"><Spinner size="small" /> Saving…</span>
                  ) : saved ? (
                    <span className="ticket-mobile-save-status ticket-mobile-save-status--saved"><CheckCircle2 size={16} /> Saved</span>
                  ) : (
                    <button
                      className="ticket-mobile-save-button"
                      disabled={!dirty}
                      onClick={() => void saveRowAndMark(subcontractor)}
                      type="button"
                    >
                      <Save size={15} /> Save
                    </button>
                  )}
                </div>
              </div>
            );
          })}
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
            <div className="attendance-table-inner">
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
                      <td className="att-no-cell" data-label="No.">
                        <span className="att-row-no">{employeeIndex + 1}</span>
                      </td>
                      <td data-label="Employee ID">{employeeCode(employeeIndex)}</td>
                      <td data-label="Employee">
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
                      <td data-label="Department">{emp.department || "Unassigned"}</td>
                      <td data-label="Status">
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
                      <td data-label="Time In">
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
                      <td data-label="Time Out">
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
                      <td data-label="Daily Earnings"><strong>{formatMoney(earnings)}</strong></td>
                      <td data-label="Remarks">{current === "absent" ? "No Entry" : current === "half_day" ? "Half Day" : "--"}</td>
                      <td data-label="Actions">
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
          </div>
          <div className="attendance-mobile-list">
              {paginatedEmployees.map((emp) => {
                const pos = positions.find((p) => p.id === emp.position_id);
                const current = statusFor(emp.id);
                const saved = existingEntries.has(emp.id);
                const dirty = drafts[emp.id] !== undefined || timeDrafts[emp.id] !== undefined;
                const dailyRate = Number(pos?.daily_rate ?? 0);
                const earnings = computeDailyEarnings(dailyRate, current, timeInFor(emp.id), timeOutFor(emp.id));
                const employeeIndex = dailyEmployees.findIndex((item) => item.id === emp.id);
                const busy = busyEmployeeId === emp.id;
                return (
                  <div
                    className={`ticket-mobile-card${dirty ? " ticket-mobile-card--dirty" : saved ? " ticket-mobile-card--saved" : ""}`}
                    key={emp.id}
                  >
                    <div className="ticket-mobile-card-header">
                      <span className="ticket-mobile-card-index">{employeeIndex + 1}</span>
                      <div className="employee-list-identity">
                        <div className="employee-list-avatar">
                          {emp.profile_photo_url ? <img src={emp.profile_photo_url} alt="" /> : <span>{initials(emp.full_name)}</span>}
                        </div>
                        <div className="record-title">
                          <strong>{emp.full_name}</strong>
                          {emp.email && <span>{emp.email}</span>}
                          <span className="emp-mobile-card-badge">{emp.department || "Unassigned"}</span>
                        </div>
                      </div>
                      <strong className="ticket-mobile-card-gross">{formatMoney(earnings)}</strong>
                    </div>
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
                    {requiresTimeTracking(current) && (
                      <div className="attendance-mobile-time-row">
                        <label className="attendance-mobile-time-field">
                          <span>Time In</span>
                          <input
                            type="time"
                            className={`attendance-time-input${!timeInFor(emp.id) ? " missing" : ""}`}
                            value={timeInFor(emp.id)}
                            onChange={(e) => setTime(emp.id, "time_in", e.target.value)}
                            aria-label={`Time in for ${emp.full_name}`}
                          />
                        </label>
                        <label className="attendance-mobile-time-field">
                          <span>Time Out</span>
                          <input
                            type="time"
                            className={`attendance-time-input${!timeOutFor(emp.id) ? " missing" : ""}`}
                            value={timeOutFor(emp.id)}
                            onChange={(e) => setTime(emp.id, "time_out", e.target.value)}
                            aria-label={`Time out for ${emp.full_name}`}
                          />
                        </label>
                      </div>
                    )}
                    <div className="ticket-mobile-card-footer">
                      {busy ? (
                        <span className="ticket-mobile-save-status"><Spinner size="small" /> Saving…</span>
                      ) : saved && !dirty ? (
                        <span className="ticket-mobile-save-status ticket-mobile-save-status--saved"><CheckCircle2 size={16} /> Saved</span>
                      ) : (
                        <button
                          className="ticket-mobile-save-button"
                          disabled={!dirty}
                          onClick={() => saveEntry(emp)}
                          type="button"
                          aria-label={`Save attendance for ${emp.full_name}`}
                        >
                          <Save size={15} /> Save
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {attendancePageCount > 1 && (
              <div className="attendance-footer">
                <span>Showing {(attendancePage - 1) * attendancePageSize + 1} to {Math.min(attendancePage * attendancePageSize, filteredEmployees.length)} of {filteredEmployees.length} employees</span>
                <div>
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

