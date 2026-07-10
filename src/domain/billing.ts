import type {
  BillingPeriod,
  BillingSubconItem,
  DailyTicketEntry,
  PaymentReminder,
  PaymentReminderPayoutLeg,
  SubconDailyTicket,
  Subcontractor,
  SubcontractorAdvance,
} from "../types";
import { paymentReminderDisplayStatus, paymentReminderPaymentsTotal, paymentReminderRemainingBalance } from "./paymentReminders";

function filterByPeriod(entries: DailyTicketEntry[], month: number, year: number, period?: BillingPeriod): DailyTicketEntry[] {
  return entries.filter((entry) => {
    const [entryYear, entryMonth, entryDay] = entry.entry_date.split("-").map(Number);
    if (entryYear !== year || entryMonth !== month) return false;
    if (!period) return true;
    return period === "first_half" ? entryDay <= 15 : entryDay >= 16;
  });
}

function clampedBillableByType(entry: DailyTicketEntry) {
  const details = entry.details ?? [];
  const installation = details.length > 0
    ? details
      .filter((detail) => (detail.ticket_type ?? "installation") === "installation")
      .reduce((sum, detail) => sum + (detail.ticket_count ?? 0), 0)
    : (entry.installation_tickets ?? 0);
  const repair = details.length > 0
    ? details
      .filter((detail) => detail.ticket_type === "repair")
      .reduce((sum, detail) => sum + (detail.ticket_count ?? 0), 0)
    : (entry.repair_tickets ?? 0);

  return {
    installation: Math.max(0, installation - Math.min(installation, entry.disputed_install ?? 0)),
    repair: Math.max(0, repair - Math.min(repair, entry.disputed_repair ?? 0)),
  };
}

export function countTicketsForMonth(
  entries: DailyTicketEntry[],
  month: number,
  year: number,
  period?: BillingPeriod,
): number {
  return filterByPeriod(entries, month, year, period)
    .reduce((sum, entry) => {
      const counts = clampedBillableByType(entry);
      return sum + counts.installation + counts.repair;
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
      const counts = clampedBillableByType(entry);
      return {
        installation: acc.installation + counts.installation,
        repair: acc.repair + counts.repair,
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
}): Array<Omit<PaymentReminder, "created_at" | "updated_at" | "payments">> {
  return buildSubcontractorPayoutArtifacts(args).payoutPayloads;
}

export type SubcontractorAdvanceUpdate = { id: string; payload: Pick<SubcontractorAdvance, "balance" | "status"> };

export function buildSubcontractorPayoutArtifacts(args: {
  billingMonth: number;
  billingYear: number;
  billingPeriod: BillingPeriod;
  dueDate: string;
  userId: string;
  items: BillingSubconItem[];
  existingPayments?: PaymentReminder[];
  monthName: string;
  subcontractorAdvances?: SubcontractorAdvance[];
}): {
  payoutPayloads: Array<Omit<PaymentReminder, "created_at" | "updated_at" | "payments">>;
  advanceUpdates: SubcontractorAdvanceUpdate[];
} {
  const paymentByItemLeg = new Map(
    (args.existingPayments ?? [])
      .filter((p) => p.billing_subcon_item_id !== null)
      .map((payment) => [`${payment.billing_subcon_item_id}:${payment.payout_leg}`, payment]),
  );
  const periodLabel = billingPeriodLabel(args.billingPeriod);
  const activeAdvancesBySubcontractor = new Map<string, SubcontractorAdvance[]>();
  (args.subcontractorAdvances ?? [])
    .filter((advance) => advance.status === "active" && advance.subcontractor_id && Number(advance.balance) > 0)
    .sort((a, b) => `${a.date_granted}-${a.created_at}`.localeCompare(`${b.date_granted}-${b.created_at}`))
    .forEach((advance) => {
      const list = activeAdvancesBySubcontractor.get(advance.subcontractor_id!) ?? [];
      list.push({ ...advance });
      activeAdvancesBySubcontractor.set(advance.subcontractor_id!, list);
    });
  const advanceUpdates = new Map<string, SubcontractorAdvanceUpdate>();

  function deductFromAdvances(subcontractorId: string, capacity: number): number {
    if (capacity <= 0) return 0;
    const advances = activeAdvancesBySubcontractor.get(subcontractorId) ?? [];
    let remainingDeductionCapacity = capacity;
    let deducted = 0;

    for (const advance of advances) {
      if (remainingDeductionCapacity <= 0) break;
      const currentBalance = Number(advance.balance) || 0;
      if (currentBalance <= 0) continue;
      const configuredDeduction = advance.deduction_mode === "per_billing"
        ? Number(advance.deduction_per_billing) || 0
        : currentBalance;
      if (configuredDeduction <= 0) continue;
      const deduction = Math.min(currentBalance, configuredDeduction, remainingDeductionCapacity);
      const nextBalance = Math.round((currentBalance - deduction) * 100) / 100;
      advance.balance = nextBalance;
      advance.status = nextBalance === 0 ? "completed" : advance.status;
      deducted += deduction;
      remainingDeductionCapacity = Math.round((remainingDeductionCapacity - deduction) * 100) / 100;
      advanceUpdates.set(advance.id, {
        id: advance.id,
        payload: {
          balance: nextBalance,
          status: nextBalance === 0 ? "completed" : advance.status,
        },
      });
    }
    return deducted;
  }

  // The full billing_amount belongs to the subcontractor -- payable_amount is the first
  // installment (payable_pct%), collection_amount is the second/remainder installment,
  // not company revenue. Both become their own payment_reminders row, linked to the same
  // billing_subcon_item via (billing_subcon_item_id, payout_leg). An active cash advance's
  // deduction is computed ONCE per item (against the combined new-leg capacity, not per
  // leg) so a "per_billing" fixed deduction amount isn't accidentally applied twice for
  // the same billing period -- then allocated payable-leg-first into the remainder leg.
  const payoutPayloads = args.items.flatMap((item) => {
    const legs: Array<{ leg: PaymentReminderPayoutLeg; grossAmount: number }> = [
      { leg: "payable", grossAmount: item.payable_amount },
      { leg: "remainder", grossAmount: item.collection_amount },
    ];
    const activeLegs = legs
      .filter(({ grossAmount }) => grossAmount > 0)
      .map((legInfo) => ({ ...legInfo, existing: paymentByItemLeg.get(`${item.id}:${legInfo.leg}`) }));

    const newLegsCapacity = activeLegs
      .filter((legInfo) => !legInfo.existing)
      .reduce((sum, legInfo) => sum + legInfo.grossAmount, 0);
    let remainingItemDeduction = deductFromAdvances(item.subcontractor_id, newLegsCapacity);

    return activeLegs.map(({ leg, grossAmount, existing }) => {
      const isPaid = existing?.status === "paid";
      const shouldPreserveExisting = Boolean(existing);

      let advanceDeduction = 0;
      if (!shouldPreserveExisting) {
        advanceDeduction = Math.min(remainingItemDeduction, grossAmount);
        remainingItemDeduction = Math.round((remainingItemDeduction - advanceDeduction) * 100) / 100;
      }
      const netAmount = shouldPreserveExisting
        ? existing!.amount
        : Math.round((grossAmount - advanceDeduction) * 100) / 100;
      const legSuffix = leg === "remainder" ? " (2nd payout)" : "";
      const baseNote = `${args.monthName} ${args.billingYear} · ${periodLabel}${legSuffix}`;
      const deductionNote = advanceDeduction > 0
        ? `Gross payout PHP ${grossAmount.toFixed(2)} - Cash advance PHP ${advanceDeduction.toFixed(2)} = Net payout PHP ${netAmount.toFixed(2)}`
        : baseNote;

      return {
        id: existing?.id ?? crypto.randomUUID(),
        user_id: args.userId,
        title: leg === "remainder" ? `${item.subcon_name} (2nd payout)` : item.subcon_name,
        type: "subcontractor" as const,
        amount: netAmount,
        due_date: existing?.due_date ?? args.dueDate,
        status: (isPaid ? "paid" : "pending") as PaymentReminder["status"],
        notes: shouldPreserveExisting ? existing!.notes : deductionNote,
        subcontractor_id: item.subcontractor_id,
        billing_subcon_item_id: item.id,
        billing_month: args.billingMonth,
        billing_year: args.billingYear,
        billing_period: args.billingPeriod,
        payout_leg: leg,
      };
    });
  });

  return { payoutPayloads, advanceUpdates: Array.from(advanceUpdates.values()) };
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
  subcontractorAdvances?: SubcontractorAdvance[];
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
  const billingItemIdsWithAnyPayment = new Set(
    payments
      .filter((p) => p.billing_subcon_item_id !== null)
      .map((p) => p.billing_subcon_item_id!),
  );
  const pendingFromPayments = payments
    .filter((payment) => paymentReminderDisplayStatus(payment, payment.payments) !== "paid")
    .reduce((sum, payment) => sum + paymentReminderRemainingBalance(payment, payment.payments), 0);
  // A row with no payment_reminders row at all yet (e.g. generated before payouts were
  // synced) is fully pending -- both installments (payable + remainder) belong to the
  // subcontractor, so the full billing_amount (not just payable_amount) is owed.
  const pendingFromUntrackedBilling = billingRows
    .filter((row) => !billingItemIdsWithAnyPayment.has(row.id))
    .reduce((sum, row) => sum + row.payable_amount + row.collection_amount, 0);
  const pending = pendingFromPayments + pendingFromUntrackedBilling;
  const paidMonthKey = `${year}-${String(month).padStart(2, "0")}`;
  const paidThisMonth = payments
    .flatMap((payment) => payment.payments ?? [])
    .filter((paymentRecord) => paymentRecord.payment_date.startsWith(paidMonthKey))
    .reduce((sum, paymentRecord) => sum + paymentRecord.amount, 0);

  return {
    billingRows,
    lastPayoutStatus: latestPayment ? paymentReminderDisplayStatus(latestPayment, latestPayment.payments) : "none",
    netPending: pending,
    paidThisMonth,
    ticketsThisPeriod: typeof ticketsThisPeriod === "number" ? ticketsThisPeriod : ticketsThisPeriod.install + ticketsThisPeriod.repair,
  };
}

export function lastDayOfMonth(month: number, year: number): string {
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}
