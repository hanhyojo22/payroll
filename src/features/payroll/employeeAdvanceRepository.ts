import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmployeeAdvance } from "../../types";

type AppErrorLike = { message?: string; details?: string | null; code?: string };

export async function fetchEmployeeAdvances(supabase: SupabaseClient) {
  const result = await supabase
    .from("employee_advances")
    .select("id,user_id,employee_id,employee_name,advance_id,advance_type,date_granted,start_deduction,purpose,amount,balance,deduction_per_payroll,status,notes,created_at,updated_at")
    .order("created_at", { ascending: false });

  return {
    data: (result.data ?? []) as EmployeeAdvance[],
    error: result.error as AppErrorLike | null,
  };
}
