# Subcontractor Payout Record Payment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-shot "Mark paid" action on subcontractor payouts with a Record Payment flow that captures payment date/method/reference/notes and supports paying a payout off across multiple partial installments — mirroring the existing Expenses "Record Payment" pattern.

**Architecture:** A new `payment_reminder_payments` child table (generic to any `payment_reminders` row) stores individual installments against a payout. `payment_reminders.status` stays `pending`/`paid` at the DB level; a new pure domain module derives a UI-only `"partial"` display status from the payout's amount vs. its recorded payments, exactly the way `domain/expenses.ts` already does for expenses. The Payouts tab in `SubcontractorsFeature.tsx` gains a payment-history details modal and a record-payment form, both modeled directly on `ExpenseDetailsModal` / `InstallmentPaymentForm`.

**Tech Stack:** React + TypeScript + Vite, Supabase (Postgres + RLS), Vitest (domain tests only, Node environment).

## Global Constraints

- Only `src/domain/**/*.test.ts` files run in the test suite (per `vitest.config.ts`) — there is no UI test runner in this repo, so UI changes are verified via `npm run build` (type-check) and manual smoke-testing in the browser, not automated tests.
- Currency values format via `Intl.NumberFormat("en-PH")` (`src/shared/utils/currency.ts`'s `currency` export) — reuse it, don't reformat manually.
- `payment_reminders.status` must remain one of `pending` / `paid` / `overdue` at the DB level — never write `"partial"` to that column. `"partial"` only exists as a derived, in-memory display value.
- Every new Supabase table needs RLS enabled with the `auth.uid() = user_id` policy, matching every existing table in `supabase_schema.sql`.
- Follow existing repository conventions: repository functions take a `SupabaseClient` as their first argument and live in `src/features/billing/billingRepository.ts` (where the subcontractor-payment-reminder functions already live).

---

### Task 1: Database migration — `payment_reminder_payments` table

**Files:**
- Modify: `supabase_schema.sql` (append at end of file, after line 1954)

**Interfaces:**
- Produces: table `public.payment_reminder_payments` with columns `id, user_id, payment_reminder_id, amount, payment_date, payment_method, reference_number, notes, created_at` — consumed by Task 5's repository functions and Task 6's select strings.

- [ ] **Step 1: Append the new table, index, and RLS policy**

Add this block to the end of `supabase_schema.sql`:

```sql

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
```

- [ ] **Step 2: Note the manual apply step**

This repo has no Supabase CLI/migrations folder — `supabase_schema.sql` is run manually against the project's Supabase instance (per `CLAUDE.md`). This step can't be automated from here; flag to the user at the end of the plan that this SQL block needs to be run in the Supabase SQL editor before the new feature will work end-to-end.

- [ ] **Step 3: Commit**

```bash
git add supabase_schema.sql
git commit -m "feat: add payment_reminder_payments table for partial payout payments"
```

---

### Task 2: Types — `PaymentReminderPayment` and `PaymentReminder.payments`

**Files:**
- Modify: `src/types.ts:89-105` (the `PaymentReminder` type)

**Interfaces:**
- Produces: `export type PaymentReminderPayment = { id: string; user_id: string; payment_reminder_id: string; amount: number; payment_date: string; payment_method: CollectionPaymentMethod; reference_number: string; notes: string; created_at: string; }`
- Produces: `PaymentReminder.payments: PaymentReminderPayment[]` (required field, consumed by Tasks 3, 4, 5, 6, 8)

- [ ] **Step 1: Add the new type and extend `PaymentReminder`**

Replace the existing `PaymentReminder` type (`src/types.ts:89-105`):

```ts
export type PaymentReminder = {
  id: string;
  user_id: string;
  title: string;
  type: PaymentType;
  amount: number;
  due_date: string;
  status: PaymentStatus;
  notes: string;
  subcontractor_id: string | null;
  billing_subcon_item_id: string | null;
  billing_month: number | null;
  billing_year: number | null;
  billing_period: BillingPeriod | null;
  created_at: string;
  updated_at: string;
  payments: PaymentReminderPayment[];
};

export type PaymentReminderPayment = {
  id: string;
  user_id: string;
  payment_reminder_id: string;
  amount: number;
  payment_date: string;
  payment_method: CollectionPaymentMethod;
  reference_number: string;
  notes: string;
  created_at: string;
};
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: New errors will appear at every place a `PaymentReminder` object literal is built or fetched (test fixtures, `billing.ts`, `supabaseData.ts`, `SubcontractorsFeature.tsx`) — that's expected; those are fixed in later tasks. Confirm the *only* new errors are "Property 'payments' is missing" style errors, not typos.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add PaymentReminderPayment type and PaymentReminder.payments field"
```

---

### Task 3: Domain logic — `src/domain/paymentReminders.ts`

**Files:**
- Create: `src/domain/paymentReminders.ts`
- Create: `src/domain/paymentReminders.test.ts`

**Interfaces:**
- Consumes: `PaymentReminder`, `PaymentReminderPayment` from `../types`; `paymentMethodLabel` re-exported from `./expenses`.
- Produces (consumed by Task 4, 5, 8):
  - `paymentReminderPaymentsTotal(payments: PaymentReminderPayment[] | null | undefined): number`
  - `paymentReminderRemainingBalance(reminder: Pick<PaymentReminder, "amount">, payments: PaymentReminderPayment[] | null | undefined): number`
  - `paymentReminderDisplayStatus(reminder: Pick<PaymentReminder, "amount" | "status">, payments: PaymentReminderPayment[] | null | undefined): "pending" | "partial" | "paid" | "overdue"`
  - `nextPaymentReminderCompletionState(reminder: Pick<PaymentReminder, "amount">, payments: PaymentReminderPayment[] | null | undefined): { status: "pending" | "paid" }`
  - `validatePaymentReminderPayment(args: { amount: number; remainingBalance: number; paymentDate: string; today?: string }): string | null`
  - `paymentMethodLabel` (re-export)

- [ ] **Step 1: Write the failing tests**

Create `src/domain/paymentReminders.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { PaymentReminder, PaymentReminderPayment } from "../types";
import {
  nextPaymentReminderCompletionState,
  paymentReminderDisplayStatus,
  paymentReminderPaymentsTotal,
  paymentReminderRemainingBalance,
  validatePaymentReminderPayment,
} from "./paymentReminders";

const baseReminder: Pick<PaymentReminder, "amount" | "status"> = {
  amount: 1000,
  status: "pending",
};

function payment(overrides: Partial<PaymentReminderPayment>): PaymentReminderPayment {
  return {
    id: "p1",
    user_id: "u1",
    payment_reminder_id: "r1",
    amount: 100,
    payment_date: "2026-07-01",
    payment_method: "cash",
    reference_number: "",
    notes: "",
    created_at: "",
    ...overrides,
  };
}

describe("paymentReminderPaymentsTotal", () => {
  it("sums payment amounts, treating null/undefined as empty", () => {
    expect(paymentReminderPaymentsTotal(null)).toBe(0);
    expect(paymentReminderPaymentsTotal([payment({ amount: 300 }), payment({ id: "p2", amount: 200 })])).toBe(500);
  });
});

describe("paymentReminderRemainingBalance", () => {
  it("subtracts payments total from the reminder amount, floored at zero", () => {
    expect(paymentReminderRemainingBalance(baseReminder, [])).toBe(1000);
    expect(paymentReminderRemainingBalance(baseReminder, [payment({ amount: 400 })])).toBe(600);
    expect(paymentReminderRemainingBalance(baseReminder, [payment({ amount: 1500 })])).toBe(0);
  });
});

describe("paymentReminderDisplayStatus", () => {
  it("is pending with no payments", () => {
    expect(paymentReminderDisplayStatus(baseReminder, [])).toBe("pending");
  });

  it("is partial once some but not all of the amount is paid", () => {
    expect(paymentReminderDisplayStatus(baseReminder, [payment({ amount: 400 })])).toBe("partial");
  });

  it("is paid once payments cover the full amount", () => {
    expect(paymentReminderDisplayStatus(baseReminder, [payment({ amount: 1000 })])).toBe("paid");
  });

  it("is paid when the reminder's own status is already paid, regardless of payments", () => {
    expect(paymentReminderDisplayStatus({ amount: 1000, status: "paid" }, [])).toBe("paid");
  });
});

describe("nextPaymentReminderCompletionState", () => {
  it("stays pending until payments cover the full amount", () => {
    expect(nextPaymentReminderCompletionState(baseReminder, [payment({ amount: 400 })])).toEqual({ status: "pending" });
  });

  it("flips to paid once payments cover the full amount", () => {
    expect(nextPaymentReminderCompletionState(baseReminder, [payment({ amount: 1000 })])).toEqual({ status: "paid" });
  });
});

describe("validatePaymentReminderPayment", () => {
  it("rejects a non-positive amount", () => {
    expect(validatePaymentReminderPayment({ amount: 0, remainingBalance: 500, paymentDate: "2026-07-01", today: "2026-07-06" }))
      .toBe("Payment amount must be greater than zero.");
  });

  it("rejects an amount exceeding the remaining balance", () => {
    expect(validatePaymentReminderPayment({ amount: 600, remainingBalance: 500, paymentDate: "2026-07-01", today: "2026-07-06" }))
      .toBe("Payment exceeds the remaining balance.");
  });

  it("rejects a future payment date", () => {
    expect(validatePaymentReminderPayment({ amount: 100, remainingBalance: 500, paymentDate: "2026-07-10", today: "2026-07-06" }))
      .toBe("Payment date cannot be in the future.");
  });

  it("accepts a valid payment", () => {
    expect(validatePaymentReminderPayment({ amount: 100, remainingBalance: 500, paymentDate: "2026-07-06", today: "2026-07-06" }))
      .toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/domain/paymentReminders.test.ts`
Expected: FAIL — `Cannot find module './paymentReminders'` (the module doesn't exist yet).

- [ ] **Step 3: Implement `src/domain/paymentReminders.ts`**

```ts
import type { PaymentReminder, PaymentReminderPayment } from "../types";

export { paymentMethodLabel } from "./expenses";

export type PaymentReminderDisplayStatus = "pending" | "partial" | "paid" | "overdue";

export const paymentReminderPaymentsTotal = (payments: PaymentReminderPayment[] | null | undefined) =>
  (payments ?? []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

export function paymentReminderRemainingBalance(
  reminder: Pick<PaymentReminder, "amount">,
  payments: PaymentReminderPayment[] | null | undefined,
): number {
  return Math.max(0, Number(reminder.amount) - paymentReminderPaymentsTotal(payments));
}

export function paymentReminderDisplayStatus(
  reminder: Pick<PaymentReminder, "amount" | "status">,
  payments: PaymentReminderPayment[] | null | undefined,
): PaymentReminderDisplayStatus {
  if (reminder.status === "paid") return "paid";
  if (reminder.status === "overdue") return "overdue";
  const paid = paymentReminderPaymentsTotal(payments);
  if (Number(reminder.amount) > 0 && paid >= Number(reminder.amount)) return "paid";
  return paid > 0 ? "partial" : "pending";
}

export function nextPaymentReminderCompletionState(
  reminder: Pick<PaymentReminder, "amount">,
  payments: PaymentReminderPayment[] | null | undefined,
): { status: "pending" | "paid" } {
  const paid = paymentReminderPaymentsTotal(payments);
  return { status: Number(reminder.amount) > 0 && paid >= Number(reminder.amount) ? "paid" : "pending" };
}

export function validatePaymentReminderPayment({
  amount,
  remainingBalance,
  paymentDate,
  today = new Date().toISOString().slice(0, 10),
}: {
  amount: number;
  remainingBalance: number;
  paymentDate: string;
  today?: string;
}): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return "Payment amount must be greater than zero.";
  if (amount > remainingBalance) return "Payment exceeds the remaining balance.";
  if (!paymentDate || paymentDate > today) return "Payment date cannot be in the future.";
  return null;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/domain/paymentReminders.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/paymentReminders.ts src/domain/paymentReminders.test.ts
git commit -m "feat: add paymentReminders domain module for partial payout payments"
```

---

### Task 4: `buildSubcontractorAccountSummary` partial-payment awareness

**Files:**
- Modify: `src/domain/billing.ts:288-369` (the `buildSubcontractorAccountSummary` function)
- Modify: `src/domain/billing.test.ts:1-11` (imports), `:199-217` (existing-payments fixture), `:441-518` (the `buildSubcontractorAccountSummary` describe block)

**Interfaces:**
- Consumes: `paymentReminderDisplayStatus`, `paymentReminderPaymentsTotal`, `paymentReminderRemainingBalance` from `./paymentReminders` (Task 3).
- Produces: `buildSubcontractorAccountSummary(...)` return shape unchanged (`{ billingRows, lastPayoutStatus, netPending, paidThisMonth, ticketsThisPeriod }`), but `netPending`/`paidThisMonth`/`lastPayoutStatus` now partial-payment-aware. Consumed by Task 8.

- [ ] **Step 1: Update existing fixtures so they still satisfy the `PaymentReminder` type**

In `src/domain/billing.test.ts`, add `payments: []` to the fixture at `:199-217` (the single-item `existingPayments` array used by the `buildSubcontractorPaymentPayloads` test) — insert `payments: [],` right after the `updated_at: "",` line in that object (line 215).

- [ ] **Step 2: Write the new failing test for partial payments**

In `src/domain/billing.test.ts`, add the import of `PaymentReminderPayment` to the existing type-only import at the top of the file (line 11):

```ts
import type { BillingSubconItem, DailyTicketEntry, PaymentReminder, PaymentReminderPayment, SubconDailyTicket, Subcontractor, SubcontractorAdvance } from "../types";
```

Update the `payments` fixture inside the `buildSubcontractorAccountSummary` describe block (`:441-476`) so `p1` and `p2` each carry a `payments` array consistent with their existing `status`/`updated_at` (preserving the current test's expected totals: `p1` has no payments recorded yet, `p2`'s 1200 was paid in full on 2026-06-29):

```ts
    const payments: PaymentReminder[] = [
      {
        id: "p1",
        user_id: "u1",
        title: "Alpha",
        type: "subcontractor",
        amount: 3500,
        due_date: "2026-06-15",
        status: "pending",
        notes: "June 2026 · 1st - 15th",
        subcontractor_id: "sub-1",
        billing_subcon_item_id: "item-1",
        billing_month: 6,
        billing_year: 2026,
        billing_period: "first_half",
        created_at: "",
        updated_at: "",
        payments: [],
      },
      {
        id: "p2",
        user_id: "u1",
        title: "Alpha",
        type: "subcontractor",
        amount: 1200,
        due_date: "2026-06-30",
        status: "paid",
        notes: "June 2026 · 16th - End",
        subcontractor_id: "sub-1",
        billing_subcon_item_id: "item-2",
        billing_month: 6,
        billing_year: 2026,
        billing_period: "second_half",
        created_at: "",
        updated_at: "2026-06-29T00:00:00Z",
        payments: [
          {
            id: "p2-pay-1",
            user_id: "u1",
            payment_reminder_id: "p2",
            amount: 1200,
            payment_date: "2026-06-29",
            payment_method: "cash",
            reference_number: "",
            notes: "",
            created_at: "2026-06-29T00:00:00Z",
          },
        ],
      },
    ];
```

Add a new test immediately after the existing `it("computes pending, paid, and ticket totals...")` test (after line 518, still inside the `describe("buildSubcontractorAccountSummary", ...)` block), reusing the same `subcontractor` and `dailyTickets` fixtures already in scope:

```ts
  it("counts a partial payment toward paidThisMonth and reduces netPending by only the amount paid", () => {
    const partiallyPaid: PaymentReminder = {
      id: "p3",
      user_id: "u1",
      title: "Alpha",
      type: "subcontractor",
      amount: 2000,
      due_date: "2026-06-30",
      status: "pending",
      notes: "June 2026 · 16th - End",
      subcontractor_id: "sub-1",
      billing_subcon_item_id: "item-3",
      billing_month: 6,
      billing_year: 2026,
      billing_period: "second_half",
      created_at: "",
      updated_at: "",
      payments: [
        {
          id: "p3-pay-1",
          user_id: "u1",
          payment_reminder_id: "p3",
          amount: 800,
          payment_date: "2026-06-20",
          payment_method: "cash",
          reference_number: "",
          notes: "",
          created_at: "2026-06-20T00:00:00Z",
        },
      ],
    };

    const summary = buildSubcontractorAccountSummary({
      subcontractor,
      billingRecords: [],
      dailyTickets: [],
      payments: [partiallyPaid],
      today: new Date("2026-06-25T00:00:00"),
    });

    expect(summary.netPending).toBe(1200);
    expect(summary.paidThisMonth).toBe(800);
    expect(summary.lastPayoutStatus).toBe("partial");
  });
```

- [ ] **Step 3: Run the tests and confirm the new one fails**

Run: `npx vitest run src/domain/billing.test.ts`
Expected: FAIL on the new test (and likely a type error first, since `billing.ts` hasn't been updated yet and the `payments` field doesn't exist on `PaymentReminder` usage inside `buildSubcontractorAccountSummary`'s current implementation — that's fine, it's still reading `payment.status`/`payment.amount` which still exist).

- [ ] **Step 4: Update `buildSubcontractorAccountSummary`**

In `src/domain/billing.ts`, add the import (top of file, alongside the existing type-only import block at lines 1-9):

```ts
import { paymentReminderDisplayStatus, paymentReminderPaymentsTotal, paymentReminderRemainingBalance } from "./paymentReminders";
```

Replace the body from `pendingFromPayments` through the `return` statement (`src/domain/billing.ts:350-368`):

```ts
  const pendingFromPayments = payments
    .filter((payment) => paymentReminderDisplayStatus(payment, payment.payments) !== "paid")
    .reduce((sum, payment) => sum + paymentReminderRemainingBalance(payment, payment.payments), 0);
  const pendingFromUntrackedBilling = billingRows
    .filter((row) => !paymentByBillingItemId.has(row.id))
    .reduce((sum, row) => sum + row.payable_amount, 0);
  const pending = pendingFromPayments + pendingFromUntrackedBilling;
  const paidMonthKey = `${year}-${String(month).padStart(2, "0")}`;
  const paidThisMonth = payments
    .flatMap((payment) => payment.payments)
    .filter((paymentRecord) => paymentRecord.payment_date.startsWith(paidMonthKey))
    .reduce((sum, paymentRecord) => sum + paymentRecord.amount, 0);

  return {
    billingRows,
    lastPayoutStatus: latestPayment ? paymentReminderDisplayStatus(latestPayment, latestPayment.payments) : "none",
    netPending: pending,
    paidThisMonth,
    ticketsThisPeriod: typeof ticketsThisPeriod === "number" ? ticketsThisPeriod : ticketsThisPeriod.install + ticketsThisPeriod.repair,
  };
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run src/domain/billing.test.ts`
Expected: PASS (all existing tests plus the new partial-payment test).

- [ ] **Step 6: Commit**

```bash
git add src/domain/billing.ts src/domain/billing.test.ts
git commit -m "feat: make buildSubcontractorAccountSummary partial-payment aware"
```

---

### Task 5: Repository — record/delete/complete payout payments

**Files:**
- Modify: `src/features/billing/billingRepository.ts:172-177` (remove `markSubconPaymentReminderPaid`, add new functions)

**Interfaces:**
- Consumes: `PaymentReminderPayment` from `../../types`.
- Produces (consumed by Task 8):
  - `recordPaymentReminderPayment(supabase, userId: string, paymentReminderId: string, payload: { amount: number; payment_date: string; payment_method: CollectionPaymentMethod; reference_number: string; notes: string }): Promise<{ data: PaymentReminderPayment | null; error: unknown }>`
  - `deletePaymentReminderPayment(supabase, paymentId: string)`
  - `updatePaymentReminderCompletion(supabase, paymentReminderId: string, status: "pending" | "paid")`

- [ ] **Step 1: Replace `markSubconPaymentReminderPaid` with the new functions**

In `src/features/billing/billingRepository.ts`, add `PaymentReminderPayment` to the type-only import at the top (line 2-7):

```ts
import type {
  BillingRecord,
  BillingSettings,
  PaymentReminder,
  PaymentReminderPayment,
  Subcontractor,
} from "../../types";
```

Add a new select constant near the other `_SELECT` constants (after line 12):

```ts
const PAYMENT_REMINDER_PAYMENT_SELECT = "id,user_id,payment_reminder_id,amount,payment_date,payment_method,reference_number,notes,created_at";
```

Replace `markSubconPaymentReminderPaid` (`src/features/billing/billingRepository.ts:172-177`) with:

```ts
export async function recordPaymentReminderPayment(
  supabase: SupabaseClient,
  userId: string,
  paymentReminderId: string,
  payload: {
    amount: number;
    payment_date: string;
    payment_method: import("../../types").CollectionPaymentMethod;
    reference_number: string;
    notes: string;
  },
) {
  const result = await supabase
    .from("payment_reminder_payments")
    .insert({ ...payload, user_id: userId, payment_reminder_id: paymentReminderId })
    .select(PAYMENT_REMINDER_PAYMENT_SELECT)
    .single();
  return { data: result.data as PaymentReminderPayment | null, error: result.error };
}

export async function deletePaymentReminderPayment(supabase: SupabaseClient, paymentId: string) {
  return supabase.from("payment_reminder_payments").delete().eq("id", paymentId);
}

export async function updatePaymentReminderCompletion(
  supabase: SupabaseClient,
  paymentReminderId: string,
  status: "pending" | "paid",
) {
  return supabase.from("payment_reminders").update({ status }).eq("id", paymentReminderId);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: A new error where `markSubconPaymentReminderPaid` was imported (in `src/features/subcontractors/SubcontractorsFeature.tsx`) — expected, that's fixed in Task 8.

- [ ] **Step 3: Commit**

```bash
git add src/features/billing/billingRepository.ts
git commit -m "feat: add repository functions for recording payout payments"
```

---

### Task 6: Fetch nested payments in `loadPayments`

**Files:**
- Modify: `src/lib/supabaseData.ts:154-162,254-259`

**Interfaces:**
- Produces: `PaymentReminder` rows returned by both the dashboard "Open payment reminders" query and `loadPayments` now include a `payments` array populated from `payment_reminder_payments`.

- [ ] **Step 1: Add the nested select to both `payment_reminders` queries**

In `src/lib/supabaseData.ts`, replace the select string used at line 158 (dashboard "Open payment reminders" query):

```ts
        .select("id,user_id,title,type,amount,due_date,status,notes,subcontractor_id,billing_subcon_item_id,billing_month,billing_year,billing_period,created_at,updated_at,payments:payment_reminder_payments(id,user_id,payment_reminder_id,amount,payment_date,payment_method,reference_number,notes,created_at)")
```

Replace the select string used at line 257 (`loadPayments`, the one actually consumed by the Subcontractors/Billing views):

```ts
      .select("id,user_id,title,type,amount,due_date,status,notes,subcontractor_id,billing_subcon_item_id,billing_month,billing_year,billing_period,created_at,updated_at,payments:payment_reminder_payments(id,user_id,payment_reminder_id,amount,payment_date,payment_method,reference_number,notes,created_at)")
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No new errors from this file (the `settle<PaymentReminder>` casts already assume the full type; the extra nested column now actually matches it).

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabaseData.ts
git commit -m "feat: fetch nested payment_reminder_payments in payment reminder queries"
```

---

### Task 7: Offline support for payout payments

**Files:**
- Modify: `src/lib/offlineDb.ts:4` (the `PendingMutationOperation` union)
- Modify: `src/lib/offlineSync.ts:119-129` (add a new `case` after `expense_payment_group`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `PendingMutationOperation` includes `"payment_reminder_payment_group"`, and `applyMutation` handles it. Consumed by Task 8's offline branch.

- [ ] **Step 1: Add the new operation to the union type**

In `src/lib/offlineDb.ts:4`, replace:

```ts
export type PendingMutationOperation = "insert" | "update" | "delete" | "upsert" | "payroll_group" | "payroll_items_group" | "billing_group" | "collection_payment" | "collection_payment_void" | "expense_payment_group";
```

with:

```ts
export type PendingMutationOperation = "insert" | "update" | "delete" | "upsert" | "payroll_group" | "payroll_items_group" | "billing_group" | "collection_payment" | "collection_payment_void" | "expense_payment_group" | "payment_reminder_payment_group";
```

- [ ] **Step 2: Handle the new operation in `applyMutation`**

In `src/lib/offlineSync.ts`, add a new case immediately after the `expense_payment_group` case (after line 129, before `case "collection_payment":`):

```ts
    case "payment_reminder_payment_group": {
      const payload = mutation.payload as {
        paymentPayload: Record<string, unknown>;
        reminderUpdate: { id: string; payload: Record<string, unknown> } | null;
      };
      const paymentResult = await supabase.from("payment_reminder_payments").insert(payload.paymentPayload);
      if (paymentResult.error) return paymentResult;
      if (payload.reminderUpdate) {
        const reminderResult = await supabase.from("payment_reminders").update(payload.reminderUpdate.payload).eq("id", payload.reminderUpdate.id);
        if (reminderResult.error) return reminderResult;
      }
      return { error: null };
    }
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: No new errors (this is additive to a switch/union).

- [ ] **Step 4: Commit**

```bash
git add src/lib/offlineDb.ts src/lib/offlineSync.ts
git commit -m "feat: add offline sync support for payout payment recording"
```

---

### Task 8: UI — Payouts tab Record Payment flow

**Files:**
- Modify: `src/features/subcontractors/SubcontractorsFeature.tsx` (imports, remove old mark-paid logic, add new handlers and components)

**Interfaces:**
- Consumes: everything produced by Tasks 3, 5, 7 (`paymentReminderDisplayStatus`, `paymentReminderPaymentsTotal`, `paymentReminderRemainingBalance`, `nextPaymentReminderCompletionState`, `validatePaymentReminderPayment`, `paymentMethodLabel` from `../../domain/paymentReminders`; `recordPaymentReminderPayment`, `deletePaymentReminderPayment`, `updatePaymentReminderCompletion` from `../billing/billingRepository`; `"payment_reminder_payment_group"` operation).
- Produces: no new props on `SubcontractorsFeature` (self-contained within the existing component tree); removes the `onMarkLatestPendingPaid` / `onMarkPaymentPaid` props from `SubcontractorDetailsView`.

- [ ] **Step 1: Update imports**

Replace the lucide-react import (`src/features/subcontractors/SubcontractorsFeature.tsx:2`):

```ts
import { AlertTriangle, ArrowLeft, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, Eye, Pencil, Plus, ReceiptText, Ticket, Trash2, Users, WalletCards, X } from "lucide-react";
```

Replace the domain import (line 3-7):

```ts
import {
  billingPeriodLabel,
  buildSubcontractorAccountSummary,
  filterSubcontractorDailyTickets,
} from "../../domain/billing";
import {
  nextPaymentReminderCompletionState,
  paymentMethodLabel,
  paymentReminderDisplayStatus,
  paymentReminderPaymentsTotal,
  paymentReminderRemainingBalance,
  validatePaymentReminderPayment,
} from "../../domain/paymentReminders";
```

Replace the billingRepository import (line 8):

```ts
import { deletePaymentReminderPayment, recordPaymentReminderPayment, saveSubcontractor, updatePaymentReminderCompletion } from "../billing/billingRepository";
```

Replace the currency import (line 16):

```ts
import { currency, toNumber } from "../../shared/utils/currency";
```

Replace the types import (line 18):

```ts
import type { BillingPeriod, BillingRecord, CollectionPaymentMethod, PaymentReminder, PaymentReminderPayment, SubconDailyTicket, Subcontractor, SubcontractorAdvance, SubcontractorAdvanceFormValues } from "../../types";
```

Add a shared form-values type near the top of the file, immediately after the `type AccountTab = ...` line (`src/features/subcontractors/SubcontractorsFeature.tsx:20`):

```ts
type PayoutPaymentFormValues = {
  amount: string;
  payment_date: string;
  payment_method: CollectionPaymentMethod;
  reference_number: string;
  notes: string;
};
```

- [ ] **Step 2: Remove the old mark-paid handlers from `SubcontractorsFeature`**

Delete `markPaymentPaid` and `markLatestPendingPaid` entirely (`src/features/subcontractors/SubcontractorsFeature.tsx:144-171`).

- [ ] **Step 3: Stop passing the removed props to `SubcontractorDetailsView`**

In the `<SubcontractorDetailsView ... />` call inside `SubcontractorsFeature` (around line 176-193), remove these two lines:

```ts
          onMarkLatestPendingPaid={markLatestPendingPaid}
          onMarkPaymentPaid={markPaymentPaid}
```

- [ ] **Step 4: Remove the two props from `SubcontractorDetailsView`'s signature**

In the `SubcontractorDetailsView` function's destructured props and type annotation (`src/features/subcontractors/SubcontractorsFeature.tsx:328-362`), delete:

```ts
  onMarkLatestPendingPaid,
  onMarkPaymentPaid,
```

and their corresponding type entries:

```ts
  onMarkLatestPendingPaid: () => Promise<void>;
  onMarkPaymentPaid: (payment: PaymentReminder) => Promise<void>;
```

- [ ] **Step 5: Add local modal state and the new handlers inside `SubcontractorDetailsView`**

Immediately after the existing state declarations in `SubcontractorDetailsView` (after `const [advanceBusy, setAdvanceBusy] = useState(false);`, around line 372), add:

```ts
  const [payingPayout, setPayingPayout] = useState<PaymentReminder | null>(null);
  const [viewingPayout, setViewingPayout] = useState<PaymentReminder | null>(null);
```

Immediately after the `saveAdvance` function (after its closing brace, around line 487), add:

```ts
  function openLatestPayoutPaymentForm() {
    const latestOutstanding = payments
      .filter((payment) => payment.type === "subcontractor" && payment.subcontractor_id === selected.id)
      .filter((payment) => paymentReminderDisplayStatus(payment, payment.payments) !== "paid")
      .sort((a, b) =>
        `${b.billing_year ?? 0}-${String(b.billing_month ?? 0).padStart(2, "0")}-${b.billing_period ?? ""}`.localeCompare(
          `${a.billing_year ?? 0}-${String(a.billing_month ?? 0).padStart(2, "0")}-${a.billing_period ?? ""}`,
        ),
      )[0];
    if (!latestOutstanding) return;
    setPayingPayout(latestOutstanding);
  }

  async function handleRecordPayoutPayment(payment: PaymentReminder, values: PayoutPaymentFormValues) {
    if (!supabase) return;
    const amount = toNumber(values.amount);
    const remainingBalance = paymentReminderRemainingBalance(payment, payment.payments);
    const validationError = validatePaymentReminderPayment({
      amount,
      remainingBalance,
      paymentDate: values.payment_date,
      today: todayKey(),
    });
    if (validationError) {
      NotificationService.showError(validationError);
      return;
    }

    const paymentId = crypto.randomUUID();
    const paymentPayload = {
      amount,
      payment_date: values.payment_date,
      payment_method: values.payment_method,
      reference_number: values.reference_number.trim(),
      notes: values.notes.trim(),
    };
    const newPaymentRecord: PaymentReminderPayment = {
      id: paymentId, user_id: userId, payment_reminder_id: payment.id, ...paymentPayload, created_at: new Date().toISOString(),
    };
    const next = nextPaymentReminderCompletionState(payment, [...payment.payments, newPaymentRecord]);
    const complete = next.status === "paid";

    if (!navigator.onLine) {
      await onQueueOfflineMutation({
        resource: "payments",
        affectedResources: ["payments"],
        operation: "payment_reminder_payment_group",
        table: "payment_reminder_payments",
        recordId: paymentId,
        payload: {
          paymentPayload: { ...paymentPayload, id: paymentId, user_id: userId, payment_reminder_id: payment.id },
          reminderUpdate: complete ? { id: payment.id, payload: { status: "paid" } } : null,
        },
      });
      setPayingPayout(null);
      NotificationService.showSuccess("Payment recorded locally. It will sync when online.");
      return;
    }

    const paymentResult = await recordPaymentReminderPayment(supabase, userId, payment.id, paymentPayload);
    if (paymentResult.error) {
      NotificationService.showError((paymentResult.error as { message?: string }).message ?? "Failed to record the payment.");
      return;
    }
    if (complete) {
      const completionResult = await updatePaymentReminderCompletion(supabase, payment.id, "paid");
      if (completionResult.error) {
        NotificationService.showError((completionResult.error as { message?: string }).message ?? "Payment recorded, but failed to mark the payout complete.");
        await onChange();
        return;
      }
    }
    setPayingPayout(null);
    NotificationService.showSuccess(complete ? "Final payment recorded — payout marked paid." : "Payment recorded.");
    await onChange();
  }

  async function handleDeletePayoutPayment(payment: PaymentReminder, paymentRecord: PaymentReminderPayment) {
    if (!supabase) return;
    const confirmed = await NotificationService.showConfirm({
      message: "Delete this recorded payment?",
      danger: true,
    });
    if (!confirmed) return;
    const remainingPayments = payment.payments.filter((item) => item.id !== paymentRecord.id);
    const shouldRevert = payment.status === "paid" && nextPaymentReminderCompletionState(payment, remainingPayments).status !== "paid";

    if (!navigator.onLine) {
      await onQueueOfflineMutation({
        resource: "payments",
        affectedResources: ["payments"],
        operation: "delete",
        table: "payment_reminder_payments",
        recordId: paymentRecord.id,
      });
      if (shouldRevert) {
        await onQueueOfflineMutation({
          resource: "payments",
          affectedResources: ["payments"],
          operation: "update",
          table: "payment_reminders",
          recordId: payment.id,
          payload: { status: "pending" },
        });
      }
      NotificationService.showSuccess("Deleted locally. It will sync when online.");
      return;
    }

    const deleteResult = await deletePaymentReminderPayment(supabase, paymentRecord.id);
    if (deleteResult.error) {
      NotificationService.showError((deleteResult.error as { message?: string }).message ?? "Failed to delete that payment.");
      return;
    }
    if (shouldRevert) {
      const completionResult = await updatePaymentReminderCompletion(supabase, payment.id, "pending");
      if (completionResult.error) {
        NotificationService.showError((completionResult.error as { message?: string }).message ?? "Deleted, but failed to revert the payout status.");
        await onChange();
        return;
      }
    }
    NotificationService.showSuccess("Payment deleted.");
    await onChange();
  }
```

- [ ] **Step 6: Fix the local `displaySummary` recomputation to be partial-payment aware**

Replace the `displaySummary` `useMemo` block (`src/features/subcontractors/SubcontractorsFeature.tsx:509-537`):

```ts
  const displaySummary = useMemo(() => {
    if (periodFilter === "all") return summary;

    const billingRows = summary.billingRows.filter((row) => row.billing_period === periodFilter);
    const filteredPayments = subconPayments.filter((payment) => payment.billing_period === periodFilter);
    const filteredPaymentByItemId = new Map(
      filteredPayments
        .filter((p) => p.billing_subcon_item_id !== null)
        .map((payment) => [payment.billing_subcon_item_id!, payment]),
    );
    const pendingFromPayments = filteredPayments
      .filter((payment) => paymentReminderDisplayStatus(payment, payment.payments) !== "paid")
      .reduce((sum, payment) => sum + paymentReminderRemainingBalance(payment, payment.payments), 0);
    const pendingFromUntrackedBilling = billingRows
      .filter((row) => !filteredPaymentByItemId.has(row.id))
      .reduce((sum, row) => sum + row.payable_amount, 0);
    const paidThisMonth = filteredPayments
      .reduce((sum, payment) => sum + paymentReminderPaymentsTotal(payment.payments), 0);

    return {
      ...summary,
      billingRows,
      lastPayoutStatus: filteredPayments[0] ? paymentReminderDisplayStatus(filteredPayments[0], filteredPayments[0].payments) : "none",
      netPending: pendingFromPayments + pendingFromUntrackedBilling,
      paidThisMonth,
      ticketsThisPeriod: filteredTickets.length,
    };
  }, [filteredTickets.length, subconPayments, periodFilter, summary]);
```

- [ ] **Step 7: Update the header "Mark latest payout paid" button**

Replace (`src/features/subcontractors/SubcontractorsFeature.tsx:657-660`):

```tsx
            <button className="primary-button compact" disabled={displaySummary.netPending <= 0} onClick={() => void onMarkLatestPendingPaid()} type="button">
              <CheckCircle2 size={16} />
              Mark latest payout paid
            </button>
```

with:

```tsx
            <button className="primary-button compact" disabled={displaySummary.netPending <= 0} onClick={openLatestPayoutPaymentForm} type="button">
              <CheckCircle2 size={16} />
              Record payout payment
            </button>
```

- [ ] **Step 8: Show the derived display status in the Billing & Net tab**

Replace the payout-status cell in the "Billing & Net" tab's `rows` mapping (`src/features/subcontractors/SubcontractorsFeature.tsx:866-869`):

```tsx
                  payment
                    ? <StatusBadge key={`${row.id}-status`} status={payment.status} />
                    : <span className="subcon-missing-payment"><AlertTriangle size={14} /> Missing payout</span>,
```

with:

```tsx
                  payment
                    ? <StatusBadge key={`${row.id}-status`} status={paymentReminderDisplayStatus(payment, payment.payments)} />
                    : <span className="subcon-missing-payment"><AlertTriangle size={14} /> Missing payout</span>,
```

- [ ] **Step 9: Replace the Payouts tab table**

Replace the entire `{tab === "payouts" && (...)}` block (`src/features/subcontractors/SubcontractorsFeature.tsx:876-896`):

```tsx
        {tab === "payouts" && (
          <section className="emp-content-card">
            <DataTable
              empty="No payout records yet."
              headers={["Period", "Net amount", "Paid", "Remaining", "Due date", "Status", "Notes", "Action"]}
              rows={subconPayments.map((payment) => {
                const displayStatus = paymentReminderDisplayStatus(payment, payment.payments);
                const paidAmount = paymentReminderPaymentsTotal(payment.payments);
                const remainingBalance = paymentReminderRemainingBalance(payment, payment.payments);
                return [
                  payment.billing_month != null
                    ? `${monthNames[payment.billing_month - 1]} ${payment.billing_year} · ${billingPeriodLabel(payment.billing_period!)}`
                    : payment.notes || "—",
                  <strong className="subcon-net-value" key={`${payment.id}-net`}>{currency.format(payment.amount)}</strong>,
                  currency.format(paidAmount),
                  currency.format(remainingBalance),
                  payment.due_date,
                  <StatusBadge key={`${payment.id}-status`} status={displayStatus} />,
                  payment.notes || "—",
                  <div className="billing-row-actions" key={`${payment.id}-action`}>
                    <button onClick={() => setViewingPayout(payment)} title="View details" type="button"><Eye size={14} /></button>
                    {displayStatus !== "paid" && (
                      <button onClick={() => setPayingPayout(payment)} title="Record payment" type="button"><CheckCircle2 size={14} /></button>
                    )}
                  </div>,
                ];
              })}
            />
          </section>
        )}
```

- [ ] **Step 10: Render the two new modals**

Immediately before the closing `</div>` that ends `SubcontractorDetailsView`'s returned JSX (the one right after the `{tab === "advances" && (...)}` block closes, around line 971-972), add:

```tsx
      {payingPayout && (
        <PayoutPaymentForm
          onClose={() => setPayingPayout(null)}
          onSubmit={(values) => handleRecordPayoutPayment(payingPayout, values)}
          payment={payments.find((item) => item.id === payingPayout.id) ?? payingPayout}
        />
      )}
      {viewingPayout && (
        <PayoutDetailsModal
          onClose={() => setViewingPayout(null)}
          onDeletePayment={(paymentRecord) => handleDeletePayoutPayment(viewingPayout, paymentRecord)}
          onRecordPayment={() => setPayingPayout(viewingPayout)}
          payment={payments.find((item) => item.id === viewingPayout.id) ?? viewingPayout}
        />
      )}
```

- [ ] **Step 11: Add the `PayoutPaymentForm`, `PayoutDetailsModal`, and `SummaryCard` components**

Add these new functions at the end of `src/features/subcontractors/SubcontractorsFeature.tsx`, after the closing brace of `SubcontractorProfileModal`:

```tsx
function PayoutPaymentForm({
  onClose,
  onSubmit,
  payment,
}: {
  onClose: () => void;
  onSubmit: (values: PayoutPaymentFormValues) => Promise<void>;
  payment: PaymentReminder;
}) {
  const remainingBalance = paymentReminderRemainingBalance(payment, payment.payments);
  const [values, setValues] = useState<PayoutPaymentFormValues>({
    amount: String(remainingBalance),
    payment_date: todayKey(),
    payment_method: "cash" as CollectionPaymentMethod,
    reference_number: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal billing-form-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>Record Payment</h3>
            <span>
              {payment.billing_month != null
                ? `${monthNames[payment.billing_month - 1]} ${payment.billing_year} · ${billingPeriodLabel(payment.billing_period!)}`
                : payment.title}
            </span>
          </div>
          <button aria-label="Close" onClick={onClose} type="button"><X size={18} /></button>
        </div>
        <form
          className="billing-form-body"
          onSubmit={async (event) => { event.preventDefault(); setBusy(true); await onSubmit(values); setBusy(false); }}
        >
          <p className="expense-remaining-note">Remaining balance: {currency.format(remainingBalance)}</p>
          <div className="billing-form-fields">
            <MoneyField label="Amount" onChange={(amount) => setValues((current) => ({ ...current, amount }))} required value={values.amount} />
            <label>
              Payment date
              <input
                max={todayKey()}
                onChange={(event) => setValues((current) => ({ ...current, payment_date: event.target.value }))}
                required
                type="date"
                value={values.payment_date}
              />
            </label>
            <label>
              Payment method
              <select
                onChange={(event) => setValues((current) => ({ ...current, payment_method: event.target.value as CollectionPaymentMethod }))}
                value={values.payment_method}
              >
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="check">Check</option>
                <option value="e_wallet">E-wallet</option>
                <option value="card">Card</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Reference number
              <input
                onChange={(event) => setValues((current) => ({ ...current, reference_number: event.target.value }))}
                type="text"
                value={values.reference_number}
              />
            </label>
          </div>
          <label>
            Notes
            <textarea onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))} rows={3} value={values.notes} />
          </label>
          <div className="form-actions">
            <button className="billing-btn outline" onClick={onClose} type="button">Cancel</button>
            <button className="billing-btn primary" disabled={busy} type="submit">{busy ? "Saving..." : "Record payment"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PayoutDetailsModal({
  onClose,
  onDeletePayment,
  onRecordPayment,
  payment,
}: {
  onClose: () => void;
  onDeletePayment: (paymentRecord: PaymentReminderPayment) => Promise<void>;
  onRecordPayment: () => void;
  payment: PaymentReminder;
}) {
  const history = [...payment.payments].sort((a, b) => b.payment_date.localeCompare(a.payment_date) || b.created_at.localeCompare(a.created_at));
  const displayStatus = paymentReminderDisplayStatus(payment, payment.payments);
  const paidAmount = paymentReminderPaymentsTotal(payment.payments);
  const remainingBalance = paymentReminderRemainingBalance(payment, payment.payments);
  const canRecordPayment = displayStatus !== "paid";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal expense-details-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>{payment.title}</h3>
            <span>
              {payment.billing_month != null
                ? `${monthNames[payment.billing_month - 1]} ${payment.billing_year} · ${billingPeriodLabel(payment.billing_period!)}`
                : "One-off payout"}
            </span>
          </div>
          <button aria-label="Close" onClick={onClose} type="button"><X size={18} /></button>
        </div>
        <div className="expense-details-modal-body">
          <section className="expense-summary-grid">
            <SummaryCard label="Net amount" value={payment.amount} />
            <SummaryCard label="Paid so far" tone="success" value={paidAmount} />
            <SummaryCard label="Remaining" value={remainingBalance} />
          </section>

          <section className="expense-detail-card">
            <div>
              <span>Status</span>
              <StatusBadge status={displayStatus} />
            </div>
            <div>
              <span>Due date</span>
              <strong>{payment.due_date}</strong>
            </div>
            <div className="wide">
              <span>Notes</span>
              <strong>{payment.notes || "No notes"}</strong>
            </div>
          </section>

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
            <div className="billing-table-wrap">
              <table className="billing-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="num">Amount</th>
                    <th>Method</th>
                    <th>Reference</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((paymentRecord) => (
                    <tr key={paymentRecord.id}>
                      <td>{paymentRecord.payment_date}</td>
                      <td className="num">{currency.format(paymentRecord.amount)}</td>
                      <td>{paymentMethodLabel(paymentRecord.payment_method)}</td>
                      <td>{paymentRecord.reference_number || "—"}</td>
                      <td>
                        <div className="billing-row-actions">
                          <button onClick={() => void onDeletePayment(paymentRecord)} title="Delete" type="button"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {history.length === 0 && (
                    <tr>
                      <td className="collection-empty" colSpan={5}>No payments recorded yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, tone, value }: { label: string; tone?: "success"; value: number }) {
  return (
    <div className={`expense-summary-card ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{currency.format(value)}</strong>
    </div>
  );
}
```

- [ ] **Step 12: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 13: Run the domain test suite**

Run: `npm test`
Expected: PASS (all domain tests, including the ones from Tasks 3 and 4).

- [ ] **Step 14: Commit**

```bash
git add src/features/subcontractors/SubcontractorsFeature.tsx
git commit -m "feat: replace payout Mark Paid with a Record Payment flow"
```

---

### Task 9: Build and manual verification

**Files:** none (verification only)

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: Succeeds (`tsc --noEmit && vite build`), no type errors.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: All tests pass, including the new `paymentReminders.test.ts` and the updated `billing.test.ts`.

- [ ] **Step 3: Apply the schema migration**

Before manual testing can exercise real data, run the SQL block from Task 1 against the project's Supabase instance (SQL editor). Confirm `payment_reminder_payments` exists with RLS enabled.

- [ ] **Step 4: Manual smoke test**

Run: `npm run dev`, then in the browser:
1. Go to Subcontractors → open a subcontractor with at least one pending payout → Payouts tab.
2. Confirm the table shows `Paid` and `Remaining` columns and a "View details" + "Record payment" icon pair in Action.
3. Click "Record payment" on a pending payout, submit a partial amount less than the net amount → confirm the row now shows status "partial", `Paid` reflects the partial amount, `Remaining` reflects the rest.
4. Click "View details" → confirm the payment history table lists the just-recorded payment, and "Record Payment" is still offered (not fully paid yet).
5. Record a second payment for the remaining balance → confirm status flips to "paid" and "Record payment" disappears from the row and the details modal.
6. From the details modal, delete the most recent payment → confirm the payout reverts to "partial" and "Record Payment" reappears.
7. Confirm the header's "Record payout payment" button opens the form pre-filled with the correct remaining balance for the latest outstanding payout, and is disabled when there's no net pending amount.
8. Confirm the "Billing & Net" tab's payout status badge reflects partial/paid correctly.

- [ ] **Step 5: Report results**

If all manual checks pass, the feature is complete. If any step fails, treat it as a bug against the relevant task above rather than patching ad hoc — note which step failed and what was observed.
