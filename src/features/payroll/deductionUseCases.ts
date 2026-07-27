import type { EmployeeAdvanceRepository, SalaryBondRepository } from "../../core/ports/salaryBonds";
import type { PayrollRepository } from "../../core/ports/payroll";
import type { Notifier } from "../../core/ports/notifier";
import { friendlyError } from "../../shared/utils/errors";
import type { AppError } from "../../shared/types";
import type { EmployeeAdvance, PayrollRunItem, PayrollRunWithItems } from "../../types";

export type EmployeeAdvancePayrollDeduction = { amount: number; advance: EmployeeAdvance };

export type ItemDeductionEntry = {
  item: PayrollRunItem;
  patch: {
    payload: Partial<PayrollRunItem>;
    advanceDeductions: EmployeeAdvancePayrollDeduction[];
    bondDeductions: unknown[];
  };
};

export type DeductionDeps = {
  repos: {
    payroll: PayrollRepository;
    salaryBonds: SalaryBondRepository;
    employeeAdvances: EmployeeAdvanceRepository;
  };
  notify: Notifier;
  isOnline: () => boolean;
  reload: () => Promise<void>;
  today: () => string;
  onProgress?: (completed: number, total: number) => void;
};

/**
 * Writes the deduction ledger -- advance balances and salary bond transactions -- as one step.
 *
 * Balances are assigned absolutely rather than decremented, so a retry after a partial
 * failure cannot double-deduct.
 */
async function applyLedger(
  deps: DeductionDeps,
  advanceDeductions: EmployeeAdvancePayrollDeduction[],
  bondPayloads: Record<string, unknown>[],
): Promise<AppError | null> {
  const [advanceResult, bondResult] = await Promise.all([
    deps.repos.employeeAdvances.applyBalances(advanceDeductions.map(({ amount, advance }) => {
      const balance = Math.max(0, Number(advance.balance ?? 0) - amount);
      return { id: advance.id, balance, status: balance === 0 ? "completed" as const : advance.status };
    })),
    deps.repos.salaryBonds.insertTransactions(bondPayloads),
  ]);

  return advanceResult.error ?? bondResult.error ?? null;
}

/**
 * Applies outstanding advance/bond deductions to a run's items.
 *
 * The ledger is written before any item is patched. Reversing that order would let an item
 * end up carrying a deduction note whose ledger write never happened -- the item would claim
 * money was taken off an advance that still shows the full balance.
 */
export async function applyMissingDeductions(
  deps: DeductionDeps,
  input: {
    run: PayrollRunWithItems;
    itemsNeedingDeductions: ItemDeductionEntry[];
    buildBondPayloads: (paidDate: string) => Record<string, unknown>[];
  },
): Promise<boolean> {
  const { run, itemsNeedingDeductions, buildBondPayloads } = input;
  if (itemsNeedingDeductions.length === 0) return false;

  if (!deps.isOnline()) {
    deps.notify.error("Connect to the internet to apply payroll deductions to this payroll run.");
    return false;
  }

  const count = itemsNeedingDeductions.length;
  const confirmed = await deps.notify.confirm({
    title: "Apply deductions",
    message: `Apply advance deductions to ${count} payroll item${count === 1 ? "" : "s"}?`,
  });
  if (!confirmed) return false;

  const ledgerError = await applyLedger(
    deps,
    itemsNeedingDeductions.flatMap((entry) => entry.patch.advanceDeductions),
    buildBondPayloads(deps.today()),
  );
  if (ledgerError) {
    deps.notify.error(friendlyError(ledgerError));
    return false;
  }

  for (const { item, patch } of itemsNeedingDeductions) {
    const { error } = await deps.repos.payroll.updateItem(item.id, patch.payload);
    if (error) {
      deps.notify.error(friendlyError(error));
      return false;
    }
  }

  deps.notify.success(`Applied payroll deductions to ${count} payroll item${count === 1 ? "" : "s"}.`);
  await deps.reload();
  void run;
  return true;
}

/**
 * Marks every pending item in a run as paid, folding any outstanding deduction patch into
 * the same write. Same ledger-first ordering as above: nothing is marked paid until the
 * deductions it claims have actually been recorded.
 */
export async function markAllItemsPaid(
  deps: DeductionDeps,
  input: {
    run: PayrollRunWithItems;
    pendingItems: PayrollRunItem[];
    itemsNeedingDeductions: ItemDeductionEntry[];
    deductionPatchById: Map<string, Partial<PayrollRunItem>>;
    buildBondPayloads: (paidDate: string) => Record<string, unknown>[];
  },
): Promise<boolean> {
  const { pendingItems, itemsNeedingDeductions, deductionPatchById, buildBondPayloads } = input;
  if (pendingItems.length === 0) return false;

  if (!deps.isOnline()) {
    deps.notify.error("Connect to the internet to mark all payroll items as paid.");
    return false;
  }

  const confirmed = await deps.notify.confirm({
    title: "Pay all",
    message: `Mark all ${pendingItems.length} pending payroll item${pendingItems.length === 1 ? "" : "s"} as paid?`,
  });
  if (!confirmed) return false;

  const paidDate = deps.today();
  deps.onProgress?.(0, pendingItems.length);

  if (itemsNeedingDeductions.length > 0) {
    const ledgerError = await applyLedger(
      deps,
      itemsNeedingDeductions.flatMap((entry) => entry.patch.advanceDeductions),
      buildBondPayloads(paidDate),
    );
    if (ledgerError) {
      deps.notify.error(friendlyError(ledgerError));
      return false;
    }
  }

  for (let index = 0; index < pendingItems.length; index += 1) {
    const item = pendingItems[index];
    const { error } = await deps.repos.payroll.updateItem(item.id, {
      ...(deductionPatchById.get(item.id) ?? {}),
      status: "paid",
      paid_date: paidDate,
    });
    if (error) {
      deps.notify.error(friendlyError(error));
      return false;
    }
    deps.onProgress?.(index + 1, pendingItems.length);
  }

  deps.notify.success(`Marked ${pendingItems.length} payroll item${pendingItems.length === 1 ? "" : "s"} as paid.`);
  await deps.reload();
  return true;
}
