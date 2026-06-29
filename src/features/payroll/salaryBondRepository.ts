import type { SupabaseClient } from "@supabase/supabase-js";
import type { SalaryBond } from "../../types";

type AppErrorLike = { message?: string; details?: string | null; code?: string };

export async function fetchSalaryBonds(supabase: SupabaseClient) {
  const result = await supabase
    .from("salary_bonds")
    .select("id,user_id,employee_id,employee_name,bond_id,bond_type,date_granted,start_deduction,purpose,amount,balance,deduction_per_payroll,status,notes,created_at,updated_at")
    .order("created_at", { ascending: false });

  return {
    data: (result.data ?? []) as SalaryBond[],
    error: result.error as AppErrorLike | null,
  };
}
