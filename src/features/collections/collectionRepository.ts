import type { SupabaseClient } from "@supabase/supabase-js";
import { withCollectionTotals } from "../../domain/collections";
import type {
  CollectionFormValues,
  CollectionPayment,
  CollectionPaymentFormValues,
  CollectionReminder,
} from "../../types";

export const COLLECTION_SELECT = "id,user_id,collection_no,title,client_name,external_reference,issue_date,amount,due_date,status,notes,archived_at,created_at,updated_at,payments:collection_payments(id,user_id,collection_id,amount,payment_date,payment_method,reference_number,notes,is_void,void_reason,voided_at,created_at,updated_at)";

export function normalizeReceivable(record: CollectionReminder): CollectionReminder {
  const legacyPayments = !record.payments && record.status === "collected" ? [{
    id: `legacy-${record.id}`,
    user_id: record.user_id,
    collection_id: record.id,
    amount: record.amount,
    payment_date: record.updated_at?.slice(0, 10) || record.due_date,
    payment_method: "other" as const,
    reference_number: "LEGACY",
    notes: "Cached legacy collected record.",
    is_void: false,
    void_reason: "",
    voided_at: null,
    created_at: record.updated_at,
    updated_at: record.updated_at,
  }] : [];
  return withCollectionTotals({
    ...record,
    collection_no: record.collection_no ?? null,
    external_reference: record.external_reference ?? "",
    issue_date: record.issue_date ?? record.created_at?.slice(0, 10) ?? record.due_date,
    archived_at: record.archived_at ?? null,
    payments: record.payments ?? legacyPayments,
  });
}

export async function fetchReceivables(supabase: SupabaseClient) {
  const result = await supabase
    .from("collection_reminders")
    .select(COLLECTION_SELECT)
    .order("due_date")
    .order("created_at", { ascending: false });
  return {
    data: ((result.data ?? []) as unknown as CollectionReminder[]).map(normalizeReceivable),
    error: result.error,
  };
}

export function receivablePayload(values: CollectionFormValues, userId: string) {
  return {
    user_id: userId,
    title: values.title.trim(),
    client_name: values.client_name.trim(),
    external_reference: values.external_reference.trim(),
    issue_date: values.issue_date,
    amount: Number(values.amount),
    due_date: values.due_date,
    status: "pending" as const,
    notes: values.notes.trim(),
  };
}

export async function saveReceivable(
  supabase: SupabaseClient,
  values: CollectionFormValues,
  userId: string,
  id?: string,
) {
  const payload = receivablePayload(values, userId);
  const request = id
    ? supabase.from("collection_reminders").update(payload).eq("id", id)
    : supabase.from("collection_reminders").insert({ ...payload, id: crypto.randomUUID() });
  return request;
}

export async function archiveReceivable(supabase: SupabaseClient, id: string) {
  return supabase.from("collection_reminders").update({ archived_at: new Date().toISOString() }).eq("id", id);
}

export async function restoreReceivable(supabase: SupabaseClient, id: string) {
  return supabase.from("collection_reminders").update({ archived_at: null }).eq("id", id);
}

export async function recordReceivablePayment(
  supabase: SupabaseClient,
  collectionId: string,
  paymentId: string,
  values: CollectionPaymentFormValues,
) {
  return supabase.rpc("record_collection_payment", {
    collection_record_id: collectionId,
    payment_record_id: paymentId,
    payment_amount: Number(values.amount),
    paid_on: values.payment_date,
    method: values.payment_method,
    payment_reference: values.reference_number.trim(),
    payment_notes: values.notes.trim(),
  }) as unknown as Promise<{ data: CollectionPayment | null; error: { message?: string; details?: string | null } | null }>;
}

export async function voidReceivablePayment(supabase: SupabaseClient, paymentId: string, reason: string) {
  return supabase.rpc("void_collection_payment", {
    payment_record_id: paymentId,
    reason: reason.trim(),
  }) as unknown as Promise<{ data: CollectionPayment | null; error: { message?: string; details?: string | null } | null }>;
}
