export const toNumber = (value: string | number | null | undefined) => Number(value ?? 0);

export const normalizeTicketCount = (value: string | number | null | undefined) =>
  Math.max(0, Math.floor(toNumber(value)));

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
