# Codebase Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose the 5,833-line App.tsx monolith into focused feature modules with a shared component/utility layer, eliminating all code duplication and making features easy to add.

**Architecture:** Extract duplicated utilities and components into `src/shared/`. Move each view out of App.tsx into feature folders following the proven pattern from billing/collections/expenses (Feature.tsx + Form.tsx + Repository.ts). Replace the resource-loading switch statements with a data-driven registry. Extract sidebar into its own file.

**Tech Stack:** React 18, TypeScript (strict), Vite, Supabase, Vitest

## Global Constraints

- No new npm dependencies — use only what's already installed.
- All types use strict mode (`tsconfig.json` has `"strict": true`).
- Currency is PHP, formatted with `Intl.NumberFormat("en-PH")`.
- Every feature component receives data via props from Workspace — no global state management.
- The app must build (`npm run build`) and pass tests (`npm test`) after every task.
- Offline-first pattern: all writes check `navigator.onLine` and fall back to `queueMutation()`.

---

### Task 1: Create shared utilities

**Files:**
- Create: `src/shared/utils/currency.ts`
- Create: `src/shared/utils/dates.ts`
- Create: `src/shared/utils/phone.ts`
- Create: `src/shared/utils/errors.ts`
- Modify: `src/App.tsx` (delete duplicated utility functions, import from shared)
- Modify: `src/features/billing/BillingFeature.tsx` (delete duplicates, import from shared)
- Modify: `src/features/collections/CollectionsFeature.tsx` (delete duplicates, import from shared)
- Modify: `src/features/expenses/ExpensesFeature.tsx` (delete duplicates, import from shared)

**Interfaces:**
- Produces:
  - `currency: Intl.NumberFormat` — PHP currency formatter
  - `formatMoney(value: string | number): string` — formats number with commas and 2 decimal places
  - `toNumber(value: string | number): number` — coerce string to number, default 0
  - `todayKey(): string` — returns `YYYY-MM-DD` for today
  - `monthNames: string[]` — `["January", ..., "December"]`
  - `currentMonth(): string` — 1-indexed month as string
  - `currentYear(): string` — four-digit year as string
  - `isBeforeToday(date: string): boolean`
  - `isToday(date: string): boolean`
  - `normalizePhoneDigits(raw: string): string`
  - `formatPhoneNumber(raw: string): string`
  - `friendlyError(error: AppError | null | undefined, fallback?: string): string`

- [ ] **Step 1: Create `src/shared/utils/currency.ts`**

```ts
export const currency = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});

export const formatMoney = (value: string | number): string => {
  const num = typeof value === "string" ? parseFloat(value.replace(/,/g, "")) : value;
  if (isNaN(num) || num === 0) return "";
  return num.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export const toNumber = (value: string | number): number => Number(value || 0);
```

- [ ] **Step 2: Create `src/shared/utils/dates.ts`**

```ts
export const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const todayKey = (): string => new Date().toISOString().slice(0, 10);
export const currentMonth = (): string => String(new Date().getMonth() + 1);
export const currentYear = (): string => String(new Date().getFullYear());
export const isBeforeToday = (date: string): boolean => date < todayKey();
export const isToday = (date: string): boolean => date === todayKey();
```

- [ ] **Step 3: Create `src/shared/utils/phone.ts`**

```ts
export function normalizePhoneDigits(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("63") && d.length > 10) d = d.slice(2);
  if (d.startsWith("0") && d.length > 10) d = d.slice(1);
  return d.slice(0, 10);
}

export function formatPhoneNumber(raw: string): string {
  const d = normalizePhoneDigits(raw);
  if (d.length === 0) return "";
  if (d.length <= 4) return `+63 ${d}`;
  if (d.length <= 7) return `+63 ${d.slice(0, 4)} ${d.slice(4)}`;
  return `+63 ${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
}
```

- [ ] **Step 4: Create `src/shared/utils/errors.ts`**

Move the `friendlyError` function from `src/App.tsx:299-367` into this file. It needs the `AppError` type imported from shared types (created in Task 2).

```ts
type AppError = { message?: string; code?: string; details?: string | null };

export const friendlyError = (error: AppError | null | undefined, fallback = "Something went wrong. Please try again."): string => {
  // ... exact same body as App.tsx lines 300-367
};
```

Copy the full function body verbatim from `src/App.tsx` lines 299-367.

- [ ] **Step 5: Update `src/App.tsx` — delete duplicated utilities, import from shared**

Remove these from App.tsx:
- `const currency` (line 221-224)
- `const formatMoney` (line 226-230)
- `function normalizePhoneDigits` (lines 260-265)
- `function formatPhoneNumber` (lines 267-273)
- `const monthNames` (lines 275-288)
- `const todayKey` (line 290)
- `const currentMonth` (line 291)
- `const currentYear` (line 292)
- `const isBeforeToday` (line 293)
- `const isToday` (line 294)
- `const friendlyError` (lines 299-367)

Add at top of App.tsx:
```ts
import { currency, formatMoney, toNumber } from "./shared/utils/currency";
import { todayKey, monthNames, currentMonth, currentYear, isBeforeToday, isToday } from "./shared/utils/dates";
import { normalizePhoneDigits, formatPhoneNumber } from "./shared/utils/phone";
import { friendlyError } from "./shared/utils/errors";
```

Remove the `toNumber` import from `"./domain/tickets"` since it now comes from shared.

- [ ] **Step 6: Update `src/features/billing/BillingFeature.tsx` — delete duplicates, import from shared**

Remove these lines (29-40):
- `const currency = ...`
- `const fmtMoney = ...`
- `const monthNames = ...`
- `const currentMonth = ...`
- `const currentYear = ...`
- `const todayKey = ...`

Add imports:
```ts
import { currency, formatMoney } from "../../shared/utils/currency";
import { todayKey, monthNames, currentMonth, currentYear } from "../../shared/utils/dates";
```

Replace all uses of `fmtMoney` with `formatMoney` in this file.

- [ ] **Step 7: Update `src/features/collections/CollectionsFeature.tsx` — delete duplicates, import from shared**

Remove these lines (28-36):
- `const currency = ...`
- `const fmtMoney = ...`
- `const todayKey = ...`

Add imports:
```ts
import { currency, formatMoney } from "../../shared/utils/currency";
import { todayKey } from "../../shared/utils/dates";
```

Replace all uses of `fmtMoney` with `formatMoney` in this file.

- [ ] **Step 8: Update `src/features/expenses/ExpensesFeature.tsx` — delete duplicates, import from shared**

Remove these lines (12-17):
- `const currency = ...`
- `const monthNames = ...`
- `const currentMonth = ...`
- `const currentYear = ...`
- `const todayKey = ...`
- `const toNumber = ...`

Add imports:
```ts
import { currency, toNumber } from "../../shared/utils/currency";
import { todayKey, monthNames, currentMonth, currentYear } from "../../shared/utils/dates";
```

- [ ] **Step 9: Verify build and tests pass**

Run: `npm run build && npm test`
Expected: Both pass with no errors.

- [ ] **Step 10: Commit**

```bash
git add src/shared/utils/ src/App.tsx src/features/billing/BillingFeature.tsx src/features/collections/CollectionsFeature.tsx src/features/expenses/ExpensesFeature.tsx
git commit -m "refactor: extract shared utilities (currency, dates, phone, errors)"
```

---

### Task 2: Create shared types

**Files:**
- Create: `src/shared/types.ts`
- Modify: `src/types.ts` (re-export from shared)
- Modify: `src/App.tsx` (import Notice, QueueOfflineMutation, AppError from shared)
- Modify: `src/features/billing/BillingFeature.tsx` (delete local Notice/QueueOfflineMutation types)
- Modify: `src/features/collections/CollectionsFeature.tsx` (delete local types)
- Modify: `src/features/expenses/ExpensesFeature.tsx` (delete local types)

**Interfaces:**
- Produces:
  - `Notice = { type: "success" | "error"; text: string } | null`
  - `AppError = { message?: string; code?: string; details?: string | null }`
  - `QueueOfflineMutation = (mutation: Omit<PendingMutation, "id" | "createdAt" | "status" | "attempts" | "userId">) => Promise<void>`

- [ ] **Step 1: Create `src/shared/types.ts`**

```ts
import type { PendingMutation } from "../lib/offlineDb";

export type Notice = { type: "success" | "error"; text: string } | null;
export type AppError = { message?: string; code?: string; details?: string | null };
export type QueueOfflineMutation = (mutation: Omit<PendingMutation, "id" | "createdAt" | "status" | "attempts" | "userId">) => Promise<void>;
```

All domain/entity types stay in `src/types.ts` — only these shared UI types move to `src/shared/types.ts`.

- [ ] **Step 2: Update `src/App.tsx` — use shared types**

Remove the local type definitions:
- `type Notice = ...` (line 122)
- `type AppError = ...` (line 123)
- `type QueueOfflineMutation = ...` (line 124)

Add import:
```ts
import type { Notice, AppError, QueueOfflineMutation } from "./shared/types";
```

- [ ] **Step 3: Update `src/features/billing/BillingFeature.tsx` — use shared types**

Remove:
- `type Notice = ...` (line 26)
- `type QueueOfflineMutation = ...` (line 27)

Add import:
```ts
import type { Notice, QueueOfflineMutation } from "../../shared/types";
```

- [ ] **Step 4: Update `src/features/collections/CollectionsFeature.tsx` — use shared types**

Remove:
- `type Notice = ...` (line 23)
- `type QueueOfflineMutation = ...` (line 24)

Add import:
```ts
import type { Notice, QueueOfflineMutation } from "../../shared/types";
```

- [ ] **Step 5: Update `src/features/expenses/ExpensesFeature.tsx` — use shared types**

Remove:
- `type Notice = ...` (line 9)
- `type QueueOfflineMutation = ...` (line 10)

Add import:
```ts
import type { Notice, QueueOfflineMutation } from "../../shared/types";
```

- [ ] **Step 6: Update `src/shared/utils/errors.ts` — import AppError from shared types**

Replace the local `type AppError` with:
```ts
import type { AppError } from "../types";
```

- [ ] **Step 7: Verify build and tests pass**

Run: `npm run build && npm test`
Expected: Both pass with no errors.

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts src/shared/utils/errors.ts src/App.tsx src/features/billing/BillingFeature.tsx src/features/collections/CollectionsFeature.tsx src/features/expenses/ExpensesFeature.tsx
git commit -m "refactor: extract shared types (Notice, AppError, QueueOfflineMutation)"
```

---

### Task 3: Create shared components

**Files:**
- Create: `src/shared/components/MoneyField.tsx`
- Create: `src/shared/components/NoticeBanner.tsx`
- Create: `src/shared/components/Spinner.tsx`
- Create: `src/shared/components/StatusBadge.tsx`
- Create: `src/shared/components/DataTable.tsx`
- Create: `src/shared/components/PageLayout.tsx`
- Create: `src/shared/components/FormLayout.tsx`
- Modify: `src/App.tsx` (delete local components, import from shared)
- Modify: `src/features/billing/BillingFeature.tsx` (delete local MoneyField, import from shared)
- Modify: `src/features/collections/CollectionsFeature.tsx` (delete local MoneyField, import from shared)

**Interfaces:**
- Consumes: `formatMoney` from `shared/utils/currency`
- Produces:
  - `MoneyField` component — `{ label?: string; value: string; onChange: (v: string) => void; required?: boolean; placeholder?: string }`
  - `NoticeBanner` component — `{ notice: Notice; onDismiss: () => void }`
  - `Spinner` component — `{ size?: "small" | "default" }`
  - `StatusBadge` component — `{ status: string }`
  - `DataTable` component — `{ empty: string; headers: string[]; rows: ReactNode[][]; onRowClick?: (rowIndex: number) => void }`
  - `PageHeader` component — `{ eyebrow: string; title: string; text: string; action?: ReactNode }`
  - `Toolbar` component — `{ query: string; setQuery: (q: string) => void; children?: ReactNode }`
  - `Modal` component — `{ onClose: () => void; title: string; children: ReactNode }`
  - `FormActions` component — `{ busy: boolean; onClose: () => void }`
  - `TextField` component — standard text input with label

- [ ] **Step 1: Create `src/shared/components/MoneyField.tsx`**

```tsx
import { useEffect, useState } from "react";
import { formatMoney } from "../utils/currency";

export function MoneyField({ label, value, onChange, required, placeholder }: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
}) {
  const [display, setDisplay] = useState(formatMoney(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDisplay(formatMoney(value));
  }, [value, focused]);

  const input = (
    <input
      type="text"
      inputMode="decimal"
      value={focused ? value : display}
      placeholder={placeholder ?? "0.00"}
      required={required}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); setDisplay(formatMoney(value)); }}
      onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
    />
  );

  if (label) return <label>{label}{input}</label>;
  return input;
}
```

- [ ] **Step 2: Create `src/shared/components/NoticeBanner.tsx`**

Move `NoticeBanner` from `src/App.tsx:1245-1272` into this file.

```tsx
import { useEffect } from "react";
import { X } from "lucide-react";
import type { Notice } from "../types";

export function NoticeBanner({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  useEffect(() => {
    if (notice?.type !== "success") return;
    const timeout = window.setTimeout(onDismiss, 3000);
    return () => window.clearTimeout(timeout);
  }, [notice, onDismiss]);

  if (!notice) return null;

  return (
    <div className={`notice ${notice.type}`} role={notice.type === "error" ? "alert" : "status"}>
      <div>
        <strong>{notice.type === "error" ? "Action needed" : "Done"}</strong>
        <p>{notice.text}</p>
      </div>
      <button aria-label="Dismiss message" onClick={onDismiss} type="button">
        <X size={16} />
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/shared/components/Spinner.tsx`**

```tsx
export function Spinner({ size = "default" }: { size?: "small" | "default" }) {
  return <span aria-hidden="true" className={`spinner ${size}`} />;
}

export function SyncIndicator({ text }: { text: string }) {
  return (
    <div className="sync-indicator" role="status">
      <Spinner size="small" />
      <span>{text}</span>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="page-skeleton" aria-label="Loading page">
      <div className="skeleton-header">
        <span />
        <strong />
        <p />
      </div>
      <div className="skeleton-metric-grid">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="skeleton-card" key={index}>
            <span />
            <strong />
          </div>
        ))}
      </div>
      <div className="skeleton-band" />
      <div className="skeleton-table">
        {Array.from({ length: 5 }, (_, index) => (
          <span key={index} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `src/shared/components/StatusBadge.tsx`**

```tsx
export function StatusBadge({ status }: { status: string }) {
  return <span className={`status ${status.replace(" ", "-")}`}>{status}</span>;
}
```

- [ ] **Step 5: Create `src/shared/components/DataTable.tsx`**

Move `DataTable` from `src/App.tsx:5171-5221` into this file.

```tsx
import type { ReactNode } from "react";

export function DataTable({ empty, headers, onRowClick, rows }: {
  empty: string;
  headers: string[];
  onRowClick?: (rowIndex: number) => void;
  rows: ReactNode[][];
}) {
  // ... exact body from App.tsx lines 5182-5220
}
```

Copy the full function body verbatim from `src/App.tsx` lines 5171-5221.

- [ ] **Step 6: Create `src/shared/components/PageLayout.tsx`**

Move `PageHeader`, `Toolbar`, and `RecordTitle` from App.tsx into this file.

```tsx
import type { ReactNode } from "react";
import { Search } from "lucide-react";

export function PageHeader({ action, eyebrow, text, title }: {
  action?: ReactNode;
  eyebrow: string;
  text: string;
  title: string;
}) {
  // ... body from App.tsx lines 5134-5143
}

export function Toolbar({ children, query, setQuery }: {
  children?: ReactNode;
  query: string;
  setQuery: (query: string) => void;
}) {
  // ... body from App.tsx lines 5155-5168
}

export function RecordTitle({ notes, title }: { notes: string; title: string }) {
  // ... body from App.tsx lines 5223-5230
}
```

Copy each function body verbatim from App.tsx.

- [ ] **Step 7: Create `src/shared/components/FormLayout.tsx`**

Move `Modal`, `FormActions`, `TextField`, and `RowActions` from App.tsx into this file.

```tsx
import type { ReactNode } from "react";
import { CheckCircle2, CalendarClock, Pencil, Save, Trash2, X } from "lucide-react";
import { Spinner } from "./Spinner";

export function Modal({ onClose, title, children }: {
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  // ... body from App.tsx lines 5797-5819
}

export function FormActions({ busy, onClose }: { busy: boolean; onClose: () => void }) {
  // ... body from App.tsx lines 5821-5833
}

export function TextField({ label, onChange, placeholder, required, type, value }: {
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: string;
  value: string;
}) {
  // ... body from App.tsx lines 5759-5795
}

export function RowActions({ canMarkPaid, markActionLabel, onDelete, onEdit, onHistory, onMarkPaid }: {
  canMarkPaid?: boolean;
  markActionLabel?: string;
  onDelete: () => void;
  onEdit: () => void;
  onHistory?: () => void;
  onMarkPaid?: () => void;
}) {
  // ... body from App.tsx lines 5236-5271
}
```

Copy each function body verbatim from App.tsx.

- [ ] **Step 8: Update `src/App.tsx` — delete moved components, import from shared**

Delete these functions from App.tsx:
- `MoneyInput` (lines 232-258)
- `NoticeBanner` (lines 1245-1272)
- `Spinner` (lines 1274-1276)
- `SyncIndicator` (lines 1278-1285)
- `PageSkeleton` (lines 1287-1311)
- `StatusPill` (lines 5232-5234) — renamed to `StatusBadge`
- `DataTable` (lines 5171-5221)
- `PageHeader` (lines 5123-5144)
- `Toolbar` (lines 5146-5169)
- `RecordTitle` (lines 5223-5230)
- `RowActions` (lines 5236-5271)
- `Modal` (lines 5797-5819)
- `FormActions` (lines 5821-5833)
- `TextField` (lines 5759-5795)

Add imports:
```ts
import { MoneyField } from "./shared/components/MoneyField";
import { NoticeBanner } from "./shared/components/NoticeBanner";
import { Spinner, SyncIndicator, PageSkeleton } from "./shared/components/Spinner";
import { StatusBadge } from "./shared/components/StatusBadge";
import { DataTable } from "./shared/components/DataTable";
import { PageHeader, Toolbar, RecordTitle } from "./shared/components/PageLayout";
import { Modal, FormActions, TextField, RowActions } from "./shared/components/FormLayout";
```

Replace all occurrences of `MoneyInput` with `MoneyField` and `StatusPill` with `StatusBadge` in App.tsx.

- [ ] **Step 9: Update feature files — delete local MoneyField, import from shared**

In `src/features/billing/BillingFeature.tsx`, remove the local `MoneyField` function (lines 31-35) and add:
```ts
import { MoneyField } from "../../shared/components/MoneyField";
```

In `src/features/collections/CollectionsFeature.tsx`, remove the local `MoneyField` function (lines 30-35) and add:
```ts
import { MoneyField } from "../../shared/components/MoneyField";
```

- [ ] **Step 10: Verify build and tests pass**

Run: `npm run build && npm test`
Expected: Both pass with no errors.

- [ ] **Step 11: Commit**

```bash
git add src/shared/components/ src/App.tsx src/features/billing/BillingFeature.tsx src/features/collections/CollectionsFeature.tsx
git commit -m "refactor: extract shared components (MoneyField, NoticeBanner, Spinner, DataTable, PageLayout, FormLayout, StatusBadge)"
```

---

### Task 4: Extract payments feature

**Files:**
- Create: `src/features/payments/PaymentsFeature.tsx`
- Create: `src/features/payments/PaymentForm.tsx`
- Create: `src/features/payments/paymentRepository.ts`
- Modify: `src/App.tsx` (delete PaymentsView, PaymentHistoryView, PaymentForm, computedPaymentStatus; import from feature)
- Modify: `src/lib/supabaseData.ts` (move `loadPayments` query into paymentRepository.ts)

**Interfaces:**
- Consumes: shared components (`MoneyField`, `PageHeader`, `Toolbar`, `DataTable`, `StatusBadge`, `RowActions`, `Modal`, `FormActions`, `TextField`), shared utils (`currency`, `formatMoney`, `todayKey`, `isBeforeToday`, `isToday`), shared types (`Notice`, `QueueOfflineMutation`)
- Produces:
  - `PaymentsFeature` component — props: `{ payments, onChange, onLocalPaymentsChange, onQueueOfflineMutation, setNotice, userId }`
  - `PaymentHistoryFeature` component — props: `{ payments }`

- [ ] **Step 1: Create `src/features/payments/paymentRepository.ts`**

Move the payments Supabase query from `src/lib/supabaseData.ts:231-239` into this file:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentReminder } from "../../types";

const PAYMENT_SELECT = "id,user_id,title,type,amount,due_date,status,notes,created_at,updated_at";

export async function fetchPayments(supabase: SupabaseClient) {
  const result = await supabase
    .from("payment_reminders")
    .select(PAYMENT_SELECT)
    .order("due_date", { ascending: true });
  return { data: (result.data ?? []) as PaymentReminder[], error: result.error };
}
```

- [ ] **Step 2: Create `src/features/payments/PaymentForm.tsx`**

Move `PaymentForm` from `src/App.tsx:5697-5757` and the `emptyPayment` constant from `src/App.tsx:369-376` into this file. Import shared components (`MoneyField`, `Modal`, `FormActions`, `TextField`) and types.

The component receives `{ initial, onClose, onSubmit }` as props (same signature as current App.tsx).

- [ ] **Step 3: Create `src/features/payments/PaymentsFeature.tsx`**

Move `PaymentsView` from `src/App.tsx:4908-5115`, `PaymentHistoryView` from `src/App.tsx:4870-4906`, and `computedPaymentStatus` from `src/App.tsx:5116-5121` into this file.

Import shared components and utils. Export `PaymentsFeature` (wraps PaymentsView) and `PaymentHistoryFeature` (wraps PaymentHistoryView).

The `PaymentsFeature` receives the same props it gets in the current Workspace render: `{ payments, onChange, onLocalPaymentsChange, onQueueOfflineMutation, setNotice, userId }`.

- [ ] **Step 4: Update `src/lib/supabaseData.ts`**

Update `loadPayments` to delegate to the repository:

```ts
import { fetchPayments } from "../features/payments/paymentRepository";

export async function loadPayments(supabase: SupabaseClient) {
  return settle("Payments", fetchPayments(supabase));
}
```

- [ ] **Step 5: Update `src/App.tsx`**

Delete `PaymentsView`, `PaymentHistoryView`, `PaymentForm`, `computedPaymentStatus`, and `emptyPayment` from App.tsx.

Add import:
```ts
import { PaymentsFeature, PaymentHistoryFeature } from "./features/payments/PaymentsFeature";
```

Update the Workspace render section to use the imported components (same props, same render location).

- [ ] **Step 6: Verify build and tests pass**

Run: `npm run build && npm test`
Expected: Both pass.

- [ ] **Step 7: Commit**

```bash
git add src/features/payments/ src/App.tsx src/lib/supabaseData.ts
git commit -m "refactor: extract payments feature"
```

---

### Task 5: Extract subcontractors feature

**Files:**
- Create: `src/features/subcontractors/SubcontractorsFeature.tsx`
- Create: `src/features/subcontractors/subcontractorRepository.ts`
- Modify: `src/App.tsx` (delete SubcontractorsView, import from feature)

**Interfaces:**
- Consumes: shared components, shared utils, shared types
- Produces: `SubcontractorsFeature` component — props: `{ subcontractors, onChange, setNotice, userId }`

- [ ] **Step 1: Create `src/features/subcontractors/subcontractorRepository.ts`**

Move the subcontractor Supabase query wrapper. Note: the raw `fetchSubcontractors` already exists in `src/features/billing/billingRepository.ts`. This file can re-export it or contain subcontractor-specific mutations (save, archive).

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Subcontractor } from "../../types";

export { fetchSubcontractors } from "../billing/billingRepository";

export async function saveSubcontractorRecord(
  supabase: SupabaseClient,
  userId: string,
  payload: { id?: string; name: string; installation_rate: number; repair_rate: number; payable_pct: number; status: string },
) {
  // Move saveSubcontractor logic from billing — it's imported by App.tsx line 69
}
```

Check `src/features/billing/billingRepository.ts` and `src/App.tsx` line 69 for the exact `saveSubcontractor` function to move here.

- [ ] **Step 2: Create `src/features/subcontractors/SubcontractorsFeature.tsx`**

Move `SubcontractorsView` from `src/App.tsx:1478-1660` into this file. Import shared components and the `saveSubcontractor` function from the repository.

Export as `SubcontractorsFeature` with the same props.

- [ ] **Step 3: Update `src/App.tsx`**

Delete `SubcontractorsView` from App.tsx. Add import:
```ts
import { SubcontractorsFeature } from "./features/subcontractors/SubcontractorsFeature";
```

Update Workspace render.

- [ ] **Step 4: Verify build and tests pass**

Run: `npm run build && npm test`
Expected: Both pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/subcontractors/ src/App.tsx
git commit -m "refactor: extract subcontractors feature"
```

---

### Task 6: Extract daily-tracking feature (tickets + attendance)

**Files:**
- Create: `src/features/daily-tracking/DailyTicketsView.tsx`
- Create: `src/features/daily-tracking/AttendanceView.tsx`
- Create: `src/features/daily-tracking/dailyTicketRepository.ts`
- Create: `src/features/daily-tracking/attendanceRepository.ts`
- Modify: `src/App.tsx` (delete DailyTicketEntryView, SubconDailyTicketView, LegacyDailyTicketEntryView, DailySummaryMetric, AttendanceView; import from feature)
- Modify: `src/lib/supabaseData.ts` (delegate to repositories)

**Interfaces:**
- Consumes: shared components, shared utils, shared types, domain/tickets.ts
- Produces:
  - `DailyTicketsView` — props: `{ dailyTicketEntries, employees, positions, onChange, onQueueOfflineMutation, setNotice, userId }`
  - `SubconDailyTicketView` — props: `{ subconDailyTickets, subcontractors, onChange, onQueueOfflineMutation, setNotice, userId }`
  - `AttendanceView` — props: `{ attendanceEntries, employees, positions, onChange, onQueueOfflineMutation, setNotice, userId }`

- [ ] **Step 1: Create `src/features/daily-tracking/dailyTicketRepository.ts`**

Move daily ticket entry Supabase queries from `supabaseData.ts:270-288`. Create `fetchDailyTicketEntries` with the same select/ordering.

- [ ] **Step 2: Create `src/features/daily-tracking/attendanceRepository.ts`**

Move attendance entry Supabase queries from `supabaseData.ts:280-298`. Create `fetchAttendanceEntries` with the same select/ordering.

- [ ] **Step 3: Create `src/features/daily-tracking/DailyTicketsView.tsx`**

Move from App.tsx:
- `DailyTicketEntryView` (lines 2427-2600)
- `SubconDailyTicketView` (lines 2601-2765)
- `LegacyDailyTicketEntryView` (lines 2965-3472)
- `DailySummaryMetric` (lines 3473-3502)

Import shared components and utils. Export all four components.

- [ ] **Step 4: Create `src/features/daily-tracking/AttendanceView.tsx`**

Move `AttendanceView` from App.tsx (lines 2766-2964) into this file.

Import shared components and utils. Export `AttendanceView`.

- [ ] **Step 5: Update `src/lib/supabaseData.ts`**

Update `loadDailyTicketEntries` and `loadAttendanceEntries` to delegate to repositories.

- [ ] **Step 6: Update `src/App.tsx`**

Delete the moved components. Add imports:
```ts
import { DailyTicketEntryView, SubconDailyTicketView } from "./features/daily-tracking/DailyTicketsView";
import { AttendanceView } from "./features/daily-tracking/AttendanceView";
```

Update Workspace render. Keep the tab UI (`page-tabs` div) in Workspace for daily-tickets/daily-tickets-subcon views.

- [ ] **Step 7: Verify build and tests pass**

Run: `npm run build && npm test`
Expected: Both pass.

- [ ] **Step 8: Commit**

```bash
git add src/features/daily-tracking/ src/App.tsx src/lib/supabaseData.ts
git commit -m "refactor: extract daily-tracking feature (tickets + attendance)"
```

---

### Task 7: Extract employees feature (includes positions)

**Files:**
- Create: `src/features/employees/EmployeesFeature.tsx`
- Create: `src/features/employees/EmployeeForm.tsx`
- Create: `src/features/employees/PositionsView.tsx`
- Create: `src/features/employees/employeeRepository.ts`
- Create: `src/features/employees/positionRepository.ts`
- Modify: `src/App.tsx` (delete EmployeesView, EmployeeDetailsView, EmployeeForm, PositionsView, PositionForm, EmployeeCompensationSetupView, EarningsBreakdown, SummaryStat, TicketRateRow, DetailItem, Metric, emptyEmployee; import from feature)
- Modify: `src/lib/supabaseData.ts` (delegate to repositories)

**Interfaces:**
- Consumes: shared components, shared utils, shared types, domain/payroll.ts, domain/tickets.ts
- Produces:
  - `EmployeesFeature` component — props match current `EmployeesView`
  - `PositionsFeature` component — props match current `PositionsView`

- [ ] **Step 1: Create `src/features/employees/employeeRepository.ts`**

Move employees Supabase query from `supabaseData.ts:300-308` and `loadEmployeePayrollRuns` from `supabaseData.ts:402-490`.

- [ ] **Step 2: Create `src/features/employees/positionRepository.ts`**

Move positions Supabase query from `supabaseData.ts:290-298`.

- [ ] **Step 3: Create `src/features/employees/EmployeeForm.tsx`**

Move `EmployeeForm` from App.tsx (lines 5273-5646) and `emptyEmployee` constant (lines 391-412) into this file.

Import `MoneyField`, `TextField`, `FormActions` from shared, and `normalizePhoneDigits`, `formatPhoneNumber` from shared utils.

- [ ] **Step 4: Create `src/features/employees/EmployeesFeature.tsx`**

Move from App.tsx:
- `EmployeesView` (lines 3503-3725)
- `EmployeeDetailsView` (lines 3726-4098)
- `TicketRateRow` (lines 4099-4158)
- `DetailItem` (lines 4159-4171)
- `Metric` (lines 1458-1476)
- `EarningsBreakdown` (lines 2032-2056)
- `SummaryStat` (lines 2057-2065)

Import shared components, EmployeeForm, and employeeRepository.

- [ ] **Step 5: Create `src/features/employees/PositionsView.tsx`**

Move from App.tsx:
- `PositionsView` (lines 2066-2340)
- `PositionForm` (lines 2341-2426)
- `EmployeeCompensationSetupView` (lines 1878-2031)

Import shared components and positionRepository.

- [ ] **Step 6: Update `src/lib/supabaseData.ts`**

Update `loadEmployees`, `loadPositions`, `loadEmployeePayrollRuns` to delegate to repositories.

- [ ] **Step 7: Update `src/App.tsx`**

Delete all moved components and constants. Add imports:
```ts
import { EmployeesFeature, EmployeeDetailsView } from "./features/employees/EmployeesFeature";
import { PositionsFeature } from "./features/employees/PositionsView";
```

Update Workspace render.

- [ ] **Step 8: Verify build and tests pass**

Run: `npm run build && npm test`
Expected: Both pass.

- [ ] **Step 9: Commit**

```bash
git add src/features/employees/ src/App.tsx src/lib/supabaseData.ts
git commit -m "refactor: extract employees feature (includes positions)"
```

---

### Task 8: Extract payroll feature (includes salary bonds)

**Files:**
- Create: `src/features/payroll/PayrollFeature.tsx`
- Create: `src/features/payroll/PayrollRunForm.tsx`
- Create: `src/features/payroll/SalaryBondsView.tsx`
- Create: `src/features/payroll/payrollRepository.ts`
- Create: `src/features/payroll/salaryBondRepository.ts`
- Modify: `src/App.tsx` (delete PayrollView, PayrollHistoryView, PayrollItemsTable, PayrollRunForm, SalaryBondsView, salary bond helpers, emptyPayrollRun, emptySalaryBond; import from feature)
- Modify: `src/lib/supabaseData.ts` (delegate to repositories)

**Interfaces:**
- Consumes: shared components, shared utils, shared types, domain/payroll.ts, domain/tickets.ts
- Produces:
  - `PayrollFeature` component — props match current `PayrollView`
  - `PayrollHistoryFeature` component — props: `{ rows: PayrollHistoryRow[] }`
  - `SalaryBondsFeature` component — props match current `SalaryBondsView`

- [ ] **Step 1: Create `src/features/payroll/payrollRepository.ts`**

Move from `supabaseData.ts`:
- `loadPayrollRuns` query (lines 310-328)
- `loadPayrollRunItems` query (lines 329-338)
- `loadPayrollHistoryRows` query (lines 340-400)

- [ ] **Step 2: Create `src/features/payroll/salaryBondRepository.ts`**

Move from `supabaseData.ts`:
- `loadSalaryBonds` query (lines 260-268)

- [ ] **Step 3: Create `src/features/payroll/PayrollRunForm.tsx`**

Move `PayrollRunForm` from App.tsx (lines 5648-5696) and `emptyPayrollRun` constant (lines 414-420) into this file.

- [ ] **Step 4: Create `src/features/payroll/SalaryBondsView.tsx`**

Move `SalaryBondsView` from App.tsx (lines 1661-1877) and `emptySalaryBond` constant (lines 378-389) into this file.

- [ ] **Step 5: Create `src/features/payroll/PayrollFeature.tsx`**

Move from App.tsx:
- `PayrollView` (lines 4249-4776)
- `PayrollItemsTable` (lines 4777-4826)
- `PayrollHistoryView` (lines 4827-4869)
- `salaryBondDeductionsForEmployee` (lines 4173-4192)
- `payrollItemPayloadForEmployeeWithSalaryBonds` (lines 4193-4248)

Import domain functions, shared components, and PayrollRunForm.

- [ ] **Step 6: Update `src/lib/supabaseData.ts`**

Update `loadPayrollRuns`, `loadPayrollRunItems`, `loadPayrollHistoryRows`, `loadSalaryBonds` to delegate to repositories.

- [ ] **Step 7: Update `src/App.tsx`**

Delete all moved components, constants, and helpers. Add imports:
```ts
import { PayrollFeature, PayrollHistoryFeature } from "./features/payroll/PayrollFeature";
import { SalaryBondsFeature } from "./features/payroll/SalaryBondsView";
```

Update Workspace render.

- [ ] **Step 8: Verify build and tests pass**

Run: `npm run build && npm test`
Expected: Both pass.

- [ ] **Step 9: Commit**

```bash
git add src/features/payroll/ src/App.tsx src/lib/supabaseData.ts
git commit -m "refactor: extract payroll feature (includes salary bonds)"
```

---

### Task 9: Extract Sidebar and refactor resource loading

**Files:**
- Create: `src/Sidebar.tsx`
- Modify: `src/App.tsx` (extract sidebar JSX, refactor `loadResource` to registry pattern)

**Interfaces:**
- Consumes: `View` type, `navigate` function, lucide icons
- Produces:
  - `Sidebar` component — props: `{ view, navigate, email, onSignOut, mobileNavOpen, onCloseMobile }`

- [ ] **Step 1: Create `src/Sidebar.tsx`**

Move the sidebar JSX from Workspace (App.tsx lines 936-998) and `NavButton` (lines 1226-1243) into this file.

```tsx
import type { ReactNode } from "react";
import { BadgeDollarSign, CalendarClock, CheckCircle2, ChevronDown, CreditCard, FileText, HelpCircle, LayoutDashboard, LogOut, Settings, Users } from "lucide-react";
import { useState } from "react";

type View = /* import or re-declare the View type */;

export function Sidebar({ view, navigate, email, onSignOut, mobileNavOpen, onCloseMobile }: {
  view: View;
  navigate: (v: View) => void;
  email: string;
  onSignOut: () => void;
  mobileNavOpen: boolean;
  onCloseMobile: () => void;
}) {
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  // ... sidebar JSX from App.tsx lines 936-998
}

function NavButton({ active, icon, label, onClick }: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  // ... body from App.tsx lines 1237-1242
}
```

- [ ] **Step 2: Refactor `loadResource` in `src/App.tsx` to registry pattern**

Replace the three switch statements (cache read switch, load switch, server result switch) with a data-driven approach:

```ts
const resourceSetters: Record<ResourceKey, (data: unknown) => void> = {
  attendanceEntries: (d) => setAttendanceEntries(d as AttendanceEntry[]),
  billingRecords: (d) => setBillingRecords(d as BillingRecord[]),
  billingSettings: (d) => setBillingSettings(d as BillingSettings),
  collections: (d) => setCollections((d as CollectionReminder[]).map(normalizeReceivable)),
  dashboardSummary: (d) => setDashboardSummary({ ...emptyDashboardSummary, ...(d as DashboardSummary), collectionAging: { ...emptyDashboardSummary.collectionAging, ...(d as DashboardSummary).collectionAging } }),
  dailyTicketEntries: (d) => setDailyTicketEntries(d as DailyTicketEntry[]),
  employees: (d) => setEmployees(d as Employee[]),
  expenseCategories: (d) => setExpenseCategories(d as ExpenseCategory[]),
  expenses: (d) => setExpenses(d as Expense[]),
  payments: (d) => setPayments(d as PaymentReminder[]),
  payrollHistory: (d) => setPayrollHistoryRows(d as PayrollHistoryRow[]),
  payrollRuns: (d) => setPayrollRuns(d as PayrollRunWithItems[]),
  positions: (d) => setPositions(d as Position[]),
  salaryBonds: (d) => setSalaryBonds(d as SalaryBond[]),
  subconDailyTickets: (d) => setSubconDailyTickets(d as SubconDailyTicket[]),
  subcontractors: (d) => setSubcontractors(d as Subcontractor[]),
};

const resourceLoaders: Record<ResourceKey, (s: SupabaseClient) => Promise<{ data: unknown; error: unknown }>> = {
  attendanceEntries: loadAttendanceEntries,
  billingRecords: loadBillingRecords,
  billingSettings: loadBillingSettings,
  collections: loadCollections,
  dashboardSummary: loadDashboardSummary,
  dailyTicketEntries: loadDailyTicketEntries,
  employees: loadEmployees,
  expenseCategories: loadExpenseCategories,
  expenses: loadExpenses,
  payments: loadPayments,
  payrollHistory: loadPayrollHistoryRows,
  payrollRuns: loadPayrollRuns,
  positions: loadPositions,
  salaryBonds: loadSalaryBonds,
  subconDailyTickets: loadSubconDailyTickets,
  subcontractors: loadSubcontractors,
};
```

Then `loadResource` becomes:
```ts
async function loadResource(resource: ResourceKey, force = false) {
  if (!supabase) return;
  if (!force && (resourceStatuses[resource] === "loading" || resourceStatuses[resource] === "ready")) return;
  const previousStatus = resourceStatuses[resource];
  const setter = resourceSetters[resource];

  const cached = !force ? await readCachedResource<unknown>(resource, session.user.id) : null;
  if (cached) {
    setter(cached);
    setResourceHydration((current) => ({ ...current, [resource]: true }));
  }

  setResourceStatuses((current) => current[resource] === "ready" ? current : { ...current, [resource]: "loading" });

  try {
    const result = await resourceLoaders[resource](supabase);
    if (result.error) {
      setResourceStatuses((current) => ({ ...current, [resource]: previousStatus === "ready" ? "ready" : "idle" }));
      return;
    }
    setter(result.data);
    await writeCachedResource(resource, session.user.id, result.data);
    setResourceHydration((current) => ({ ...current, [resource]: true }));
    setResourceStatuses((current) => ({ ...current, [resource]: "ready" }));
  } catch {
    setResourceStatuses((current) => ({ ...current, [resource]: previousStatus === "ready" ? "ready" : "idle" }));
  }
}
```

- [ ] **Step 3: Update Workspace to use `<Sidebar />`**

Replace the inline sidebar JSX with:
```tsx
<Sidebar
  view={view}
  navigate={navigate}
  email={session.user.email ?? ""}
  onSignOut={signOut}
  mobileNavOpen={mobileNavOpen}
  onCloseMobile={() => setMobileNavOpen(false)}
/>
```

Remove `settingsMenuOpen` state from Workspace (it moves into Sidebar).

- [ ] **Step 4: Delete remaining refresh functions**

The individual `refreshEmployeesPage`, `refreshPayrollPage`, etc. functions can be simplified. Each feature's `onChange` prop now just calls:
```ts
async () => { await Promise.all(viewResources[view].map(r => loadResource(r, true))); }
```

Or keep the explicit refresh functions if they load resources beyond the current view (e.g., `refreshEmployeesPage` also loads `dashboardSummary`).

- [ ] **Step 5: Verify build and tests pass**

Run: `npm run build && npm test`
Expected: Both pass.

- [ ] **Step 6: Commit**

```bash
git add src/Sidebar.tsx src/App.tsx
git commit -m "refactor: extract Sidebar, refactor loadResource to registry pattern"
```

---

### Task 10: Organize CSS and clean up

**Files:**
- Modify: `src/styles.css` (reorganize with section headers)
- Delete: `src/pages/DailyTicketsPage.tsx`
- Delete: `src/pages/EmployeesPage.tsx`
- Delete: `src/pages/EmployeeDetailsPage.tsx`
- Delete: `src/pages/PayrollPage.tsx`
- Modify: `src/App.tsx` (remove any remaining dead imports/exports)

**Interfaces:**
- No new interfaces — cleanup only.

- [ ] **Step 1: Add section headers to `src/styles.css`**

Add these comment headers to organize the CSS into logical sections. Move rules under their matching section. Do not change any CSS rules — only reorder and add headers.

```css
/* ═══════════════════════════════════════════════════
   FOUNDATION — variables, resets, typography
   ═══════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════
   SHARED COMPONENTS — MoneyField, StatusBadge, DataTable, FormLayout, PageLayout
   ═══════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════
   APP SHELL — sidebar, topbar, layout, auth screens
   ═══════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════
   DASHBOARD
   ═══════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════
   EMPLOYEES & POSITIONS
   ═══════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════
   DAILY TRACKING — tickets, attendance
   ═══════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════
   PAYROLL & SALARY BONDS
   ═══════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════
   PAYMENTS
   ═══════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════
   BILLING
   ═══════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════
   COLLECTIONS
   ═══════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════
   EXPENSES
   ═══════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════
   SUBCONTRACTORS
   ═══════════════════════════════════════════════════ */
```

- [ ] **Step 2: Delete `src/pages/` directory**

These are 1-line re-export files that no longer serve a purpose:
```bash
rm src/pages/DailyTicketsPage.tsx src/pages/EmployeesPage.tsx src/pages/EmployeeDetailsPage.tsx src/pages/PayrollPage.tsx
rmdir src/pages
```

- [ ] **Step 3: Remove dead exports from `src/App.tsx`**

Check if App.tsx still has `export` on any view functions that were only exported for the `src/pages/` re-exports. If those views have been moved to features, the exports are already gone. If `Dashboard` or `Login` are still in App.tsx, make sure they're not unnecessarily exported.

- [ ] **Step 4: Verify final build and tests**

Run: `npm run build && npm test`
Expected: Both pass. App.tsx should now be ~200-300 lines.

- [ ] **Step 5: Verify App.tsx line count**

Run: `wc -l src/App.tsx`
Expected: Under 400 lines.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: organize CSS sections, delete pages/ re-exports, final cleanup"
```
