import { describe, expect, it } from "vitest";
import {
  buildSubcontractorAccountSummary,
  buildSubcontractorPaymentPayloads,
  buildSubcontractorPayoutArtifacts,
  computeBilling,
  computeClientBillingTotals,
  computeSubconItem,
  countSubconTickets,
  countTicketsByType,
  countTicketsForMonth,
  lastDayOfMonth,
} from "./billing";
import type { BillingSubconItem, DailyTicketEntry, PaymentReminder, PaymentReminderPayment, SubconDailyTicket, Subcontractor, SubcontractorAdvance } from "../types";

describe("computeClientBillingTotals", () => {
  it("deducts employee, subcontractor, and company disputes from the client invoice", () => {
    const result = computeClientBillingTotals(
      [
        { install: 5, repair: 3, napRehab: 2, disputedInstall: 1 },
        { install: 4, repair: 2, napRehab: 1, disputedRepair: 1, disputedNapRehab: 1 },
        { install: 2, repair: 1, napRehab: 0, disputedInstall: 1 },
      ],
      { installation: 600, repair: 200, napRehab: 300 },
      70,
    );

    expect(result.totalTickets).toBe(20);
    expect(result.disputedTickets).toBe(4);
    expect(result.billableTickets).toBe(16);
    expect(result.billingAmount).toBe(7_000);
    expect(result.collectionsAmount).toBe(4_900);
    expect(result.collectiblesAmount).toBe(2_100);
  });

  it("clamps disputes to their own source and ticket type", () => {
    const result = computeClientBillingTotals(
      [{ install: 1, repair: 2, napRehab: 0, disputedInstall: 10, disputedRepair: -2 }],
      { installation: 600, repair: 200, napRehab: 300 },
      150,
    );
    expect(result.disputedTickets).toBe(1);
    expect(result.billingAmount).toBe(400);
    expect(result.collectionsAmount).toBe(400);
  });
});

describe("countTicketsForMonth", () => {
  const entries: DailyTicketEntry[] = [
    {
      id: "e1", user_id: "u1", entry_date: "2026-06-05", employee_id: "emp1",
      employee_name: "Alice", position_id: "p1", position_name: "Tech",
      installation_tickets: 3, repair_tickets: 2, installation_rate: 600,
      repair_rate: 200, nap_rehab_tickets: 0, nap_rehab_rate: 0, created_at: "", updated_at: "",
      details: [
        { id: "d1", user_id: "u1", daily_ticket_entry_id: "e1", position_ticket_category_id: "c1", category_name: "Install", ticket_count: 4, rate: 600, ticket_type: "installation" as const, created_at: "", updated_at: "" },
        { id: "d2", user_id: "u1", daily_ticket_entry_id: "e1", position_ticket_category_id: "c2", category_name: "Repair", ticket_count: 2, rate: 200, ticket_type: "repair" as const, created_at: "", updated_at: "" },
      ],
    },
    {
      id: "e2", user_id: "u1", entry_date: "2026-06-12", employee_id: "emp2",
      employee_name: "Bob", position_id: null, position_name: "",
      installation_tickets: 5, repair_tickets: 1, installation_rate: 600,
      repair_rate: 200, nap_rehab_tickets: 0, nap_rehab_rate: 0, created_at: "", updated_at: "",
      details: [],
    },
    {
      id: "e3", user_id: "u1", entry_date: "2026-07-03", employee_id: "emp1",
      employee_name: "Alice", position_id: "p1", position_name: "Tech",
      installation_tickets: 10, repair_tickets: 5, installation_rate: 600,
      repair_rate: 200, nap_rehab_tickets: 0, nap_rehab_rate: 0, created_at: "", updated_at: "",
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

  it("subtracts disputed install and repair tickets from monthly totals", () => {
    const disputedEntries: DailyTicketEntry[] = [
      {
        ...entries[0],
        disputed_install: 1,
        disputed_repair: 1,
      },
      {
        ...entries[1],
        disputed_install: 2,
        disputed_repair: 0,
      },
    ];

    expect(countTicketsForMonth(disputedEntries, 6, 2026)).toBe(8);
    expect(countTicketsByType(disputedEntries, 6, 2026)).toEqual({
      installation: 6,
      repair: 2,
      nap_rehab: 0,
    });
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

describe("subcontractor Nap Rehab billing", () => {
  it("updates gross for the daily-entry case when a Nap Rehab rate is configured", () => {
    const result = computeSubconItem(
      0,
      0,
      0,
      0,
      1000,
      500,
      100,
      44,
      0,
      250,
    );

    expect(result.billableNapRehab).toBe(44);
    expect(result.billingAmount).toBe(11_000);
  });

  it("keeps gross unchanged when Nap Rehab rate is zero", () => {
    const result = computeSubconItem(0, 0, 0, 0, 1000, 500, 100, 44, 0, 0);

    expect(result.billableNapRehab).toBe(44);
    expect(result.billingAmount).toBe(0);
  });

  it("includes Nap Rehab tickets, disputes, and rate in the payout calculation", () => {
    const result = computeSubconItem(2, 1, 0, 0, 1000, 500, 30, 4, 1, 250);

    expect(result).toMatchObject({
      billableInstall: 2,
      billableRepair: 1,
      billableNapRehab: 3,
      billableTickets: 6,
      billingAmount: 3250,
      payableAmount: 975,
      collectionAmount: 2275,
    });
  });

  it("counts Nap Rehab daily tickets for the selected billing period", () => {
    const entries: SubconDailyTicket[] = [
      {
        id: "daily-1",
        user_id: "u1",
        entry_date: "2026-07-10",
        subcontractor_id: "sub-1",
        subcon_name: "Alpha",
        install_tickets: 1,
        repair_tickets: 2,
        nap_rehab_tickets: 3,
        installation_rate: 1000,
        repair_rate: 500,
        nap_rehab_rate: 250,
        created_at: "",
        updated_at: "",
      },
    ];

    expect(countSubconTickets(entries, "sub-1", 7, 2026, "first_half")).toEqual({
      install: 1,
      repair: 2,
      napRehab: 3,
    });
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
  it("creates two payout rows per subcontractor billing item -- payable and remainder, both owed to the subcontractor", () => {
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

    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toMatchObject({
      billing_subcon_item_id: "item-1",
      subcontractor_id: "sub-1",
      amount: 3500,
      status: "pending",
      type: "subcontractor",
      payout_leg: "payable",
    });
    expect(payloads[1]).toMatchObject({
      billing_subcon_item_id: "item-1",
      subcontractor_id: "sub-1",
      amount: 1500,
      status: "pending",
      type: "subcontractor",
      payout_leg: "remainder",
    });
  });

  it("skips a leg entirely when its gross amount is zero (e.g. payable_pct of 100)", () => {
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
        payable_pct: 100,
        payable_amount: 5000,
        collection_amount: 0,
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
    expect(payloads[0].payout_leg).toBe("payable");
  });

  it("preserves paid payout amounts when billing is recalculated", () => {
    const items: BillingSubconItem[] = [
      {
        id: "item-1",
        user_id: "u1",
        billing_record_id: "bill-1",
        subcontractor_id: "sub-1",
        subcon_name: "Alpha",
        install_tickets: 6,
        repair_tickets: 0,
        disputed_install: 0,
        disputed_repair: 0,
        installation_rate: 1000,
        repair_rate: 500,
        billable_tickets: 6,
        billing_amount: 6000,
        payable_pct: 70,
        payable_amount: 4200,
        collection_amount: 1800,
        created_at: "",
      },
    ];
    const existingPayments: PaymentReminder[] = [
      {
        id: "payment-1",
        user_id: "u1",
        title: "Alpha",
        type: "subcontractor",
        amount: 3500,
        due_date: "2026-06-15",
        status: "paid",
        notes: "",
        subcontractor_id: "sub-1",
        billing_subcon_item_id: "item-1",
        billing_month: 6,
        billing_year: 2026,
        billing_period: "first_half",
        payout_leg: "payable",
        created_at: "",
        updated_at: "",
        payments: [],
      },
    ];

    const payloads = buildSubcontractorPaymentPayloads({
      billingMonth: 6,
      billingYear: 2026,
      billingPeriod: "first_half",
      dueDate: "2026-06-15",
      items,
      existingPayments,
      userId: "u1",
      monthName: "June",
    });

    expect(payloads[0]).toMatchObject({
      id: "payment-1",
      amount: 3500,
      status: "paid",
      payout_leg: "payable",
    });
    // The remainder leg has no existing payment yet, so a new pending row is created for
    // its full gross amount (1800) -- the paid leg being preserved doesn't affect it.
    expect(payloads[1]).toMatchObject({
      amount: 1800,
      status: "pending",
      payout_leg: "remainder",
    });
  });

  it("deducts active subcontractor cash advances from new payouts", () => {
    const items: BillingSubconItem[] = [
      {
        id: "item-1",
        user_id: "u1",
        billing_record_id: "bill-1",
        subcontractor_id: "sub-1",
        subcon_name: "Alpha",
        install_tickets: 5,
        repair_tickets: 0,
        disputed_install: 0,
        disputed_repair: 0,
        installation_rate: 1000,
        repair_rate: 500,
        billable_tickets: 5,
        billing_amount: 5000,
        payable_pct: 70,
        payable_amount: 3500,
        collection_amount: 1500,
        created_at: "",
      },
    ];
    const advances: SubcontractorAdvance[] = [
      {
        id: "advance-1",
        user_id: "u1",
        subcontractor_id: "sub-1",
        subcon_name: "Alpha",
        advance_id: "SCA-1",
        date_granted: "2026-06-01",
        amount: 1000,
        balance: 1000,
        deduction_mode: "full_payout",
        deduction_per_billing: 0,
        status: "active",
        notes: "",
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "",
      },
    ];

    const result = buildSubcontractorPayoutArtifacts({
      billingMonth: 6,
      billingYear: 2026,
      billingPeriod: "first_half",
      dueDate: "2026-06-15",
      items,
      subcontractorAdvances: advances,
      userId: "u1",
      monthName: "June",
    });

    expect(result.payoutPayloads[0].amount).toBe(2500);
    expect(result.payoutPayloads[0].notes).toContain("Cash advance PHP 1000.00");
    // The advance's full balance (1000) is consumed by the payable leg alone, so the
    // remainder leg gets no further deduction -- its full gross amount is owed.
    expect(result.payoutPayloads[1].amount).toBe(1500);
    expect(result.advanceUpdates).toEqual([
      { id: "advance-1", payload: { balance: 0, status: "completed" } },
    ]);
  });

  it("caps cash advance deduction so payout never becomes negative", () => {
    const items: BillingSubconItem[] = [
      {
        id: "item-1",
        user_id: "u1",
        billing_record_id: "bill-1",
        subcontractor_id: "sub-1",
        subcon_name: "Alpha",
        install_tickets: 2,
        repair_tickets: 0,
        disputed_install: 0,
        disputed_repair: 0,
        installation_rate: 1000,
        repair_rate: 500,
        billable_tickets: 2,
        billing_amount: 2000,
        payable_pct: 70,
        payable_amount: 1400,
        collection_amount: 600,
        created_at: "",
      },
    ];
    const advances: SubcontractorAdvance[] = [
      {
        id: "advance-1",
        user_id: "u1",
        subcontractor_id: "sub-1",
        subcon_name: "Alpha",
        advance_id: "SCA-1",
        date_granted: "2026-06-01",
        amount: 5000,
        balance: 5000,
        deduction_mode: "full_payout",
        deduction_per_billing: 0,
        status: "active",
        notes: "",
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "",
      },
    ];

    const result = buildSubcontractorPayoutArtifacts({
      billingMonth: 6,
      billingYear: 2026,
      billingPeriod: "first_half",
      dueDate: "2026-06-15",
      items,
      subcontractorAdvances: advances,
      userId: "u1",
      monthName: "June",
    });

    // The advance deduction is now computed against BOTH legs' combined gross amount
    // (1400 + 600 = 2000), not just the payable leg, since the full amount belongs to
    // the subcontractor -- so it caps out at 0 for both legs, and the advance balance
    // drops by the full 2000 (5000 - 2000 = 3000), not just 1400.
    expect(result.payoutPayloads[0].amount).toBe(0);
    expect(result.payoutPayloads[1].amount).toBe(0);
    expect(result.advanceUpdates).toEqual([
      { id: "advance-1", payload: { balance: 3000, status: "active" } },
    ]);
  });

  it("uses fixed per-billing deduction when configured", () => {
    const items: BillingSubconItem[] = [
      {
        id: "item-1",
        user_id: "u1",
        billing_record_id: "bill-1",
        subcontractor_id: "sub-1",
        subcon_name: "Alpha",
        install_tickets: 5,
        repair_tickets: 0,
        disputed_install: 0,
        disputed_repair: 0,
        installation_rate: 1000,
        repair_rate: 500,
        billable_tickets: 5,
        billing_amount: 5000,
        payable_pct: 70,
        payable_amount: 3500,
        collection_amount: 1500,
        created_at: "",
      },
    ];
    const advances: SubcontractorAdvance[] = [
      {
        id: "advance-1",
        user_id: "u1",
        subcontractor_id: "sub-1",
        subcon_name: "Alpha",
        advance_id: "SCA-1",
        date_granted: "2026-06-01",
        amount: 5000,
        balance: 5000,
        deduction_mode: "per_billing",
        deduction_per_billing: 1000,
        status: "active",
        notes: "",
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "",
      },
    ];

    const result = buildSubcontractorPayoutArtifacts({
      billingMonth: 6,
      billingYear: 2026,
      billingPeriod: "first_half",
      dueDate: "2026-06-15",
      items,
      subcontractorAdvances: advances,
      userId: "u1",
      monthName: "June",
    });

    // The fixed 1000 per-billing deduction is applied ONCE per item (not once per leg),
    // fully consumed by the payable leg -- the remainder leg is untouched.
    expect(result.payoutPayloads[0].amount).toBe(2500);
    expect(result.payoutPayloads[1].amount).toBe(1500);
    expect(result.advanceUpdates).toEqual([
      { id: "advance-1", payload: { balance: 4000, status: "active" } },
    ]);
  });
});

describe("buildSubcontractorAccountSummary", () => {
  const subcontractor: Subcontractor = {
    id: "sub-1",
    user_id: "u1",
    name: "Alpha",
    installation_rate: 1000,
    repair_rate: 500,
    payable_pct: 70,
    status: "active",
    email: "",
    contact_number: "",
    address: "",
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

  it("computes pending, paid, and ticket totals for a subcontractor account", () => {
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
        payout_leg: "payable",
        created_at: "",
        updated_at: "",
        payments: [],
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
        payout_leg: "payable",
        created_at: "",
        updated_at: "2026-06-29T00:00:00Z",
        payments: [
          {
            id: "p2-pay-1",
            user_id: "u1",
            payment_reminder_id: "p2",
            amount: 1200,
            payment_date: "2026-06-29",
            payment_method: "cash",
            reference_number: "",
            notes: "",
            created_at: "2026-06-29T00:00:00Z",
          },
        ],
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

  it("counts a partial payment toward paidThisMonth and reduces netPending by only the amount paid", () => {
    const partiallyPaid: PaymentReminder = {
      id: "p3",
      user_id: "u1",
      title: "Alpha",
      type: "subcontractor",
      amount: 2000,
      due_date: "2026-06-30",
      status: "pending",
      notes: "June 2026 · 16th - End",
      subcontractor_id: "sub-1",
      billing_subcon_item_id: "item-3",
      billing_month: 6,
      billing_year: 2026,
      billing_period: "second_half",
      payout_leg: "payable",
      created_at: "",
      updated_at: "",
      payments: [
        {
          id: "p3-pay-1",
          user_id: "u1",
          payment_reminder_id: "p3",
          amount: 800,
          payment_date: "2026-06-20",
          payment_method: "cash",
          reference_number: "",
          notes: "",
          created_at: "2026-06-20T00:00:00Z",
        },
      ],
    };

    const summary = buildSubcontractorAccountSummary({
      subcontractor,
      billingRecords: [],
      dailyTickets: [],
      payments: [partiallyPaid],
      today: new Date("2026-06-25T00:00:00"),
    });

    expect(summary.netPending).toBe(1200);
    expect(summary.paidThisMonth).toBe(800);
    expect(summary.lastPayoutStatus).toBe("partial");
  });

  it("does not throw when a payment reminder is missing its payments array (e.g. stale offline cache predating this feature)", () => {
    const staleCachedPayment = {
      id: "p4",
      user_id: "u1",
      title: "Alpha",
      type: "subcontractor",
      amount: 1000,
      due_date: "2026-06-30",
      status: "pending",
      notes: "",
      subcontractor_id: "sub-1",
      billing_subcon_item_id: "item-4",
      billing_month: 6,
      billing_year: 2026,
      billing_period: "second_half",
      created_at: "",
      updated_at: "",
    } as unknown as PaymentReminder;

    expect(() => buildSubcontractorAccountSummary({
      subcontractor,
      billingRecords: [],
      dailyTickets: [],
      payments: [staleCachedPayment],
      today: new Date("2026-06-25T00:00:00"),
    })).not.toThrow();
  });
});
