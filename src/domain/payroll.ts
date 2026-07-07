import type { AttendanceEntry, DailyTicketEntry, Employee, Expense, PayrollPayPeriod, PayrollRun, PayrollRunItem, PayrollSettings, Position } from "../types";
import {
  normalizeTicketCount,
  toNumber,
} from "./tickets";
import { monthNames } from "../shared/utils/dates";

export const payPeriodLabel = (payPeriod: PayrollRun["pay_period"]) =>
  payPeriod === "first_half" ? "First half" : "Second half";

export function governmentDeductionForEmployee(
  employee: Employee,
  payrollSettings: PayrollSettings | null,
  payPeriod: PayrollPayPeriod,
) {
  if (
    !payrollSettings ||
    !payrollSettings.government_deduction_enabled ||
    payrollSettings.government_deduction_cutoff !== payPeriod
  ) {
    return 0;
  }

  return (
    toNumber(employee.sss_deduction) +
    toNumber(employee.philhealth_deduction) +
    toNumber(employee.pagibig_deduction) +
    toNumber(employee.withholding_tax)
  );
}

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

function clampDisputedCount(total: number, disputed: number) {
  return Math.min(total, Math.max(0, normalizeTicketCount(disputed)));
}

function distributeRemainingCounts<T extends { ticket_count: number }>(
  details: T[],
  disputedCount: number,
) {
  const total = details.reduce((sum, detail) => sum + normalizeTicketCount(detail.ticket_count), 0);
  const clampedDisputed = clampDisputedCount(total, disputedCount);
  const targetRemaining = total - clampedDisputed;
  if (targetRemaining <= 0) {
    return details.map((detail) => ({ ...detail, remainingCount: 0 }));
  }
  if (targetRemaining >= total) {
    return details.map((detail) => ({ ...detail, remainingCount: normalizeTicketCount(detail.ticket_count) }));
  }

  const scaled = details.map((detail, index) => {
    const originalCount = normalizeTicketCount(detail.ticket_count);
    const exact = originalCount * targetRemaining / total;
    const remainingCount = Math.floor(exact);
    return { detail, index, originalCount, exact, remainingCount, fraction: exact - remainingCount };
  });

  let remainder = targetRemaining - scaled.reduce((sum, item) => sum + item.remainingCount, 0);
  scaled
    .slice()
    .sort((a, b) => {
      if (b.fraction !== a.fraction) return b.fraction - a.fraction;
      return a.index - b.index;
    })
    .forEach((item) => {
      if (remainder <= 0) return;
      if (item.remainingCount < item.originalCount) {
        item.remainingCount += 1;
        remainder -= 1;
      }
    });

  return scaled
    .sort((a, b) => a.index - b.index)
    .map((item) => ({ ...item.detail, remainingCount: item.remainingCount }));
}

export function dailyTicketTotalsForEmployee(entries: DailyTicketEntry[], employee: Employee) {
  const employeeEntries = entries.filter((entry) => entry.employee_id === employee.id);
  const normalizedDetails = employeeEntries.flatMap((entry) => {
    const details = entry.details ?? [];
    if (details.length === 0) return [];

    const installationDetails = details.filter((detail) => (detail.ticket_type ?? "installation") === "installation");
    const repairDetails = details.filter((detail) => detail.ticket_type === "repair");
    const adjustedInstallation = distributeRemainingCounts(installationDetails, entry.disputed_install ?? 0);
    const adjustedRepair = distributeRemainingCounts(repairDetails, entry.disputed_repair ?? 0);

    return [...adjustedInstallation, ...adjustedRepair]
      .filter((detail) => detail.remainingCount > 0)
      .map((detail) => ({
        ...detail,
        ticket_count: detail.remainingCount,
      }));
  });
  if (normalizedDetails.length > 0) {
    const grouped = new Map<string, {
      position_ticket_category_id: string | null;
      category_name: string;
      ticket_count: number;
      rate: number;
      ticket_type?: "installation" | "repair";
    }>();
    normalizedDetails.forEach((detail) => {
      const key = `${detail.position_ticket_category_id ?? detail.category_name}:${toNumber(detail.rate)}`;
      const current = grouped.get(key);
      grouped.set(key, {
        position_ticket_category_id: detail.position_ticket_category_id,
        category_name: detail.category_name,
        ticket_count: (current?.ticket_count ?? 0) + normalizeTicketCount(detail.ticket_count),
        rate: toNumber(detail.rate),
        ticket_type: detail.ticket_type,
      });
    });
    const details = Array.from(grouped.values()).map((detail) => ({
      ...detail,
      amount: detail.ticket_count * detail.rate,
    }));
    const installationTickets = details
      .filter((detail) => (detail.ticket_type ?? "installation") === "installation")
      .reduce((sum, detail) => sum + detail.ticket_count, 0);
    const repairTickets = details
      .filter((detail) => detail.ticket_type === "repair")
      .reduce((sum, detail) => sum + detail.ticket_count, 0);
    return {
      gross: details.reduce((sum, detail) => sum + detail.amount, 0),
      installationTickets,
      repairTickets,
      details: details.map(({ ticket_type: _ticketType, ...detail }) => detail),
    };
  }
  const installationTickets = employeeEntries.reduce(
    (sum, entry) => sum + Math.max(0, normalizeTicketCount(entry.installation_tickets) - clampDisputedCount(entry.installation_tickets, entry.disputed_install ?? 0)),
    0,
  );
  const repairTickets = employeeEntries.reduce(
    (sum, entry) => sum + Math.max(0, normalizeTicketCount(entry.repair_tickets) - clampDisputedCount(entry.repair_tickets, entry.disputed_repair ?? 0)),
    0,
  );
  const installationGross = employeeEntries.reduce(
    (sum, entry) =>
      sum + Math.max(0, normalizeTicketCount(entry.installation_tickets) - clampDisputedCount(entry.installation_tickets, entry.disputed_install ?? 0)) * toNumber(entry.installation_rate),
    0,
  );
  const repairGross = employeeEntries.reduce(
    (sum, entry) =>
      sum + Math.max(0, normalizeTicketCount(entry.repair_tickets) - clampDisputedCount(entry.repair_tickets, entry.disputed_repair ?? 0)) * toNumber(entry.repair_rate),
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

export function payrollExpensePayload(
  run: Pick<PayrollRun, "id" | "period_month" | "period_year" | "pay_period" | "generated_date">,
  items: Array<Pick<PayrollRunItem, "net_pay" | "status" | "paid_date">>,
  categoryId: string,
  userId: string,
): Omit<Expense, "installment_payments" | "created_at" | "updated_at"> {
  const amount = items.reduce((sum, item) => sum + toNumber(item.net_pay), 0);
  const allPaid = items.length > 0 && items.every((item) => item.status === "paid");
  const paidDate = allPaid
    ? items.reduce<string | null>((latest, item) => {
      if (!item.paid_date) return latest;
      return !latest || item.paid_date > latest ? item.paid_date : latest;
    }, null)
    : null;
  const cutoffLabel = run.pay_period === "first_half" ? "1st Cutoff" : "2nd Cutoff";

  return {
    id: run.id,
    user_id: userId,
    employee_id: null,
    employee_name: `${monthNames[run.period_month - 1]} ${run.period_year} – ${cutoffLabel}`,
    category_id: categoryId,
    category_name: "Payroll",
    amount,
    frequency: "one_time",
    duration_months: null,
    status: allPaid ? "paid" : "pending",
    paid_date: paidDate,
    expense_date: run.generated_date,
    due_date: null,
    payment_date: null,
    notes: "Auto-generated from payroll run",
    payroll_run_id: run.id,
  };
}
