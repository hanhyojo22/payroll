import type {
  BillingRecordRepository,
  BillingSettingsRepository,
  PaymentReminderRepository,
  SubconDailyTicketRepository,
  SubcontractorAdvanceRepository,
  SubcontractorRepository,
} from "./billing";
import type { CollectionRepository } from "./collections";
import type { ExpenseCategoryRepository, ExpenseRepository } from "./expenses";
import type { PayrollRepository } from "./payroll";
import type { EmployeeAdvanceRepository, SalaryBondRepository } from "./salaryBonds";

/**
 * Everything the app can reach the database through. One entry per feature, added as each
 * vertical is converted -- so this type is also the migration's progress marker.
 */
export type Repositories = {
  collections: CollectionRepository;
  expenses: ExpenseRepository;
  expenseCategories: ExpenseCategoryRepository;
  payroll: PayrollRepository;
  salaryBonds: SalaryBondRepository;
  employeeAdvances: EmployeeAdvanceRepository;
  billingSettings: BillingSettingsRepository;
  billingRecords: BillingRecordRepository;
  subcontractors: SubcontractorRepository;
  subconDailyTickets: SubconDailyTicketRepository;
  subcontractorAdvances: SubcontractorAdvanceRepository;
  paymentReminders: PaymentReminderRepository;
};

export type {
  BillingRecordRepository,
  BillingSettingsPayload,
  BillingSettingsRepository,
  PaymentReminderPaymentPayload,
  PaymentReminderRepository,
  SubconDailyTicketPayload,
  SubconDailyTicketRepository,
  SubcontractorAdvancePayload,
  SubcontractorAdvanceRepository,
  SubcontractorPayload,
  SubcontractorRepository,
} from "./billing";
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
export type {
  EmployeeAdvanceBalanceUpdate,
  EmployeeAdvancePayload,
  EmployeeAdvanceRepository,
  SalaryBondPayload,
  SalaryBondRepository,
  SalaryBondWithdrawal,
} from "./salaryBonds";
export { err, isOk, ok, type Result } from "./result";
