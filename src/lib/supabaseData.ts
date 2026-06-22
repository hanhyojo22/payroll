import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AttendanceEntry,
  CollectionReminder,
  DashboardLatestRun,
  DashboardSummary,
  DailyTicketEntry,
  Employee,
  PaymentReminder,
  PayrollHistoryRow,
  PayrollRun,
  PayrollRunItem,
  PayrollRunWithItems,
  Position,
  SalaryBond,
} from "../types";

type AppErrorLike = { message?: string; details?: string | null; code?: string };
type QueryResult<T> = { data: T[] | null; error: AppErrorLike | null };
type CountResult = { count: number | null; error: AppErrorLike | null };

const REQUEST_TIMEOUT_MS = 30000;

function timeoutError(label: string): AppErrorLike {
  return {
    code: "REQUEST_TIMEOUT",
    details: `${label} is taking longer than expected. Please check your connection and try again.`,
    message: `${label} request timed out`,
  };
}

function withTimeout<T>(promise: PromiseLike<T>, label: string) {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(timeoutError(label)), REQUEST_TIMEOUT_MS);

    Promise.resolve(promise)
      .then(resolve)
      .catch(reject)
      .finally(() => window.clearTimeout(timeout));
  });
}

async function settle<T>(label: string, request: PromiseLike<QueryResult<T>>) {
  try {
    const result = await withTimeout(request, label);
    return result.error
      ? { data: [] as T[], error: result.error, label }
      : { data: (result.data ?? []) as T[], error: null, label };
  } catch (error) {
    return {
      data: [] as T[],
      error: error as AppErrorLike,
      label,
    };
  }
}

async function settleCount(label: string, request: PromiseLike<CountResult>) {
  try {
    const result = await withTimeout(request, label);
    return result.error
      ? { count: 0, error: result.error, label }
      : { count: result.count ?? 0, error: null, label };
  } catch (error) {
    return {
      count: 0,
      error: error as AppErrorLike,
      label,
    };
  }
}

const todayKey = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => new Date().getMonth() + 1;
const currentYear = () => new Date().getFullYear();
const toNumber = (value: string | number | null | undefined) => Number(value ?? 0);
const payPeriodLabel = (payPeriod: PayrollRun["pay_period"]) =>
  payPeriod === "first_half" ? "First half" : "Second half";

export async function loadWorkspaceData(supabase: SupabaseClient) {
  const [paymentResult, collectionResult, salaryBondResult, dailyTicketResult, employeeResult, payrollResult] = await Promise.all([
    loadPayments(supabase),
    loadCollections(supabase),
    loadSalaryBonds(supabase),
    loadDailyTicketEntries(supabase),
    loadEmployees(supabase),
    loadPayrollRuns(supabase),
  ]);

  const error = employeeResult.error ?? payrollResult.error;
  const warnings = [paymentResult.error, collectionResult.error, salaryBondResult.error, dailyTicketResult.error]
    .filter((warning): warning is AppErrorLike => Boolean(warning));

  return {
    data: {
      collections: collectionResult.data,
      dailyTicketEntries: dailyTicketResult.data,
      employees: employeeResult.data,
      payments: paymentResult.data,
      payrollRuns: payrollResult.data,
      salaryBonds: salaryBondResult.data,
    },
    error,
    warnings,
  };
}

export async function loadDashboardSummary(supabase: SupabaseClient) {
  const today = todayKey();
  const month = currentMonth();
  const year = currentYear();

  const [activeEmployees, latestRunResult, currentRunsResult, paymentsResult, collectionsResult] = await Promise.all([
    settleCount(
      "Active employees",
      supabase.from("employees").select("id", { count: "exact", head: true }).eq("status", "active"),
    ),
    settle<Omit<DashboardLatestRun, "item_count">>(
      "Latest payroll run",
      supabase
        .from("payroll_runs")
        .select("id,period_month,period_year,pay_period,generated_date")
        .order("period_year", { ascending: false })
        .order("period_month", { ascending: false })
        .order("pay_period", { ascending: false })
        .limit(1),
    ),
    settle<Omit<DashboardLatestRun, "item_count">>(
      "Current payroll runs",
      supabase
        .from("payroll_runs")
        .select("id,period_month,period_year,pay_period,generated_date")
        .eq("period_month", month)
        .eq("period_year", year),
    ),
    settle<PaymentReminder>(
      "Open payment reminders",
      supabase
        .from("payment_reminders")
        .select("id,user_id,title,type,amount,due_date,status,notes,created_at,updated_at")
        .neq("status", "paid")
        .lte("due_date", today)
        .order("due_date"),
    ),
    settle<CollectionReminder>(
      "Collection reminders",
      supabase
        .from("collection_reminders")
        .select("id,user_id,title,client_name,amount,due_date,status,notes,created_at,updated_at")
        .order("due_date"),
    ),
  ]);

  const currentRunIds = currentRunsResult.data.map((run) => run.id);
  const currentItemsResult = currentRunIds.length > 0
    ? await settle<PayrollRunItem>(
      "Current payroll items",
      supabase
        .from("payroll_run_items")
        .select("id,user_id,payroll_run_id,employee_id,employee_name,position_id,position_name,pay_mode,base_pay,ticket_pay,daily_rate,days_worked,total_working_days,installation_tickets,repair_tickets,installation_rate,repair_rate,gross_pay,allowances,deductions,net_pay,status,paid_date,notes,created_at,updated_at,ticket_details:payroll_run_item_ticket_details(id,user_id,payroll_run_item_id,position_ticket_category_id,category_name,ticket_count,rate,amount,created_at)")
        .in("payroll_run_id", currentRunIds),
    )
    : { data: [] as PayrollRunItem[], error: null, label: "Current payroll items" };

  const latestRun = latestRunResult.data[0] ?? null;
  const latestItemCount = latestRun
    ? await settleCount(
      "Latest payroll item count",
      supabase.from("payroll_run_items").select("id", { count: "exact", head: true }).eq("payroll_run_id", latestRun.id),
    )
    : { count: 0, error: null, label: "Latest payroll item count" };

  const currentItems = currentItemsResult.data;
  const openCollections = collectionsResult.data.filter((item) => item.status !== "collected");
  const summary: DashboardSummary = {
    activeEmployeeCount: activeEmployees.count,
    currentPayrollItemCount: currentItems.length,
    pendingPayroll: currentItems
      .filter((item) => item.status !== "paid")
      .reduce((sum, item) => sum + toNumber(item.net_pay), 0),
    paidPayroll: currentItems
      .filter((item) => item.status === "paid")
      .reduce((sum, item) => sum + toNumber(item.net_pay), 0),
    pendingCollections: openCollections.reduce((sum, item) => sum + toNumber(item.amount), 0),
    collectedTotal: collectionsResult.data
      .filter((item) => item.status === "collected")
      .reduce((sum, item) => sum + toNumber(item.amount), 0),
    latestRun: latestRun ? { ...latestRun, item_count: latestItemCount.count } : null,
    dueTodayPayments: paymentsResult.data.filter((item) => item.due_date === today),
    overduePayments: paymentsResult.data.filter((item) => item.due_date < today),
    dueTodayCollections: openCollections.filter((item) => item.due_date === today),
    overdueCollections: openCollections.filter((item) => item.due_date < today),
  };

  return {
    data: summary,
    error: activeEmployees.error ??
      latestRunResult.error ??
      currentRunsResult.error ??
      paymentsResult.error ??
      collectionsResult.error ??
      currentItemsResult.error ??
      latestItemCount.error,
    label: "Dashboard",
  };
}

export async function loadPayments(supabase: SupabaseClient) {
  return settle<PaymentReminder>(
    "Payments",
    supabase
      .from("payment_reminders")
      .select("id,user_id,title,type,amount,due_date,status,notes,created_at,updated_at")
      .order("due_date"),
  );
}

export async function loadCollections(supabase: SupabaseClient) {
  return settle<CollectionReminder>(
    "Collections",
    supabase
      .from("collection_reminders")
      .select("id,user_id,title,client_name,amount,due_date,status,notes,created_at,updated_at")
      .order("due_date"),
  );
}

export async function loadSalaryBonds(supabase: SupabaseClient) {
  return settle<SalaryBond>(
    "Salary bonds",
    supabase
      .from("salary_bonds")
      .select("id,user_id,employee_id,employee_name,bond_id,bond_type,date_granted,start_deduction,purpose,amount,balance,deduction_per_payroll,status,notes,created_at,updated_at")
      .order("created_at", { ascending: false }),
  );
}

export async function loadDailyTicketEntries(supabase: SupabaseClient) {
  return settle<DailyTicketEntry>(
    "Daily tickets",
    supabase
      .from("daily_ticket_entries")
      .select("id,user_id,entry_date,employee_id,employee_name,position_id,position_name,installation_tickets,repair_tickets,installation_rate,repair_rate,created_at,updated_at,details:daily_ticket_entry_items(id,user_id,daily_ticket_entry_id,position_ticket_category_id,category_name,ticket_count,rate,created_at,updated_at)")
      .order("entry_date", { ascending: false }),
  );
}

export async function loadAttendanceEntries(supabase: SupabaseClient) {
  return settle<AttendanceEntry>(
    "Attendance",
    supabase
      .from("attendance_entries")
      .select("id,user_id,employee_id,employee_name,position_id,position_name,entry_date,status,created_at,updated_at")
      .order("entry_date", { ascending: false }),
  );
}

export async function loadPositions(supabase: SupabaseClient) {
  return settle<Position>(
    "Positions",
    supabase
      .from("positions")
      .select("id,user_id,name,department,description,status,pay_mode,monthly_base_salary,daily_rate,created_at,updated_at,categories:position_ticket_categories(id,user_id,position_id,name,rate,display_order,status,created_at,updated_at)")
      .order("name"),
  );
}

export async function loadEmployees(supabase: SupabaseClient) {
  return settle<Employee>(
    "Employees",
    supabase
      .from("employees")
      .select("id,user_id,full_name,role,position_id,department,contact_number,email,address,profile_photo_url,hire_date,status,wage_category,installation_rate,repair_rate,monthly_salary,sss_number,philhealth_number,pagibig_number,tin_number,notes,created_at,updated_at")
      .order("full_name"),
  );
}

export async function loadPayrollRuns(supabase: SupabaseClient) {
  const runResult = await settle<PayrollRun>(
    "Payroll runs",
    supabase
      .from("payroll_runs")
      .select("id,user_id,period_month,period_year,pay_period,generated_date,notes,created_at,updated_at")
      .order("period_year", { ascending: false })
      .order("period_month", { ascending: false })
      .order("pay_period", { ascending: false })
      .limit(100),
  );

  return {
    data: runResult.data.map((run) => ({ ...run, items: [] })) as PayrollRunWithItems[],
    error: runResult.error,
    label: "Payroll",
  };
}

export async function loadPayrollRunItems(supabase: SupabaseClient, payrollRunId: string) {
  return settle<PayrollRunItem>(
    "Payroll items",
    supabase
      .from("payroll_run_items")
      .select("id,user_id,payroll_run_id,employee_id,employee_name,position_id,position_name,pay_mode,base_pay,ticket_pay,daily_rate,days_worked,total_working_days,installation_tickets,repair_tickets,installation_rate,repair_rate,gross_pay,allowances,deductions,net_pay,status,paid_date,notes,created_at,updated_at,ticket_details:payroll_run_item_ticket_details(id,user_id,payroll_run_item_id,position_ticket_category_id,category_name,ticket_count,rate,amount,created_at)")
      .eq("payroll_run_id", payrollRunId)
      .order("employee_name"),
  );
}

export async function loadPayrollHistoryRows(supabase: SupabaseClient, page = 0, pageSize = 100) {
  const from = page * pageSize;
  const to = from + pageSize - 1;
  const result = await settle<any>(
    "Payroll history",
    supabase
      .from("payroll_run_items")
      .select(`
        id,
        employee_id,
        employee_name,
        position_id,
        position_name,
        pay_mode,
        base_pay,
        ticket_pay,
        gross_pay,
        deductions,
        net_pay,
        status,
        paid_date,
        payroll_runs!inner(period_month,period_year,pay_period,generated_date),
        employees(department)
      `)
      .eq("status", "paid")
      .order("paid_date", { ascending: false, nullsFirst: false })
      .range(from, to),
  );

  const rows = result.data.map((item, index) => {
    const run = Array.isArray(item.payroll_runs) ? item.payroll_runs[0] : item.payroll_runs;
    const employee = Array.isArray(item.employees) ? item.employees[0] : item.employees;
    const payPeriod = run
      ? `${run.period_month}/${run.period_year} - ${payPeriodLabel(run.pay_period)}`
      : "Unknown pay period";
    const payrollNo = run
      ? `${run.period_year}-${String(run.period_month).padStart(2, "0")}-${run.pay_period === "first_half" ? "1" : "2"}-${String(from + index + 1).padStart(3, "0")}`
      : `PAY-${String(from + index + 1).padStart(3, "0")}`;
    const department = employee?.department || "Unassigned";
    const processedDate = item.paid_date || run?.generated_date || "";

    return {
      payrollNo,
      payPeriod,
      employeeName: item.employee_name,
      department,
      grossPay: toNumber(item.gross_pay),
      deductions: toNumber(item.deductions),
      netPay: toNumber(item.net_pay),
      status: item.status,
      processedDate,
      searchText: `${payrollNo} ${payPeriod} ${item.employee_name} ${department} ${item.status} ${processedDate}`.toLowerCase(),
    } satisfies PayrollHistoryRow;
  });

  return {
    data: rows,
    error: result.error,
    label: result.label,
  };
}

export async function loadEmployeePayrollRuns(supabase: SupabaseClient, employeeId: string) {
  const result = await settle<any>(
    "Employee payroll history",
    supabase
      .from("payroll_run_items")
      .select(`
        id,
        user_id,
        payroll_run_id,
        employee_id,
        employee_name,
        position_id,
        position_name,
        pay_mode,
        base_pay,
        ticket_pay,
        daily_rate,
        days_worked,
        total_working_days,
        installation_tickets,
        repair_tickets,
        installation_rate,
        repair_rate,
        gross_pay,
        allowances,
        deductions,
        net_pay,
        status,
        paid_date,
        notes,
        created_at,
        updated_at,
        ticket_details:payroll_run_item_ticket_details(id,user_id,payroll_run_item_id,position_ticket_category_id,category_name,ticket_count,rate,amount,created_at),
        payroll_runs!inner(id,user_id,period_month,period_year,pay_period,generated_date,notes,created_at,updated_at)
      `)
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false })
      .limit(100),
  );

  const runMap = new Map<string, PayrollRunWithItems>();
  result.data.forEach((item) => {
    const run = Array.isArray(item.payroll_runs) ? item.payroll_runs[0] : item.payroll_runs;
    if (!run) return;

    const payrollItem: PayrollRunItem = {
      id: item.id,
      user_id: item.user_id,
      payroll_run_id: item.payroll_run_id,
      employee_id: item.employee_id,
      employee_name: item.employee_name,
      position_id: item.position_id,
      position_name: item.position_name,
      pay_mode: item.pay_mode,
      base_pay: item.base_pay,
      ticket_pay: item.ticket_pay,
      daily_rate: item.daily_rate,
      days_worked: item.days_worked,
      total_working_days: item.total_working_days,
      ticket_details: item.ticket_details ?? [],
      installation_tickets: item.installation_tickets,
      repair_tickets: item.repair_tickets,
      installation_rate: item.installation_rate,
      repair_rate: item.repair_rate,
      gross_pay: item.gross_pay,
      allowances: item.allowances,
      deductions: item.deductions,
      net_pay: item.net_pay,
      status: item.status,
      paid_date: item.paid_date,
      notes: item.notes,
      created_at: item.created_at,
      updated_at: item.updated_at,
    };

    const existingRun = runMap.get(run.id);
    if (existingRun) {
      existingRun.items.push(payrollItem);
    } else {
      runMap.set(run.id, { ...run, items: [payrollItem] });
    }
  });

  return {
    data: Array.from(runMap.values()),
    error: result.error,
    label: result.label,
  };
}
