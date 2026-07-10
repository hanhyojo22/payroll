import type { Employee, SalaryBond, SalaryBondTransaction } from "../types";
import { toNumber } from "./tickets";

export const salaryBondTransactionsTotal = (
  transactions: SalaryBondTransaction[] | null | undefined,
  type: SalaryBondTransaction["type"],
) =>
  (transactions ?? [])
    .filter((transaction) => !transaction.is_void && transaction.type === type)
    .reduce((sum, transaction) => sum + toNumber(transaction.amount), 0);

export const salaryBondBalance = (transactions: SalaryBondTransaction[] | null | undefined) =>
  Math.max(
    0,
    salaryBondTransactionsTotal(transactions, "deduction") - salaryBondTransactionsTotal(transactions, "withdrawal"),
  );

export function withSalaryBondTotals(bond: SalaryBond): SalaryBond {
  const balance = salaryBondBalance(bond.transactions);
  return {
    ...bond,
    balance,
    remaining_to_target: Math.max(0, toNumber(bond.target_amount) - balance),
  };
}

export function salaryBondDeductionForBond(bond: SalaryBond, payrollDate: string): number {
  if (bond.status !== "active") return 0;
  if (bond.start_deduction && bond.start_deduction > payrollDate) return 0;
  const deductionPerPayroll = toNumber(bond.deduction_per_payroll);
  if (deductionPerPayroll <= 0) return 0;
  const remaining = Math.max(0, toNumber(bond.target_amount) - salaryBondBalance(bond.transactions));
  return Math.min(deductionPerPayroll, remaining);
}

export function salaryBondHasDeductionForItem(bond: SalaryBond, payrollRunItemId: string): boolean {
  return (bond.transactions ?? []).some(
    (transaction) =>
      !transaction.is_void &&
      transaction.type === "deduction" &&
      transaction.payroll_run_item_id === payrollRunItemId,
  );
}

export function salaryBondDeductionsForEmployee(
  salaryBonds: SalaryBond[],
  employee: Employee,
  payrollDate: string,
) {
  return salaryBonds
    .filter((bond) => bond.employee_id === employee.id)
    .map((bond) => ({
      amount: salaryBondDeductionForBond(bond, payrollDate),
      bond,
    }))
    .filter((deduction) => deduction.amount > 0);
}

export function validateSalaryBondWithdrawal({
  amount,
  archived,
  balance,
  note,
  withdrawalDate,
  today,
}: {
  amount: number;
  archived: boolean;
  balance: number;
  note: string;
  withdrawalDate: string;
  today: string;
}) {
  if (archived) return "Archived salary bonds cannot accept withdrawals.";
  if (!Number.isFinite(amount) || amount <= 0) return "Withdrawal amount must be greater than zero.";
  if (amount > balance) return "Withdrawal exceeds the current bond balance.";
  if (!withdrawalDate || withdrawalDate > today) return "Withdrawal date cannot be in the future.";
  if (!note.trim()) return "A reason is required for every withdrawal.";
  return null;
}
