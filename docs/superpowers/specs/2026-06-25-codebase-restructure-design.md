# Codebase Restructure Design

**Date:** 2026-06-25
**Goal:** Decompose the App.tsx monolith, eliminate code duplication, and make it easy to add/maintain features — all following the extract-and-share pattern already proven with billing, collections, and expenses.

## Problems Addressed

1. **App.tsx is 5,833 lines** — 18+ view components, all app state, resource loading, utilities, navigation, and layout in one file.
2. **Massive duplication** — `currency`, `formatMoney`, `MoneyField`, `todayKey`, `monthNames`, `Notice` type, and `QueueOfflineMutation` type are each copy-pasted 3-4 times across App.tsx and feature files.
3. **Resource loading bottleneck** — adding a new resource requires editing 3 switch statements + 2 initial-state objects + `viewResources` + adding a `useState` (6+ places).
4. **No shared component library** — common patterns (money inputs, status badges, tables, form layouts) are reimplemented per feature.
5. **CSS is 4,885 lines of unorganized flat styles** — no grouping by feature.

## Approach: Extract & Share

Complete the feature extraction pattern. Add a shared utility/component layer. Refactor the resource system to be data-driven. No new dependencies.

## 1. Shared Layer (`src/shared/`)

### Utilities

| File | Exports | Currently duplicated in |
|---|---|---|
| `shared/utils/currency.ts` | `currency`, `formatMoney`, `toNumber` | App.tsx, BillingFeature, CollectionsFeature, ExpensesFeature |
| `shared/utils/dates.ts` | `todayKey`, `monthNames`, `currentMonth`, `currentYear`, `isBeforeToday`, `isToday` | App.tsx, BillingFeature, CollectionsFeature, ExpensesFeature |
| `shared/utils/phone.ts` | `normalizePhoneDigits`, `formatPhoneNumber` | App.tsx |
| `shared/utils/errors.ts` | `friendlyError` | App.tsx |

### Components

| File | Purpose | Currently duplicated in |
|---|---|---|
| `shared/components/MoneyField.tsx` | Money input with auto-formatting on blur | App.tsx (MoneyInput), BillingFeature (MoneyField), CollectionsFeature (MoneyField) |
| `shared/components/NoticeBanner.tsx` | Toast/notice bar (success/error) | App.tsx |
| `shared/components/Spinner.tsx` | Loading spinner | App.tsx |
| `shared/components/ConfirmDialog.tsx` | Delete/action confirmation modal | Reimplemented per view |
| `shared/components/StatusBadge.tsx` | Colored status pills (pending, paid, overdue, active, etc.) | Inline in multiple views |
| `shared/components/DataTable.tsx` | Reusable table with sort, search, filter columns | Pattern repeated in every view |
| `shared/components/FormLayout.tsx` | Form container, field groups, submit/cancel button row | Pattern repeated in every form |
| `shared/components/PageLayout.tsx` | Page header (title + action buttons) + filter bar + content area | Pattern repeated in every view |

### Types

`shared/types.ts` — all types from current `src/types.ts` plus shared types currently redefined in every feature:
- `Notice` (defined 4x)
- `QueueOfflineMutation` (defined 4x)
- `AppError`
- `ResourceKey`, `ResourceStatus`

## 2. Feature Extraction

Each feature folder follows the proven pattern: `*Feature.tsx` (view components) + `*Form.tsx` (forms, if any) + `*Repository.ts` (Supabase CRUD). Features receive data and callbacks as props from Workspace.

### Final feature structure

```
features/
├── billing/                  (already extracted)
│   ├── BillingFeature.tsx
│   ├── billingRepository.ts
│   └── subconTicketRepository.ts
├── collections/              (already extracted)
│   ├── CollectionsFeature.tsx
│   └── collectionRepository.ts
├── expenses/                 (already extracted)
│   ├── ExpensesFeature.tsx
│   └── expenseRepository.ts
├── employees/                (NEW — includes positions)
│   ├── EmployeesFeature.tsx        EmployeesView, EmployeeDetailsView
│   ├── EmployeeForm.tsx
│   ├── PositionsView.tsx           PositionsView, PositionForm, CompensationSetup
│   ├── employeeRepository.ts
│   └── positionRepository.ts
├── payroll/                  (NEW — includes salary bonds)
│   ├── PayrollFeature.tsx          PayrollView, PayrollHistoryView
│   ├── PayrollRunForm.tsx
│   ├── SalaryBondsView.tsx
│   ├── payrollRepository.ts
│   └── salaryBondRepository.ts
├── daily-tracking/           (NEW — tickets + attendance)
│   ├── DailyTicketsView.tsx        DailyTicketEntryView, SubconDailyTicketView, LegacyDailyTicketEntryView
│   ├── AttendanceView.tsx
│   ├── dailyTicketRepository.ts
│   └── attendanceRepository.ts
├── payments/                 (NEW)
│   ├── PaymentsFeature.tsx         PaymentsView, PaymentHistoryView
│   ├── PaymentForm.tsx
│   └── paymentRepository.ts
└── subcontractors/           (NEW)
    ├── SubcontractorsFeature.tsx
    └── subcontractorRepository.ts
```

### Grouping rationale

- **employees + positions** — positions define employee compensation; tightly coupled in the UI.
- **payroll + salary bonds** — salary bonds are payroll deductions; always viewed/managed alongside payroll.
- **daily-tracking (tickets + attendance)** — both are daily per-employee tracking; attendance feeds into daily-pay-mode payroll alongside tickets.

### What each feature receives (props contract)

Every feature component receives:
- Its relevant data arrays (e.g., `employees`, `positions` for the employees feature)
- `onChange: () => Promise<void>` — triggers a reload of the feature's resources
- `onQueueOfflineMutation: QueueOfflineMutation` — queues an offline write
- `setNotice: (notice: Notice) => void` — shows a toast
- `userId: string` — the authenticated user's ID

This is the same contract used by BillingFeature, CollectionsFeature, and ExpensesFeature today.

## 3. App Shell

After extraction, `App.tsx` contains only:

1. **`App()`** — session check, Supabase config guard, login gate (~40 lines)
2. **`Login()`** — auth form (~80 lines)
3. **`Workspace()`** — sidebar, content area, resource loading, view routing (~80 lines)

**Sidebar** is extracted to its own `Sidebar.tsx` file.

**Dashboard** view stays in App.tsx or moves to `app/Dashboard.tsx` — it's small and doesn't have its own data operations.

### Resource system refactor

Replace the three switch statements in `loadResource()` with a data-driven registry:

```ts
// app/resourceLoader.ts
type ResourceEntry<T> = {
  load: (supabase: SupabaseClient) => Promise<{ data: T; error: AppErrorLike | null }>;
  set: (data: T) => void;
};

const registry: Record<ResourceKey, ResourceEntry<unknown>> = {
  employees: { load: loadEmployees, set: setEmployees },
  positions: { load: loadPositions, set: setPositions },
  // ... one line per resource
};
```

`loadResource()` becomes ~20 lines instead of ~170:
- Read from cache → call `entry.set(cached)`
- Fetch from server → call `entry.load(supabase)` → call `entry.set(result.data)`
- Write to cache

Adding a new resource = add one line to the registry + one `useState` in Workspace.

## 4. CSS Organization

Keep `styles.css` as a single file. Reorganize with section headers:

```
/* ═══ FOUNDATION ═══ */          variables, resets, typography
/* ═══ SHARED COMPONENTS ═══ */   MoneyField, StatusBadge, DataTable, FormLayout, PageLayout
/* ═══ APP SHELL ═══ */           sidebar, layout, auth screens
/* ═══ DASHBOARD ═══ */
/* ═══ EMPLOYEES & POSITIONS ═══ */
/* ═══ DAILY TRACKING ═══ */
/* ═══ PAYROLL & SALARY BONDS ═══ */
/* ═══ PAYMENTS ═══ */
/* ═══ BILLING ═══ */
/* ═══ COLLECTIONS ═══ */
/* ═══ EXPENSES ═══ */
/* ═══ SUBCONTRACTORS ═══ */
```

No CSS code changes — just reorder and group existing rules.

## 5. Unchanged Layers

These are already well-structured and stay as-is:

- **`src/domain/`** — pure computation (payroll.ts, billing.ts, collections.ts, tickets.ts) + tests
- **`src/lib/`** — supabaseData.ts, offlineDb.ts, offlineSync.ts
- **`src/supabase.ts`** — client initialization
- **`supabase_schema.sql`** — database schema

## Migration Strategy

Incremental — the app works at every step:

1. Create `shared/` layer (extract duplicated utilities and components)
2. Update existing 3 features (billing, collections, expenses) to import from shared
3. Extract features one at a time from App.tsx (each extraction is independently shippable)
4. Refactor resource system to registry pattern
5. Extract Sidebar
6. Organize CSS sections
7. Clean up `src/pages/` re-exports (delete them — they're 1-line re-exports that no longer serve a purpose once features are extracted) and `supabaseData.ts` (move remaining queries to their respective feature repositories; keep only `settle()`, `withTimeout()`, and `loadDashboardSummary` in the shared data layer)

## Expected Result

| Metric | Before | After |
|---|---|---|
| App.tsx | 5,833 lines | ~200 lines |
| Largest file | 5,833 lines (App.tsx) | ~740 lines (BillingFeature.tsx) |
| Code duplication | 4x for currency/money/dates | 0 (shared imports) |
| Places to edit for new resource | 6+ | 2 (registry + useState) |
| Feature folders | 3 | 8 |
| Shared components | 0 | 8 |
