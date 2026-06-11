import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  BadgeDollarSign,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  History,
  LayoutDashboard,
  LogOut,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { hasSupabaseConfig, supabase } from "./supabase";
import type {
  Employee,
  EmployeeFormValues,
  PaymentFormValues,
  PaymentReminder,
  PayrollRun,
  PayrollRunFormValues,
  PayrollRunItem,
  PayrollRunWithItems,
} from "./types";

type View = "dashboard" | "employees" | "payroll" | "payroll-history" | "payments" | "payment-history";
type Notice = { type: "success" | "error"; text: string } | null;
type AppError = { message?: string; code?: string; details?: string | null };

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
const toNumber = (value: string | number | null | undefined) => Number(value ?? 0);
const payrollGrossForPeriod = (monthlySalary: string | number) =>
  toNumber(monthlySalary) / 2;
const netPay = (gross: number, allowances: number, deductions: number) =>
  gross + allowances - deductions;
const payPeriodLabel = (payPeriod: PayrollRun["pay_period"]) =>
  payPeriod === "first_half" ? "First half" : "Second half";
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

  return fallback;
};

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
  department: "",
  contact_number: "",
  email: "",
  address: "",
  hire_date: todayKey(),
  status: "active",
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
  const [view, setView] = useState<View>("dashboard");
  const [payments, setPayments] = useState<PaymentReminder[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [payrollRuns, setPayrollRuns] = useState<PayrollRunWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);

  async function loadData() {
    if (!supabase) return;
    setLoading(true);

    const [paymentResult, employeeResult, runResult, itemResult] = await Promise.all([
      supabase.from("payment_reminders").select("*").order("due_date"),
      supabase.from("employees").select("*").order("full_name"),
      supabase
        .from("payroll_runs")
        .select("*")
        .order("period_year", { ascending: false })
        .order("period_month", { ascending: false })
        .order("pay_period", { ascending: false }),
      supabase.from("payroll_run_items").select("*").order("employee_name"),
    ]);

    const error =
      paymentResult.error ?? employeeResult.error ?? runResult.error ?? itemResult.error;
    if (error) {
      setNotice({ type: "error", text: friendlyError(error) });
      setLoading(false);
      return;
    }

    const items = (itemResult.data ?? []) as PayrollRunItem[];
    const runs = ((runResult.data ?? []) as PayrollRun[]).map((run) => ({
      ...run,
      items: items.filter((item) => item.payroll_run_id === run.id),
    }));

    setPayments((paymentResult.data ?? []) as PaymentReminder[]);
    setEmployees((employeeResult.data ?? []) as Employee[]);
    setPayrollRuns(runs);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

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
            <p className="eyebrow">Admin</p>
            <h1>Payroll</h1>
          </div>
        </div>
        <nav className="nav-list" aria-label="Main navigation">
          <NavButton active={view === "dashboard"} icon={<LayoutDashboard size={18} />} label="Dashboard" onClick={() => setView("dashboard")} />
          <NavButton active={view === "employees"} icon={<Users size={18} />} label="Employees" onClick={() => setView("employees")} />
          <NavButton active={view === "payroll"} icon={<BadgeDollarSign size={18} />} label="Payroll" onClick={() => setView("payroll")} />
          <NavButton active={view === "payroll-history"} icon={<History size={18} />} label="Pay History" onClick={() => setView("payroll-history")} />
          <NavButton active={view === "payments"} icon={<CreditCard size={18} />} label="Payments" onClick={() => setView("payments")} />
          <NavButton active={view === "payment-history"} icon={<CalendarClock size={18} />} label="Bill History" onClick={() => setView("payment-history")} />
        </nav>
        <div className="sidebar-footer">
          <p>{session.user.email}</p>
          <button className="icon-text-button" onClick={signOut} type="button">
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>

      <section className="content">
        <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} />
        {loading ? (
          <FullPageMessage title="Loading records" text="Fetching your cloud data..." />
        ) : (
          <>
            {view === "dashboard" && (
              <Dashboard employees={employees} payments={payments} payrollRuns={payrollRuns} />
            )}
            {view === "employees" && (
              <EmployeesView employees={employees} onChange={loadData} payrollRuns={payrollRuns} setNotice={setNotice} userId={session.user.id} />
            )}
            {view === "payroll" && (
              <PayrollView employees={employees} onChange={loadData} payrollRuns={payrollRuns} setNotice={setNotice} userId={session.user.id} />
            )}
            {view === "payroll-history" && (
              <PayrollHistoryView payrollRuns={payrollRuns} />
            )}
            {view === "payments" && (
              <PaymentsView onChange={loadData} payments={payments} setNotice={setNotice} userId={session.user.id} />
            )}
            {view === "payment-history" && (
              <PaymentHistoryView payments={payments} />
            )}
          </>
        )}
      </section>
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
  employees,
  payments,
  payrollRuns,
}: {
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

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Payroll overview"
        title="Dashboard"
        text="Monitor employees, payroll runs, and payment reminders."
      />
      <section className="metric-grid">
        <Metric icon={<Users />} label="Active employees" value={activeEmployees.length} />
        <Metric icon={<CalendarClock />} label="Current payroll" value={currentItems.length} />
        <Metric icon={<BadgeDollarSign />} label="Pending payroll" value={currency.format(pendingPayroll)} />
        <Metric icon={<CheckCircle2 />} label="Paid payroll" value={currency.format(paidPayroll)} tone="success" />
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
  rows: PaymentReminder[];
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

function EmployeesView({
  employees,
  onChange,
  payrollRuns,
  setNotice,
  userId,
}: {
  employees: Employee[];
  onChange: () => Promise<void>;
  payrollRuns: PayrollRunWithItems[];
  setNotice: (notice: Notice) => void;
  userId: string;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [editing, setEditing] = useState<Employee | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [historyEmployee, setHistoryEmployee] = useState<Employee | null>(null);

  const rows = employees.filter((employee) => {
    const matchesQuery = `${employee.full_name} ${employee.role} ${employee.department} ${employee.email}`
      .toLowerCase()
      .includes(query.toLowerCase());
    const matchesStatus = statusFilter === "all" || employee.status === statusFilter;
    return matchesQuery && matchesStatus;
  });

  async function saveEmployee(values: EmployeeFormValues) {
    if (!supabase) return;
    const payload = {
      full_name: values.full_name.trim(),
      role: values.role.trim(),
      department: values.department.trim(),
      contact_number: values.contact_number.trim(),
      email: values.email.trim(),
      address: values.address.trim(),
      hire_date: values.hire_date || null,
      status: values.status,
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
    setEditing(null);
    setFormOpen(false);
    await onChange();
  }

  async function remove(id: string) {
    if (!supabase || !window.confirm("Delete this employee?")) return;
    const { error } = await supabase.from("employees").delete().eq("id", id);
    setNotice(error ? { type: "error", text: friendlyError(error) } : { type: "success", text: "Employee deleted." });
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
        text="Maintain active staff profiles and salary details."
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
        headers={["Employee", "Department", "Monthly salary", "Status", "Actions"]}
        rows={rows.map((employee) => [
          <RecordTitle key="title" title={employee.full_name} notes={`${employee.role || "No role"} ${employee.email ? `- ${employee.email}` : ""}`} />,
          employee.department || "Unassigned",
          currency.format(toNumber(employee.monthly_salary)),
          <StatusPill key="status" status={employee.status} />,
          <RowActions
            key="actions"
            onDelete={() => remove(employee.id)}
            onEdit={() => { setEditing(employee); setFormOpen(true); }}
            onHistory={() => setHistoryEmployee(employee)}
          />,
        ])}
      />
      {formOpen && (
        <EmployeeForm
          initial={editing}
          onClose={() => { setEditing(null); setFormOpen(false); }}
          onSubmit={saveEmployee}
        />
      )}
      {historyEmployee && (
        <EmployeePayrollHistory
          employee={historyEmployee}
          onClose={() => setHistoryEmployee(null)}
          payrollRuns={payrollRuns}
        />
      )}
    </div>
  );
}

function EmployeePayrollHistory({
  employee,
  onClose,
  payrollRuns,
}: {
  employee: Employee;
  onClose: () => void;
  payrollRuns: PayrollRunWithItems[];
}) {
  const history = payrollRuns
    .flatMap((run) =>
      run.items
        .filter((item) => item.employee_id === employee.id)
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

  return (
    <Modal title={`${employee.full_name} payroll history`} onClose={onClose}>
      <div className="history-stack">
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
          empty="No payroll history for this employee yet."
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
      </div>
    </Modal>
  );
}

function PayrollView({
  employees,
  onChange,
  payrollRuns,
  setNotice,
  userId,
}: {
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
    const runResult = await supabase.from("payroll_runs").insert(runPayload).select().single();
    if (runResult.error) {
      setNotice({ type: "error", text: friendlyError(runResult.error) });
      return;
    }

    const newRun = runResult.data as PayrollRun;
    const itemPayloads = activeEmployees.map((employee) => {
      const gross = payrollGrossForPeriod(employee.monthly_salary);
      return {
        user_id: userId,
        payroll_run_id: newRun.id,
        employee_id: employee.id,
        employee_name: employee.full_name,
        gross_pay: gross,
        allowances: 0,
        deductions: 0,
        net_pay: gross,
        status: "pending",
        paid_date: null,
        notes: "",
      };
    });
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
    const gross = toNumber(patch.gross_pay ?? item.gross_pay);
    const allowances = toNumber(patch.allowances ?? item.allowances);
    const deductions = toNumber(patch.deductions ?? item.deductions);
    const payload = {
      ...patch,
      net_pay: netPay(gross, allowances, deductions),
    };
    const { error } = await supabase.from("payroll_run_items").update(payload).eq("id", item.id);
    setNotice(error ? { type: "error", text: friendlyError(error) } : { type: "success", text: "Payroll item updated." });
    await onChange();
  }

  async function addMissingEmployees() {
    if (!supabase || !selectedRun || missingEmployees.length === 0) return;

    const itemPayloads = missingEmployees.map((employee) => {
      const gross = payrollGrossForPeriod(employee.monthly_salary);
      return {
        user_id: userId,
        payroll_run_id: selectedRun.id,
        employee_id: employee.id,
        employee_name: employee.full_name,
        gross_pay: gross,
        allowances: 0,
        deductions: 0,
        net_pay: gross,
        status: "pending",
        paid_date: null,
        notes: "",
      };
    });
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
            <p>
              Add them using half of their current monthly salary. Existing payroll rows will not be duplicated.
            </p>
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
      headers={["Employee", "Gross", "Allowance", "Deduction", "Net", "Status", "Actions"]}
      rows={items.map((item) => [
        <RecordTitle key="employee" title={item.employee_name} notes={item.notes} />,
        <MoneyInput key="gross" value={item.gross_pay} onSave={(value) => onUpdate(item, { gross_pay: value })} />,
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
  value,
}: {
  onSave: (value: number) => Promise<void>;
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
      step="0.01"
      type="number"
      value={draft}
    />
  );
}

function PayrollHistoryView({ payrollRuns }: { payrollRuns: PayrollRunWithItems[] }) {
  const rows = payrollRuns.map((run) => {
    const totals = run.items.reduce(
      (sum, item) => ({
        gross: sum.gross + toNumber(item.gross_pay),
        allowances: sum.allowances + toNumber(item.allowances),
        deductions: sum.deductions + toNumber(item.deductions),
        net: sum.net + toNumber(item.net_pay),
        paid: sum.paid + (item.status === "paid" ? 1 : 0),
      }),
      { gross: 0, allowances: 0, deductions: 0, net: 0, paid: 0 },
    );

    return [
      `${monthNames[run.period_month - 1]} ${run.period_year}`,
      payPeriodLabel(run.pay_period),
      run.generated_date,
      String(run.items.length),
      `${totals.paid}/${run.items.length}`,
      currency.format(totals.gross),
      currency.format(totals.deductions),
      currency.format(totals.net),
    ];
  });

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Payroll records"
        title="Payroll History"
        text="Review generated payroll runs and their totals."
      />
      <DataTable
        empty="No payroll history yet."
        headers={["Period", "Pay period", "Generated", "Employees", "Paid", "Gross", "Deductions", "Net"]}
        rows={rows}
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
  rows,
}: {
  empty: string;
  headers: string[];
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
              <tr key={index}>
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
  onDelete,
  onEdit,
  onHistory,
  onMarkPaid,
}: {
  canMarkPaid?: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onHistory?: () => void;
  onMarkPaid?: () => void;
}) {
  return (
    <div className="row-actions">
      {canMarkPaid && onMarkPaid && (
        <button aria-label="Mark paid" onClick={onMarkPaid} title="Mark paid" type="button">
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
  initial,
  onClose,
  onSubmit,
}: {
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
          hire_date: initial.hire_date ?? "",
          status: initial.status,
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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!values.full_name.trim() || !values.monthly_salary) return;
    setBusy(true);
    await onSubmit(values);
    setBusy(false);
  }

  return (
    <Modal title={initial ? "Edit employee" : "Add employee"} onClose={onClose}>
      <form className="form-grid" onSubmit={handleSubmit}>
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
        <TextField label="Monthly salary" min="0" step="0.01" type="number" value={values.monthly_salary} onChange={(monthly_salary) => setValues({ ...values, monthly_salary })} required />
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
      <section aria-modal="true" className="modal" role="dialog">
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
