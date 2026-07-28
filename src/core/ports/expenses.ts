import type {
  CollectionPaymentMethod,
  Expense,
  ExpenseCategory,
  ExpenseCategoryType,
} from "../../types";
import type { Result } from "./result";

export type ExpensePayload = Omit<Expense, "created_at" | "updated_at" | "installment_payments">;

export type ExpenseCompletionPatch = { status: "pending" | "paid"; paid_date: string | null };

export type InstallmentPaymentPayload = {
  id: string;
  user_id: string;
  expense_id: string;
  amount: number;
  payment_date: string;
  payment_method: CollectionPaymentMethod;
  reference_number: string;
  notes: string;
};

export type PayInstallmentInput = {
  payment: InstallmentPaymentPayload;
  expenseId: string;
  /** Applied in the same transaction, so a settled expense cannot be left open by a partial write. */
  expensePatch: ExpenseCompletionPatch;
};

export interface ExpenseRepository {
  list(): Promise<Result<Expense[]>>;
  /**
   * Excludes paid and cancelled expenses. Callers that only need the current actionable set
   * (the expenses page, the dashboard) should use this instead of list(), which returns every
   * expense ever recorded including years of settled history.
   */
  listActive(): Promise<Result<Expense[]>>;
  save(payload: ExpensePayload): Promise<Result<void>>;
  remove(id: string): Promise<Result<void>>;
  cancel(id: string): Promise<Result<void>>;
  updateCompletion(id: string, patch: ExpenseCompletionPatch): Promise<Result<void>>;
  payInstallment(input: PayInstallmentInput): Promise<Result<void>>;
  deleteInstallmentPayment(paymentId: string): Promise<Result<void>>;
  /** Standalone insert, for callers that patch the parent expense separately. */
  addInstallmentPayment(
    userId: string,
    expenseId: string,
    payload: Omit<InstallmentPaymentPayload, "id" | "user_id" | "expense_id">,
  ): Promise<Result<void>>;
}

export type ExpenseCategoryPayload = {
  id?: string;
  name: string;
  type: ExpenseCategoryType;
  status: "active" | "archived";
};

export interface ExpenseCategoryRepository {
  list(): Promise<Result<ExpenseCategory[]>>;
  save(userId: string, payload: ExpenseCategoryPayload): Promise<Result<void>>;
  remove(id: string): Promise<Result<void>>;
  /**
   * Returns the named company category, creating it if absent. Payroll, billing and
   * subcontractor payouts each need a category to file their auto-generated expenses under
   * and cannot assume the admin created one.
   */
  ensureCompanyCategory(userId: string, name: string): Promise<Result<ExpenseCategory>>;
}
