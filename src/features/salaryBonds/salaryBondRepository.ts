import type { SupabaseClient } from "@supabase/supabase-js";
import { withSalaryBondTotals } from "../../domain/salaryBonds";
import type {
  Employee,
  SalaryBond,
  SalaryBondFormValues,
  SalaryBondTransaction,
  SalaryBondWithdrawalFormValues,
} from "../../types";

type AppErrorLike = { message?: string; details?: string | null; code?: string };

export const SALARY_BOND_SELECT =
  "id,user_id,employee_id,employee_name,bond_reference,target_amount,deduction_per_payroll,start_deduction,status,notes,created_at,updated_at,transactions:employee_salary_bond_transactions(id,user_id,salary_bond_id,employee_id,type,amount,transaction_date,payroll_run_id,payroll_run_item_id,note,is_void,void_reason,voided_at,created_at,updated_at)";

export function normalizeSalaryBond(record: SalaryBond): SalaryBond {
  return withSalaryBondTotals({
    ...record,
    transactions: record.transactions ?? [],
  });
}

export async function fetchSalaryBonds(supabase: SupabaseClient) {
  const result = await supabase
    .from("employee_salary_bonds")
    .select(SALARY_BOND_SELECT)
    .order("created_at", { ascending: false });
  return {
    data: ((result.data ?? []) as unknown as SalaryBond[]).map(normalizeSalaryBond),
    error: result.error as AppErrorLike | null,
  };
}

export function salaryBondPayload(values: SalaryBondFormValues, userId: string, employee: Employee) {
  return {
    user_id: userId,
    employee_id: employee.id,
    employee_name: employee.full_name,
    target_amount: Number(values.target_amount),
    deduction_per_payroll: Number(values.deduction_per_payroll),
    start_deduction: values.start_deduction,
    notes: values.notes.trim(),
  };
}

export async function saveSalaryBond(
  supabase: SupabaseClient,
  values: SalaryBondFormValues,
  userId: string,
  employee: Employee,
  id?: string,
) {
  const payload = salaryBondPayload(values, userId, employee);
  if (id) {
    return supabase.from("employee_salary_bonds").update(payload).eq("id", id);
  }
  const bondReference = `SB-${Date.now().toString(36).toUpperCase()}`;
  return supabase.from("employee_salary_bonds").insert({ ...payload, bond_reference: bondReference });
}

export async function archiveSalaryBond(supabase: SupabaseClient, id: string) {
  return supabase.from("employee_salary_bonds").update({ status: "archived" }).eq("id", id);
}

export async function reactivateSalaryBond(supabase: SupabaseClient, id: string) {
  return supabase.from("employee_salary_bonds").update({ status: "active" }).eq("id", id);
}

export async function recordSalaryBondWithdrawal(
  supabase: SupabaseClient,
  bondId: string,
  transactionId: string,
  values: SalaryBondWithdrawalFormValues,
) {
  return supabase.rpc("record_salary_bond_withdrawal", {
    bond_id: bondId,
    transaction_id: transactionId,
    withdrawal_amount: Number(values.amount),
    withdrawn_on: values.transaction_date,
    withdrawal_note: values.note.trim(),
  }) as unknown as Promise<{ data: SalaryBondTransaction | null; error: AppErrorLike | null }>;
}

export async function voidSalaryBondTransaction(supabase: SupabaseClient, transactionId: string, reason: string) {
  return supabase.rpc("void_salary_bond_transaction", {
    transaction_id: transactionId,
    reason: reason.trim(),
  }) as unknown as Promise<{ data: SalaryBondTransaction | null; error: AppErrorLike | null }>;
}
