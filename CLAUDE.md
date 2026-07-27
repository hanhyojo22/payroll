# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Single-admin payroll management system for a Philippine services business. Tracks employees, daily closed-ticket counts, twice-monthly payroll runs, payment reminders (loans/bills), collections (receivables), salary bonds (advances/loans to employees), billing, subcontractors, expenses, and attendance. Built with React + TypeScript + Vite, backed by Supabase (Postgres + Auth + RLS).

## Commands

- `npm run dev` — start Vite dev server
- `npm run build` — type-check then build (`tsc --noEmit && vite build`)
- `npm test` — run all tests (`vitest run --config vitest.config.ts`)
- `npx vitest run src/domain/payroll.test.ts` — run a single test file

## Architecture

### App.tsx (~5800 lines)

The main UI file containing the `Workspace` component which owns all application state. Navigation uses a `View` union type with `window.history.pushState` — no router library. Each view's required data is declared in `viewResources`; resources are loaded lazily when navigated to. URL paths are in `viewPaths`.

Some views (Employees, Payroll, Daily Tickets) are defined inline in App.tsx. Others have been extracted into feature modules (see below) but are still rendered from within App.tsx's `Workspace`.

### Feature modules (src/features/)

Extracted feature areas follow a consistent pattern: a `*Feature.tsx` component + a `*Repository.ts` data-access file.

- **billing/** — `BillingFeature.tsx`, `billingRepository.ts`, `subconTicketRepository.ts`. Handles billing records, billing settings, and subcontractor daily tickets.
- **collections/** — `CollectionsFeature.tsx`, `collectionRepository.ts`. Receivables tracking with partial payments, aging buckets, archive/restore.
- **expenses/** — `ExpensesFeature.tsx`, `expenseRepository.ts`. Employee expense tracking with categories.

Each feature component receives state and callbacks as props from `Workspace` (data arrays, `onChange` reload function, `onQueueOfflineMutation`, `setNotice`, `userId`). Repository files contain Supabase CRUD operations that take a `SupabaseClient` as their first argument.

### Domain logic (src/domain/)

Pure computation, no Supabase dependency:
- **tickets.ts** — rate constants (installation=600, repair=200/250 by wage category), gross pay calculation, ticket count normalization.
- **payroll.ts** — builds payroll item payloads from employee + position + daily ticket entries. Handles pay modes: `fixed` (half monthly salary per period), `ticket` (sum of category count × rate), `hybrid` (base + tickets), `daily` (daily rate × days worked). A `legacy` mode is used when an employee has no position — it falls back to the employee's own `installation_rate`/`repair_rate` columns. Uses the rate snapshot from daily entries, not the current position rate.
- **billing.ts** — ticket counting by period, billing computation (billable tickets, billing amount, collections amount), subcontractor item computation.
- **collections.ts** — collection status derivation, balance calculation, aging bucket classification, payment validation.

Payroll period date ranges: `first_half` = days 1–15, `second_half` = days 16–end of month.

### Data layer (src/lib/)

- **supabaseData.ts** — all shared Supabase queries (feature-specific queries live in their repository files). Every query goes through `settle()` which wraps results with a 30-second timeout and normalizes errors. Returns `{ data, error, label }`.
- **offlineDb.ts** — IndexedDB-based offline cache with three stores: `resource_cache` (full resource snapshots), `pending_mutations` (queued writes), `sync_meta`. Mutations to the same record ID are coalesced (newer replaces older).
- **offlineSync.ts** — `flushPendingMutations()` replays queued mutations to Supabase when online. Supports composite operations (`payroll_group`, `payroll_items_group`) that write across multiple tables atomically.

Note: the `supabase` client (`src/supabase.ts`) is `null` when env vars are missing. `hasSupabaseConfig` guards this — the app shows a setup prompt instead of crashing.

### Offline-first pattern

All write operations check `navigator.onLine` and fall back to `queueMutation()`. On reconnect or window focus, `syncQueuedMutations()` flushes the queue.

Resource loading is two-phase: first hydrate from IndexedDB cache (instant, avoids blank screen), then refresh from Supabase in the background. The UI distinguishes these via `showSyncIndicator` (cache loaded, server refresh in progress) vs `showPageSkeleton` (no cached data yet, full loading state).

### Types (src/types.ts)

All shared TypeScript types are centralized here. Includes both database row types and `*FormValues` types (which use `string` for numeric fields to support form input).

### Database (supabase_schema.sql)

All tables use RLS with `auth.uid() = user_id`. Key tables include: `employees`, `positions`, `position_ticket_categories`, `daily_ticket_entries`, `daily_ticket_entry_items`, `payroll_runs`, `payroll_run_items`, `payroll_run_item_ticket_details`, `salary_bonds`, `payment_reminders`, `collection_reminders`, `collection_payments`, `billing_records`, `billing_subcon_items`, `billing_settings`, `subcontractors`, `subcon_daily_tickets`, `expenses`, `expense_categories`, `attendance_entries`.

### Position pay modes

Positions define how an employee is compensated:
- **fixed** — monthly base salary, split in half per payroll period
- **ticket** — paid per closed ticket, rates defined by `position_ticket_categories`
- **hybrid** — half base salary + ticket earnings
- **daily** — daily rate × days worked (from attendance entries)

Active employees must have an active position (enforced by DB trigger `validate_employee_position`).

### Styling (src/styles.css)

Single CSS file using CSS custom properties. Apple-inspired design system with `--color-*`, `--font-size-*` variables. No CSS modules or CSS-in-JS.

### Pages directory (src/pages/)

Thin re-export wrappers (e.g., `EmployeesPage.tsx` re-exports from App.tsx). These exist for routing/code-splitting but contain no logic.

## Environment

Requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env`. See `.env.example`. Currency is PHP (Philippine Peso), formatted with `Intl.NumberFormat("en-PH")`.

## Testing

Tests live alongside the code they cover as `*.test.ts` / `*.test.tsx` files; `src/**/*.test.{ts,tsx}` is included (configured in `vitest.config.ts`).

The default environment is Node with no DOM. Component/hook tests opt into jsdom per file with a `// @vitest-environment jsdom` docblock (see `src/shared/components/useDialog.test.tsx`), so the domain suite stays DOM-free and fast.

Coverage today:
- `src/domain/**` — payroll, billing, collections, expenses, salary bond and payment reminder calculations. No Supabase, no UI.
- `src/lib/offlineDb.test.ts` — offline mutation queue coalescing and sign-out cache clearing, run against `fake-indexeddb`.
- `src/lib/offlineSync.test.ts` — offline-vs-server error classification.
- `src/shared/**` — `friendlyError` message mapping, and the `useDialog` modal accessibility hook.
