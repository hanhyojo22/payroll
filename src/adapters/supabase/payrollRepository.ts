import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PayrollBundle,
  PayrollItemsBundle,
  PayrollRepository,
  PayrollSettingsPayload,
} from "../../core/ports/payroll";
import { err, ok, type Result } from "../../core/ports/result";
import type { AppError } from "../../shared/types";
import type {
  PayrollHistoryRow,
  PayrollRun,
  PayrollRunItem,
  PayrollRunWithItems,
  PayrollSettings,
} from "../../types";

const PAYROLL_SETTINGS_SELECT = "id,user_id,government_deduction_enabled,government_deduction_cutoff,created_at,updated_at";
const PAYROLL_ITEM_SELECT = "id,user_id,payroll_run_id,employee_id,employee_name,position_id,position_name,pay_mode,base_pay,ticket_pay,daily_rate,days_worked,total_working_days,installation_tickets,repair_tickets,installation_rate,repair_rate,nap_rehab_tickets,nap_rehab_rate,gross_pay,allowances,deductions,net_pay,status,paid_date,notes,created_at,updated_at,ticket_details:payroll_run_item_ticket_details(id,user_id,payroll_run_item_id,position_ticket_category_id,category_name,ticket_count,rate,amount,created_at)";

const toNumber = (value: string | number | null | undefined) => Number(value ?? 0);
const payPeriodLabel = (payPeriod: PayrollRun["pay_period"]) =>
  payPeriod === "first_half" ? "First half" : "Second half";

const settle = (raw: { error: unknown }): Result<void> =>
  raw.error ? err<void>(raw.error as AppError) : ok(undefined as void);

export function supabasePayrollRepository(supabase: SupabaseClient): PayrollRepository {
  return {
    async listRuns() {
      const raw = await supabase
        .from("payroll_runs")
        .select("id,user_id,period_month,period_year,pay_period,generated_date,notes,created_at,updated_at")
        .order("period_year", { ascending: false })
        .order("period_month", { ascending: false })
        .order("pay_period", { ascending: false })
        .limit(100);

      return raw.error
        ? err<PayrollRunWithItems[]>(raw.error as AppError)
        : ok(((raw.data ?? []) as PayrollRun[]).map((run) => ({ ...run, items: [] })) as PayrollRunWithItems[]);
    },

    async listRunItems(runId) {
      const raw = await supabase
        .from("payroll_run_items")
        .select(PAYROLL_ITEM_SELECT)
        .eq("payroll_run_id", runId)
        .order("employee_name");

      return raw.error
        ? err<PayrollRunItem[]>(raw.error as AppError)
        : ok((raw.data ?? []) as unknown as PayrollRunItem[]);
    },

    async listHistory(page, pageSize) {
      const from = page * pageSize;
      const raw = await supabase
        .from("payroll_run_items")
        .select(`
          id, employee_id, employee_name, position_id, position_name, pay_mode,
          base_pay, ticket_pay, gross_pay, deductions, net_pay, status, paid_date,
          payroll_runs!inner(period_month,period_year,pay_period,generated_date),
          employees(department)
        `)
        .eq("status", "paid")
        .order("paid_date", { ascending: false, nullsFirst: false })
        .range(from, from + pageSize - 1);

      if (raw.error) return err<PayrollHistoryRow[]>(raw.error as AppError);

      const rows = ((raw.data ?? []) as any[]).map((item, index) => {
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

      return ok(rows);
    },

    async getSettings() {
      const raw = await supabase.from("payroll_settings").select(PAYROLL_SETTINGS_SELECT).limit(1).maybeSingle();
      return raw.error
        ? err<PayrollSettings | null>(raw.error as AppError)
        : ok(raw.data as PayrollSettings | null);
    },

    async ensureSettings(userId) {
      const existing = await this.getSettings();
      if (existing.error) return err<PayrollSettings>(existing.error);
      if (existing.data) return ok(existing.data);

      const created = await supabase
        .from("payroll_settings")
        .upsert(
          { user_id: userId, government_deduction_enabled: true, government_deduction_cutoff: "second_half" },
          { onConflict: "user_id" },
        )
        .select(PAYROLL_SETTINGS_SELECT)
        .single();

      return created.error
        ? err<PayrollSettings>(created.error as AppError)
        : ok(created.data as PayrollSettings);
    },

    async saveSettings(userId: string, payload: PayrollSettingsPayload) {
      return settle(await supabase
        .from("payroll_settings")
        .upsert({ user_id: userId, ...payload }, { onConflict: "user_id" }));
    },

    async updateItem(id, patch) {
      return settle(await supabase.from("payroll_run_items").update(patch).eq("id", id));
    },

    async saveBundle(bundle: PayrollBundle) {
      return settle(await supabase.rpc("save_payroll_bundle", {
        run_payload: bundle.runPayload,
        item_payloads: bundle.itemPayloads,
        detail_payloads: bundle.detailPayloads,
        advance_updates: bundle.employeeAdvanceUpdates,
        bond_payloads: bundle.salaryBondTransactionPayloads,
      }));
    },

    async saveItemsBundle(bundle: PayrollItemsBundle) {
      return settle(await supabase.rpc("save_payroll_items_bundle", {
        item_payloads: bundle.itemPayloads,
        detail_payloads: bundle.detailPayloads,
        advance_updates: bundle.employeeAdvanceUpdates,
        bond_payloads: bundle.salaryBondTransactionPayloads,
      }));
    },

    async findRunId(periodMonth, periodYear, payPeriod) {
      const raw = await supabase
        .from("payroll_runs")
        .select("id")
        .eq("period_month", periodMonth)
        .eq("period_year", periodYear)
        .eq("pay_period", payPeriod)
        .maybeSingle();

      return raw.error
        ? err<string | null>(raw.error as AppError)
        : ok((raw.data as { id: string } | null)?.id ?? null);
    },

    async insertSalaryBondTransactions(payloads) {
      return settle(await supabase.from("employee_salary_bond_transactions").insert(payloads));
    },
  };
}
