import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillingRecord, BillingSettings } from "../../types";

const BILLING_RECORDS_SELECT = "id,user_id,billing_month,billing_year,total_tickets,disputed_tickets,billable_tickets,billing_rate,billing_amount,collections_pct,collections_amount,collectibles_amount,collection_id,notes,created_at,updated_at";
const BILLING_SETTINGS_SELECT = "id,user_id,billing_rate,collections_pct,client_name,created_at,updated_at";

export async function fetchBillingRecords(supabase: SupabaseClient) {
  const result = await supabase
    .from("billing_records")
    .select(BILLING_RECORDS_SELECT)
    .order("billing_year", { ascending: false })
    .order("billing_month", { ascending: false });
  return {
    data: (result.data ?? []) as BillingRecord[],
    error: result.error,
  };
}

export async function fetchBillingSettings(supabase: SupabaseClient) {
  const result = await supabase
    .from("billing_settings")
    .select(BILLING_SETTINGS_SELECT)
    .limit(1)
    .maybeSingle();
  return {
    data: result.data as BillingSettings | null,
    error: result.error,
  };
}

export async function ensureBillingSettings(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ data: BillingSettings; error: unknown }> {
  const existing = await fetchBillingSettings(supabase);
  if (existing.data) return { data: existing.data, error: null };
  const result = await supabase
    .from("billing_settings")
    .upsert({ user_id: userId, billing_rate: 0, collections_pct: 70, client_name: "" }, { onConflict: "user_id" })
    .select(BILLING_SETTINGS_SELECT)
    .single();
  return { data: result.data as BillingSettings, error: result.error };
}

export async function saveBillingSettings(
  supabase: SupabaseClient,
  userId: string,
  payload: { billing_rate: number; collections_pct: number; client_name: string },
) {
  return supabase
    .from("billing_settings")
    .upsert({ user_id: userId, ...payload }, { onConflict: "user_id" });
}

export async function saveBillingRecord(
  supabase: SupabaseClient,
  record: Omit<BillingRecord, "created_at" | "updated_at">,
) {
  return supabase
    .from("billing_records")
    .upsert(record, { onConflict: "user_id,billing_month,billing_year" })
    .select(BILLING_RECORDS_SELECT)
    .single();
}

export async function deleteBillingRecord(
  supabase: SupabaseClient,
  id: string,
  collectionId: string | null,
) {
  if (collectionId) {
    await supabase.from("collection_reminders").delete().eq("id", collectionId);
  }
  return supabase.from("billing_records").delete().eq("id", id);
}
