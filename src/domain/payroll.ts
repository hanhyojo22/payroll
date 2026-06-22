import type { AttendanceEntry, DailyTicketEntry, Employee, PayrollPayPeriod, PayrollRun, PayrollRunItem, Position } from "../types";
import {
  normalizeTicketCount,
  toNumber,
} from "./tickets";

export const payPeriodLabel = (payPeriod: PayrollRun["pay_period"]) =>
  payPeriod === "first_half" ? "First half" : "Second half";

export function dailyTicketEntriesForPayrollPeriod(
  entries: DailyTicketEntry[],
  periodMonth: number,
  periodYear: number,
  payPeriod: PayrollPayPeriod,
) {
  return entries.filter((entry) => {
    const [entryYear, entryMonth, entryDay] = entry.entry_date.split("-").map(Number);
    const matchesMonth = entryYear === periodYear && entryMonth === periodMonth;
    const matchesHalf = payPeriod === "first_half" ? entryDay >= 1 && entryDay <= 15 : entryDay >= 16;
    return matchesMonth && matchesHalf;
  });
}

export function workingDaysInPeriod(
  periodMonth: number,
  periodYear: number,
  payPeriod: PayrollPayPeriod,
): number {
  const startDay = payPeriod === "first_half" ? 1 : 16;
  const lastDayOfMonth = new Date(periodYear, periodMonth, 0).getDate();
  const endDay = payPeriod === "first_half" ? 15 : lastDayOfMonth;
  let count = 0;
  for (let day = startDay; day <= endDay; day++) {
    const dayOfWeek = new Date(periodYear, periodMonth - 1, day).getDay();
    if (dayOfWeek !== 0) count++;
  }
  return count;
}

export function attendanceTotalsForEmployee(
  entries: AttendanceEntry[],
  employeeId: string,
  periodMonth: number,
  periodYear: number,
  payPeriod: PayrollPayPeriod,
) {
  const periodEntries = entries.filter((entry) => {
    if (entry.employee_id !== employeeId) return false;
    const [entryYear, entryMonth, entryDay] = entry.entry_date.split("-").map(Number);
    const matchesMonth = entryYear === periodYear && entryMonth === periodMonth;
    const matchesHalf = payPeriod === "first_half" ? entryDay >= 1 && entryDay <= 15 : entryDay >= 16;
    return matchesMonth && matchesHalf;
  });
  const presentDays = periodEntries.filter((e) => e.status === "present").length;
  const halfDays = periodEntries.filter((e) => e.status === "half_day").length;
  const absentDays = periodEntries.filter((e) => e.status === "absent").length;
  return {
    presentDays,
    halfDays,
    absentDays,
    effectiveDays: presentDays + 0.5 * halfDays,
    totalWorkingDays: workingDaysInPeriod(periodMonth, periodYear, payPeriod),
  };
}

export function dailyTicketTotalsForEmployee(entries: DailyTicketEntry[], employee: Employee) {
  const employeeEntries = entries.filter((entry) => entry.employee_id === employee.id);
  const normalizedDetails = employeeEntries.flatMap((entry) => entry.details ?? []);
  if (normalizedDetails.length > 0) {
    const grouped = new Map<string, {
      position_ticket_category_id: string | null;
      category_name: string;
      ticket_count: number;
      rate: number;
    }>();
    normalizedDetails.forEach((detail) => {
      const key = `${detail.position_ticket_category_id ?? detail.category_name}:${toNumber(detail.rate)}`;
      const current = grouped.get(key);
      grouped.set(key, {
        position_ticket_category_id: detail.position_ticket_category_id,
        category_name: detail.category_name,
        ticket_count: (current?.ticket_count ?? 0) + normalizeTicketCount(detail.ticket_count),
        rate: toNumber(detail.rate),
      });
    });
    const details = Array.from(grouped.values()).map((detail) => ({
      ...detail,
      amount: detail.ticket_count * detail.rate,
    }));
    return {
      gross: details.reduce((sum, detail) => sum + detail.amount, 0),
      installationTickets: 0,
      repairTickets: 0,
      details,
    };
  }
  const installationTickets = employeeEntries.reduce((sum, entry) => sum + normalizeTicketCount(entry.installation_tickets), 0);
  const repairTickets = employeeEntries.reduce((sum, entry) => sum + normalizeTicketCount(entry.repair_tickets), 0);
  const installationGross = employeeEntries.reduce(
    (sum, entry) => sum + normalizeTicketCount(entry.installation_tickets) * toNumber(entry.installation_rate),
    0,
  );
  const repairGross = employeeEntries.reduce(
    (sum, entry) => sum + normalizeTicketCount(entry.repair_tickets) * toNumber(entry.repair_rate),
    0,
  );

  return {
    gross: installationGross + repairGross,
    installationTickets,
    repairTickets,
    details: [
      ...(installationTickets > 0 ? [{
        position_ticket_category_id: null,
        category_name: "Installation",
        ticket_count: installationTickets,
        rate: installationTickets > 0 ? installationGross / installationTickets : 0,
        amount: installationGross,
      }] : []),
      ...(repairTickets > 0 ? [{
        position_ticket_category_id: null,
        category_name: "Repair",
        ticket_count: repairTickets,
        rate: repairTickets > 0 ? repairGross / repairTickets : 0,
        amount: repairGross,
      }] : []),
    ],
  };
}

export function payrollItemPayloadForEmployee(
  employee: Employee,
  payrollRunId: string,
  userId: string,
  dailyTicketEntries: DailyTicketEntry[] = [],
  position?: Position,
  attendanceEntries: AttendanceEntry[] = [],
  periodMonth = 0,
  periodYear = 0,
  payPeriod: PayrollPayPeriod = "first_half",
): Omit<PayrollRunItem, "id" | "created_at" | "updated_at"> {
  const dailyTotals = dailyTicketTotalsForEmployee(dailyTicketEntries, employee);
  const payMode = position?.pay_mode ?? "ticket";
  let basePay: number;
  let ticketPay: number;
  let dailyRate = 0;
  let daysWorked = 0;
  let totalWorkingDays = 0;

  if (payMode === "daily") {
    dailyRate = toNumber(position?.daily_rate);
    const totals = attendanceTotalsForEmployee(attendanceEntries, employee.id, periodMonth, periodYear, payPeriod);
    daysWorked = totals.effectiveDays;
    totalWorkingDays = totals.totalWorkingDays;
    basePay = dailyRate * daysWorked;
    ticketPay = 0;
  } else {
    basePay = payMode === "fixed" || payMode === "hybrid"
      ? toNumber(position?.monthly_base_salary) / 2
      : 0;
    ticketPay = payMode === "fixed" ? 0 : dailyTotals.gross;
  }
  const gross = basePay + ticketPay;

  return {
    user_id: userId,
    payroll_run_id: payrollRunId,
    employee_id: employee.id,
    employee_name: employee.full_name,
    position_id: position?.id ?? employee.position_id ?? null,
    position_name: position?.name ?? employee.role ?? "—",
    pay_mode: payMode,
    base_pay: basePay,
    ticket_pay: ticketPay,
    daily_rate: dailyRate,
    days_worked: daysWorked,
    total_working_days: totalWorkingDays,
    ticket_details: dailyTotals.details.map((detail) => ({
      id: "",
      user_id: userId,
      payroll_run_item_id: "",
      ...detail,
      created_at: "",
    })),
    installation_tickets: dailyTotals.installationTickets,
    repair_tickets: dailyTotals.repairTickets,
    installation_rate: 0,
    repair_rate: 0,
    gross_pay: gross,
    allowances: 0,
    deductions: 0,
    net_pay: gross,
    status: "pending",
    paid_date: null,
    notes: "",
  };
}
