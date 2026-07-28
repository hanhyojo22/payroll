import { withCollectionTotals } from "../../domain/collections";
import type { CollectionFormValues, CollectionReminder } from "../../types";

/**
 * Pure shape mapping between stored rows and the domain shape. No Supabase types, so both
 * the Supabase adapter and the offline cache hydration can share it.
 */

/**
 * Fills in columns added after the table shipped, and reconstructs a payment for rows marked
 * collected before `collection_payments` existed -- without it those legacy rows would show a
 * full outstanding balance despite being settled.
 */
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

/** The persisted column shape for a receivable, shared by the DB write and the offline queue. */
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
