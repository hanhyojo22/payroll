import type { PayrollRepository } from "../../core/ports/payroll";
import type { Notifier } from "../../core/ports/notifier";
import { isConnectivityFailure, friendlyError } from "../../shared/utils/errors";
import type { QueueOfflineMutation } from "../../shared/types";
import type { PayrollRunItem, PayrollRunWithItems } from "../../types";

export type PayrollDeps = {
  repos: { payroll: PayrollRepository };
  queue: QueueOfflineMutation;
  notify: Notifier;
  isOnline: () => boolean;
  reload: () => Promise<void>;
  applyLocalRuns: (runs: PayrollRunWithItems[]) => void;
  today: () => string;
};

const AFFECTED = ["payrollRuns", "payrollHistory", "dashboardSummary"] as const;

function withPatchApplied(
  runs: PayrollRunWithItems[],
  itemId: string,
  patch: Partial<PayrollRunItem>,
): PayrollRunWithItems[] {
  return runs.map((run) => ({
    ...run,
    items: run.items.map((runItem) => runItem.id === itemId ? { ...runItem, ...patch } : runItem),
  }));
}

/**
 * Patches a single payroll item. Every caller that changes an item's money or payment status
 * goes through here, so the offline fallback is defined in exactly one place.
 */
export type PayrollItemUpdateOutcome = "saved" | "queued" | "failed";

export async function updatePayrollItem(
  deps: PayrollDeps,
  input: { item: PayrollRunItem; patch: Partial<PayrollRunItem>; runs: PayrollRunWithItems[] },
): Promise<PayrollItemUpdateOutcome> {
  const { item, patch, runs } = input;

  const queueWrite = async () => {
    deps.applyLocalRuns(withPatchApplied(runs, item.id, patch));
    await deps.queue({
      resource: "payrollRuns",
      affectedResources: [...AFFECTED],
      operation: "update",
      table: "payroll_run_items",
      recordId: item.id,
      payload: patch,
    });
  };

  if (!deps.isOnline()) {
    await queueWrite();
    return "queued";
  }

  const result = await deps.repos.payroll.updateItem(item.id, patch);
  if (result.error) {
    if (isConnectivityFailure(result.error)) {
      await queueWrite();
      return "queued";
    }
    deps.notify.error(friendlyError(result.error));
    return "failed";
  }

  deps.notify.success("Payroll item updated.");
  await deps.reload();
  return "saved";
}

export async function markItemPaid(
  deps: PayrollDeps,
  input: { item: PayrollRunItem; runs: PayrollRunWithItems[] },
): Promise<PayrollItemUpdateOutcome> {
  return updatePayrollItem(deps, {
    ...input,
    patch: { status: "paid", paid_date: deps.today() },
  });
}

export async function markItemPending(
  deps: PayrollDeps,
  input: { item: PayrollRunItem; runs: PayrollRunWithItems[] },
): Promise<PayrollItemUpdateOutcome> {
  return updatePayrollItem(deps, {
    ...input,
    // Clearing the date matters: a pending item carrying a paid_date would show as settled
    // in payroll history, which reads off paid_date rather than status.
    patch: { status: "pending", paid_date: null },
  });
}
