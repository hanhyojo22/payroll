import type { SupabaseClient } from "@supabase/supabase-js";
import type { CollectionPaymentMethod, Expense, ExpenseCategory, ExpenseCategoryType, ExpenseInstallmentPayment } from "../../types";

const EXPENSE_CATEGORY_SELECT = "id,user_id,name,type,status,created_at,updated_at";
const EXPENSE_INSTALLMENT_PAYMENT_SELECT = "id,user_id,expense_id,amount,payment_date,payment_method,reference_number,notes,created_at";
const EXPENSE_SELECT = `id,user_id,employee_id,employee_name,category_id,category_name,amount,frequency,duration_months,status,paid_date,expense_date,due_date,payment_date,notes,payroll_run_id,subcontractor_payment_reminder_id,created_at,updated_at,installment_payments:expense_installment_payments(${EXPENSE_INSTALLMENT_PAYMENT_SELECT})`;

export async function fetchExpenseCategories(supabase: SupabaseClient) {
  const result = await supabase
    .from("expense_categories")
    .select(EXPENSE_CATEGORY_SELECT)
    .order("name");

  return { data: (result.data ?? []) as ExpenseCategory[], error: result.error };
}

export async function saveExpenseCategory(
  supabase: SupabaseClient,
  userId: string,
  payload: { id?: string; name: string; type: ExpenseCategoryType; status: "active" | "archived" },
) {
  if (payload.id) {
    return supabase
      .from("expense_categories")
      .update(payload)
      .eq("id", payload.id)
      .select(EXPENSE_CATEGORY_SELECT)
      .single();
  }

  return supabase
    .from("expense_categories")
    .insert({ ...payload, user_id: userId })
    .select(EXPENSE_CATEGORY_SELECT)
    .single();
}

export async function deleteExpenseCategory(supabase: SupabaseClient, categoryId: string) {
  return supabase.from("expense_categories").delete().eq("id", categoryId);
}

export async function ensurePayrollExpenseCategory(supabase: SupabaseClient, userId: string) {
  return ensureNamedCompanyExpenseCategory(supabase, userId, "Payroll");
}

export async function ensureSubcontractorPayoutExpenseCategory(supabase: SupabaseClient, userId: string) {
  return ensureNamedCompanyExpenseCategory(supabase, userId, "Subcontractor Payout");
}

async function ensureNamedCompanyExpenseCategory(supabase: SupabaseClient, userId: string, name: string) {
  const existing = await fetchExpenseCategories(supabase);
  const found = existing.data.find((category) => category.type === "company" && category.name === name);
  if (found) return { data: found, error: null };

  const result = await saveExpenseCategory(supabase, userId, { name, type: "company", status: "active" });
  return { data: result.data as ExpenseCategory | null, error: result.error };
}

export async function fetchExpenses(supabase: SupabaseClient) {
  const result = await supabase
    .from("expenses")
    .select(EXPENSE_SELECT)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });

  return { data: (result.data ?? []) as Expense[], error: result.error };
}

export async function saveExpense(
  supabase: SupabaseClient,
  payload: Omit<Expense, "created_at" | "updated_at" | "installment_payments">,
) {
  const persistedStatus = payload.status === "paid" || payload.status === "cancelled" ? payload.status : "pending";
  return supabase
    .from("expenses")
    .upsert({
      ...payload,
      status: persistedStatus,
      paid_date: persistedStatus === "paid" ? payload.paid_date : null,
    })
    .select(EXPENSE_SELECT)
    .single();
}

export async function deleteExpense(supabase: SupabaseClient, expenseId: string) {
  return supabase.from("expenses").delete().eq("id", expenseId);
}

export async function markExpensePaid(supabase: SupabaseClient, expenseId: string, paidDate: string) {
  return supabase
    .from("expenses")
    .update({ status: "paid", paid_date: paidDate })
    .eq("id", expenseId)
    .select(EXPENSE_SELECT)
    .single();
}

export async function markExpensePending(supabase: SupabaseClient, expenseId: string) {
  return supabase
    .from("expenses")
    .update({ status: "pending", paid_date: null })
    .eq("id", expenseId)
    .select(EXPENSE_SELECT)
    .single();
}

export async function cancelExpense(supabase: SupabaseClient, expenseId: string) {
  return supabase
    .from("expenses")
    .update({ status: "cancelled" })
    .eq("id", expenseId)
    .select(EXPENSE_SELECT)
    .single();
}

export async function updateExpenseCompletion(
  supabase: SupabaseClient,
  expenseId: string,
  payload: { status: "pending" | "paid"; paid_date: string | null },
) {
  return supabase
    .from("expenses")
    .update(payload)
    .eq("id", expenseId)
    .select(EXPENSE_SELECT)
    .single();
}

export async function payExpenseInstallment(
  supabase: SupabaseClient,
  userId: string,
  expenseId: string,
  payload: {
    amount: number;
    payment_date: string;
    payment_method: CollectionPaymentMethod;
    reference_number: string;
    notes: string;
  },
) {
  const result = await supabase
    .from("expense_installment_payments")
    .insert({ ...payload, user_id: userId, expense_id: expenseId })
    .select(EXPENSE_INSTALLMENT_PAYMENT_SELECT)
    .single();
  return { data: result.data as ExpenseInstallmentPayment | null, error: result.error };
}

export async function deleteExpenseInstallmentPayment(supabase: SupabaseClient, paymentId: string) {
  return supabase.from("expense_installment_payments").delete().eq("id", paymentId);
}
