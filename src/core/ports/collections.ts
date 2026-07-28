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

export type CollectionPaymentTotals = {
  /** Sum of every non-void payment ever recorded, including against archived receivables. */
  lifetimeTotal: number;
  /** Sum of non-void payments recorded on or after monthStart. */
  monthTotal: number;
};

/**
 * Receivables data access, stated without reference to Supabase so use-cases can be tested
 * against an in-memory implementation. The Supabase adapter is the only implementation that
 * ships; the fake exists for tests.
 */
export interface CollectionRepository {
  list(): Promise<Result<CollectionReminder[]>>;
  /**
   * Non-archived receivables only. This is the currently-open pipeline, which stays small
   * regardless of how many years of archived/collected history a business has accumulated --
   * callers that only need "what's open right now" (the dashboard) should use this instead of
   * list(), which returns everything ever created.
   */
  listOpen(): Promise<Result<CollectionReminder[]>>;
  /**
   * Aggregated server-side so a caller that only needs two numbers (the dashboard) never has
   * to load every collection payment ever recorded just to sum them in the browser.
   */
  collectedTotals(monthStart: string): Promise<Result<CollectionPaymentTotals>>;
  save(input: SaveCollectionInput): Promise<Result<void>>;
  archive(id: string): Promise<Result<void>>;
  restore(id: string): Promise<Result<void>>;
  recordPayment(input: RecordCollectionPaymentInput): Promise<Result<void>>;
  voidPayment(paymentId: string, reason: string): Promise<Result<void>>;
}
