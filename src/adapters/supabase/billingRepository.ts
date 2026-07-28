import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BillingRecordRepository,
  BillingSettingsPayload,
  BillingSettingsRepository,
  PaymentReminderPaymentPayload,
  PaymentReminderRepository,
  SubconDailyTicketPayload,
  SubconDailyTicketRepository,
  SubcontractorAdvancePayload,
  SubcontractorAdvanceRepository,
  SubcontractorPayload,
  SubcontractorRepository,
} from "../../core/ports/billing";
import { err, ok, type Result } from "../../core/ports/result";
import type { AppError } from "../../shared/types";
import type { BillingSettings, PaymentReminderPayment, SubconDailyTicket, Subcontractor, SubcontractorAdvance } from "../../types";

const BILLING_SETTINGS_SELECT = "id,user_id,installation_rate,repair_rate,nap_rehab_rate,collections_pct,client_name,created_at,updated_at";
const SUBCONTRACTOR_SELECT = "id,user_id,name,installation_rate,repair_rate,nap_rehab_rate,payable_pct,status,email,contact_number,address,created_at,updated_at";
const SUBCON_DAILY_TICKET_SELECT = "id,user_id,entry_date,subcontractor_id,subcon_name,install_tickets,repair_tickets,nap_rehab_tickets,disputed_install,disputed_repair,disputed_nap_rehab,installation_rate,repair_rate,nap_rehab_rate,created_at,updated_at";
const SUBCONTRACTOR_ADVANCE_SELECT = "id,user_id,subcontractor_id,subcon_name,advance_id,date_granted,amount,balance,deduction_mode,deduction_per_billing,status,notes,created_at,updated_at";
const PAYMENT_REMINDER_PAYMENT_SELECT = "id,user_id,payment_reminder_id,amount,payment_date,payment_method,reference_number,notes,created_at";

const settle = (raw: { error: unknown }): Result<void> =>
  raw.error ? err<void>(raw.error as AppError) : ok(undefined as void);

async function fetchBillingSettings(supabase: SupabaseClient) {
  return supabase.from("billing_settings").select(BILLING_SETTINGS_SELECT).limit(1).maybeSingle();
}

export function supabaseBillingSettingsRepository(supabase: SupabaseClient): BillingSettingsRepository {
  return {
    async ensure(userId) {
      const existing = await fetchBillingSettings(supabase);
      if (existing.error) return err<BillingSettings>(existing.error as AppError);
      if (existing.data) return ok(existing.data as unknown as BillingSettings);

      const created = await supabase
        .from("billing_settings")
        .upsert({ user_id: userId, installation_rate: 0, repair_rate: 0, nap_rehab_rate: 0, collections_pct: 70, client_name: "" }, { onConflict: "user_id" })
        .select(BILLING_SETTINGS_SELECT)
        .single();
      return created.error
        ? err<BillingSettings>(created.error as AppError)
        : ok(created.data as unknown as BillingSettings);
    },

    async save(userId: string, payload: BillingSettingsPayload) {
      return settle(await supabase.from("billing_settings").upsert({ user_id: userId, ...payload }, { onConflict: "user_id" }));
    },
  };
}

export function supabaseBillingRecordRepository(supabase: SupabaseClient): BillingRecordRepository {
  return {
    async delete(id, collectionId, collectiblesCollectionId) {
      const collectionIds = [collectionId, collectiblesCollectionId].filter((value): value is string => Boolean(value));

      if (collectionIds.length > 0) {
        const paymentsResult = await supabase
          .from("collection_payments")
          .select("id")
          .in("collection_id", collectionIds)
          .limit(1);
        if (paymentsResult.error) return err<void>(paymentsResult.error as AppError);
        if ((paymentsResult.data ?? []).length > 0) {
          return err<void>({
            message: "Can't delete this billing record — its linked collection already has payments recorded. Void those payments or archive the collection instead.",
          });
        }
      }

      for (const collectionIdToDelete of collectionIds) {
        const deleteResult = await supabase.from("collection_reminders").delete().eq("id", collectionIdToDelete);
        if (deleteResult.error) return err<void>(deleteResult.error as AppError);
      }

      return settle(await supabase.from("billing_records").delete().eq("id", id));
    },
  };
}

export function supabaseSubcontractorRepository(supabase: SupabaseClient): SubcontractorRepository {
  return {
    async list() {
      const result = await supabase.from("subcontractors").select(SUBCONTRACTOR_SELECT).order("name");
      return result.error
        ? err<Subcontractor[]>(result.error as AppError)
        : ok((result.data ?? []) as unknown as Subcontractor[]);
    },

    async save(userId: string, payload: SubcontractorPayload) {
      return settle(payload.id
        ? await supabase.from("subcontractors").update(payload).eq("id", payload.id)
        : await supabase.from("subcontractors").insert({ ...payload, user_id: userId }));
    },
  };
}

export function supabaseSubconDailyTicketRepository(supabase: SupabaseClient): SubconDailyTicketRepository {
  return {
    async list() {
      const result = await supabase
        .from("subcon_daily_tickets")
        .select(SUBCON_DAILY_TICKET_SELECT)
        .order("entry_date", { ascending: false });
      return result.error
        ? err<SubconDailyTicket[]>(result.error as AppError)
        : ok((result.data ?? []) as unknown as SubconDailyTicket[]);
    },

    async save(payload: SubconDailyTicketPayload) {
      return settle(await supabase
        .from("subcon_daily_tickets")
        .upsert(payload, { onConflict: "user_id,entry_date,subcontractor_id" }));
    },
  };
}

export function supabaseSubcontractorAdvanceRepository(supabase: SupabaseClient): SubcontractorAdvanceRepository {
  return {
    async list() {
      const result = await supabase
        .from("subcontractor_advances")
        .select(SUBCONTRACTOR_ADVANCE_SELECT)
        .order("created_at", { ascending: false });
      return result.error
        ? err<SubcontractorAdvance[]>(result.error as AppError)
        : ok((result.data ?? []) as unknown as SubcontractorAdvance[]);
    },

    async save(payload: SubcontractorAdvancePayload, id?: string) {
      return settle(id
        ? await supabase.from("subcontractor_advances").update(payload).eq("id", id)
        : await supabase.from("subcontractor_advances").insert(payload));
    },
  };
}

export function supabasePaymentReminderRepository(supabase: SupabaseClient): PaymentReminderRepository {
  return {
    async recordPayment(userId: string, paymentReminderId: string, payload: PaymentReminderPaymentPayload) {
      const result = await supabase
        .from("payment_reminder_payments")
        .insert({ ...payload, user_id: userId, payment_reminder_id: paymentReminderId })
        .select(PAYMENT_REMINDER_PAYMENT_SELECT)
        .single();
      return result.error
        ? err<PaymentReminderPayment>(result.error as AppError)
        : ok(result.data as unknown as PaymentReminderPayment);
    },

    async deletePayment(paymentId: string) {
      return settle(await supabase.from("payment_reminder_payments").delete().eq("id", paymentId));
    },

    async updateCompletion(paymentReminderId: string, status: "pending" | "paid") {
      return settle(await supabase.from("payment_reminders").update({ status }).eq("id", paymentReminderId));
    },
  };
}
