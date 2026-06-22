import { describe, expect, it } from "vitest";
import {
  collectionAgingBucket,
  collectionBalance,
  collectionStatus,
  validateCollectionPayment,
} from "./collections";
import type { CollectionPayment, CollectionReminder } from "../types";

const payment = (amount: number, overrides: Partial<CollectionPayment> = {}): CollectionPayment => ({
  id: crypto.randomUUID(), user_id: "user-1", collection_id: "collection-1", amount,
  payment_date: "2026-06-10", payment_method: "cash", reference_number: "", notes: "",
  is_void: false, void_reason: "", voided_at: null,
  created_at: "2026-06-10T00:00:00Z", updated_at: "2026-06-10T00:00:00Z", ...overrides,
});

const receivable = (overrides: Partial<CollectionReminder> = {}): CollectionReminder => ({
  id: "collection-1", user_id: "user-1", collection_no: "COL-2026-0001", title: "Invoice",
  client_name: "Client", external_reference: "INV-1", issue_date: "2026-06-01", amount: 1000,
  due_date: "2026-06-30", status: "pending", notes: "", archived_at: null,
  amount_paid: 0, outstanding_balance: 1000, payments: [],
  created_at: "2026-06-01T00:00:00Z", updated_at: "2026-06-01T00:00:00Z", ...overrides,
});

describe("receivable collection rules", () => {
  it("moves from pending to partial to collected using non-void payments", () => {
    expect(collectionStatus(receivable(), "2026-06-15")).toBe("pending");
    expect(collectionStatus(receivable({ payments: [payment(400)] }), "2026-06-15")).toBe("partial");
    expect(collectionStatus(receivable({ payments: [payment(400), payment(600)] }), "2026-06-15")).toBe("collected");
  });

  it("derives overdue status even after a partial payment", () => {
    expect(collectionStatus(receivable({ due_date: "2026-05-31", payments: [payment(400)] }), "2026-06-15")).toBe("overdue");
  });

  it("excludes void payments and reopens the balance", () => {
    const payments = [payment(1000, { is_void: true, void_reason: "Duplicate", voided_at: "2026-06-11T00:00:00Z" })];
    expect(collectionBalance(1000, payments)).toBe(1000);
    expect(collectionStatus(receivable({ payments }), "2026-06-15")).toBe("pending");
  });

  it("gives archive state precedence", () => {
    expect(collectionStatus(receivable({ archived_at: "2026-06-12T00:00:00Z", payments: [payment(1000)] }), "2026-06-15")).toBe("archived");
  });

  it("uses the defined aging boundaries", () => {
    expect(collectionAgingBucket("2026-06-30", "2026-06-30")).toBe("current");
    expect(collectionAgingBucket("2026-06-01", "2026-07-01")).toBe("days1To30");
    expect(collectionAgingBucket("2026-05-31", "2026-07-01")).toBe("days31To60");
    expect(collectionAgingBucket("2026-05-01", "2026-07-01")).toBe("days61To90");
    expect(collectionAgingBucket("2026-03-31", "2026-07-01")).toBe("daysOver90");
  });

  it("rejects invalid, future, archived, and over-balance payments", () => {
    expect(validateCollectionPayment({ amount: 0, balance: 100, archived: false, paymentDate: "2026-06-01", today: "2026-06-02" })).toContain("greater than zero");
    expect(validateCollectionPayment({ amount: 101, balance: 100, archived: false, paymentDate: "2026-06-01", today: "2026-06-02" })).toContain("exceeds");
    expect(validateCollectionPayment({ amount: 50, balance: 100, archived: false, paymentDate: "2026-06-03", today: "2026-06-02" })).toContain("future");
    expect(validateCollectionPayment({ amount: 50, balance: 100, archived: true, paymentDate: "2026-06-01", today: "2026-06-02" })).toContain("Archived");
  });
});
