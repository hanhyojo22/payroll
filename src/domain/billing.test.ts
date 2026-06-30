import { describe, expect, it } from "vitest";
import {
  buildSubcontractorAccountSummary,
  buildSubcontractorPaymentPayloads,
  computeBilling,
  countTicketsForMonth,
  lastDayOfMonth,
} from "./billing";
import type { BillingSubconItem, DailyTicketEntry, PaymentReminder, SubconDailyTicket, Subcontractor } from "../types";

describe("countTicketsForMonth", () => {
  const entries: DailyTicketEntry[] = [
    {
      id: "e1", user_id: "u1", entry_date: "2026-06-05", employee_id: "emp1",
      employee_name: "Alice", position_id: "p1", position_name: "Tech",
      installation_tickets: 3, repair_tickets: 2, installation_rate: 600,
      repair_rate: 200, created_at: "", updated_at: "",
      details: [
        { id: "d1", user_id: "u1", daily_ticket_entry_id: "e1", position_ticket_category_id: "c1", category_name: "Install", ticket_count: 4, rate: 600, ticket_type: "installation" as const, created_at: "", updated_at: "" },
        { id: "d2", user_id: "u1", daily_ticket_entry_id: "e1", position_ticket_category_id: "c2", category_name: "Repair", ticket_count: 2, rate: 200, ticket_type: "repair" as const, created_at: "", updated_at: "" },
      ],
    },
    {
      id: "e2", user_id: "u1", entry_date: "2026-06-12", employee_id: "emp2",
      employee_name: "Bob", position_id: null, position_name: "",
      installation_tickets: 5, repair_tickets: 1, installation_rate: 600,
      repair_rate: 200, created_at: "", updated_at: "",
      details: [],
    },
    {
      id: "e3", user_id: "u1", entry_date: "2026-07-03", employee_id: "emp1",
      employee_name: "Alice", position_id: "p1", position_name: "Tech",
      installation_tickets: 10, repair_tickets: 5, installation_rate: 600,
      repair_rate: 200, created_at: "", updated_at: "",
      details: [],
    },
  ];

  it("sums ticket counts from details when available, falls back to legacy fields", () => {
    const count = countTicketsForMonth(entries, 6, 2026);
    // Entry 1: details present → 4 + 2 = 6
    // Entry 2: no details → installation_tickets(5) + repair_tickets(1) = 6
    // Entry 3: July, excluded
    expect(count).toBe(12);
  });

  it("returns 0 when no entries match the month", () => {
    expect(countTicketsForMonth(entries, 8, 2026)).toBe(0);
  });

  it("returns 0 for empty entries array", () => {
    expect(countTicketsForMonth([], 6, 2026)).toBe(0);
  });
});

describe("computeBilling", () => {
  it("computes billing with 70/30 split", () => {
    const result = computeBilling(100, 10, 1500, 70);
    expect(result.billableTickets).toBe(90);
    expect(result.billingAmount).toBe(135_000);
    expect(result.collectionsAmount).toBe(94_500);
    expect(result.collectiblesAmount).toBe(40_500);
  });

  it("handles zero tickets", () => {
    const result = computeBilling(0, 0, 1500, 70);
    expect(result.billableTickets).toBe(0);
    expect(result.billingAmount).toBe(0);
    expect(result.collectionsAmount).toBe(0);
    expect(result.collectiblesAmount).toBe(0);
  });

  it("clamps disputed tickets to total", () => {
    const result = computeBilling(5, 10, 1500, 70);
    expect(result.billableTickets).toBe(0);
    expect(result.billingAmount).toBe(0);
  });

  it("handles 100% collections", () => {
    const result = computeBilling(10, 0, 1000, 100);
    expect(result.collectionsAmount).toBe(10_000);
    expect(result.collectiblesAmount).toBe(0);
  });

  it("handles 0% collections", () => {
    const result = computeBilling(10, 0, 1000, 0);
    expect(result.collectionsAmount).toBe(0);
    expect(result.collectiblesAmount).toBe(10_000);
  });
});

describe("lastDayOfMonth", () => {
  it("returns last day of June 2026", () => {
    expect(lastDayOfMonth(6, 2026)).toBe("2026-06-30");
  });

  it("returns last day of February in a non-leap year", () => {
    expect(lastDayOfMonth(2, 2025)).toBe("2025-02-28");
  });

  it("returns last day of February in a leap year", () => {
    expect(lastDayOfMonth(2, 2024)).toBe("2024-02-29");
  });

  it("returns last day of December", () => {
    expect(lastDayOfMonth(12, 2026)).toBe("2026-12-31");
  });
});

describe("buildSubcontractorPaymentPayloads", () => {
  it("creates one payout row per subcontractor billing item", () => {
    const items: BillingSubconItem[] = [
      {
        id: "item-1",
        user_id: "u1",
        billing_record_id: "bill-1",
        subcontractor_id: "sub-1",
        subcon_name: "Alpha",
        install_tickets: 4,
        repair_tickets: 2,
        disputed_install: 0,
        disputed_repair: 0,
        installation_rate: 1000,
        repair_rate: 500,
        billable_tickets: 6,
        billing_amount: 5000,
        payable_pct: 70,
        payable_amount: 3500,
        collection_amount: 1500,
        created_at: "",
      },
    ];

    const payloads = buildSubcontractorPaymentPayloads({
      billingMonth: 6,
      billingYear: 2026,
      billingPeriod: "first_half",
      dueDate: "2026-06-15",
      items,
      userId: "u1",
      monthName: "June",
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      billing_subcon_item_id: "item-1",
      subcontractor_id: "sub-1",
      amount: 3500,
      status: "pending",
      type: "subcontractor",
    });
  });
});

describe("buildSubcontractorAccountSummary", () => {
  it("computes pending, paid, and ticket totals for a subcontractor account", () => {
    const subcontractor: Subcontractor = {
      id: "sub-1",
      user_id: "u1",
      name: "Alpha",
      installation_rate: 1000,
      repair_rate: 500,
      payable_pct: 70,
      status: "active",
      created_at: "",
      updated_at: "",
    };
    const dailyTickets: SubconDailyTicket[] = [
      {
        id: "t1",
        user_id: "u1",
        entry_date: "2026-06-05",
        subcontractor_id: "sub-1",
        subcon_name: "Alpha",
        install_tickets: 3,
        repair_tickets: 2,
        installation_rate: 1000,
        repair_rate: 500,
        created_at: "",
        updated_at: "",
      },
    ];
    const payments: PaymentReminder[] = [
      {
        id: "p1",
        user_id: "u1",
        title: "Alpha",
        type: "subcontractor",
        amount: 3500,
        due_date: "2026-06-15",
        status: "pending",
        notes: "June 2026 · 1st - 15th",
        subcontractor_id: "sub-1",
        billing_subcon_item_id: "item-1",
        billing_month: 6,
        billing_year: 2026,
        billing_period: "first_half",
        created_at: "",
        updated_at: "",
      },
      {
        id: "p2",
        user_id: "u1",
        title: "Alpha",
        type: "subcontractor",
        amount: 1200,
        due_date: "2026-06-30",
        status: "paid",
        notes: "June 2026 · 16th - End",
        subcontractor_id: "sub-1",
        billing_subcon_item_id: "item-2",
        billing_month: 6,
        billing_year: 2026,
        billing_period: "second_half",
        created_at: "",
        updated_at: "2026-06-29T00:00:00Z",
      },
    ];

    const summary = buildSubcontractorAccountSummary({
      subcontractor,
      billingRecords: [
        {
          billing_month: 6,
          billing_year: 2026,
          billing_period: "first_half",
          subcon_items: [
            {
              id: "item-1",
              user_id: "u1",
              billing_record_id: "bill-1",
              subcontractor_id: "sub-1",
              subcon_name: "Alpha",
              install_tickets: 3,
              repair_tickets: 2,
              disputed_install: 0,
              disputed_repair: 0,
              installation_rate: 1000,
              repair_rate: 500,
              billable_tickets: 5,
              billing_amount: 4000,
              payable_pct: 70,
              payable_amount: 2800,
              collection_amount: 1200,
              created_at: "",
            },
          ],
        },
      ],
      dailyTickets,
      payments,
      today: new Date("2026-06-10T00:00:00"),
    });

    expect(summary.ticketsThisPeriod).toBe(5);
    expect(summary.netPending).toBe(3500);
    expect(summary.paidThisMonth).toBe(1200);
    expect(summary.lastPayoutStatus).toBe("paid");
    expect(summary.billingRows).toHaveLength(1);
  });
});
