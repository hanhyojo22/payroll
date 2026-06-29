# Subcontractor Billing

## Context

The business bills clients for work done by subcontractors. Each subcontractor performs installation and repair jobs. The business invoices the client for all tickets, pays the subcontractor a configurable percentage (default 70%), and keeps the remainder as collection (default 30%). Each subcontractor can have different rates and split percentages.

## Data Model

### `subcontractors` table

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | |
| user_id | uuid FK → auth.users | Owner |
| name | text | Subcontractor name |
| installation_rate | numeric(12,2) | PHP per installation ticket |
| repair_rate | numeric(12,2) | PHP per repair ticket |
| payable_pct | integer | % paid to subcon (default 70) |
| status | text | "active" or "archived" |
| created_at | timestamptz | |
| updated_at | timestamptz | |

RLS: `auth.uid() = user_id`. Unique constraint on `(user_id, name)`.

### `billing_subcon_items` table

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | |
| user_id | uuid FK → auth.users | Owner |
| billing_record_id | uuid FK → billing_records | Parent billing record |
| subcontractor_id | uuid FK → subcontractors | Which subcon |
| subcon_name | text | Snapshot of name at creation time |
| install_tickets | integer | Installation ticket count |
| repair_tickets | integer | Repair ticket count |
| disputed_install | integer | Disputed installation tickets |
| disputed_repair | integer | Disputed repair tickets |
| installation_rate | numeric(12,2) | Rate snapshot |
| repair_rate | numeric(12,2) | Rate snapshot |
| billable_tickets | integer | Computed: total - disputed |
| billing_amount | numeric(12,2) | Computed: billable × rates |
| payable_pct | integer | Snapshot of split % |
| payable_amount | numeric(12,2) | billing_amount × payable_pct / 100 |
| collection_amount | numeric(12,2) | billing_amount - payable_amount |
| created_at | timestamptz | |

RLS: `auth.uid() = user_id`.

## TypeScript Types

```ts
type Subcontractor = {
  id: string;
  user_id: string;
  name: string;
  installation_rate: number;
  repair_rate: number;
  payable_pct: number;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
};

type BillingSubconItem = {
  id: string;
  user_id: string;
  billing_record_id: string;
  subcontractor_id: string;
  subcon_name: string;
  install_tickets: number;
  repair_tickets: number;
  disputed_install: number;
  disputed_repair: number;
  installation_rate: number;
  repair_rate: number;
  billable_tickets: number;
  billing_amount: number;
  payable_pct: number;
  payable_amount: number;
  collection_amount: number;
  created_at: string;
};
```

Add `subcon_items: BillingSubconItem[]` to `BillingRecord` type.

## UI Changes

### 1. Subcontractor Management (inside Billing Settings modal)

Add a "Subcontractors" section to the existing Billing Settings panel:
- List of subcontractors with name, install rate, repair rate, payable %
- Add button to create new subcontractor
- Edit/archive actions per row
- Inline form: name, installation rate, repair rate, payable % (collection % auto-calculated as 100 - payable)

### 2. Create/Edit Billing Form (updated)

After month/year/period selectors, show a subcontractor section:
- For each active subcontractor, a row with:
  - Subcon name (read-only)
  - Install tickets (input)
  - Repair tickets (input)
  - Disputed install (input)
  - Disputed repair (input)
  - Computed: billable, billing amount, payable, collection (read-only)
- Totals row at bottom summing all subcons
- The billing record's `billing_amount`, `collections_amount`, `collectibles_amount` are the sums across all subcon items

### 3. Billing Table (updated)

- Table shows totals as before
- Each row is expandable — clicking shows per-subcontractor breakdown:
  - Subcon name, install, repair, disputed, billable, amount, payable, collection

## Computation Logic

Per subcontractor item:
```
billable_install = install_tickets - disputed_install
billable_repair = repair_tickets - disputed_repair
billable_tickets = billable_install + billable_repair
billing_amount = billable_install × installation_rate + billable_repair × repair_rate
payable_amount = round(billing_amount × payable_pct / 100, 2)
collection_amount = billing_amount - payable_amount
```

Billing record totals:
```
total_tickets = sum of all subcon (install + repair)
disputed_tickets = sum of all subcon (disputed_install + disputed_repair)
billable_tickets = sum of all subcon billable_tickets
billing_amount = sum of all subcon billing_amount
collections_amount = sum of all subcon collection_amount
collectibles_amount = sum of all subcon payable_amount
```

Note: `collectibles_amount` maps to what's payable to subcons. `collections_amount` maps to what the business keeps.

## Resource Loading

- Add `subcontractors` to `ResourceKey` union type
- Add to `viewResources` for billing view
- Load via `loadSubcontractors()` in supabaseData.ts

## Files to Create/Modify

| File | Change |
|------|--------|
| `src/types.ts` | Add `Subcontractor`, `BillingSubconItem` types; add `subcon_items` to `BillingRecord` |
| `src/domain/billing.ts` | Add `computeSubconBilling()` function |
| `src/features/billing/billingRepository.ts` | Add subcontractor CRUD; update billing record select to include subcon items |
| `src/features/billing/BillingFeature.tsx` | Subcon management in settings; subcon rows in billing form; expandable table rows |
| `src/lib/supabaseData.ts` | Add `loadSubcontractors()` |
| `src/App.tsx` | Add subcontractors state, resource loading, pass to BillingFeature |
| `supabase_schema.sql` | Add `subcontractors` and `billing_subcon_items` tables |
| `src/styles.css` | Styles for subcon form rows, expandable table |

## Verification

1. `npx tsc --noEmit` passes
2. `npm test` passes
3. Can add/edit/archive subcontractors in settings
4. Creating billing shows subcon rows with ticket inputs
5. Computed amounts update live as tickets are entered
6. Billing table shows totals; expanding shows per-subcon breakdown
7. Edit billing pre-fills subcon ticket counts
