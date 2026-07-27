import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  EmployeeAdvanceBalanceUpdate,
  EmployeeAdvancePayload,
  EmployeeAdvanceRepository,
  SalaryBondPayload,
  SalaryBondRepository,
  SalaryBondWithdrawal,
} from "../../core/ports/salaryBonds";
import { err, ok, type Result } from "../../core/ports/result";
import type { AppError } from "../../shared/types";
import type { EmployeeAdvance, SalaryBond } from "../../types";
import { normalizeSalaryBond } from "../../features/salaryBonds/mapping";

const SALARY_BOND_SELECT =
  "id,user_id,employee_id,employee_name,bond_reference,target_amount,deduction_per_payroll,start_deduction,status,notes,created_at,updated_at,transactions:employee_salary_bond_transactions(id,user_id,salary_bond_id,employee_id,type,amount,transaction_date,payroll_run_id,payroll_run_item_id,note,is_void,void_reason,voided_at,created_at,updated_at)";

const EMPLOYEE_ADVANCE_SELECT =
  "id,user_id,employee_id,employee_name,advance_id,advance_type,date_granted,start_deduction,purpose,amount,balance,deduction_per_payroll,status,notes,created_at,updated_at";

const settle = (raw: { error: unknown }): Result<void> =>
  raw.error ? err<void>(raw.error as AppError) : ok(undefined as void);

export function supabaseSalaryBondRepository(supabase: SupabaseClient): SalaryBondRepository {
  return {
    async list() {
      const raw = await supabase
        .from("employee_salary_bonds")
        .select(SALARY_BOND_SELECT)
        .order("created_at", { ascending: false });

      return raw.error
        ? err<SalaryBond[]>(raw.error as AppError)
        : ok(((raw.data ?? []) as unknown as SalaryBond[]).map(normalizeSalaryBond));
    },

    async save(payload: SalaryBondPayload, id?: string) {
      if (id) {
        return settle(await supabase.from("employee_salary_bonds").update(payload).eq("id", id));
      }
      const bondReference = `SB-${Date.now().toString(36).toUpperCase()}`;
      return settle(await supabase.from("employee_salary_bonds").insert({ ...payload, bond_reference: bondReference }));
    },

    async archive(id) {
      return settle(await supabase.from("employee_salary_bonds").update({ status: "archived" }).eq("id", id));
    },

    async reactivate(id) {
      return settle(await supabase.from("employee_salary_bonds").update({ status: "active" }).eq("id", id));
    },

    async recordWithdrawal(input: SalaryBondWithdrawal) {
      return settle(await supabase.rpc("record_salary_bond_withdrawal", {
        bond_id: input.bondId,
        transaction_id: input.transactionId,
        withdrawal_amount: input.amount,
        withdrawn_on: input.transactionDate,
        withdrawal_note: input.note,
      }));
    },

    async voidTransaction(transactionId, reason) {
      return settle(await supabase.rpc("void_salary_bond_transaction", {
        transaction_id: transactionId,
        reason: reason.trim(),
      }));
    },

    async insertTransactions(payloads) {
      if (payloads.length === 0) return ok(undefined as void);
      return settle(await supabase.from("employee_salary_bond_transactions").insert(payloads));
    },
  };
}

export function supabaseEmployeeAdvanceRepository(supabase: SupabaseClient): EmployeeAdvanceRepository {
  return {
    async list() {
      const raw = await supabase
        .from("employee_advances")
        .select(EMPLOYEE_ADVANCE_SELECT)
        .order("created_at", { ascending: false });

      return raw.error
        ? err<EmployeeAdvance[]>(raw.error as AppError)
        : ok((raw.data ?? []) as EmployeeAdvance[]);
    },

    async save(payload: EmployeeAdvancePayload, id?: string) {
      return settle(id
        ? await supabase.from("employee_advances").update(payload).eq("id", id)
        : await supabase.from("employee_advances").insert(payload));
    },

    async applyBalances(updates: EmployeeAdvanceBalanceUpdate[]) {
      if (updates.length === 0) return ok(undefined as void);
      const results = await Promise.all(updates.map((update) => supabase
        .from("employee_advances")
        .update({ balance: update.balance, status: update.status })
        .eq("id", update.id)));

      const failed = results.find((result) => result.error);
      return failed ? err<void>(failed.error as AppError) : ok(undefined as void);
    },
  };
}
