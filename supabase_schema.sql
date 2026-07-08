  create table if not exists public.payment_reminders (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    title text not null,
    type text not null check (type in ('loan', 'bill', 'subcontractor')),
    amount numeric(12, 2) not null check (amount >= 0),
    due_date date not null,
    status text not null default 'pending' check (status in ('pending', 'paid', 'overdue')),
    notes text not null default '',
    subcontractor_id uuid,
    billing_subcon_item_id uuid,
    billing_month integer check (billing_month is null or billing_month between 1 and 12),
    billing_year integer check (billing_year is null or billing_year between 1900 and 2200),
    billing_period text check (billing_period is null or billing_period in ('first_half', 'second_half')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create table if not exists public.expense_categories (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    type text not null default 'company' check (type in ('personal', 'company')),
    status text not null default 'active' check (status in ('active', 'archived')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, name)
  );

  create table if not exists public.collection_reminders (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    title text not null,
    client_name text not null,
    amount numeric(12, 2) not null check (amount >= 0),
    due_date date not null,
    status text not null default 'pending' check (status in ('pending', 'collected', 'overdue')),
    notes text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create table if not exists public.payroll_records (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    employee_name text not null,
    amount numeric(12, 2) not null check (amount >= 0),
    pay_date date not null,
    status text not null default 'pending' check (status in ('pending', 'paid')),
    notes text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create table if not exists public.employees (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    full_name text not null,
    role text not null default '',
    department text not null default '',
    contact_number text not null default '',
    email text not null default '',
    address text not null default '',
    profile_photo_url text not null default '',
    hire_date date,
    status text not null default 'active' check (status in ('active', 'inactive')),
    wage_category text not null default 'new' check (wage_category in ('new', 'special_old')),
    installation_rate numeric(12, 2) not null default 600 check (installation_rate >= 0),
    repair_rate numeric(12, 2) not null default 200 check (repair_rate >= 0),
    monthly_salary numeric(12, 2) not null default 0 check (monthly_salary >= 0),
    sss_number text not null default '',
    philhealth_number text not null default '',
    pagibig_number text not null default '',
    tin_number text not null default '',
    gender text not null default '' check (gender in ('', 'male', 'female', 'other')),
    notes text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create table if not exists public.expenses (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    employee_id uuid references public.employees(id) on delete cascade,
    employee_name text not null,
    category_id uuid not null references public.expense_categories(id) on delete restrict,
    category_name text not null,
    amount numeric(12, 2) not null default 0 check (amount >= 0),
    frequency text not null default 'one_time' check (frequency in ('one_time', 'monthly')),
    duration_months integer check (duration_months is null or duration_months > 0),
    paid_installments integer not null default 0 check (paid_installments >= 0),
    status text not null default 'pending' check (status in ('pending', 'paid')),
    paid_date date,
    expense_date date not null,
    due_date date,
    notes text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  do $$
  begin
    if exists (
      select 1
      from information_schema.tables
      where table_schema = 'public' and table_name = 'salary_bonds'
    ) and not exists (
      select 1
      from information_schema.tables
      where table_schema = 'public' and table_name = 'employee_advances'
    ) then
      alter table public.salary_bonds rename to employee_advances;
    end if;

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public' and table_name = 'employee_advances' and column_name = 'bond_id'
    ) then
      alter table public.employee_advances rename column bond_id to advance_id;
    end if;

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public' and table_name = 'employee_advances' and column_name = 'bond_type'
    ) then
      alter table public.employee_advances rename column bond_type to advance_type;
    end if;
  end
  $$;

  create table if not exists public.employee_advances (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    employee_id uuid references public.employees(id) on delete set null,
    employee_name text not null,
    advance_id text not null,
    advance_type text not null default 'Salary Bond',
    date_granted date not null default current_date,
    start_deduction date not null default current_date,
    purpose text not null default '',
    amount numeric(12, 2) not null default 0 check (amount >= 0),
    balance numeric(12, 2) not null default 0 check (balance >= 0),
    deduction_per_payroll numeric(12, 2) not null default 0 check (deduction_per_payroll >= 0),
    status text not null default 'active' check (status in ('active', 'completed', 'archived')),
    notes text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, advance_id)
  );

  create table if not exists public.payroll_runs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    period_month integer not null check (period_month between 1 and 12),
    period_year integer not null check (period_year between 1900 and 2200),
    pay_period text not null default 'first_half' check (pay_period in ('first_half', 'second_half')),
    generated_date date not null,
    notes text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, period_month, period_year, pay_period)
  );

  create table if not exists public.payroll_run_items (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade,
    employee_id uuid references public.employees(id) on delete set null,
    employee_name text not null,
    installation_tickets integer not null default 0 check (installation_tickets >= 0),
    repair_tickets integer not null default 0 check (repair_tickets >= 0),
    installation_rate numeric(12, 2) not null default 600 check (installation_rate >= 0),
    repair_rate numeric(12, 2) not null default 200 check (repair_rate >= 0),
    gross_pay numeric(12, 2) not null default 0 check (gross_pay >= 0),
    allowances numeric(12, 2) not null default 0 check (allowances >= 0),
    deductions numeric(12, 2) not null default 0 check (deductions >= 0),
    net_pay numeric(12, 2) not null default 0,
    status text not null default 'pending' check (status in ('pending', 'paid')),
    paid_date date,
    notes text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create table if not exists public.payroll_settings (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    government_deduction_cutoff text not null default 'second_half' check (government_deduction_cutoff in ('first_half', 'second_half')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id)
  );

  alter table public.payroll_settings
  add column if not exists government_deduction_enabled boolean not null default true;

  create table if not exists public.daily_ticket_entries (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    entry_date date not null,
    employee_id uuid not null references public.employees(id) on delete cascade,
    employee_name text not null,
    installation_tickets integer not null default 0 check (installation_tickets >= 0),
    repair_tickets integer not null default 0 check (repair_tickets >= 0),
    installation_rate numeric(12, 2) not null default 600 check (installation_rate >= 0),
    repair_rate numeric(12, 2) not null default 200 check (repair_rate >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, entry_date, employee_id)
  );

  create or replace function public.set_updated_at()
  returns trigger
  language plpgsql
  as $$
  begin
    new.updated_at = now();
    return new;
  end;
  $$;

  alter table public.payroll_runs
  add column if not exists pay_period text not null default 'first_half';

  alter table public.payroll_runs
  drop constraint if exists payroll_runs_pay_period_check;

  alter table public.payroll_runs
  add constraint payroll_runs_pay_period_check
  check (pay_period in ('first_half', 'second_half'));

  alter table public.payroll_runs
  drop constraint if exists payroll_runs_user_id_period_month_period_year_key;

  alter table public.payroll_runs
  drop constraint if exists payroll_runs_user_id_period_month_period_year_pay_period_key;

  alter table public.payroll_runs
  add constraint payroll_runs_user_id_period_month_period_year_pay_period_key
  unique (user_id, period_month, period_year, pay_period);

  alter table public.employees
  add column if not exists wage_category text not null default 'new';

  alter table public.employees
  add column if not exists profile_photo_url text not null default '';

  alter table public.employees
  add column if not exists installation_rate numeric(12, 2) not null default 600;

  alter table public.employees
  add column if not exists repair_rate numeric(12, 2) not null default 200;

  alter table public.employees
  add column if not exists sss_deduction numeric(12, 2) not null default 0;

  alter table public.employees
  add column if not exists philhealth_deduction numeric(12, 2) not null default 0;

  alter table public.employees
  add column if not exists pagibig_deduction numeric(12, 2) not null default 0;

  alter table public.employees
  add column if not exists withholding_tax numeric(12, 2) not null default 0;

  alter table public.employees
  drop constraint if exists employees_wage_category_check;

  alter table public.employees
  add constraint employees_wage_category_check
  check (wage_category in ('new', 'special_old'));

  alter table public.employees
  drop constraint if exists employees_installation_rate_check;

  alter table public.employees
  add constraint employees_installation_rate_check
  check (installation_rate >= 0);

  alter table public.employees
  drop constraint if exists employees_repair_rate_check;

  alter table public.employees
  add constraint employees_repair_rate_check
  check (repair_rate >= 0);

  alter table public.employees
  drop constraint if exists employees_sss_deduction_check;

  alter table public.employees
  add constraint employees_sss_deduction_check
  check (sss_deduction >= 0);

  alter table public.employees
  drop constraint if exists employees_philhealth_deduction_check;

  alter table public.employees
  add constraint employees_philhealth_deduction_check
  check (philhealth_deduction >= 0);

  alter table public.employees
  drop constraint if exists employees_pagibig_deduction_check;

  alter table public.employees
  add constraint employees_pagibig_deduction_check
  check (pagibig_deduction >= 0);

  alter table public.employees
  drop constraint if exists employees_withholding_tax_check;

  alter table public.employees
  add constraint employees_withholding_tax_check
  check (withholding_tax >= 0);

  alter table public.employee_advances
  add column if not exists employee_id uuid references public.employees(id) on delete set null;

  alter table public.employee_advances
  add column if not exists employee_name text not null default '';

  alter table public.employee_advances
  add column if not exists advance_id text not null default '';

  alter table public.employee_advances
  add column if not exists advance_type text not null default 'Salary Bond';

  alter table public.employee_advances
  add column if not exists date_granted date not null default current_date;

  alter table public.employee_advances
  add column if not exists start_deduction date not null default current_date;

  alter table public.employee_advances
  add column if not exists purpose text not null default '';

  alter table public.employee_advances
  add column if not exists amount numeric(12, 2) not null default 0;

  alter table public.employee_advances
  add column if not exists balance numeric(12, 2) not null default 0;

  alter table public.employee_advances
  add column if not exists deduction_per_payroll numeric(12, 2) not null default 0;

  alter table public.employee_advances
  add column if not exists status text not null default 'active';

  alter table public.employee_advances
  add column if not exists notes text not null default '';

  update public.employee_advances
  set advance_type = case
    when coalesce(trim(advance_type), '') in ('', 'Salary Advance', 'Salary Bond', 'Bond') then 'Salary Bond'
    when advance_type in ('Cash Advance', 'Salary Bond', 'Salary Loan', 'Company Loan', 'Other Loan') then advance_type
    else 'Other Loan'
  end;

  alter table public.employee_advances
  drop constraint if exists salary_bonds_status_check;

  alter table public.employee_advances
  drop constraint if exists employee_advances_status_check;

  alter table public.employee_advances
  add constraint employee_advances_status_check
  check (status in ('active', 'completed', 'archived'));

  alter table public.employee_advances
  drop constraint if exists employee_advances_type_check;

  alter table public.employee_advances
  add constraint employee_advances_type_check
  check (advance_type in ('Cash Advance', 'Salary Bond', 'Salary Loan', 'Company Loan', 'Other Loan'));

  alter table public.employee_advances
  drop constraint if exists salary_bonds_amount_check;

  alter table public.employee_advances
  drop constraint if exists employee_advances_amount_check;

  alter table public.employee_advances
  add constraint employee_advances_amount_check
  check (amount >= 0);

  alter table public.employee_advances
  drop constraint if exists salary_bonds_balance_check;

  alter table public.employee_advances
  drop constraint if exists employee_advances_balance_check;

  alter table public.employee_advances
  add constraint employee_advances_balance_check
  check (balance >= 0);

  alter table public.employee_advances
  drop constraint if exists salary_bonds_deduction_per_payroll_check;

  alter table public.employee_advances
  drop constraint if exists employee_advances_deduction_per_payroll_check;

  alter table public.employee_advances
  add constraint employee_advances_deduction_per_payroll_check
  check (deduction_per_payroll >= 0);

  alter table public.employee_advances
  drop constraint if exists salary_bonds_user_id_bond_id_key;

  alter table public.employee_advances
  drop constraint if exists employee_advances_user_id_advance_id_key;

  alter table public.employee_advances
  add constraint employee_advances_user_id_advance_id_key
  unique (user_id, advance_id);

  alter table public.payroll_run_items
  add column if not exists installation_tickets integer not null default 0;

  alter table public.payroll_run_items
  add column if not exists repair_tickets integer not null default 0;

  alter table public.payroll_run_items
  add column if not exists installation_rate numeric(12, 2) not null default 600;

  alter table public.payroll_run_items
  add column if not exists repair_rate numeric(12, 2) not null default 200;

  alter table public.payroll_run_items
  drop constraint if exists payroll_run_items_installation_tickets_check;

  alter table public.payroll_run_items
  add constraint payroll_run_items_installation_tickets_check
  check (installation_tickets >= 0);

  alter table public.payroll_run_items
  drop constraint if exists payroll_run_items_repair_tickets_check;

  alter table public.payroll_run_items
  add constraint payroll_run_items_repair_tickets_check
  check (repair_tickets >= 0);

  alter table public.payroll_run_items
  drop constraint if exists payroll_run_items_installation_rate_check;

  alter table public.payroll_run_items
  add constraint payroll_run_items_installation_rate_check
  check (installation_rate >= 0);

  alter table public.payroll_run_items
  drop constraint if exists payroll_run_items_repair_rate_check;

  alter table public.payroll_run_items
  add constraint payroll_run_items_repair_rate_check
  check (repair_rate >= 0);

  alter table public.daily_ticket_entries
  add column if not exists installation_tickets integer not null default 0;

  alter table public.daily_ticket_entries
  add column if not exists repair_tickets integer not null default 0;

  alter table public.daily_ticket_entries
  add column if not exists installation_rate numeric(12, 2) not null default 600;

  alter table public.daily_ticket_entries
  add column if not exists repair_rate numeric(12, 2) not null default 200;

  alter table public.daily_ticket_entries
  add column if not exists disputed_install integer not null default 0;

  alter table public.daily_ticket_entries
  add column if not exists disputed_repair integer not null default 0;

  alter table public.daily_ticket_entries
  drop constraint if exists daily_ticket_entries_user_id_entry_date_employee_id_key;

  alter table public.daily_ticket_entries
  add constraint daily_ticket_entries_user_id_entry_date_employee_id_key
  unique (user_id, entry_date, employee_id);

  alter table public.daily_ticket_entries
  drop constraint if exists daily_ticket_entries_installation_tickets_check;

  alter table public.daily_ticket_entries
  add constraint daily_ticket_entries_installation_tickets_check
  check (installation_tickets >= 0);

  alter table public.daily_ticket_entries
  drop constraint if exists daily_ticket_entries_repair_tickets_check;

  alter table public.daily_ticket_entries
  add constraint daily_ticket_entries_repair_tickets_check
  check (repair_tickets >= 0);

  alter table public.daily_ticket_entries
  drop constraint if exists daily_ticket_entries_installation_rate_check;

  alter table public.daily_ticket_entries
  add constraint daily_ticket_entries_installation_rate_check
  check (installation_rate >= 0);

  alter table public.daily_ticket_entries
  drop constraint if exists daily_ticket_entries_repair_rate_check;

  alter table public.daily_ticket_entries
  add constraint daily_ticket_entries_repair_rate_check
  check (repair_rate >= 0);

  alter table public.daily_ticket_entries
  drop constraint if exists daily_ticket_entries_disputed_install_check;

  alter table public.daily_ticket_entries
  add constraint daily_ticket_entries_disputed_install_check
  check (disputed_install >= 0);

  alter table public.daily_ticket_entries
  drop constraint if exists daily_ticket_entries_disputed_repair_check;

  alter table public.daily_ticket_entries
  add constraint daily_ticket_entries_disputed_repair_check
  check (disputed_repair >= 0);

  create index if not exists payment_reminders_user_due_date_idx
  on public.payment_reminders (user_id, due_date);

  create index if not exists payment_reminders_user_status_due_date_idx
  on public.payment_reminders (user_id, status, due_date);

  alter table public.payment_reminders
  add column if not exists subcontractor_id uuid;

  alter table public.payment_reminders
  add column if not exists billing_subcon_item_id uuid;

  alter table public.payment_reminders
  add column if not exists billing_month integer;

  alter table public.payment_reminders
  add column if not exists billing_year integer;

  alter table public.payment_reminders
  add column if not exists billing_period text;

  alter table public.payment_reminders
  drop constraint if exists payment_reminders_type_check;

  alter table public.payment_reminders
  add constraint payment_reminders_type_check
  check (type in ('loan', 'bill', 'subcontractor'));

  alter table public.payment_reminders
  drop constraint if exists payment_reminders_billing_month_check;

  alter table public.payment_reminders
  add constraint payment_reminders_billing_month_check
  check (billing_month is null or billing_month between 1 and 12);

  alter table public.payment_reminders
  drop constraint if exists payment_reminders_billing_year_check;

  alter table public.payment_reminders
  add constraint payment_reminders_billing_year_check
  check (billing_year is null or billing_year between 1900 and 2200);

  alter table public.payment_reminders
  drop constraint if exists payment_reminders_billing_period_check;

  alter table public.payment_reminders
  add constraint payment_reminders_billing_period_check
  check (billing_period is null or billing_period in ('first_half', 'second_half'));

  create index if not exists expense_categories_user_name_idx
  on public.expense_categories (user_id, name);

  create index if not exists expenses_user_date_idx
  on public.expenses (user_id, expense_date desc);

  create index if not exists expenses_employee_date_idx
  on public.expenses (employee_id, expense_date desc);

  create index if not exists collection_reminders_user_due_date_idx
  on public.collection_reminders (user_id, due_date);

  create index if not exists collection_reminders_user_status_due_date_idx
  on public.collection_reminders (user_id, status, due_date);

  create index if not exists employees_user_full_name_idx
  on public.employees (user_id, full_name);

  create index if not exists employees_user_status_full_name_idx
  on public.employees (user_id, status, full_name);

  create index if not exists payroll_runs_user_period_sort_idx
  on public.payroll_runs (user_id, period_year desc, period_month desc, pay_period desc);

  create index if not exists payroll_run_items_run_employee_name_idx
  on public.payroll_run_items (payroll_run_id, employee_name);

  create index if not exists payroll_run_items_employee_status_idx
  on public.payroll_run_items (employee_id, status);

  create index if not exists daily_ticket_entries_user_entry_date_idx
  on public.daily_ticket_entries (user_id, entry_date desc);

  create index if not exists daily_ticket_entries_employee_entry_date_idx
  on public.daily_ticket_entries (employee_id, entry_date desc);

  drop index if exists public.salary_bonds_user_status_idx;

  drop index if exists public.salary_bonds_employee_status_idx;

  create index if not exists employee_advances_user_status_idx
  on public.employee_advances (user_id, status);

  create index if not exists employee_advances_employee_status_idx
  on public.employee_advances (employee_id, status);

  drop trigger if exists set_payment_reminders_updated_at on public.payment_reminders;
  create trigger set_payment_reminders_updated_at
  before update on public.payment_reminders
  for each row execute function public.set_updated_at();

  drop trigger if exists set_expense_categories_updated_at on public.expense_categories;
  create trigger set_expense_categories_updated_at
  before update on public.expense_categories
  for each row execute function public.set_updated_at();

  drop trigger if exists set_expenses_updated_at on public.expenses;
  create trigger set_expenses_updated_at
  before update on public.expenses
  for each row execute function public.set_updated_at();

  drop trigger if exists set_collection_reminders_updated_at on public.collection_reminders;
  create trigger set_collection_reminders_updated_at
  before update on public.collection_reminders
  for each row execute function public.set_updated_at();

  drop trigger if exists set_salary_bonds_updated_at on public.employee_advances;
  drop trigger if exists set_employee_advances_updated_at on public.employee_advances;
  create trigger set_employee_advances_updated_at
  before update on public.employee_advances
  for each row execute function public.set_updated_at();

  drop trigger if exists set_payroll_records_updated_at on public.payroll_records;
  create trigger set_payroll_records_updated_at
  before update on public.payroll_records
  for each row execute function public.set_updated_at();

  drop trigger if exists set_employees_updated_at on public.employees;
  create trigger set_employees_updated_at
  before update on public.employees
  for each row execute function public.set_updated_at();

  drop trigger if exists set_payroll_runs_updated_at on public.payroll_runs;
  create trigger set_payroll_runs_updated_at
  before update on public.payroll_runs
  for each row execute function public.set_updated_at();

  drop trigger if exists set_payroll_run_items_updated_at on public.payroll_run_items;
  create trigger set_payroll_run_items_updated_at
  before update on public.payroll_run_items
  for each row execute function public.set_updated_at();

  drop trigger if exists set_daily_ticket_entries_updated_at on public.daily_ticket_entries;
  create trigger set_daily_ticket_entries_updated_at
  before update on public.daily_ticket_entries
  for each row execute function public.set_updated_at();

  alter table public.payment_reminders enable row level security;
  alter table public.expense_categories enable row level security;
  alter table public.expenses enable row level security;
  alter table public.collection_reminders enable row level security;
  alter table public.employee_advances enable row level security;
  alter table public.payroll_records enable row level security;
  alter table public.employees enable row level security;
  alter table public.payroll_runs enable row level security;
  alter table public.payroll_run_items enable row level security;
  alter table public.daily_ticket_entries enable row level security;

  drop policy if exists "payment reminders are owned by their user" on public.payment_reminders;
  create policy "payment reminders are owned by their user"
  on public.payment_reminders
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

  drop policy if exists "expense categories are owned by their user" on public.expense_categories;
  create policy "expense categories are owned by their user"
  on public.expense_categories
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

  drop policy if exists "expenses are owned by their user" on public.expenses;
  create policy "expenses are owned by their user"
  on public.expenses
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

  drop policy if exists "collection reminders are owned by their user" on public.collection_reminders;
  create policy "collection reminders are owned by their user"
  on public.collection_reminders
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

  drop policy if exists "salary bonds are owned by their user" on public.employee_advances;
  drop policy if exists "employee advances are owned by their user" on public.employee_advances;
  create policy "employee advances are owned by their user"
  on public.employee_advances
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

  drop policy if exists "payroll records are owned by their user" on public.payroll_records;
  create policy "payroll records are owned by their user"
  on public.payroll_records
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

  drop policy if exists "employees are owned by their user" on public.employees;
  create policy "employees are owned by their user"
  on public.employees
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

  drop policy if exists "payroll runs are owned by their user" on public.payroll_runs;
  create policy "payroll runs are owned by their user"
  on public.payroll_runs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

  drop policy if exists "payroll run items are owned by their user" on public.payroll_run_items;
  create policy "payroll run items are owned by their user"
  on public.payroll_run_items
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

  drop policy if exists "daily ticket entries are owned by their user" on public.daily_ticket_entries;
  create policy "daily ticket entries are owned by their user"
  on public.daily_ticket_entries
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

  -- Position-based compensation
  create table if not exists public.positions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    department text not null default '',
    description text not null default '',
    status text not null default 'active' check (status in ('active', 'archived')),
    pay_mode text not null check (pay_mode in ('fixed', 'ticket', 'hybrid')),
    monthly_base_salary numeric(12, 2) not null default 0 check (monthly_base_salary >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, name)
  );

  create table if not exists public.position_ticket_categories (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    position_id uuid not null references public.positions(id) on delete restrict,
    name text not null,
    rate numeric(12, 2) not null default 0 check (rate >= 0),
    display_order integer not null default 0 check (display_order >= 0),
    status text not null default 'active' check (status in ('active', 'archived')),
    ticket_type text not null default 'installation' check (ticket_type in ('installation', 'repair')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (position_id, name)
  );

  alter table public.employees
  add column if not exists position_id uuid references public.positions(id) on delete restrict;

  alter table public.daily_ticket_entries
  add column if not exists position_id uuid references public.positions(id) on delete restrict;

  alter table public.daily_ticket_entries
  add column if not exists position_name text not null default '';

  create table if not exists public.daily_ticket_entry_items (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    daily_ticket_entry_id uuid not null references public.daily_ticket_entries(id) on delete cascade,
    position_ticket_category_id uuid references public.position_ticket_categories(id) on delete set null,
    category_name text not null,
    ticket_count integer not null default 0 check (ticket_count >= 0),
    rate numeric(12, 2) not null default 0 check (rate >= 0),
    ticket_type text not null default 'installation' check (ticket_type in ('installation', 'repair')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (daily_ticket_entry_id, category_name)
  );

  alter table public.payroll_run_items add column if not exists position_id uuid references public.positions(id) on delete set null;
  alter table public.payroll_run_items add column if not exists position_name text not null default '';
  alter table public.payroll_run_items add column if not exists pay_mode text not null default 'legacy';
  alter table public.payroll_run_items add column if not exists base_pay numeric(12, 2) not null default 0 check (base_pay >= 0);
  alter table public.payroll_run_items add column if not exists ticket_pay numeric(12, 2) not null default 0 check (ticket_pay >= 0);
  alter table public.payroll_run_items drop constraint if exists payroll_run_items_pay_mode_check;
  alter table public.payroll_run_items add constraint payroll_run_items_pay_mode_check
  check (pay_mode in ('fixed', 'ticket', 'hybrid', 'daily', 'legacy'));

  create table if not exists public.payroll_run_item_ticket_details (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    payroll_run_item_id uuid not null references public.payroll_run_items(id) on delete cascade,
    position_ticket_category_id uuid references public.position_ticket_categories(id) on delete set null,
    category_name text not null,
    ticket_count integer not null default 0 check (ticket_count >= 0),
    rate numeric(12, 2) not null default 0 check (rate >= 0),
    amount numeric(12, 2) not null default 0 check (amount >= 0),
    created_at timestamptz not null default now(),
    unique (payroll_run_item_id, category_name, rate)
  );

  alter table public.payroll_run_item_ticket_details
  drop constraint if exists payroll_run_item_ticket_details_payroll_run_item_id_category_name_key;
  alter table public.payroll_run_item_ticket_details
  drop constraint if exists payroll_run_item_ticket_details_payroll_run_item_id_category_name_rate_key;
  alter table public.payroll_run_item_ticket_details
  add constraint payroll_run_item_ticket_details_payroll_run_item_id_category_name_rate_key
  unique (payroll_run_item_id, category_name, rate);

  -- Convert pre-position employees into normal ticket-based positions by role and rate pair.
  -- The validation trigger may already exist when this migration is re-run.
  drop trigger if exists validate_employee_position_trigger on public.employees;

  do $$
  declare
    rate_group record;
    migrated_position_id uuid;
    migrated_position_name text;
  begin
    for rate_group in
      select
        e.user_id,
        case
          when btrim(coalesce(e.role, '')) = '' or e.role ~* '^Legacy[[:space:]]' then 'Ticket-based position'
          else btrim(e.role)
        end as role_name,
        max(e.department) as department,
        e.installation_rate,
        e.repair_rate
      from public.employees e
      left join public.positions current_position on current_position.id = e.position_id
      where e.position_id is null
         or current_position.description = 'Migrated from employee installation and repair rates.'
      group by e.user_id,
        case
          when btrim(coalesce(e.role, '')) = '' or e.role ~* '^Legacy[[:space:]]' then 'Ticket-based position'
          else btrim(e.role)
        end,
        e.installation_rate, e.repair_rate
    loop
      migrated_position_name := rate_group.role_name ||
        case when rate_group.role_name = 'Ticket-based position' then ' ' else ' - Ticket ' end ||
        trim(to_char(rate_group.installation_rate, 'FM999999990.00')) || '/' ||
        trim(to_char(rate_group.repair_rate, 'FM999999990.00'));

      insert into public.positions (user_id, name, department, description, pay_mode, monthly_base_salary)
      values (
        rate_group.user_id,
        migrated_position_name,
        coalesce(rate_group.department, ''),
        'Ticket-based position created from existing employee rates.',
        'ticket',
        0
      )
      on conflict (user_id, name) do update set updated_at = now()
      returning id into migrated_position_id;

      insert into public.position_ticket_categories (user_id, position_id, name, rate, display_order)
      values
        (rate_group.user_id, migrated_position_id, 'Installation', rate_group.installation_rate, 0),
        (rate_group.user_id, migrated_position_id, 'Repair', rate_group.repair_rate, 1)
      on conflict (position_id, name) do nothing;

      update public.employees
      set position_id = migrated_position_id,
          role = migrated_position_name,
          department = coalesce(rate_group.department, department)
      where user_id = rate_group.user_id
        and case
          when btrim(coalesce(role, '')) = '' or role ~* '^Legacy[[:space:]]' then 'Ticket-based position'
          else btrim(role)
        end = rate_group.role_name
        and installation_rate = rate_group.installation_rate
        and repair_rate = rate_group.repair_rate
        and (
          position_id is null
          or position_id in (
            select id from public.positions
            where description = 'Migrated from employee installation and repair rates.'
          )
        );
    end loop;

    update public.daily_ticket_entries d
    set position_id = e.position_id,
        position_name = coalesce(p.name, '')
    from public.employees e
    left join public.positions p on p.id = e.position_id
    where d.employee_id = e.id
      and (
        d.position_id is null
        or d.position_id in (
          select id from public.positions
          where description = 'Migrated from employee installation and repair rates.'
        )
      );

    update public.payroll_run_items pri
    set position_id = e.position_id,
        position_name = coalesce(p.name, '')
    from public.employees e
    left join public.positions p on p.id = e.position_id
    where pri.employee_id = e.id
      and (
        pri.position_id is null
        or pri.position_id in (
          select id from public.positions
          where description = 'Migrated from employee installation and repair rates.'
        )
      );

    delete from public.position_ticket_categories
    where position_id in (
      select id from public.positions
      where description = 'Migrated from employee installation and repair rates.'
    );

    delete from public.positions
    where description = 'Migrated from employee installation and repair rates.';
  end $$;

  update public.daily_ticket_entries d
  set position_id = e.position_id,
      position_name = coalesce(p.name, d.position_name)
  from public.employees e
  left join public.positions p on p.id = e.position_id
  where d.employee_id = e.id and d.position_id is null;

  insert into public.daily_ticket_entry_items
    (user_id, daily_ticket_entry_id, position_ticket_category_id, category_name, ticket_count, rate)
  select d.user_id, d.id, c.id, 'Installation', d.installation_tickets, d.installation_rate
  from public.daily_ticket_entries d
  left join public.position_ticket_categories c on c.position_id = d.position_id and c.name = 'Installation'
  where d.installation_tickets > 0
  on conflict (daily_ticket_entry_id, category_name) do nothing;

  insert into public.daily_ticket_entry_items
    (user_id, daily_ticket_entry_id, position_ticket_category_id, category_name, ticket_count, rate)
  select d.user_id, d.id, c.id, 'Repair', d.repair_tickets, d.repair_rate
  from public.daily_ticket_entries d
  left join public.position_ticket_categories c on c.position_id = d.position_id and c.name = 'Repair'
  where d.repair_tickets > 0
  on conflict (daily_ticket_entry_id, category_name) do nothing;

  update public.payroll_run_items pri
  set position_id = e.position_id,
      position_name = coalesce(p.name, ''),
      pay_mode = 'legacy',
      ticket_pay = pri.gross_pay
  from public.employees e
  left join public.positions p on p.id = e.position_id
  where pri.employee_id = e.id and pri.position_id is null;

  insert into public.payroll_run_item_ticket_details
    (user_id, payroll_run_item_id, category_name, ticket_count, rate, amount)
  select user_id, id, 'Installation', installation_tickets, installation_rate, installation_tickets * installation_rate
  from public.payroll_run_items where installation_tickets > 0
  on conflict (payroll_run_item_id, category_name, rate) do nothing;

  insert into public.payroll_run_item_ticket_details
    (user_id, payroll_run_item_id, category_name, ticket_count, rate, amount)
  select user_id, id, 'Repair', repair_tickets, repair_rate, repair_tickets * repair_rate
  from public.payroll_run_items where repair_tickets > 0
  on conflict (payroll_run_item_id, category_name, rate) do nothing;

  create index if not exists positions_user_status_name_idx on public.positions (user_id, status, name);
  create index if not exists position_categories_position_order_idx on public.position_ticket_categories (position_id, display_order);
  create index if not exists daily_ticket_entry_items_entry_idx on public.daily_ticket_entry_items (daily_ticket_entry_id);
  create index if not exists payroll_ticket_details_item_idx on public.payroll_run_item_ticket_details (payroll_run_item_id);

  drop trigger if exists set_positions_updated_at on public.positions;
  create trigger set_positions_updated_at before update on public.positions
  for each row execute function public.set_updated_at();
  drop trigger if exists set_position_ticket_categories_updated_at on public.position_ticket_categories;
  create trigger set_position_ticket_categories_updated_at before update on public.position_ticket_categories
  for each row execute function public.set_updated_at();
  drop trigger if exists set_daily_ticket_entry_items_updated_at on public.daily_ticket_entry_items;
  create trigger set_daily_ticket_entry_items_updated_at before update on public.daily_ticket_entry_items
  for each row execute function public.set_updated_at();

  alter table public.positions enable row level security;
  alter table public.position_ticket_categories enable row level security;
  alter table public.daily_ticket_entry_items enable row level security;
  alter table public.payroll_run_item_ticket_details enable row level security;

  drop policy if exists "positions are owned by their user" on public.positions;
  create policy "positions are owned by their user" on public.positions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
  drop policy if exists "position ticket categories are owned by their user" on public.position_ticket_categories;
  create policy "position ticket categories are owned by their user" on public.position_ticket_categories for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
  drop policy if exists "daily ticket entry items are owned by their user" on public.daily_ticket_entry_items;
  create policy "daily ticket entry items are owned by their user" on public.daily_ticket_entry_items for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
  drop policy if exists "payroll ticket details are owned by their user" on public.payroll_run_item_ticket_details;
  create policy "payroll ticket details are owned by their user" on public.payroll_run_item_ticket_details for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

  create or replace function public.validate_employee_position()
  returns trigger language plpgsql as $$
  declare
    selected_status text;
    selected_user uuid;
  begin
    if new.status = 'active' and new.position_id is null then
      raise exception 'Active employees require a position.';
    end if;
    if new.position_id is not null then
      select status, user_id into selected_status, selected_user
      from public.positions where id = new.position_id;
      if selected_user is distinct from new.user_id then
        raise exception 'Employee and position must belong to the same user.';
      end if;
      if new.status = 'active' and selected_status <> 'active' then
        raise exception 'Active employees require an active position.';
      end if;
    end if;
    return new;
  end;
  $$;

  drop trigger if exists validate_employee_position_trigger on public.employees;
  create trigger validate_employee_position_trigger
  before insert or update of position_id, status on public.employees
  for each row execute function public.validate_employee_position();

  create or replace function public.prevent_archiving_assigned_position()
  returns trigger language plpgsql as $$
  begin
    if old.status = 'active' and new.status = 'archived' and exists (
      select 1 from public.employees where position_id = new.id and status = 'active'
    ) then
      raise exception 'Reassign active employees before archiving this position.';
    end if;
    return new;
  end;
  $$;

  drop trigger if exists prevent_archiving_assigned_position_trigger on public.positions;
  create trigger prevent_archiving_assigned_position_trigger
  before update of status on public.positions
  for each row execute function public.prevent_archiving_assigned_position();

-- Attendance-based daily wage pay mode
alter table public.positions
add column if not exists daily_rate numeric(12, 2) not null default 0;

alter table public.positions
drop constraint if exists positions_pay_mode_check;

alter table public.positions
add constraint positions_pay_mode_check
check (pay_mode in ('fixed', 'ticket', 'hybrid', 'daily'));

alter table public.positions
drop constraint if exists positions_daily_rate_check;

alter table public.positions
add constraint positions_daily_rate_check
check (daily_rate >= 0);

create table if not exists public.attendance_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  employee_name text not null,
  position_id uuid references public.positions(id) on delete restrict,
  position_name text not null default '',
  entry_date date not null,
  status text not null check (status in ('present', 'absent', 'half_day')),
  time_in text default '08:00',
  time_out text default '17:00',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, entry_date, employee_id)
);

create index if not exists attendance_entries_user_entry_date_idx
on public.attendance_entries (user_id, entry_date desc);

create index if not exists attendance_entries_employee_entry_date_idx
on public.attendance_entries (employee_id, entry_date desc);

drop trigger if exists set_attendance_entries_updated_at on public.attendance_entries;
create trigger set_attendance_entries_updated_at
before update on public.attendance_entries
for each row execute function public.set_updated_at();

alter table public.attendance_entries enable row level security;

drop policy if exists "attendance entries are owned by their user" on public.attendance_entries;
create policy "attendance entries are owned by their user"
on public.attendance_entries for all
using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.payroll_run_items
add column if not exists daily_rate numeric(12, 2) not null default 0;

alter table public.payroll_run_items
add column if not exists days_worked numeric(5, 2) not null default 0;

alter table public.payroll_run_items
add column if not exists total_working_days integer not null default 0;

alter table public.payroll_run_items
drop constraint if exists payroll_run_items_pay_mode_check;

alter table public.payroll_run_items
add constraint payroll_run_items_pay_mode_check
check (pay_mode in ('fixed', 'ticket', 'hybrid', 'daily', 'legacy'));

-- Receivable collection tracking
alter table public.collection_reminders add column if not exists collection_no text;
alter table public.collection_reminders add column if not exists external_reference text not null default '';
alter table public.collection_reminders add column if not exists issue_date date;
alter table public.collection_reminders add column if not exists archived_at timestamptz;

update public.collection_reminders
set issue_date = coalesce(issue_date, created_at::date)
where issue_date is null;

alter table public.collection_reminders
alter column issue_date set default current_date;
alter table public.collection_reminders
alter column issue_date set not null;

create table if not exists public.collection_number_sequences (
  user_id uuid not null references auth.users(id) on delete cascade,
  sequence_year integer not null check (sequence_year between 1900 and 2200),
  last_value integer not null default 0 check (last_value >= 0),
  primary key (user_id, sequence_year)
);

create or replace function public.next_collection_number(owner_id uuid, issue_year integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_value integer;
begin
  insert into public.collection_number_sequences (user_id, sequence_year, last_value)
  values (owner_id, issue_year, 1)
  on conflict (user_id, sequence_year)
  do update set last_value = public.collection_number_sequences.last_value + 1
  returning last_value into next_value;
  return 'COL-' || issue_year::text || '-' || lpad(next_value::text, 4, '0');
end;
$$;

create or replace function public.assign_collection_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.collection_no is null or btrim(new.collection_no) = '' then
    new.collection_no := public.next_collection_number(new.user_id, extract(year from new.issue_date)::integer);
  end if;
  return new;
end;
$$;

with numbered as (
  select id, user_id, extract(year from issue_date)::integer as issue_year,
    row_number() over (
      partition by user_id, extract(year from issue_date)::integer
      order by created_at, id
    ) as sequence_value
  from public.collection_reminders
  where collection_no is null or btrim(collection_no) = ''
)
update public.collection_reminders c
set collection_no = 'COL-' || n.issue_year::text || '-' || lpad(n.sequence_value::text, 4, '0')
from numbered n where n.id = c.id;

insert into public.collection_number_sequences (user_id, sequence_year, last_value)
select user_id, extract(year from issue_date)::integer, count(*)
from public.collection_reminders
group by user_id, extract(year from issue_date)::integer
on conflict (user_id, sequence_year)
do update set last_value = greatest(public.collection_number_sequences.last_value, excluded.last_value);

create unique index if not exists collection_reminders_user_collection_no_key
on public.collection_reminders (user_id, collection_no);

drop trigger if exists assign_collection_number_trigger on public.collection_reminders;
create trigger assign_collection_number_trigger
before insert on public.collection_reminders
for each row execute function public.assign_collection_number();

create table if not exists public.collection_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  collection_id uuid not null references public.collection_reminders(id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  payment_date date not null default current_date,
  payment_method text not null default 'other'
    check (payment_method in ('cash', 'bank_transfer', 'check', 'e_wallet', 'card', 'other')),
  reference_number text not null default '',
  notes text not null default '',
  is_void boolean not null default false,
  void_reason text not null default '',
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.collection_payments
  (user_id, collection_id, amount, payment_date, payment_method, reference_number, notes)
select c.user_id, c.id, c.amount, coalesce(c.updated_at::date, c.due_date), 'other', 'LEGACY',
  'Migrated from the previous collected status.'
from public.collection_reminders c
where c.status = 'collected'
  and not exists (select 1 from public.collection_payments p where p.collection_id = c.id);

create index if not exists collection_payments_collection_date_idx
on public.collection_payments (collection_id, payment_date desc, created_at desc);
create index if not exists collection_payments_user_date_idx
on public.collection_payments (user_id, payment_date desc);

drop trigger if exists set_collection_payments_updated_at on public.collection_payments;
create trigger set_collection_payments_updated_at
before update on public.collection_payments
for each row execute function public.set_updated_at();

alter table public.collection_number_sequences enable row level security;
alter table public.collection_payments enable row level security;

drop policy if exists "collection sequences are owned by their user" on public.collection_number_sequences;
create policy "collection sequences are owned by their user"
on public.collection_number_sequences for select
using (auth.uid() = user_id);

drop policy if exists "collection payments are owned by their user" on public.collection_payments;
create policy "collection payments are owned by their user"
on public.collection_payments for select
using (auth.uid() = user_id);

create or replace function public.record_collection_payment(
  collection_record_id uuid,
  payment_record_id uuid,
  payment_amount numeric,
  paid_on date,
  method text,
  payment_reference text default '',
  payment_notes text default ''
)
returns public.collection_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  receivable public.collection_reminders%rowtype;
  paid_total numeric(12, 2);
  result public.collection_payments%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if payment_amount is null or payment_amount <= 0 then raise exception 'Payment amount must be greater than zero.'; end if;
  if paid_on is null or paid_on > current_date then raise exception 'Payment date cannot be in the future.'; end if;
  if method not in ('cash', 'bank_transfer', 'check', 'e_wallet', 'card', 'other') then raise exception 'Invalid payment method.'; end if;

  if payment_record_id is not null then
    select * into result from public.collection_payments
    where id = payment_record_id and user_id = auth.uid();
    if found then return result; end if;
  end if;

  select * into receivable from public.collection_reminders
  where id = collection_record_id and user_id = auth.uid()
  for update;
  if not found then raise exception 'Receivable not found.'; end if;
  if receivable.archived_at is not null then raise exception 'Archived receivables cannot accept payments.'; end if;

  select coalesce(sum(amount), 0) into paid_total
  from public.collection_payments
  where collection_id = collection_record_id and not is_void;
  if payment_amount > receivable.amount - paid_total then raise exception 'Payment exceeds the outstanding balance.'; end if;

  insert into public.collection_payments
    (id, user_id, collection_id, amount, payment_date, payment_method, reference_number, notes)
  values
    (coalesce(payment_record_id, gen_random_uuid()), auth.uid(), collection_record_id, payment_amount,
     paid_on, method, coalesce(payment_reference, ''), coalesce(payment_notes, ''))
  returning * into result;
  return result;
end;
$$;

create or replace function public.void_collection_payment(payment_record_id uuid, reason text)
returns public.collection_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.collection_payments%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if reason is null or btrim(reason) = '' then raise exception 'A void reason is required.'; end if;

  select * into result from public.collection_payments
  where id = payment_record_id and user_id = auth.uid()
  for update;
  if not found then raise exception 'Payment not found.'; end if;
  if result.is_void then return result; end if;

  update public.collection_payments
  set is_void = true, void_reason = btrim(reason), voided_at = now()
  where id = payment_record_id
  returning * into result;
  return result;
end;
$$;

revoke insert, update, delete on public.collection_payments from authenticated;
grant select on public.collection_payments to authenticated;
revoke all on function public.next_collection_number(uuid, integer) from public;
revoke all on function public.record_collection_payment(uuid, uuid, numeric, date, text, text, text) from public;
revoke all on function public.void_collection_payment(uuid, text) from public;
grant execute on function public.record_collection_payment(uuid, uuid, numeric, date, text, text, text) to authenticated;
grant execute on function public.void_collection_payment(uuid, text) to authenticated;

create or replace function public.validate_collection_receivable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  paid_total numeric(12, 2);
begin
  if new.amount <= 0 then raise exception 'Receivable amount must be greater than zero.'; end if;
  if new.issue_date > new.due_date then raise exception 'Due date cannot be before issue date.'; end if;
  if tg_op = 'UPDATE' and new.amount <> old.amount then
    select coalesce(sum(amount), 0) into paid_total
    from public.collection_payments where collection_id = new.id and not is_void;
    if new.amount < paid_total then raise exception 'Receivable amount cannot be less than payments already received.'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_collection_receivable_trigger on public.collection_reminders;
create trigger validate_collection_receivable_trigger
before insert or update of amount, issue_date, due_date on public.collection_reminders
for each row execute function public.validate_collection_receivable();

-- Billing & Collection integration
create table if not exists public.billing_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  billing_rate numeric(12, 2) not null default 0 check (billing_rate >= 0),
  installation_rate numeric(12, 2) not null default 0 check (installation_rate >= 0),
  repair_rate numeric(12, 2) not null default 0 check (repair_rate >= 0),
  collections_pct integer not null default 70 check (collections_pct >= 0 and collections_pct <= 100),
  client_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

drop trigger if exists set_billing_settings_updated_at on public.billing_settings;
create trigger set_billing_settings_updated_at
before update on public.billing_settings
for each row execute function public.set_updated_at();

drop trigger if exists set_payroll_settings_updated_at on public.payroll_settings;
create trigger set_payroll_settings_updated_at
before update on public.payroll_settings
for each row execute function public.set_updated_at();

alter table public.payroll_settings enable row level security;

drop policy if exists "payroll settings are owned by their user" on public.payroll_settings;
create policy "payroll settings are owned by their user"
on public.payroll_settings for all
using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.billing_settings enable row level security;

drop policy if exists "billing settings are owned by their user" on public.billing_settings;
create policy "billing settings are owned by their user"
on public.billing_settings for all
using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.billing_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  billing_month integer not null check (billing_month between 1 and 12),
  billing_year integer not null check (billing_year between 1900 and 2200),
  billing_period text not null default 'first_half' check (billing_period in ('first_half', 'second_half')),
  install_tickets integer not null default 0 check (install_tickets >= 0),
  repair_tickets integer not null default 0 check (repair_tickets >= 0),
  disputed_install integer not null default 0 check (disputed_install >= 0),
  disputed_repair integer not null default 0 check (disputed_repair >= 0),
  total_tickets integer not null default 0 check (total_tickets >= 0),
  disputed_tickets integer not null default 0 check (disputed_tickets >= 0),
  billable_tickets integer not null default 0 check (billable_tickets >= 0),
  billing_rate numeric(12, 2) not null default 0 check (billing_rate >= 0),
  billing_amount numeric(12, 2) not null default 0 check (billing_amount >= 0),
  collections_pct integer not null default 70 check (collections_pct >= 0 and collections_pct <= 100),
  collections_amount numeric(12, 2) not null default 0 check (collections_amount >= 0),
  collectibles_amount numeric(12, 2) not null default 0 check (collectibles_amount >= 0),
  collection_id uuid references public.collection_reminders(id) on delete set null,
  collectibles_collection_id uuid references public.collection_reminders(id) on delete set null,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, billing_month, billing_year, billing_period)
);

create index if not exists billing_records_user_year_month_idx
on public.billing_records (user_id, billing_year desc, billing_month desc);

drop trigger if exists set_billing_records_updated_at on public.billing_records;
create trigger set_billing_records_updated_at
before update on public.billing_records
for each row execute function public.set_updated_at();

alter table public.billing_records enable row level security;

drop policy if exists "billing records are owned by their user" on public.billing_records;
create policy "billing records are owned by their user"
on public.billing_records for all
using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.billing_records
  add column if not exists install_tickets integer not null default 0,
  add column if not exists repair_tickets integer not null default 0,
  add column if not exists disputed_install integer not null default 0,
  add column if not exists disputed_repair integer not null default 0;

update public.billing_records
set
  install_tickets = coalesce(install_tickets, greatest(total_tickets - disputed_tickets, 0)),
  repair_tickets = coalesce(repair_tickets, 0),
  disputed_install = coalesce(disputed_install, disputed_tickets),
  disputed_repair = coalesce(disputed_repair, 0)
where
  install_tickets = 0
  and repair_tickets = 0
  and disputed_install = 0
  and disputed_repair = 0
  and (total_tickets <> 0 or disputed_tickets <> 0);

-- Billing invoice numbering
alter table public.billing_records add column if not exists invoice_no text;

create table if not exists public.billing_number_sequences (
  user_id uuid not null references auth.users(id) on delete cascade,
  sequence_year integer not null check (sequence_year between 1900 and 2200),
  last_value integer not null default 0 check (last_value >= 0),
  primary key (user_id, sequence_year)
);

create or replace function public.next_billing_number(owner_id uuid, invoice_year integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_value integer;
begin
  insert into public.billing_number_sequences (user_id, sequence_year, last_value)
  values (owner_id, invoice_year, 1)
  on conflict (user_id, sequence_year)
  do update set last_value = public.billing_number_sequences.last_value + 1
  returning last_value into next_value;
  return 'INV-' || invoice_year::text || '-' || lpad(next_value::text, 4, '0');
end;
$$;

create or replace function public.assign_billing_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.invoice_no is null or btrim(new.invoice_no) = '' then
    new.invoice_no := public.next_billing_number(new.user_id, new.billing_year);
  end if;
  return new;
end;
$$;

with numbered as (
  select id, user_id, billing_year,
    row_number() over (
      partition by user_id, billing_year
      order by billing_month, billing_period, created_at, id
    ) as sequence_value
  from public.billing_records
  where invoice_no is null or btrim(invoice_no) = ''
)
update public.billing_records b
set invoice_no = 'INV-' || n.billing_year::text || '-' || lpad(n.sequence_value::text, 4, '0')
from numbered n where n.id = b.id;

insert into public.billing_number_sequences (user_id, sequence_year, last_value)
select user_id, billing_year, count(*)
from public.billing_records
group by user_id, billing_year
on conflict (user_id, sequence_year)
do update set last_value = greatest(public.billing_number_sequences.last_value, excluded.last_value);

create unique index if not exists billing_records_user_invoice_no_key
on public.billing_records (user_id, invoice_no);

drop trigger if exists assign_billing_number_trigger on public.billing_records;
create trigger assign_billing_number_trigger
before insert on public.billing_records
for each row execute function public.assign_billing_number();

alter table public.billing_number_sequences enable row level security;

drop policy if exists "billing sequences are owned by their user" on public.billing_number_sequences;
create policy "billing sequences are owned by their user"
on public.billing_number_sequences for select
using (auth.uid() = user_id);

-- Subcontractors
create table if not exists public.subcontractors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  installation_rate numeric(12, 2) not null default 0 check (installation_rate >= 0),
  repair_rate numeric(12, 2) not null default 0 check (repair_rate >= 0),
  payable_pct integer not null default 30 check (payable_pct >= 0 and payable_pct <= 100),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

drop trigger if exists set_subcontractors_updated_at on public.subcontractors;
create trigger set_subcontractors_updated_at
before update on public.subcontractors
for each row execute function public.set_updated_at();

alter table public.subcontractors enable row level security;

drop policy if exists "subcontractors are owned by their user" on public.subcontractors;
create policy "subcontractors are owned by their user"
on public.subcontractors for all
using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.subcontractor_advances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subcontractor_id uuid references public.subcontractors(id) on delete set null,
  subcon_name text not null,
  advance_id text not null,
  date_granted date not null default current_date,
  amount numeric(12, 2) not null default 0,
  balance numeric(12, 2) not null default 0,
  deduction_mode text not null default 'full_payout',
  deduction_per_billing numeric(12, 2) not null default 0,
  status text not null default 'active',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, advance_id)
);

alter table public.subcontractor_advances
add column if not exists subcontractor_id uuid references public.subcontractors(id) on delete set null;

alter table public.subcontractor_advances
add column if not exists subcon_name text not null default '';

alter table public.subcontractor_advances
add column if not exists advance_id text not null default '';

alter table public.subcontractor_advances
add column if not exists date_granted date not null default current_date;

alter table public.subcontractor_advances
add column if not exists amount numeric(12, 2) not null default 0;

alter table public.subcontractor_advances
add column if not exists balance numeric(12, 2) not null default 0;

alter table public.subcontractor_advances
add column if not exists deduction_mode text not null default 'full_payout';

alter table public.subcontractor_advances
add column if not exists deduction_per_billing numeric(12, 2) not null default 0;

alter table public.subcontractor_advances
add column if not exists status text not null default 'active';

alter table public.subcontractor_advances
add column if not exists notes text not null default '';

alter table public.subcontractor_advances
drop constraint if exists subcontractor_advances_status_check;

alter table public.subcontractor_advances
add constraint subcontractor_advances_status_check
check (status in ('active', 'completed', 'archived'));

alter table public.subcontractor_advances
drop constraint if exists subcontractor_advances_amount_check;

alter table public.subcontractor_advances
add constraint subcontractor_advances_amount_check
check (amount >= 0);

alter table public.subcontractor_advances
drop constraint if exists subcontractor_advances_balance_check;

alter table public.subcontractor_advances
add constraint subcontractor_advances_balance_check
check (balance >= 0);

alter table public.subcontractor_advances
drop constraint if exists subcontractor_advances_deduction_mode_check;

alter table public.subcontractor_advances
add constraint subcontractor_advances_deduction_mode_check
check (deduction_mode in ('per_billing', 'full_payout'));

alter table public.subcontractor_advances
drop constraint if exists subcontractor_advances_deduction_per_billing_check;

alter table public.subcontractor_advances
add constraint subcontractor_advances_deduction_per_billing_check
check (deduction_per_billing >= 0);

alter table public.subcontractor_advances
drop constraint if exists subcontractor_advances_user_id_advance_id_key;

alter table public.subcontractor_advances
add constraint subcontractor_advances_user_id_advance_id_key
unique (user_id, advance_id);

create index if not exists subcontractor_advances_user_status_idx
on public.subcontractor_advances (user_id, status);

create index if not exists subcontractor_advances_subcontractor_status_idx
on public.subcontractor_advances (subcontractor_id, status);

drop trigger if exists set_subcontractor_advances_updated_at on public.subcontractor_advances;
create trigger set_subcontractor_advances_updated_at
before update on public.subcontractor_advances
for each row execute function public.set_updated_at();

alter table public.subcontractor_advances enable row level security;

drop policy if exists "subcontractor advances are owned by their user" on public.subcontractor_advances;
create policy "subcontractor advances are owned by their user"
on public.subcontractor_advances for all
using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Subcontractor daily tickets
create table if not exists public.subcon_daily_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null,
  subcontractor_id uuid not null references public.subcontractors(id) on delete cascade,
  subcon_name text not null,
  install_tickets integer not null default 0 check (install_tickets >= 0),
  repair_tickets integer not null default 0 check (repair_tickets >= 0),
  disputed_install integer not null default 0 check (disputed_install >= 0),
  disputed_repair integer not null default 0 check (disputed_repair >= 0),
  installation_rate numeric(12, 2) not null default 0,
  repair_rate numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, entry_date, subcontractor_id)
);

alter table public.subcon_daily_tickets
  add column if not exists disputed_install integer not null default 0,
  add column if not exists disputed_repair integer not null default 0;

alter table public.subcon_daily_tickets
  drop constraint if exists subcon_daily_tickets_disputed_install_check;

alter table public.subcon_daily_tickets
  add constraint subcon_daily_tickets_disputed_install_check
  check (disputed_install >= 0);

alter table public.subcon_daily_tickets
  drop constraint if exists subcon_daily_tickets_disputed_repair_check;

alter table public.subcon_daily_tickets
  add constraint subcon_daily_tickets_disputed_repair_check
  check (disputed_repair >= 0);

create index if not exists subcon_daily_tickets_user_date_idx
on public.subcon_daily_tickets (user_id, entry_date desc);

drop trigger if exists set_subcon_daily_tickets_updated_at on public.subcon_daily_tickets;
create trigger set_subcon_daily_tickets_updated_at
before update on public.subcon_daily_tickets
for each row execute function public.set_updated_at();

alter table public.subcon_daily_tickets enable row level security;

drop policy if exists "subcon daily tickets are owned by their user" on public.subcon_daily_tickets;
create policy "subcon daily tickets are owned by their user"
on public.subcon_daily_tickets for all
using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Billing subcontractor items
create table if not exists public.billing_subcon_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  billing_record_id uuid not null references public.billing_records(id) on delete cascade,
  subcontractor_id uuid not null references public.subcontractors(id) on delete cascade,
  subcon_name text not null,
  install_tickets integer not null default 0 check (install_tickets >= 0),
  repair_tickets integer not null default 0 check (repair_tickets >= 0),
  disputed_install integer not null default 0 check (disputed_install >= 0),
  disputed_repair integer not null default 0 check (disputed_repair >= 0),
  installation_rate numeric(12, 2) not null default 0,
  repair_rate numeric(12, 2) not null default 0,
  billable_tickets integer not null default 0,
  billing_amount numeric(12, 2) not null default 0,
  payable_pct integer not null default 30,
  payable_amount numeric(12, 2) not null default 0,
  collection_amount numeric(12, 2) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists billing_subcon_items_record_idx
on public.billing_subcon_items (billing_record_id);

alter table public.payment_reminders
drop constraint if exists payment_reminders_subcontractor_id_fkey;

alter table public.payment_reminders
add constraint payment_reminders_subcontractor_id_fkey
foreign key (subcontractor_id) references public.subcontractors(id) on delete set null;

alter table public.payment_reminders
drop constraint if exists payment_reminders_billing_subcon_item_id_fkey;

alter table public.payment_reminders
add constraint payment_reminders_billing_subcon_item_id_fkey
foreign key (billing_subcon_item_id) references public.billing_subcon_items(id) on delete cascade;

create unique index if not exists payment_reminders_billing_subcon_item_uidx
on public.payment_reminders (billing_subcon_item_id)
where billing_subcon_item_id is not null;

create index if not exists payment_reminders_subcontractor_due_idx
on public.payment_reminders (subcontractor_id, due_date desc)
where subcontractor_id is not null;

alter table public.billing_subcon_items enable row level security;

drop policy if exists "billing subcon items are owned by their user" on public.billing_subcon_items;
create policy "billing subcon items are owned by their user"
on public.billing_subcon_items for all
using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.subcontractor_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subcontractor_id uuid not null references public.subcontractors(id) on delete cascade,
  billing_record_id uuid not null references public.billing_records(id) on delete cascade,
  billing_subcon_item_id uuid not null references public.billing_subcon_items(id) on delete cascade,
  subcon_name text not null,
  billing_month integer not null check (billing_month between 1 and 12),
  billing_year integer not null check (billing_year between 1900 and 2200),
  billing_period text not null default 'first_half' check (billing_period in ('first_half', 'second_half')),
  net_amount numeric(12, 2) not null default 0 check (net_amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'paid')),
  due_date date not null,
  paid_date date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (billing_subcon_item_id)
);

create index if not exists subcontractor_payments_subcontractor_due_idx
on public.subcontractor_payments (subcontractor_id, due_date desc);

create index if not exists subcontractor_payments_billing_idx
on public.subcontractor_payments (billing_record_id);

drop trigger if exists set_subcontractor_payments_updated_at on public.subcontractor_payments;
create trigger set_subcontractor_payments_updated_at
before update on public.subcontractor_payments
for each row execute function public.set_updated_at();

alter table public.subcontractor_payments enable row level security;

drop policy if exists "subcontractor payments are owned by their user" on public.subcontractor_payments;
create policy "subcontractor payments are owned by their user"
on public.subcontractor_payments for all
using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Emergency contact fields on employees
alter table public.employees add column if not exists emergency_contact_name text not null default '';
alter table public.employees add column if not exists emergency_contact_number text not null default '';
alter table public.employees add column if not exists emergency_contact_relation text not null default '';

-- Personal vs company classification on expense categories
alter table public.expense_categories
add column if not exists type text not null default 'company';

alter table public.expense_categories
drop constraint if exists expense_categories_type_check;

alter table public.expense_categories
add constraint expense_categories_type_check
check (type in ('personal', 'company'));

-- Monthly vs one-time classification on expenses
alter table public.expenses
add column if not exists frequency text not null default 'one_time';

alter table public.expenses
drop constraint if exists expenses_frequency_check;

alter table public.expenses
add constraint expenses_frequency_check
check (frequency in ('one_time', 'monthly'));

-- Personal expenses aren't tied to a tracked employee record
alter table public.expenses
alter column employee_id drop not null;

-- How long a monthly expense recurs for (in months), before it's considered finished
alter table public.expenses
add column if not exists duration_months integer;

alter table public.expenses
drop constraint if exists expenses_duration_months_check;

alter table public.expenses
add constraint expenses_duration_months_check
check (duration_months is null or duration_months > 0);

-- Paid / pending status on expenses
alter table public.expenses
add column if not exists status text not null default 'pending';

alter table public.expenses
add column if not exists paid_date date;

alter table public.expenses
drop constraint if exists expenses_status_check;

alter table public.expenses
add constraint expenses_status_check
check (status in ('pending', 'paid'));

-- Track partial (installment) payments on multi-month expenses
alter table public.expenses
add column if not exists paid_installments integer not null default 0;

alter table public.expenses
drop constraint if exists expenses_paid_installments_check;

alter table public.expenses
add constraint expenses_paid_installments_check
check (paid_installments >= 0);

-- Payment history for expense installments (each period's payment, with method and reference)
create table if not exists public.expense_installment_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expense_id uuid not null references public.expenses(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  payment_date date not null default current_date,
  payment_method text not null default 'other'
    check (payment_method in ('cash', 'bank_transfer', 'check', 'e_wallet', 'card', 'other')),
  reference_number text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists expense_installment_payments_expense_idx
on public.expense_installment_payments (expense_id, payment_date desc);

alter table public.expense_installment_payments enable row level security;

drop policy if exists "expense installment payments are owned by their user" on public.expense_installment_payments;
create policy "expense installment payments are owned by their user"
on public.expense_installment_payments for all
using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Optional due date on expenses
alter table public.expenses
add column if not exists due_date date;

-- Allow expenses to be cancelled without being marked paid
alter table public.expenses
drop constraint if exists expenses_status_check;

alter table public.expenses
add constraint expenses_status_check
check (status in ('pending', 'paid', 'cancelled'));

-- Allow a daily recurring frequency on expenses (in addition to one_time/monthly)
alter table public.expenses
drop constraint if exists expenses_frequency_check;

alter table public.expenses
add constraint expenses_frequency_check
check (frequency in ('one_time', 'monthly', 'daily'));

-- Informational payment date for company expenses (separate from paid_date, which is
-- system-managed when an expense's balance is fully settled).
alter table public.expenses
add column if not exists payment_date date;

-- Optional date of birth on employees
alter table public.employees
add column if not exists date_of_birth date;

-- Optional civil status on employees
alter table public.employees
add column if not exists civil_status text not null default ''
check (civil_status in ('', 'single', 'married', 'widowed'));

-- Editable due date on billing records, synced to their linked collections
alter table public.billing_records
add column if not exists due_date date;

-- Individual installments recorded against a payment reminder (loan/bill/subcontractor payout),
-- allowing a payout to be paid off across multiple partial payments instead of one lump sum.
create table if not exists public.payment_reminder_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  payment_reminder_id uuid not null references public.payment_reminders(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  payment_date date not null default current_date,
  payment_method text not null default 'other'
    check (payment_method in ('cash', 'bank_transfer', 'check', 'e_wallet', 'card', 'other')),
  reference_number text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists payment_reminder_payments_reminder_idx
on public.payment_reminder_payments (payment_reminder_id, payment_date desc);

alter table public.payment_reminder_payments enable row level security;

drop policy if exists "payment reminder payments are owned by their user" on public.payment_reminder_payments;
create policy "payment reminder payments are owned by their user"
on public.payment_reminder_payments for all
using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Link an auto-generated "Payroll" company expense to the payroll run it summarizes.
-- The expense's own id is set equal to payroll_run_id by the application, so every sync
-- is a plain upsert by id — no separate existence check is ever needed.
alter table public.expenses
add column if not exists payroll_run_id uuid references public.payroll_runs(id) on delete cascade;

alter table public.expenses
drop constraint if exists expenses_payroll_run_id_key;

alter table public.expenses
add constraint expenses_payroll_run_id_key unique (payroll_run_id);

-- Link an auto-generated "Subcontractor Payout" company expense to the payout reminder it mirrors.
-- The expense's own id is set equal to payment_reminders.id by the application so payout payments
-- can reuse the same id as expense installment rows without an extra lookup table.
alter table public.expenses
add column if not exists subcontractor_payment_reminder_id uuid references public.payment_reminders(id) on delete cascade;

alter table public.expenses
drop constraint if exists expenses_subcontractor_payment_reminder_id_key;

alter table public.expenses
add constraint expenses_subcontractor_payment_reminder_id_key unique (subcontractor_payment_reminder_id);
