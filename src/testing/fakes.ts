import type { CollectionRepository, RecordCollectionPaymentInput, SaveCollectionInput } from "../core/ports/collections";
import { err, ok, type Result } from "../core/ports/result";
import { withCollectionTotals } from "../domain/collections";
import type { CollectionPayment, CollectionReminder } from "../types";
import type { AppError } from "../shared/types";

export type FakeCollectionRepository = CollectionRepository & {
  /** Prime the next call to fail, so use-case error branches are reachable in tests. */
  failNext(error: AppError): void;
  /** Seed existing rows without going through save(). */
  seed(collections: CollectionReminder[]): void;
};

/**
 * In-memory CollectionRepository. Recomputes totals through the real domain helper rather
 * than storing them, so a test that asserts on a balance is exercising the same arithmetic
 * production uses.
 */
export function fakeCollectionRepository(): FakeCollectionRepository {
  let rows: CollectionReminder[] = [];
  let pendingFailure: AppError | null = null;

  function takeFailure<T>(): Result<T> | null {
    if (!pendingFailure) return null;
    const failure = pendingFailure;
    pendingFailure = null;
    return err<T>(failure);
  }

  const totalled = (row: CollectionReminder) => withCollectionTotals(row);

  return {
    failNext(error) {
      pendingFailure = error;
    },

    seed(collections) {
      rows = collections.map(totalled);
    },

    async list() {
      return takeFailure<CollectionReminder[]>() ?? ok(rows.map(totalled));
    },

    async save({ id, userId, values }: SaveCollectionInput) {
      const failure = takeFailure<void>();
      if (failure) return failure;

      const now = new Date().toISOString();
      const existing = id ? rows.find((row) => row.id === id) : undefined;
      const next: CollectionReminder = totalled({
        id: id ?? crypto.randomUUID(),
        user_id: userId,
        collection_no: existing?.collection_no ?? null,
        title: values.title.trim(),
        client_name: values.client_name.trim(),
        external_reference: values.external_reference.trim(),
        issue_date: values.issue_date,
        amount: Number(values.amount),
        due_date: values.due_date,
        status: existing?.status ?? "pending",
        notes: values.notes.trim(),
        archived_at: existing?.archived_at ?? null,
        amount_paid: 0,
        outstanding_balance: 0,
        payments: existing?.payments ?? [],
        created_at: existing?.created_at ?? now,
        updated_at: now,
      });

      rows = existing
        ? rows.map((row) => (row.id === next.id ? next : row))
        : [next, ...rows];
      return ok(undefined);
    },

    async archive(id) {
      const failure = takeFailure<void>();
      if (failure) return failure;
      rows = rows.map((row) => row.id === id ? totalled({ ...row, archived_at: new Date().toISOString() }) : row);
      return ok(undefined);
    },

    async restore(id) {
      const failure = takeFailure<void>();
      if (failure) return failure;
      rows = rows.map((row) => row.id === id ? totalled({ ...row, archived_at: null }) : row);
      return ok(undefined);
    },

    async recordPayment({ collectionId, paymentId, values }: RecordCollectionPaymentInput) {
      const failure = takeFailure<void>();
      if (failure) return failure;

      const now = new Date().toISOString();
      rows = rows.map((row) => {
        if (row.id !== collectionId) return row;
        const entry: CollectionPayment = {
          id: paymentId,
          user_id: row.user_id,
          collection_id: row.id,
          amount: Number(values.amount),
          payment_date: values.payment_date,
          payment_method: values.payment_method,
          reference_number: values.reference_number.trim(),
          notes: values.notes.trim(),
          is_void: false,
          void_reason: "",
          voided_at: null,
          created_at: now,
          updated_at: now,
        };
        return totalled({ ...row, payments: [entry, ...row.payments] });
      });
      return ok(undefined);
    },

    async voidPayment(paymentId, reason) {
      const failure = takeFailure<void>();
      if (failure) return failure;

      const now = new Date().toISOString();
      rows = rows.map((row) => totalled({
        ...row,
        payments: row.payments.map((entry) => entry.id === paymentId
          ? { ...entry, is_void: true, void_reason: reason, voided_at: now }
          : entry),
      }));
      return ok(undefined);
    },
  };
}
