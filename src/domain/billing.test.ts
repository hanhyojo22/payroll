import { describe, expect, it } from "vitest";
import { computeBilling, countTicketsForMonth, lastDayOfMonth } from "./billing";
import type { DailyTicketEntry } from "../types";

describe("countTicketsForMonth", () => {
  const entries: DailyTicketEntry[] = [
    {
      id: "e1", user_id: "u1", entry_date: "2026-06-05", employee_id: "emp1",
      employee_name: "Alice", position_id: "p1", position_name: "Tech",
      installation_tickets: 3, repair_tickets: 2, installation_rate: 600,
      repair_rate: 200, created_at: "", updated_at: "",
      details: [
        { id: "d1", user_id: "u1", daily_ticket_entry_id: "e1", position_ticket_category_id: "c1", category_name: "Install", ticket_count: 4, rate: 600, created_at: "", updated_at: "" },
        { id: "d2", user_id: "u1", daily_ticket_entry_id: "e1", position_ticket_category_id: "c2", category_name: "Repair", ticket_count: 2, rate: 200, created_at: "", updated_at: "" },
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
