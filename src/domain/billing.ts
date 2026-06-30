import type {
  BillingPeriod,
  BillingSubconItem,
  DailyTicketEntry,
  PaymentReminder,
  SubconDailyTicket,
  Subcontractor,
} from "../types";

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

export function billingPeriodLabel(period: BillingPeriod): string {
  return period === "first_half" ? "1st - 15th" : "16th - End";
}

export function filterSubcontractorDailyTickets(
  entries: SubconDailyTicket[],
  subcontractorId: string,
  startDate?: string,
  endDate?: string,
): SubconDailyTicket[] {
  return entries.filter((entry) => {
    if (entry.subcontractor_id !== subcontractorId) return false;
    if (startDate && entry.entry_date < startDate) return false;
    if (endDate && entry.entry_date > endDate) return false;
    return true;
  });
}

export function buildSubcontractorPaymentPayloads(args: {
  billingMonth: number;
  billingYear: number;
  billingPeriod: BillingPeriod;
  dueDate: string;
  userId: string;
  items: BillingSubconItem[];
  existingPayments?: PaymentReminder[];
  monthName: string;
}): Array<Omit<PaymentReminder, "created_at" | "updated_at">> {
  const paymentByItemId = new Map(
    (args.existingPayments ?? [])
      .filter((p) => p.billing_subcon_item_id !== null)
      .map((payment) => [payment.billing_subcon_item_id!, payment]),
  );
  const periodLabel = billingPeriodLabel(args.billingPeriod);

  return args.items.map((item) => {
    const existing = paymentByItemId.get(item.id);
    return {
      id: existing?.id ?? crypto.randomUUID(),
      user_id: args.userId,
      title: item.subcon_name,
      type: "subcontractor" as const,
      amount: item.payable_amount,
      due_date: existing?.due_date ?? args.dueDate,
      status: (existing?.status === "paid" ? "paid" : "pending") as PaymentReminder["status"],
      notes: `${args.monthName} ${args.billingYear} · ${periodLabel}`,
      subcontractor_id: item.subcontractor_id,
      billing_subcon_item_id: item.id,
      billing_month: args.billingMonth,
      billing_year: args.billingYear,
      billing_period: args.billingPeriod,
    };
  });
}

export function buildSubcontractorAccountSummary(args: {
  subcontractor: Subcontractor;
  billingRecords: Array<{
    billing_month: number;
    billing_year: number;
    billing_period: BillingPeriod;
    subcon_items: BillingSubconItem[];
  }>;
  dailyTickets: SubconDailyTicket[];
  payments: PaymentReminder[];
  today?: Date;
}) {
  const today = args.today ?? new Date();
  const billingRows = args.billingRecords.flatMap((record) =>
    record.subcon_items
      .filter((item) => item.subcontractor_id === args.subcontractor.id)
      .map((item) => ({
        ...item,
        billing_month: record.billing_month,
        billing_year: record.billing_year,
        billing_period: record.billing_period,
      })),
  );
  const payments = args.payments.filter(
    (payment) => payment.type === "subcontractor" && payment.subcontractor_id === args.subcontractor.id,
  );
  const latestDailyTicket = [...args.dailyTickets]
    .filter((entry) => entry.subcontractor_id === args.subcontractor.id)
    .sort((a, b) => b.entry_date.localeCompare(a.entry_date))[0];
  const latestBillingRow = [...billingRows]
    .sort((a, b) =>
      `${b.billing_year}-${String(b.billing_month).padStart(2, "0")}-${b.billing_period}`.localeCompare(
        `${a.billing_year}-${String(a.billing_month).padStart(2, "0")}-${a.billing_period}`,
      ),
    )[0];
  const latestPayment = [...payments]
    .sort((a, b) =>
      `${b.billing_year ?? 0}-${String(b.billing_month ?? 0).padStart(2, "0")}-${b.billing_period ?? ""}`.localeCompare(
        `${a.billing_year ?? 0}-${String(a.billing_month ?? 0).padStart(2, "0")}-${a.billing_period ?? ""}`,
      ),
    )[0] ?? null;
  const referenceDate = latestDailyTicket
    ? new Date(`${latestDailyTicket.entry_date}T00:00:00`)
    : latestPayment?.status === "paid"
      ? new Date(`${latestPayment.updated_at.slice(0, 10)}T00:00:00`)
      : latestPayment?.billing_month
        ? new Date(latestPayment.billing_year!, latestPayment.billing_month - 1, latestPayment.billing_period === "first_half" ? 15 : 28)
        : latestBillingRow
          ? new Date(latestBillingRow.billing_year, latestBillingRow.billing_month - 1, latestBillingRow.billing_period === "first_half" ? 15 : 28)
          : today;
  const month = referenceDate.getMonth() + 1;
  const year = referenceDate.getFullYear();
  const period = referenceDate.getDate() <= 15 ? "first_half" : "second_half";
  const ticketsThisPeriod = latestDailyTicket
    ? countSubconTickets(args.dailyTickets, args.subcontractor.id, month, year, period)
    : (latestBillingRow?.install_tickets ?? 0) + (latestBillingRow?.repair_tickets ?? 0);
  const paymentByBillingItemId = new Map(
    payments
      .filter((p) => p.billing_subcon_item_id !== null)
      .map((payment) => [payment.billing_subcon_item_id!, payment]),
  );
  const pendingFromPayments = payments
    .filter((payment) => payment.status === "pending")
    .reduce((sum, payment) => sum + payment.amount, 0);
  const pendingFromUntrackedBilling = billingRows
    .filter((row) => !paymentByBillingItemId.has(row.id))
    .reduce((sum, row) => sum + row.payable_amount, 0);
  const pending = pendingFromPayments + pendingFromUntrackedBilling;
  const paidMonthKey = `${year}-${String(month).padStart(2, "0")}`;
  const paidThisMonth = payments
    .filter((payment) => payment.status === "paid" && payment.updated_at.startsWith(paidMonthKey))
    .reduce((sum, payment) => sum + payment.amount, 0);

  return {
    billingRows,
    lastPayoutStatus: latestPayment?.status ?? "none",
    netPending: pending,
    paidThisMonth,
    ticketsThisPeriod: typeof ticketsThisPeriod === "number" ? ticketsThisPeriod : ticketsThisPeriod.install + ticketsThisPeriod.repair,
  };
}

export function lastDayOfMonth(month: number, year: number): string {
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}
