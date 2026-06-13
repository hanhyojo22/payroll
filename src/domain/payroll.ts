import type { DailyTicketEntry, Employee, PayrollPayPeriod, PayrollRun, PayrollRunItem } from "../types";
import {
  employeeInstallationRate,
  employeeRepairRate,
  normalizeTicketCount,
  ticketGrossPay,
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

export function dailyTicketTotalsForEmployee(entries: DailyTicketEntry[], employee: Employee) {
  const employeeEntries = entries.filter((entry) => entry.employee_id === employee.id);
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
  };
}

export function payrollItemPayloadForEmployee(
  employee: Employee,
  payrollRunId: string,
  userId: string,
  dailyTicketEntries: DailyTicketEntry[] = [],
): Omit<PayrollRunItem, "id" | "created_at" | "updated_at"> {
  const installationRate = employeeInstallationRate(employee);
  const repairRate = employeeRepairRate(employee);
  const dailyTotals = dailyTicketTotalsForEmployee(dailyTicketEntries, employee);
  const gross = dailyTotals.gross || ticketGrossPay(
    dailyTotals.installationTickets,
    dailyTotals.repairTickets,
    installationRate,
    repairRate,
  );

  return {
    user_id: userId,
    payroll_run_id: payrollRunId,
    employee_id: employee.id,
    employee_name: employee.full_name,
    installation_tickets: dailyTotals.installationTickets,
    repair_tickets: dailyTotals.repairTickets,
    installation_rate: installationRate,
    repair_rate: repairRate,
    gross_pay: gross,
    allowances: 0,
    deductions: 0,
    net_pay: gross,
    status: "pending",
    paid_date: null,
    notes: "",
  };
}
