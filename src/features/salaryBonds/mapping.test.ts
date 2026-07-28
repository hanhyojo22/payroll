import { describe, expect, it } from "vitest";
import { normalizeSalaryBond, salaryBondPayload } from "./mapping";
import type { Employee, SalaryBond, SalaryBondTransaction } from "../../types";

const transaction = (overrides: Partial<SalaryBondTransaction> = {}): SalaryBondTransaction => ({
  id: "t1", user_id: "u1", salary_bond_id: "b1", employee_id: "e1", type: "deduction",
  amount: 500, transaction_date: "2026-06-15", payroll_run_id: null, payroll_run_item_id: null,
  note: "", is_void: false, void_reason: "", voided_at: null,
  created_at: "2026-06-15T00:00:00Z", updated_at: "2026-06-15T00:00:00Z", ...overrides,
});

const bond = (overrides: Partial<SalaryBond> = {}) => ({
  id: "b1", user_id: "u1", employee_id: "e1", employee_name: "Ana Cruz",
  bond_reference: "SB-1", target_amount: 10000, deduction_per_payroll: 500,
  start_deduction: "2026-06-01", status: "active", notes: "",
  balance: 0, remaining_to_target: 0, transactions: [],
  created_at: "2026-06-01T00:00:00Z", updated_at: "2026-06-01T00:00:00Z", ...overrides,
}) as SalaryBond;

describe("normalizeSalaryBond", () => {
  it("derives balance and remaining target from the transaction ledger", () => {
    const result = normalizeSalaryBond(bond({
      transactions: [transaction({ amount: 500 }), transaction({ id: "t2", amount: 300 })],
    }));

    expect(result.balance).toBe(800);
    expect(result.remaining_to_target).toBe(9200);
  });

  it("nets withdrawals back out of the balance", () => {
    const result = normalizeSalaryBond(bond({
      transactions: [
        transaction({ amount: 1000 }),
        transaction({ id: "t2", type: "withdrawal", amount: 400 }),
      ],
    }));

    expect(result.balance).toBe(600);
  });

  it("ignores voided transactions", () => {
    const result = normalizeSalaryBond(bond({
      transactions: [
        transaction({ amount: 1000 }),
        transaction({ id: "t2", amount: 500, is_void: true, void_reason: "Mistake" }),
      ],
    }));

    expect(result.balance).toBe(1000);
  });

  it("tolerates a row that arrived without a transactions array", () => {
    const result = normalizeSalaryBond(bond({
      transactions: undefined as unknown as SalaryBondTransaction[],
    }));

    expect(result.transactions).toEqual([]);
    expect(result.balance).toBe(0);
  });
});

describe("salaryBondPayload", () => {
  it("coerces numbers, trims notes, and stamps the employee", () => {
    const employee = { id: "e1", full_name: "Ana Cruz" } as Employee;
    const payload = salaryBondPayload({
      target_amount: "10000", deduction_per_payroll: "500",
      start_deduction: "2026-06-01", notes: "  savings  ", employee_id: "e1",
    }, "u1", employee);

    expect(payload).toEqual({
      user_id: "u1", employee_id: "e1", employee_name: "Ana Cruz",
      target_amount: 10000, deduction_per_payroll: 500,
      start_deduction: "2026-06-01", notes: "savings",
    });
  });
});
