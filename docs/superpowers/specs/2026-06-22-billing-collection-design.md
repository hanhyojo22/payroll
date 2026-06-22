# Billing & Collection Integration

## Summary

Add a monthly billing system that invoices one client based on total tickets closed. The admin enters disputed ticket counts, the system computes the billing amount (billable tickets × rate), splits it 70/30 into Collections and Collectibles, and auto-creates a `collection_reminder` receivable for the 70% portion. The billing rate and split percentage are global settings.

## Data Model

### billing_settings (one row per user)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | default gen_random_uuid() |
| user_id | uuid FK → auth.users | RLS owner, unique, on delete cascade |
| billing_rate | numeric(12,2) | PHP per ticket (e.g., 1500.00), default 0 |
| collections_pct | integer | Default 70, check between 0 and 100 |
| client_name | text | The single client all tickets bill to, default '' |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

Constraints: unique on `(user_id)`. RLS: `auth.uid() = user_id`. Auto-created with defaults on first access.

### billing_records (one row per billing month)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | default gen_random_uuid() |
| user_id | uuid FK → auth.users | RLS owner, on delete cascade |
| billing_month | integer | 1-12, check between 1 and 12 |
| billing_year | integer | check between 1900 and 2200 |
| total_tickets | integer | Auto-counted from daily_ticket_entries, check >= 0 |
| disputed_tickets | integer | Admin-entered, check >= 0 |
| billable_tickets | integer | total - disputed, check >= 0 |
| billing_rate | numeric(12,2) | Snapshot of rate at creation, check >= 0 |
| billing_amount | numeric(12,2) | billable_tickets × billing_rate, check >= 0 |
| collections_pct | integer | Snapshot (e.g., 70), check between 0 and 100 |
| collections_amount | numeric(12,2) | billing_amount × collections_pct / 100, check >= 0 |
| collectibles_amount | numeric(12,2) | billing_amount - collections_amount, check >= 0 |
| collection_id | uuid FK → collection_reminders | Auto-created receivable, on delete set null |
| notes | text | default '' |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

Constraints:
- Unique on `(user_id, billing_month, billing_year)` — one billing per month.
- RLS: `auth.uid() = user_id`.
- Indexes: `(user_id, billing_year desc, billing_month desc)`.
- `set_updated_at` trigger.

## Billing Flow

When the admin creates a monthly billing:

1. System counts total tickets from `daily_ticket_entries` for the selected month/year — sum of all ticket counts across all employees, all categories (using `daily_ticket_entry_items.ticket_count` where available, falling back to `installation_tickets + repair_tickets` on legacy entries).
2. Admin sees the total and enters the **disputed ticket count**.
3. System computes:
   - `billable_tickets` = total_tickets - disputed_tickets
   - `billing_amount` = billable_tickets × billing_rate (from billing_settings)
   - `collections_amount` = billing_amount × collections_pct / 100
   - `collectibles_amount` = billing_amount - collections_amount
4. On save, system auto-creates a `collection_reminder` with:
   - `title`: "Billing [Month Name] [Year]" (e.g., "Billing June 2026")
   - `client_name`: from billing_settings.client_name
   - `amount`: the collections_amount (70%)
   - `issue_date`: today
   - `due_date`: last day of the billing month
   - Linked back via `billing_records.collection_id`
5. The created receivable appears in the Collections view for payment tracking.

**Editing:** If a billing record is edited (disputes corrected), the linked collection_reminder's amount updates to match the new collections_amount. If the billing is deleted, the linked receivable is also deleted.

**Duplicate prevention:** Unique constraint on `(user_id, billing_month, billing_year)`.

## Billing Settings

- Accessible from the Billing view via a settings/gear icon
- Three fields: **Billing rate** (PHP per ticket), **Collections %** (default 70), **Client name**
- Stored in `billing_settings` — auto-created on first access with defaults
- Rate and percentage are snapshotted into each `billing_records` row so historical billings are preserved

## Billing UI View

Navigation: "Billing" in the sidebar with path `/billing`. New `View` value and `ResourceKey` entries.

**Table view:** All billing records sorted by year/month descending. Columns:
- Month/Year
- Total Tickets
- Disputed
- Billable Tickets
- Billing Amount
- Collections (70%)
- Collectibles (30%)
- Status (from the linked collection's payment status: pending/partial/collected/overdue)

**Create Billing form:**
- Select month/year (dropdowns)
- System auto-populates total tickets from daily_ticket_entries for that month
- Admin enters disputed ticket count
- Live preview shows: billable tickets, billing amount, collections (70%), collectibles (30%)
- Save creates billing_record + collection_reminder in one operation

**Detail view:** Clicking a billing row shows full breakdown with a link to the associated collection/receivable in the Collections view.

## Resource & Offline Support

- New `ResourceKey`: `"billingRecords"` and `"billingSettings"`
- `billingRecords` loaded for the Billing view
- `billingSettings` loaded for the Billing view
- Follows existing offline-first pattern: cache hydration → Supabase refresh
- Billing creation is a composite operation (creates billing_record + collection_reminder) — needs a `billing_group` operation in offlineSync similar to `payroll_group`

## Domain Logic

Pure functions in `src/domain/billing.ts`:
- `countTicketsForMonth(entries: DailyTicketEntry[], month: number, year: number): number` — sums all ticket counts for the month
- `computeBilling(totalTickets: number, disputedTickets: number, billingRate: number, collectionsPct: number): { billableTickets, billingAmount, collectionsAmount, collectiblesAmount }`
- Tests in `src/domain/billing.test.ts`

## File Structure

New files (not added to App.tsx monolith):
- `src/domain/billing.ts` — pure billing computation
- `src/domain/billing.test.ts` — domain tests
- `src/features/billing/BillingFeature.tsx` — billing view component (follows CollectionsFeature pattern)
- `src/features/billing/billingRepository.ts` — Supabase queries for billing (follows collectionRepository pattern)

Modified files:
- `supabase_schema.sql` — new tables
- `src/types.ts` — new types
- `src/App.tsx` — navigation, resource plumbing, view rendering (minimal — delegates to BillingFeature)
