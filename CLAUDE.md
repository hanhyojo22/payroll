# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Single-admin payroll management system for a Philippine services business. Tracks employees, daily closed-ticket counts, twice-monthly payroll runs, payment reminders (loans/bills), collections (receivables), and salary bonds (advances/loans to employees). Built with React + TypeScript + Vite, backed by Supabase (Postgres + Auth + RLS).

## Commands

- `npm run dev` — start Vite dev server
- `npm run build` — type-check then build (`tsc --noEmit && vite build`)
- `npm test` — run all tests (`vitest run --config vitest.config.ts`)
- `npx vitest run src/domain/payroll.test.ts` — run a single test file

## Architecture

### Single-file UI (src/App.tsx)

The entire UI lives in one ~5000-line file. All views (Dashboard, Employees, Positions, Daily Tickets, Payroll, Payments, Collections, Salary Bonds, and their history variants) are React function components inside App.tsx. Navigation is handled via a `View` union type and `window.history.pushState` — there is no router library.

The `Workspace` component owns all application state and passes it down as props. Each view's required data is declared in the `viewResources` map; resources are loaded lazily when a view is navigated to. URL paths are defined in `viewPaths` and synced with `window.history.pushState`.

### Domain logic (src/domain/)

Pure computation, no Supabase dependency:
- **tickets.ts** — rate constants (installation=600, repair=200/250 by wage category), gross pay calculation, ticket count normalization.
- **payroll.ts** — builds payroll item payloads from employee + position + daily ticket entries. Handles three pay modes: `fixed` (half monthly salary per period), `ticket` (sum of category count × rate), `hybrid` (base + tickets). A fourth mode `legacy` is used when an employee has no position — it falls back to the employee's own `installation_rate`/`repair_rate` columns. Uses the rate snapshot from daily entries, not the current position rate.

Payroll period date ranges: `first_half` = days 1–15, `second_half` = days 16–end of month. This split is enforced in `dailyTicketEntriesForPayrollPeriod()`.

### Data layer (src/lib/)

- **supabaseData.ts** — all Supabase queries. Every query goes through `settle()` which wraps results with a 30-second timeout and normalizes errors. Returns `{ data, error, label }`.

Note: the `supabase` client (`src/supabase.ts`) is `null` when env vars are missing. `hasSupabaseConfig` guards this — the app shows a setup prompt instead of crashing.
- **offlineDb.ts** — IndexedDB-based offline cache with three stores: `resource_cache` (full resource snapshots), `pending_mutations` (queued writes), `sync_meta`. Mutations to the same record ID are coalesced (newer replaces older).
- **offlineSync.ts** — `flushPendingMutations()` replays queued mutations to Supabase when online. Supports composite operations (`payroll_group`, `payroll_items_group`) that write across multiple tables atomically.

### Offline-first pattern

All write operations in App.tsx check `navigator.onLine` and fall back to `queueMutation()`. On reconnect or window focus, `syncQueuedMutations()` flushes the queue.

Resource loading is two-phase: first hydrate from IndexedDB cache (instant, avoids blank screen), then refresh from Supabase in the background. The UI distinguishes these via `showSyncIndicator` (cache loaded, server refresh in progress) vs `showPageSkeleton` (no cached data yet, full loading state).

### Database (supabase_schema.sql)

All tables use RLS with `auth.uid() = user_id`. Key tables: `employees`, `positions`, `position_ticket_categories`, `daily_ticket_entries`, `daily_ticket_entry_items`, `payroll_runs`, `payroll_run_items`, `payroll_run_item_ticket_details`, `salary_bonds`, `payment_reminders`, `collection_reminders`. A migration block at the bottom auto-creates legacy positions from employees' old rate columns.

### Position pay modes

Positions define how an employee is compensated:
- **fixed** — monthly base salary, split in half per payroll period
- **ticket** — paid per closed ticket, rates defined by position_ticket_categories
- **hybrid** — half base salary + ticket earnings

Active employees must have an active position (enforced by DB trigger `validate_employee_position`).

## Environment

Requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env`. See `.env.example`. Currency is PHP (Philippine Peso), formatted with `Intl.NumberFormat("en-PH")`.

## Testing

Tests live alongside domain code as `*.test.ts` files. Only `src/domain/**/*.test.ts` files are included (configured in `vitest.config.ts`). Tests run in Node environment, no DOM. Domain tests cover payroll calculation logic — they do not touch Supabase or the UI.
