import type { SupabaseClient } from "@supabase/supabase-js";
import type { Repositories } from "../../core/ports";
import { supabaseCollectionRepository } from "./collectionRepository";
import { supabaseExpenseCategoryRepository, supabaseExpenseRepository } from "./expenseRepository";

/**
 * Composition root for data access: the single place where a SupabaseClient is turned into
 * the port implementations the rest of the app depends on.
 */
export function createSupabaseRepositories(supabase: SupabaseClient): Repositories {
  return {
    collections: supabaseCollectionRepository(supabase),
    expenses: supabaseExpenseRepository(supabase),
    expenseCategories: supabaseExpenseCategoryRepository(supabase),
  };
}
