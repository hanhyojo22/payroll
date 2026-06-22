# Attendance-Based Daily Wage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `daily` position pay mode where employees are paid a fixed daily rate based on Mon–Sat attendance (Present / Absent / Half Day), with a dedicated Attendance view and payroll integration.

**Architecture:** New `daily` value in the position `pay_mode` enum. A new `attendance_entries` table stores daily status per employee. Payroll computation for `daily` employees uses `daily_rate × effective_days` (present + 0.5 × half_day). A new Attendance nav view (alongside Daily Tickets) lets the admin log attendance per date.

**Tech Stack:** React + TypeScript + Vite, Supabase (Postgres + RLS), Vitest for domain tests.

## Global Constraints

- Currency: PHP, formatted with `Intl.NumberFormat("en-PH")`
- All tables use RLS with `auth.uid() = user_id`
- Offline writes go through `queueMutation()`, online writes go through Supabase directly
- Domain logic in `src/domain/` must be pure (no Supabase dependency)
- Tests run with `npx vitest run src/domain/payroll.test.ts`
- Working days: Mon–Sat (hardcoded, no calendar table)
- Payroll periods: `first_half` = days 1–15, `second_half` = days 16–end of month

---

### Task 1: Schema Migration — positions.daily_rate + attendance_entries table + payroll_run_items columns

**Files:**
- Modify: `supabase_schema.sql` (append migration block at end)

**Interfaces:**
- Produces: `positions.daily_rate` column, `attendance_entries` table, `payroll_run_items.daily_rate`/`days_worked`/`total_working_days` columns, updated `pay_mode` check constraints on both `positions` and `payroll_run_items`

- [ ] **Step 1: Add positions.daily_rate column and update pay_mode constraint**

Append to the end of `supabase_schema.sql`:

```sql
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
```

- [ ] **Step 2: Create attendance_entries table**

Continue appending:

```sql
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
```

- [ ] **Step 3: Add payroll_run_items snapshot columns and update pay_mode constraint**

Continue appending:

```sql
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
```

- [ ] **Step 4: Commit**

```bash
git add supabase_schema.sql
git commit -m "feat: add daily pay mode schema — positions.daily_rate, attendance_entries table, payroll snapshot columns"
```

---

### Task 2: TypeScript Types — AttendanceEntry, AttendanceStatus, updated Position/PayrollRunItem/ResourceKey

**Files:**
- Modify: `src/types.ts`

**Interfaces:**
- Consumes: schema from Task 1
- Produces: `AttendanceStatus` type, `AttendanceEntry` type, updated `PositionPayMode` (includes `"daily"`), updated `Position` (includes `daily_rate`), updated `PayrollRunItem` (includes `daily_rate`, `days_worked`, `total_working_days`), updated `ResourceKey` (includes `"attendanceEntries"`)

- [ ] **Step 1: Add AttendanceStatus and AttendanceEntry types**

Add after the `EmployeeWageCategory` type near the top of `src/types.ts`:

```typescript
export type AttendanceStatus = "present" | "absent" | "half_day";
```

Add after the `DailyTicketEntryDetail` type:

```typescript
export type AttendanceEntry = {
  id: string;
  user_id: string;
  employee_id: string;
  employee_name: string;
  position_id: string | null;
  position_name: string;
  entry_date: string;
  status: AttendanceStatus;
  created_at: string;
  updated_at: string;
};
```

- [ ] **Step 2: Update PositionPayMode to include "daily"**

Change:
```typescript
export type PositionPayMode = "fixed" | "ticket" | "hybrid";
```
To:
```typescript
export type PositionPayMode = "fixed" | "ticket" | "hybrid" | "daily";
```

- [ ] **Step 3: Add daily_rate to Position type**

Add `daily_rate: number;` after `monthly_base_salary` in the `Position` type.

- [ ] **Step 4: Add daily_rate to PositionFormValues type**

Add `daily_rate: string;` after `monthly_base_salary` in the `PositionFormValues` type.

- [ ] **Step 5: Add snapshot columns to PayrollRunItem type**

Add after `ticket_pay` in the `PayrollRunItem` type:
```typescript
daily_rate: number;
days_worked: number;
total_working_days: number;
```

- [ ] **Step 6: Add "attendanceEntries" to ResourceKey**

Change:
```typescript
export type ResourceKey =
  | "collections"
  | "dashboardSummary"
  | "dailyTicketEntries"
  | "employees"
  | "payments"
  | "payrollHistory"
  | "payrollRuns"
  | "positions"
  | "salaryBonds";
```
To:
```typescript
export type ResourceKey =
  | "attendanceEntries"
  | "collections"
  | "dashboardSummary"
  | "dailyTicketEntries"
  | "employees"
  | "payments"
  | "payrollHistory"
  | "payrollRuns"
  | "positions"
  | "salaryBonds";
```

- [ ] **Step 7: Verify types compile**

Run: `npx tsc --noEmit`
Expected: Type errors in files that reference the updated types (App.tsx, supabaseData.ts, etc) — these will be fixed in later tasks. The types themselves should be well-formed.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts
git commit -m "feat: add AttendanceEntry type, daily pay mode to Position, snapshot columns to PayrollRunItem"
```

---

### Task 3: Domain Logic — attendance helpers + payroll daily branch (TDD)

**Files:**
- Modify: `src/domain/payroll.ts`
- Modify: `src/domain/payroll.test.ts`

**Interfaces:**
- Consumes: `AttendanceEntry` type, `Position` type (with `daily_rate`), `PayrollPayPeriod` from types.ts
- Produces:
  - `workingDaysInPeriod(periodMonth: number, periodYear: number, payPeriod: PayrollPayPeriod): number`
  - `attendanceTotalsForEmployee(entries: AttendanceEntry[], employeeId: string, periodMonth: number, periodYear: number, payPeriod: PayrollPayPeriod): { presentDays: number; halfDays: number; absentDays: number; effectiveDays: number; totalWorkingDays: number }`
  - Updated `payrollItemPayloadForEmployee()` that handles `payMode === 'daily'`

- [ ] **Step 1: Write failing test for workingDaysInPeriod**

Add to `src/domain/payroll.test.ts`:

```typescript
import {
  payrollItemPayloadForEmployee,
  workingDaysInPeriod,
  attendanceTotalsForEmployee,
} from "./payroll";
import type { AttendanceEntry, DailyTicketEntry, Employee, Position } from "../types";
```

Update the existing import to include the new functions (replace the existing single import).

Add a new describe block after the existing one:

```typescript
describe("attendance-based daily wage", () => {
  it("counts Mon–Sat working days for first half of June 2026", () => {
    // June 2026: 1=Mon,2=Tue,...,6=Sat,7=Sun,...,13=Sat,14=Sun,15=Mon
    // Working days (Mon–Sat): 1,2,3,4,5,6, 8,9,10,11,12,13, 15 = 13 days
    expect(workingDaysInPeriod(6, 2026, "first_half")).toBe(13);
  });

  it("counts Mon–Sat working days for second half of June 2026", () => {
    // June 2026 days 16–30: 16=Tue,...,20=Sat,21=Sun,...,27=Sat,28=Sun,29=Mon,30=Tue
    // Working days: 16,17,18,19,20, 22,23,24,25,26,27, 29,30 = 13 days
    expect(workingDaysInPeriod(6, 2026, "second_half")).toBe(13);
  });

  it("handles February in a non-leap year", () => {
    // Feb 2025: 1=Sat,...,15=Sat. Working days in first half:
    // 1(Sat),3,4,5,6,7,8(Sat),10,11,12,13,14,15(Sat) = 13 days
    expect(workingDaysInPeriod(2, 2025, "first_half")).toBe(13);
    // Feb 2025 second half: 16=Sun,17–22(Mon–Sat=6),23=Sun,24–28(Mon–Fri=5) = 11
    expect(workingDaysInPeriod(2, 2025, "second_half")).toBe(11);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/payroll.test.ts`
Expected: FAIL — `workingDaysInPeriod` is not exported from `./payroll`

- [ ] **Step 3: Implement workingDaysInPeriod**

Add to `src/domain/payroll.ts`, after the existing imports:

```typescript
import type { AttendanceEntry, DailyTicketEntry, Employee, PayrollPayPeriod, PayrollRun, PayrollRunItem, Position } from "../types";
```

Update the existing import to include `AttendanceEntry`.

Add after `dailyTicketEntriesForPayrollPeriod`:

```typescript
export function workingDaysInPeriod(
  periodMonth: number,
  periodYear: number,
  payPeriod: PayrollPayPeriod,
): number {
  const startDay = payPeriod === "first_half" ? 1 : 16;
  const lastDayOfMonth = new Date(periodYear, periodMonth, 0).getDate();
  const endDay = payPeriod === "first_half" ? 15 : lastDayOfMonth;
  let count = 0;
  for (let day = startDay; day <= endDay; day++) {
    const dayOfWeek = new Date(periodYear, periodMonth - 1, day).getDay();
    if (dayOfWeek !== 0) count++;
  }
  return count;
}
```

- [ ] **Step 4: Run test to verify workingDaysInPeriod passes**

Run: `npx vitest run src/domain/payroll.test.ts`
Expected: The three new tests PASS

- [ ] **Step 5: Write failing test for attendanceTotalsForEmployee**

Add inside the `describe("attendance-based daily wage")` block:

```typescript
  const attendanceEntries: AttendanceEntry[] = [
    { id: "a1", user_id: "user-1", employee_id: "employee-1", employee_name: "Test", position_id: "position-1", position_name: "Guard", entry_date: "2026-06-01", status: "present", created_at: "", updated_at: "" },
    { id: "a2", user_id: "user-1", employee_id: "employee-1", employee_name: "Test", position_id: "position-1", position_name: "Guard", entry_date: "2026-06-02", status: "half_day", created_at: "", updated_at: "" },
    { id: "a3", user_id: "user-1", employee_id: "employee-1", employee_name: "Test", position_id: "position-1", position_name: "Guard", entry_date: "2026-06-03", status: "absent", created_at: "", updated_at: "" },
    { id: "a4", user_id: "user-1", employee_id: "employee-1", employee_name: "Test", position_id: "position-1", position_name: "Guard", entry_date: "2026-06-04", status: "present", created_at: "", updated_at: "" },
    { id: "a5", user_id: "user-1", employee_id: "other-emp", employee_name: "Other", position_id: "position-1", position_name: "Guard", entry_date: "2026-06-01", status: "present", created_at: "", updated_at: "" },
  ];

  it("computes attendance totals for an employee in a payroll period", () => {
    const totals = attendanceTotalsForEmployee(attendanceEntries, "employee-1", 6, 2026, "first_half");
    expect(totals.presentDays).toBe(2);
    expect(totals.halfDays).toBe(1);
    expect(totals.absentDays).toBe(1);
    expect(totals.effectiveDays).toBe(2.5);
    expect(totals.totalWorkingDays).toBe(13);
  });

  it("excludes entries from other employees", () => {
    const totals = attendanceTotalsForEmployee(attendanceEntries, "other-emp", 6, 2026, "first_half");
    expect(totals.presentDays).toBe(1);
    expect(totals.halfDays).toBe(0);
    expect(totals.effectiveDays).toBe(1);
  });

  it("returns zero totals when no entries exist for the period", () => {
    const totals = attendanceTotalsForEmployee(attendanceEntries, "employee-1", 7, 2026, "first_half");
    expect(totals.presentDays).toBe(0);
    expect(totals.effectiveDays).toBe(0);
  });
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/domain/payroll.test.ts`
Expected: FAIL — `attendanceTotalsForEmployee` is not exported

- [ ] **Step 7: Implement attendanceTotalsForEmployee**

Add to `src/domain/payroll.ts` after `workingDaysInPeriod`:

```typescript
export function attendanceTotalsForEmployee(
  entries: AttendanceEntry[],
  employeeId: string,
  periodMonth: number,
  periodYear: number,
  payPeriod: PayrollPayPeriod,
) {
  const periodEntries = entries.filter((entry) => {
    if (entry.employee_id !== employeeId) return false;
    const [entryYear, entryMonth, entryDay] = entry.entry_date.split("-").map(Number);
    const matchesMonth = entryYear === periodYear && entryMonth === periodMonth;
    const matchesHalf = payPeriod === "first_half" ? entryDay >= 1 && entryDay <= 15 : entryDay >= 16;
    return matchesMonth && matchesHalf;
  });
  const presentDays = periodEntries.filter((e) => e.status === "present").length;
  const halfDays = periodEntries.filter((e) => e.status === "half_day").length;
  const absentDays = periodEntries.filter((e) => e.status === "absent").length;
  return {
    presentDays,
    halfDays,
    absentDays,
    effectiveDays: presentDays + 0.5 * halfDays,
    totalWorkingDays: workingDaysInPeriod(periodMonth, periodYear, payPeriod),
  };
}
```

- [ ] **Step 8: Run test to verify attendanceTotalsForEmployee passes**

Run: `npx vitest run src/domain/payroll.test.ts`
Expected: All attendance total tests PASS

- [ ] **Step 9: Write failing test for payrollItemPayloadForEmployee with daily mode**

Add inside the `describe("attendance-based daily wage")` block:

```typescript
  function dailyPosition(dailyRate: number): Position {
    return {
      id: "position-1",
      user_id: "user-1",
      name: "Guard",
      department: "Security",
      description: "",
      status: "active",
      pay_mode: "daily",
      monthly_base_salary: 0,
      daily_rate: dailyRate,
      categories: [],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
  }

  it("computes daily wage payroll from attendance entries", () => {
    // 2 present + 1 half_day = 2.5 effective days × 800 = 2000
    const item = payrollItemPayloadForEmployee(
      employee, "run-1", "user-1", [], dailyPosition(800), attendanceEntries, 6, 2026, "first_half",
    );
    expect(item.pay_mode).toBe("daily");
    expect(item.daily_rate).toBe(800);
    expect(item.days_worked).toBe(2.5);
    expect(item.total_working_days).toBe(13);
    expect(item.base_pay).toBe(2000);
    expect(item.ticket_pay).toBe(0);
    expect(item.gross_pay).toBe(2000);
    expect(item.net_pay).toBe(2000);
  });

  it("produces zero pay when no attendance entries exist for daily employee", () => {
    const item = payrollItemPayloadForEmployee(
      employee, "run-1", "user-1", [], dailyPosition(800), [], 6, 2026, "first_half",
    );
    expect(item.days_worked).toBe(0);
    expect(item.gross_pay).toBe(0);
  });
```

- [ ] **Step 10: Run test to verify it fails**

Run: `npx vitest run src/domain/payroll.test.ts`
Expected: FAIL — function signature mismatch (new parameters not yet accepted)

- [ ] **Step 11: Update payrollItemPayloadForEmployee to handle daily mode**

Modify `payrollItemPayloadForEmployee` in `src/domain/payroll.ts`. Add new optional parameters and a `daily` branch.

Change the function signature from:
```typescript
export function payrollItemPayloadForEmployee(
  employee: Employee,
  payrollRunId: string,
  userId: string,
  dailyTicketEntries: DailyTicketEntry[] = [],
  position?: Position,
): Omit<PayrollRunItem, "id" | "created_at" | "updated_at"> {
```
To:
```typescript
export function payrollItemPayloadForEmployee(
  employee: Employee,
  payrollRunId: string,
  userId: string,
  dailyTicketEntries: DailyTicketEntry[] = [],
  position?: Position,
  attendanceEntries: AttendanceEntry[] = [],
  periodMonth = 0,
  periodYear = 0,
  payPeriod: PayrollPayPeriod = "first_half",
): Omit<PayrollRunItem, "id" | "created_at" | "updated_at"> {
```

Add the daily branch after the `payMode` assignment. Replace the block starting with `const basePay =` through to `const gross =` with:

```typescript
  let basePay: number;
  let ticketPay: number;
  let dailyRate = 0;
  let daysWorked = 0;
  let totalWorkingDays = 0;

  if (payMode === "daily") {
    dailyRate = toNumber(position?.daily_rate);
    const totals = attendanceTotalsForEmployee(attendanceEntries, employee.id, periodMonth, periodYear, payPeriod);
    daysWorked = totals.effectiveDays;
    totalWorkingDays = totals.totalWorkingDays;
    basePay = dailyRate * daysWorked;
    ticketPay = 0;
  } else {
    basePay = payMode === "fixed" || payMode === "hybrid"
      ? toNumber(position?.monthly_base_salary) / 2
      : 0;
    ticketPay = payMode === "fixed" ? 0 : legacyTicketGross;
  }
  const gross = basePay + ticketPay;
```

Update the return object to include the new fields. Add after `ticket_pay: ticketPay,`:
```typescript
    daily_rate: dailyRate,
    days_worked: daysWorked,
    total_working_days: totalWorkingDays,
```

- [ ] **Step 12: Run all tests to verify they pass**

Run: `npx vitest run src/domain/payroll.test.ts`
Expected: ALL tests PASS (existing tests still pass because new params are optional with defaults)

- [ ] **Step 13: Commit**

```bash
git add src/domain/payroll.ts src/domain/payroll.test.ts
git commit -m "feat: add workingDaysInPeriod, attendanceTotalsForEmployee, daily branch in payroll computation"
```

---

### Task 4: Data Layer — loadAttendanceEntries + updated loadPositions select + ResourceKey plumbing

**Files:**
- Modify: `src/lib/supabaseData.ts`
- Modify: `src/App.tsx` (only the `initialResourceStatuses`, `initialResourceHydration`, resource key plumbing — NOT the UI views yet)

**Interfaces:**
- Consumes: `AttendanceEntry` type from types.ts, `attendance_entries` table from Task 1
- Produces: `loadAttendanceEntries(supabase: SupabaseClient): Promise<{ data: AttendanceEntry[]; error: AppErrorLike | null; label: string }>`

- [ ] **Step 1: Add loadAttendanceEntries to supabaseData.ts**

Add `AttendanceEntry` to the import from `"../types"`:
```typescript
import type {
  AttendanceEntry,
  CollectionReminder,
  // ... rest unchanged
} from "../types";
```

Add after `loadDailyTicketEntries`:

```typescript
export async function loadAttendanceEntries(supabase: SupabaseClient) {
  return settle<AttendanceEntry>(
    "Attendance",
    supabase
      .from("attendance_entries")
      .select("id,user_id,employee_id,employee_name,position_id,position_name,entry_date,status,created_at,updated_at")
      .order("entry_date", { ascending: false }),
  );
}
```

- [ ] **Step 2: Update loadPositions select to include daily_rate**

Change the `.select(...)` in `loadPositions` from:
```
"id,user_id,name,department,description,status,pay_mode,monthly_base_salary,created_at,updated_at,categories:position_ticket_categories(...)"
```
To include `daily_rate`:
```
"id,user_id,name,department,description,status,pay_mode,monthly_base_salary,daily_rate,created_at,updated_at,categories:position_ticket_categories(...)"
```

- [ ] **Step 3: Update loadPayrollRunItems and loadDashboardSummary selects to include new columns**

In `loadPayrollRunItems`, add `daily_rate,days_worked,total_working_days` to the select string, after `ticket_pay`:
```
"...,base_pay,ticket_pay,daily_rate,days_worked,total_working_days,installation_tickets,..."
```

In `loadDashboardSummary` where `currentItemsResult` is fetched, add the same columns to that select string.

In `loadEmployeePayrollRuns`, add `daily_rate,days_worked,total_working_days` to the select, and add these fields to the `payrollItem` object construction:
```typescript
daily_rate: item.daily_rate,
days_worked: item.days_worked,
total_working_days: item.total_working_days,
```

- [ ] **Step 4: Add attendanceEntries to initialResourceStatuses and initialResourceHydration in App.tsx**

In `src/App.tsx`, add `attendanceEntries: "idle"` to `initialResourceStatuses` and `attendanceEntries: false` to `initialResourceHydration` (alphabetical order — add as the first entry).

- [ ] **Step 5: Add loadAttendanceEntries import and resource loading case in App.tsx**

Add `loadAttendanceEntries` to the import from `"./lib/supabaseData"`.

Find the `loadResource` function (or the switch/if-else block that loads resources by key). Add a case for `"attendanceEntries"` that calls `loadAttendanceEntries` and stores the result, following the exact same pattern as `"dailyTicketEntries"`.

- [ ] **Step 6: Add attendanceEntries state variable in Workspace component**

Add alongside the existing state variables like `dailyTicketEntries`:
```typescript
const [attendanceEntries, setAttendanceEntries] = useState<AttendanceEntry[]>([]);
```

Import `AttendanceEntry` from `"./types"` (add to the existing import).

- [ ] **Step 7: Commit**

```bash
git add src/lib/supabaseData.ts src/App.tsx
git commit -m "feat: add loadAttendanceEntries, daily_rate to position select, attendance resource plumbing"
```

---

### Task 5: Position Form — daily pay mode option + daily_rate field

**Files:**
- Modify: `src/App.tsx` (PositionForm component ~line 1815, savePosition function ~line 1570)

**Interfaces:**
- Consumes: `PositionFormValues` with `daily_rate` field from Task 2
- Produces: Updated position form UI with "Daily wage" option and daily rate field

- [ ] **Step 1: Update PositionForm default values**

In the `PositionForm` component, update the initial values construction.

Where the initial values are set from an existing position (the `initial ?` branch), add:
```typescript
daily_rate: String(initial.daily_rate ?? 0),
```
after `monthly_base_salary`.

In the default values (the `: {` branch for new positions), add:
```typescript
daily_rate: "",
```
after `monthly_base_salary`.

- [ ] **Step 2: Add "Daily wage" option to the pay mode select**

In the `<select value={values.pay_mode}>` element, add a new option:
```html
<option value="daily">Daily wage</option>
```

- [ ] **Step 3: Show daily_rate field when pay_mode is "daily", hide monthly salary and tickets**

Update the conditional for showing the monthly base salary field. Change:
```typescript
{values.pay_mode !== "ticket" && <TextField label="Monthly base salary" .../>}
```
To:
```typescript
{(values.pay_mode === "fixed" || values.pay_mode === "hybrid") && <TextField label="Monthly base salary" min="0" step="0.01" type="number" value={values.monthly_base_salary} onChange={(monthly_base_salary) => setValues({ ...values, monthly_base_salary })} required />}
{values.pay_mode === "daily" && <TextField label="Daily rate" min="0" step="0.01" type="number" value={values.daily_rate} onChange={(daily_rate) => setValues({ ...values, daily_rate })} required />}
```

Update `usesTickets` to exclude `daily`:
```typescript
const usesTickets = values.pay_mode === "ticket" || values.pay_mode === "hybrid";
```
(This is already correct — `daily` won't show ticket categories.)

- [ ] **Step 4: Update savePosition to persist daily_rate**

In the `savePosition` function, update the payload construction. Where `monthly_base_salary` is set:
```typescript
monthly_base_salary: values.pay_mode === "ticket" ? 0 : toNumber(values.monthly_base_salary),
```
Change to:
```typescript
monthly_base_salary: (values.pay_mode === "fixed" || values.pay_mode === "hybrid") ? toNumber(values.monthly_base_salary) : 0,
daily_rate: values.pay_mode === "daily" ? toNumber(values.daily_rate) : 0,
```

- [ ] **Step 5: Update pay mode display labels throughout App.tsx**

Search for all instances of pay mode label logic (the pattern `position.pay_mode === "fixed" ? "Fixed salary" : ...`). There are approximately 4 occurrences. Add `"daily"` handling to each:

Change patterns like:
```typescript
position.pay_mode === "fixed" ? "Fixed salary" : position.pay_mode === "ticket" ? "Per ticket" : "Base + ticket"
```
To:
```typescript
position.pay_mode === "fixed" ? "Fixed salary" : position.pay_mode === "ticket" ? "Per ticket" : position.pay_mode === "daily" ? "Daily wage" : "Base + ticket"
```

Similarly for `item.pay_mode` in payroll item display — add `item.pay_mode === "daily" ? "Daily wage" :` to the ternary chain.

- [ ] **Step 6: Update DailyTicketEntryView to exclude daily positions**

In the `DailyTicketEntryView` component (~line 1924), the filter already skips `fixed` positions:
```typescript
if (!position || (!entry && position.status !== "active") || position.pay_mode === "fixed") return [];
```
Change to also skip `daily`:
```typescript
if (!position || (!entry && position.status !== "active") || position.pay_mode === "fixed" || position.pay_mode === "daily") return [];
```

- [ ] **Step 7: Verify the app compiles**

Run: `npx tsc --noEmit`
Expected: No type errors (or only errors related to remaining UI tasks)

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "feat: add daily wage option to position form, update pay mode labels, exclude daily from ticket entry"
```

---

### Task 6: Attendance View — new navigation + attendance entry UI

**Files:**
- Modify: `src/App.tsx` (View type, viewPaths, viewResources, sidebar nav, content area, new AttendanceView component)

**Interfaces:**
- Consumes: `AttendanceEntry` from types.ts, `loadAttendanceEntries` from supabaseData.ts, employees/positions state
- Produces: Full Attendance view with date picker, employee list, status selectors, "Mark all present" button, save per employee

- [ ] **Step 1: Add "attendance" to View type, viewPaths, viewResources**

Update the `View` type to include `"attendance"`:
```typescript
type View =
  | "attendance"
  | "dashboard"
  // ... rest unchanged
```

Add to `viewPaths`:
```typescript
attendance: "/attendance",
```

Add to `viewResources`:
```typescript
attendance: ["positions", "employees", "attendanceEntries"],
```

- [ ] **Step 2: Add Attendance nav button to sidebar**

In the sidebar nav, add after the Daily Tickets nav group (after the closing `</div>` of the daily ticket group, before the Payroll NavButton):

```tsx
<NavButton active={view === "attendance"} icon={<CheckCircle2 size={18} />} label="Attendance" onClick={() => navigate("attendance")} />
```

`CheckCircle2` is already imported from lucide-react.

- [ ] **Step 3: Add attendanceEntries to payroll viewResources**

Update the payroll view resources to include attendance data:
```typescript
payroll: ["positions", "employees", "attendanceEntries", "dailyTicketEntries", "payrollRuns", "salaryBonds"],
```

- [ ] **Step 4: Add AttendanceView component rendering in the content area**

In the content area where views are rendered, add after the `daily-tickets` block:

```tsx
{view === "attendance" && (
  <AttendanceView
    attendanceEntries={attendanceEntries}
    employees={employees}
    positions={positions}
    onChange={refreshAttendancePage}
    onQueueOfflineMutation={queueOfflineMutation}
    setNotice={setNotice}
    userId={session.user.id}
  />
)}
```

Add `refreshAttendancePage` function alongside the existing `refreshDailyTicketsPage` etc:
```typescript
async function refreshAttendancePage() {
  await loadResource("attendanceEntries", true);
}
```

- [ ] **Step 5: Implement AttendanceView component**

Add the component in `src/App.tsx` after the `DailyTicketEntryView` component (around line 2050). This follows the same structural pattern as `DailyTicketEntryView`:

```tsx
export function AttendanceView({
  attendanceEntries,
  employees,
  positions,
  onChange,
  onQueueOfflineMutation,
  setNotice,
  userId,
}: {
  attendanceEntries: AttendanceEntry[];
  employees: Employee[];
  positions: Position[];
  onChange: () => Promise<void>;
  onQueueOfflineMutation: QueueOfflineMutation;
  setNotice: (notice: Notice) => void;
  userId: string;
}) {
  const [entryDate, setEntryDate] = useState(todayKey());
  const [drafts, setDrafts] = useState<Record<string, AttendanceStatus>>({});
  const [busyEmployeeId, setBusyEmployeeId] = useState("");

  const dailyEmployees = employees.filter((emp) => {
    if (emp.status !== "active") return false;
    const pos = positions.find((p) => p.id === emp.position_id);
    return pos?.pay_mode === "daily" && pos.status === "active";
  });

  const existingEntries = new Map(
    attendanceEntries
      .filter((e) => e.entry_date === entryDate)
      .map((e) => [e.employee_id, e]),
  );

  function statusFor(employeeId: string): AttendanceStatus | "" {
    if (drafts[employeeId] !== undefined) return drafts[employeeId];
    const entry = existingEntries.get(employeeId);
    return entry?.status ?? "";
  }

  function setStatus(employeeId: string, status: AttendanceStatus) {
    setDrafts((prev) => ({ ...prev, [employeeId]: status }));
  }

  function markAllPresent() {
    const newDrafts: Record<string, AttendanceStatus> = {};
    dailyEmployees.forEach((emp) => {
      if (!existingEntries.has(emp.id)) {
        newDrafts[emp.id] = "present";
      }
    });
    setDrafts((prev) => ({ ...prev, ...newDrafts }));
  }

  async function saveEntry(emp: Employee) {
    const status = statusFor(emp.id);
    if (!status) return;
    setBusyEmployeeId(emp.id);
    const pos = positions.find((p) => p.id === emp.position_id);
    const existing = existingEntries.get(emp.id);
    const payload = {
      user_id: userId,
      employee_id: emp.id,
      employee_name: emp.full_name,
      position_id: emp.position_id,
      position_name: pos?.name ?? "",
      entry_date: entryDate,
      status,
    };

    if (!navigator.onLine || !supabase) {
      await onQueueOfflineMutation({
        resource: "attendanceEntries",
        affectedResources: ["attendanceEntries"],
        operation: existing ? "update" : "upsert",
        table: "attendance_entries",
        recordId: existing?.id,
        payload,
        options: existing ? undefined : { onConflict: "user_id,entry_date,employee_id" },
      });
      setDrafts((prev) => { const next = { ...prev }; delete next[emp.id]; return next; });
      setBusyEmployeeId("");
      return;
    }

    const result = existing
      ? await supabase.from("attendance_entries").update({ status }).eq("id", existing.id)
      : await supabase.from("attendance_entries").upsert(payload, { onConflict: "user_id,entry_date,employee_id" });

    if (result.error) {
      if (isOfflineLikeError(result.error)) {
        await onQueueOfflineMutation({
          resource: "attendanceEntries",
          affectedResources: ["attendanceEntries"],
          operation: existing ? "update" : "upsert",
          table: "attendance_entries",
          recordId: existing?.id,
          payload,
          options: existing ? undefined : { onConflict: "user_id,entry_date,employee_id" },
        });
      } else {
        setNotice({ type: "error", text: result.error.message ?? "Failed to save attendance." });
      }
    } else {
      setDrafts((prev) => { const next = { ...prev }; delete next[emp.id]; return next; });
    }
    setBusyEmployeeId("");
    await onChange();
  }

  async function saveAll() {
    for (const emp of dailyEmployees) {
      if (statusFor(emp.id)) {
        await saveEntry(emp);
      }
    }
    setNotice({ type: "success", text: "Attendance saved." });
  }

  useEffect(() => {
    setDrafts({});
  }, [entryDate]);

  return (
    <div className="stack">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Daily tracking</p>
          <h2>Attendance</h2>
        </div>
        <div className="inline-actions">
          <button className="secondary-button compact" onClick={markAllPresent} type="button">
            <CheckCircle2 size={15} /> Mark all present
          </button>
          <button className="primary-button compact" onClick={saveAll} type="button">
            <Save size={15} /> Save all
          </button>
        </div>
      </div>
      <div className="filter-bar">
        <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
      </div>
      {dailyEmployees.length === 0 ? (
        <p className="muted-text">No employees with daily-wage positions found.</p>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Position</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {dailyEmployees.map((emp) => {
                const pos = positions.find((p) => p.id === emp.position_id);
                const current = statusFor(emp.id);
                const saved = existingEntries.has(emp.id);
                const dirty = drafts[emp.id] !== undefined;
                return (
                  <tr key={emp.id}>
                    <td>{emp.full_name}</td>
                    <td>{pos?.name ?? "—"}</td>
                    <td>
                      <select
                        value={current}
                        onChange={(e) => setStatus(emp.id, e.target.value as AttendanceStatus)}
                      >
                        <option value="">— Select —</option>
                        <option value="present">Present</option>
                        <option value="absent">Absent</option>
                        <option value="half_day">Half Day</option>
                      </select>
                    </td>
                    <td>
                      {dirty && (
                        <button
                          className="secondary-button compact"
                          disabled={busyEmployeeId === emp.id}
                          onClick={() => saveEntry(emp)}
                          type="button"
                        >
                          <Save size={14} /> {busyEmployeeId === emp.id ? "Saving..." : "Save"}
                        </button>
                      )}
                      {saved && !dirty && <span className="badge success">Saved</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Import AttendanceStatus type in App.tsx**

Add `AttendanceStatus` and `AttendanceEntry` to the import from `"./types"` (if not already imported from Task 4 step 6).

- [ ] **Step 7: Verify the app compiles**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "feat: add Attendance view with date picker, status selectors, mark-all-present, save"
```

---

### Task 7: Payroll Generation — integrate attendance for daily employees + missing attendance warning

**Files:**
- Modify: `src/App.tsx` (PayrollView component — `createRun` function and `addMissingItems` function)
- Modify: `src/domain/payroll.ts` (already updated in Task 3, just wiring the new params through)

**Interfaces:**
- Consumes: `attendanceEntries` state, `attendanceTotalsForEmployee` from payroll.ts, `PayrollView` props
- Produces: Updated payroll generation that blocks daily employees with no attendance and passes attendance data to payroll computation

- [ ] **Step 1: Add attendanceEntries prop to PayrollView**

Update the `PayrollView` component props to accept attendance entries:

Add to the props type:
```typescript
attendanceEntries: AttendanceEntry[];
```

Update the JSX where `PayrollView` is rendered in the content area to pass the prop:
```tsx
attendanceEntries={attendanceEntries}
```

- [ ] **Step 2: Import attendanceTotalsForEmployee in App.tsx**

Add `attendanceTotalsForEmployee` to the import from `"./domain/payroll"`:
```typescript
import {
  attendanceTotalsForEmployee,
  dailyTicketEntriesForPayrollPeriod,
  payPeriodLabel,
  payrollItemPayloadForEmployee,
} from "./domain/payroll";
```

- [ ] **Step 3: Update payrollItemPayloadForEmployeeWithSalaryBonds to accept and forward attendance params**

Change the function signature to accept attendance data:
```typescript
function payrollItemPayloadForEmployeeWithSalaryBonds(
  employee: Employee,
  position: Position | undefined,
  payrollRunId: string,
  userId: string,
  dailyTicketEntries: DailyTicketEntry[],
  salaryBonds: SalaryBond[],
  payrollDate: string,
  attendanceEntries: AttendanceEntry[] = [],
  periodMonth = 0,
  periodYear = 0,
  payPeriod: PayrollPayPeriod = "first_half",
) {
```

Update the call to `payrollItemPayloadForEmployee` inside it:
```typescript
const payload = payrollItemPayloadForEmployee(
  employee, payrollRunId, userId, dailyTicketEntries, position,
  attendanceEntries, periodMonth, periodYear, payPeriod,
);
```

- [ ] **Step 4: Add missing attendance warning in createRun**

In the `createRun` function, after the `invalidEmployees` check and before the `runPayload` construction, add:

```typescript
const periodMonth = Number(values.period_month);
const periodYear = Number(values.period_year);
const payPeriod = values.pay_period;

const missingAttendanceEmployees = activeEmployees.filter((emp) => {
  const pos = positions.find((p) => p.id === emp.position_id);
  if (pos?.pay_mode !== "daily") return false;
  const totals = attendanceTotalsForEmployee(attendanceEntries, emp.id, periodMonth, periodYear, payPeriod);
  return totals.presentDays + totals.halfDays + totals.absentDays === 0;
});

if (missingAttendanceEmployees.length > 0) {
  setNotice({
    type: "error",
    text: `Attendance not recorded for: ${missingAttendanceEmployees.map((e) => e.full_name).join(", ")}. Please log attendance before generating payroll.`,
  });
  return;
}
```

- [ ] **Step 5: Update all payrollItemPayloadForEmployeeWithSalaryBonds calls to pass attendance data**

There are 3 call sites in `createRun` (one for online, one for offline, one for offline-fallback). Each currently looks like:
```typescript
payrollItemPayloadForEmployeeWithSalaryBonds(
  employee,
  positions.find((position) => position.id === employee.position_id),
  offlineRun.id,
  userId,
  periodDailyEntries,
  salaryBonds,
  offlineRun.generated_date,
)
```

Add the attendance params to each call:
```typescript
payrollItemPayloadForEmployeeWithSalaryBonds(
  employee,
  positions.find((position) => position.id === employee.position_id),
  offlineRun.id,
  userId,
  periodDailyEntries,
  salaryBonds,
  offlineRun.generated_date,
  attendanceEntries,
  offlineRun.period_month,
  offlineRun.period_year,
  offlineRun.pay_period,
)
```

For the online path (`newRun`), use `newRun.period_month`, `newRun.period_year`, `newRun.pay_period`.

Also update the `addMissingItems` function (the one that adds individual employees to an existing payroll run, around line 3730) the same way.

- [ ] **Step 6: Run all tests**

Run: `npx vitest run src/domain/payroll.test.ts`
Expected: ALL tests PASS

- [ ] **Step 7: Verify the app compiles**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/domain/payroll.ts
git commit -m "feat: integrate attendance into payroll generation, block daily employees with missing attendance"
```

---

### Task 8: Payroll Item Display — show daily wage details in payroll run view

**Files:**
- Modify: `src/App.tsx` (PayrollView item rendering)

**Interfaces:**
- Consumes: `PayrollRunItem` with `daily_rate`, `days_worked`, `total_working_days` fields
- Produces: Updated payroll item cards/rows that show daily wage breakdown for daily-mode items

- [ ] **Step 1: Find payroll item detail display**

In `PayrollView`, find where individual payroll items are rendered (the item detail/expansion section that shows base_pay, ticket_pay, gross_pay, etc). For daily-mode items, show the daily wage breakdown instead of ticket details.

Find the section that renders ticket details (e.g., `item.ticket_details.map(...)` or the section that shows installation/repair ticket counts).

- [ ] **Step 2: Add daily wage breakdown display**

Where payroll item details are rendered, add a conditional block for daily items:

```tsx
{item.pay_mode === "daily" && (
  <div className="detail-row">
    <DetailItem label="Daily rate" value={currency.format(item.daily_rate)} />
    <DetailItem label="Days worked" value={`${item.days_worked} / ${item.total_working_days}`} />
    <DetailItem label="Gross pay" value={currency.format(item.gross_pay)} />
  </div>
)}
```

Ensure the existing ticket detail display is wrapped with a condition to exclude daily items:
```tsx
{item.pay_mode !== "daily" && (
  // ... existing ticket details rendering
)}
```

- [ ] **Step 3: Update the notes/label for daily items in the payroll list**

Where item.pay_mode is displayed as a label on payroll item cards (the pattern `item.pay_mode === "fixed" ? "Fixed salary" : ...`), it was already updated in Task 5 step 5. Verify it reads correctly.

- [ ] **Step 4: Verify the app compiles**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: show daily wage breakdown (rate, days worked) in payroll item display"
```

---

### Task 9: Final Integration — verify end-to-end flow

**Files:**
- No new files — verification only

**Interfaces:**
- Consumes: All previous tasks
- Produces: Verified working feature

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: ALL tests PASS

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 3: Start dev server and test**

Run: `npm run dev`

Manual verification checklist:
1. Create a new position with pay_mode "Daily wage" and daily_rate 800
2. Assign an active employee to that position
3. Go to Attendance view — employee should appear
4. Select a date, mark employee as Present for some days, Absent for others, Half Day for one
5. Go to Payroll — generate a payroll run for the period
6. Verify the daily employee's payroll item shows correct: daily_rate × effective_days = gross_pay
7. Verify "Mark all present" button works
8. Verify a daily employee with NO attendance entries blocks payroll generation with a warning
9. Verify existing fixed/ticket/hybrid employees are unaffected
10. Verify Daily Tickets view does NOT show daily-wage employees

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "feat: attendance-based daily wage pay mode — complete feature"
```
