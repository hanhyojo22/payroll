import type { SupabaseClient } from "@supabase/supabase-js";
import type { SubconDailyTicket } from "../../types";

const SELECT =
  "id,user_id,entry_date,subcontractor_id,subcon_name,install_tickets,repair_tickets,nap_rehab_tickets,disputed_install,disputed_repair,disputed_nap_rehab,installation_rate,repair_rate,nap_rehab_rate,created_at,updated_at";

export async function fetchSubconDailyTickets(supabase: SupabaseClient) {
  const result = await supabase
    .from("subcon_daily_tickets")
    .select(SELECT)
    .order("entry_date", { ascending: false });

  return {
    data: (result.data ?? []) as SubconDailyTicket[],
    error: result.error,
  };
}

export async function saveSubconDailyTicket(
  supabase: SupabaseClient,
  payload: Omit<SubconDailyTicket, "created_at" | "updated_at">,
) {
  return supabase
    .from("subcon_daily_tickets")
    .upsert(payload, { onConflict: "user_id,entry_date,subcontractor_id" })
    .select(SELECT)
    .single();
}
