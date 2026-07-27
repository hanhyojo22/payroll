import type { CollectionRepository, RecordCollectionPaymentInput, SaveCollectionInput } from "../core/ports/collections";
import type { ExpenseCategoryRepository, ExpenseRepository } from "../core/ports/expenses";
import type { PayrollRepository } from "../core/ports/payroll";
import type { EmployeeAdvanceRepository, SalaryBondRepository } from "../core/ports/salaryBonds";
import { err, ok, type Result } from "../core/ports/result";
import { withCollectionTotals } from "../domain/collections";
import type { CollectionPayment, CollectionReminder, Expense, ExpenseCategory, PayrollHistoryRow, PayrollRunItem, PayrollRunWithItems, PayrollSettings, EmployeeAdvance, SalaryBond } from "../types";
import type { AppError } from "../shared/types";

export type FakeCollectionRepository = CollectionRepository & {
  /** Prime the next call to fail, so use-case error branches are reachable in tests. */
  failNext(error: AppError): void;
  /** Seed existing rows without going through save(). */
  seed(collections: CollectionReminder[]): void;
};

/**
 * In-memory CollectionRepository. Recomputes totals through the real domain helper rather
 * than storing them, so a test that asserts on a balance is exercising the same arithmetic
 * production uses.
 */
export function fakeCollectionRepository(): FakeCollectionRepository {
  let rows: CollectionReminder[] = [];
  let pendingFailure: AppError | null = null;

  function takeFailure<T>(): Result<T> | null {
    if (!pendingFailure) return null;
    const failure = pendingFailure;
    pendingFailure = null;
    return err<T>(failure);
  }

  const totalled = (row: CollectionReminder) => withCollectionTotals(row);

  return {
    failNext(error) {
      pendingFailure = error;
    },

    seed(collections) {
      rows = collections.map(totalled);
    },

    async list() {
      return takeFailure<CollectionReminder[]>() ?? ok(rows.map(totalled));
    },

    async save({ id, userId, values }: SaveCollectionInput) {
      const failure = takeFailure<void>();
      if (failure) return failure;

      const now = new Date().toISOString();
      const existing = id ? rows.find((row) => row.id === id) : undefined;
      const next: CollectionReminder = totalled({
        id: id ?? crypto.randomUUID(),
        user_id: userId,
        collection_no: existing?.collection_no ?? null,
        title: values.title.trim(),
        client_name: values.client_name.trim(),
        external_reference: values.external_reference.trim(),
        issue_date: values.issue_date,
        amount: Number(values.amount),
        due_date: values.due_date,
        status: existing?.status ?? "pending",
        notes: values.notes.trim(),
        archived_at: existing?.archived_at ?? null,
        amount_paid: 0,
        outstanding_balance: 0,
        payments: existing?.payments ?? [],
        created_at: existing?.created_at ?? now,
        updated_at: now,
      });

      rows = existing
        ? rows.map((row) => (row.id === next.id ? next : row))
        : [next, ...rows];
      return ok(undefined);
    },

    async archive(id) {
      const failure = takeFailure<void>();
      if (failure) return failure;
      rows = rows.map((row) => row.id === id ? totalled({ ...row, archived_at: new Date().toISOString() }) : row);
      return ok(undefined);
    },

    async restore(id) {
      const failure = takeFailure<void>();
      if (failure) return failure;
      rows = rows.map((row) => row.id === id ? totalled({ ...row, archived_at: null }) : row);
      return ok(undefined);
    },

    async recordPayment({ collectionId, paymentId, values }: RecordCollectionPaymentInput) {
      const failure = takeFailure<void>();
      if (failure) return failure;

      const now = new Date().toISOString();
      rows = rows.map((row) => {
        if (row.id !== collectionId) return row;
        const entry: CollectionPayment = {
          id: paymentId,
          user_id: row.user_id,
          collection_id: row.id,
          amount: Number(values.amount),
          payment_date: values.payment_date,
          payment_method: values.payment_method,
          reference_number: values.reference_number.trim(),
          notes: values.notes.trim(),
          is_void: false,
          void_reason: "",
          voided_at: null,
          created_at: now,
          updated_at: now,
        };
        return totalled({ ...row, payments: [entry, ...row.payments] });
      });
      return ok(undefined);
    },

    async voidPayment(paymentId, reason) {
      const failure = takeFailure<void>();
      if (failure) return failure;

      const now = new Date().toISOString();
      rows = rows.map((row) => totalled({
        ...row,
        payments: row.payments.map((entry) => entry.id === paymentId
          ? { ...entry, is_void: true, void_reason: reason, voided_at: now }
          : entry),
      }));
      return ok(undefined);
    },
  };
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export type FakeExpenseRepository = ExpenseRepository & {
  failNext(error: AppError): void;
  seed(expenses: Expense[]): void;
};

export function fakeExpenseRepository(): FakeExpenseRepository {
  let rows: Expense[] = [];
  let pendingFailure: AppError | null = null;

  function takeFailure<T>(): Result<T> | null {
    if (!pendingFailure) return null;
    const failure = pendingFailure;
    pendingFailure = null;
    return err<T>(failure);
  }

  return {
    failNext(error) {
      pendingFailure = error;
    },

    seed(expenses) {
      rows = [...expenses];
    },

    async list() {
      return takeFailure<Expense[]>() ?? ok(rows);
    },

    async save(payload) {
      const failure = takeFailure<void>();
      if (failure) return failure;

      const persistedStatus = payload.status === "paid" || payload.status === "cancelled" ? payload.status : "pending";
      const existing = rows.find((row) => row.id === payload.id);
      const next: Expense = {
        ...payload,
        status: persistedStatus,
        paid_date: persistedStatus === "paid" ? payload.paid_date : null,
        installment_payments: existing?.installment_payments ?? [],
        created_at: existing?.created_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      rows = existing ? rows.map((row) => row.id === next.id ? next : row) : [next, ...rows];
      return ok(undefined);
    },

    async remove(id) {
      const failure = takeFailure<void>();
      if (failure) return failure;
      rows = rows.filter((row) => row.id !== id);
      return ok(undefined);
    },

    async cancel(id) {
      const failure = takeFailure<void>();
      if (failure) return failure;
      rows = rows.map((row) => row.id === id ? { ...row, status: "cancelled" } : row);
      return ok(undefined);
    },

    async updateCompletion(id, patch) {
      const failure = takeFailure<void>();
      if (failure) return failure;
      rows = rows.map((row) => row.id === id ? { ...row, ...patch } : row);
      return ok(undefined);
    },

    async payInstallment({ payment, expenseId, expensePatch }) {
      const failure = takeFailure<void>();
      if (failure) return failure;
      // Mirrors the RPC: payment insert and expense patch land together or not at all.
      rows = rows.map((row) => row.id === expenseId
        ? {
          ...row,
          ...expensePatch,
          installment_payments: [...row.installment_payments, { ...payment, created_at: new Date().toISOString() }],
        }
        : row);
      return ok(undefined);
    },

    async deleteInstallmentPayment(paymentId) {
      const failure = takeFailure<void>();
      if (failure) return failure;
      rows = rows.map((row) => ({
        ...row,
        installment_payments: row.installment_payments.filter((payment) => payment.id !== paymentId),
      }));
      return ok(undefined);
    },

    async addInstallmentPayment(userId, expenseId, payload) {
      const failure = takeFailure<void>();
      if (failure) return failure;
      rows = rows.map((row) => row.id === expenseId
        ? {
          ...row,
          installment_payments: [...row.installment_payments, {
            ...payload, id: crypto.randomUUID(), user_id: userId,
            expense_id: expenseId, created_at: new Date().toISOString(),
          }],
        }
        : row);
      return ok(undefined);
    },
  };
}

export type FakeExpenseCategoryRepository = ExpenseCategoryRepository & {
  failNext(error: AppError): void;
  seed(categories: ExpenseCategory[]): void;
};

export function fakeExpenseCategoryRepository(): FakeExpenseCategoryRepository {
  let rows: ExpenseCategory[] = [];
  let pendingFailure: AppError | null = null;

  function takeFailure<T>(): Result<T> | null {
    if (!pendingFailure) return null;
    const failure = pendingFailure;
    pendingFailure = null;
    return err<T>(failure);
  }

  return {
    failNext(error) {
      pendingFailure = error;
    },

    seed(categories) {
      rows = [...categories];
    },

    async list() {
      return takeFailure<ExpenseCategory[]>() ?? ok(rows);
    },

    async save(userId, payload) {
      const failure = takeFailure<void>();
      if (failure) return failure;
      const now = new Date().toISOString();
      const existing = payload.id ? rows.find((row) => row.id === payload.id) : undefined;
      const next: ExpenseCategory = {
        id: payload.id ?? crypto.randomUUID(),
        user_id: userId,
        name: payload.name,
        type: payload.type,
        status: payload.status,
        created_at: existing?.created_at ?? now,
        updated_at: now,
      };
      rows = existing ? rows.map((row) => row.id === next.id ? next : row) : [...rows, next];
      return ok(undefined);
    },

    async remove(id) {
      const failure = takeFailure<void>();
      if (failure) return failure;
      rows = rows.filter((row) => row.id !== id);
      return ok(undefined);
    },

    async ensureCompanyCategory(userId, name) {
      const failure = takeFailure<ExpenseCategory>();
      if (failure) return failure;
      const found = rows.find((row) => row.type === "company" && row.name === name);
      if (found) return ok(found);
      const now = new Date().toISOString();
      const created: ExpenseCategory = {
        id: crypto.randomUUID(), user_id: userId, name, type: "company",
        status: "active", created_at: now, updated_at: now,
      };
      rows = [...rows, created];
      return ok(created);
    },
  };
}

// ---------------------------------------------------------------------------
// Payroll
// ---------------------------------------------------------------------------

export type FakePayrollRepository = PayrollRepository & {
  failNext(error: AppError): void;
  seedItems(items: PayrollRunItem[]): void;
  itemsFor(runId: string): PayrollRunItem[];
};

export function fakePayrollRepository(): FakePayrollRepository {
  let items: PayrollRunItem[] = [];
  let pendingFailure: AppError | null = null;

  function takeFailure<T>(): Result<T> | null {
    if (!pendingFailure) return null;
    const failure = pendingFailure;
    pendingFailure = null;
    return err<T>(failure);
  }

  return {
    failNext(error) {
      pendingFailure = error;
    },

    seedItems(next) {
      items = [...next];
    },

    itemsFor(runId) {
      return items.filter((item) => item.payroll_run_id === runId);
    },

    async listRuns() {
      return takeFailure<PayrollRunWithItems[]>() ?? ok([]);
    },

    async listRunItems(runId) {
      return takeFailure<PayrollRunItem[]>() ?? ok(items.filter((item) => item.payroll_run_id === runId));
    },

    async listHistory() {
      return takeFailure<PayrollHistoryRow[]>() ?? ok([]);
    },

    async getSettings() {
      return takeFailure<PayrollSettings | null>() ?? ok(null);
    },

    async ensureSettings(userId) {
      const failure = takeFailure<PayrollSettings>();
      if (failure) return failure;
      return ok({
        id: "settings-1", user_id: userId,
        government_deduction_enabled: true, government_deduction_cutoff: "second_half",
        created_at: "", updated_at: "",
      } as PayrollSettings);
    },

    async saveSettings() {
      return takeFailure<void>() ?? ok(undefined);
    },

    async updateItem(id, patch) {
      const failure = takeFailure<void>();
      if (failure) return failure;
      items = items.map((item) => item.id === id ? { ...item, ...patch } : item);
      return ok(undefined);
    },

    async saveBundle() {
      return takeFailure<void>() ?? ok(undefined);
    },

    async saveItemsBundle() {
      return takeFailure<void>() ?? ok(undefined);
    },

    async findRunId() {
      return takeFailure<string | null>() ?? ok(null);
    },

    async insertSalaryBondTransactions() {
      return takeFailure<void>() ?? ok(undefined);
    },
  };
}

// ---------------------------------------------------------------------------
// Salary bonds and employee advances
// ---------------------------------------------------------------------------

export type FakeSalaryBondRepository = SalaryBondRepository & {
  failNext(error: AppError): void;
  seed(bonds: SalaryBond[]): void;
  transactions(): Record<string, unknown>[];
};

export function fakeSalaryBondRepository(): FakeSalaryBondRepository {
  let rows: SalaryBond[] = [];
  let written: Record<string, unknown>[] = [];
  let pendingFailure: AppError | null = null;

  function takeFailure<T>(): Result<T> | null {
    if (!pendingFailure) return null;
    const failure = pendingFailure;
    pendingFailure = null;
    return err<T>(failure);
  }

  return {
    failNext(error) {
      pendingFailure = error;
    },
    seed(bonds) {
      rows = [...bonds];
    },
    transactions() {
      return written;
    },

    async list() {
      return takeFailure<SalaryBond[]>() ?? ok(rows);
    },

    async save(payload, id) {
      const failure = takeFailure<void>();
      if (failure) return failure;
      const now = new Date().toISOString();
      const existing = id ? rows.find((row) => row.id === id) : undefined;
      const next = {
        ...(existing ?? {}),
        ...payload,
        id: id ?? crypto.randomUUID(),
        bond_reference: existing?.bond_reference ?? "SB-TEST",
        status: existing?.status ?? "active",
        transactions: existing?.transactions ?? [],
        created_at: existing?.created_at ?? now,
        updated_at: now,
      } as SalaryBond;
      rows = existing ? rows.map((row) => row.id === next.id ? next : row) : [next, ...rows];
      return ok(undefined);
    },

    async archive(id) {
      const failure = takeFailure<void>();
      if (failure) return failure;
      rows = rows.map((row) => row.id === id ? { ...row, status: "archived" } : row);
      return ok(undefined);
    },

    async reactivate(id) {
      const failure = takeFailure<void>();
      if (failure) return failure;
      rows = rows.map((row) => row.id === id ? { ...row, status: "active" } : row);
      return ok(undefined);
    },

    async recordWithdrawal(input) {
      const failure = takeFailure<void>();
      if (failure) return failure;
      written.push({ ...input, type: "withdrawal" });
      return ok(undefined);
    },

    async voidTransaction(transactionId, reason) {
      const failure = takeFailure<void>();
      if (failure) return failure;
      written.push({ transactionId, reason, voided: true });
      return ok(undefined);
    },

    async insertTransactions(payloads) {
      const failure = takeFailure<void>();
      if (failure) return failure;
      written = [...written, ...payloads];
      return ok(undefined);
    },
  };
}

export type FakeEmployeeAdvanceRepository = EmployeeAdvanceRepository & {
  failNext(error: AppError): void;
  seed(advances: EmployeeAdvance[]): void;
};

export function fakeEmployeeAdvanceRepository(): FakeEmployeeAdvanceRepository {
  let rows: EmployeeAdvance[] = [];
  let pendingFailure: AppError | null = null;

  function takeFailure<T>(): Result<T> | null {
    if (!pendingFailure) return null;
    const failure = pendingFailure;
    pendingFailure = null;
    return err<T>(failure);
  }

  return {
    failNext(error) {
      pendingFailure = error;
    },
    seed(advances) {
      rows = [...advances];
    },

    async list() {
      return takeFailure<EmployeeAdvance[]>() ?? ok(rows);
    },

    async save(payload, id) {
      const failure = takeFailure<void>();
      if (failure) return failure;
      const now = new Date().toISOString();
      const existing = id ? rows.find((row) => row.id === id) : undefined;
      const next = {
        ...payload,
        id: id ?? payload.id,
        created_at: existing?.created_at ?? now,
        updated_at: now,
      } as EmployeeAdvance;
      rows = existing ? rows.map((row) => row.id === next.id ? next : row) : [next, ...rows];
      return ok(undefined);
    },

    async applyBalances(updates) {
      const failure = takeFailure<void>();
      if (failure) return failure;
      rows = rows.map((row) => {
        const update = updates.find((item) => item.id === row.id);
        return update ? { ...row, balance: update.balance, status: update.status } : row;
      });
      return ok(undefined);
    },
  };
}
