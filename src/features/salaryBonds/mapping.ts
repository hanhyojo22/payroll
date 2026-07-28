import { withSalaryBondTotals } from "../../domain/salaryBonds";
import type { Employee, SalaryBond, SalaryBondFormValues } from "../../types";
import type { SalaryBondPayload } from "../../core/ports/salaryBonds";

/** Pure shape mapping between stored rows and the domain shape. No Supabase types. */

export function normalizeSalaryBond(record: SalaryBond): SalaryBond {
  return withSalaryBondTotals({
    ...record,
    transactions: record.transactions ?? [],
  });
}

export function salaryBondPayload(
  values: SalaryBondFormValues,
  userId: string,
  employee: Employee,
): SalaryBondPayload {
  return {
    user_id: userId,
    employee_id: employee.id,
    employee_name: employee.full_name,
    target_amount: Number(values.target_amount),
    deduction_per_payroll: Number(values.deduction_per_payroll),
    start_deduction: values.start_deduction,
    notes: values.notes.trim(),
  };
}
