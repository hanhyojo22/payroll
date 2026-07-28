import type {
  BillingSettings,
  CollectionPaymentMethod,
  PaymentReminderPayment,
  SubconDailyTicket,
  Subcontractor,
  SubcontractorAdvance,
} from "../../types";
import type { Result } from "./result";

export type BillingSettingsPayload = {
  installation_rate: number;
  repair_rate: number;
  nap_rehab_rate: number;
  collections_pct: number;
  client_name: string;
};

export interface BillingSettingsRepository {
  /** Creates the single settings row on first use if one doesn't already exist. */
  ensure(userId: string): Promise<Result<BillingSettings>>;
  save(userId: string, payload: BillingSettingsPayload): Promise<Result<void>>;
}

export interface BillingRecordRepository {
  /**
   * Refuses to delete when the linked collection(s) already have payments recorded --
   * the caller surfaces that as a normal error message, not an exception.
   */
  delete(id: string, collectionId: string | null, collectiblesCollectionId: string | null): Promise<Result<void>>;
}

export type SubcontractorPayload = {
  id?: string;
  name: string;
  installation_rate: number;
  repair_rate: number;
  nap_rehab_rate: number;
  payable_pct: number;
  status: string;
  email: string;
  contact_number: string;
  address: string;
};

export interface SubcontractorRepository {
  list(): Promise<Result<Subcontractor[]>>;
  save(userId: string, payload: SubcontractorPayload): Promise<Result<void>>;
}

export type SubconDailyTicketPayload = Omit<SubconDailyTicket, "created_at" | "updated_at">;

export interface SubconDailyTicketRepository {
  list(): Promise<Result<SubconDailyTicket[]>>;
  /** Upserts on (user_id, entry_date, subcontractor_id) so re-entering a day replaces it. */
  save(payload: SubconDailyTicketPayload): Promise<Result<void>>;
}

export type SubcontractorAdvancePayload = Omit<SubcontractorAdvance, "id" | "created_at" | "updated_at"> & { id?: string };

export interface SubcontractorAdvanceRepository {
  list(): Promise<Result<SubcontractorAdvance[]>>;
  save(payload: SubcontractorAdvancePayload, id?: string): Promise<Result<void>>;
}

export type PaymentReminderPaymentPayload = {
  amount: number;
  payment_date: string;
  payment_method: CollectionPaymentMethod;
  reference_number: string;
  notes: string;
};

/** Payout tracking for billing/subcontractor payment reminders (not the general Payments view). */
export interface PaymentReminderRepository {
  recordPayment(userId: string, paymentReminderId: string, payload: PaymentReminderPaymentPayload): Promise<Result<PaymentReminderPayment>>;
  deletePayment(paymentId: string): Promise<Result<void>>;
  updateCompletion(paymentReminderId: string, status: "pending" | "paid"): Promise<Result<void>>;
}
