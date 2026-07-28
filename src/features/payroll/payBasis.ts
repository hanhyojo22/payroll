import type { PayrollRunItem } from "../../types";
import { currency, toNumber } from "../../shared/utils/currency";

/**
 * Human-readable description of how a payroll item earned its pay.
 *
 * Lives in the feature rather than `domain/` because it formats currency for display --
 * `domain/` stays pure calculation with no presentation concerns.
 *
 * "legacy" earns exactly like "ticket" (it predates positions and reads the employee's own
 * rate columns), so it has to describe itself the same way -- otherwise position-less payouts
 * render a bare dash in payroll history.
 */
export function payrollItemPayBasis(item: PayrollRunItem): string {
  if (item.pay_mode === "daily") {
    return `${toNumber(item.days_worked)} days x ${currency.format(toNumber(item.daily_rate))}`;
  }
  if (item.pay_mode === "fixed") {
    return `Base ${currency.format(toNumber(item.base_pay))}`;
  }
  const ticketCount = item.ticket_details && item.ticket_details.length > 0
    ? item.ticket_details.reduce((sum, detail) => sum + (detail.ticket_count ?? 0), 0)
    : toNumber(item.installation_tickets) + toNumber(item.repair_tickets) + toNumber(item.nap_rehab_tickets);
  if (item.pay_mode === "ticket" || item.pay_mode === "legacy") return `${ticketCount} tickets`;
  if (item.pay_mode === "hybrid") return `Base ${currency.format(toNumber(item.base_pay))} + ${ticketCount} tickets`;
  return "-";
}
