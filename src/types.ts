export type PaymentType = "loan" | "bill";
export type PaymentStatus = "pending" | "paid" | "overdue";
export type CollectionStatus = "pending" | "partial" | "collected" | "overdue" | "archived";
export type CollectionPaymentMethod = "cash" | "bank_transfer" | "check" | "e_wallet" | "card" | "other";
export type PayrollItemStatus = "pending" | "paid";
export type SalaryBondStatus = "active" | "completed" | "archived";
export type EmployeeStatus = "active" | "inactive";
export type EmployeeWageCategory = "new" | "special_old";
export type AttendanceStatus = "present" | "absent" | "half_day";
export type PositionStatus = "active" | "archived";
export type PositionPayMode = "fixed" | "ticket" | "hybrid" | "daily";
export type PayrollPayPeriod = "first_half" | "second_half";
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
  | "positions"
  | "salaryBonds"
  | "subconDailyTickets"
  | "subcontractors";

export type PositionTicketCategory = {
  id: string;
  user_id: string;
  position_id: string;
  name: string;
  rate: number;
  ticket_type: "installation" | "repair";
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
    ticket_type: "installation" | "repair";
    status: PositionStatus;
  }>;
};

export type PaymentReminder = {
  id: string;
  user_id: string;
  title: string;
  type: PaymentType;
  amount: number;
  due_date: string;
  status: PaymentStatus;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type ExpenseCategory = {
  id: string;
  user_id: string;
  name: string;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
};

export type Expense = {
  id: string;
  user_id: string;
  employee_id: string;
  employee_name: string;
  category_id: string;
  category_name: string;
  amount: number;
  expense_date: string;
  notes: string;
  created_at: string;
  updated_at: string;
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

export type SalaryBond = {
  id: string;
  user_id: string;
  employee_id: string | null;
  employee_name: string;
  bond_id: string;
  bond_type: string;
  date_granted: string;
  start_deduction: string;
  purpose: string;
  amount: number;
  balance: number;
  deduction_per_payroll: number;
  status: SalaryBondStatus;
  notes: string;
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
  status: EmployeeStatus;
  wage_category: EmployeeWageCategory;
  installation_rate?: number;
  repair_rate?: number;
  monthly_salary: number;
  sss_number: string;
  philhealth_number: string;
  pagibig_number: string;
  tin_number: string;
  gender: string;
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
};

export type PayrollHistoryRow = {
  payrollNo: string;
  payPeriod: string;
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
  installation_rate: number;
  repair_rate: number;
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
  ticket_type: "installation" | "repair";
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
  billing_month: number;
  billing_year: number;
  billing_period: BillingPeriod;
  install_tickets: number;
  repair_tickets: number;
  disputed_install: number;
  disputed_repair: number;
  total_tickets: number;
  disputed_tickets: number;
  billable_tickets: number;
  billing_rate: number;
  billing_amount: number;
  collections_pct: number;
  collections_amount: number;
  collectibles_amount: number;
  collection_id: string | null;
  collectibles_collection_id: string | null;
  subcon_items: BillingSubconItem[];
  notes: string;
  created_at: string;
  updated_at: string;
};

export type BillingFormValues = {
  billing_month: string;
  billing_year: string;
  billing_period: BillingPeriod;
  install_tickets: string;
  repair_tickets: string;
  disputed_install: string;
  disputed_repair: string;
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

export type SalaryBondFormValues = {
  employee_id: string;
  bond_type: string;
  date_granted: string;
  start_deduction: string;
  purpose: string;
  amount: string;
  balance: string;
  deduction_per_payroll: string;
  status: SalaryBondStatus;
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
  status: EmployeeStatus;
  wage_category: EmployeeWageCategory;
  gender: string;
  monthly_salary: string;
  sss_number: string;
  philhealth_number: string;
  pagibig_number: string;
  tin_number: string;
  emergency_contact_name: string;
  emergency_contact_number: string;
  emergency_contact_relation: string;
  notes: string;
};

export type PayrollRunFormValues = {
  period_month: string;
  period_year: string;
  pay_period: PayrollPayPeriod;
  generated_date: string;
  notes: string;
};
