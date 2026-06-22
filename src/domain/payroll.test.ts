import { describe, expect, it } from "vitest";
import {
  payrollItemPayloadForEmployee,
  workingDaysInPeriod,
  attendanceTotalsForEmployee,
} from "./payroll";
import type { AttendanceEntry, DailyTicketEntry, Employee, Position } from "../types";

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
  status: "active",
  wage_category: "new",
  installation_rate: 600,
  repair_rate: 200,
  monthly_salary: 0,
  sss_number: "",
  philhealth_number: "",
  pagibig_number: "",
  tin_number: "",
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
  details: [
    {
      id: "detail-1",
      user_id: "user-1",
      daily_ticket_entry_id: "entry-1",
      position_ticket_category_id: "category-1",
      category_name: "Repair",
      ticket_count: 3,
      rate: 250,
      created_at: "2026-06-05T00:00:00Z",
      updated_at: "2026-06-05T00:00:00Z",
    },
  ],
  created_at: "2026-06-05T00:00:00Z",
  updated_at: "2026-06-05T00:00:00Z",
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
      display_order: 0,
      status: "active",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-06-10T00:00:00Z",
    }];
    const item = payrollItemPayloadForEmployee(employee, "run-1", "user-1", [ticketEntry], changedPosition);
    expect(item.ticket_pay).toBe(750);
    expect(item.ticket_details[0].rate).toBe(250);
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
    { id: "a1", user_id: "user-1", employee_id: "employee-1", employee_name: "Test", position_id: "position-1", position_name: "Guard", entry_date: "2026-06-01", status: "present", created_at: "", updated_at: "" },
    { id: "a2", user_id: "user-1", employee_id: "employee-1", employee_name: "Test", position_id: "position-1", position_name: "Guard", entry_date: "2026-06-02", status: "half_day", created_at: "", updated_at: "" },
    { id: "a3", user_id: "user-1", employee_id: "employee-1", employee_name: "Test", position_id: "position-1", position_name: "Guard", entry_date: "2026-06-03", status: "absent", created_at: "", updated_at: "" },
    { id: "a4", user_id: "user-1", employee_id: "employee-1", employee_name: "Test", position_id: "position-1", position_name: "Guard", entry_date: "2026-06-04", status: "present", created_at: "", updated_at: "" },
    { id: "a5", user_id: "user-1", employee_id: "other-emp", employee_name: "Other", position_id: "position-1", position_name: "Guard", entry_date: "2026-06-01", status: "present", created_at: "", updated_at: "" },
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
