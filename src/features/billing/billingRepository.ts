import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BillingRecord,
  BillingSettings,
  PaymentReminder,
  Subcontractor,
} from "../../types";

const BILLING_RECORDS_SELECT = "id,user_id,invoice_no,billing_month,billing_year,billing_period,install_tickets,repair_tickets,disputed_install,disputed_repair,total_tickets,disputed_tickets,billable_tickets,billing_rate,billing_amount,collections_pct,collections_amount,collectibles_amount,collection_id,collectibles_collection_id,due_date,notes,created_at,updated_at,subcon_items:billing_subcon_items(id,user_id,billing_record_id,subcontractor_id,subcon_name,install_tickets,repair_tickets,disputed_install,disputed_repair,installation_rate,repair_rate,billable_tickets,billing_amount,payable_pct,payable_amount,collection_amount,created_at)";
const SUBCONTRACTOR_SELECT = "id,user_id,name,installation_rate,repair_rate,payable_pct,status,created_at,updated_at";
const BILLING_SETTINGS_SELECT = "id,user_id,installation_rate,repair_rate,collections_pct,client_name,created_at,updated_at";
const PAYMENT_REMINDER_SUBCON_SELECT = "id,user_id,title,type,amount,due_date,status,notes,subcontractor_id,billing_subcon_item_id,billing_month,billing_year,billing_period,created_at,updated_at";

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
    .upsert({ user_id: userId, installation_rate: 0, repair_rate: 0, collections_pct: 70, client_name: "" }, { onConflict: "user_id" })
    .select(BILLING_SETTINGS_SELECT)
    .single();
  return { data: result.data as BillingSettings, error: result.error };
}

export async function saveBillingSettings(
  supabase: SupabaseClient,
  userId: string,
  payload: { installation_rate: number; repair_rate: number; collections_pct: number; client_name: string },
) {
  return supabase
    .from("billing_settings")
    .upsert({ user_id: userId, ...payload }, { onConflict: "user_id" });
}

export async function saveBillingRecord(
  supabase: SupabaseClient,
  record: Omit<BillingRecord, "created_at" | "updated_at" | "invoice_no">,
) {
  const { subcon_items: _, ...row } = record;
  return supabase
    .from("billing_records")
    .upsert(row, { onConflict: "user_id,billing_month,billing_year,billing_period" })
    .select(BILLING_RECORDS_SELECT)
    .single();
}

export async function deleteBillingRecord(
  supabase: SupabaseClient,
  id: string,
  collectionId: string | null,
  collectiblesCollectionId: string | null,
) {
  const collectionIds = [collectionId, collectiblesCollectionId].filter((value): value is string => Boolean(value));

  if (collectionIds.length > 0) {
    const paymentsResult = await supabase
      .from("collection_payments")
      .select("id")
      .in("collection_id", collectionIds)
      .limit(1);
    if (paymentsResult.error) return { error: paymentsResult.error };
    if ((paymentsResult.data ?? []).length > 0) {
      return {
        error: {
          message: "Can't delete this billing record — its linked collection already has payments recorded. Void those payments or archive the collection instead.",
        },
      };
    }
  }

  for (const collectionIdToDelete of collectionIds) {
    const deleteResult = await supabase.from("collection_reminders").delete().eq("id", collectionIdToDelete);
    if (deleteResult.error) return { error: deleteResult.error };
  }

  return supabase.from("billing_records").delete().eq("id", id);
}

export async function fetchSubcontractors(supabase: SupabaseClient) {
  const result = await supabase
    .from("subcontractors")
    .select(SUBCONTRACTOR_SELECT)
    .order("name");
  return { data: (result.data ?? []) as Subcontractor[], error: result.error };
}


export async function saveSubcontractor(
  supabase: SupabaseClient,
  userId: string,
  payload: { id?: string; name: string; installation_rate: number; repair_rate: number; payable_pct: number; status: string },
) {
  if (payload.id) {
    return supabase.from("subcontractors").update(payload).eq("id", payload.id).select(SUBCONTRACTOR_SELECT).single();
  }
  return supabase.from("subcontractors").insert({ ...payload, user_id: userId }).select(SUBCONTRACTOR_SELECT).single();
}

export async function saveBillingSubconItems(
  supabase: SupabaseClient,
  billingRecordId: string,
  items: Array<Omit<import("../../types").BillingSubconItem, "created_at">>,
) {
  const existing = await supabase
    .from("billing_subcon_items")
    .select("id")
    .eq("billing_record_id", billingRecordId);

  if (existing.error) return { data: [] as import("../../types").BillingSubconItem[], error: existing.error };

  const existingIds = new Set((existing.data ?? []).map((row) => row.id as string));
  const nextIds = new Set(items.map((item) => item.id));
  const idsToDelete = Array.from(existingIds).filter((id) => !nextIds.has(id));

  if (idsToDelete.length > 0) {
    const deleteResult = await supabase.from("billing_subcon_items").delete().in("id", idsToDelete);
    if (deleteResult.error) return { data: [] as import("../../types").BillingSubconItem[], error: deleteResult.error };
  }

  if (items.length === 0) return { data: [] as import("../../types").BillingSubconItem[], error: null };

  const result = await supabase
    .from("billing_subcon_items")
    .upsert(items.map(({ created_at: _ca, ...item }: typeof items[number] & { created_at?: string }) => ({ ...item, billing_record_id: billingRecordId })))
    .select("id,user_id,billing_record_id,subcontractor_id,subcon_name,install_tickets,repair_tickets,disputed_install,disputed_repair,installation_rate,repair_rate,billable_tickets,billing_amount,payable_pct,payable_amount,collection_amount,created_at");

  return {
    data: (result.data ?? []) as import("../../types").BillingSubconItem[],
    error: result.error,
  };
}

export async function saveSubconPaymentReminders(
  supabase: SupabaseClient,
  payments: Array<Omit<PaymentReminder, "created_at" | "updated_at">>,
) {
  if (payments.length === 0) return { error: null };
  const result = await supabase
    .from("payment_reminders")
    .upsert(payments, { onConflict: "billing_subcon_item_id" })
    .select(PAYMENT_REMINDER_SUBCON_SELECT);
  return { data: (result.data ?? []) as PaymentReminder[], error: result.error };
}

export async function markSubconPaymentReminderPaid(supabase: SupabaseClient, paymentId: string) {
  return supabase
    .from("payment_reminders")
    .update({ status: "paid" })
    .eq("id", paymentId);
}
