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
  hire_date date,
  status text not null default 'active' check (status in ('active', 'inactive')),
  monthly_salary numeric(12, 2) not null default 0 check (monthly_salary >= 0),
  sss_number text not null default '',
  philhealth_number text not null default '',
  pagibig_number text not null default '',
  tin_number text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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

drop trigger if exists set_payment_reminders_updated_at on public.payment_reminders;
create trigger set_payment_reminders_updated_at
before update on public.payment_reminders
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

alter table public.payment_reminders enable row level security;
alter table public.payroll_records enable row level security;
alter table public.employees enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payroll_run_items enable row level security;

drop policy if exists "payment reminders are owned by their user" on public.payment_reminders;
create policy "payment reminders are owned by their user"
on public.payment_reminders
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
