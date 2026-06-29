# Expenses Tracking

## Context

The business needs to track employee expenses (gasoline, food, transportation, etc.) for reporting purposes. Expenses are not deducted from payroll or reimbursed — they are recorded for visibility only.

## Data Model

### `expense_categories` table

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | |
| user_id | uuid FK → auth.users | Owner |
| name | text | Category name (e.g., Gasoline, Food) |
| status | text | "active" or "archived" |
| created_at | timestamptz | |
| updated_at | timestamptz | |

RLS: `auth.uid() = user_id`. Unique constraint on `(user_id, name)`.

### `expenses` table

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | |
| user_id | uuid FK → auth.users | Owner |
| employee_id | uuid FK → employees | Which employee |
| employee_name | text | Snapshot of name at creation |
| category_id | uuid FK → expense_categories | Which category |
| category_name | text | Snapshot of category name |
| amount | numeric(12,2) | Expense amount in PHP |
| expense_date | date | When the expense occurred |
| notes | text | Optional description |
| created_at | timestamptz | |
| updated_at | timestamptz | |

RLS: `auth.uid() = user_id`.

## TypeScript Types

```ts
type ExpenseCategory = {
  id: string;
  user_id: string;
  name: string;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
};

type Expense = {
  id: string;
  user_id: string;
  employee_id: string;
  employee_name: string;
  category_id: string;
  category_name: string;
  amount: number;
  expense_date: string;
  notes: string;
  created_at: string;
  updated_at: string;
};
```

## UI

### Navigation

Add "Expenses" to the Finance section in the sidebar, between Billing and Subcontractors.

### Expenses Page

**Header:** Title "Expenses" with "Add expense" button.

**Filters:**
- Employee dropdown (filter by employee, or "All employees")
- Month/year selector

**Summary:** Total expenses for the current filter.

**Table:** Columns: Date, Employee, Category, Amount, Notes, Actions (edit, delete).

### Add/Edit Expense Modal

Fields:
- Employee (dropdown of active employees)
- Category (dropdown of active expense categories)
- Amount (MoneyInput)
- Date (date picker)
- Notes (textarea, optional)

### Expense Categories Management

Inside a settings modal on the Expenses page (similar to Billing Settings pattern):
- List of categories with edit/archive actions
- Add category form: name field

## Resource Loading

- Add `expenses` and `expenseCategories` to `ResourceKey`
- Add to `viewResources` for expenses view
- Load via `loadExpenses()` and `loadExpenseCategories()` in supabaseData.ts

## Files to Create/Modify

| File | Change |
|------|--------|
| `src/types.ts` | Add `ExpenseCategory`, `Expense` types; add to `ResourceKey` |
| `src/features/expenses/expenseRepository.ts` | CRUD for expenses and categories |
| `src/features/expenses/ExpensesFeature.tsx` | Expenses page UI, category management |
| `src/lib/supabaseData.ts` | Add loaders |
| `src/App.tsx` | State, resource loading, nav item, view rendering |
| `supabase_schema.sql` | Add tables |
| `src/styles.css` | Reuse billing page styles (billing-page, billing-table, etc.) |

## Verification

1. `npx tsc --noEmit` passes
2. `npm test` passes
3. Can add/edit/archive expense categories
4. Can add expenses for employees with category, amount, date
5. Table filters by employee and month
6. Summary shows total for current filter
7. Edit and delete actions work
