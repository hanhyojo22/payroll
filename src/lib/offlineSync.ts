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
      return supabase.rpc("save_payroll_bundle", {
        run_payload: payload.runPayload,
        item_payloads: payload.itemPayloads,
        detail_payloads: payload.detailPayloads ?? [],
        advance_updates: payload.employeeAdvanceUpdates,
        bond_payloads: payload.salaryBondTransactionPayloads ?? [],
      });
    }
    case "payroll_items_group": {
      const payload = mutation.payload as {
        itemPayloads: Record<string, unknown>[];
        detailPayloads: Record<string, unknown>[];
        employeeAdvanceUpdates?: Array<{ id: string; payload: Record<string, unknown> }>;
        salaryBondTransactionPayloads?: Record<string, unknown>[];
      };
      return supabase.rpc("save_payroll_items_bundle", {
        item_payloads: payload.itemPayloads,
        detail_payloads: payload.detailPayloads,
        advance_updates: payload.employeeAdvanceUpdates ?? [],
        bond_payloads: payload.salaryBondTransactionPayloads ?? [],
      });
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
      return supabase.rpc("save_billing_bundle", {
        billing_payload: payload.billingPayload,
        collection_payloads: [
          payload.collectionPayload,
          ...(payload.collectiblesCollectionPayload ? [payload.collectiblesCollectionPayload] : []),
        ],
        subcon_item_payloads: payload.subconItemPayloads ?? [],
        reminder_payloads: payload.subcontractorPaymentPayloads ?? [],
        advance_updates: payload.subcontractorAdvanceUpdates ?? [],
      });
    }
    case "expense_payment_group": {
      const payload = mutation.payload as {
        paymentPayload: Record<string, unknown>;
        expenseUpdate: { id: string; payload: Record<string, unknown> };
      };
      return supabase.rpc("record_expense_payment_bundle", {
        payment_payload: payload.paymentPayload,
        expense_record_id: payload.expenseUpdate.id,
        expense_patch: payload.expenseUpdate.payload,
      });
    }
    case "payment_reminder_payment_group": {
      const payload = mutation.payload as {
        paymentPayload: Record<string, unknown>;
        reminderUpdate: { id: string; payload: Record<string, unknown> } | null;
      };
      return supabase.rpc("record_reminder_payment_bundle", {
        payment_payload: payload.paymentPayload,
        reminder_record_id: payload.reminderUpdate?.id ?? payload.paymentPayload.payment_reminder_id,
        reminder_patch: payload.reminderUpdate?.payload ?? {},
      });
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
