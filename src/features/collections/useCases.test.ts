import { describe, expect, it, vi } from "vitest";
import { recordPayment, saveReceivable, toggleArchive } from "./useCases";
import { fakeCollectionRepository } from "../../testing/fakes";
import { withCollectionTotals } from "../../domain/collections";
import type { CollectionFormValues, CollectionPaymentFormValues, CollectionReminder } from "../../types";
import type { QueueOfflineMutation } from "../../shared/types";

const receivable = (overrides: Partial<CollectionReminder> = {}): CollectionReminder =>
  withCollectionTotals({
    id: "c1", user_id: "u1", collection_no: "COL-2026-0001", title: "Invoice",
    client_name: "Acme", external_reference: "INV-1", issue_date: "2026-06-01",
    amount: 1000, due_date: "2026-06-30", status: "pending", notes: "", archived_at: null,
    amount_paid: 0, outstanding_balance: 1000, payments: [],
    created_at: "2026-06-01T00:00:00Z", updated_at: "2026-06-01T00:00:00Z",
    ...overrides,
  });

const formValues = (overrides: Partial<CollectionFormValues> = {}): CollectionFormValues => ({
  title: "Invoice", client_name: "Acme", external_reference: "INV-1",
  issue_date: "2026-06-01", amount: "1000", due_date: "2026-06-30", notes: "",
  ...overrides,
});

const paymentValues = (overrides: Partial<CollectionPaymentFormValues> = {}): CollectionPaymentFormValues => ({
  amount: "400", payment_date: "2026-06-10", payment_method: "cash",
  reference_number: "", notes: "", ...overrides,
});

function deps({ online = true, confirmed = true } = {}) {
  const collections = fakeCollectionRepository();
  return {
    repos: { collections },
    queue: vi.fn(async (_mutation: Parameters<QueueOfflineMutation>[0]) => {}),
    notify: {
      success: vi.fn((_message: string) => {}),
      error: vi.fn((_message: string) => {}),
      confirm: vi.fn(async (_options: { title: string; message: string; danger?: boolean }) => confirmed),
    },
    isOnline: () => online,
    reload: vi.fn(async () => {}),
    applyLocal: vi.fn(),
    newId: () => "generated-id",
    now: () => "2026-06-15T00:00:00Z",
  };
}

describe("saveReceivable", () => {
  it("rejects a non-positive amount without touching the repository", async () => {
    const d = deps();
    const saved = await saveReceivable(d, { values: formValues({ amount: "0" }), editing: null, collections: [], userId: "u1" });

    expect(saved).toBe(false);
    expect(d.notify.error).toHaveBeenCalled();
    expect((await d.repos.collections.list()).data).toEqual([]);
  });

  it("rejects a due date before the issue date", async () => {
    const d = deps();
    const saved = await saveReceivable(d, {
      values: formValues({ issue_date: "2026-06-30", due_date: "2026-06-01" }),
      editing: null, collections: [], userId: "u1",
    });

    expect(saved).toBe(false);
    expect(d.notify.error).toHaveBeenCalled();
  });

  it("rejects reducing the amount below what has already been paid", async () => {
    const d = deps();
    const editing = receivable({ payments: [{
      id: "p1", user_id: "u1", collection_id: "c1", amount: 600, payment_date: "2026-06-05",
      payment_method: "cash", reference_number: "", notes: "", is_void: false, void_reason: "",
      voided_at: null, created_at: "", updated_at: "",
    }] });

    const saved = await saveReceivable(d, { values: formValues({ amount: "500" }), editing, collections: [editing], userId: "u1" });

    expect(saved).toBe(false);
    expect(d.notify.error).toHaveBeenCalled();
  });

  // The offline branch has never had coverage; it is where the queue/patch bugs lived.
  it("queues instead of writing when offline, and shows the row optimistically", async () => {
    const d = deps({ online: false });
    const saved = await saveReceivable(d, { values: formValues(), editing: null, collections: [], userId: "u1" });

    expect(saved).toBe(true);
    expect(d.queue).toHaveBeenCalledTimes(1);
    expect(d.queue.mock.calls[0][0]).toMatchObject({
      table: "collection_reminders",
      operation: "insert",
      recordId: "generated-id",
    });
    expect(d.applyLocal).toHaveBeenCalledTimes(1);
    expect((await d.repos.collections.list()).data).toEqual([]);
    expect(d.reload).not.toHaveBeenCalled();
  });

  it("queues an update rather than an insert when editing offline", async () => {
    const d = deps({ online: false });
    const editing = receivable();
    await saveReceivable(d, { values: formValues({ title: "Changed" }), editing, collections: [editing], userId: "u1" });

    expect(d.queue.mock.calls[0][0]).toMatchObject({ operation: "update", recordId: "c1" });
  });

  it("writes through and reloads when online", async () => {
    const d = deps();
    const saved = await saveReceivable(d, { values: formValues(), editing: null, collections: [], userId: "u1" });

    expect(saved).toBe(true);
    expect((await d.repos.collections.list()).data).toHaveLength(1);
    expect(d.reload).toHaveBeenCalledTimes(1);
    expect(d.notify.success).toHaveBeenCalled();
    expect(d.queue).not.toHaveBeenCalled();
  });

  it("falls back to the queue when the write fails for a connectivity reason", async () => {
    const d = deps();
    d.repos.collections.failNext({ message: "TypeError: Failed to fetch" });

    const saved = await saveReceivable(d, { values: formValues(), editing: null, collections: [], userId: "u1" });

    expect(saved).toBe(true);
    expect(d.queue).toHaveBeenCalledTimes(1);
    expect(d.notify.error).not.toHaveBeenCalled();
  });

  // A server-coded failure is real: it must surface, not silently requeue.
  it("surfaces a server error without queueing or reloading", async () => {
    const d = deps();
    d.repos.collections.failNext({ code: "23505", message: "duplicate key value" });

    const saved = await saveReceivable(d, { values: formValues(), editing: null, collections: [], userId: "u1" });

    expect(saved).toBe(false);
    expect(d.notify.error).toHaveBeenCalled();
    expect(d.queue).not.toHaveBeenCalled();
    expect(d.reload).not.toHaveBeenCalled();
  });
});

describe("toggleArchive", () => {
  it("does nothing when the confirmation is declined", async () => {
    const d = deps({ confirmed: false });
    const collection = receivable();
    d.repos.collections.seed([collection]);

    await toggleArchive(d, { collection, collections: [collection] });

    expect(d.queue).not.toHaveBeenCalled();
    expect(d.reload).not.toHaveBeenCalled();
    expect((await d.repos.collections.list()).data![0].archived_at).toBeNull();
  });

  it("queues the archive when offline", async () => {
    const d = deps({ online: false });
    const collection = receivable();
    d.repos.collections.seed([collection]);

    await toggleArchive(d, { collection, collections: [collection] });

    expect(d.queue).toHaveBeenCalledTimes(1);
    expect(d.queue.mock.calls[0][0]).toMatchObject({ operation: "update", recordId: "c1" });
    expect((await d.repos.collections.list()).data![0].archived_at).toBeNull();
  });

  it("archives through the repository when online", async () => {
    const d = deps();
    const collection = receivable();
    d.repos.collections.seed([collection]);

    await toggleArchive(d, { collection, collections: [collection] });

    expect((await d.repos.collections.list()).data![0].archived_at).not.toBeNull();
    expect(d.reload).toHaveBeenCalledTimes(1);
  });

  it("restores an already-archived receivable instead of archiving it again", async () => {
    const d = deps();
    const collection = receivable({ archived_at: "2026-06-12T00:00:00Z" });
    d.repos.collections.seed([collection]);

    await toggleArchive(d, { collection, collections: [collection] });

    expect((await d.repos.collections.list()).data![0].archived_at).toBeNull();
  });

  it("surfaces a failure and does not reload", async () => {
    const d = deps();
    const collection = receivable();
    d.repos.collections.seed([collection]);
    d.repos.collections.failNext({ code: "42501", message: "row-level security" });

    await toggleArchive(d, { collection, collections: [collection] });

    expect(d.notify.error).toHaveBeenCalled();
    expect(d.reload).not.toHaveBeenCalled();
  });
});

describe("recordPayment", () => {
  it("rejects a payment larger than the outstanding balance", async () => {
    const d = deps();
    const collection = receivable();

    const done = await recordPayment(d, { collection, collections: [collection], values: paymentValues({ amount: "5000" }) });

    expect(done).toBe(false);
    expect(d.notify.error).toHaveBeenCalled();
    expect(d.queue).not.toHaveBeenCalled();
  });

  it("queues the payment when offline", async () => {
    const d = deps({ online: false });
    const collection = receivable();
    d.repos.collections.seed([collection]);

    const done = await recordPayment(d, { collection, collections: [collection], values: paymentValues() });

    expect(done).toBe(true);
    expect(d.queue).toHaveBeenCalledTimes(1);
    expect(d.queue.mock.calls[0][0]).toMatchObject({ operation: "collection_payment", recordId: "generated-id" });
    expect((await d.repos.collections.list()).data![0].amount_paid).toBe(0);
  });

  it("records through the repository when online and reloads", async () => {
    const d = deps();
    const collection = receivable();
    d.repos.collections.seed([collection]);

    const done = await recordPayment(d, { collection, collections: [collection], values: paymentValues({ amount: "400" }) });

    expect(done).toBe(true);
    expect((await d.repos.collections.list()).data![0].amount_paid).toBe(400);
    expect(d.reload).toHaveBeenCalledTimes(1);
    expect(d.notify.success).toHaveBeenCalled();
  });

  it("says collected rather than recorded when the payment settles the balance", async () => {
    const d = deps();
    const collection = receivable();
    d.repos.collections.seed([collection]);

    await recordPayment(d, { collection, collections: [collection], values: paymentValues({ amount: "1000" }) });

    expect(d.notify.success.mock.calls[0][0]).toMatch(/collected/i);
  });
});
