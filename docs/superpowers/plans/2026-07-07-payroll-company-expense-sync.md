# Payroll → Company Expenses Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every generated payroll run automatically appears as a single line item in Company Expenses, kept in sync (amount + paid/pending status) with the run's real state, including offline — without any manual double-entry.

**Architecture:** A payroll run gets one linked `expenses` row whose `id` equals the run's own `id` (so every sync is a plain idempotent `upsert`, no lookup needed). A new pure domain function computes that row's shape (amount = sum of net pay, status = paid only when every item is paid) from data already available at each payroll mutation site. That computed row is upserted the same way `ExpensesFeature` already upserts expenses offline — no new offline-queue machinery.

**Tech Stack:** React + TypeScript, Supabase (Postgres + RLS), Vitest for domain tests, existing offline mutation queue (`onQueueOfflineMutation`).

## Global Constraints

- Net pay only (not gross), matching what the dashboard already treats as real cash outflow.
- Going-forward only — no backfill for payroll runs generated before this feature ships.
- Online-and-offline: the sync must work through the same offline queue payroll mutations already use.
- No new offline composite operation types — reuse the existing generic `"upsert"` operation on the `expenses` table.
- The linked expense's `id` is always the same as its `payroll_run_id` (the payroll run's own `id`).
- Auto-synced expense rows are read-only in the Expenses UI (no Edit/Delete/Record Payment/Cancel/End actions) — they only ever change via the Payroll feature.
- No task here handles payroll run deletion — that feature doesn't exist in the app today.

---

### Task 1: Schema migration and `Expense` type

**Files:**
- Modify: `supabase_schema.sql` (append at end of file, after the `payment_reminder_payments` block, currently ending at line 1979)
- Modify: `src/types.ts:145-164` (`Expense` type)
- Modify: `src/features/expenses/expenseRepository.ts:6` (`EXPENSE_SELECT`)

**Interfaces:**
- Produces: `Expense.payroll_run_id: string | null` — consumed by Task 2 (domain function return type) and Task 9 (UI guard).

- [ ] **Step 1: Append the migration to `supabase_schema.sql`**

Add this at the very end of the file:

```sql

-- Link an auto-generated "Payroll" company expense to the payroll run it summarizes.
-- The expense's own id is set equal to payroll_run_id by the application, so every sync
-- is a plain upsert by id — no separate existence check is ever needed.
alter table public.expenses
add column if not exists payroll_run_id uuid references public.payroll_runs(id) on delete cascade;

alter table public.expenses
drop constraint if exists expenses_payroll_run_id_key;

alter table public.expenses
add constraint expenses_payroll_run_id_key unique (payroll_run_id);
```

- [ ] **Step 2: Add the field to the `Expense` type**

In `src/types.ts`, find the `Expense` type (currently lines 145-164):

```ts
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
  created_at: string;
  updated_at: string;
};
```

Change it to:

```ts
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
  created_at: string;
  updated_at: string;
};
```

- [ ] **Step 3: Add the column to the Supabase select string**

In `src/features/expenses/expenseRepository.ts`, line 6, change:

```ts
const EXPENSE_SELECT = `id,user_id,employee_id,employee_name,category_id,category_name,amount,frequency,duration_months,status,paid_date,expense_date,due_date,payment_date,notes,created_at,updated_at,installment_payments:expense_installment_payments(${EXPENSE_INSTALLMENT_PAYMENT_SELECT})`;
```

to:

```ts
const EXPENSE_SELECT = `id,user_id,employee_id,employee_name,category_id,category_name,amount,frequency,duration_months,status,paid_date,expense_date,due_date,payment_date,notes,payroll_run_id,created_at,updated_at,installment_payments:expense_installment_payments(${EXPENSE_INSTALLMENT_PAYMENT_SELECT})`;
```

- [ ] **Step 4: Apply the migration to your Supabase project**

Run the SQL from Step 1 against your Supabase database (via the SQL editor or your usual migration process — this repo doesn't have an automated migration runner, `supabase_schema.sql` is the source of truth applied manually).

- [ ] **Step 5: Verify the build compiles**

Run: `npm run build`
Expected: no TypeScript errors (the new field is optional-safe since every existing `Expense`-producing code path will need updating only where the type checker complains — check the output for any).

- [ ] **Step 6: Commit**

```bash
git add supabase_schema.sql src/types.ts src/features/expenses/expenseRepository.ts
git commit -m "feat: add payroll_run_id link column to expenses"
```

---

### Task 2: `payrollExpensePayload` domain function (TDD)

**Files:**
- Modify: `src/domain/payroll.ts` (add function + import)
- Test: `src/domain/payroll.test.ts` (add test block)

**Interfaces:**
- Consumes: `Expense` type from Task 1.
- Produces: `payrollExpensePayload(run, items, categoryId, userId): Omit<Expense, "installment_payments" | "created_at" | "updated_at">` — consumed by Task 5-8 (every payroll mutation call site) via `saveExpense()` (online) or as the offline mutation `payload` directly.

- [ ] **Step 1: Write the failing tests**

Add to the end of `src/domain/payroll.test.ts`:

```ts
describe("payrollExpensePayload", () => {
  const run = {
    id: "run-1",
    period_month: 7,
    period_year: 2026,
    pay_period: "first_half" as const,
    generated_date: "2026-07-01",
  };

  it("sums net_pay across all items", () => {
    const items = [
      { net_pay: 5000, status: "pending" as const, paid_date: null },
      { net_pay: 3500, status: "pending" as const, paid_date: null },
    ];
    const payload = payrollExpensePayload(run, items, "category-1", "user-1");
    expect(payload.amount).toBe(8500);
  });

  it("is pending when any item is unpaid", () => {
    const items = [
      { net_pay: 5000, status: "paid" as const, paid_date: "2026-07-05" },
      { net_pay: 3500, status: "pending" as const, paid_date: null },
    ];
    const payload = payrollExpensePayload(run, items, "category-1", "user-1");
    expect(payload.status).toBe("pending");
    expect(payload.paid_date).toBeNull();
  });

  it("is paid with the latest paid_date only when every item is paid", () => {
    const items = [
      { net_pay: 5000, status: "paid" as const, paid_date: "2026-07-05" },
      { net_pay: 3500, status: "paid" as const, paid_date: "2026-07-07" },
    ];
    const payload = payrollExpensePayload(run, items, "category-1", "user-1");
    expect(payload.status).toBe("paid");
    expect(payload.paid_date).toBe("2026-07-07");
  });

  it("defaults to pending with zero amount when there are no items", () => {
    const payload = payrollExpensePayload(run, [], "category-1", "user-1");
    expect(payload.status).toBe("pending");
    expect(payload.amount).toBe(0);
    expect(payload.paid_date).toBeNull();
  });

  it("labels the category, employee_name period, and links the run id", () => {
    const payload = payrollExpensePayload(run, [], "category-1", "user-1");
    expect(payload.category_id).toBe("category-1");
    expect(payload.category_name).toBe("Payroll");
    expect(payload.employee_name).toBe("July 2026 – 1st Cutoff");
    expect(payload.id).toBe("run-1");
    expect(payload.payroll_run_id).toBe("run-1");
    expect(payload.user_id).toBe("user-1");
  });

  it("uses '2nd Cutoff' label for second_half runs", () => {
    const secondHalfRun = { ...run, pay_period: "second_half" as const };
    const payload = payrollExpensePayload(secondHalfRun, [], "category-1", "user-1");
    expect(payload.employee_name).toBe("July 2026 – 2nd Cutoff");
  });
});
```

Also add `payrollExpensePayload` to the existing import at the top of the test file:

```ts
import {
  dailyTicketTotalsForEmployee,
  governmentDeductionForEmployee,
  payrollExpensePayload,
  payrollItemPayloadForEmployee,
  workingDaysInPeriod,
  attendanceTotalsForEmployee,
} from "./payroll";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/domain/payroll.test.ts`
Expected: FAIL — `payrollExpensePayload is not a function` (or similar import error).

- [ ] **Step 3: Implement the function**

In `src/domain/payroll.ts`, change the top import block from:

```ts
import type { AttendanceEntry, DailyTicketEntry, Employee, PayrollPayPeriod, PayrollRun, PayrollRunItem, PayrollSettings, Position } from "../types";
import {
  normalizeTicketCount,
  toNumber,
} from "./tickets";
```

to:

```ts
import type { AttendanceEntry, DailyTicketEntry, Employee, Expense, PayrollPayPeriod, PayrollRun, PayrollRunItem, PayrollSettings, Position } from "../types";
import {
  normalizeTicketCount,
  toNumber,
} from "./tickets";
import { monthNames } from "../shared/utils/dates";
```

Then add this function at the end of the file (after `payrollItemPayloadForEmployee`):

```ts
export function payrollExpensePayload(
  run: Pick<PayrollRun, "id" | "period_month" | "period_year" | "pay_period" | "generated_date">,
  items: Array<Pick<PayrollRunItem, "net_pay" | "status" | "paid_date">>,
  categoryId: string,
  userId: string,
): Omit<Expense, "installment_payments" | "created_at" | "updated_at"> {
  const amount = items.reduce((sum, item) => sum + toNumber(item.net_pay), 0);
  const allPaid = items.length > 0 && items.every((item) => item.status === "paid");
  const paidDate = allPaid
    ? items.reduce<string | null>((latest, item) => {
      if (!item.paid_date) return latest;
      return !latest || item.paid_date > latest ? item.paid_date : latest;
    }, null)
    : null;
  const cutoffLabel = run.pay_period === "first_half" ? "1st Cutoff" : "2nd Cutoff";

  return {
    id: run.id,
    user_id: userId,
    employee_id: null,
    employee_name: `${monthNames[run.period_month - 1]} ${run.period_year} – ${cutoffLabel}`,
    category_id: categoryId,
    category_name: "Payroll",
    amount,
    frequency: "one_time",
    duration_months: null,
    status: allPaid ? "paid" : "pending",
    paid_date: paidDate,
    expense_date: run.generated_date,
    due_date: null,
    payment_date: null,
    notes: "Auto-generated from payroll run",
    payroll_run_id: run.id,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/domain/payroll.test.ts`
Expected: PASS — all tests including the 6 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/domain/payroll.ts src/domain/payroll.test.ts
git commit -m "feat: add payrollExpensePayload domain function"
```

---

### Task 3: `ensurePayrollExpenseCategory` repository function

**Files:**
- Modify: `src/features/expenses/expenseRepository.ts`

**Interfaces:**
- Consumes: `fetchExpenseCategories`, `saveExpenseCategory` (both already in this file).
- Produces: `ensurePayrollExpenseCategory(supabase, userId): Promise<{ data: ExpenseCategory | null; error: unknown }>` — consumed by Task 4 (PayrollFeature effect).

- [ ] **Step 1: Add the function**

In `src/features/expenses/expenseRepository.ts`, add this after `deleteExpenseCategory` (after line 40):

```ts
export async function ensurePayrollExpenseCategory(supabase: SupabaseClient, userId: string) {
  const existing = await fetchExpenseCategories(supabase);
  const found = existing.data.find((category) => category.type === "company" && category.name === "Payroll");
  if (found) return { data: found, error: null };

  const result = await saveExpenseCategory(supabase, userId, { name: "Payroll", type: "company", status: "active" });
  return { data: result.data as ExpenseCategory | null, error: result.error };
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/expenses/expenseRepository.ts
git commit -m "feat: add ensurePayrollExpenseCategory repository function"
```

---

### Task 4: Wire `expenseCategories` into the Payroll view

**Files:**
- Modify: `src/App.tsx:263` (`viewResources.payroll`)
- Modify: `src/App.tsx:265` (`viewResources["payroll-history"]`)
- Modify: `src/App.tsx:755-763` (`refreshPayrollPage`)
- Modify: `src/App.tsx:1205-1224` (`<PayrollFeature>` render)
- Modify: `src/features/payroll/PayrollFeature.tsx:205-233` (`PayrollFeature` props)

**Interfaces:**
- Consumes: existing `expenseCategories` state/setter/loader in App.tsx (already wired for the Expenses feature — no changes needed to `resourceLoaders`/`resourceSetters`).
- Produces: `PayrollFeature` receives an `expenseCategories: ExpenseCategory[]` prop — consumed by Task 5's category-ensure effect.

- [ ] **Step 1: Add `expenses`/`expenseCategories` to the Payroll view's resources**

In `src/App.tsx`, change line 263 from:

```ts
  payroll: ["positions", "employees", "attendanceEntries", "dailyTicketEntries", "payrollRuns", "employeeAdvances", "payrollHistory", "payrollSettings"],
```

to:

```ts
  payroll: ["positions", "employees", "attendanceEntries", "dailyTicketEntries", "payrollRuns", "employeeAdvances", "payrollHistory", "payrollSettings", "expenses", "expenseCategories"],
```

And line 265 from:

```ts
  "payroll-history": ["positions", "employees", "attendanceEntries", "dailyTicketEntries", "payrollRuns", "employeeAdvances", "payrollHistory", "payrollSettings"],
```

to:

```ts
  "payroll-history": ["positions", "employees", "attendanceEntries", "dailyTicketEntries", "payrollRuns", "employeeAdvances", "payrollHistory", "payrollSettings", "expenses", "expenseCategories"],
```

- [ ] **Step 2: Force-refresh expenses after payroll actions**

In `src/App.tsx`, change `refreshPayrollPage` (lines 755-763) from:

```ts
  async function refreshPayrollPage() {
    await Promise.all([
      loadResource("payrollRuns", true),
      loadResource("employeeAdvances", true),
      loadResource("payrollHistory", true),
      loadResource("payrollSettings", true),
      loadResource("dashboardSummary", true),
    ]);
  }
```

to:

```ts
  async function refreshPayrollPage() {
    await Promise.all([
      loadResource("payrollRuns", true),
      loadResource("employeeAdvances", true),
      loadResource("payrollHistory", true),
      loadResource("payrollSettings", true),
      loadResource("dashboardSummary", true),
      loadResource("expenses", true),
      loadResource("expenseCategories", true),
    ]);
  }
```

- [ ] **Step 3: Pass `expenseCategories` into `PayrollFeature`**

In `src/App.tsx`, the `<PayrollFeature>` render (lines 1205-1224) currently reads:

```tsx
                    <PayrollFeature
                      attendanceEntries={attendanceEntries}
                      dailyTicketEntries={dailyTicketEntries}
                      employees={employees}
                      ensurePayrollRunItems={ensurePayrollRunItems}
                      onLocalPayrollRunsChange={setPayrollRuns}
                      onChange={refreshPayrollPage}
                      onQueueOfflineMutation={queueOfflineMutation}
                      payrollSettings={payrollSettings}
                      payrollRuns={payrollRuns}
                      positions={positions}
                      employeeAdvances={employeeAdvances}
                      tabs={(
```

Add `expenseCategories={expenseCategories}` (alphabetically after `ensurePayrollRunItems`):

```tsx
                    <PayrollFeature
                      attendanceEntries={attendanceEntries}
                      dailyTicketEntries={dailyTicketEntries}
                      employees={employees}
                      ensurePayrollRunItems={ensurePayrollRunItems}
                      expenseCategories={expenseCategories}
                      onLocalPayrollRunsChange={setPayrollRuns}
                      onChange={refreshPayrollPage}
                      onQueueOfflineMutation={queueOfflineMutation}
                      payrollSettings={payrollSettings}
                      payrollRuns={payrollRuns}
                      positions={positions}
                      employeeAdvances={employeeAdvances}
                      tabs={(
```

- [ ] **Step 4: Accept the new prop in `PayrollFeature`**

In `src/features/payroll/PayrollFeature.tsx`, the props destructure and type (lines 205-233) currently read:

```tsx
export function PayrollFeature({
  attendanceEntries,
  dailyTicketEntries,
  employees,
  ensurePayrollRunItems,
  onLocalPayrollRunsChange,
  onChange,
  onQueueOfflineMutation,
  payrollRuns,
  payrollSettings,
  positions,
  employeeAdvances,
  tabs,
  userId,
}: {
  attendanceEntries: AttendanceEntry[];
  dailyTicketEntries: DailyTicketEntry[];
  employees: Employee[];
  ensurePayrollRunItems: (payrollRunId: string) => Promise<void>;
  onLocalPayrollRunsChange: (payrollRuns: PayrollRunWithItems[]) => void;
  onChange: () => Promise<void>;
  onQueueOfflineMutation: QueueOfflineMutation;
  payrollRuns: PayrollRunWithItems[];
  payrollSettings: PayrollSettings | null;
  positions: Position[];
  employeeAdvances: EmployeeAdvance[];
  tabs?: ReactNode;
  userId: string;
}) {
```

Change to:

```tsx
export function PayrollFeature({
  attendanceEntries,
  dailyTicketEntries,
  employees,
  ensurePayrollRunItems,
  expenseCategories,
  onLocalPayrollRunsChange,
  onChange,
  onQueueOfflineMutation,
  payrollRuns,
  payrollSettings,
  positions,
  employeeAdvances,
  tabs,
  userId,
}: {
  attendanceEntries: AttendanceEntry[];
  dailyTicketEntries: DailyTicketEntry[];
  employees: Employee[];
  ensurePayrollRunItems: (payrollRunId: string) => Promise<void>;
  expenseCategories: ExpenseCategory[];
  onLocalPayrollRunsChange: (payrollRuns: PayrollRunWithItems[]) => void;
  onChange: () => Promise<void>;
  onQueueOfflineMutation: QueueOfflineMutation;
  payrollRuns: PayrollRunWithItems[];
  payrollSettings: PayrollSettings | null;
  positions: Position[];
  employeeAdvances: EmployeeAdvance[];
  tabs?: ReactNode;
  userId: string;
}) {
```

Add `ExpenseCategory` to the type-only import at the top of the file. Change:

```ts
import type {
  AttendanceEntry,
  DailyTicketEntry,
  EmployeeAdvance,
  Employee,
  PayrollHistoryRow,
  PayrollPayPeriod,
  PayrollRun,
  PayrollRunFormValues,
  PayrollRunItem,
  PayrollSettings,
  PayrollRunWithItems,
  Position,
} from "../../types";
```

to:

```ts
import type {
  AttendanceEntry,
  DailyTicketEntry,
  EmployeeAdvance,
  Employee,
  ExpenseCategory,
  PayrollHistoryRow,
  PayrollPayPeriod,
  PayrollRun,
  PayrollRunFormValues,
  PayrollRunItem,
  PayrollSettings,
  PayrollRunWithItems,
  Position,
} from "../../types";
```

- [ ] **Step 5: Verify the build compiles**

Run: `npx tsc --noEmit`
Expected: no errors (the new prop is required but now supplied at the only call site).

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/features/payroll/PayrollFeature.tsx
git commit -m "feat: load expense categories on the Payroll view"
```

---

### Task 5: Category-ensure effect, shared sync helper, and `createRun` wiring

**Files:**
- Modify: `src/features/payroll/PayrollFeature.tsx`

**Interfaces:**
- Consumes: `payrollExpensePayload` (Task 2), `ensurePayrollExpenseCategory` (Task 3), `expenseCategories` prop (Task 4).
- Produces: `syncPayrollExpense(run, items): Promise<void>` (component-local function) — consumed by Task 6, 7, 8.

- [ ] **Step 1: Import the new dependencies**

In `src/features/payroll/PayrollFeature.tsx`, change:

```ts
import {
  attendanceTotalsForEmployee,
  dailyTicketEntriesForPayrollPeriod,
  governmentDeductionForEmployee,
  payrollItemPayloadForEmployee,
} from "../../domain/payroll";
import { netPay, normalizeTicketCount, ticketGrossPay } from "../../domain/tickets";
import { isOfflineLikeError } from "../../lib/offlineSync";
import { supabase } from "../../supabase";
import { Modal, TextField } from "../../shared/components/FormLayout";
import { DataTable } from "../../shared/components/DataTable";
import { PageHeader, RecordTitle, Toolbar } from "../../shared/components/PageLayout";
import { ensurePayrollSettings, savePayrollSettings } from "./payrollRepository";
```

to:

```ts
import {
  attendanceTotalsForEmployee,
  dailyTicketEntriesForPayrollPeriod,
  governmentDeductionForEmployee,
  payrollExpensePayload,
  payrollItemPayloadForEmployee,
} from "../../domain/payroll";
import { netPay, normalizeTicketCount, ticketGrossPay } from "../../domain/tickets";
import { isOfflineLikeError } from "../../lib/offlineSync";
import { supabase } from "../../supabase";
import { Modal, TextField } from "../../shared/components/FormLayout";
import { DataTable } from "../../shared/components/DataTable";
import { PageHeader, RecordTitle, Toolbar } from "../../shared/components/PageLayout";
import { ensurePayrollSettings, savePayrollSettings } from "./payrollRepository";
import { ensurePayrollExpenseCategory, saveExpense } from "../expenses/expenseRepository";
```

- [ ] **Step 2: Add category-ensure state and effect**

Immediately after the existing `activePayrollSettings` effect block (after line 259, `}, [activePayrollSettings, userId]);`), add:

```tsx
  const [payrollExpenseCategoryId, setPayrollExpenseCategoryId] = useState<string | null>(
    expenseCategories.find((category) => category.type === "company" && category.name === "Payroll")?.id ?? null,
  );

  useEffect(() => {
    const found = expenseCategories.find((category) => category.type === "company" && category.name === "Payroll");
    if (found) setPayrollExpenseCategoryId(found.id);
  }, [expenseCategories]);

  useEffect(() => {
    if (!supabase || payrollExpenseCategoryId || !navigator.onLine) return;
    void ensurePayrollExpenseCategory(supabase, userId).then(({ data }) => {
      if (data) setPayrollExpenseCategoryId(data.id);
    });
  }, [payrollExpenseCategoryId, userId]);
```

- [ ] **Step 3: Add the shared sync helper**

Add this function right after `createOfflinePayrollItems` and before `createRun` (the function that currently starts the file's mutation logic — insert it directly above `async function createRun(values: PayrollRunFormValues) {`):

```tsx
  async function syncPayrollExpense(
    run: Pick<PayrollRun, "id" | "period_month" | "period_year" | "pay_period" | "generated_date">,
    items: Array<Pick<PayrollRunItem, "net_pay" | "status" | "paid_date">>,
  ) {
    if (!payrollExpenseCategoryId) return;
    const payload = payrollExpensePayload(run, items, payrollExpenseCategoryId, userId);

    if (!navigator.onLine) {
      await onQueueOfflineMutation({
        resource: "expenses",
        affectedResources: ["expenses", "dashboardSummary"],
        operation: "upsert",
        table: "expenses",
        recordId: payload.id,
        payload,
      });
      return;
    }

    if (!supabase) return;
    const result = await saveExpense(supabase, payload);
    if (result.error && isOfflineLikeError(result.error)) {
      await onQueueOfflineMutation({
        resource: "expenses",
        affectedResources: ["expenses", "dashboardSummary"],
        operation: "upsert",
        table: "expenses",
        recordId: payload.id,
        payload,
      });
      return;
    }
    if (result.error) {
      NotificationService.showError("Payroll saved, but couldn't sync it to Company Expenses.");
    }
  }
```

- [ ] **Step 4: Wire `syncPayrollExpense` into `createRun`'s three exit branches**

In `createRun`, the offline branch (currently ending with, around line 436-444):

```tsx
      await onQueueOfflineMutation({
        resource: "payrollRuns",
        affectedResources: ["payrollRuns", "payrollHistory", "employeeAdvances", "dashboardSummary"],
        operation: "payroll_group",
        table: "payroll_runs",
        payload: {
          runPayload: offlineRun,
          itemPayloads,
          detailPayloads,
          employeeAdvanceUpdates,
        },
      });
      onLocalPayrollRunsChange([
        { ...offlineRun, items: offlineItems },
        ...payrollRuns,
      ]);
      setFormOpen(false);
      setSelectedRunId(offlineRunId);
      return;
    }
```

Change to (adding the `syncPayrollExpense` call before `setFormOpen(false)`):

```tsx
      await onQueueOfflineMutation({
        resource: "payrollRuns",
        affectedResources: ["payrollRuns", "payrollHistory", "employeeAdvances", "dashboardSummary"],
        operation: "payroll_group",
        table: "payroll_runs",
        payload: {
          runPayload: offlineRun,
          itemPayloads,
          detailPayloads,
          employeeAdvanceUpdates,
        },
      });
      await syncPayrollExpense(offlineRun, itemPayloads);
      onLocalPayrollRunsChange([
        { ...offlineRun, items: offlineItems },
        ...payrollRuns,
      ]);
      setFormOpen(false);
      setSelectedRunId(offlineRunId);
      return;
    }
```

The second branch (online request failed with an offline-like error, currently around lines 484-502) has the identical shape:

```tsx
        await onQueueOfflineMutation({
          resource: "payrollRuns",
          affectedResources: ["payrollRuns", "payrollHistory", "employeeAdvances", "dashboardSummary"],
          operation: "payroll_group",
          table: "payroll_runs",
          payload: {
            runPayload: offlineRun,
            itemPayloads,
            detailPayloads,
            employeeAdvanceUpdates,
          },
        });
        onLocalPayrollRunsChange([
          { ...offlineRun, items: offlineItems },
          ...payrollRuns,
        ]);
        setFormOpen(false);
        setSelectedRunId(offlineRunId);
        return;
      }
```

Change it the same way — insert the sync call after `onQueueOfflineMutation` and before `onLocalPayrollRunsChange`:

```tsx
        await onQueueOfflineMutation({
          resource: "payrollRuns",
          affectedResources: ["payrollRuns", "payrollHistory", "employeeAdvances", "dashboardSummary"],
          operation: "payroll_group",
          table: "payroll_runs",
          payload: {
            runPayload: offlineRun,
            itemPayloads,
            detailPayloads,
            employeeAdvanceUpdates,
          },
        });
        await syncPayrollExpense(offlineRun, itemPayloads);
        onLocalPayrollRunsChange([
          { ...offlineRun, items: offlineItems },
          ...payrollRuns,
        ]);
        setFormOpen(false);
        setSelectedRunId(offlineRunId);
        return;
      }
```

The online-success branch currently ends with (around lines 564-568):

```tsx
    NotificationService.showSuccess("Payroll run generated.");
    setFormOpen(false);
    setSelectedRunId(newRun.id);
    await onChange();
  }
```

Change to:

```tsx
    NotificationService.showSuccess("Payroll run generated.");
    setFormOpen(false);
    setSelectedRunId(newRun.id);
    await syncPayrollExpense(newRun, itemPayloads);
    await onChange();
  }
```

- [ ] **Step 5: Verify the build compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual smoke check**

Run: `npm run dev`, log in, go to Payroll, generate a new payroll run for a period that doesn't exist yet. Open the Company Expenses tab (or reload it) and confirm a "Payroll" category row appears for that period, status Pending, amount equal to the sum of net pay shown on the Payroll page.

- [ ] **Step 7: Commit**

```bash
git add src/features/payroll/PayrollFeature.tsx
git commit -m "feat: sync generated payroll runs to a linked company expense"
```

---

### Task 6: Wire `updateItem`

**Files:**
- Modify: `src/features/payroll/PayrollFeature.tsx:570-633` (`updateItem`)

**Interfaces:**
- Consumes: `syncPayrollExpense` (Task 5).

- [ ] **Step 1: Compute the affected run and its updated items once, and reuse it**

`updateItem` currently reads (lines 570-633):

```tsx
  async function updateItem(item: PayrollRunItem, patch: Partial<PayrollRunItem>) {
    if (!supabase) return;
    const installationTickets = normalizeTicketCount(patch.installation_tickets ?? item.installation_tickets);
    const repairTickets = normalizeTicketCount(patch.repair_tickets ?? item.repair_tickets);
    const installationRate = toNumber(patch.installation_rate ?? item.installation_rate);
    const repairRate = toNumber(patch.repair_rate ?? item.repair_rate);
    const allowances = toNumber(patch.allowances ?? item.allowances);
    const deductions = toNumber(patch.deductions ?? item.deductions);
    const ticketFieldsChanged = patch.installation_tickets !== undefined || patch.repair_tickets !== undefined ||
      patch.installation_rate !== undefined || patch.repair_rate !== undefined;
    const ticketPay = ticketFieldsChanged
      ? ticketGrossPay(installationTickets, repairTickets, installationRate, repairRate)
      : toNumber(item.ticket_pay);
    const basePay = toNumber(item.base_pay);
    const gross = basePay + ticketPay;
    const payload = {
      ...patch,
      installation_tickets: installationTickets,
      repair_tickets: repairTickets,
      installation_rate: installationRate,
      repair_rate: repairRate,
      base_pay: basePay,
      ticket_pay: ticketPay,
      gross_pay: gross,
      net_pay: netPay(gross, allowances, deductions),
    };
    if (!navigator.onLine) {
      onLocalPayrollRunsChange(payrollRuns.map((run) => ({
        ...run,
        items: run.items.map((runItem) => runItem.id === item.id ? { ...runItem, ...payload } : runItem),
      })));
      await onQueueOfflineMutation({
        resource: "payrollRuns",
        affectedResources: ["payrollRuns", "payrollHistory", "dashboardSummary"],
        operation: "update",
        table: "payroll_run_items",
        recordId: item.id,
        payload,
      });
      return;
    }
    const { error } = await supabase.from("payroll_run_items").update(payload).eq("id", item.id);
    if (error && isOfflineLikeError(error)) {
      onLocalPayrollRunsChange(payrollRuns.map((run) => ({
        ...run,
        items: run.items.map((runItem) => runItem.id === item.id ? { ...runItem, ...payload } : runItem),
      })));
      await onQueueOfflineMutation({
        resource: "payrollRuns",
        affectedResources: ["payrollRuns", "payrollHistory", "dashboardSummary"],
        operation: "update",
        table: "payroll_run_items",
        recordId: item.id,
        payload,
      });
      return;
    }
    if (error) {
      NotificationService.showError(friendlyError(error));
    } else {
      NotificationService.showSuccess("Payroll item updated.");
    }
    await onChange();
  }
```

Replace the whole function with (this factors the repeated `run.items.map(...)` expression into one `runForSync`/`itemsForSync` pair computed once, reused by both local-state updates and the new sync calls):

```tsx
  async function updateItem(item: PayrollRunItem, patch: Partial<PayrollRunItem>) {
    if (!supabase) return;
    const installationTickets = normalizeTicketCount(patch.installation_tickets ?? item.installation_tickets);
    const repairTickets = normalizeTicketCount(patch.repair_tickets ?? item.repair_tickets);
    const installationRate = toNumber(patch.installation_rate ?? item.installation_rate);
    const repairRate = toNumber(patch.repair_rate ?? item.repair_rate);
    const allowances = toNumber(patch.allowances ?? item.allowances);
    const deductions = toNumber(patch.deductions ?? item.deductions);
    const ticketFieldsChanged = patch.installation_tickets !== undefined || patch.repair_tickets !== undefined ||
      patch.installation_rate !== undefined || patch.repair_rate !== undefined;
    const ticketPay = ticketFieldsChanged
      ? ticketGrossPay(installationTickets, repairTickets, installationRate, repairRate)
      : toNumber(item.ticket_pay);
    const basePay = toNumber(item.base_pay);
    const gross = basePay + ticketPay;
    const payload = {
      ...patch,
      installation_tickets: installationTickets,
      repair_tickets: repairTickets,
      installation_rate: installationRate,
      repair_rate: repairRate,
      base_pay: basePay,
      ticket_pay: ticketPay,
      gross_pay: gross,
      net_pay: netPay(gross, allowances, deductions),
    };
    const runForSync = payrollRuns.find((run) => run.id === item.payroll_run_id);
    const itemsForSync = runForSync
      ? runForSync.items.map((runItem) => runItem.id === item.id ? { ...runItem, ...payload } : runItem)
      : [];
    if (!navigator.onLine) {
      onLocalPayrollRunsChange(payrollRuns.map((run) => ({
        ...run,
        items: run.items.map((runItem) => runItem.id === item.id ? { ...runItem, ...payload } : runItem),
      })));
      await onQueueOfflineMutation({
        resource: "payrollRuns",
        affectedResources: ["payrollRuns", "payrollHistory", "dashboardSummary"],
        operation: "update",
        table: "payroll_run_items",
        recordId: item.id,
        payload,
      });
      if (runForSync) await syncPayrollExpense(runForSync, itemsForSync);
      return;
    }
    const { error } = await supabase.from("payroll_run_items").update(payload).eq("id", item.id);
    if (error && isOfflineLikeError(error)) {
      onLocalPayrollRunsChange(payrollRuns.map((run) => ({
        ...run,
        items: run.items.map((runItem) => runItem.id === item.id ? { ...runItem, ...payload } : runItem),
      })));
      await onQueueOfflineMutation({
        resource: "payrollRuns",
        affectedResources: ["payrollRuns", "payrollHistory", "dashboardSummary"],
        operation: "update",
        table: "payroll_run_items",
        recordId: item.id,
        payload,
      });
      if (runForSync) await syncPayrollExpense(runForSync, itemsForSync);
      return;
    }
    if (error) {
      NotificationService.showError(friendlyError(error));
    } else {
      NotificationService.showSuccess("Payroll item updated.");
    }
    if (runForSync) await syncPayrollExpense(runForSync, itemsForSync);
    await onChange();
  }
```

- [ ] **Step 2: Verify the build compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual smoke check**

In the running app (from Task 5's `npm run dev` session), mark one payroll item as paid (not all) via its row action. Reload Expenses — the linked "Payroll" row should still show Pending (since not every item is paid yet) with an unchanged amount. Then mark every remaining item paid one at a time; after the last one, reload Expenses and confirm the row flips to Paid.

- [ ] **Step 4: Commit**

```bash
git add src/features/payroll/PayrollFeature.tsx
git commit -m "feat: keep linked payroll expense in sync on item updates"
```

---

### Task 7: Wire `addMissingEmployees`

**Files:**
- Modify: `src/features/payroll/PayrollFeature.tsx:635-716` (`addMissingEmployees`)

**Interfaces:**
- Consumes: `syncPayrollExpense` (Task 5).

- [ ] **Step 1: Add sync calls to all three exit branches**

The offline branch currently reads (around lines 673-686):

```tsx
    if (!navigator.onLine) {
      const { detailPayloads, itemPayloads: offlineItemPayloads, items: offlineItems } = createOfflinePayrollItems(itemPayloads);
      onLocalPayrollRunsChange(payrollRuns.map((run) =>
        run.id === selectedRun.id ? { ...run, items: [...run.items, ...offlineItems] } : run,
      ));
      await onQueueOfflineMutation({
        resource: "payrollRuns",
        affectedResources: ["payrollRuns", "payrollHistory", "employeeAdvances", "dashboardSummary"],
        operation: "payroll_items_group",
        table: "payroll_run_items",
        payload: { itemPayloads: offlineItemPayloads, detailPayloads, employeeAdvanceUpdates },
      });
      return;
    }
```

Change to:

```tsx
    if (!navigator.onLine) {
      const { detailPayloads, itemPayloads: offlineItemPayloads, items: offlineItems } = createOfflinePayrollItems(itemPayloads);
      onLocalPayrollRunsChange(payrollRuns.map((run) =>
        run.id === selectedRun.id ? { ...run, items: [...run.items, ...offlineItems] } : run,
      ));
      await onQueueOfflineMutation({
        resource: "payrollRuns",
        affectedResources: ["payrollRuns", "payrollHistory", "employeeAdvances", "dashboardSummary"],
        operation: "payroll_items_group",
        table: "payroll_run_items",
        payload: { itemPayloads: offlineItemPayloads, detailPayloads, employeeAdvanceUpdates },
      });
      await syncPayrollExpense(selectedRun, [...selectedRun.items, ...itemPayloads]);
      return;
    }
```

The online-request-failed-offline-like branch currently reads (around lines 689-701):

```tsx
      if (isOfflineLikeError(error)) {
        const { detailPayloads, itemPayloads: offlineItemPayloads, items: offlineItems } = createOfflinePayrollItems(itemPayloads);
        onLocalPayrollRunsChange(payrollRuns.map((run) =>
          run.id === selectedRun.id ? { ...run, items: [...run.items, ...offlineItems] } : run,
        ));
        await onQueueOfflineMutation({
          resource: "payrollRuns",
          affectedResources: ["payrollRuns", "payrollHistory", "employeeAdvances", "dashboardSummary"],
          operation: "payroll_items_group",
          table: "payroll_run_items",
          payload: { itemPayloads: offlineItemPayloads, detailPayloads, employeeAdvanceUpdates },
        });
        return;
      }
```

Change to:

```tsx
      if (isOfflineLikeError(error)) {
        const { detailPayloads, itemPayloads: offlineItemPayloads, items: offlineItems } = createOfflinePayrollItems(itemPayloads);
        onLocalPayrollRunsChange(payrollRuns.map((run) =>
          run.id === selectedRun.id ? { ...run, items: [...run.items, ...offlineItems] } : run,
        ));
        await onQueueOfflineMutation({
          resource: "payrollRuns",
          affectedResources: ["payrollRuns", "payrollHistory", "employeeAdvances", "dashboardSummary"],
          operation: "payroll_items_group",
          table: "payroll_run_items",
          payload: { itemPayloads: offlineItemPayloads, detailPayloads, employeeAdvanceUpdates },
        });
        await syncPayrollExpense(selectedRun, [...selectedRun.items, ...itemPayloads]);
        return;
      }
```

The online-success branch currently ends with (around lines 707-716):

```tsx
    const advanceDeductions = employeePayrollItems.flatMap((item) => item.advanceDeductions);
    const advanceError = await applyEmployeeAdvancePayrollDeductions(advanceDeductions);
    if (advanceError) {
      NotificationService.showError(friendlyError(advanceError));
      return;
    }

    NotificationService.showSuccess(`${missingEmployees.length} employee${missingEmployees.length === 1 ? "" : "s"} added to payroll.`);
    await onChange();
  }
```

Change to:

```tsx
    const advanceDeductions = employeePayrollItems.flatMap((item) => item.advanceDeductions);
    const advanceError = await applyEmployeeAdvancePayrollDeductions(advanceDeductions);
    if (advanceError) {
      NotificationService.showError(friendlyError(advanceError));
      return;
    }

    NotificationService.showSuccess(`${missingEmployees.length} employee${missingEmployees.length === 1 ? "" : "s"} added to payroll.`);
    await syncPayrollExpense(selectedRun, [...selectedRun.items, ...itemPayloads]);
    await onChange();
  }
```

- [ ] **Step 2: Verify the build compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/payroll/PayrollFeature.tsx
git commit -m "feat: keep linked payroll expense in sync when adding missing employees"
```

---

### Task 8: Wire `applyMissingPayrollDeductions` and `markAllPaid`

**Files:**
- Modify: `src/features/payroll/PayrollFeature.tsx:755-810`

**Interfaces:**
- Consumes: `syncPayrollExpense` (Task 5), `allItems`/`selectedRun`/`pendingItems` (already computed in this component, lines 719-753).

- [ ] **Step 1: Wire `applyMissingPayrollDeductions`**

Currently ends with (around lines 775-785):

```tsx
    const advanceError = await applyEmployeeAdvancePayrollDeductions(
      itemsNeedingPayrollDeductions.flatMap((entry) => entry.patch.advanceDeductions),
    );
    if (advanceError) {
      NotificationService.showError(friendlyError(advanceError));
      return;
    }

    NotificationService.showSuccess(`Applied payroll deductions to ${itemsNeedingPayrollDeductions.length} payroll item${itemsNeedingPayrollDeductions.length === 1 ? "" : "s"}.`);
    await onChange();
  }
```

Change to (using `allItems`, the already-computed view of this run's items with deduction patches applied, which is exactly what the database will hold once this succeeds):

```tsx
    const advanceError = await applyEmployeeAdvancePayrollDeductions(
      itemsNeedingPayrollDeductions.flatMap((entry) => entry.patch.advanceDeductions),
    );
    if (advanceError) {
      NotificationService.showError(friendlyError(advanceError));
      return;
    }

    NotificationService.showSuccess(`Applied payroll deductions to ${itemsNeedingPayrollDeductions.length} payroll item${itemsNeedingPayrollDeductions.length === 1 ? "" : "s"}.`);
    await syncPayrollExpense(selectedRun, allItems);
    await onChange();
  }
```

- [ ] **Step 2: Wire `markAllPaid`**

Currently ends with (around lines 799-810):

```tsx
    const paidDate = todayKey();
    for (const item of pendingItems) {
      const { error } = await supabase.from("payroll_run_items").update({ status: "paid", paid_date: paidDate }).eq("id", item.id);
      if (error) {
        NotificationService.showError(friendlyError(error));
        return;
      }
    }

    NotificationService.showSuccess(`Marked ${pendingItems.length} payroll item${pendingItems.length === 1 ? "" : "s"} as paid.`);
    await onChange();
  }
```

Change to:

```tsx
    const paidDate = todayKey();
    for (const item of pendingItems) {
      const { error } = await supabase.from("payroll_run_items").update({ status: "paid", paid_date: paidDate }).eq("id", item.id);
      if (error) {
        NotificationService.showError(friendlyError(error));
        return;
      }
    }

    NotificationService.showSuccess(`Marked ${pendingItems.length} payroll item${pendingItems.length === 1 ? "" : "s"} as paid.`);
    const paidItemsForSync = allItems.map((item) => item.status !== "paid" ? { ...item, status: "paid" as const, paid_date: paidDate } : item);
    await syncPayrollExpense(selectedRun, paidItemsForSync);
    await onChange();
  }
```

- [ ] **Step 3: Verify the build compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual smoke check**

Generate a fresh payroll run with 2+ employees, then use "Pay all" (`markAllPaid`'s button in the UI). Reload Expenses and confirm the linked row flips straight to Paid with today's date.

- [ ] **Step 5: Commit**

```bash
git add src/features/payroll/PayrollFeature.tsx
git commit -m "feat: keep linked payroll expense in sync on bulk deductions and pay-all"
```

---

### Task 9: Hide manual actions on payroll-linked expenses

**Files:**
- Modify: `src/features/expenses/ExpensesFeature.tsx:591-633` (list row actions)
- Modify: `src/features/expenses/ExpensesFeature.tsx:1017-1028` (details modal "Record Payment" button)

**Interfaces:**
- Consumes: `Expense.payroll_run_id` (Task 1).

- [ ] **Step 1: Guard the list row actions**

The row actions cell currently reads (lines 591-633):

```tsx
                  <td>
                    <div className="billing-row-actions">
                      <button onClick={() => setViewingExpense(expense)} title="View details" type="button">
                        <Eye size={14} />
                      </button>
                      {canRecordPayment && (
                        <button onClick={() => setPayingInstallmentExpense(expense)} title="Record payment" type="button">
                          <CheckCircle2 size={14} />
                        </button>
                      )}
                      {canRecordPayment && isOpenEndedRecurring && (
                        <button onClick={() => void handleEndRecurringExpense(expense)} title="End expense" type="button">
                          <Square size={14} />
                        </button>
                      )}
                      <button
                        disabled={hasPayments}
                        onClick={() => { setEditingExpense(expense); setFormOpen(true); }}
                        title={hasPayments ? "Locked — payments already recorded against this expense." : "Edit"}
                        type="button"
                      >
                        <Pencil size={14} />
                      </button>
                      {canRecordPayment && (
                        <button
                          disabled={hasPayments}
                          onClick={() => void handleCancelExpense(expense)}
                          title={hasPayments ? "Can't cancel — payments already recorded against this expense." : "Cancel expense"}
                          type="button"
                        >
                          <Ban size={14} />
                        </button>
                      )}
                      <button
                        disabled={hasPayments}
                        onClick={() => setDeletingExpense(expense)}
                        title={hasPayments ? "Can't delete — payments already recorded against this expense." : "Delete"}
                        type="button"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
```

Change to (adding `!isPayrollLinked &&` to every action except "View details"):

```tsx
                  <td>
                    <div className="billing-row-actions">
                      <button onClick={() => setViewingExpense(expense)} title="View details" type="button">
                        <Eye size={14} />
                      </button>
                      {!isPayrollLinked && canRecordPayment && (
                        <button onClick={() => setPayingInstallmentExpense(expense)} title="Record payment" type="button">
                          <CheckCircle2 size={14} />
                        </button>
                      )}
                      {!isPayrollLinked && canRecordPayment && isOpenEndedRecurring && (
                        <button onClick={() => void handleEndRecurringExpense(expense)} title="End expense" type="button">
                          <Square size={14} />
                        </button>
                      )}
                      {!isPayrollLinked && (
                        <button
                          disabled={hasPayments}
                          onClick={() => { setEditingExpense(expense); setFormOpen(true); }}
                          title={hasPayments ? "Locked — payments already recorded against this expense." : "Edit"}
                          type="button"
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                      {!isPayrollLinked && canRecordPayment && (
                        <button
                          disabled={hasPayments}
                          onClick={() => void handleCancelExpense(expense)}
                          title={hasPayments ? "Can't cancel — payments already recorded against this expense." : "Cancel expense"}
                          type="button"
                        >
                          <Ban size={14} />
                        </button>
                      )}
                      {!isPayrollLinked && (
                        <button
                          disabled={hasPayments}
                          onClick={() => setDeletingExpense(expense)}
                          title={hasPayments ? "Can't delete — payments already recorded against this expense." : "Delete"}
                          type="button"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
```

Now declare `isPayrollLinked`. Find where `canRecordPayment` is declared in this same row-rendering scope (line 553: `const canRecordPayment = displayStatus !== "paid" && displayStatus !== "cancelled";`) and add right after it:

```tsx
                const canRecordPayment = displayStatus !== "paid" && displayStatus !== "cancelled";
                const isPayrollLinked = expense.payroll_run_id !== null;
```

- [ ] **Step 2: Guard the details modal's "Record Payment" button**

Currently reads (lines 1017-1028):

```tsx
          <section className="expense-ledger">
            <div className="expense-section-heading">
              <div>
                <p>Audit trail</p>
                <h2>Payment history</h2>
              </div>
              {canRecordPayment && (
                <button className="billing-btn primary" onClick={onRecordPayment} type="button">
                  <CheckCircle2 size={15} /> Record Payment
                </button>
              )}
            </div>
```

Change to:

```tsx
          <section className="expense-ledger">
            <div className="expense-section-heading">
              <div>
                <p>Audit trail</p>
                <h2>Payment history</h2>
              </div>
              {canRecordPayment && expense.payroll_run_id === null && (
                <button className="billing-btn primary" onClick={onRecordPayment} type="button">
                  <CheckCircle2 size={15} /> Record Payment
                </button>
              )}
            </div>
```

- [ ] **Step 3: Verify the build compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual smoke check**

Open Company Expenses, find the "Payroll" row created in Task 5's smoke check. Confirm only the "View details" (eye) icon is clickable — Record payment/End/Edit/Cancel/Delete are gone. Open its details modal and confirm "Record Payment" doesn't appear there either.

- [ ] **Step 5: Commit**

```bash
git add src/features/expenses/ExpensesFeature.tsx
git commit -m "feat: lock manual actions on payroll-linked expenses"
```

---

### Task 10: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full type-check**

Run: `npm run build`
Expected: builds clean (runs `tsc --noEmit && vite build`).

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all tests pass, including the 6 new `payrollExpensePayload` tests from Task 2.

- [ ] **Step 3: End-to-end manual pass**

With the dev server running and logged in:
1. Generate a new payroll run → confirm a Pending "Payroll" row appears in Company Expenses with the right amount and period label.
2. Edit one item's ticket counts → confirm the linked expense's amount updates to match the new total.
3. Mark items paid one at a time → confirm the expense stays Pending until the last one, then flips to Paid.
4. Generate a second run and use "Pay all" → confirm it goes straight to Paid.
5. Confirm none of these rows are editable/deletable/payable from the Expenses tab.

- [ ] **Step 4: Commit (if any fixups were needed)**

```bash
git add -A
git commit -m "chore: fixups from final verification pass"
```
