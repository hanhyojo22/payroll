import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PayrollHistoryRow,
  PayrollRun,
  PayrollRunItem,
  PayrollSettings,
  PayrollRunWithItems,
} from "../../types";

type AppErrorLike = { message?: string; details?: string | null; code?: string };

const toNumber = (value: string | number | null | undefined) => Number(value ?? 0);
const payPeriodLabel = (payPeriod: PayrollRun["pay_period"]) =>
  payPeriod === "first_half" ? "First half" : "Second half";
const PAYROLL_SETTINGS_SELECT = "id,user_id,government_deduction_enabled,government_deduction_cutoff,created_at,updated_at";

export async function fetchPayrollRuns(supabase: SupabaseClient) {
  const result = await supabase
    .from("payroll_runs")
    .select("id,user_id,period_month,period_year,pay_period,generated_date,notes,created_at,updated_at")
    .order("period_year", { ascending: false })
    .order("period_month", { ascending: false })
    .order("pay_period", { ascending: false })
    .limit(100);

  return {
    data: ((result.data ?? []) as PayrollRun[]).map((run) => ({ ...run, items: [] })) as PayrollRunWithItems[],
    error: result.error as AppErrorLike | null,
  };
}

export async function fetchPayrollRunItems(supabase: SupabaseClient, payrollRunId: string) {
  const result = await supabase
    .from("payroll_run_items")
    .select("id,user_id,payroll_run_id,employee_id,employee_name,position_id,position_name,pay_mode,base_pay,ticket_pay,daily_rate,days_worked,total_working_days,installation_tickets,repair_tickets,installation_rate,repair_rate,nap_rehab_tickets,nap_rehab_rate,gross_pay,allowances,deductions,net_pay,status,paid_date,notes,created_at,updated_at,ticket_details:payroll_run_item_ticket_details(id,user_id,payroll_run_item_id,position_ticket_category_id,category_name,ticket_count,rate,amount,created_at)")
    .eq("payroll_run_id", payrollRunId)
    .order("employee_name");

  return {
    data: (result.data ?? []) as PayrollRunItem[],
    error: result.error as AppErrorLike | null,
  };
}

export async function fetchPayrollSettings(supabase: SupabaseClient) {
  const result = await supabase
    .from("payroll_settings")
    .select(PAYROLL_SETTINGS_SELECT)
    .limit(1)
    .maybeSingle();

  return {
    data: result.data as PayrollSettings | null,
    error: result.error as AppErrorLike | null,
  };
}

export async function ensurePayrollSettings(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ data: PayrollSettings; error: AppErrorLike | null }> {
  const existing = await fetchPayrollSettings(supabase);
  if (existing.data) return { data: existing.data, error: null };

  const result = await supabase
    .from("payroll_settings")
    .upsert({ user_id: userId, government_deduction_enabled: true, government_deduction_cutoff: "second_half" }, { onConflict: "user_id" })
    .select(PAYROLL_SETTINGS_SELECT)
    .single();

  return { data: result.data as PayrollSettings, error: result.error as AppErrorLike | null };
}

export async function savePayrollSettings(
  supabase: SupabaseClient,
  userId: string,
  payload: { government_deduction_enabled: boolean; government_deduction_cutoff: PayrollSettings["government_deduction_cutoff"] },
) {
  return supabase
    .from("payroll_settings")
    .upsert({ user_id: userId, ...payload }, { onConflict: "user_id" });
}

export async function fetchPayrollHistoryRows(
  supabase: SupabaseClient,
  page = 0,
  pageSize = 100,
) {
  const from = page * pageSize;
  const to = from + pageSize - 1;
  const result = await supabase
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
    .range(from, to);

  const rows = ((result.data ?? []) as any[]).map((item, index) => {
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
      periodMonth: run?.period_month ?? 0,
      periodYear: run?.period_year ?? 0,
      payPeriodCutoff: run?.pay_period ?? "first_half",
      employeeId: item.employee_id ?? null,
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
    error: result.error as AppErrorLike | null,
  };
}
