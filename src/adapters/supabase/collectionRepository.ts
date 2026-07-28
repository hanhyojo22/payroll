import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CollectionPaymentTotals,
  CollectionRepository,
  RecordCollectionPaymentInput,
  SaveCollectionInput,
} from "../../core/ports/collections";
import { err, ok, type Result } from "../../core/ports/result";
import type { AppError } from "../../shared/types";
import type { CollectionReminder } from "../../types";
import { normalizeReceivable, receivablePayload } from "../../features/collections/mapping";

const COLLECTION_SELECT = "id,user_id,collection_no,title,client_name,external_reference,issue_date,amount,due_date,status,notes,archived_at,created_at,updated_at,payments:collection_payments(id,user_id,collection_id,amount,payment_date,payment_method,reference_number,notes,is_void,void_reason,voided_at,created_at,updated_at)";

/** Supabase implementation of CollectionRepository. The only collections code that knows Supabase exists. */
export function supabaseCollectionRepository(supabase: SupabaseClient): CollectionRepository {
  const settle = (raw: { error: unknown }): Result<void> =>
    raw.error ? err<void>(raw.error as AppError) : ok(undefined as void);

  return {
    async list() {
      const raw = await supabase
        .from("collection_reminders")
        .select(COLLECTION_SELECT)
        .order("due_date")
        .order("created_at", { ascending: false });

      return raw.error
        ? err<CollectionReminder[]>(raw.error as AppError)
        : ok(((raw.data ?? []) as unknown as CollectionReminder[]).map(normalizeReceivable));
    },

    async listOpen() {
      const raw = await supabase
        .from("collection_reminders")
        .select(COLLECTION_SELECT)
        .is("archived_at", null)
        .order("due_date")
        .order("created_at", { ascending: false });

      return raw.error
        ? err<CollectionReminder[]>(raw.error as AppError)
        : ok(((raw.data ?? []) as unknown as CollectionReminder[]).map(normalizeReceivable));
    },

    async collectedTotals(monthStart: string) {
      const raw = await supabase.rpc("dashboard_collection_totals", { month_start: monthStart });
      if (raw.error) return err<CollectionPaymentTotals>(raw.error as AppError);
      const row = (Array.isArray(raw.data) ? raw.data[0] : raw.data) as
        { lifetime_total: number; month_total: number } | null;
      return ok({
        lifetimeTotal: Number(row?.lifetime_total ?? 0),
        monthTotal: Number(row?.month_total ?? 0),
      });
    },

    async save({ id, userId, values }: SaveCollectionInput) {
      const payload = receivablePayload(values, userId);
      return settle(id
        ? await supabase.from("collection_reminders").update(payload).eq("id", id)
        : await supabase.from("collection_reminders").insert({ ...payload, id: crypto.randomUUID() }));
    },

    async archive(id) {
      return settle(await supabase
        .from("collection_reminders")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id));
    },

    async restore(id) {
      return settle(await supabase
        .from("collection_reminders")
        .update({ archived_at: null })
        .eq("id", id));
    },

    async recordPayment({ collectionId, paymentId, values }: RecordCollectionPaymentInput) {
      return settle(await supabase.rpc("record_collection_payment", {
        collection_record_id: collectionId,
        payment_record_id: paymentId,
        payment_amount: Number(values.amount),
        paid_on: values.payment_date,
        method: values.payment_method,
        payment_reference: values.reference_number.trim(),
        payment_notes: values.notes.trim(),
      }));
    },

    async voidPayment(paymentId, reason) {
      return settle(await supabase.rpc("void_collection_payment", {
        payment_record_id: paymentId,
        reason: reason.trim(),
      }));
    },
  };
}
