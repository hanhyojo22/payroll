# Attendance/Ticket-linked auto-generated expenses

Date: 2026-07-04

## Context

Some company expense categories — motor rent, gasoline — are really a daily
allowance tied to an employee actually working that day, not a cost someone
manually types in after the fact. Today, every expense is entered by hand on
the Expenses page, with no link back to attendance or ticket records. The
business wants specific categories to auto-create an expense the moment an
employee is confirmed as working for the day, so these recurring per-day
allowances stop needing manual re-entry.

The catch: employees are paid under different modes (`fixed`, `ticket`,
`daily`, `hybrid`), and "working today" is recorded through two entirely
separate features depending on pay mode:

- **Daily-wage employees** are marked Present/Absent/Half-day on the
  **Attendance** page (`App.tsx:3616-3619` filters this page to
  `pos.pay_mode === "daily"` only).
- **Ticket and hybrid-paid employees** never appear on Attendance at all —
  their work is recorded as closed ticket counts on the **Daily Tickets**
  page (`daily_ticket_entries`, saved via `saveDailyTickets`/`saveTicketRow`
  in `App.tsx`).

So this feature needs two trigger points feeding one shared piece of logic,
not one.

## Goal

Let specific Company expense categories (e.g. "Motor Rent", "Gasoline") be
marked as "auto-generate from attendance." When an employee is confirmed
working for a day — Present on Attendance, or has any closed tickets that
day — every such category automatically creates a pending, one-time expense
for that employee at the category's fixed daily rate, with no manual entry
required. If the underlying attendance/ticket record is later corrected away
from "working," the auto-created expense is cleaned up automatically
(unless a payment has already been recorded against it).

## Design

### Schema (one additive migration)

```sql
alter table public.expense_categories
add column if not exists auto_generate_from_attendance boolean not null default false;

alter table public.expense_categories
add column if not exists auto_generate_daily_rate numeric(12, 2) not null default 0;
```

No other schema changes. Idempotency and "was this auto-generated" checks
are done by querying the existing `expenses` table directly (matching
employee_id + category_id + expense_date, plus a fixed marker string in
`notes` — see below) rather than adding new columns to `expenses`.

### Settings: Expense Categories (Company tab only)

The Add/Edit Category form (`ExpenseCategoryFormModal` in
`ExpensesFeature.tsx`) gains, only when `categoryScope === "company"`:
- A toggle: "Auto-generate from attendance."
- A daily rate field (`MoneyField`), shown only when the toggle is on.

Personal categories never show this — auto-generation only makes sense for
company allowances tied to an employee actually working. Off by default for
every existing and new category, so nothing changes unless a category is
explicitly opted in.

### Trigger points and shared logic

One new helper, `maybeAutoCreateAttendanceExpenses(employee, categories,
existingExpenses, date, userId)`, lives alongside the other Workspace-level
helpers in `App.tsx` (or a small new file it imports from — see Repository
section). Given an employee and a date it:

1. Filters `categories` to active, Company-type, `auto_generate_from_attendance = true`.
2. For each, checks whether `existingExpenses` already has a match on
   `employee_id + category_id + expense_date` — skip if so (idempotent
   against re-saves).
3. For the rest, builds a payload: `id: crypto.randomUUID()` (same pattern
   every other expense create already uses), `frequency: "one_time"`,
   `status: "pending"`, `amount: category.auto_generate_daily_rate`,
   `expense_date: date`, `due_date: null`, `employee_id`/`employee_name`
   from the employee, `category_id`/`category_name` from the category,
   `notes: "Auto-generated from attendance"` (the fixed marker string used
   later to identify auto-created rows for cleanup — chosen over a new
   column since it's the only place this distinction is needed). Note:
   if a user later edits that expense's notes by hand, the marker is lost
   and the correction-cleanup step in the next section will no longer find
   it — an accepted tradeoff of not adding a dedicated column.
4. Saves each via the existing `saveExpense` repository function (online) or
   `onQueueOfflineMutation` with `operation: "insert"`, `table: "expenses"`
   (offline) — the same two paths every other expense mutation already uses.

**Call sites:**
- **`saveEntry`** (Attendance, `App.tsx:3690`) — after a successful save
  where `status === "present"`, call the helper for that employee/date.
  Half-day and Absent never trigger creation.
- **`saveTicketRow`** (`App.tsx:4345`) and the per-row iteration inside
  **`saveDailyTickets`** (`App.tsx:4254`) — after a successful save, if
  `installation_tickets + repair_tickets > 0` for that row, call the helper
  for that employee/date. A saved row with zero tickets does not count as
  "present."

All three call sites already have `expenseCategories`, `expenses`,
`userId`, and `onQueueOfflineMutation` in scope as Workspace-level state/props,
so no new prop plumbing between components is needed.

### Correction / reversal handling

A second small helper, `maybeRemoveAutoCreatedExpense(employeeId, categoryId,
date, existingExpenses)`, runs when:
- Attendance for an employee/date is saved with a status **other than**
  Present (Half-day or Absent), where a Present record previously existed.
- A ticket row is saved with `installation_tickets + repair_tickets === 0`,
  where a previous save for that employee/date had a nonzero total.

For each active auto-generate category, it looks for an existing expense
matching employee_id + category_id + expense_date **and** `notes` equal to
the exact marker string. If found **and** `installment_payments.length === 0`
(no payment recorded yet — reusing the same guard the manual Delete action
already enforces), it's deleted via the existing `deleteExpense` repository
call / offline delete mutation. If a payment already exists, it's left alone
— matches the existing "can't delete an expense with payments" rule exactly,
no new business logic needed there.

### Feedback

`setNotice` on both pages includes a mention when auto-creation/removal
happened, e.g. "Attendance saved. 1 expense (Gasoline) auto-created for
Juan Dela Cruz." Kept as a simple appended sentence, not a separate toast.

### Out of scope (per earlier confirmed decisions)

- Per-employee rate overrides — one flat daily rate per category, applies
  to every qualifying employee.
- Per-employee eligibility lists — every active employee marked
  Present/ticketed qualifies for every auto-generate category.
- Half-day triggering — only full Present days (or nonzero ticket days)
  count.

## Testing

No domain-layer math is introduced (this is a data-creation side effect,
not a calculation), so no new `src/domain/**` pure functions are required
here — existing `expenseDisplayStatus`/`expenseTotalAmount`/etc. already
handle whatever the auto-created expense's fields are once it exists. This
is verified manually rather than via `npm test`:

1. Turn on "Auto-generate from attendance" for a test Company category with
   a daily rate.
2. Mark a daily-wage employee Present on Attendance for today → confirm one
   pending expense appears on the Expenses page with that category/rate/date.
3. Re-save the same attendance entry (still Present) → confirm no duplicate
   is created.
4. Change that attendance entry to Absent → confirm the auto-created
   expense (with no payments) is removed.
5. Repeat 2–4 using Daily Tickets for a ticket-paid employee: save a row
   with tickets > 0, confirm creation; save it back to 0/0, confirm removal.
6. Record a payment against an auto-created expense, then correct the
   underlying attendance/ticket entry away from "present" → confirm the
   expense is **not** deleted (payment guard holds).
7. Confirm a Personal category never shows the auto-generate toggle, and a
   Company category with the toggle off behaves exactly as before.
