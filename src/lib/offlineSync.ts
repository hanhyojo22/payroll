import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deleteMutation,
  getPendingMutations,
  markMutationFailed,
  type PendingMutation,
} from "./offlineDb";

type SyncResult = {
  failed: PendingMutation[];
  synced: PendingMutation[];
};

export function isOfflineLikeError(error: unknown) {
  const message = `${(error as { message?: string })?.message ?? ""} ${(error as { details?: string })?.details ?? ""}`.toLowerCase();
  return (
    !navigator.onLine ||
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("request timed out") ||
    message.includes("timeout")
  );
}

async function applyMutation(supabase: SupabaseClient, mutation: PendingMutation) {
  switch (mutation.operation) {
    case "insert":
      return supabase.from(mutation.table).insert(mutation.payload as any);
    case "update":
      return supabase
        .from(mutation.table)
        .update(mutation.payload as any)
        .match(mutation.match ?? { id: mutation.recordId });
    case "delete":
      return supabase
        .from(mutation.table)
        .delete()
        .match(mutation.match ?? { id: mutation.recordId });
    case "upsert":
      return supabase
        .from(mutation.table)
        .upsert(mutation.payload as any, mutation.options);
    case "payroll_group": {
      const payload = mutation.payload as {
        runPayload: Record<string, unknown>;
        itemPayloads: Record<string, unknown>[];
        detailPayloads?: Record<string, unknown>[];
        employeeAdvanceUpdates: Array<{ id: string; payload: Record<string, unknown> }>;
        salaryBondTransactionPayloads?: Record<string, unknown>[];
      };
      const runResult = await supabase.from("payroll_runs").insert(payload.runPayload);
      if (runResult.error) return runResult;

      const itemResult = await supabase.from("payroll_run_items").insert(payload.itemPayloads);
      if (itemResult.error) return itemResult;

      if ((payload.detailPayloads?.length ?? 0) > 0) {
        const detailResult = await supabase.from("payroll_run_item_ticket_details").insert(payload.detailPayloads!);
        if (detailResult.error) return detailResult;
      }

      for (const update of payload.employeeAdvanceUpdates) {
        const advanceResult = await supabase.from("employee_advances").update(update.payload).eq("id", update.id);
        if (advanceResult.error) return advanceResult;
      }

      if ((payload.salaryBondTransactionPayloads?.length ?? 0) > 0) {
        const bondResult = await supabase.from("employee_salary_bond_transactions").insert(payload.salaryBondTransactionPayloads!);
        if (bondResult.error) return bondResult;
      }

      return { error: null };
    }
    case "payroll_items_group": {
      const payload = mutation.payload as {
        itemPayloads: Record<string, unknown>[];
        detailPayloads: Record<string, unknown>[];
        employeeAdvanceUpdates?: Array<{ id: string; payload: Record<string, unknown> }>;
        salaryBondTransactionPayloads?: Record<string, unknown>[];
      };
      const itemResult = await supabase.from("payroll_run_items").insert(payload.itemPayloads);
      if (itemResult.error) return itemResult;
      if (payload.detailPayloads.length > 0) {
        const detailResult = await supabase.from("payroll_run_item_ticket_details").insert(payload.detailPayloads);
        if (detailResult.error) return detailResult;
      }
      for (const update of payload.employeeAdvanceUpdates ?? []) {
        const advanceResult = await supabase.from("employee_advances").update(update.payload).eq("id", update.id);
        if (advanceResult.error) return advanceResult;
      }
      if ((payload.salaryBondTransactionPayloads?.length ?? 0) > 0) {
        const bondResult = await supabase.from("employee_salary_bond_transactions").insert(payload.salaryBondTransactionPayloads!);
        if (bondResult.error) return bondResult;
      }
      return { error: null };
    }
    case "billing_group": {
      const payload = mutation.payload as {
        billingPayload: Record<string, unknown>;
        collectionPayload: Record<string, unknown>;
        collectiblesCollectionPayload?: Record<string, unknown>;
        subconItemPayloads?: Record<string, unknown>[];
        subcontractorPaymentPayloads?: Record<string, unknown>[];
        subcontractorAdvanceUpdates?: Array<{ id: string; payload: Record<string, unknown> }>;
      };
      const collectionResult = await supabase.from("collection_reminders").insert(payload.collectionPayload);
      if (collectionResult.error) return collectionResult;
      if (payload.collectiblesCollectionPayload) {
        const c2Result = await supabase.from("collection_reminders").insert(payload.collectiblesCollectionPayload);
        if (c2Result.error) return c2Result;
      }
      const billingResult = await supabase.from("billing_records").insert(payload.billingPayload);
      if (billingResult.error) return billingResult;
      if ((payload.subconItemPayloads?.length ?? 0) > 0) {
        const subconResult = await supabase.from("billing_subcon_items").insert(payload.subconItemPayloads!);
        if (subconResult.error) return subconResult;
      }
      if ((payload.subcontractorPaymentPayloads?.length ?? 0) > 0) {
        const paymentResult = await supabase
          .from("payment_reminders")
          .upsert(payload.subcontractorPaymentPayloads!, { onConflict: "billing_subcon_item_id,payout_leg" });
        if (paymentResult.error) return paymentResult;
      }
      for (const update of payload.subcontractorAdvanceUpdates ?? []) {
        const advanceResult = await supabase.from("subcontractor_advances").update(update.payload).eq("id", update.id);
        if (advanceResult.error) return advanceResult;
      }
      return { error: null };
    }
    case "expense_payment_group": {
      const payload = mutation.payload as {
        paymentPayload: Record<string, unknown>;
        expenseUpdate: { id: string; payload: Record<string, unknown> };
      };
      const paymentResult = await supabase.from("expense_installment_payments").insert(payload.paymentPayload);
      if (paymentResult.error) return paymentResult;
      const expenseResult = await supabase.from("expenses").update(payload.expenseUpdate.payload).eq("id", payload.expenseUpdate.id);
      if (expenseResult.error) return expenseResult;
      return { error: null };
    }
    case "payment_reminder_payment_group": {
      const payload = mutation.payload as {
        paymentPayload: Record<string, unknown>;
        reminderUpdate: { id: string; payload: Record<string, unknown> } | null;
      };
      const paymentResult = await supabase.from("payment_reminder_payments").insert(payload.paymentPayload);
      if (paymentResult.error) return paymentResult;
      if (payload.reminderUpdate) {
        const reminderResult = await supabase.from("payment_reminders").update(payload.reminderUpdate.payload).eq("id", payload.reminderUpdate.id);
        if (reminderResult.error) return reminderResult;
      }
      return { error: null };
    }
    case "collection_payment":
      return supabase.rpc("record_collection_payment", mutation.payload as {
        collection_record_id: string;
        payment_record_id: string;
        payment_amount: number;
        paid_on: string;
        method: string;
        payment_reference: string;
        payment_notes: string;
      });
    case "collection_payment_void":
      return supabase.rpc("void_collection_payment", mutation.payload as {
        payment_record_id: string;
        reason: string;
      });
  }
}

export async function flushPendingMutations(
  supabase: SupabaseClient,
  userId: string,
): Promise<SyncResult> {
  const result: SyncResult = { failed: [], synced: [] };
  if (!navigator.onLine) return result;

  const pending = await getPendingMutations(userId);
  for (const mutation of pending) {
    try {
      const response = await applyMutation(supabase, mutation);
      if (response.error) {
        if (isOfflineLikeError(response.error)) {
          return result;
        }
        await markMutationFailed(mutation.id, mutation.attempts + 1, response.error.message);
        result.failed.push(mutation);
        continue;
      }

      await deleteMutation(mutation.id);
      result.synced.push(mutation);
    } catch (error) {
      if (isOfflineLikeError(error)) {
        return result;
      }
      await markMutationFailed(mutation.id, mutation.attempts + 1, (error as Error).message);
      result.failed.push(mutation);
    }
  }

  return result;
}
