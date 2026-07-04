import type { SupabaseClient } from "@supabase/supabase-js";
import type { SubcontractorAdvance } from "../../types";

type AppErrorLike = { message?: string; details?: string | null; code?: string };

export const SUBCONTRACTOR_ADVANCE_SELECT =
  "id,user_id,subcontractor_id,subcon_name,advance_id,date_granted,amount,balance,deduction_mode,deduction_per_billing,status,notes,created_at,updated_at";

export async function fetchSubcontractorAdvances(supabase: SupabaseClient) {
  const result = await supabase
    .from("subcontractor_advances")
    .select(SUBCONTRACTOR_ADVANCE_SELECT)
    .order("created_at", { ascending: false });

  return {
    data: (result.data ?? []) as SubcontractorAdvance[],
    error: result.error as AppErrorLike | null,
  };
}
