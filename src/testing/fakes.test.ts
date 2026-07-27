import { describe, expect, it } from "vitest";
import { fakeCollectionRepository } from "./fakes";
import type { CollectionFormValues, CollectionPaymentFormValues } from "../types";

const values = (overrides: Partial<CollectionFormValues> = {}): CollectionFormValues => ({
  title: "Invoice 1",
  client_name: "Acme",
  external_reference: "INV-1",
  issue_date: "2026-06-01",
  amount: "1000",
  due_date: "2026-06-30",
  notes: "",
  ...overrides,
});

const payment = (overrides: Partial<CollectionPaymentFormValues> = {}): CollectionPaymentFormValues => ({
  amount: "400",
  payment_date: "2026-06-10",
  payment_method: "cash",
  reference_number: "",
  notes: "",
  ...overrides,
});

// The fake underpins every use-case test that follows, so its own behaviour has to be
// pinned down -- a fake that silently does nothing would make those tests pass vacuously.
describe("fakeCollectionRepository", () => {
  it("returns nothing until something is saved", async () => {
    const repo = fakeCollectionRepository();
    const result = await repo.list();
    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  });

  it("round-trips a saved receivable through list", async () => {
    const repo = fakeCollectionRepository();
    await repo.save({ id: "c1", userId: "u1", values: values({ title: "Invoice 7" }) });

    const { data } = await repo.list();
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ id: "c1", title: "Invoice 7", client_name: "Acme", amount: 1000 });
  });

  it("updates in place rather than appending when saving an existing id", async () => {
    const repo = fakeCollectionRepository();
    await repo.save({ id: "c1", userId: "u1", values: values({ title: "Before" }) });
    await repo.save({ id: "c1", userId: "u1", values: values({ title: "After" }) });

    const { data } = await repo.list();
    expect(data).toHaveLength(1);
    expect(data![0].title).toBe("After");
  });

  it("records a payment against the receivable and reflects it in the balance", async () => {
    const repo = fakeCollectionRepository();
    await repo.save({ id: "c1", userId: "u1", values: values() });
    await repo.recordPayment({ collectionId: "c1", paymentId: "p1", values: payment({ amount: "400" }) });

    const { data } = await repo.list();
    expect(data![0].payments).toHaveLength(1);
    expect(data![0].amount_paid).toBe(400);
    expect(data![0].outstanding_balance).toBe(600);
  });

  it("voids a payment back out of the balance", async () => {
    const repo = fakeCollectionRepository();
    await repo.save({ id: "c1", userId: "u1", values: values() });
    await repo.recordPayment({ collectionId: "c1", paymentId: "p1", values: payment({ amount: "400" }) });
    await repo.voidPayment("p1", "Duplicate");

    const { data } = await repo.list();
    expect(data![0].amount_paid).toBe(0);
    expect(data![0].outstanding_balance).toBe(1000);
  });

  it("archives and restores", async () => {
    const repo = fakeCollectionRepository();
    await repo.save({ id: "c1", userId: "u1", values: values() });

    await repo.archive("c1");
    expect((await repo.list()).data![0].archived_at).not.toBeNull();

    await repo.restore("c1");
    expect((await repo.list()).data![0].archived_at).toBeNull();
  });

  it("can be primed to fail so error paths are reachable", async () => {
    const repo = fakeCollectionRepository();
    repo.failNext({ message: "duplicate key value", code: "23505" });

    const result = await repo.save({ id: "c1", userId: "u1", values: values() });
    expect(result.error).toMatchObject({ code: "23505" });
    expect((await repo.list()).data).toEqual([]);
  });

  it("only fails once when primed", async () => {
    const repo = fakeCollectionRepository();
    repo.failNext({ message: "boom" });

    await repo.save({ id: "c1", userId: "u1", values: values() });
    const second = await repo.save({ id: "c1", userId: "u1", values: values() });

    expect(second.error).toBeNull();
    expect((await repo.list()).data).toHaveLength(1);
  });
});
