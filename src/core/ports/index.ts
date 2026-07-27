import type { CollectionRepository } from "./collections";
import type { ExpenseCategoryRepository, ExpenseRepository } from "./expenses";
import type { PayrollRepository } from "./payroll";

/**
 * Everything the app can reach the database through. One entry per feature, added as each
 * vertical is converted -- so this type is also the migration's progress marker.
 */
export type Repositories = {
  collections: CollectionRepository;
  expenses: ExpenseRepository;
  expenseCategories: ExpenseCategoryRepository;
  payroll: PayrollRepository;
};

export type { CollectionRepository, RecordCollectionPaymentInput, SaveCollectionInput } from "./collections";
export type {
  ExpenseCategoryPayload,
  ExpenseCategoryRepository,
  ExpenseCompletionPatch,
  ExpensePayload,
  ExpenseRepository,
  PayInstallmentInput,
} from "./expenses";
export type {
  PayrollBundle,
  PayrollItemsBundle,
  PayrollRepository,
  PayrollSettingsPayload,
} from "./payroll";
export { err, isOk, ok, type Result } from "./result";
