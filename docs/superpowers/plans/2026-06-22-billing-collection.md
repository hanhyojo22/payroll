# Billing & Collection Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a monthly billing system that invoices one client based on closed tickets, computes a 70/30 Collections/Collectibles split, and auto-creates a collection receivable for the 70% portion.

**Architecture:** New `billing_settings` and `billing_records` tables. Pure domain logic in `src/domain/billing.ts` computes ticket counts and billing amounts. A `BillingFeature` component (in `src/features/billing/`) owns the UI, following the same extracted-feature pattern as `CollectionsFeature`. App.tsx gets minimal wiring: nav, resource plumbing, view rendering.

**Tech Stack:** React + TypeScript + Vite, Supabase (Postgres + RLS), Vitest for domain tests.

## Global Constraints

- Currency: PHP, formatted with `Intl.NumberFormat("en-PH")`
- All tables use RLS with `auth.uid() = user_id`
- Offline writes go through `queueMutation()`, online writes go through Supabase directly
- Domain logic in `src/domain/` must be pure (no Supabase dependency)
- Tests run with `npx vitest run src/domain/billing.test.ts`
- Feature components go in `src/features/billing/` (NOT in App.tsx)
- Follow the CollectionsFeature / collectionRepository pattern for file structure

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `supabase_schema.sql` | Modify | Add `billing_settings` and `billing_records` tables |
| `src/types.ts` | Modify | Add `BillingSettings`, `BillingRecord`, `BillingFormValues`, ResourceKey updates |
| `src/domain/billing.ts` | Create | Pure billing computation functions |
| `src/domain/billing.test.ts` | Create | Domain tests |
| `src/features/billing/billingRepository.ts` | Create | Supabase queries for billing |
| `src/features/billing/BillingFeature.tsx` | Create | Billing view UI component |
| `src/lib/supabaseData.ts` | Modify | Add `loadBillingRecords`, `loadBillingSettings` |
| `src/lib/offlineSync.ts` | Modify | Add `billing_group` composite operation |
| `src/lib/offlineDb.ts` | Modify | Add `billing_group` to `PendingMutationOperation` |
| `src/App.tsx` | Modify | Nav, resource plumbing, view rendering (minimal) |

---

### Task 1: Schema — billing_settings + billing_records tables

**Files:**
- Modify: `supabase_schema.sql` (append migration block at end)

**Interfaces:**
- Produces: `billing_settings` table, `billing_records` table with all columns, constraints, indexes, RLS, triggers

- [ ] **Step 1: Add billing_settings table**

Append to end of `supabase_schema.sql`:

```sql
-- Billing & Collection integration
create table if not exists public.billing_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  billing_rate numeric(12, 2) not null default 0 check (billing_rate >= 0),
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

alter table public.billing_settings enable row level security;

drop policy if exists "billing settings are owned by their user" on public.billing_settings;
create policy "billing settings are owned by their user"
on public.billing_settings for all
using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

- [ ] **Step 2: Add billing_records table**

Continue appending:

```sql
create table if not exists public.billing_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  billing_month integer not null check (billing_month between 1 and 12),
  billing_year integer not null check (billing_year between 1900 and 2200),
  total_tickets integer not null default 0 check (total_tickets >= 0),
  disputed_tickets integer not null default 0 check (disputed_tickets >= 0),
  billable_tickets integer not null default 0 check (billable_tickets >= 0),
  billing_rate numeric(12, 2) not null default 0 check (billing_rate >= 0),
  billing_amount numeric(12, 2) not null default 0 check (billing_amount >= 0),
  collections_pct integer not null default 70 check (collections_pct >= 0 and collections_pct <= 100),
  collections_amount numeric(12, 2) not null default 0 check (collections_amount >= 0),
  collectibles_amount numeric(12, 2) not null default 0 check (collectibles_amount >= 0),
  collection_id uuid references public.collection_reminders(id) on delete set null,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, billing_month, billing_year)
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
```

- [ ] **Step 3: Commit**

```bash
git add supabase_schema.sql
git commit -m "feat: add billing_settings and billing_records tables"
```

---

### Task 2: TypeScript Types — BillingSettings, BillingRecord, ResourceKey

**Files:**
- Modify: `src/types.ts`

**Interfaces:**
- Consumes: schema from Task 1
- Produces: `BillingSettings` type, `BillingRecord` type, `BillingFormValues` type, updated `ResourceKey`

- [ ] **Step 1: Add BillingSettings type**

Add at the end of `src/types.ts`, before the form value types section:

```typescript
export type BillingSettings = {
  id: string;
  user_id: string;
  billing_rate: number;
  collections_pct: number;
  client_name: string;
  created_at: string;
  updated_at: string;
};

export type BillingRecord = {
  id: string;
  user_id: string;
  billing_month: number;
  billing_year: number;
  total_tickets: number;
  disputed_tickets: number;
  billable_tickets: number;
  billing_rate: number;
  billing_amount: number;
  collections_pct: number;
  collections_amount: number;
  collectibles_amount: number;
  collection_id: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type BillingFormValues = {
  billing_month: string;
  billing_year: string;
  disputed_tickets: string;
  notes: string;
};
```

- [ ] **Step 2: Add ResourceKey values**

Add `"billingRecords"` and `"billingSettings"` to the `ResourceKey` union (alphabetical order):

```typescript
export type ResourceKey =
  | "attendanceEntries"
  | "billingRecords"
  | "billingSettings"
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

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add BillingSettings, BillingRecord types and ResourceKey entries"
```

---

### Task 3: Domain Logic — billing computation (TDD)

**Files:**
- Create: `src/domain/billing.ts`
- Create: `src/domain/billing.test.ts`

**Interfaces:**
- Consumes: `DailyTicketEntry` type from types.ts
- Produces:
  - `countTicketsForMonth(entries: DailyTicketEntry[], month: number, year: number): number`
  - `computeBilling(totalTickets: number, disputedTickets: number, billingRate: number, collectionsPct: number): { billableTickets: number; billingAmount: number; collectionsAmount: number; collectiblesAmount: number }`
  - `lastDayOfMonth(month: number, year: number): string`

- [ ] **Step 1: Write failing tests**

Create `src/domain/billing.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { computeBilling, countTicketsForMonth, lastDayOfMonth } from "./billing";
import type { DailyTicketEntry } from "../types";

describe("countTicketsForMonth", () => {
  const entries: DailyTicketEntry[] = [
    {
      id: "e1", user_id: "u1", entry_date: "2026-06-05", employee_id: "emp1",
      employee_name: "Alice", position_id: "p1", position_name: "Tech",
      installation_tickets: 3, repair_tickets: 2, installation_rate: 600,
      repair_rate: 200, created_at: "", updated_at: "",
      details: [
        { id: "d1", user_id: "u1", daily_ticket_entry_id: "e1", position_ticket_category_id: "c1", category_name: "Install", ticket_count: 4, rate: 600, created_at: "", updated_at: "" },
        { id: "d2", user_id: "u1", daily_ticket_entry_id: "e1", position_ticket_category_id: "c2", category_name: "Repair", ticket_count: 2, rate: 200, created_at: "", updated_at: "" },
      ],
    },
    {
      id: "e2", user_id: "u1", entry_date: "2026-06-12", employee_id: "emp2",
      employee_name: "Bob", position_id: null, position_name: "",
      installation_tickets: 5, repair_tickets: 1, installation_rate: 600,
      repair_rate: 200, created_at: "", updated_at: "",
      details: [],
    },
    {
      id: "e3", user_id: "u1", entry_date: "2026-07-03", employee_id: "emp1",
      employee_name: "Alice", position_id: "p1", position_name: "Tech",
      installation_tickets: 10, repair_tickets: 5, installation_rate: 600,
      repair_rate: 200, created_at: "", updated_at: "",
      details: [],
    },
  ];

  it("sums ticket counts from details when available, falls back to legacy fields", () => {
    const count = countTicketsForMonth(entries, 6, 2026);
    // Entry 1: details present → 4 + 2 = 6
    // Entry 2: no details → installation_tickets(5) + repair_tickets(1) = 6
    // Entry 3: July, excluded
    expect(count).toBe(12);
  });

  it("returns 0 when no entries match the month", () => {
    expect(countTicketsForMonth(entries, 8, 2026)).toBe(0);
  });

  it("returns 0 for empty entries array", () => {
    expect(countTicketsForMonth([], 6, 2026)).toBe(0);
  });
});

describe("computeBilling", () => {
  it("computes billing with 70/30 split", () => {
    const result = computeBilling(100, 10, 1500, 70);
    expect(result.billableTickets).toBe(90);
    expect(result.billingAmount).toBe(135_000);
    expect(result.collectionsAmount).toBe(94_500);
    expect(result.collectiblesAmount).toBe(40_500);
  });

  it("handles zero tickets", () => {
    const result = computeBilling(0, 0, 1500, 70);
    expect(result.billableTickets).toBe(0);
    expect(result.billingAmount).toBe(0);
    expect(result.collectionsAmount).toBe(0);
    expect(result.collectiblesAmount).toBe(0);
  });

  it("clamps disputed tickets to total", () => {
    const result = computeBilling(5, 10, 1500, 70);
    expect(result.billableTickets).toBe(0);
    expect(result.billingAmount).toBe(0);
  });

  it("handles 100% collections", () => {
    const result = computeBilling(10, 0, 1000, 100);
    expect(result.collectionsAmount).toBe(10_000);
    expect(result.collectiblesAmount).toBe(0);
  });

  it("handles 0% collections", () => {
    const result = computeBilling(10, 0, 1000, 0);
    expect(result.collectionsAmount).toBe(0);
    expect(result.collectiblesAmount).toBe(10_000);
  });
});

describe("lastDayOfMonth", () => {
  it("returns last day of June 2026", () => {
    expect(lastDayOfMonth(6, 2026)).toBe("2026-06-30");
  });

  it("returns last day of February in a non-leap year", () => {
    expect(lastDayOfMonth(2, 2025)).toBe("2025-02-28");
  });

  it("returns last day of February in a leap year", () => {
    expect(lastDayOfMonth(2, 2024)).toBe("2024-02-29");
  });

  it("returns last day of December", () => {
    expect(lastDayOfMonth(12, 2026)).toBe("2026-12-31");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/domain/billing.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement billing domain functions**

Create `src/domain/billing.ts`:

```typescript
import type { DailyTicketEntry } from "../types";

export function countTicketsForMonth(
  entries: DailyTicketEntry[],
  month: number,
  year: number,
): number {
  return entries
    .filter((entry) => {
      const [entryYear, entryMonth] = entry.entry_date.split("-").map(Number);
      return entryYear === year && entryMonth === month;
    })
    .reduce((sum, entry) => {
      if (entry.details && entry.details.length > 0) {
        return sum + entry.details.reduce((s, d) => s + (d.ticket_count ?? 0), 0);
      }
      return sum + (entry.installation_tickets ?? 0) + (entry.repair_tickets ?? 0);
    }, 0);
}

export function computeBilling(
  totalTickets: number,
  disputedTickets: number,
  billingRate: number,
  collectionsPct: number,
): {
  billableTickets: number;
  billingAmount: number;
  collectionsAmount: number;
  collectiblesAmount: number;
} {
  const billableTickets = Math.max(0, totalTickets - disputedTickets);
  const billingAmount = billableTickets * billingRate;
  const collectionsAmount = Math.round(billingAmount * collectionsPct / 100 * 100) / 100;
  const collectiblesAmount = Math.round((billingAmount - collectionsAmount) * 100) / 100;
  return { billableTickets, billingAmount, collectionsAmount, collectiblesAmount };
}

export function lastDayOfMonth(month: number, year: number): string {
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/domain/billing.test.ts`
Expected: ALL tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/billing.ts src/domain/billing.test.ts
git commit -m "feat: add billing domain logic — countTicketsForMonth, computeBilling, lastDayOfMonth"
```

---

### Task 4: Data Layer — billingRepository + loadBillingRecords/Settings + resource plumbing

**Files:**
- Create: `src/features/billing/billingRepository.ts`
- Modify: `src/lib/supabaseData.ts`
- Modify: `src/lib/offlineDb.ts`
- Modify: `src/lib/offlineSync.ts`
- Modify: `src/App.tsx` (resource plumbing only — NOT UI)

**Interfaces:**
- Consumes: `BillingSettings`, `BillingRecord` from types.ts, `billing_settings`/`billing_records` tables
- Produces:
  - `fetchBillingSettings(supabase): Promise<{ data: BillingSettings | null; error }>`
  - `fetchBillingRecords(supabase): Promise<{ data: BillingRecord[]; error }>`
  - `ensureBillingSettings(supabase, userId): Promise<BillingSettings>`
  - `saveBillingSettings(supabase, userId, payload): Promise<{ error }>`
  - `loadBillingRecords(supabase)` and `loadBillingSettings(supabase)` in supabaseData.ts
  - `billing_group` operation in offlineSync

- [ ] **Step 1: Create billingRepository.ts**

Create `src/features/billing/billingRepository.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillingRecord, BillingSettings } from "../../types";

const BILLING_RECORDS_SELECT = "id,user_id,billing_month,billing_year,total_tickets,disputed_tickets,billable_tickets,billing_rate,billing_amount,collections_pct,collections_amount,collectibles_amount,collection_id,notes,created_at,updated_at";
const BILLING_SETTINGS_SELECT = "id,user_id,billing_rate,collections_pct,client_name,created_at,updated_at";

export async function fetchBillingRecords(supabase: SupabaseClient) {
  const result = await supabase
    .from("billing_records")
    .select(BILLING_RECORDS_SELECT)
    .order("billing_year", { ascending: false })
    .order("billing_month", { ascending: false });
  return {
    data: (result.data ?? []) as BillingRecord[],
    error: result.error,
  };
}

export async function fetchBillingSettings(supabase: SupabaseClient) {
  const result = await supabase
    .from("billing_settings")
    .select(BILLING_SETTINGS_SELECT)
    .limit(1)
    .maybeSingle();
  return {
    data: result.data as BillingSettings | null,
    error: result.error,
  };
}

export async function ensureBillingSettings(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ data: BillingSettings; error: unknown }> {
  const existing = await fetchBillingSettings(supabase);
  if (existing.data) return { data: existing.data, error: null };
  const result = await supabase
    .from("billing_settings")
    .upsert({ user_id: userId, billing_rate: 0, collections_pct: 70, client_name: "" }, { onConflict: "user_id" })
    .select(BILLING_SETTINGS_SELECT)
    .single();
  return { data: result.data as BillingSettings, error: result.error };
}

export async function saveBillingSettings(
  supabase: SupabaseClient,
  userId: string,
  payload: { billing_rate: number; collections_pct: number; client_name: string },
) {
  return supabase
    .from("billing_settings")
    .upsert({ user_id: userId, ...payload }, { onConflict: "user_id" });
}

export async function saveBillingRecord(
  supabase: SupabaseClient,
  record: Omit<BillingRecord, "created_at" | "updated_at">,
) {
  return supabase
    .from("billing_records")
    .upsert(record, { onConflict: "user_id,billing_month,billing_year" })
    .select(BILLING_RECORDS_SELECT)
    .single();
}

export async function deleteBillingRecord(
  supabase: SupabaseClient,
  id: string,
  collectionId: string | null,
) {
  if (collectionId) {
    await supabase.from("collection_reminders").delete().eq("id", collectionId);
  }
  return supabase.from("billing_records").delete().eq("id", id);
}
```

- [ ] **Step 2: Add load functions to supabaseData.ts**

Add `BillingRecord` and `BillingSettings` to the import from `"../types"`.

Add after the existing load functions:

```typescript
export async function loadBillingRecords(supabase: SupabaseClient) {
  return settle<BillingRecord>(
    "Billing records",
    supabase
      .from("billing_records")
      .select("id,user_id,billing_month,billing_year,total_tickets,disputed_tickets,billable_tickets,billing_rate,billing_amount,collections_pct,collections_amount,collectibles_amount,collection_id,notes,created_at,updated_at")
      .order("billing_year", { ascending: false })
      .order("billing_month", { ascending: false }),
  );
}

export async function loadBillingSettings(supabase: SupabaseClient) {
  const result = await settle<BillingSettings>(
    "Billing settings",
    supabase
      .from("billing_settings")
      .select("id,user_id,billing_rate,collections_pct,client_name,created_at,updated_at")
      .limit(1),
  );
  return {
    data: result.data[0] ?? null,
    error: result.error,
    label: result.label,
  };
}
```

- [ ] **Step 3: Add billing_group to offlineDb PendingMutationOperation**

In `src/lib/offlineDb.ts`, update `PendingMutationOperation`:

```typescript
export type PendingMutationOperation = "insert" | "update" | "delete" | "upsert" | "payroll_group" | "payroll_items_group" | "billing_group";
```

- [ ] **Step 4: Add billing_group case to offlineSync.ts**

In `src/lib/offlineSync.ts`, add a new case inside the `applyMutation` switch, after the existing `payroll_items_group` case:

```typescript
    case "billing_group": {
      const payload = mutation.payload as {
        billingPayload: Record<string, unknown>;
        collectionPayload: Record<string, unknown>;
      };
      const collectionResult = await supabase.from("collection_reminders").insert(payload.collectionPayload);
      if (collectionResult.error) return collectionResult;
      const billingResult = await supabase.from("billing_records").insert(payload.billingPayload);
      if (billingResult.error) return billingResult;
      return { error: null };
    }
```

- [ ] **Step 5: Add resource plumbing to App.tsx**

Add to imports from `"./lib/supabaseData"`:
```typescript
loadBillingRecords, loadBillingSettings
```

Add to imports from `"./types"`:
```typescript
BillingRecord, BillingSettings
```

Add to `initialResourceStatuses`:
```typescript
billingRecords: "idle",
billingSettings: "idle",
```

Add to `initialResourceHydration`:
```typescript
billingRecords: false,
billingSettings: false,
```

Add state variables in Workspace:
```typescript
const [billingRecords, setBillingRecords] = useState<BillingRecord[]>([]);
const [billingSettings, setBillingSettings] = useState<BillingSettings | null>(null);
```

Add cases in all three `loadResource` switch blocks:

Cache hydration:
```typescript
case "billingRecords":
  setBillingRecords(cached as BillingRecord[]);
  break;
case "billingSettings":
  setBillingSettings(cached as BillingSettings);
  break;
```

Supabase fetch:
```typescript
case "billingRecords":
  return loadBillingRecords(supabase);
case "billingSettings":
  return loadBillingSettings(supabase);
```

Result setter:
```typescript
case "billingRecords":
  setBillingRecords(result.data as BillingRecord[]);
  break;
case "billingSettings":
  setBillingSettings(result.data as BillingSettings);
  break;
```

Add refresh function:
```typescript
async function refreshBillingPage() {
  await Promise.all([
    loadResource("billingRecords", true),
    loadResource("billingSettings", true),
    loadResource("collections", true),
  ]);
}
```

- [ ] **Step 6: Commit**

```bash
git add src/features/billing/billingRepository.ts src/lib/supabaseData.ts src/lib/offlineDb.ts src/lib/offlineSync.ts src/App.tsx
git commit -m "feat: add billing data layer — repository, load functions, offline sync, resource plumbing"
```

---

### Task 5: Billing Feature UI — BillingFeature component + settings panel

**Files:**
- Create: `src/features/billing/BillingFeature.tsx`
- Modify: `src/App.tsx` (nav + view rendering)

**Interfaces:**
- Consumes: `BillingRecord`, `BillingSettings`, `BillingFormValues`, `DailyTicketEntry` from types.ts; `computeBilling`, `countTicketsForMonth`, `lastDayOfMonth` from domain/billing.ts; `ensureBillingSettings`, `saveBillingSettings`, `saveBillingRecord`, `deleteBillingRecord` from billingRepository.ts; `collectionStatus` from domain/collections.ts
- Produces: Full Billing view with table, create form, settings panel, auto-create receivable on save

- [ ] **Step 1: Create BillingFeature.tsx**

Create `src/features/billing/BillingFeature.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { FileText, Plus, Settings, Trash2 } from "lucide-react";
import { computeBilling, countTicketsForMonth, lastDayOfMonth } from "../../domain/billing";
import type { PendingMutation } from "../../lib/offlineDb";
import { isOfflineLikeError } from "../../lib/offlineSync";
import { supabase } from "../../supabase";
import type {
  BillingFormValues,
  BillingRecord,
  BillingSettings,
  CollectionReminder,
  DailyTicketEntry,
} from "../../types";
import {
  deleteBillingRecord,
  ensureBillingSettings,
  saveBillingRecord,
  saveBillingSettings,
} from "./billingRepository";

type Notice = { type: "success" | "error"; text: string } | null;
type QueueOfflineMutation = (mutation: Omit<PendingMutation, "id" | "createdAt" | "status" | "attempts" | "userId">) => Promise<void>;

const currency = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const currentMonth = () => new Date().getMonth() + 1;
const currentYear = () => new Date().getFullYear();
const todayKey = () => new Date().toISOString().slice(0, 10);

export type BillingFeatureProps = {
  billingRecords: BillingRecord[];
  billingSettings: BillingSettings | null;
  collections: CollectionReminder[];
  dailyTicketEntries: DailyTicketEntry[];
  onChange: () => Promise<void>;
  onLocalBillingRecordsChange: (records: BillingRecord[]) => void;
  onQueueOfflineMutation: QueueOfflineMutation;
  setNotice: (notice: Notice) => void;
  userId: string;
};

export function BillingFeature({
  billingRecords,
  billingSettings,
  collections,
  dailyTicketEntries,
  onChange,
  onLocalBillingRecordsChange,
  onQueueOfflineMutation,
  setNotice,
  userId,
}: BillingFeatureProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<BillingSettings | null>(billingSettings);

  useEffect(() => { setSettings(billingSettings); }, [billingSettings]);

  useEffect(() => {
    if (!supabase || settings) return;
    void ensureBillingSettings(supabase, userId).then(({ data }) => { if (data) setSettings(data); });
  }, [settings, userId]);

  function collectionStatusFor(record: BillingRecord): string {
    if (!record.collection_id) return "—";
    const collection = collections.find((c) => c.id === record.collection_id);
    if (!collection) return "pending";
    return collection.status === "legacy_pending" ? "pending" : collection.status;
  }

  async function createBilling(values: BillingFormValues) {
    if (!supabase || !settings) return;
    const month = Number(values.billing_month);
    const year = Number(values.billing_year);
    const totalTickets = countTicketsForMonth(dailyTicketEntries, month, year);
    const disputed = Math.max(0, Math.min(totalTickets, Number(values.disputed_tickets) || 0));
    const billing = computeBilling(totalTickets, disputed, settings.billing_rate, settings.collections_pct);

    const existing = billingRecords.find((r) => r.billing_month === month && r.billing_year === year);
    if (existing) {
      setNotice({ type: "error", text: `Billing for ${monthNames[month - 1]} ${year} already exists.` });
      return;
    }

    const collectionId = crypto.randomUUID();
    const billingId = crypto.randomUUID();
    const collectionPayload = {
      id: collectionId,
      user_id: userId,
      title: `Billing ${monthNames[month - 1]} ${year}`,
      client_name: settings.client_name || "Client",
      external_reference: "",
      issue_date: todayKey(),
      amount: billing.collectionsAmount,
      due_date: lastDayOfMonth(month, year),
      status: "pending" as const,
      notes: `Auto-created from billing ${monthNames[month - 1]} ${year}.`,
    };
    const billingPayload: Omit<BillingRecord, "created_at" | "updated_at"> = {
      id: billingId,
      user_id: userId,
      billing_month: month,
      billing_year: year,
      total_tickets: totalTickets,
      disputed_tickets: disputed,
      billable_tickets: billing.billableTickets,
      billing_rate: settings.billing_rate,
      billing_amount: billing.billingAmount,
      collections_pct: settings.collections_pct,
      collections_amount: billing.collectionsAmount,
      collectibles_amount: billing.collectiblesAmount,
      collection_id: collectionId,
      notes: values.notes.trim(),
    };

    if (!navigator.onLine) {
      const optimistic = { ...billingPayload, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as BillingRecord;
      onLocalBillingRecordsChange([optimistic, ...billingRecords]);
      await onQueueOfflineMutation({
        resource: "billingRecords",
        affectedResources: ["billingRecords", "collections", "dashboardSummary"],
        operation: "billing_group",
        table: "billing_records",
        recordId: billingId,
        payload: { billingPayload, collectionPayload },
      });
      setFormOpen(false);
      setNotice({ type: "success", text: `Billing for ${monthNames[month - 1]} ${year} created.` });
      return;
    }

    const collectionResult = await supabase.from("collection_reminders").insert(collectionPayload);
    if (collectionResult.error) {
      if (isOfflineLikeError(collectionResult.error)) {
        const optimistic = { ...billingPayload, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as BillingRecord;
        onLocalBillingRecordsChange([optimistic, ...billingRecords]);
        await onQueueOfflineMutation({
          resource: "billingRecords", affectedResources: ["billingRecords", "collections", "dashboardSummary"],
          operation: "billing_group", table: "billing_records", recordId: billingId,
          payload: { billingPayload, collectionPayload },
        });
        setFormOpen(false);
        return;
      }
      setNotice({ type: "error", text: collectionResult.error.message ?? "Failed to create receivable." });
      return;
    }

    const billingResult = await saveBillingRecord(supabase, billingPayload);
    if (billingResult.error) {
      setNotice({ type: "error", text: (billingResult.error as { message?: string }).message ?? "Failed to save billing record." });
      return;
    }

    setFormOpen(false);
    setNotice({ type: "success", text: `Billing for ${monthNames[month - 1]} ${year} created.` });
    await onChange();
  }

  async function removeBilling(record: BillingRecord) {
    if (!supabase) return;
    const result = await deleteBillingRecord(supabase, record.id, record.collection_id);
    if (result.error) {
      setNotice({ type: "error", text: (result.error as { message?: string }).message ?? "Failed to delete billing." });
      return;
    }
    setNotice({ type: "success", text: "Billing record deleted." });
    await onChange();
  }

  async function updateSettings(rate: number, pct: number, clientName: string) {
    if (!supabase) return;
    const result = await saveBillingSettings(supabase, userId, { billing_rate: rate, collections_pct: pct, client_name: clientName });
    if (result.error) {
      setNotice({ type: "error", text: "Failed to save settings." });
      return;
    }
    setSettings((prev) => prev ? { ...prev, billing_rate: rate, collections_pct: pct, client_name: clientName } : prev);
    setSettingsOpen(false);
    setNotice({ type: "success", text: "Billing settings saved." });
    await onChange();
  }

  const summary = useMemo(() => ({
    totalBilled: billingRecords.reduce((s, r) => s + r.billing_amount, 0),
    totalCollections: billingRecords.reduce((s, r) => s + r.collections_amount, 0),
    totalCollectibles: billingRecords.reduce((s, r) => s + r.collectibles_amount, 0),
  }), [billingRecords]);

  return (
    <div className="stack">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Monthly invoicing</p>
          <h2>Billing</h2>
        </div>
        <div className="inline-actions">
          <button className="secondary-button compact" onClick={() => setSettingsOpen(true)} type="button">
            <Settings size={15} /> Settings
          </button>
          <button className="primary-button compact" onClick={() => setFormOpen(true)} type="button">
            <Plus size={15} /> Create billing
          </button>
        </div>
      </div>
      <div className="stats-row">
        <div className="stat-card"><span>Total billed</span><strong>{currency.format(summary.totalBilled)}</strong></div>
        <div className="stat-card"><span>Collections ({settings?.collections_pct ?? 70}%)</span><strong>{currency.format(summary.totalCollections)}</strong></div>
        <div className="stat-card"><span>Collectibles ({100 - (settings?.collections_pct ?? 70)}%)</span><strong>{currency.format(summary.totalCollectibles)}</strong></div>
      </div>
      {billingRecords.length === 0 ? (
        <p className="muted-text">No billing records yet. Create your first monthly billing above.</p>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Month/Year</th>
                <th>Total Tickets</th>
                <th>Disputed</th>
                <th>Billable</th>
                <th>Billing Amount</th>
                <th>Collections</th>
                <th>Collectibles</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {billingRecords.map((record) => (
                <tr key={record.id}>
                  <td><strong>{monthNames[record.billing_month - 1]} {record.billing_year}</strong></td>
                  <td>{record.total_tickets}</td>
                  <td>{record.disputed_tickets}</td>
                  <td>{record.billable_tickets}</td>
                  <td>{currency.format(record.billing_amount)}</td>
                  <td>{currency.format(record.collections_amount)}</td>
                  <td>{currency.format(record.collectibles_amount)}</td>
                  <td><span className={`badge ${collectionStatusFor(record)}`}>{collectionStatusFor(record)}</span></td>
                  <td>
                    <button className="secondary-button compact" onClick={() => removeBilling(record)} type="button" title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {formOpen && settings && (
        <BillingForm
          dailyTicketEntries={dailyTicketEntries}
          settings={settings}
          onClose={() => setFormOpen(false)}
          onSubmit={createBilling}
        />
      )}
      {settingsOpen && settings && (
        <SettingsPanel
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSubmit={updateSettings}
        />
      )}
    </div>
  );
}

function BillingForm({
  dailyTicketEntries,
  settings,
  onClose,
  onSubmit,
}: {
  dailyTicketEntries: DailyTicketEntry[];
  settings: BillingSettings;
  onClose: () => void;
  onSubmit: (values: BillingFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState<BillingFormValues>({
    billing_month: String(currentMonth()),
    billing_year: String(currentYear()),
    disputed_tickets: "0",
    notes: "",
  });
  const [busy, setBusy] = useState(false);

  const totalTickets = countTicketsForMonth(dailyTicketEntries, Number(values.billing_month), Number(values.billing_year));
  const preview = computeBilling(totalTickets, Number(values.disputed_tickets) || 0, settings.billing_rate, settings.collections_pct);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Create Monthly Billing</h3>
          <button onClick={onClose} type="button">&times;</button>
        </div>
        <form className="form-grid" onSubmit={async (e) => { e.preventDefault(); setBusy(true); await onSubmit(values); setBusy(false); }}>
          <label>
            Month
            <select value={values.billing_month} onChange={(e) => setValues({ ...values, billing_month: e.target.value })}>
              {monthNames.map((name, i) => <option key={i} value={String(i + 1)}>{name}</option>)}
            </select>
          </label>
          <label>
            Year
            <input type="number" min="2020" max="2200" value={values.billing_year} onChange={(e) => setValues({ ...values, billing_year: e.target.value })} required />
          </label>
          <div className="full detail-row">
            <div><span className="muted-text">Total tickets</span><strong>{totalTickets}</strong></div>
            <div><span className="muted-text">Rate</span><strong>{currency.format(settings.billing_rate)}/ticket</strong></div>
          </div>
          <label>
            Disputed tickets
            <input type="number" min="0" max={totalTickets} value={values.disputed_tickets} onChange={(e) => setValues({ ...values, disputed_tickets: e.target.value })} />
          </label>
          <div className="full detail-row">
            <div><span className="muted-text">Billable</span><strong>{preview.billableTickets}</strong></div>
            <div><span className="muted-text">Billing amount</span><strong>{currency.format(preview.billingAmount)}</strong></div>
          </div>
          <div className="full detail-row">
            <div><span className="muted-text">Collections ({settings.collections_pct}%)</span><strong>{currency.format(preview.collectionsAmount)}</strong></div>
            <div><span className="muted-text">Collectibles ({100 - settings.collections_pct}%)</span><strong>{currency.format(preview.collectiblesAmount)}</strong></div>
          </div>
          <label className="full">
            Notes
            <textarea rows={3} value={values.notes} onChange={(e) => setValues({ ...values, notes: e.target.value })} />
          </label>
          <div className="form-actions full">
            <button className="secondary-button" onClick={onClose} type="button">Cancel</button>
            <button className="primary-button" disabled={busy || totalTickets === 0} type="submit">{busy ? "Saving..." : "Create Billing"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SettingsPanel({
  settings,
  onClose,
  onSubmit,
}: {
  settings: BillingSettings;
  onClose: () => void;
  onSubmit: (rate: number, pct: number, clientName: string) => Promise<void>;
}) {
  const [rate, setRate] = useState(String(settings.billing_rate));
  const [pct, setPct] = useState(String(settings.collections_pct));
  const [clientName, setClientName] = useState(settings.client_name);
  const [busy, setBusy] = useState(false);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Billing Settings</h3>
          <button onClick={onClose} type="button">&times;</button>
        </div>
        <form className="form-grid" onSubmit={async (e) => { e.preventDefault(); setBusy(true); await onSubmit(Number(rate), Number(pct), clientName); setBusy(false); }}>
          <label>
            Billing rate (PHP per ticket)
            <input type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} required />
          </label>
          <label>
            Collections %
            <input type="number" min="0" max="100" value={pct} onChange={(e) => setPct(e.target.value)} required />
          </label>
          <label className="full">
            Client name
            <input type="text" value={clientName} onChange={(e) => setClientName(e.target.value)} />
          </label>
          <div className="form-actions full">
            <button className="secondary-button" onClick={onClose} type="button">Cancel</button>
            <button className="primary-button" disabled={busy} type="submit">{busy ? "Saving..." : "Save Settings"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add navigation and view rendering to App.tsx**

Add `"billing"` to the `View` type:
```typescript
type View =
  | "attendance"
  | "billing"
  | "dashboard"
  // ... rest
```

Add to `viewPaths`:
```typescript
billing: "/billing",
```

Add to `viewResources`:
```typescript
billing: ["billingRecords", "billingSettings", "dailyTicketEntries", "collections"],
```

Add import at top of App.tsx:
```typescript
import { BillingFeature } from "./features/billing/BillingFeature";
```

Add NavButton in sidebar (after Collections, before Collection History):
```tsx
<NavButton active={view === "billing"} icon={<FileText size={18} />} label="Billing" onClick={() => navigate("billing")} />
```

Add view rendering in content area:
```tsx
{view === "billing" && (
  <BillingFeature
    billingRecords={billingRecords}
    billingSettings={billingSettings}
    collections={collections}
    dailyTicketEntries={dailyTicketEntries}
    onChange={refreshBillingPage}
    onLocalBillingRecordsChange={setBillingRecords}
    onQueueOfflineMutation={queueOfflineMutation}
    setNotice={setNotice}
    userId={session.user.id}
  />
)}
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: All tests pass (billing + payroll)

- [ ] **Step 5: Commit**

```bash
git add src/features/billing/BillingFeature.tsx src/App.tsx
git commit -m "feat: add Billing view with create form, settings panel, collection auto-create"
```

---

### Task 6: Final Integration — verify end-to-end

**Files:**
- No new files — verification only

**Interfaces:**
- Consumes: All previous tasks
- Produces: Verified working feature

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: ALL tests pass

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 3: Manual verification**

Run: `npm run dev`

Checklist:
1. Navigate to Billing view — appears in sidebar
2. Open Settings — set billing rate (e.g., 1500), collections % (70), client name
3. Create billing for current month — total tickets auto-populated from daily entries
4. Enter disputed tickets — preview updates live
5. Save — billing record appears in table
6. Check Collections view — auto-created receivable appears with 70% amount
7. Verify duplicate prevention — try creating same month again, see error
8. Delete a billing record — linked receivable also deleted
9. Verify existing features (payroll, collections, attendance) still work

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "feat: billing & collection integration — complete feature"
```
