import type { CollectionRepository } from "../../core/ports";
import type { Notifier } from "../../core/ports/notifier";
import { validateCollectionPayment, withCollectionTotals } from "../../domain/collections";
import { isConnectivityFailure } from "../../shared/utils/errors";
import type { QueueOfflineMutation } from "../../shared/types";
import type {
  CollectionFormValues,
  CollectionPayment,
  CollectionPaymentFormValues,
  CollectionReminder,
} from "../../types";
import { receivablePayload } from "./mapping";

/**
 * Everything these use-cases reach outside themselves. `isOnline`, `newId` and `now` are
 * injected rather than read from the ambient environment so the offline branch -- the one
 * that historically shipped bugs -- is reachable in a test.
 */
export type CollectionDeps = {
  repos: { collections: CollectionRepository };
  queue: QueueOfflineMutation;
  notify: Notifier;
  isOnline: () => boolean;
  reload: () => Promise<void>;
  applyLocal: (collections: CollectionReminder[]) => void;
  newId: () => string;
  now: () => string;
};

const AFFECTED = ["collections", "dashboardSummary"] as const;

function errorText(error: { message?: string; details?: string | null } | null | undefined) {
  return error?.message || error?.details || "Unable to complete that collection action.";
}

export async function saveReceivable(
  deps: CollectionDeps,
  input: {
    values: CollectionFormValues;
    editing: CollectionReminder | null;
    collections: CollectionReminder[];
    userId: string;
  },
): Promise<boolean> {
  const { values, editing, collections, userId } = input;

  if (
    Number(values.amount) <= 0 ||
    values.issue_date > values.due_date ||
    (editing && Number(values.amount) < editing.amount_paid)
  ) {
    deps.notify.error(
      "Enter a positive amount, keep it at least equal to payments already received, and use a due date on or after the issue date.",
    );
    return false;
  }

  const id = editing?.id ?? deps.newId();
  const payload = receivablePayload(values, userId);
  const optimistic = withCollectionTotals({
    ...(editing ?? {} as CollectionReminder),
    ...payload,
    id,
    collection_no: editing?.collection_no ?? null,
    archived_at: editing?.archived_at ?? null,
    payments: editing?.payments ?? [],
    amount_paid: editing?.amount_paid ?? 0,
    outstanding_balance: 0,
    created_at: editing?.created_at ?? deps.now(),
    updated_at: deps.now(),
  });

  const queueWrite = async () => {
    deps.applyLocal(editing
      ? collections.map((item) => item.id === id ? optimistic : item)
      : [optimistic, ...collections]);
    await deps.queue({
      resource: "collections",
      affectedResources: [...AFFECTED],
      operation: editing ? "update" : "insert",
      table: "collection_reminders",
      recordId: id,
      payload: editing ? payload : { ...payload, id },
    });
  };

  if (!deps.isOnline()) {
    await queueWrite();
    return true;
  }

  const result = await deps.repos.collections.save({ id: editing?.id, userId, values });
  if (result.error) {
    if (isConnectivityFailure(result.error)) {
      await queueWrite();
      return true;
    }
    deps.notify.error(errorText(result.error));
    return false;
  }

  deps.notify.success("Receivable saved.");
  await deps.reload();
  return true;
}

export async function toggleArchive(
  deps: CollectionDeps,
  input: { collection: CollectionReminder; collections: CollectionReminder[] },
): Promise<void> {
  const { collection, collections } = input;
  const restoring = Boolean(collection.archived_at);

  const confirmed = await deps.notify.confirm({
    title: restoring ? "Restore receivable" : "Archive receivable",
    message: restoring
      ? `Restore ${collection.client_name}'s receivable to active status?`
      : `Archive ${collection.client_name}'s receivable? It will move out of the active list.`,
  });
  if (!confirmed) return;

  const archivedAt = restoring ? null : deps.now();
  const optimistic = withCollectionTotals({ ...collection, archived_at: archivedAt, updated_at: deps.now() });

  if (!deps.isOnline()) {
    deps.applyLocal(collections.map((item) => item.id === optimistic.id ? optimistic : item));
    await deps.queue({
      resource: "collections",
      affectedResources: [...AFFECTED],
      operation: "update",
      table: "collection_reminders",
      recordId: collection.id,
      payload: { archived_at: archivedAt },
    });
    return;
  }

  const result = restoring
    ? await deps.repos.collections.restore(collection.id)
    : await deps.repos.collections.archive(collection.id);
  if (result.error) {
    deps.notify.error(errorText(result.error));
    return;
  }

  deps.notify.success(restoring ? "Receivable restored." : "Receivable archived.");
  await deps.reload();
}

export async function recordPayment(
  deps: CollectionDeps,
  input: {
    collection: CollectionReminder;
    collections: CollectionReminder[];
    values: CollectionPaymentFormValues;
  },
): Promise<boolean> {
  const { collection, collections, values } = input;
  const amount = Number(values.amount);

  const validationError = validateCollectionPayment({
    amount,
    archived: Boolean(collection.archived_at),
    balance: collection.outstanding_balance,
    paymentDate: values.payment_date,
  });
  if (validationError) {
    deps.notify.error(validationError);
    return false;
  }

  const id = deps.newId();
  const optimisticPayment: CollectionPayment = {
    id,
    user_id: collection.user_id,
    collection_id: collection.id,
    amount,
    payment_date: values.payment_date,
    payment_method: values.payment_method,
    reference_number: values.reference_number.trim(),
    notes: values.notes.trim(),
    is_void: false,
    void_reason: "",
    voided_at: null,
    created_at: deps.now(),
    updated_at: deps.now(),
  };
  const optimistic = withCollectionTotals({
    ...collection,
    payments: [optimisticPayment, ...collection.payments],
  });

  if (!deps.isOnline()) {
    deps.applyLocal(collections.map((item) => item.id === optimistic.id ? optimistic : item));
    await deps.queue({
      resource: "collections",
      affectedResources: [...AFFECTED],
      operation: "collection_payment",
      table: "record_collection_payment",
      recordId: id,
      payload: {
        collection_record_id: collection.id,
        payment_record_id: id,
        payment_amount: amount,
        paid_on: values.payment_date,
        method: values.payment_method,
        payment_reference: values.reference_number.trim(),
        payment_notes: values.notes.trim(),
      },
    });
    return true;
  }

  const result = await deps.repos.collections.recordPayment({
    collectionId: collection.id,
    paymentId: id,
    values,
  });
  if (result.error) {
    deps.notify.error(errorText(result.error));
    return false;
  }

  deps.notify.success(amount >= collection.outstanding_balance ? "Marked as collected." : "Payment recorded.");
  await deps.reload();
  return true;
}
