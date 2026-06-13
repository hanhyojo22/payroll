import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CollectionReminder,
  DailyTicketEntry,
  Employee,
  PaymentReminder,
  PayrollRun,
  PayrollRunItem,
  PayrollRunWithItems,
  SalaryBond,
} from "../types";

type AppErrorLike = { message?: string; details?: string | null; code?: string };
type QueryResult<T> = { data: T[] | null; error: AppErrorLike | null };

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

export async function loadPayments(supabase: SupabaseClient) {
  return settle<PaymentReminder>("Payments", supabase.from("payment_reminders").select("*").order("due_date"));
}

export async function loadCollections(supabase: SupabaseClient) {
  return settle<CollectionReminder>("Collections", supabase.from("collection_reminders").select("*").order("due_date"));
}

export async function loadSalaryBonds(supabase: SupabaseClient) {
  return settle<SalaryBond>(
    "Salary bonds",
    supabase.from("salary_bonds").select("*").order("created_at", { ascending: false }),
  );
}

export async function loadDailyTicketEntries(supabase: SupabaseClient) {
  return settle<DailyTicketEntry>(
    "Daily tickets",
    supabase.from("daily_ticket_entries").select("*").order("entry_date", { ascending: false }),
  );
}

export async function loadEmployees(supabase: SupabaseClient) {
  return settle<Employee>("Employees", supabase.from("employees").select("*").order("full_name"));
}

export async function loadPayrollRuns(supabase: SupabaseClient) {
  const [runResult, itemResult] = await Promise.all([
    settle<PayrollRun>(
      "Payroll runs",
      supabase
        .from("payroll_runs")
        .select("*")
        .order("period_year", { ascending: false })
        .order("period_month", { ascending: false })
        .order("pay_period", { ascending: false }),
    ),
    settle<PayrollRunItem>("Payroll items", supabase.from("payroll_run_items").select("*").order("employee_name")),
  ]);

  const payrollRuns = runResult.data.map((run) => ({
    ...run,
    items: itemResult.data.filter((item) => item.payroll_run_id === run.id),
  })) as PayrollRunWithItems[];

  return {
    data: payrollRuns,
    error: runResult.error ?? itemResult.error,
    label: "Payroll",
  };
}
