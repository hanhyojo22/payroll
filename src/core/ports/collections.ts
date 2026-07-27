import type {
  CollectionFormValues,
  CollectionPaymentFormValues,
  CollectionReminder,
} from "../../types";
import type { Result } from "./result";

export type SaveCollectionInput = {
  /** Omitted for a new receivable; present when editing an existing one. */
  id?: string;
  userId: string;
  values: CollectionFormValues;
};

export type RecordCollectionPaymentInput = {
  collectionId: string;
  /** Client-generated so the write stays idempotent across an offline replay. */
  paymentId: string;
  values: CollectionPaymentFormValues;
};

/**
 * Receivables data access, stated without reference to Supabase so use-cases can be tested
 * against an in-memory implementation. The Supabase adapter is the only implementation that
 * ships; the fake exists for tests.
 */
export interface CollectionRepository {
  list(): Promise<Result<CollectionReminder[]>>;
  save(input: SaveCollectionInput): Promise<Result<void>>;
  archive(id: string): Promise<Result<void>>;
  restore(id: string): Promise<Result<void>>;
  recordPayment(input: RecordCollectionPaymentInput): Promise<Result<void>>;
  voidPayment(paymentId: string, reason: string): Promise<Result<void>>;
}
