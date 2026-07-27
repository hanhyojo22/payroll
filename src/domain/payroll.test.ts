import { describe, expect, it } from "vitest";
import {
  dailyTicketTotalsForEmployee,
  governmentDeductionForEmployee,
  payrollExpensePayload,
  payrollItemPayloadForEmployee,
  payrollItemPayBasis,
  workingDaysInPeriod,
  attendanceTotalsForEmployee,
} from "./payroll";
import type { AttendanceEntry, DailyTicketEntry, Employee, PayrollSettings, Position } from "../types";

const employee: Employee = {
  id: "employee-1",
  user_id: "user-1",
  full_name: "Test Employee",
  role: "Technician",
  position_id: "position-1",
  department: "Operations",
  contact_number: "",
  email: "",
  address: "",
  profile_photo_url: "",
  hire_date: "2026-01-01",
  date_of_birth: "",
  status: "active",
  wage_category: "new",
  gender: "",
  civil_status: "",
  installation_rate: 600,
  repair_rate: 200,
  monthly_salary: 0,
  sss_number: "",
  philhealth_number: "",
  pagibig_number: "",
  sss_deduction: 0,
  philhealth_deduction: 0,
  pagibig_deduction: 0,
  withholding_tax: 0,
  tin_number: "",
  emergency_contact_name: "",
  emergency_contact_number: "",
  emergency_contact_relation: "",
  notes: "",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function position(payMode: Position["pay_mode"], monthlyBaseSalary = 0): Position {
  return {
    id: "position-1",
    user_id: "user-1",
    name: "Technician",
    department: "Operations",
    description: "",
    status: "active",
    pay_mode: payMode,
    monthly_base_salary: monthlyBaseSalary,
    daily_rate: 0,
    categories: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

const ticketEntry: DailyTicketEntry = {
  id: "entry-1",
  user_id: "user-1",
  entry_date: "2026-06-05",
  employee_id: employee.id,
  employee_name: employee.full_name,
  position_id: "position-1",
  position_name: "Technician",
  installation_tickets: 0,
  repair_tickets: 0,
  installation_rate: 0,
  repair_rate: 0,
  nap_rehab_tickets: 0,
  nap_rehab_rate: 0,
  details: [
    {
      id: "detail-1",
      user_id: "user-1",
      daily_ticket_entry_id: "entry-1",
      position_ticket_category_id: "category-1",
      category_name: "Repair",
      ticket_count: 3,
      rate: 250,
      ticket_type: "repair" as const,
      created_at: "2026-06-05T00:00:00Z",
      updated_at: "2026-06-05T00:00:00Z",
    },
  ],
  created_at: "2026-06-05T00:00:00Z",
  updated_at: "2026-06-05T00:00:00Z",
};

const payrollSettings: PayrollSettings = {
  id: "settings-1",
  user_id: "user-1",
  government_deduction_enabled: true,
  government_deduction_cutoff: "second_half",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("position-based payroll", () => {
  it("splits a fixed monthly salary equally across the two payroll periods", () => {
    const item = payrollItemPayloadForEmployee(employee, "run-1", "user-1", [ticketEntry], position("fixed", 20_000));
    expect(item.base_pay).toBe(10_000);
    expect(item.ticket_pay).toBe(0);
    expect(item.gross_pay).toBe(10_000);
  });

  it("pays a ticket-only position from saved category counts and rates", () => {
    const item = payrollItemPayloadForEmployee(employee, "run-1", "user-1", [ticketEntry], position("ticket"));
    expect(item.base_pay).toBe(0);
    expect(item.ticket_pay).toBe(750);
    expect(item.gross_pay).toBe(750);
    expect(item.ticket_details[0]).toMatchObject({ category_name: "Repair", ticket_count: 3, rate: 250, amount: 750 });
  });

  // payroll_run_items keeps its own pay_mode column so historical rows stay readable after a
  // position changes. Stamping "ticket" on an employee who had no position makes a legacy
  // rate-column payout indistinguishable from a real ticket position in payroll history.
  it("stamps an employee with no position as legacy rather than ticket", () => {
    const item = payrollItemPayloadForEmployee(employee, "run-1", "user-1", [ticketEntry]);
    expect(item.pay_mode).toBe("legacy");
    expect(item.base_pay).toBe(0);
    expect(item.ticket_pay).toBe(750);
    expect(item.gross_pay).toBe(750);
  });

  it("keeps stamping ticket when the employee actually holds a ticket position", () => {
    const item = payrollItemPayloadForEmployee(employee, "run-1", "user-1", [ticketEntry], position("ticket"));
    expect(item.pay_mode).toBe("ticket");
  });

  describe("pay basis description", () => {
    const item = (overrides: Partial<ReturnType<typeof payrollItemPayloadForEmployee>>) =>
      ({ ...payrollItemPayloadForEmployee(employee, "run-1", "user-1", [ticketEntry]), ...overrides }) as never;

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
  });

  it("combines half-month base pay and ticket earnings for hybrid positions", () => {
    const item = payrollItemPayloadForEmployee(employee, "run-1", "user-1", [ticketEntry], position("hybrid", 20_000));
    expect(item.base_pay).toBe(10_000);
    expect(item.ticket_pay).toBe(750);
    expect(item.gross_pay).toBe(10_750);
  });

  it("uses the daily entry rate snapshot rather than a position's later category rate", () => {
    const changedPosition = position("ticket");
    changedPosition.categories = [{
      id: "category-1",
      user_id: "user-1",
      position_id: "position-1",
      name: "Repair",
      rate: 999,
      ticket_type: "repair" as const,
      display_order: 0,
      status: "active",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-06-10T00:00:00Z",
    }];
    const item = payrollItemPayloadForEmployee(employee, "run-1", "user-1", [ticketEntry], changedPosition);
    expect(item.ticket_pay).toBe(750);
    expect(item.ticket_details[0].rate).toBe(250);
  });

  it("reduces detail-based payroll totals by disputed install and repair tickets, counting nap rehab tickets undisputed", () => {
    const disputedEntry: DailyTicketEntry = {
      ...ticketEntry,
      disputed_install: 1,
      disputed_repair: 1,
      details: [
        {
          id: "detail-install",
          user_id: "user-1",
          daily_ticket_entry_id: "entry-1",
          position_ticket_category_id: "category-install",
          category_name: "Install",
          ticket_count: 2,
          rate: 600,
          ticket_type: "installation",
          created_at: "2026-06-05T00:00:00Z",
          updated_at: "2026-06-05T00:00:00Z",
        },
        {
          id: "detail-repair",
          user_id: "user-1",
          daily_ticket_entry_id: "entry-1",
          position_ticket_category_id: "category-repair",
          category_name: "Repair",
          ticket_count: 3,
          rate: 250,
          ticket_type: "repair",
          created_at: "2026-06-05T00:00:00Z",
          updated_at: "2026-06-05T00:00:00Z",
        },
        {
          id: "detail-nap-rehab",
          user_id: "user-1",
          daily_ticket_entry_id: "entry-1",
          position_ticket_category_id: "category-nap-rehab",
          category_name: "Nap Rehab",
          ticket_count: 4,
          rate: 300,
          ticket_type: "nap_rehab",
          created_at: "2026-06-05T00:00:00Z",
          updated_at: "2026-06-05T00:00:00Z",
        },
      ],
    };

    const totals = dailyTicketTotalsForEmployee([disputedEntry], employee);
    expect(totals.installationTickets).toBe(1);
    expect(totals.repairTickets).toBe(2);
    expect(totals.napRehabTickets).toBe(4);
    expect(totals.gross).toBe(2_300);

    const item = payrollItemPayloadForEmployee(employee, "run-1", "user-1", [disputedEntry], position("ticket"));
    expect(item.ticket_pay).toBe(2_300);
    expect(item.installation_tickets).toBe(1);
    expect(item.repair_tickets).toBe(2);
    expect(item.nap_rehab_tickets).toBe(4);
  });

  it("reduces legacy header-based payroll totals by disputed install and repair tickets, counting nap rehab tickets undisputed", () => {
    const legacyEntry: DailyTicketEntry = {
      ...ticketEntry,
      details: [],
      installation_tickets: 4,
      repair_tickets: 3,
      disputed_install: 2,
      disputed_repair: 1,
      installation_rate: 600,
      repair_rate: 200,
      nap_rehab_tickets: 5,
      nap_rehab_rate: 300,
    };

    const item = payrollItemPayloadForEmployee(employee, "run-1", "user-1", [legacyEntry], position("ticket"));
    expect(item.ticket_pay).toBe(3_100);
    expect(item.installation_tickets).toBe(2);
    expect(item.repair_tickets).toBe(2);
    expect(item.nap_rehab_tickets).toBe(5);
  });
});

describe("government deductions", () => {
  it("returns zero when the cutoff does not match the payroll period", () => {
    expect(governmentDeductionForEmployee(employee, payrollSettings, "first_half")).toBe(0);
  });

  it("sums the employee statutory deductions when the cutoff matches", () => {
    const configuredEmployee = {
      ...employee,
      sss_deduction: 500,
      philhealth_deduction: 250,
      pagibig_deduction: 100,
      withholding_tax: 300,
    };
    expect(governmentDeductionForEmployee(configuredEmployee, payrollSettings, "second_half")).toBe(1_150);
  });

  it("returns zero when government deductions are disabled, even on a matching cutoff", () => {
    const configuredEmployee = { ...employee, sss_deduction: 500 };
    const disabledSettings = { ...payrollSettings, government_deduction_enabled: false };
    expect(governmentDeductionForEmployee(configuredEmployee, disabledSettings, "second_half")).toBe(0);
  });
});

describe("attendance-based daily wage", () => {
  it("counts Mon–Sat working days for first half of June 2026", () => {
    // June 2026: 1=Mon,2=Tue,...,6=Sat,7=Sun,...,13=Sat,14=Sun,15=Mon
    // Working days (Mon–Sat): 1,2,3,4,5,6, 8,9,10,11,12,13, 15 = 13 days
    expect(workingDaysInPeriod(6, 2026, "first_half")).toBe(13);
  });

  it("counts Mon–Sat working days for second half of June 2026", () => {
    // June 2026 days 16–30: 16=Tue,...,20=Sat,21=Sun,...,27=Sat,28=Sun,29=Mon,30=Tue
    // Working days: 16,17,18,19,20, 22,23,24,25,26,27, 29,30 = 13 days
    expect(workingDaysInPeriod(6, 2026, "second_half")).toBe(13);
  });

  it("handles February in a non-leap year", () => {
    // Feb 2025: 1=Sat,...,15=Sat. Working days in first half:
    // 1(Sat),3,4,5,6,7,8(Sat),10,11,12,13,14,15(Sat) = 13 days
    expect(workingDaysInPeriod(2, 2025, "first_half")).toBe(13);
    // Feb 2025 second half: 16=Sun,17–22(Mon–Sat=6),23=Sun,24–28(Mon–Fri=5) = 11
    expect(workingDaysInPeriod(2, 2025, "second_half")).toBe(11);
  });

  const attendanceEntries: AttendanceEntry[] = [
    { id: "a1", user_id: "user-1", employee_id: "employee-1", employee_name: "Test", position_id: "position-1", position_name: "Guard", entry_date: "2026-06-01", status: "present", time_in: "08:00", time_out: "17:00", created_at: "", updated_at: "" },
    { id: "a2", user_id: "user-1", employee_id: "employee-1", employee_name: "Test", position_id: "position-1", position_name: "Guard", entry_date: "2026-06-02", status: "half_day", time_in: "08:00", time_out: "17:00", created_at: "", updated_at: "" },
    { id: "a3", user_id: "user-1", employee_id: "employee-1", employee_name: "Test", position_id: "position-1", position_name: "Guard", entry_date: "2026-06-03", status: "absent", time_in: null, time_out: null, created_at: "", updated_at: "" },
    { id: "a4", user_id: "user-1", employee_id: "employee-1", employee_name: "Test", position_id: "position-1", position_name: "Guard", entry_date: "2026-06-04", status: "present", time_in: "08:00", time_out: "17:00", created_at: "", updated_at: "" },
    { id: "a5", user_id: "user-1", employee_id: "other-emp", employee_name: "Other", position_id: "position-1", position_name: "Guard", entry_date: "2026-06-01", status: "present", time_in: "08:00", time_out: "17:00", created_at: "", updated_at: "" },
  ];

  it("computes attendance totals for an employee in a payroll period", () => {
    const totals = attendanceTotalsForEmployee(attendanceEntries, "employee-1", 6, 2026, "first_half");
    expect(totals.presentDays).toBe(2);
    expect(totals.halfDays).toBe(1);
    expect(totals.absentDays).toBe(1);
    expect(totals.effectiveDays).toBe(2.5);
    expect(totals.totalWorkingDays).toBe(13);
  });

  it("excludes entries from other employees", () => {
    const totals = attendanceTotalsForEmployee(attendanceEntries, "other-emp", 6, 2026, "first_half");
    expect(totals.presentDays).toBe(1);
    expect(totals.halfDays).toBe(0);
    expect(totals.effectiveDays).toBe(1);
  });

  it("returns zero totals when no entries exist for the period", () => {
    const totals = attendanceTotalsForEmployee(attendanceEntries, "employee-1", 7, 2026, "first_half");
    expect(totals.presentDays).toBe(0);
    expect(totals.effectiveDays).toBe(0);
  });

  function dailyPosition(dailyRate: number): Position {
    return {
      id: "position-1",
      user_id: "user-1",
      name: "Guard",
      department: "Security",
      description: "",
      status: "active",
      pay_mode: "daily",
      monthly_base_salary: 0,
      daily_rate: dailyRate,
      categories: [],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
  }

  it("computes daily wage payroll from attendance entries", () => {
    // 2 present + 1 half_day = 2.5 effective days × 800 = 2000
    const item = payrollItemPayloadForEmployee(
      employee, "run-1", "user-1", [], dailyPosition(800), attendanceEntries, 6, 2026, "first_half",
    );
    expect(item.pay_mode).toBe("daily");
    expect(item.daily_rate).toBe(800);
    expect(item.days_worked).toBe(2.5);
    expect(item.total_working_days).toBe(13);
    expect(item.base_pay).toBe(2000);
    expect(item.ticket_pay).toBe(0);
    expect(item.gross_pay).toBe(2000);
    expect(item.net_pay).toBe(2000);
  });

  it("produces zero pay when no attendance entries exist for daily employee", () => {
    const item = payrollItemPayloadForEmployee(
      employee, "run-1", "user-1", [], dailyPosition(800), [], 6, 2026, "first_half",
    );
    expect(item.days_worked).toBe(0);
    expect(item.gross_pay).toBe(0);
  });
});

describe("payrollExpensePayload", () => {
  const run = {
    id: "run-1",
    period_month: 7,
    period_year: 2026,
    pay_period: "first_half" as const,
    generated_date: "2026-07-01",
  };

  it("sums net_pay across all items", () => {
    const items = [
      { net_pay: 5000, status: "pending" as const, paid_date: null },
      { net_pay: 3500, status: "pending" as const, paid_date: null },
    ];
    const payload = payrollExpensePayload(run, items, "category-1", "user-1");
    expect(payload.amount).toBe(8500);
  });

  it("is pending when any item is unpaid", () => {
    const items = [
      { net_pay: 5000, status: "paid" as const, paid_date: "2026-07-05" },
      { net_pay: 3500, status: "pending" as const, paid_date: null },
    ];
    const payload = payrollExpensePayload(run, items, "category-1", "user-1");
    expect(payload.status).toBe("pending");
    expect(payload.paid_date).toBeNull();
  });

  it("is paid with the latest paid_date only when every item is paid", () => {
    const items = [
      { net_pay: 5000, status: "paid" as const, paid_date: "2026-07-05" },
      { net_pay: 3500, status: "paid" as const, paid_date: "2026-07-07" },
    ];
    const payload = payrollExpensePayload(run, items, "category-1", "user-1");
    expect(payload.status).toBe("paid");
    expect(payload.paid_date).toBe("2026-07-07");
  });

  it("defaults to pending with zero amount when there are no items", () => {
    const payload = payrollExpensePayload(run, [], "category-1", "user-1");
    expect(payload.status).toBe("pending");
    expect(payload.amount).toBe(0);
    expect(payload.paid_date).toBeNull();
  });

  it("labels the category, employee_name period, and links the run id", () => {
    const payload = payrollExpensePayload(run, [], "category-1", "user-1");
    expect(payload.category_id).toBe("category-1");
    expect(payload.category_name).toBe("Payroll");
    expect(payload.employee_name).toBe("July 2026 – 1st Cutoff");
    expect(payload.id).toBe("run-1");
    expect(payload.payroll_run_id).toBe("run-1");
    expect(payload.user_id).toBe("user-1");
  });

  it("uses '2nd Cutoff' label for second_half runs", () => {
    const secondHalfRun = { ...run, pay_period: "second_half" as const };
    const payload = payrollExpensePayload(secondHalfRun, [], "category-1", "user-1");
    expect(payload.employee_name).toBe("July 2026 – 2nd Cutoff");
  });
});
