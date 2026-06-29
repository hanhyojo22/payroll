import type { BillingPeriod, DailyTicketEntry, SubconDailyTicket } from "../types";

function filterByPeriod(entries: DailyTicketEntry[], month: number, year: number, period?: BillingPeriod): DailyTicketEntry[] {
  return entries.filter((entry) => {
    const [entryYear, entryMonth, entryDay] = entry.entry_date.split("-").map(Number);
    if (entryYear !== year || entryMonth !== month) return false;
    if (!period) return true;
    return period === "first_half" ? entryDay <= 15 : entryDay >= 16;
  });
}

export function countTicketsForMonth(
  entries: DailyTicketEntry[],
  month: number,
  year: number,
  period?: BillingPeriod,
): number {
  return filterByPeriod(entries, month, year, period)
    .reduce((sum, entry) => {
      if (entry.details && entry.details.length > 0) {
        return sum + entry.details.reduce((s, d) => s + (d.ticket_count ?? 0), 0);
      }
      return sum + (entry.installation_tickets ?? 0) + (entry.repair_tickets ?? 0);
    }, 0);
}

export function countTicketsByType(
  entries: DailyTicketEntry[],
  month: number,
  year: number,
  period?: BillingPeriod,
): { installation: number; repair: number } {
  return filterByPeriod(entries, month, year, period).reduce(
    (acc, entry) => {
      const details = entry.details ?? [];
      if (details.length > 0) {
        const installation = details
          .filter((d) => (d.ticket_type ?? "installation") === "installation")
          .reduce((s, d) => s + d.ticket_count, 0);
        const repair = details
          .filter((d) => d.ticket_type === "repair")
          .reduce((s, d) => s + d.ticket_count, 0);
        return {
          installation: acc.installation + installation,
          repair: acc.repair + repair,
        };
      }
      return {
        installation: acc.installation + (entry.installation_tickets ?? 0),
        repair: acc.repair + (entry.repair_tickets ?? 0),
      };
    },
    { installation: 0, repair: 0 },
  );
}

export function computeBilling(
  totalTickets: number,
  disputedTickets: number,
  billingRate: number,
  collectionsPct: number,
): {
  billableTickets: number;
  billingAmount: number;
  collectionsAmount: number;
  collectiblesAmount: number;
} {
  const billableTickets = Math.max(0, totalTickets - disputedTickets);
  const billingAmount = billableTickets * billingRate;
  const collectionsAmount = Math.round(billingAmount * collectionsPct / 100 * 100) / 100;
  const collectiblesAmount = Math.round((billingAmount - collectionsAmount) * 100) / 100;
  return { billableTickets, billingAmount, collectionsAmount, collectiblesAmount };
}

export function computeBillingByType(
  installation: number,
  repair: number,
  disputedTickets: number,
  installationRate: number,
  repairRate: number,
  collectionsPct: number,
): {
  totalTickets: number;
  billableTickets: number;
  billingAmount: number;
  collectionsAmount: number;
  collectiblesAmount: number;
} {
  const totalTickets = installation + repair;
  const billableTickets = Math.max(0, totalTickets - disputedTickets);
  const disputeRatio = totalTickets > 0 ? billableTickets / totalTickets : 0;
  const billableInstallation = Math.round(installation * disputeRatio);
  const billableRepair = billableTickets - billableInstallation;
  const billingAmount = billableInstallation * installationRate + billableRepair * repairRate;
  const collectionsAmount = Math.round(billingAmount * collectionsPct / 100 * 100) / 100;
  const collectiblesAmount = Math.round((billingAmount - collectionsAmount) * 100) / 100;
  return { totalTickets, billableTickets, billingAmount, collectionsAmount, collectiblesAmount };
}

export function computeSubconItem(
  installTickets: number,
  repairTickets: number,
  disputedInstall: number,
  disputedRepair: number,
  installationRate: number,
  repairRate: number,
  payablePct: number,
): {
  billableInstall: number;
  billableRepair: number;
  billableTickets: number;
  billingAmount: number;
  payableAmount: number;
  collectionAmount: number;
} {
  const billableInstall = Math.max(0, installTickets - disputedInstall);
  const billableRepair = Math.max(0, repairTickets - disputedRepair);
  const billableTickets = billableInstall + billableRepair;
  const billingAmount = billableInstall * installationRate + billableRepair * repairRate;
  const payableAmount = Math.round(billingAmount * payablePct / 100 * 100) / 100;
  const collectionAmount = Math.round((billingAmount - payableAmount) * 100) / 100;
  return { billableInstall, billableRepair, billableTickets, billingAmount, payableAmount, collectionAmount };
}

export function countSubconTickets(
  entries: SubconDailyTicket[],
  subcontractorId: string,
  month: number,
  year: number,
  period?: BillingPeriod,
): { install: number; repair: number } {
  return entries
    .filter((entry) => {
      if (entry.subcontractor_id !== subcontractorId) return false;
      const [entryYear, entryMonth, entryDay] = entry.entry_date.split("-").map(Number);
      if (entryYear !== year || entryMonth !== month) return false;
      if (!period) return true;
      return period === "first_half" ? entryDay <= 15 : entryDay >= 16;
    })
    .reduce(
      (acc, entry) => ({
        install: acc.install + (entry.install_tickets ?? 0),
        repair: acc.repair + (entry.repair_tickets ?? 0),
      }),
      { install: 0, repair: 0 },
    );
}

export function lastDayOfMonth(month: number, year: number): string {
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}
