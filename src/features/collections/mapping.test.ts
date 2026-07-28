import { describe, expect, it } from "vitest";
import { normalizeReceivable, receivablePayload } from "./mapping";
import type { CollectionReminder } from "../../types";

const raw = (overrides: Partial<CollectionReminder> = {}) => ({
  id: "c1", user_id: "u1", collection_no: "COL-1", title: "Invoice", client_name: "Acme",
  external_reference: "INV-1", issue_date: "2026-06-01", amount: 1000, due_date: "2026-06-30",
  status: "pending", notes: "", archived_at: null, amount_paid: 0, outstanding_balance: 0,
  payments: [], created_at: "2026-06-01T00:00:00Z", updated_at: "2026-06-02T00:00:00Z",
  ...overrides,
}) as CollectionReminder;

describe("normalizeReceivable", () => {
  it("computes totals from the payments it was given", () => {
    const result = normalizeReceivable(raw({
      payments: [{
        id: "p1", user_id: "u1", collection_id: "c1", amount: 400, payment_date: "2026-06-10",
        payment_method: "cash", reference_number: "", notes: "", is_void: false,
        void_reason: "", voided_at: null, created_at: "", updated_at: "",
      }],
    }));

    expect(result.amount_paid).toBe(400);
    expect(result.outstanding_balance).toBe(600);
  });

  // Rows marked collected before collection_payments existed carry no payment rows. Without
  // the reconstruction they would show a full outstanding balance despite being settled.
  it("reconstructs a payment for a legacy collected row that has no payments", () => {
    const result = normalizeReceivable(raw({
      status: "collected",
      payments: undefined as unknown as CollectionReminder["payments"],
    }));

    expect(result.payments).toHaveLength(1);
    expect(result.payments[0].reference_number).toBe("LEGACY");
    expect(result.amount_paid).toBe(1000);
    expect(result.outstanding_balance).toBe(0);
  });

  it("does not invent payments for a legacy row that is not collected", () => {
    const result = normalizeReceivable(raw({
      status: "pending",
      payments: undefined as unknown as CollectionReminder["payments"],
    }));

    expect(result.payments).toEqual([]);
    expect(result.outstanding_balance).toBe(1000);
  });

  it("fills in columns added after the table shipped", () => {
    const result = normalizeReceivable(raw({
      collection_no: undefined as unknown as string,
      external_reference: undefined as unknown as string,
      issue_date: undefined as unknown as string,
      archived_at: undefined as unknown as string,
    }));

    expect(result.collection_no).toBeNull();
    expect(result.external_reference).toBe("");
    expect(result.issue_date).toBe("2026-06-01");
    expect(result.archived_at).toBeNull();
  });
});

describe("receivablePayload", () => {
  it("trims text and coerces the amount to a number", () => {
    const payload = receivablePayload({
      title: "  Invoice  ", client_name: "  Acme  ", external_reference: "  INV-1  ",
      issue_date: "2026-06-01", amount: "1000.50", due_date: "2026-06-30", notes: "  note  ",
    }, "u1");

    expect(payload).toEqual({
      user_id: "u1", title: "Invoice", client_name: "Acme", external_reference: "INV-1",
      issue_date: "2026-06-01", amount: 1000.5, due_date: "2026-06-30",
      status: "pending", notes: "note",
    });
  });
});
