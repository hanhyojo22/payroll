import type { SupabaseClient } from "@supabase/supabase-js";
import type { Repositories } from "../../core/ports";
import {
  supabaseBillingRecordRepository,
  supabaseBillingSettingsRepository,
  supabasePaymentReminderRepository,
  supabaseSubconDailyTicketRepository,
  supabaseSubcontractorAdvanceRepository,
  supabaseSubcontractorRepository,
} from "./billingRepository";
import { supabaseCollectionRepository } from "./collectionRepository";
import { supabaseExpenseCategoryRepository, supabaseExpenseRepository } from "./expenseRepository";
import { supabasePayrollRepository } from "./payrollRepository";
import { supabaseEmployeeAdvanceRepository, supabaseSalaryBondRepository } from "./salaryBondRepository";

/**
 * Composition root for data access: the single place where a SupabaseClient is turned into
 * the port implementations the rest of the app depends on.
 */
export function createSupabaseRepositories(supabase: SupabaseClient): Repositories {
  return {
    collections: supabaseCollectionRepository(supabase),
    expenses: supabaseExpenseRepository(supabase),
    expenseCategories: supabaseExpenseCategoryRepository(supabase),
    payroll: supabasePayrollRepository(supabase),
    salaryBonds: supabaseSalaryBondRepository(supabase),
    employeeAdvances: supabaseEmployeeAdvanceRepository(supabase),
    billingSettings: supabaseBillingSettingsRepository(supabase),
    billingRecords: supabaseBillingRecordRepository(supabase),
    subcontractors: supabaseSubcontractorRepository(supabase),
    subconDailyTickets: supabaseSubconDailyTicketRepository(supabase),
    subcontractorAdvances: supabaseSubcontractorAdvanceRepository(supabase),
    paymentReminders: supabasePaymentReminderRepository(supabase),
  };
}
