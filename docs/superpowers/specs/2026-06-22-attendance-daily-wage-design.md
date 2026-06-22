# Attendance-Based Daily Wage Pay Mode

## Summary

Add a new `daily` position pay mode where employees are paid a fixed daily rate based on attendance. Employees in `daily` positions have their attendance tracked (Present / Absent / Half Day) on each Mon–Sat working day. Payroll computes gross pay as `daily_rate × effective_days`. Positions with existing pay modes (`fixed`, `ticket`, `hybrid`) are unaffected and skip attendance entirely.

## Position & Pay Mode Changes

- New `pay_mode` value: `'daily'` added to the `positions.pay_mode` check constraint.
- New column on `positions`: `daily_rate numeric(12, 2) not null default 0 check (daily_rate >= 0)` — the PHP amount per working day.
- When `pay_mode = 'daily'`: `monthly_base_salary` is ignored (stays 0), ticket categories are not applicable.
- Position form: selecting `daily` shows a "Daily Rate" field instead of "Monthly Base Salary" and hides the ticket categories section.

## Attendance Data Model

New table `attendance_entries`:

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | default gen_random_uuid() |
| user_id | uuid FK → auth.users | RLS owner, on delete cascade |
| employee_id | uuid FK → employees | on delete cascade |
| employee_name | text | Denormalized for display |
| position_id | uuid FK → positions | Snapshot at time of entry, on delete restrict |
| position_name | text | Denormalized |
| entry_date | date | The specific working day |
| status | text | 'present', 'absent', or 'half_day' |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

Constraints:
- Unique on `(user_id, entry_date, employee_id)` — one record per employee per day.
- Check: `status in ('present', 'absent', 'half_day')`.
- RLS: `auth.uid() = user_id`.
- Indexes: `(user_id, entry_date desc)`, `(employee_id, entry_date desc)`.
- `set_updated_at` trigger.

Working days: Mon–Sat are working days, Sunday is always off. This rule is hardcoded (same pattern as payroll period date ranges in `dailyTicketEntriesForPayrollPeriod()`). No separate calendar table.

## Attendance UI View

New navigation item "Attendance" in the sidebar alongside "Daily Tickets".

View behavior:
- Date picker at top, defaults to today.
- Shows only employees whose position has `pay_mode = 'daily'`.
- Each row: employee name, position name, status selector (Present / Absent / Half Day).
- "Mark all present" bulk action button — fills all employees as Present, then adjust individuals.
- Saving writes one `attendance_entries` row per employee for that date.
- Existing entries for a date load pre-filled for editing.

Navigation:
- New `View` value: `"attendance"` with path `/attendance`.
- Added to `viewPaths`, `viewResources`.
- New `ResourceKey`: `"attendanceEntries"` — loaded for both the Attendance view and the Payroll view.

## Payroll Computation

For `daily` pay mode employees:

```
effective_days = count(present) + 0.5 × count(half_day)
gross_pay = position.daily_rate × effective_days
base_pay = gross_pay
ticket_pay = 0
```

Payroll run item snapshot columns (new on `payroll_run_items`):
- `daily_rate numeric(12, 2) not null default 0` — rate used for this payroll item.
- `days_worked numeric(5, 2) not null default 0` — effective_days (supports 0.5 increments).
- `total_working_days integer not null default 0` — Mon–Sat count for the period.

Pay mode constraint updated: `pay_mode in ('fixed', 'ticket', 'hybrid', 'daily', 'legacy')`.

Missing attendance handling:
- If a `daily` employee has zero attendance entries for the payroll period, show a warning: "Attendance not recorded for [Employee Name]. Please log attendance before generating payroll."
- That employee is excluded from the payroll run. Other employees generate normally.
- Warning links to the Attendance view.

Domain logic changes (`src/domain/payroll.ts`):
- New function: `attendanceTotalsForEmployee(entries, employeeId, periodMonth, periodYear, payPeriod)` — filters entries for the period, returns `{ presentDays, halfDays, absentDays, effectiveDays, totalWorkingDays }`.
- New helper: `workingDaysInPeriod(periodMonth, periodYear, payPeriod)` — counts Mon–Sat days in the date range.
- `payrollItemPayloadForEmployee()` gets a new branch: when `payMode === 'daily'`, compute gross from attendance totals instead of tickets.

## Offline Support & Data Layer

supabaseData.ts:
- New `loadAttendanceEntries(supabase, userId)` — fetches all attendance entries ordered by `entry_date desc`.
- Save/update/delete functions follow the `settle()` pattern.

types.ts:
- New `ResourceKey` value: `"attendanceEntries"`.
- New type: `AttendanceEntry` with fields matching the table.
- New type: `AttendanceStatus = "present" | "absent" | "half_day"`.
- `PositionPayMode` updated to include `"daily"`.

offlineDb.ts / offlineSync.ts:
- `attendanceEntries` added to `initialResourceStatuses` and `initialResourceHydration`.
- Attendance writes use `queueMutation()` when offline — standard single-row operations, no composite operation needed.

Schema migration (appended to `supabase_schema.sql`):
- `CREATE TABLE IF NOT EXISTS attendance_entries` with all constraints, indexes, RLS, trigger.
- `ALTER TABLE positions ADD COLUMN IF NOT EXISTS daily_rate`.
- `ALTER TABLE payroll_run_items` — add `daily_rate`, `days_worked`, `total_working_days` columns.
- Update `payroll_run_items.pay_mode` check constraint to include `'daily'`.
