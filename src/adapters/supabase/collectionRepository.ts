import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CollectionRepository,
  RecordCollectionPaymentInput,
  SaveCollectionInput,
} from "../../core/ports/collections";
import { err, ok, type Result } from "../../core/ports/result";
import type { CollectionReminder } from "../../types";
import type { AppError } from "../../shared/types";
import {
  archiveReceivable,
  fetchReceivables,
  recordReceivablePayment,
  restoreReceivable,
  saveReceivable,
  voidReceivablePayment,
} from "../../features/collections/collectionRepository";

/**
 * Supabase implementation of CollectionRepository.
 *
 * For now it delegates to the existing feature repository rather than duplicating its
 * queries. The query bodies move in here (and that file is deleted) when the collections
 * vertical is converted -- at which point `features/` stops importing SupabaseClient.
 */
export function supabaseCollectionRepository(supabase: SupabaseClient): CollectionRepository {
  const toResult = <T>(raw: { error: unknown }, data: T): Result<T> =>
    raw.error ? err<T>(raw.error as AppError) : ok(data);

  return {
    async list() {
      const raw = await fetchReceivables(supabase);
      return raw.error
        ? err<CollectionReminder[]>(raw.error as AppError)
        : ok(raw.data);
    },

    async save({ id, userId, values }: SaveCollectionInput) {
      const raw = await saveReceivable(supabase, values, userId, id);
      return toResult(raw, undefined as void);
    },

    async archive(id) {
      return toResult(await archiveReceivable(supabase, id), undefined as void);
    },

    async restore(id) {
      return toResult(await restoreReceivable(supabase, id), undefined as void);
    },

    async recordPayment({ collectionId, paymentId, values }: RecordCollectionPaymentInput) {
      const raw = await recordReceivablePayment(supabase, collectionId, paymentId, values);
      return toResult(raw, undefined as void);
    },

    async voidPayment(paymentId, reason) {
      return toResult(await voidReceivablePayment(supabase, paymentId, reason), undefined as void);
    },
  };
}
