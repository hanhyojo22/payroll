import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AttendanceEntry,
  BillingRecord,
  BillingSettings,
  CollectionReminder,
  DashboardLatestRun,
  DashboardSummary,
  DailyTicketEntry,
  EmployeeAdvance,
  Employee,
  Expense,
  ExpenseCategory,
  PaymentLedgerRow,
  PaymentReminder,
  PayrollHistoryRow,
  PayrollRun,
  PayrollRunItem,
  PayrollSettings,
  PayrollRunWithItems,
  Position,
  SalaryBond,
  SubcontractorAdvance,
  SubconDailyTicket,
  Subcontractor,
} from "../types";
import { collectionAgingBucket } from "../domain/collections";
import { isExpenseOverdue, isExpensePeriodDueToday } from "../domain/expenses";
import { supabaseCollectionRepository } from "../adapters/supabase/collectionRepository";
import { fetchSubcontractors } from "../features/billing/billingRepository";
import { fetchSubconDailyTickets } from "../features/billing/subconTicketRepository";
import { supabaseExpenseCategoryRepository, supabaseExpenseRepository } from "../adapters/supabase/expenseRepository";
import { fetchEmployeeAdvances } from "../features/payroll/employeeAdvanceRepository";
import { fetchPayrollHistoryRows, fetchPayrollRunItems, fetchPayrollRuns, fetchPayrollSettings } from "../features/payroll/payrollRepository";
import { fetchSalaryBonds } from "../features/salaryBonds/salaryBondRepository";
import { fetchSubcontractorAdvances } from "../features/subcontractors/subcontractorAdvanceRepository";
import { todayKey } from "../shared/utils/dates";

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

const currentMonth = () => new Date().getMonth() + 1;
const currentYear = () => new Date().getFullYear();
const toNumber = (value: string | number | null | undefined) => Number(value ?? 0);
const payPeriodLabel = (payPeriod: PayrollRun["pay_period"]) =>
  payPeriod === "first_half" ? "First half" : "Second half";

export async function loadWorkspaceData(supabase: SupabaseClient) {
  const [paymentResult, collectionResult, employeeAdvanceResult, dailyTicketResult, employeeResult, payrollResult] = await Promise.all([
    loadPayments(supabase),
    loadCollections(supabase),
    loadEmployeeAdvances(supabase),
    loadDailyTicketEntries(supabase),
    loadEmployees(supabase),
    loadPayrollRuns(supabase),
  ]);

  const error = employeeResult.error ?? payrollResult.error;
  const warnings = [paymentResult.error, collectionResult.error, employeeAdvanceResult.error, dailyTicketResult.error]
    .filter((warning): warning is AppErrorLike => Boolean(warning));

  return {
    data: {
      collections: collectionResult.data,
      dailyTicketEntries: dailyTicketResult.data,
      employeeAdvances: employeeAdvanceResult.data,
      employees: employeeResult.data,
      payments: paymentResult.data,
      payrollRuns: payrollResult.data,
    },
    error,
    warnings,
  };
}

export async function loadDashboardSummary(supabase: SupabaseClient) {
  const today = todayKey();
  const month = currentMonth();
  const year = currentYear();

  const latestRunResult = await settle<Omit<DashboardLatestRun, "item_count">>(
    "Latest payroll run",
    supabase
      .from("payroll_runs")
      .select("id,period_month,period_year,pay_period,generated_date")
      .order("period_year", { ascending: false })
      .order("period_month", { ascending: false })
      .order("pay_period", { ascending: false })
      .limit(1),
  );
  // "Current" payroll tracks the most recently generated pay period rather than today's
  // calendar month, since payroll for a closed period is typically generated a few days
  // into the next month (e.g. June's second half is run in early July).
  const latestRunPeriod = latestRunResult.data[0] ?? null;
  const payrollPeriodMonth = latestRunPeriod?.period_month ?? Number(month);
  const payrollPeriodYear = latestRunPeriod?.period_year ?? Number(year);

  const [activeEmployees, currentRunsResult, paymentsResult, collectionsResult, expensesResult] = await Promise.all([
    settleCount(
      "Active employees",
      supabase.from("employees").select("id", { count: "exact", head: true }).eq("status", "active"),
    ),
    settle<Omit<DashboardLatestRun, "item_count">>(
      "Current payroll runs",
      supabase
        .from("payroll_runs")
        .select("id,period_month,period_year,pay_period,generated_date")
        .eq("period_month", payrollPeriodMonth)
        .eq("period_year", payrollPeriodYear),
    ),
    settle<PaymentReminder>(
      "Open payment reminders",
      supabase
        .from("payment_reminders")
        .select("id,user_id,title,type,amount,due_date,status,notes,subcontractor_id,billing_subcon_item_id,billing_month,billing_year,billing_period,payout_leg,created_at,updated_at,payments:payment_reminder_payments(id,user_id,payment_reminder_id,amount,payment_date,payment_method,reference_number,notes,created_at)")
        .neq("status", "paid")
        .lte("due_date", today)
        .order("due_date"),
    ),
    loadCollections(supabase),
    loadExpenses(supabase),
  ]);

  const currentRunIds = currentRunsResult.data.map((run) => run.id);
  const currentItemsResult = currentRunIds.length > 0
    ? await settle<PayrollRunItem>(
      "Current payroll items",
      supabase
        .from("payroll_run_items")
        .select("id,user_id,payroll_run_id,employee_id,employee_name,position_id,position_name,pay_mode,base_pay,ticket_pay,daily_rate,days_worked,total_working_days,installation_tickets,repair_tickets,installation_rate,repair_rate,nap_rehab_tickets,nap_rehab_rate,gross_pay,allowances,deductions,net_pay,status,paid_date,notes,created_at,updated_at,ticket_details:payroll_run_item_ticket_details(id,user_id,payroll_run_item_id,position_ticket_category_id,category_name,ticket_count,rate,amount,created_at)")
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
  const openCollections = collectionsResult.data.filter((item) => !item.archived_at && item.outstanding_balance > 0);
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const collectionAging = {
    current: 0,
    days1To30: 0,
    days31To60: 0,
    days61To90: 0,
    daysOver90: 0,
  };
  openCollections.forEach((item) => {
    collectionAging[collectionAgingBucket(item.due_date, today)] += item.outstanding_balance;
  });
  // Personal expenses are flagged via due_date; Company expenses no longer have a due date, so a
  // Monthly Company expense's Payment Date (the recurring cycle's start day) serves as the
  // equivalent "notify me" reference instead.
  const expenseNotifyDate = (item: Expense) => item.due_date ?? (item.frequency === "monthly" ? item.payment_date : null);
  const isExpenseDueToday = (item: Expense) => item.due_date
    ? item.due_date === today
    : item.frequency === "monthly" && item.payment_date
      ? isExpensePeriodDueToday(item.payment_date, today)
      : false;
  const openExpenses = expensesResult.data.filter((item) => item.status !== "paid" && item.status !== "cancelled" && expenseNotifyDate(item));
  const summary: DashboardSummary = {
    activeEmployeeCount: activeEmployees.count,
    currentPayrollItemCount: currentItems.length,
    pendingPayroll: currentItems
      .filter((item) => item.status !== "paid")
      .reduce((sum, item) => sum + toNumber(item.net_pay), 0),
    paidPayroll: currentItems
      .filter((item) => item.status === "paid")
      .reduce((sum, item) => sum + toNumber(item.net_pay), 0),
    pendingCollections: openCollections.reduce((sum, item) => sum + toNumber(item.outstanding_balance), 0),
    collectedTotal: collectionsResult.data.flatMap((item) => item.payments)
      .filter((payment) => !payment.is_void)
      .reduce((sum, payment) => sum + toNumber(payment.amount), 0),
    overdueCollectionBalance: openCollections
      .filter((item) => item.due_date < today)
      .reduce((sum, item) => sum + toNumber(item.outstanding_balance), 0),
    collectedThisMonth: collectionsResult.data.flatMap((item) => item.payments)
      .filter((payment) => !payment.is_void && payment.payment_date.startsWith(monthKey))
      .reduce((sum, payment) => sum + toNumber(payment.amount), 0),
    collectionAging,
    latestRun: latestRun ? { ...latestRun, item_count: latestItemCount.count } : null,
    dueTodayPayments: paymentsResult.data.filter((item) => item.due_date === today),
    overduePayments: paymentsResult.data.filter((item) => item.due_date < today),
    dueTodayCollections: openCollections.filter((item) => item.due_date === today),
    overdueCollections: openCollections.filter((item) => item.due_date < today),
    dueTodayExpenses: openExpenses.filter(isExpenseDueToday),
    overdueExpenses: openExpenses.filter((item) => isExpenseOverdue(item, item.installment_payments, today)),
  };

  return {
    data: summary,
    error: activeEmployees.error ??
      latestRunResult.error ??
      currentRunsResult.error ??
      paymentsResult.error ??
      collectionsResult.error ??
      expensesResult.error ??
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
      .select("id,user_id,title,type,amount,due_date,status,notes,subcontractor_id,billing_subcon_item_id,billing_month,billing_year,billing_period,payout_leg,created_at,updated_at,payments:payment_reminder_payments(id,user_id,payment_reminder_id,amount,payment_date,payment_method,reference_number,notes,created_at)")
      .order("due_date"),
  );
}

export async function loadExpenseCategories(supabase: SupabaseClient) {
  const result = await supabaseExpenseCategoryRepository(supabase).list();
  return { data: result.data as ExpenseCategory[], error: result.error, label: "Expense categories" };
}

export async function loadExpenses(supabase: SupabaseClient) {
  const result = await supabaseExpenseRepository(supabase).list();
  return { data: result.data as Expense[], error: result.error, label: "Expenses" };
}

export function buildPaymentLedger(
  payments: PaymentReminder[],
  expenses: Expense[],
  expenseCategories: ExpenseCategory[] = [],
): PaymentLedgerRow[] {
  const installmentRows: PaymentLedgerRow[] = expenses.flatMap((expense) =>
    expense.installment_payments.map((payment) => ({
      id: payment.id,
      source: "expense" as const,
      paymentDate: payment.payment_date,
      label: expense.category_name,
      vendor: expense.employee_name,
      category: expense.category_name,
      categoryType: expenseCategories.find((category) => category.id === expense.category_id)?.type ?? null,
      amount: toNumber(payment.amount),
      method: payment.payment_method,
      referenceNumber: payment.reference_number,
      status: "posted",
      expenseId: expense.id,
      paymentReminderId: null,
      expenseAmount: toNumber(expense.amount),
      expenseFrequency: expense.frequency,
    })),
  );
  const payrollRows: PaymentLedgerRow[] = expenses
    .filter((expense) => expense.payroll_run_id !== null && expense.paid_date)
    .map((expense) => ({
      id: `${expense.id}-payroll-paid`,
      source: "expense" as const,
      paymentDate: expense.paid_date!,
      label: expense.category_name,
      vendor: expense.employee_name,
      category: expense.category_name,
      categoryType: expenseCategories.find((category) => category.id === expense.category_id)?.type ?? null,
      amount: toNumber(expense.amount),
      method: null,
      referenceNumber: "",
      status: "paid",
      expenseId: expense.id,
      paymentReminderId: null,
      expenseAmount: toNumber(expense.amount),
      expenseFrequency: expense.frequency,
    }));
  return [...installmentRows, ...payrollRows];
}

export async function loadCollections(supabase: SupabaseClient) {
  try {
    const result = await withTimeout(supabaseCollectionRepository(supabase).list(), "Collections");
    return { data: result.data ?? [], error: result.error, label: "Collections" };
  } catch (error) {
    return { data: [] as CollectionReminder[], error: error as AppErrorLike, label: "Collections" };
  }
}

export async function loadEmployeeAdvances(supabase: SupabaseClient) {
  try {
    const result = await withTimeout(fetchEmployeeAdvances(supabase), "Employee advances");
    return { data: result.data, error: result.error, label: "Employee advances" };
  } catch (error) {
    return { data: [] as EmployeeAdvance[], error: error as AppErrorLike, label: "Employee advances" };
  }
}

export async function loadSalaryBonds(supabase: SupabaseClient) {
  try {
    const result = await withTimeout(fetchSalaryBonds(supabase), "Salary bonds");
    return { data: result.data, error: result.error, label: "Salary bonds" };
  } catch (error) {
    return { data: [] as SalaryBond[], error: error as AppErrorLike, label: "Salary bonds" };
  }
}

export async function loadSubcontractorAdvances(supabase: SupabaseClient) {
  try {
    const result = await withTimeout(fetchSubcontractorAdvances(supabase), "Subcontractor advances");
    return { data: result.data, error: result.error, label: "Subcontractor advances" };
  } catch (error) {
    return { data: [] as SubcontractorAdvance[], error: error as AppErrorLike, label: "Subcontractor advances" };
  }
}

export async function loadDailyTicketEntries(supabase: SupabaseClient) {
  return settle<DailyTicketEntry>(
    "Daily tickets",
    supabase
      .from("daily_ticket_entries")
      .select("id,user_id,entry_date,employee_id,employee_name,position_id,position_name,installation_tickets,repair_tickets,disputed_install,disputed_repair,installation_rate,repair_rate,nap_rehab_tickets,nap_rehab_rate,created_at,updated_at,details:daily_ticket_entry_items(id,user_id,daily_ticket_entry_id,position_ticket_category_id,category_name,ticket_count,rate,ticket_type,created_at,updated_at)")
      .order("entry_date", { ascending: false }),
  );
}

export async function loadAttendanceEntries(supabase: SupabaseClient) {
  return settle<AttendanceEntry>(
    "Attendance",
    supabase
      .from("attendance_entries")
      .select("id,user_id,employee_id,employee_name,position_id,position_name,entry_date,status,time_in,time_out,created_at,updated_at")
      .order("entry_date", { ascending: false }),
  );
}

export async function loadPositions(supabase: SupabaseClient) {
  return settle<Position>(
    "Positions",
    supabase
      .from("positions")
      .select("id,user_id,name,department,description,status,pay_mode,monthly_base_salary,daily_rate,created_at,updated_at,categories:position_ticket_categories(id,user_id,position_id,name,rate,ticket_type,display_order,status,created_at,updated_at)")
      .order("name"),
  );
}

export async function loadEmployees(supabase: SupabaseClient) {
  return settle<Employee>(
    "Employees",
    supabase
      .from("employees")
      .select("id,user_id,full_name,role,position_id,department,contact_number,email,address,profile_photo_url,hire_date,date_of_birth,status,wage_category,installation_rate,repair_rate,nap_rehab_rate,monthly_salary,gender,civil_status,sss_number,philhealth_number,pagibig_number,sss_deduction,philhealth_deduction,pagibig_deduction,withholding_tax,tin_number,emergency_contact_name,emergency_contact_number,emergency_contact_relation,notes,created_at,updated_at")
      .order("full_name"),
  );
}

export async function loadPayrollRuns(supabase: SupabaseClient) {
  try {
    const result = await withTimeout(fetchPayrollRuns(supabase), "Payroll runs");
    return { data: result.data, error: result.error, label: "Payroll" };
  } catch (error) {
    return { data: [] as PayrollRunWithItems[], error: error as AppErrorLike, label: "Payroll" };
  }
}

export async function loadPayrollRunItems(supabase: SupabaseClient, payrollRunId: string) {
  try {
    const result = await withTimeout(fetchPayrollRunItems(supabase, payrollRunId), "Payroll items");
    return { data: result.data, error: result.error, label: "Payroll items" };
  } catch (error) {
    return { data: [] as PayrollRunItem[], error: error as AppErrorLike, label: "Payroll items" };
  }
}

export async function loadPayrollHistoryRows(supabase: SupabaseClient, page = 0, pageSize = 100) {
  try {
    const result = await withTimeout(fetchPayrollHistoryRows(supabase, page, pageSize), "Payroll history");
    return { data: result.data, error: result.error, label: "Payroll history" };
  } catch (error) {
    return { data: [] as PayrollHistoryRow[], error: error as AppErrorLike, label: "Payroll history" };
  }
}

export async function loadPayrollSettings(supabase: SupabaseClient) {
  const result = await fetchPayrollSettings(supabase);
  return { data: result.data as PayrollSettings | null, error: result.error, label: "Payroll settings" };
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
        nap_rehab_tickets,
        nap_rehab_rate,
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
      nap_rehab_tickets: item.nap_rehab_tickets,
      nap_rehab_rate: item.nap_rehab_rate,
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

export async function loadBillingRecords(supabase: SupabaseClient) {
  return settle<BillingRecord>(
    "Billing records",
    supabase
      .from("billing_records")
      .select("id,user_id,invoice_no,billing_month,billing_year,billing_period,install_tickets,repair_tickets,disputed_install,disputed_repair,nap_rehab_tickets,disputed_nap_rehab,company_install_tickets,company_repair_tickets,company_disputed_install,company_disputed_repair,company_nap_rehab_tickets,company_disputed_nap_rehab,total_tickets,disputed_tickets,billable_tickets,billing_rate,installation_rate,repair_rate,nap_rehab_rate,billing_amount,collections_pct,collections_amount,collectibles_amount,collection_id,collectibles_collection_id,due_date,notes,created_at,updated_at,subcon_items:billing_subcon_items(id,user_id,billing_record_id,subcontractor_id,subcon_name,install_tickets,repair_tickets,nap_rehab_tickets,disputed_install,disputed_repair,disputed_nap_rehab,installation_rate,repair_rate,nap_rehab_rate,billable_tickets,billing_amount,payable_pct,payable_amount,collection_amount,created_at)")
      .order("billing_year", { ascending: false })
      .order("billing_month", { ascending: false }),
  );
}

export async function loadBillingSettings(supabase: SupabaseClient) {
  const result = await settle<BillingSettings>(
    "Billing settings",
    supabase
      .from("billing_settings")
      .select("id,user_id,installation_rate,repair_rate,nap_rehab_rate,collections_pct,client_name,created_at,updated_at")
      .limit(1),
  );
  return {
    data: result.data[0] ?? null,
    error: result.error,
    label: result.label,
  };
}

export async function loadSubcontractors(supabase: SupabaseClient) {
  const result = await fetchSubcontractors(supabase);
  return { data: result.data, error: result.error, label: "Subcontractors" };
}

export async function loadSubconDailyTickets(supabase: SupabaseClient) {
  const result = await fetchSubconDailyTickets(supabase);
  return { data: result.data as SubconDailyTicket[], error: result.error, label: "Subcon daily tickets" };
}
