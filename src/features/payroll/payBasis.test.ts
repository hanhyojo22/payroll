import { describe, expect, it } from "vitest";
import { payrollItemPayBasis } from "./payBasis";
import type { PayrollRunItem } from "../../types";

const item = (overrides: Partial<PayrollRunItem>): PayrollRunItem => ({
  id: "item-1",
  user_id: "user-1",
  payroll_run_id: "run-1",
  employee_id: "employee-1",
  employee_name: "Test Employee",
  position_id: null,
  position_name: "Technician",
  pay_mode: "ticket",
  base_pay: 0,
  ticket_pay: 750,
  daily_rate: 0,
  days_worked: 0,
  total_working_days: 0,
  ticket_details: [{
    id: "detail-1",
    user_id: "user-1",
    payroll_run_item_id: "item-1",
    position_ticket_category_id: "category-1",
    category_name: "Repair",
    ticket_count: 3,
    rate: 250,
    amount: 750,
    created_at: "2026-06-05T00:00:00Z",
  }],
  installation_tickets: 0,
  repair_tickets: 3,
  installation_rate: 0,
  repair_rate: 0,
  nap_rehab_tickets: 0,
  nap_rehab_rate: 0,
  gross_pay: 750,
  allowances: 0,
  deductions: 0,
  net_pay: 750,
  status: "pending",
  paid_date: null,
  notes: "",
  created_at: "2026-06-05T00:00:00Z",
  updated_at: "2026-06-05T00:00:00Z",
  ...overrides,
});

describe("payrollItemPayBasis", () => {
  it("describes a legacy payout by its ticket count, like a ticket position", () => {
    expect(payrollItemPayBasis(item({ pay_mode: "legacy" }))).toBe("3 tickets");
    expect(payrollItemPayBasis(item({ pay_mode: "ticket" }))).toBe("3 tickets");
  });

  it("describes daily and fixed payouts by their own basis", () => {
    expect(payrollItemPayBasis(item({ pay_mode: "daily", days_worked: 2.5, daily_rate: 800 })))
      .toContain("2.5 days");
    expect(payrollItemPayBasis(item({ pay_mode: "fixed", base_pay: 10_000 })))
      .toContain("Base");
  });

  it("falls back to a dash for an unrecognised pay mode", () => {
    expect(payrollItemPayBasis(item({ pay_mode: "unknown" as PayrollRunItem["pay_mode"] }))).toBe("-");
  });

  it("counts tickets from the flat columns when no ticket details were snapshotted", () => {
    expect(payrollItemPayBasis(item({ ticket_details: [], installation_tickets: 4, repair_tickets: 2 })))
      .toBe("6 tickets");
  });
});
