# Subcontractor Daily Tickets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add daily ticket tracking for subcontractors inside the existing Daily Tickets page, with auto-pull into the billing form.

**Architecture:** New `subcon_daily_tickets` table stores per-subcontractor per-day ticket counts (install + repair). The Daily Tickets page gets an "Employees | Subcontractors" tab bar. The billing form auto-populates subcon ticket counts from daily entries for the selected period instead of manual input.

**Tech Stack:** React, TypeScript, Supabase (Postgres + RLS), existing app patterns.

## Global Constraints

- Currency: PHP, formatted with `Intl.NumberFormat("en-PH")`
- All tables use RLS with `auth.uid() = user_id`
- Offline-first: check `navigator.onLine`, queue mutations when offline
- Billing periods: first_half = days 1–15, second_half = days 16–end of month

---

### Task 1: Database Schema + Types

**Files:**
- Modify: `supabase_schema.sql`
- Modify: `src/types.ts`

- [ ] **Step 1: Add `subcon_daily_tickets` table to schema**

```sql
-- Add to supabase_schema.sql before the emergency contact section

create table if not exists public.subcon_daily_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null,
  subcontractor_id uuid not null references public.subcontractors(id) on delete cascade,
  subcon_name text not null,
  install_tickets integer not null default 0 check (install_tickets >= 0),
  repair_tickets integer not null default 0 check (repair_tickets >= 0),
  installation_rate numeric(12, 2) not null default 0,
  repair_rate numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, entry_date, subcontractor_id)
);

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
```

- [ ] **Step 2: Add TypeScript type to `src/types.ts`**

```ts
export type SubconDailyTicket = {
  id: string;
  user_id: string;
  entry_date: string;
  subcontractor_id: string;
  subcon_name: string;
  install_tickets: number;
  repair_tickets: number;
  installation_rate: number;
  repair_rate: number;
  created_at: string;
  updated_at: string;
};
```

- [ ] **Step 3: Add `"subconDailyTickets"` to `ResourceKey` union type**

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: PASS

---

### Task 2: Data Layer — Repository + Loader

**Files:**
- Create: `src/features/billing/subconTicketRepository.ts`
- Modify: `src/lib/supabaseData.ts`

- [ ] **Step 1: Create repository with fetch and save functions**

File: `src/features/billing/subconTicketRepository.ts`

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SubconDailyTicket } from "../../types";

const SELECT = "id,user_id,entry_date,subcontractor_id,subcon_name,install_tickets,repair_tickets,installation_rate,repair_rate,created_at,updated_at";

export async function fetchSubconDailyTickets(supabase: SupabaseClient) {
  const result = await supabase
    .from("subcon_daily_tickets")
    .select(SELECT)
    .order("entry_date", { ascending: false });
  return { data: (result.data ?? []) as SubconDailyTicket[], error: result.error };
}

export async function saveSubconDailyTicket(
  supabase: SupabaseClient,
  payload: Omit<SubconDailyTicket, "created_at" | "updated_at">,
) {
  return supabase
    .from("subcon_daily_tickets")
    .upsert(payload, { onConflict: "user_id,entry_date,subcontractor_id" })
    .select(SELECT)
    .single();
}
```

- [ ] **Step 2: Add `loadSubconDailyTickets()` to `src/lib/supabaseData.ts`**

```ts
import { fetchSubconDailyTickets } from "../features/billing/subconTicketRepository";

export async function loadSubconDailyTickets(supabase: SupabaseClient) {
  const result = await fetchSubconDailyTickets(supabase);
  return { data: result.data, error: result.error, label: "Subcon daily tickets" };
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: PASS

---

### Task 3: App.tsx Wiring — State, Resources, Loading

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add state variable**

```ts
const [subconDailyTickets, setSubconDailyTickets] = useState<SubconDailyTicket[]>([]);
```

- [ ] **Step 2: Add to `initialResourceStatuses` and `initialResourceHydration`**

Add `subconDailyTickets: "idle"` and `subconDailyTickets: false`.

- [ ] **Step 3: Add to `viewResources`**

```ts
"daily-tickets": ["positions", "employees", "dailyTicketEntries", "subcontractors", "subconDailyTickets"],
billing: ["billingRecords", "billingSettings", "dailyTicketEntries", "collections", "subcontractors", "subconDailyTickets"],
```

- [ ] **Step 4: Add three switch cases in `loadResource`**

Cache hydration case, load case, and result setter case — following existing patterns for `subconDailyTickets`.

- [ ] **Step 5: Pass `subconDailyTickets` and `subcontractors` to `DailyTicketEntryView` and `BillingFeature`**

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit`
Expected: PASS

---

### Task 4: Daily Tickets Page — Add Subcontractor Tab

**Files:**
- Modify: `src/App.tsx` (DailyTicketEntryView component and view rendering)

- [ ] **Step 1: Add `"daily-tickets-subcon"` to View union type, viewPaths, viewResources**

```ts
"daily-tickets-subcon": "/daily-tickets/subcontractors"
"daily-tickets-subcon": ["positions", "employees", "dailyTicketEntries", "subcontractors", "subconDailyTickets"]
```

- [ ] **Step 2: Add page-tabs to daily tickets rendering block**

Wrap the daily tickets view rendering in a tab bar:
```tsx
{(view === "daily-tickets" || view === "daily-tickets-subcon") && (
  <>
    <div className="page-tabs" role="tablist">
      <button className={view === "daily-tickets" ? "active" : ""} onClick={() => navigate("daily-tickets")} role="tab" type="button">Employees</button>
      <button className={view === "daily-tickets-subcon" ? "active" : ""} onClick={() => navigate("daily-tickets-subcon")} role="tab" type="button">Subcontractors</button>
    </div>
    {view === "daily-tickets" ? <DailyTicketEntryView ... /> : <SubconDailyTicketView ... />}
  </>
)}
```

- [ ] **Step 3: Update the Daily Tickets nav button to highlight for both views**

```tsx
<NavButton active={view === "daily-tickets" || view === "daily-tickets-subcon"} ... />
```

- [ ] **Step 4: Create `SubconDailyTicketView` component**

The component should:
- Show a date picker (same as employee daily tickets)
- List all active subcontractors with install/repair ticket inputs
- Show rates next to each input (from subcontractor's saved rates)
- Save button per row that upserts to `subcon_daily_tickets`
- Show existing entries for the selected date pre-filled

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` and test in browser.

---

### Task 5: Billing Form — Auto-Pull Subcon Tickets

**Files:**
- Modify: `src/domain/billing.ts`
- Modify: `src/features/billing/BillingFeature.tsx`

- [ ] **Step 1: Add `countSubconTickets()` function to `src/domain/billing.ts`**

```ts
import type { SubconDailyTicket } from "../types";

export function countSubconTickets(
  entries: SubconDailyTicket[],
  subcontractorId: string,
  month: number,
  year: number,
  period?: BillingPeriod,
): { install: number; repair: number } {
  return entries
    .filter((e) => {
      if (e.subcontractor_id !== subcontractorId) return false;
      const [y, m, d] = e.entry_date.split("-").map(Number);
      if (y !== year || m !== month) return false;
      if (!period) return true;
      return period === "first_half" ? d <= 15 : d >= 16;
    })
    .reduce((acc, e) => ({
      install: acc.install + e.install_tickets,
      repair: acc.repair + e.repair_tickets,
    }), { install: 0, repair: 0 });
}
```

- [ ] **Step 2: Update BillingFeature props to accept `subconDailyTickets`**

Add `subconDailyTickets: SubconDailyTicket[]` to `BillingFeatureProps`.

- [ ] **Step 3: Update BillingForm to auto-populate from daily entries**

When initializing `subconDrafts` for a new billing (not editing), use `countSubconTickets()` to pre-fill install/repair counts per subcontractor for the selected month/year/period. When month/year/period changes, recalculate.

Make the install/repair fields read-only (auto-pulled) — only disputed fields are editable.

- [ ] **Step 4: Pass `subconDailyTickets` from App.tsx to BillingFeature**

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` and `npm test`.
Test in browser: create a billing and verify subcon tickets auto-populate from daily entries.

---

### Task 6: CSS Styles

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: Add styles for subcon daily ticket entry grid**

Reuse existing daily ticket entry patterns. Add styles for:
- `.subcon-ticket-grid` — grid of subcon ticket entry cards
- `.subcon-ticket-card` — individual card with subcon name, rate info, inputs
- Input styling for install/repair fields

- [ ] **Step 2: Verify responsive behavior on mobile**

---

## Verification Checklist

1. `npx tsc --noEmit` passes
2. `npm test` passes (all 30 tests)
3. Daily Tickets page shows "Employees | Subcontractors" tabs
4. Subcontractors tab shows date picker + ticket entry per active subcon
5. Saving subcon daily tickets persists to database
6. Existing entries pre-fill when switching dates
7. Billing form auto-pulls subcon ticket counts from daily entries
8. Billing form install/repair fields show auto-pulled counts (read-only)
9. Only disputed fields are editable in billing form
10. Changing month/year/period in billing form recalculates subcon tickets

## DB Migration

```sql
CREATE TABLE IF NOT EXISTS public.subcon_daily_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  subcontractor_id uuid NOT NULL REFERENCES public.subcontractors(id) ON DELETE CASCADE,
  subcon_name text NOT NULL,
  install_tickets integer NOT NULL DEFAULT 0 CHECK (install_tickets >= 0),
  repair_tickets integer NOT NULL DEFAULT 0 CHECK (repair_tickets >= 0),
  installation_rate numeric(12,2) NOT NULL DEFAULT 0,
  repair_rate numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, entry_date, subcontractor_id)
);

CREATE INDEX subcon_daily_tickets_user_date_idx ON public.subcon_daily_tickets (user_id, entry_date DESC);

CREATE TRIGGER set_subcon_daily_tickets_updated_at
BEFORE UPDATE ON public.subcon_daily_tickets
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.subcon_daily_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subcon daily tickets are owned by their user"
ON public.subcon_daily_tickets FOR ALL
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```
