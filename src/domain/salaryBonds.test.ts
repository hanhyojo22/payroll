import { describe, expect, it } from "vitest";
import {
  salaryBondBalance,
  salaryBondDeductionForBond,
  salaryBondDeductionsForEmployee,
  salaryBondHasDeductionForItem,
  validateSalaryBondWithdrawal,
  withSalaryBondTotals,
} from "./salaryBonds";
import type { Employee, SalaryBond, SalaryBondTransaction } from "../types";

const transaction = (
  type: SalaryBondTransaction["type"],
  amount: number,
  overrides: Partial<SalaryBondTransaction> = {},
): SalaryBondTransaction => ({
  id: crypto.randomUUID(), user_id: "user-1", salary_bond_id: "bond-1", employee_id: "employee-1",
  type, amount, transaction_date: "2026-06-10", payroll_run_id: null, payroll_run_item_id: null,
  note: "", is_void: false, void_reason: "", voided_at: null,
  created_at: "2026-06-10T00:00:00Z", updated_at: "2026-06-10T00:00:00Z", ...overrides,
});

const bond = (overrides: Partial<SalaryBond> = {}): SalaryBond => ({
  id: "bond-1", user_id: "user-1", employee_id: "employee-1", employee_name: "Employee One",
  bond_reference: "SB-1", target_amount: 10000, deduction_per_payroll: 1000,
  start_deduction: "2026-01-01", status: "active", notes: "", transactions: [],
  balance: 0, remaining_to_target: 10000,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...overrides,
});

const employee = (overrides: Partial<Employee> = {}): Employee => ({
  id: "employee-1", user_id: "user-1", full_name: "Employee One", role: "", position_id: null,
  department: "", contact_number: "", email: "", address: "", profile_photo_url: "",
  hire_date: "", date_of_birth: "", status: "active", wage_category: "new",
  monthly_salary: 0, sss_number: "", philhealth_number: "", pagibig_number: "",
  sss_deduction: 0, philhealth_deduction: 0, pagibig_deduction: 0, withholding_tax: 0,
  tin_number: "", gender: "", civil_status: "", emergency_contact_name: "",
  emergency_contact_number: "", emergency_contact_relation: "", notes: "",
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...overrides,
});

describe("salary bond balance derivation", () => {
  it("sums deductions minus withdrawals, excluding void rows", () => {
    const transactions = [
      transaction("deduction", 1000),
      transaction("deduction", 1000),
      transaction("withdrawal", 500),
      transaction("withdrawal", 9999, { is_void: true }),
    ];
    expect(salaryBondBalance(transactions)).toBe(1500);
  });

  it("never goes negative", () => {
    expect(salaryBondBalance([transaction("withdrawal", 100)])).toBe(0);
  });

  it("computes remaining_to_target from the derived balance", () => {
    const withTotals = withSalaryBondTotals(bond({ transactions: [transaction("deduction", 6000)] }));
    expect(withTotals.balance).toBe(6000);
    expect(withTotals.remaining_to_target).toBe(4000);
  });
});

describe("salary bond payroll deductions", () => {
  it("deducts the full per-payroll amount while far from target", () => {
    expect(salaryBondDeductionForBond(bond(), "2026-06-15")).toBe(1000);
  });

  it("caps the deduction at the remaining amount to target instead of overshooting", () => {
    const nearTarget = bond({ transactions: [transaction("deduction", 9500)] });
    expect(salaryBondDeductionForBond(nearTarget, "2026-06-15")).toBe(500);
  });

  it("stops deducting once balance reaches target", () => {
    const atTarget = bond({ transactions: [transaction("deduction", 10000)] });
    expect(salaryBondDeductionForBond(atTarget, "2026-06-15")).toBe(0);
  });

  it("auto-resumes once a withdrawal drops the balance back below target", () => {
    const afterWithdrawal = bond({
      transactions: [transaction("deduction", 10000), transaction("withdrawal", 3000)],
    });
    expect(salaryBondDeductionForBond(afterWithdrawal, "2026-06-15")).toBe(1000);
  });

  it("does not deduct archived bonds", () => {
    expect(salaryBondDeductionForBond(bond({ status: "archived" }), "2026-06-15")).toBe(0);
  });

  it("does not deduct before the start_deduction date", () => {
    expect(salaryBondDeductionForBond(bond({ start_deduction: "2026-07-01" }), "2026-06-15")).toBe(0);
  });

  it("filters and sums deductions across an employee's bonds", () => {
    const bonds = [
      bond({ id: "bond-1" }),
      bond({ id: "bond-2", employee_id: "employee-2" }),
      bond({ id: "bond-3", transactions: [transaction("deduction", 10000)] }),
    ];
    const deductions = salaryBondDeductionsForEmployee(bonds, employee(), "2026-06-15");
    expect(deductions).toHaveLength(1);
    expect(deductions[0].amount).toBe(1000);
    expect(deductions[0].bond.id).toBe("bond-1");
  });
});

describe("salary bond deduction idempotency", () => {
  it("detects an existing non-void deduction linked to the payroll run item", () => {
    const withDeduction = bond({
      transactions: [transaction("deduction", 1000, { payroll_run_item_id: "item-1" })],
    });
    expect(salaryBondHasDeductionForItem(withDeduction, "item-1")).toBe(true);
  });

  it("ignores voided deductions", () => {
    const withVoided = bond({
      transactions: [transaction("deduction", 1000, { payroll_run_item_id: "item-1", is_void: true })],
    });
    expect(salaryBondHasDeductionForItem(withVoided, "item-1")).toBe(false);
  });

  it("ignores deductions linked to a different item", () => {
    const withOther = bond({
      transactions: [transaction("deduction", 1000, { payroll_run_item_id: "item-2" })],
    });
    expect(salaryBondHasDeductionForItem(withOther, "item-1")).toBe(false);
  });

  it("ignores withdrawals even if linked to the item", () => {
    const withWithdrawal = bond({
      transactions: [transaction("withdrawal", 1000, { payroll_run_item_id: "item-1" })],
    });
    expect(salaryBondHasDeductionForItem(withWithdrawal, "item-1")).toBe(false);
  });
});

describe("salary bond withdrawal validation", () => {
  it("rejects withdrawals on archived bonds", () => {
    expect(validateSalaryBondWithdrawal({
      amount: 100, archived: true, balance: 1000, note: "reason",
      withdrawalDate: "2026-06-15", today: "2026-06-15",
    })).toBe("Archived salary bonds cannot accept withdrawals.");
  });

  it("rejects amounts exceeding the balance", () => {
    expect(validateSalaryBondWithdrawal({
      amount: 1500, archived: false, balance: 1000, note: "reason",
      withdrawalDate: "2026-06-15", today: "2026-06-15",
    })).toBe("Withdrawal exceeds the current bond balance.");
  });

  it("requires a non-empty note", () => {
    expect(validateSalaryBondWithdrawal({
      amount: 100, archived: false, balance: 1000, note: "   ",
      withdrawalDate: "2026-06-15", today: "2026-06-15",
    })).toBe("A reason is required for every withdrawal.");
  });

  it("rejects future-dated withdrawals", () => {
    expect(validateSalaryBondWithdrawal({
      amount: 100, archived: false, balance: 1000, note: "reason",
      withdrawalDate: "2026-06-20", today: "2026-06-15",
    })).toBe("Withdrawal date cannot be in the future.");
  });

  it("passes for a valid withdrawal", () => {
    expect(validateSalaryBondWithdrawal({
      amount: 100, archived: false, balance: 1000, note: "reason",
      withdrawalDate: "2026-06-15", today: "2026-06-15",
    })).toBeNull();
  });
});
