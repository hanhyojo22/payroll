import { describe, expect, it } from "vitest";
import type { PaymentReminder, PaymentReminderPayment } from "../types";
import {
  nextPaymentReminderCompletionState,
  paymentReminderDisplayStatus,
  paymentReminderPaymentsTotal,
  paymentReminderRemainingBalance,
  subcontractorPayoutExpensePayload,
  SUBCONTRACTOR_PAYOUT_EXPENSE_CATEGORY_NAME,
  validatePaymentReminderPayment,
} from "./paymentReminders";

const baseReminder: Pick<PaymentReminder, "amount" | "status"> = {
  amount: 1000,
  status: "pending",
};

function payment(overrides: Partial<PaymentReminderPayment>): PaymentReminderPayment {
  return {
    id: "p1",
    user_id: "u1",
    payment_reminder_id: "r1",
    amount: 100,
    payment_date: "2026-07-01",
    payment_method: "cash",
    reference_number: "",
    notes: "",
    created_at: "",
    ...overrides,
  };
}

describe("paymentReminderPaymentsTotal", () => {
  it("sums payment amounts, treating null/undefined as empty", () => {
    expect(paymentReminderPaymentsTotal(null)).toBe(0);
    expect(paymentReminderPaymentsTotal([payment({ amount: 300 }), payment({ id: "p2", amount: 200 })])).toBe(500);
  });
});

describe("paymentReminderRemainingBalance", () => {
  it("subtracts payments total from the reminder amount, floored at zero", () => {
    expect(paymentReminderRemainingBalance(baseReminder, [])).toBe(1000);
    expect(paymentReminderRemainingBalance(baseReminder, [payment({ amount: 400 })])).toBe(600);
    expect(paymentReminderRemainingBalance(baseReminder, [payment({ amount: 1500 })])).toBe(0);
  });
});

describe("paymentReminderDisplayStatus", () => {
  it("is pending with no payments", () => {
    expect(paymentReminderDisplayStatus(baseReminder, [])).toBe("pending");
  });

  it("is partial once some but not all of the amount is paid", () => {
    expect(paymentReminderDisplayStatus(baseReminder, [payment({ amount: 400 })])).toBe("partial");
  });

  it("is paid once payments cover the full amount", () => {
    expect(paymentReminderDisplayStatus(baseReminder, [payment({ amount: 1000 })])).toBe("paid");
  });

  it("is paid when the reminder's own status is already paid, regardless of payments", () => {
    expect(paymentReminderDisplayStatus({ amount: 1000, status: "paid" }, [])).toBe("paid");
  });
});

describe("nextPaymentReminderCompletionState", () => {
  it("stays pending until payments cover the full amount", () => {
    expect(nextPaymentReminderCompletionState(baseReminder, [payment({ amount: 400 })])).toEqual({ status: "pending" });
  });

  it("flips to paid once payments cover the full amount", () => {
    expect(nextPaymentReminderCompletionState(baseReminder, [payment({ amount: 1000 })])).toEqual({ status: "paid" });
  });
});

describe("validatePaymentReminderPayment", () => {
  it("rejects a non-positive amount", () => {
    expect(validatePaymentReminderPayment({ amount: 0, remainingBalance: 500, paymentDate: "2026-07-01", today: "2026-07-06" }))
      .toBe("Payment amount must be greater than zero.");
  });

  it("rejects an amount exceeding the remaining balance", () => {
    expect(validatePaymentReminderPayment({ amount: 600, remainingBalance: 500, paymentDate: "2026-07-01", today: "2026-07-06" }))
      .toBe("Payment exceeds the remaining balance.");
  });

  it("rejects a future payment date", () => {
    expect(validatePaymentReminderPayment({ amount: 100, remainingBalance: 500, paymentDate: "2026-07-10", today: "2026-07-06" }))
      .toBe("Payment date cannot be in the future.");
  });

  it("accepts a valid payment", () => {
    expect(validatePaymentReminderPayment({ amount: 100, remainingBalance: 500, paymentDate: "2026-07-06", today: "2026-07-06" }))
      .toBeNull();
  });
});

describe("subcontractorPayoutExpensePayload", () => {
  it("builds a system-managed company expense linked to the payout reminder", () => {
    const payload = subcontractorPayoutExpensePayload(
      {
        id: "rem-1",
        user_id: "u1",
        title: "Acme Subcon",
        amount: 1250,
        due_date: "2026-07-15",
        status: "pending",
        notes: "July 2026 · First half",
        created_at: "2026-07-08T12:00:00Z",
      },
      [],
      "cat-1",
    );

    expect(payload.id).toBe("rem-1");
    expect(payload.category_name).toBe(SUBCONTRACTOR_PAYOUT_EXPENSE_CATEGORY_NAME);
    expect(payload.employee_name).toBe("Acme Subcon");
    expect(payload.subcontractor_payment_reminder_id).toBe("rem-1");
    expect(payload.payment_date).toBe("2026-07-15");
  });

  it("marks the expense paid using the latest payment date once payments cover the full amount", () => {
    const payload = subcontractorPayoutExpensePayload(
      {
        id: "rem-1",
        user_id: "u1",
        title: "Acme Subcon",
        amount: 1000,
        due_date: "2026-07-15",
        status: "pending",
        notes: "",
        created_at: "2026-07-08T12:00:00Z",
      },
      [
        payment({ amount: 400, payment_date: "2026-07-10" }),
        payment({ id: "p2", amount: 600, payment_date: "2026-07-12" }),
      ],
      "cat-1",
    );

    expect(payload.status).toBe("paid");
    expect(payload.paid_date).toBe("2026-07-12");
  });
});
