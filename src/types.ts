export type PaymentType = "loan" | "bill";
export type PaymentStatus = "pending" | "paid" | "overdue";
export type CollectionStatus = "pending" | "collected" | "overdue";
export type PayrollItemStatus = "pending" | "paid";
export type SalaryBondStatus = "active" | "completed" | "archived";
export type EmployeeStatus = "active" | "inactive";
export type EmployeeWageCategory = "new" | "special_old";
export type PayrollPayPeriod = "first_half" | "second_half";

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

export type CollectionReminder = {
  id: string;
  user_id: string;
  title: string;
  client_name: string;
  amount: number;
  due_date: string;
  status: CollectionStatus;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type SalaryBond = {
  id: string;
  user_id: string;
  employee_id: string | null;
  employee_name: string;
  bond_id: string;
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
  installation_tickets: number;
  repair_tickets: number;
  installation_rate: number;
  repair_rate: number;
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

export type DailyTicketEntry = {
  id: string;
  user_id: string;
  entry_date: string;
  employee_id: string;
  employee_name: string;
  installation_tickets: number;
  repair_tickets: number;
  installation_rate: number;
  repair_rate: number;
  created_at: string;
  updated_at: string;
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
  amount: string;
  due_date: string;
  status: CollectionStatus;
  notes: string;
};

export type SalaryBondFormValues = {
  employee_id: string;
  bond_id: string;
  amount: string;
  balance: string;
  deduction_per_payroll: string;
  status: SalaryBondStatus;
  notes: string;
};

export type EmployeeFormValues = {
  full_name: string;
  role: string;
  department: string;
  contact_number: string;
  email: string;
  address: string;
  profile_photo_url: string;
  hire_date: string;
  status: EmployeeStatus;
  wage_category: EmployeeWageCategory;
  monthly_salary: string;
  sss_number: string;
  philhealth_number: string;
  pagibig_number: string;
  tin_number: string;
  notes: string;
};

export type PayrollRunFormValues = {
  period_month: string;
  period_year: string;
  pay_period: PayrollPayPeriod;
  generated_date: string;
  notes: string;
};
