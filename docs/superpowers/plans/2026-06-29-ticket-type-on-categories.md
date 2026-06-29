# Ticket Type on Position Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `ticket_type` field ("installation" | "repair") to position ticket categories so daily ticket entries can be split by type, enabling billing to auto-compute separate installation and repair ticket counts.

**Architecture:** `ticket_type` is added to `position_ticket_categories` in the DB and denormalized into `daily_ticket_entry_items` at save time. `countTicketsByType` is updated to read from detail records when root-level counts are zero. The billing form auto-fill then uses correct per-type counts.

**Tech Stack:** React + TypeScript + Vite, Supabase (Postgres), no test framework for UI — `npx tsc --noEmit` is the compile gate.

## Global Constraints

- Currency: PHP — do not change any currency formatting
- No new npm packages
- All DB changes require a manual migration SQL block that the user runs in the Supabase SQL Editor
- TypeScript must pass `npx tsc --noEmit` after every task
- Follow existing code patterns (no CSS modules, no new abstractions)

---

## File Map

| File | Change |
|------|--------|
| `supabase_schema.sql` | Add `ticket_type` column to both tables |
| `src/types.ts` | Add `ticket_type` to `PositionTicketCategory`, `PositionFormValues.categories`, `DailyTicketEntryDetail` |
| `src/App.tsx` | Position category form UI + position save handler + `saveDraft` |
| `src/lib/supabaseData.ts` | Add `ticket_type` to details sub-select in `loadDailyTicketEntries` |
| `src/domain/billing.ts` | Update `countTicketsByType` to use details |
| `src/features/billing/BillingFeature.tsx` | Simplify auto-fill, remove fallback |

---

## Task 1: Schema + Types

**Files:**
- Modify: `supabase_schema.sql`
- Modify: `src/types.ts`

**Interfaces:**
- Produces: `PositionTicketCategory.ticket_type: "installation" | "repair"`, `DailyTicketEntryDetail.ticket_type: "installation" | "repair"`, `PositionFormValues.categories[n].ticket_type`

- [ ] **Step 1: Add `ticket_type` to `supabase_schema.sql`**

In `position_ticket_categories` table definition, add after the `status` column line:
```sql
  ticket_type text not null default 'installation' check (ticket_type in ('installation', 'repair')),
```

In `daily_ticket_entry_items` table definition, add after the `rate` column line:
```sql
  ticket_type text not null default 'installation' check (ticket_type in ('installation', 'repair')),
```

- [ ] **Step 2: Add `ticket_type` to `PositionTicketCategory` in `src/types.ts`**

Current (lines 31-41):
```ts
export type PositionTicketCategory = {
  id: string;
  user_id: string;
  position_id: string;
  name: string;
  rate: number;
  display_order: number;
  status: PositionStatus;
  created_at: string;
  updated_at: string;
};
```

Replace with:
```ts
export type PositionTicketCategory = {
  id: string;
  user_id: string;
  position_id: string;
  name: string;
  rate: number;
  ticket_type: "installation" | "repair";
  display_order: number;
  status: PositionStatus;
  created_at: string;
  updated_at: string;
};
```

- [ ] **Step 3: Add `ticket_type` to `PositionFormValues.categories` in `src/types.ts`**

Current `PositionFormValues.categories` array item:
```ts
categories: Array<{
  id?: string;
  name: string;
  rate: string;
  status: PositionStatus;
}>;
```

Replace with:
```ts
categories: Array<{
  id?: string;
  name: string;
  rate: string;
  ticket_type: "installation" | "repair";
  status: PositionStatus;
}>;
```

- [ ] **Step 4: Add `ticket_type` to `DailyTicketEntryDetail` in `src/types.ts`**

Current (lines 301-311):
```ts
export type DailyTicketEntryDetail = {
  id: string;
  user_id: string;
  daily_ticket_entry_id: string;
  position_ticket_category_id: string | null;
  category_name: string;
  ticket_count: number;
  rate: number;
  created_at: string;
  updated_at: string;
};
```

Replace with:
```ts
export type DailyTicketEntryDetail = {
  id: string;
  user_id: string;
  daily_ticket_entry_id: string;
  position_ticket_category_id: string | null;
  category_name: string;
  ticket_count: number;
  rate: number;
  ticket_type: "installation" | "repair";
  created_at: string;
  updated_at: string;
};
```

- [ ] **Step 5: Run type check**

```
npx tsc --noEmit
```

Expected: errors about `ticket_type` missing in `PositionFormValues` usages and `buildDetailPayloads` — that's fine, they'll be fixed in later tasks. If there are OTHER unrelated errors, stop and fix them first.

- [ ] **Step 6: Note migration SQL for user**

The user must run this in the Supabase SQL Editor before the app works end-to-end:
```sql
ALTER TABLE public.position_ticket_categories
  ADD COLUMN IF NOT EXISTS ticket_type text NOT NULL DEFAULT 'installation'
  CHECK (ticket_type IN ('installation', 'repair'));

ALTER TABLE public.daily_ticket_entry_items
  ADD COLUMN IF NOT EXISTS ticket_type text NOT NULL DEFAULT 'installation'
  CHECK (ticket_type IN ('installation', 'repair'));
```

---

## Task 2: Position Category Form UI + Save

**Files:**
- Modify: `src/App.tsx` (position form rendering ~line 1819, position save handler)

**Interfaces:**
- Consumes: `PositionFormValues.categories[n].ticket_type` from Task 1
- Produces: categories saved to DB with `ticket_type` field

- [ ] **Step 1: Find the position form category row in `src/App.tsx`**

Search for `"Category name"` (the `aria-label`). It's around line 1819. The inline-fields div renders: name input, MoneyInput for rate, status select, remove button.

- [ ] **Step 2: Add `ticket_type` select to the category row**

Inside the same `<div className="inline-fields">`, add a select between the rate MoneyInput and the status select:

```tsx
<select
  aria-label="Ticket type"
  value={category.ticket_type}
  onChange={(event) =>
    setValues({
      ...values,
      categories: values.categories.map((item, itemIndex) =>
        itemIndex === index
          ? { ...item, ticket_type: event.target.value as "installation" | "repair" }
          : item,
      ),
    })
  }
>
  <option value="installation">Installation</option>
  <option value="repair">Repair</option>
</select>
```

- [ ] **Step 3: Fix the "Add category" default to include `ticket_type`**

Find the "Add category" button's `onClick`. Currently it appends:
```ts
{ name: "", rate: "", status: "active" }
```

Change to:
```ts
{ name: "", rate: "", ticket_type: "installation" as const, status: "active" }
```

- [ ] **Step 4: Find where categories are initialized from an existing position**

Search for where `values` is initialized with an existing position's categories (the edit form). It maps `position.categories` to `PositionFormValues`. Find that map and add `ticket_type: category.ticket_type ?? "installation"` to the mapped object.

- [ ] **Step 5: Find where categories are saved to DB**

Search for `.from("position_ticket_categories")` in `src/App.tsx`. The save handler maps `values.categories` to DB rows. Find the mapped object (it will have `name`, `rate`, `status`) and add `ticket_type: category.ticket_type` to it.

- [ ] **Step 6: Run type check**

```
npx tsc --noEmit
```

Expected: clean or only errors from tasks not yet done (Tasks 3-5).

---

## Task 3: Denormalize `ticket_type` into Daily Ticket Entry Items

**Files:**
- Modify: `src/App.tsx` — `saveDraft` function (~line 2033) and `headerPayload`

**Interfaces:**
- Consumes: `PositionTicketCategory.ticket_type` from Task 1
- Produces: `daily_ticket_entry_items` rows saved with `ticket_type`; `daily_ticket_entries` header with correct `installation_tickets` / `repair_tickets`

- [ ] **Step 1: Update `buildDetailPayloads` to include `ticket_type`**

Find the `buildDetailPayloads` function inside `saveDraft` (~line 2051). Currently the returned object is:
```ts
{
  id: existingDetail?.id ?? crypto.randomUUID(),
  user_id: userId,
  daily_ticket_entry_id: dailyTicketEntryId,
  position_ticket_category_id: category.id,
  category_name: category.name,
  ticket_count: normalizeTicketCount(draft.counts[category.id]),
  rate: toNumber(existingDetail?.rate ?? category.rate),
}
```

Add `ticket_type`:
```ts
{
  id: existingDetail?.id ?? crypto.randomUUID(),
  user_id: userId,
  daily_ticket_entry_id: dailyTicketEntryId,
  position_ticket_category_id: category.id,
  category_name: category.name,
  ticket_count: normalizeTicketCount(draft.counts[category.id]),
  rate: toNumber(existingDetail?.rate ?? category.rate),
  ticket_type: category.ticket_type ?? "installation",
}
```

- [ ] **Step 2: Compute `installation_tickets` / `repair_tickets` from typed categories in `headerPayload`**

Find the `headerPayload` object inside `saveDraft` (~line 2038). Currently:
```ts
installation_tickets: 0,
repair_tickets: 0,
installation_rate: 0,
repair_rate: 0,
```

Replace with computed values. Add these lines **before** `headerPayload`:
```ts
const installCategories = activeCategories.filter((c) => (c.ticket_type ?? "installation") === "installation");
const repairCategories = activeCategories.filter((c) => c.ticket_type === "repair");
const computedInstall = installCategories.reduce((s, c) => s + normalizeTicketCount(draft.counts[c.id]), 0);
const computedRepair = repairCategories.reduce((s, c) => s + normalizeTicketCount(draft.counts[c.id]), 0);
const installRate = installCategories[0] ? toNumber(installCategories[0].rate) : 0;
const repairRate = repairCategories[0] ? toNumber(repairCategories[0].rate) : 0;
```

Then in `headerPayload`:
```ts
installation_tickets: computedInstall,
repair_tickets: computedRepair,
installation_rate: installRate,
repair_rate: repairRate,
```

- [ ] **Step 3: Run type check**

```
npx tsc --noEmit
```

Expected: clean or only errors from tasks 4-5.

---

## Task 4: Update Data Loading + `countTicketsByType`

**Files:**
- Modify: `src/lib/supabaseData.ts` — `loadDailyTicketEntries`
- Modify: `src/domain/billing.ts` — `countTicketsByType`

**Interfaces:**
- Consumes: `DailyTicketEntryDetail.ticket_type` from Task 1
- Produces: `countTicketsByType` correctly returns install/repair split using details

- [ ] **Step 1: Add `ticket_type` to the details sub-select in `loadDailyTicketEntries`**

In `src/lib/supabaseData.ts`, find the select string in `loadDailyTicketEntries` (~line 276):
```
details:daily_ticket_entry_items(id,user_id,daily_ticket_entry_id,position_ticket_category_id,category_name,ticket_count,rate,created_at,updated_at)
```

Add `ticket_type` before `created_at`:
```
details:daily_ticket_entry_items(id,user_id,daily_ticket_entry_id,position_ticket_category_id,category_name,ticket_count,rate,ticket_type,created_at,updated_at)
```

- [ ] **Step 2: Update `countTicketsByType` in `src/domain/billing.ts`**

Current implementation (lines 27-40) only reads root-level `installation_tickets`/`repair_tickets`. Replace the function body to use details when root-level fields are zero:

```ts
export function countTicketsByType(
  entries: DailyTicketEntry[],
  month: number,
  year: number,
  period?: BillingPeriod,
): { installation: number; repair: number } {
  return filterByPeriod(entries, month, year, period).reduce(
    (acc, entry) => {
      // Root-level fields are populated by legacy entries; use them when available
      if (entry.installation_tickets > 0 || entry.repair_tickets > 0) {
        return {
          installation: acc.installation + entry.installation_tickets,
          repair: acc.repair + entry.repair_tickets,
        };
      }
      // Position-based entries: sum from typed details
      const installation = (entry.details ?? [])
        .filter((d) => (d.ticket_type ?? "installation") === "installation")
        .reduce((s, d) => s + d.ticket_count, 0);
      const repair = (entry.details ?? [])
        .filter((d) => d.ticket_type === "repair")
        .reduce((s, d) => s + d.ticket_count, 0);
      return {
        installation: acc.installation + installation,
        repair: acc.repair + repair,
      };
    },
    { installation: 0, repair: 0 },
  );
}
```

- [ ] **Step 3: Run type check**

```
npx tsc --noEmit
```

Expected: clean or only errors from task 5.

---

## Task 5: Simplify Billing Form Auto-Fill

**Files:**
- Modify: `src/features/billing/BillingFeature.tsx`

**Interfaces:**
- Consumes: `countTicketsByType` (now correct) from Task 4

- [ ] **Step 1: Remove the `countTicketsForMonth` fallback from the initial state IIFE**

Find the IIFE in `BillingForm` that computes default values. It currently has:
```ts
const typed = countTicketsByType(dailyTicketEntries, defaultMonth, defaultYear, period);
const fallbackTotal = countTicketsForMonth(dailyTicketEntries, defaultMonth, defaultYear, period);
const hasTyped = typed.installation > 0 || typed.repair > 0;
return {
  ...
  install_tickets: hasTyped ? String(typed.installation) : String(fallbackTotal),
  repair_tickets: hasTyped ? String(typed.repair) : "0",
  ...
};
```

Simplify to:
```ts
const counts = countTicketsByType(dailyTicketEntries, defaultMonth, defaultYear, period);
return {
  ...
  install_tickets: String(counts.installation),
  repair_tickets: String(counts.repair),
  ...
};
```

- [ ] **Step 2: Simplify the `useEffect` auto-fill**

Find the `useEffect` that sets `install_tickets`/`repair_tickets`. It currently has a `fallbackTotal` + `hasTyped` guard. Simplify to:

```ts
useEffect(() => {
  if (initial) return;
  const month = Number(values.billing_month);
  const year = Number(values.billing_year);
  const counts = countTicketsByType(dailyTicketEntries, month, year, values.billing_period);
  setValues((prev) => ({
    ...prev,
    install_tickets: String(counts.installation),
    repair_tickets: String(counts.repair),
  }));
}, [values.billing_month, values.billing_year, values.billing_period]);
```

- [ ] **Step 3: Simplify the reference panel computed variables**

Find the `employeeCounts`, `employeeTotal`, `employeeInstall`, `employeeRepair` variables (4 vars) and replace with:

```ts
const employeeCounts = countTicketsByType(
  dailyTicketEntries,
  Number(values.billing_month),
  Number(values.billing_year),
  values.billing_period,
);
```

Then update the reference panel JSX to use `employeeCounts.installation`, `employeeCounts.repair`, `employeeCounts.installation + employeeCounts.repair`.

- [ ] **Step 4: Remove unused `countTicketsForMonth` import**

Check if `countTicketsForMonth` is still imported at the top of the file. If so, remove it from the import line.

- [ ] **Step 5: Run type check**

```
npx tsc --noEmit
```

Expected: clean — no errors.

---

## Migration Note (User Action Required)

After all code tasks are done, the user must run this SQL in the Supabase SQL Editor:

```sql
ALTER TABLE public.position_ticket_categories
  ADD COLUMN IF NOT EXISTS ticket_type text NOT NULL DEFAULT 'installation'
  CHECK (ticket_type IN ('installation', 'repair'));

ALTER TABLE public.daily_ticket_entry_items
  ADD COLUMN IF NOT EXISTS ticket_type text NOT NULL DEFAULT 'installation'
  CHECK (ticket_type IN ('installation', 'repair'));
```

Existing categories and entries will default to `'installation'`. Users should then go to **Settings → Positions**, edit each position's categories, and set the correct type (Installation / Repair) for each.

---

## Verification

1. Run migration SQL in Supabase
2. `npm run dev` → navigate to **Positions** → edit a position → each category row now shows a type selector (Installation / Repair)
3. Set some categories to "Repair" → save
4. Navigate to **Daily Tickets** → enter tickets for that position on today's date → save
5. Navigate to **Billing** → click "New Billing" → the Install and Repair inputs should auto-fill correctly from the typed categories
6. The reference panel shows non-zero Install and Repair values separately
7. `npx tsc --noEmit` → no errors
