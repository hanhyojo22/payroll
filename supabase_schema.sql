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
    bond_type text not null default 'Salary Advance',
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
  add column if not exists bond_type text not null default 'Salary Advance';

  alter table public.salary_bonds
  add column if not exists date_granted date not null default current_date;

  alter table public.salary_bonds
  add column if not exists start_deduction date not null default current_date;

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
  check (pay_mode in ('fixed', 'ticket', 'hybrid', 'legacy'));

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

  -- Group legacy employees by their old rate pair so no future rate is silently changed.
  do $$
  declare
    rate_group record;
    legacy_position_id uuid;
  begin
    for rate_group in
      select distinct user_id, installation_rate, repair_rate
      from public.employees
      where position_id is null
    loop
      insert into public.positions (user_id, name, department, description, pay_mode, monthly_base_salary)
      values (
        rate_group.user_id,
        'Legacy ' || trim(to_char(rate_group.installation_rate, 'FM999999990.00')) || '/' || trim(to_char(rate_group.repair_rate, 'FM999999990.00')),
        'Legacy',
        'Migrated from employee installation and repair rates.',
        'ticket',
        0
      )
      on conflict (user_id, name) do update set updated_at = now()
      returning id into legacy_position_id;

      insert into public.position_ticket_categories (user_id, position_id, name, rate, display_order)
      values
        (rate_group.user_id, legacy_position_id, 'Installation', rate_group.installation_rate, 0),
        (rate_group.user_id, legacy_position_id, 'Repair', rate_group.repair_rate, 1)
      on conflict (position_id, name) do nothing;

      update public.employees
      set position_id = legacy_position_id
      where user_id = rate_group.user_id
        and installation_rate = rate_group.installation_rate
        and repair_rate = rate_group.repair_rate
        and position_id is null;
    end loop;
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
