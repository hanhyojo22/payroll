export type PaymentType = "loan" | "bill" | "subcontractor";
export type PaymentStatus = "pending" | "paid" | "overdue";
export type CollectionStatus = "pending" | "partial" | "collected" | "overdue" | "archived";
export type CollectionPaymentMethod = "cash" | "bank_transfer" | "check" | "e_wallet" | "card" | "other";
export type PayrollItemStatus = "pending" | "paid";
export type EmployeeAdvanceStatus = "active" | "completed" | "archived";
export type SubcontractorAdvanceStatus = "active" | "completed" | "archived";
export type SubcontractorAdvanceDeductionMode = "per_billing" | "full_payout";
export type EmployeeAdvanceType =
  | "Cash Advance"
  | "Salary Loan"
  | "Company Loan"
  | "Other Loan";
export type SalaryBondStatus = "active" | "archived";
export type SalaryBondTransactionType = "deduction" | "withdrawal";
export type EmployeeStatus = "active" | "inactive";
export type EmployeeWageCategory = "new" | "special_old";
export type AttendanceStatus = "present" | "absent" | "half_day";
export type PositionStatus = "active" | "archived";
export type PositionPayMode = "fixed" | "ticket" | "hybrid" | "daily";
export type ExpenseCategoryType = "personal" | "company";
export type ExpenseFrequency = "one_time" | "monthly" | "daily";
export type PayrollPayPeriod = "first_half" | "second_half";
export type PayrollGovernmentDeductionCutoff = PayrollPayPeriod;
export type ResourceKey =
  | "attendanceEntries"
  | "billingRecords"
  | "billingSettings"
  | "collections"
  | "dashboardSummary"
  | "dailyTicketEntries"
  | "expenseCategories"
  | "expenses"
  | "employees"
  | "payments"
  | "payrollHistory"
  | "payrollRuns"
  | "payrollSettings"
  | "positions"
  | "employeeAdvances"
  | "salaryBonds"
  | "subcontractorAdvances"
  | "subconDailyTickets"
  | "subcontractors";

export type PositionTicketCategory = {
  id: string;
  user_id: string;
  position_id: string;
  name: string;
  rate: number;
  ticket_type: "installation" | "repair" | "nap_rehab";
  display_order: number;
  status: PositionStatus;
  created_at: string;
  updated_at: string;
};

export type Position = {
  id: string;
  user_id: string;
  name: string;
  department: string;
  description: string;
  status: PositionStatus;
  pay_mode: PositionPayMode;
  monthly_base_salary: number;
  daily_rate: number;
  created_at: string;
  updated_at: string;
  categories: PositionTicketCategory[];
};

export type PositionFormValues = {
  name: string;
  department: string;
  description: string;
  status: PositionStatus;
  pay_mode: PositionPayMode;
  monthly_base_salary: string;
  daily_rate: string;
  categories: Array<{
    id?: string;
    name: string;
    rate: string;
    ticket_type: "installation" | "repair" | "nap_rehab";
    status: PositionStatus;
  }>;
};

export type PaymentReminderPayoutLeg = "payable" | "remainder";

export type PaymentReminder = {
  id: string;
  user_id: string;
  title: string;
  type: PaymentType;
  amount: number;
  due_date: string;
  status: PaymentStatus;
  notes: string;
  subcontractor_id: string | null;
  billing_subcon_item_id: string | null;
  billing_month: number | null;
  billing_year: number | null;
  billing_period: BillingPeriod | null;
  // Only meaningful when type === "subcontractor": distinguishes the payable_pct
  // installment from the remainder installment, since both belong to the subcontractor
  // and are tracked as two separate reminders linked to the same billing_subcon_item_id.
  payout_leg: PaymentReminderPayoutLeg;
  created_at: string;
  updated_at: string;
  payments: PaymentReminderPayment[];
};

export type PaymentReminderPayment = {
  id: string;
  user_id: string;
  payment_reminder_id: string;
  amount: number;
  payment_date: string;
  payment_method: CollectionPaymentMethod;
  reference_number: string;
  notes: string;
  created_at: string;
};

export type ExpenseCategory = {
  id: string;
  user_id: string;
  name: string;
  type: ExpenseCategoryType;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
};

export type ExpenseInstallmentPayment = {
  id: string;
  user_id: string;
  expense_id: string;
  amount: number;
  payment_date: string;
  payment_method: CollectionPaymentMethod;
  reference_number: string;
  notes: string;
  created_at: string;
};

export type ExpenseStatus = "pending" | "paid" | "cancelled";
export type ExpenseDisplayStatus = "unpaid" | "partial" | "paid" | "cancelled";

export type Expense = {
  id: string;
  user_id: string;
  employee_id: string | null;
  employee_name: string;
  category_id: string;
  category_name: string;
  amount: number;
  frequency: ExpenseFrequency;
  duration_months: number | null;
  installment_payments: ExpenseInstallmentPayment[];
  status: ExpenseStatus;
  paid_date: string | null;
  expense_date: string;
  due_date: string | null;
  payment_date: string | null;
  notes: string;
  payroll_run_id: string | null;
  subcontractor_payment_reminder_id: string | null;
  created_at: string;
  updated_at: string;
};

export type PaymentLedgerSource = "expense" | "loan" | "bill" | "subcontractor";

export type PaymentLedgerRow = {
  id: string;
  source: PaymentLedgerSource;
  paymentDate: string;
  label: string;
  vendor: string;
  category: string;
  categoryType: ExpenseCategoryType | null;
  amount: number;
  method: CollectionPaymentMethod | null;
  referenceNumber: string;
  status: string;
  expenseId: string | null;
  paymentReminderId: string | null;
  expenseAmount: number | null;
  expenseFrequency: ExpenseFrequency | null;
};

export type CollectionReminder = {
  id: string;
  user_id: string;
  collection_no: string | null;
  title: string;
  client_name: string;
  external_reference: string;
  issue_date: string;
  amount: number;
  due_date: string;
  status: CollectionStatus | "legacy_pending";
  notes: string;
  archived_at: string | null;
  amount_paid: number;
  outstanding_balance: number;
  payments: CollectionPayment[];
  created_at: string;
  updated_at: string;
};

export type CollectionPayment = {
  id: string;
  user_id: string;
  collection_id: string;
  amount: number;
  payment_date: string;
  payment_method: CollectionPaymentMethod;
  reference_number: string;
  notes: string;
  is_void: boolean;
  void_reason: string;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
};

export type EmployeeAdvance = {
  id: string;
  user_id: string;
  employee_id: string | null;
  employee_name: string;
  advance_id: string;
  advance_type: EmployeeAdvanceType;
  date_granted: string;
  start_deduction: string;
  purpose: string;
  amount: number;
  balance: number;
  deduction_per_payroll: number;
  status: EmployeeAdvanceStatus;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type SalaryBondTransaction = {
  id: string;
  user_id: string;
  salary_bond_id: string;
  employee_id: string | null;
  type: SalaryBondTransactionType;
  amount: number;
  transaction_date: string;
  payroll_run_id: string | null;
  payroll_run_item_id: string | null;
  note: string;
  is_void: boolean;
  void_reason: string;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SalaryBond = {
  id: string;
  user_id: string;
  employee_id: string | null;
  employee_name: string;
  bond_reference: string;
  target_amount: number;
  deduction_per_payroll: number;
  start_deduction: string;
  status: SalaryBondStatus;
  notes: string;
  transactions: SalaryBondTransaction[];
  balance: number;
  remaining_to_target: number;
  created_at: string;
  updated_at: string;
};

export type Employee = {
  id: string;
  user_id: string;
  full_name: string;
  role: string;
  position_id: string | null;
  department: string;
  contact_number: string;
  email: string;
  address: string;
  profile_photo_url: string;
  hire_date: string;
  date_of_birth: string;
  status: EmployeeStatus;
  wage_category: EmployeeWageCategory;
  installation_rate?: number;
  repair_rate?: number;
  nap_rehab_rate?: number;
  monthly_salary: number;
  sss_number: string;
  philhealth_number: string;
  pagibig_number: string;
  sss_deduction: number;
  philhealth_deduction: number;
  pagibig_deduction: number;
  withholding_tax: number;
  tin_number: string;
  gender: string;
  civil_status: string;
  emergency_contact_name: string;
  emergency_contact_number: string;
  emergency_contact_relation: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type PayrollRun = {
  id: string;
  user_id: string;
  period_month: number;
  period_year: number;
  pay_period: PayrollPayPeriod;
  generated_date: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type PayrollSettings = {
  id: string;
  user_id: string;
  government_deduction_enabled: boolean;
  government_deduction_cutoff: PayrollGovernmentDeductionCutoff;
  created_at: string;
  updated_at: string;
};

export type PayrollRunItem = {
  id: string;
  user_id: string;
  payroll_run_id: string;
  employee_id: string | null;
  employee_name: string;
  position_id: string | null;
  position_name: string;
  pay_mode: PositionPayMode | "legacy";
  base_pay: number;
  ticket_pay: number;
  ticket_details: PayrollTicketDetail[];
  installation_tickets: number;
  repair_tickets: number;
  installation_rate: number;
  repair_rate: number;
  nap_rehab_tickets: number;
  nap_rehab_rate: number;
  daily_rate: number;
  days_worked: number;
  total_working_days: number;
  gross_pay: number;
  allowances: number;
  deductions: number;
  net_pay: number;
  status: PayrollItemStatus;
  paid_date: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type PayrollRunWithItems = PayrollRun & {
  items: PayrollRunItem[];
};

export type DashboardLatestRun = Pick<
  PayrollRun,
  "id" | "period_month" | "period_year" | "pay_period" | "generated_date"
> & {
  item_count: number;
};

export type DashboardSummary = {
  activeEmployeeCount: number;
  currentPayrollItemCount: number;
  pendingPayroll: number;
  paidPayroll: number;
  pendingCollections: number;
  collectedTotal: number;
  overdueCollectionBalance: number;
  collectedThisMonth: number;
  collectionAging: {
    current: number;
    days1To30: number;
    days31To60: number;
    days61To90: number;
    daysOver90: number;
  };
  latestRun: DashboardLatestRun | null;
  dueTodayPayments: PaymentReminder[];
  overduePayments: PaymentReminder[];
  dueTodayCollections: CollectionReminder[];
  overdueCollections: CollectionReminder[];
  dueTodayExpenses: Expense[];
  overdueExpenses: Expense[];
};

export type PayrollHistoryRow = {
  payrollNo: string;
  payPeriod: string;
  periodMonth: number;
  periodYear: number;
  payPeriodCutoff: PayrollPayPeriod;
  employeeId: string | null;
  employeeName: string;
  department: string;
  grossPay: number;
  deductions: number;
  netPay: number;
  status: PayrollItemStatus;
  processedDate: string;
  searchText: string;
};

export type DailyTicketEntry = {
  id: string;
  user_id: string;
  entry_date: string;
  employee_id: string;
  employee_name: string;
  position_id: string | null;
  position_name: string;
  details: DailyTicketEntryDetail[];
  installation_tickets: number;
  repair_tickets: number;
  disputed_install?: number;
  disputed_repair?: number;
  installation_rate: number;
  repair_rate: number;
  nap_rehab_tickets: number;
  nap_rehab_rate: number;
  created_at: string;
  updated_at: string;
};

export type DailyTicketEntryDetail = {
  id: string;
  user_id: string;
  daily_ticket_entry_id: string;
  position_ticket_category_id: string | null;
  category_name: string;
  ticket_count: number;
  rate: number;
  ticket_type: "installation" | "repair" | "nap_rehab";
  created_at: string;
  updated_at: string;
};

export type AttendanceEntry = {
  id: string;
  user_id: string;
  employee_id: string;
  employee_name: string;
  position_id: string | null;
  position_name: string;
  entry_date: string;
  status: AttendanceStatus;
  time_in: string | null;
  time_out: string | null;
  created_at: string;
  updated_at: string;
};

export type PayrollTicketDetail = {
  id: string;
  user_id: string;
  payroll_run_item_id: string;
  position_ticket_category_id: string | null;
  category_name: string;
  ticket_count: number;
  rate: number;
  amount: number;
  created_at: string;
};

export type BillingSettings = {
  id: string;
  user_id: string;
  installation_rate: number;
  repair_rate: number;
  nap_rehab_rate: number;
  collections_pct: number;
  client_name: string;
  created_at: string;
  updated_at: string;
};

export type SubcontractorStatus = "active" | "archived";

export type Subcontractor = {
  id: string;
  user_id: string;
  name: string;
  installation_rate: number;
  repair_rate: number;
  payable_pct: number;
  status: SubcontractorStatus;
  email: string;
  contact_number: string;
  address: string;
  created_at: string;
  updated_at: string;
};

export type SubcontractorAdvance = {
  id: string;
  user_id: string;
  subcontractor_id: string | null;
  subcon_name: string;
  advance_id: string;
  date_granted: string;
  amount: number;
  balance: number;
  deduction_mode: SubcontractorAdvanceDeductionMode;
  deduction_per_billing: number;
  status: SubcontractorAdvanceStatus;
  notes: string;
  created_at: string;
  updated_at: string;
};


export type SubconDailyTicket = {
  id: string;
  user_id: string;
  entry_date: string;
  subcontractor_id: string;
  subcon_name: string;
  install_tickets: number;
  repair_tickets: number;
  disputed_install?: number;
  disputed_repair?: number;
  installation_rate: number;
  repair_rate: number;
  created_at: string;
  updated_at: string;
};

export type BillingSubconItem = {
  id: string;
  user_id: string;
  billing_record_id: string;
  subcontractor_id: string;
  subcon_name: string;
  install_tickets: number;
  repair_tickets: number;
  disputed_install: number;
  disputed_repair: number;
  installation_rate: number;
  repair_rate: number;
  billable_tickets: number;
  billing_amount: number;
  payable_pct: number;
  payable_amount: number;
  collection_amount: number;
  created_at: string;
};

export type BillingPeriod = "first_half" | "second_half";

export type BillingRecord = {
  id: string;
  user_id: string;
  invoice_no: string;
  billing_month: number;
  billing_year: number;
  billing_period: BillingPeriod;
  install_tickets: number;
  repair_tickets: number;
  disputed_install: number;
  disputed_repair: number;
  nap_rehab_tickets: number;
  disputed_nap_rehab: number;
  company_install_tickets: number;
  company_repair_tickets: number;
  company_disputed_install: number;
  company_disputed_repair: number;
  company_nap_rehab_tickets: number;
  company_disputed_nap_rehab: number;
  total_tickets: number;
  disputed_tickets: number;
  billable_tickets: number;
  billing_rate: number;
  installation_rate: number;
  repair_rate: number;
  nap_rehab_rate: number;
  billing_amount: number;
  collections_pct: number;
  collections_amount: number;
  collectibles_amount: number;
  collection_id: string | null;
  collectibles_collection_id: string | null;
  due_date: string;
  subcon_items: BillingSubconItem[];
  notes: string;
  created_at: string;
  updated_at: string;
};

export type BillingFormValues = {
  billing_month: string;
  billing_year: string;
  due_date: string;
  billing_period: BillingPeriod;
  install_tickets: string;
  repair_tickets: string;
  disputed_install: string;
  disputed_repair: string;
  nap_rehab_tickets: string;
  disputed_nap_rehab: string;
  company_install_tickets: string;
  company_repair_tickets: string;
  company_disputed_install: string;
  company_disputed_repair: string;
  company_nap_rehab_tickets: string;
  company_disputed_nap_rehab: string;
  installation_rate: string;
  repair_rate: string;
  nap_rehab_rate: string;
  collections_pct: string;
  subcon_items: Array<{
    id?: string;
    subcontractor_id: string;
    subcon_name: string;
    install_tickets: string;
    repair_tickets: string;
    disputed_install: string;
    disputed_repair: string;
    installation_rate: string;
    repair_rate: string;
    payable_pct: string;
  }>;
  notes: string;
};

export type PaymentFormValues = {
  title: string;
  type: PaymentType;
  amount: string;
  due_date: string;
  status: PaymentStatus;
  notes: string;
};

export type CollectionFormValues = {
  title: string;
  client_name: string;
  external_reference: string;
  issue_date: string;
  amount: string;
  due_date: string;
  notes: string;
};

export type CollectionPaymentFormValues = {
  amount: string;
  payment_date: string;
  payment_method: CollectionPaymentMethod;
  reference_number: string;
  notes: string;
};

export type EmployeeAdvanceFormValues = {
  employee_id: string;
  advance_type: EmployeeAdvanceType;
  date_granted: string;
  start_deduction: string;
  purpose: string;
  amount: string;
  balance: string;
  deduction_per_payroll: string;
  status: EmployeeAdvanceStatus;
  notes: string;
};

export type SalaryBondFormValues = {
  employee_id: string;
  target_amount: string;
  deduction_per_payroll: string;
  start_deduction: string;
  notes: string;
};

export type SalaryBondWithdrawalFormValues = {
  amount: string;
  transaction_date: string;
  note: string;
};

export type SubcontractorAdvanceFormValues = {
  subcontractor_id: string;
  date_granted: string;
  amount: string;
  deduction_mode: SubcontractorAdvanceDeductionMode;
  deduction_per_billing: string;
  status: SubcontractorAdvanceStatus;
  notes: string;
};

export type EmployeeFormValues = {
  full_name: string;
  role: string;
  position_id: string;
  department: string;
  contact_number: string;
  email: string;
  address: string;
  profile_photo_url: string;
  hire_date: string;
  date_of_birth: string;
  status: EmployeeStatus;
  wage_category: EmployeeWageCategory;
  gender: string;
  civil_status: string;
  monthly_salary: string;
  sss_number: string;
  philhealth_number: string;
  pagibig_number: string;
  sss_deduction: string;
  philhealth_deduction: string;
  pagibig_deduction: string;
  withholding_tax: string;
  tin_number: string;
  emergency_contact_name: string;
  emergency_contact_number: string;
  emergency_contact_relation: string;
  notes: string;
};

export type PayrollSettingsFormValues = {
  government_deduction_enabled: boolean;
  government_deduction_cutoff: PayrollGovernmentDeductionCutoff;
};

export type PayrollRunFormValues = {
  period_month: string;
  period_year: string;
  pay_period: PayrollPayPeriod;
  generated_date: string;
  notes: string;
};
