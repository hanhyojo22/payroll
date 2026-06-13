create table if not exists public.payment_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  type text not null check (type in ('loan', 'bill')),
  amount numeric(12, 2) not null check (amount >= 0),
  due_date date not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'overdue')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.salary_bonds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  employee_name text not null,
  bond_id text not null,
  purpose text not null default '',
  amount numeric(12, 2) not null default 0 check (amount >= 0),
  balance numeric(12, 2) not null default 0 check (balance >= 0),
  deduction_per_payroll numeric(12, 2) not null default 0 check (deduction_per_payroll >= 0),
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, bond_id)
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

alter table public.salary_bonds
add column if not exists employee_id uuid references public.employees(id) on delete set null;

alter table public.salary_bonds
add column if not exists employee_name text not null default '';

alter table public.salary_bonds
add column if not exists bond_id text not null default '';

alter table public.salary_bonds
add column if not exists purpose text not null default '';

alter table public.salary_bonds
add column if not exists amount numeric(12, 2) not null default 0;

alter table public.salary_bonds
add column if not exists balance numeric(12, 2) not null default 0;

alter table public.salary_bonds
add column if not exists deduction_per_payroll numeric(12, 2) not null default 0;

alter table public.salary_bonds
add column if not exists status text not null default 'active';

alter table public.salary_bonds
add column if not exists notes text not null default '';

alter table public.salary_bonds
drop constraint if exists salary_bonds_status_check;

alter table public.salary_bonds
add constraint salary_bonds_status_check
check (status in ('active', 'completed', 'archived'));

alter table public.salary_bonds
drop constraint if exists salary_bonds_amount_check;

alter table public.salary_bonds
add constraint salary_bonds_amount_check
check (amount >= 0);

alter table public.salary_bonds
drop constraint if exists salary_bonds_balance_check;

alter table public.salary_bonds
add constraint salary_bonds_balance_check
check (balance >= 0);

alter table public.salary_bonds
drop constraint if exists salary_bonds_deduction_per_payroll_check;

alter table public.salary_bonds
add constraint salary_bonds_deduction_per_payroll_check
check (deduction_per_payroll >= 0);

alter table public.salary_bonds
drop constraint if exists salary_bonds_user_id_bond_id_key;

alter table public.salary_bonds
add constraint salary_bonds_user_id_bond_id_key
unique (user_id, bond_id);

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

create index if not exists payment_reminders_user_due_date_idx
on public.payment_reminders (user_id, due_date);

create index if not exists payment_reminders_user_status_due_date_idx
on public.payment_reminders (user_id, status, due_date);

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

create index if not exists salary_bonds_user_status_idx
on public.salary_bonds (user_id, status);

create index if not exists salary_bonds_employee_status_idx
on public.salary_bonds (employee_id, status);

drop trigger if exists set_payment_reminders_updated_at on public.payment_reminders;
create trigger set_payment_reminders_updated_at
before update on public.payment_reminders
for each row execute function public.set_updated_at();

drop trigger if exists set_collection_reminders_updated_at on public.collection_reminders;
create trigger set_collection_reminders_updated_at
before update on public.collection_reminders
for each row execute function public.set_updated_at();

drop trigger if exists set_salary_bonds_updated_at on public.salary_bonds;
create trigger set_salary_bonds_updated_at
before update on public.salary_bonds
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
alter table public.collection_reminders enable row level security;
alter table public.salary_bonds enable row level security;
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

drop policy if exists "collection reminders are owned by their user" on public.collection_reminders;
create policy "collection reminders are owned by their user"
on public.collection_reminders
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "salary bonds are owned by their user" on public.salary_bonds;
create policy "salary bonds are owned by their user"
on public.salary_bonds
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
