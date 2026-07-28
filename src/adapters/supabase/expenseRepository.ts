import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ExpenseCategoryPayload,
  ExpenseCategoryRepository,
  ExpenseCompletionPatch,
  ExpensePayload,
  ExpenseRepository,
  PayInstallmentInput,
} from "../../core/ports/expenses";
import { err, ok, type Result } from "../../core/ports/result";
import type { AppError } from "../../shared/types";
import type { Expense, ExpenseCategory } from "../../types";

const EXPENSE_CATEGORY_SELECT = "id,user_id,name,type,status,created_at,updated_at";
const EXPENSE_INSTALLMENT_PAYMENT_SELECT = "id,user_id,expense_id,amount,payment_date,payment_method,reference_number,notes,created_at";
const EXPENSE_SELECT = `id,user_id,employee_id,employee_name,category_id,category_name,amount,frequency,duration_months,status,paid_date,expense_date,due_date,payment_date,notes,payroll_run_id,subcontractor_payment_reminder_id,created_at,updated_at,installment_payments:expense_installment_payments(${EXPENSE_INSTALLMENT_PAYMENT_SELECT})`;

const settle = (raw: { error: unknown }): Result<void> =>
  raw.error ? err<void>(raw.error as AppError) : ok(undefined as void);

export function supabaseExpenseRepository(supabase: SupabaseClient): ExpenseRepository {
  return {
    async list() {
      const raw = await supabase
        .from("expenses")
        .select(EXPENSE_SELECT)
        .order("expense_date", { ascending: false })
        .order("created_at", { ascending: false });

      return raw.error
        ? err<Expense[]>(raw.error as AppError)
        : ok((raw.data ?? []) as unknown as Expense[]);
    },

    async listActive() {
      const raw = await supabase
        .from("expenses")
        .select(EXPENSE_SELECT)
        .not("status", "in", "(paid,cancelled)")
        .order("expense_date", { ascending: false })
        .order("created_at", { ascending: false });

      return raw.error
        ? err<Expense[]>(raw.error as AppError)
        : ok((raw.data ?? []) as unknown as Expense[]);
    },

    async save(payload: ExpensePayload) {
      // Only paid/cancelled are persisted verbatim; anything else normalises to pending so a
      // derived display status never leaks into the column.
      const persistedStatus = payload.status === "paid" || payload.status === "cancelled" ? payload.status : "pending";
      return settle(await supabase.from("expenses").upsert({
        ...payload,
        status: persistedStatus,
        paid_date: persistedStatus === "paid" ? payload.paid_date : null,
      }));
    },

    async remove(id) {
      return settle(await supabase.from("expenses").delete().eq("id", id));
    },

    async cancel(id) {
      return settle(await supabase.from("expenses").update({ status: "cancelled" }).eq("id", id));
    },

    async updateCompletion(id: string, patch: ExpenseCompletionPatch) {
      return settle(await supabase.from("expenses").update(patch).eq("id", id));
    },

    async payInstallment({ payment, expenseId, expensePatch }: PayInstallmentInput) {
      return settle(await supabase.rpc("record_expense_payment_bundle", {
        payment_payload: payment,
        expense_record_id: expenseId,
        expense_patch: expensePatch,
      }));
    },

    async deleteInstallmentPayment(paymentId) {
      return settle(await supabase.from("expense_installment_payments").delete().eq("id", paymentId));
    },

    async addInstallmentPayment(userId, expenseId, payload) {
      return settle(await supabase
        .from("expense_installment_payments")
        .insert({ ...payload, user_id: userId, expense_id: expenseId }));
    },
  };
}

export function supabaseExpenseCategoryRepository(supabase: SupabaseClient): ExpenseCategoryRepository {
  return {
    async list() {
      const raw = await supabase.from("expense_categories").select(EXPENSE_CATEGORY_SELECT).order("name");
      return raw.error
        ? err<ExpenseCategory[]>(raw.error as AppError)
        : ok((raw.data ?? []) as ExpenseCategory[]);
    },

    async save(userId: string, payload: ExpenseCategoryPayload) {
      return settle(payload.id
        ? await supabase.from("expense_categories").update(payload).eq("id", payload.id)
        : await supabase.from("expense_categories").insert({ ...payload, user_id: userId }));
    },

    async remove(id) {
      return settle(await supabase.from("expense_categories").delete().eq("id", id));
    },

    async ensureCompanyCategory(userId: string, name: string) {
      const existing = await this.list();
      if (existing.error) return err<ExpenseCategory>(existing.error);

      const found = existing.data.find((category) => category.type === "company" && category.name === name);
      if (found) return ok(found);

      const created = await supabase
        .from("expense_categories")
        .insert({ name, type: "company", status: "active", user_id: userId })
        .select(EXPENSE_CATEGORY_SELECT)
        .single();

      return created.error
        ? err<ExpenseCategory>(created.error as AppError)
        : ok(created.data as ExpenseCategory);
    },
  };
}
