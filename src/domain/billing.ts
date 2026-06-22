import type { DailyTicketEntry } from "../types";

export function countTicketsForMonth(
  entries: DailyTicketEntry[],
  month: number,
  year: number,
): number {
  return entries
    .filter((entry) => {
      const [entryYear, entryMonth] = entry.entry_date.split("-").map(Number);
      return entryYear === year && entryMonth === month;
    })
    .reduce((sum, entry) => {
      if (entry.details && entry.details.length > 0) {
        return sum + entry.details.reduce((s, d) => s + (d.ticket_count ?? 0), 0);
      }
      return sum + (entry.installation_tickets ?? 0) + (entry.repair_tickets ?? 0);
    }, 0);
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

export function lastDayOfMonth(month: number, year: number): string {
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}
