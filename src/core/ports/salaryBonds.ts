import type { EmployeeAdvance, SalaryBond } from "../../types";
import type { Result } from "./result";

export type SalaryBondPayload = {
  user_id: string;
  employee_id: string;
  employee_name: string;
  target_amount: number;
  deduction_per_payroll: number;
  start_deduction: string;
  notes: string;
};

export type SalaryBondWithdrawal = {
  bondId: string;
  /** Client-generated so an offline replay cannot record the withdrawal twice. */
  transactionId: string;
  amount: number;
  transactionDate: string;
  note: string;
};

export interface SalaryBondRepository {
  list(): Promise<Result<SalaryBond[]>>;
  save(payload: SalaryBondPayload, id?: string): Promise<Result<void>>;
  archive(id: string): Promise<Result<void>>;
  reactivate(id: string): Promise<Result<void>>;
  recordWithdrawal(input: SalaryBondWithdrawal): Promise<Result<void>>;
  voidTransaction(transactionId: string, reason: string): Promise<Result<void>>;
  /** Payroll writes deduction transactions here when a run is generated or paid. */
  insertTransactions(payloads: Record<string, unknown>[]): Promise<Result<void>>;
}

/** `id` is optional: an insert lets the database generate it. */
export type EmployeeAdvancePayload = Omit<EmployeeAdvance, "id" | "created_at" | "updated_at"> & { id?: string };

export type EmployeeAdvanceBalanceUpdate = {
  id: string;
  balance: number;
  status: EmployeeAdvance["status"];
};

export interface EmployeeAdvanceRepository {
  list(): Promise<Result<EmployeeAdvance[]>>;
  save(payload: EmployeeAdvancePayload, id?: string): Promise<Result<void>>;
  /**
   * Absolute balance assignment rather than a decrement, so replaying a payroll deduction
   * cannot double-deduct.
   */
  applyBalances(updates: EmployeeAdvanceBalanceUpdate[]): Promise<Result<void>>;
}
