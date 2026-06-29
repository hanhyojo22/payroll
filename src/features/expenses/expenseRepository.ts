import type { SupabaseClient } from "@supabase/supabase-js";
import type { Expense, ExpenseCategory } from "../../types";

const EXPENSE_CATEGORY_SELECT = "id,user_id,name,status,created_at,updated_at";
const EXPENSE_SELECT = "id,user_id,employee_id,employee_name,category_id,category_name,amount,expense_date,notes,created_at,updated_at";

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
  payload: { id?: string; name: string; status: "active" | "archived" },
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
  payload: Omit<Expense, "created_at" | "updated_at">,
) {
  return supabase
    .from("expenses")
    .upsert(payload)
    .select(EXPENSE_SELECT)
    .single();
}

export async function deleteExpense(supabase: SupabaseClient, expenseId: string) {
  return supabase.from("expenses").delete().eq("id", expenseId);
}
