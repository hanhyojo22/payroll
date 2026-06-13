import type { Employee, EmployeeWageCategory } from "../types";

export const INSTALLATION_RATE = 600;
export const NEW_EMPLOYEE_REPAIR_RATE = 200;
export const SPECIAL_OLD_EMPLOYEE_REPAIR_RATE = 250;

export const toNumber = (value: string | number | null | undefined) => Number(value ?? 0);

export const normalizeTicketCount = (value: string | number | null | undefined) =>
  Math.max(0, Math.floor(toNumber(value)));

export const repairRateForWageCategory = (wageCategory: EmployeeWageCategory | null | undefined) =>
  wageCategory === "special_old" ? SPECIAL_OLD_EMPLOYEE_REPAIR_RATE : NEW_EMPLOYEE_REPAIR_RATE;

export const employeeInstallationRate = (employee: Pick<Employee, "installation_rate">) =>
  toNumber(employee.installation_rate) || INSTALLATION_RATE;

export const employeeRepairRate = (employee: Pick<Employee, "repair_rate" | "wage_category">) =>
  toNumber(employee.repair_rate) || repairRateForWageCategory(employee.wage_category);

export const wageCategoryLabel = (wageCategory: EmployeeWageCategory | string | null | undefined) =>
  wageCategory === "special_old" ? "Special/Old employee" : "New employee";

export const ticketGrossPay = (
  installationTickets: string | number | null | undefined,
  repairTickets: string | number | null | undefined,
  installationRate: string | number | null | undefined,
  repairRate: string | number | null | undefined,
) =>
  normalizeTicketCount(installationTickets) * toNumber(installationRate) +
  normalizeTicketCount(repairTickets) * toNumber(repairRate);

export const netPay = (gross: number, allowances: number, deductions: number) =>
  gross + allowances - deductions;
