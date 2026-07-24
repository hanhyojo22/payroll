# Billing Dialog 3-Step Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the New/Edit Billing dialog (`BillingForm` in `src/features/billing/BillingFeature.tsx`) from a single scrollable two-column form into a 3-step wizard (Billing Details → Review Tickets → Billable Summary), with the final step restyled as a Philippines-style itemized billing statement.

**Architecture:** Add a `step` state to the existing `BillingForm` component. Replace its two-column JSX (`.cbf-cols` / `.cbf-left` / `.cbf-right`) with a stepper header, a single content pane that renders only the active step's sections, and a Back/Next/Submit footer. No computation logic changes — every value shown was already computed in the component today; only how/where it's displayed changes.

**Tech Stack:** React + TypeScript (existing `BillingForm` component), plain CSS in `src/styles.css` (existing `.cbf-*` class family, no CSS modules/CSS-in-JS in this repo).

## Global Constraints

- No changes to `src/domain/billing.ts` or any computed value's formula — `billableInstall`, `billableRepair`, `billingAmount`, `collectionsAmount`, `collectiblesAmount`, `totalSubconNet`, `employeeRows`, etc. must produce identical numbers before and after this change.
- No VAT/tax row — this app has no tax field in `BillingSettings` or `BillingRecord`; the itemized table's Subtotal equals Total Amount Due.
- Applies to both "New Billing" and "Edit Billing" (same `BillingForm` component, no fork on `initial`).
- Next/Back are never blocked by validation — matches today's submit-time-only validation (native `required` attrs on inputs).
- Currency formatting always via the existing `currency` helper (`src/shared/utils/currency.ts`), never hand-rolled.
- Design doc: `docs/superpowers/specs/2026-07-24-billing-dialog-wizard-design.md` — consult for full rationale.

---

### Task 1: Add wizard CSS (stepper, step panel, invoice, footer nav)

**Files:**
- Modify: `src/styles.css:10664-11134` (the block from `.cbf-cols {` through `.cbf-btn-submit:disabled`)
- Modify: `src/styles.css` mobile breakpoints (`@media (max-width: 980px)` and `@media (max-width: 640px)` blocks that reference `.cbf-cols`/`.cbf-left`/`.cbf-right`)

**Interfaces:**
- Produces (CSS class names Task 2's JSX will use): `.cbf-stepper`, `.cbf-step`, `.cbf-step--active`, `.cbf-step--done`, `.cbf-step-line`, `.cbf-step-circle`, `.cbf-step-label`, `.cbf-step-panel`, `.cbf-step-panel--narrow`, `.cbf-nav-right`, `.cbf-btn-back`, `.cbf-btn-next`, `.cbf-invoice`, `.cbf-invoice-title`, `.cbf-invoice-section-label`, `.cbf-invoice-line`, `.cbf-invoice-hr`, `.cbf-invoice-meta`, `.cbf-invoice-meta-label`, `.cbf-invoice-meta-val`, `.cbf-invoice-draft`, `.cbf-invoice-table`, `.cbf-invoice-num`, `.cbf-invoice-desc`, `.cbf-invoice-subtotal-row`, `.cbf-invoice-grand-row`, `.cbf-invoice-note`, `.cbf-invoice-note-label`, `.cbf-invoice-note-row`.
- Removes (no longer defined after this task — confirmed via grep in the design doc that they're only used inside `BillingForm`, which Task 2 will stop referencing them from): `.cbf-cols`, `.cbf-left`, `.cbf-right`, `.cbf-statement`, `.cbf-stmt-*`, `.cbf-draft-badge`, `.cbf-split-*`.
- Keeps unchanged (still consumed by steps 1–2 JSX in Task 2): `.cbf-section`, `.cbf-section-label`, `.cbf-section-sub`, `.cbf-section-card`, `.cbf-section-heading`, `.cbf-section-helper`, `.cbf-period-row`, `.cbf-select`, `.cbf-input`, `.cbf-year-input`, `.cbf-half-toggle`, `.cbf-due-date-row`, `.cbf-field-label`, `.cbf-half-btn`, `.cbf-half-btn--active`, `.cbf-ticket-pair`, `.cbf-dispute-summary*`, `.cbf-ticket-card*`, `.cbf-ticket-field`, `.cbf-ticket-type`, `.cbf-ticket-input*`, `.cbf-section--dispute`, `.cbf-textarea*`, `.cbf-actions`, `.cbf-btn-cancel`, `.cbf-btn-submit`.

- [ ] **Step 1: Replace the two-column layout CSS block with the wizard CSS block**

Find this exact block in `src/styles.css` (starts at `.cbf-cols {`, ends at the closing brace of `.cbf-btn-submit:disabled`):

```css
.cbf-cols {
  display: grid;
  flex: 1;
  gap: 0;
  grid-template-columns: minmax(0, 13fr) minmax(360px, 7fr);
  min-height: 0;
  overflow: hidden;
  scrollbar-width: none;
}

.cbf-cols::-webkit-scrollbar {
  display: none;
  width: 0;
}

/* LEFT column */
.cbf-left {
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
  padding: 6px 20px;
}

.cbf-section {
  margin: 0;
  padding: 0;
}
```

Replace with:

```css
/* Wizard stepper */
.cbf-stepper {
  align-items: center;
  display: flex;
  justify-content: center;
  padding: 18px 24px 4px;
}

.cbf-step {
  align-items: center;
  background: none;
  border: none;
  cursor: pointer;
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  gap: 6px;
  max-width: 220px;
  padding: 4px 8px;
  position: relative;
}

.cbf-step-line {
  background: var(--color-border);
  height: 2px;
  left: 50%;
  position: absolute;
  top: 15px;
  width: 100%;
  z-index: 0;
}

.cbf-step:last-child .cbf-step-line { display: none; }

.cbf-step-circle {
  align-items: center;
  background: var(--color-surface-secondary);
  border: 2px solid var(--color-border);
  border-radius: 999px;
  color: var(--color-text-secondary);
  display: flex;
  font-size: 12px;
  font-weight: 700;
  height: 32px;
  justify-content: center;
  position: relative;
  transition: all 0.15s;
  width: 32px;
  z-index: 1;
}

.cbf-step-label {
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 600;
  text-align: center;
  transition: color 0.15s;
}

.cbf-step--active .cbf-step-circle {
  background: var(--color-accent, #0071e3);
  border-color: var(--color-accent, #0071e3);
  color: #fff;
}
.cbf-step--active .cbf-step-label { color: var(--color-text); }

.cbf-step--done .cbf-step-circle {
  background: #23c98a;
  border-color: #23c98a;
  color: #fff;
}
.cbf-step--done .cbf-step-label { color: var(--color-text); }
.cbf-step--done .cbf-step-line { background: #23c98a; }

/* Step content panel */
.cbf-step-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 24px 20px;
}

.cbf-step-panel--narrow {
  margin: 0 auto;
  max-width: 480px;
  width: 100%;
}

.cbf-section {
  margin: 0;
  padding: 0;
}
```

- [ ] **Step 2: Remove the now-superseded right-column/statement CSS block**

Find this exact block in `src/styles.css` (it directly follows `.cbf-textarea:focus { border-color: var(--color-accent, #0071e3); outline: none; }`, which stays):

```css
/* RIGHT column — live statement */
.cbf-right {
  background: linear-gradient(180deg, rgba(248, 250, 252, 0.9), rgba(255, 255, 255, 0.92));
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 24px;
}

.cbf-statement {
  background: var(--color-surface, #fff);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.06);
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
  overflow: hidden;
  position: sticky;
  top: 0;
}

.cbf-stmt-head {
  align-items: flex-start;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  justify-content: space-between;
  padding: 16px 18px;
}

.cbf-stmt-period {
  font-size: 1.05rem;
  font-weight: 700;
  margin: 0 0 2px;
}

.cbf-stmt-half {
  color: var(--color-text-secondary);
  font-size: 12px;
  margin: 0;
}

.cbf-draft-badge {
  background: rgba(0, 113, 227, 0.08);
  border: 1px solid rgba(0, 113, 227, 0.18);
  border-radius: 20px;
  color: var(--color-accent, #0071e3);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 3px 9px;
  text-transform: uppercase;
}

.cbf-stmt-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
}

.cbf-stmt-hero {
  background: linear-gradient(180deg, rgba(0, 113, 227, 0.08), rgba(0, 113, 227, 0.02));
  border: 1px solid rgba(0, 113, 227, 0.12);
  border-radius: var(--radius-lg);
  display: grid;
  gap: 6px;
  padding: 18px;
}

.cbf-stmt-hero-label {
  color: var(--color-text-secondary);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.cbf-stmt-hero-amount {
  color: var(--color-accent);
  font-size: 2rem;
  font-weight: 800;
  letter-spacing: -0.05em;
  line-height: 1;
}

.cbf-stmt-group {
  border: 1px solid var(--color-border-light, var(--color-border));
  border-radius: var(--radius-md);
  margin: 0;
  padding: 14px;
}

.cbf-stmt-group-label {
  color: var(--color-text-secondary);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  margin: 0 0 6px;
  text-transform: uppercase;
}

.cbf-stmt-group--dispute .cbf-stmt-group-label { color: #c0392b; }

.cbf-stmt-row {
  align-items: baseline;
  display: flex;
  font-size: 13px;
  justify-content: space-between;
  padding: 4px 0;
}
.cbf-stmt-row span:first-child { color: var(--color-text-secondary); }
.cbf-stmt-row span:last-child { color: var(--color-text); font-weight: 600; }

.cbf-stmt-row--total {
  border-top: 1px dashed var(--color-border);
  margin-top: 6px;
  padding-top: 10px;
}

.cbf-split-labels {
  display: grid;
  gap: 10px;
}

.cbf-split-item {
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  display: grid;
  gap: 4px;
  padding: 12px;
}

.cbf-split-item--collection {
  background: rgba(0, 113, 227, 0.04);
}

.cbf-split-item--payable {
  background: rgba(217, 119, 6, 0.06);
}

.cbf-split-label {
  color: var(--color-text-secondary);
  font-size: 11px;
  font-weight: 600;
  margin: 0 0 2px;
}

.cbf-split-amount {
  font-size: 13px;
  font-weight: 700;
}

.cbf-split-item--collection .cbf-split-amount { color: #0071e3; }
.cbf-split-item--payable .cbf-split-amount { color: #d97706; }

/* Actions footer */
.cbf-actions {
  backdrop-filter: blur(10px);
  background: rgba(255, 255, 255, 0.94);
  border-top: 1px solid var(--color-border);
  display: flex;
  flex-shrink: 0;
  gap: 10px;
  justify-content: flex-end;
  padding: 6px 20px;
  position: sticky;
  bottom: 0;
  z-index: 2;
}

.cbf-btn-cancel {
  background: var(--color-surface);
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: var(--font-size-xs);
  font-weight: 600;
  min-height: 38px;
  padding: 0 16px;
  transition: all 0.15s;
}
.cbf-btn-cancel:hover { border-color: var(--color-text-secondary); color: var(--color-text); }

.cbf-btn-submit {
  background: var(--color-accent, #0071e3);
  border: none;
  border-radius: var(--radius-sm);
  box-shadow: 0 10px 20px rgba(0, 113, 227, 0.18);
  color: #fff;
  cursor: pointer;
  font-size: var(--font-size-xs);
  font-weight: 600;
  min-height: 38px;
  padding: 0 16px;
  transition: opacity 0.15s;
}
.cbf-btn-submit:hover:not(:disabled) { opacity: 0.88; }
.cbf-btn-submit:disabled { cursor: not-allowed; opacity: 0.5; }
```

Replace with (drops the dead `.cbf-right`/`.cbf-statement`/`.cbf-stmt-*`/`.cbf-split-*`/`.cbf-draft-badge` rules, changes `.cbf-actions` to space-between layout for the new Cancel-left/Back-Next-right footer, adds the invoice + nav-right + back/next button classes):

```css
/* Footer nav */
.cbf-nav-right {
  display: flex;
  gap: 10px;
}

.cbf-btn-back {
  background: var(--color-surface);
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: var(--font-size-xs);
  font-weight: 600;
  min-height: 38px;
  padding: 0 16px;
  transition: all 0.15s;
}
.cbf-btn-back:hover:not(:disabled) { border-color: var(--color-text-secondary); color: var(--color-text); }
.cbf-btn-back:disabled { cursor: not-allowed; opacity: 0.5; }

.cbf-btn-next {
  background: var(--color-accent, #0071e3);
  border: none;
  border-radius: var(--radius-sm);
  box-shadow: 0 10px 20px rgba(0, 113, 227, 0.18);
  color: #fff;
  cursor: pointer;
  font-size: var(--font-size-xs);
  font-weight: 600;
  min-height: 38px;
  padding: 0 16px;
  transition: opacity 0.15s;
}
.cbf-btn-next:hover:not(:disabled) { opacity: 0.88; }

/* Invoice-style billable summary (step 3) */
.cbf-invoice {
  background: var(--color-surface);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  margin: 0 auto;
  max-width: 620px;
  padding: 28px 32px;
  width: 100%;
}

.cbf-invoice-title {
  font-size: 1.15rem;
  font-weight: 700;
  margin: 0 0 20px;
  text-align: center;
}

.cbf-invoice-section-label {
  color: var(--color-text-secondary);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  margin: 0 0 10px;
  text-transform: uppercase;
}

.cbf-invoice-line {
  font-size: 0.88rem;
  margin: 4px 0;
}

.cbf-invoice-hr {
  border: none;
  border-top: 1px solid var(--color-border-light);
  margin: 18px 0;
}

.cbf-invoice-meta {
  column-gap: 20px;
  display: grid;
  grid-template-columns: auto 1fr;
  row-gap: 6px;
}

.cbf-invoice-meta-label {
  color: var(--color-text);
  font-size: 0.86rem;
  font-weight: 700;
}

.cbf-invoice-meta-val {
  font-size: 0.86rem;
}

.cbf-invoice-draft {
  background: rgba(217, 119, 6, 0.12);
  border-radius: 5px;
  color: #b45309;
  font-size: 11px;
  font-weight: 700;
  padding: 1px 8px;
}

.cbf-invoice-table {
  border-collapse: collapse;
  font-size: 0.85rem;
  width: 100%;
}

.cbf-invoice-table thead th {
  background: var(--color-surface-secondary);
  color: var(--color-text-secondary);
  font-size: 11px;
  font-weight: 700;
  padding: 8px 10px;
  text-align: left;
  text-transform: uppercase;
}

.cbf-invoice-table thead th.cbf-invoice-num { text-align: right; }

.cbf-invoice-table td {
  border-bottom: 1px solid var(--color-border-light);
  padding: 9px 10px;
}

.cbf-invoice-table td.cbf-invoice-num { text-align: right; }
.cbf-invoice-table td.cbf-invoice-desc { font-weight: 600; }

.cbf-invoice-subtotal-row td {
  border-top: 1px solid var(--color-border);
  font-weight: 700;
}

.cbf-invoice-grand-row td {
  background: rgba(0, 113, 227, 0.06);
  font-size: 0.95rem;
  font-weight: 800;
}

.cbf-invoice-note {
  background: var(--color-surface-secondary);
  border-radius: var(--radius-md);
  margin-top: 18px;
  padding: 12px 16px;
}

.cbf-invoice-note-label {
  color: var(--color-text-secondary);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
}

.cbf-invoice-note-row {
  display: flex;
  font-size: 0.85rem;
  justify-content: space-between;
  margin-top: 4px;
}

/* Actions footer */
.cbf-actions {
  backdrop-filter: blur(10px);
  background: rgba(255, 255, 255, 0.94);
  border-top: 1px solid var(--color-border);
  display: flex;
  flex-shrink: 0;
  gap: 10px;
  justify-content: space-between;
  padding: 6px 20px;
  position: sticky;
  bottom: 0;
  z-index: 2;
}

.cbf-btn-cancel {
  background: var(--color-surface);
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: var(--font-size-xs);
  font-weight: 600;
  min-height: 38px;
  padding: 0 16px;
  transition: all 0.15s;
}
.cbf-btn-cancel:hover { border-color: var(--color-text-secondary); color: var(--color-text); }

.cbf-btn-submit {
  background: var(--color-accent, #0071e3);
  border: none;
  border-radius: var(--radius-sm);
  box-shadow: 0 10px 20px rgba(0, 113, 227, 0.18);
  color: #fff;
  cursor: pointer;
  font-size: var(--font-size-xs);
  font-weight: 600;
  min-height: 38px;
  padding: 0 16px;
  transition: opacity 0.15s;
}
.cbf-btn-submit:hover:not(:disabled) { opacity: 0.88; }
.cbf-btn-submit:disabled { cursor: not-allowed; opacity: 0.5; }
```

- [ ] **Step 3: Fix the 980px mobile breakpoint block**

Find in `src/styles.css`:

```css
  .cbf-cols {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }

  .cbf-left {
    border-right: none;
    border-bottom: 1px solid var(--color-border);
    min-width: 0;
    overflow: visible;
  }

  .cbf-right {
    overflow: visible;
  }

  .cbf-statement {
    position: static;
  }
}
```

Replace with:

```css
  .cbf-step-panel {
    overflow-y: auto;
  }
}
```

- [ ] **Step 4: Fix the 640px mobile breakpoint block**

Find in `src/styles.css`:

```css
@media (max-width: 640px) {
  .cbf-cols { grid-template-columns: 1fr; }
  .cbf-header,
  .cbf-right,
  .cbf-actions {
    padding-left: 18px;
    padding-right: 18px;
  }

  .cbf-left {
    padding-left: 0;
    padding-right: 0;
  }
```

Replace with:

```css
@media (max-width: 640px) {
  .cbf-header,
  .cbf-step-panel,
  .cbf-actions {
    padding-left: 18px;
    padding-right: 18px;
  }

  .cbf-invoice {
    padding: 20px;
  }
```

- [ ] **Step 5: Verify the build still passes**

Run: `npm run build`
Expected: exits 0, no TypeScript or build errors (this task only touches CSS, so this just confirms nothing else broke).

- [ ] **Step 6: Commit**

```bash
git add src/styles.css
git commit -m "$(cat <<'EOF'
Add wizard stepper/step-panel/invoice CSS for billing dialog redesign

New classes for the upcoming 3-step billing wizard; old two-column
.cbf-cols/.cbf-left/.cbf-right/.cbf-statement rules are removed since
the next task stops rendering them.
EOF
)"
```

---

### Task 2: Restructure BillingForm into the 3-step wizard

**Files:**
- Modify: `src/features/billing/BillingFeature.tsx:1453-2080` (the `BillingForm` function)

**Interfaces:**
- Consumes: CSS classes produced by Task 1 (`.cbf-stepper`, `.cbf-step*`, `.cbf-step-panel*`, `.cbf-invoice*`, `.cbf-nav-right`, `.cbf-btn-back`, `.cbf-btn-next`).
- Consumes (already existing in this file, unchanged): `currency`, `monthNames`, `billingPeriodLabel`, `todayKey`, `CheckCircle2` (from `lucide-react`, already imported at line 2), and every computed value already defined in `BillingForm` (`employeeCounts`, `employeeRows`, `employeeDisplayTickets`, `employeeDisplayGross`, `subconInstall`, `subconRepair`, `installTickets`, `repairTickets`, `disputedInstall`, `disputedRepair`, `companyInstallTickets`, `companyRepairTickets`, `companyDisputedInstall`, `companyDisputedRepair`, `combinedInstallTickets`, `combinedRepairTickets`, `billableInstall`, `billableRepair`, `billableTickets`, `billingAmount`, `collectionsAmount`, `collectiblesAmount`, `totalSubconNet`, `updateSubconItem`, `handleSubmit`).
- Produces: no new exports — this is a self-contained internal restructuring of `BillingForm`'s render output and local state (`step`).

- [ ] **Step 1: Add the `WIZARD_STEPS` constant above `BillingForm`**

In `src/features/billing/BillingFeature.tsx`, find:

```tsx
function BillingForm({
  initial,
  dailyTicketEntries,
  settings,
  subconDailyTickets,
  subcontractors,
  onClose,
  onSubmit,
}: {
```

Replace with:

```tsx
const WIZARD_STEPS: Array<{ id: 1 | 2 | 3; label: string }> = [
  { id: 1, label: "Billing Details" },
  { id: 2, label: "Review Tickets" },
  { id: 3, label: "Billable Summary" },
];

function BillingForm({
  initial,
  dailyTicketEntries,
  settings,
  subconDailyTickets,
  subcontractors,
  onClose,
  onSubmit,
}: {
```

- [ ] **Step 2: Add `step` state and the date-formatting helper**

Find:

```tsx
  const [values, setValues] = useState<BillingFormValues>(buildInitialValues);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ActionProgressState | null>(null);
```

Replace with:

```tsx
  const [values, setValues] = useState<BillingFormValues>(buildInitialValues);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ActionProgressState | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);

  function formatStatementDate(dateKey: string) {
    const [year, month, day] = dateKey.slice(0, 10).split("-").map(Number);
    if (!year || !month || !day) return "—";
    return `${monthNames[month - 1]} ${day}, ${year}`;
  }
```

- [ ] **Step 3: Compute the invoice header values before the return statement**

Find:

```tsx
  function updateSubconItem(index: number, patch: Partial<BillingFormValues["subcon_items"][number]>) {
    setValues((current) => ({
      ...current,
      subcon_items: current.subcon_items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    }));
  }
```

Replace with:

```tsx
  function updateSubconItem(index: number, patch: Partial<BillingFormValues["subcon_items"][number]>) {
    setValues((current) => ({
      ...current,
      subcon_items: current.subcon_items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    }));
  }

  const statementDate = formatStatementDate(initial ? initial.created_at : todayKey());
  const statementPeriodLabel = `${billingPeriodLabel(values.billing_period)}, ${monthNames[Number(values.billing_month) - 1]} ${values.billing_year}`;
```

- [ ] **Step 4: Replace the two-column body with the stepper + step-1/step-2 panels**

Find (this is the opening of the form body, through the end of the Company Tickets/Disputed section and the start of the Subcontractor Tickets section header — i.e. everything from `<div className="cbf-cols">` through the `<section className="cbf-section cbf-section-card">` that opens "Subcontractor Tickets", NOT including that section's contents yet):

```tsx
          <div className="cbf-cols">
            <div className="cbf-left">
              <section className="cbf-section cbf-section-card">
                <div className="cbf-section-heading">
                  <p className="cbf-section-label">Billing Period</p>
                </div>
                <div className="cbf-period-row">
                  <select className="cbf-select" value={values.billing_month} onChange={(event) => setValues({ ...values, billing_month: event.target.value })}>
                    {monthNames.map((name, index) => <option key={name} value={String(index + 1)}>{name}</option>)}
                  </select>
                  <input
                    className="cbf-input cbf-year-input"
                    max="2200"
                    min="2020"
                    onChange={(event) => setValues({ ...values, billing_year: event.target.value })}
                    required
                    type="number"
                    value={values.billing_year}
                  />
                </div>
                <div className="cbf-half-toggle">
                  <button
                    className={values.billing_period === "first_half" ? "cbf-half-btn cbf-half-btn--active" : "cbf-half-btn"}
                    onClick={() => setValues({ ...values, billing_period: "first_half" })}
                    type="button"
                  >
                    1st - 15th
                  </button>
                  <button
                    className={values.billing_period === "second_half" ? "cbf-half-btn cbf-half-btn--active" : "cbf-half-btn"}
                    onClick={() => setValues({ ...values, billing_period: "second_half" })}
                    type="button"
                  >
                    16th - End
                  </button>
                </div>
                <div className="cbf-due-date-row">
                  <label className="cbf-field-label" htmlFor="billing-due-date">Due date</label>
                  <input
                    className="cbf-input"
                    id="billing-due-date"
                    onChange={(event) => setValues({ ...values, due_date: event.target.value })}
                    type="date"
                    value={values.due_date}
                  />
                </div>
              </section>

              <section className="cbf-section cbf-section-card">
                <div className="cbf-section-heading">
                  <p className="cbf-section-label">Ticket Sources</p>
                </div>
                <div className="billing-ticket-source-grid">
                  <div className="billing-ticket-source-card">
                    <span className="billing-ticket-source-title">Employees</span>
                    <strong className="billing-ticket-source-total">{employeeCounts.installation + employeeCounts.repair}</strong>
                    <div className="billing-ticket-source-breakdown">
                      <small>Install: {employeeCounts.installation}</small>
                      <small>Repair: {employeeCounts.repair}</small>
                    </div>
                  </div>
                  <div className="billing-ticket-source-card">
                    <span className="billing-ticket-source-title">Subcontractors</span>
                    <strong className="billing-ticket-source-total">{subconInstall + subconRepair}</strong>
                    <div className="billing-ticket-source-breakdown">
                      <small>Install: {subconInstall}</small>
                      <small>Repair: {subconRepair}</small>
                    </div>
                  </div>
                  <div className="billing-ticket-source-card">
                    <span className="billing-ticket-source-title">Company</span>
                    <strong className="billing-ticket-source-total">{companyInstallTickets + companyRepairTickets}</strong>
                    <div className="billing-ticket-source-breakdown">
                      <small>Install: {companyInstallTickets}</small>
                      <small>Repair: {companyRepairTickets}</small>
                    </div>
                  </div>
                  <div className="billing-ticket-source-card emphasis">
                    <span className="billing-ticket-source-title">Combined</span>
                    <strong className="billing-ticket-source-total">{combinedInstallTickets + combinedRepairTickets}</strong>
                    <div className="billing-ticket-source-breakdown">
                      <small>Install: {combinedInstallTickets}</small>
                      <small>Repair: {combinedRepairTickets}</small>
                    </div>
                  </div>
                </div>
              </section>

              <section className="cbf-section cbf-section-card">
                <div className="cbf-section-heading">
                  <p className="cbf-section-label">Employee Tickets</p>
                </div>
                <div className="billing-details-section-head">
                  <div>
                    <h4>Employee Ticket Reference</h4>
                    <p>Closed employee tickets included in this billing period.</p>
                  </div>
                  <strong>{employeeDisplayTickets} tickets · {currency.format(employeeDisplayGross)}</strong>
                </div>
                <div className="billing-details-table-wrap">
                  <table className="billing-details-table billing-employee-reference-table">
                    <colgroup>
                      <col className="col-employee" />
                      <col className="col-ins" />
                      <col className="col-rep" />
                      <col className="col-tot" />
                      <col className="col-gross" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th className="billing-col-center"><span className="tbl-label-full">Install</span><span className="tbl-label-abbr">Ins</span></th>
                        <th className="billing-col-center"><span className="tbl-label-full">Repair</span><span className="tbl-label-abbr">Rep</span></th>
                        <th className="billing-col-center"><span className="tbl-label-full">Total</span><span className="tbl-label-abbr">Tot</span></th>
                        <th className="billing-col-right">Gross</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employeeRows.length === 0 ? (
                        <tr><td className="collection-empty" colSpan={5}>No employee ticket entries for this period.</td></tr>
                      ) : employeeRows.map((row) => (
                        <tr key={row.employeeId}>
                          <td className="billing-col-left" data-label="Employee">{row.employeeName}</td>
                          <td className="billing-col-center" data-label="Install">{row.install}</td>
                          <td className="billing-col-center" data-label="Repair">{row.repair}</td>
                          <td className="billing-col-center" data-label="Total">{row.install + row.repair}</td>
                          <td className="billing-col-right" data-label="Gross">{currency.format(row.gross)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="cbf-section cbf-section-card">
                <div className="cbf-section-heading">
                  <p className="cbf-section-label">Company Tickets <span className="cbf-section-sub">closed by the company, not an employee</span></p>
                </div>
                <div className="cbf-ticket-pair">
                  <div className="cbf-ticket-card">
                    <label className="cbf-ticket-field">
                      <span className="cbf-ticket-type">Installation</span>
                      <span className="cbf-ticket-input-wrap">
                        <input
                          className="cbf-ticket-input"
                          min="0"
                          type="number"
                          value={values.company_install_tickets}
                          onChange={(event) => setValues({ ...values, company_install_tickets: String(Math.max(0, Number(event.target.value) || 0)) })}
                        />
                      </span>
                    </label>
                  </div>
                  <div className="cbf-ticket-card">
                    <label className="cbf-ticket-field">
                      <span className="cbf-ticket-type">Repair</span>
                      <span className="cbf-ticket-input-wrap">
                        <input
                          className="cbf-ticket-input"
                          min="0"
                          type="number"
                          value={values.company_repair_tickets}
                          onChange={(event) => setValues({ ...values, company_repair_tickets: String(Math.max(0, Number(event.target.value) || 0)) })}
                        />
                      </span>
                    </label>
                  </div>
                </div>
                <div className="cbf-section-heading">
                  <p className="cbf-section-label">Disputed <span className="cbf-section-sub">deducted from billable</span></p>
                </div>
                <div className="cbf-ticket-pair">
                  <div className="cbf-ticket-card cbf-ticket-card--dispute">
                    <label className="cbf-ticket-field">
                      <span className="cbf-ticket-type">Installation</span>
                      <span className="cbf-ticket-input-wrap">
                        <input
                          className="cbf-ticket-input cbf-ticket-input--dispute"
                          disabled={companyInstallTickets === 0}
                          max={companyInstallTickets}
                          min="0"
                          type="number"
                          value={String(companyDisputedInstall)}
                          onChange={(event) => setValues({ ...values, company_disputed_install: String(Math.max(0, Math.min(companyInstallTickets, Number(event.target.value) || 0))) })}
                        />
                      </span>
                    </label>
                  </div>
                  <div className="cbf-ticket-card cbf-ticket-card--dispute">
                    <label className="cbf-ticket-field">
                      <span className="cbf-ticket-type">Repair</span>
                      <span className="cbf-ticket-input-wrap">
                        <input
                          className="cbf-ticket-input cbf-ticket-input--dispute"
                          disabled={companyRepairTickets === 0}
                          max={companyRepairTickets}
                          min="0"
                          type="number"
                          value={String(companyDisputedRepair)}
                          onChange={(event) => setValues({ ...values, company_disputed_repair: String(Math.max(0, Math.min(companyRepairTickets, Number(event.target.value) || 0))) })}
                        />
                      </span>
                    </label>
                  </div>
                </div>
              </section>

              <section className="cbf-section cbf-section-card cbf-section--dispute">
                <div className="cbf-section-heading">
                  <p className="cbf-section-label">Disputed Totals <span className="cbf-section-sub">deducted from billable</span></p>
                </div>
                <div className="cbf-dispute-summary">
                  <div className="cbf-dispute-summary-item">
                    <span>Installation tickets</span>
                    <strong>{installTickets}</strong>
                  </div>
                  <div className="cbf-dispute-summary-item">
                    <span>Repair tickets</span>
                    <strong>{repairTickets}</strong>
                  </div>
                </div>
                <div className="cbf-ticket-pair">
                  <div className="cbf-ticket-card cbf-ticket-card--dispute">
                    <label className="cbf-ticket-field">
                      <span className="cbf-ticket-type">Installation</span>
                      <span className="cbf-ticket-input-wrap">
                        <input
                          className="cbf-ticket-input cbf-ticket-input--dispute"
                          disabled={installTickets === 0}
                          max={installTickets}
                          min="0"
                          type="number"
                          value={String(disputedInstall)}
                          onChange={(event) => setValues({ ...values, disputed_install: String(Math.max(0, Math.min(installTickets, Number(event.target.value) || 0))) })}
                        />
                      </span>
                    </label>
                  </div>
                  <div className="cbf-ticket-card cbf-ticket-card--dispute">
                    <label className="cbf-ticket-field">
                      <span className="cbf-ticket-type">Repair</span>
                      <span className="cbf-ticket-input-wrap">
                        <input
                          className="cbf-ticket-input cbf-ticket-input--dispute"
                          disabled={repairTickets === 0}
                          max={repairTickets}
                          min="0"
                          type="number"
                          value={String(disputedRepair)}
                          onChange={(event) => setValues({ ...values, disputed_repair: String(Math.max(0, Math.min(repairTickets, Number(event.target.value) || 0))) })}
                        />
                      </span>
                    </label>
                  </div>
                </div>
              </section>

              <section className="cbf-section cbf-section-card">
                <div className="cbf-section-heading">
                  <p className="cbf-section-label">Subcontractor Tickets</p>
                </div>
```

Replace with:

```tsx
          <div className="cbf-stepper">
            {WIZARD_STEPS.map((wizardStep) => (
              <button
                className={`cbf-step${step === wizardStep.id ? " cbf-step--active" : ""}${step > wizardStep.id ? " cbf-step--done" : ""}`}
                key={wizardStep.id}
                onClick={() => setStep(wizardStep.id)}
                type="button"
              >
                <span className="cbf-step-line" />
                <span className="cbf-step-circle">{step > wizardStep.id ? <CheckCircle2 size={16} /> : wizardStep.id}</span>
                <span className="cbf-step-label">{wizardStep.label}</span>
              </button>
            ))}
          </div>

          {step === 1 && (
            <div className="cbf-step-panel">
              <div className="cbf-step-panel--narrow">
                <section className="cbf-section cbf-section-card">
                  <div className="cbf-section-heading">
                    <p className="cbf-section-label">Billing Period</p>
                  </div>
                  <div className="cbf-period-row">
                    <select className="cbf-select" value={values.billing_month} onChange={(event) => setValues({ ...values, billing_month: event.target.value })}>
                      {monthNames.map((name, index) => <option key={name} value={String(index + 1)}>{name}</option>)}
                    </select>
                    <input
                      className="cbf-input cbf-year-input"
                      max="2200"
                      min="2020"
                      onChange={(event) => setValues({ ...values, billing_year: event.target.value })}
                      required
                      type="number"
                      value={values.billing_year}
                    />
                  </div>
                  <div className="cbf-half-toggle">
                    <button
                      className={values.billing_period === "first_half" ? "cbf-half-btn cbf-half-btn--active" : "cbf-half-btn"}
                      onClick={() => setValues({ ...values, billing_period: "first_half" })}
                      type="button"
                    >
                      1st - 15th
                    </button>
                    <button
                      className={values.billing_period === "second_half" ? "cbf-half-btn cbf-half-btn--active" : "cbf-half-btn"}
                      onClick={() => setValues({ ...values, billing_period: "second_half" })}
                      type="button"
                    >
                      16th - End
                    </button>
                  </div>
                  <div className="cbf-due-date-row">
                    <label className="cbf-field-label" htmlFor="billing-due-date">Due date</label>
                    <input
                      className="cbf-input"
                      id="billing-due-date"
                      onChange={(event) => setValues({ ...values, due_date: event.target.value })}
                      type="date"
                      value={values.due_date}
                    />
                  </div>
                </section>

                <section className="cbf-section cbf-section-card">
                  <label className="cbf-section-label">
                    Notes <span className="cbf-section-sub">optional</span>
                    <textarea className="cbf-textarea" rows={2} value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} />
                  </label>
                </section>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="cbf-step-panel">
              <section className="cbf-section cbf-section-card">
                <div className="cbf-section-heading">
                  <p className="cbf-section-label">Ticket Sources</p>
                </div>
                <div className="billing-ticket-source-grid">
                  <div className="billing-ticket-source-card">
                    <span className="billing-ticket-source-title">Employees</span>
                    <strong className="billing-ticket-source-total">{employeeCounts.installation + employeeCounts.repair}</strong>
                    <div className="billing-ticket-source-breakdown">
                      <small>Install: {employeeCounts.installation}</small>
                      <small>Repair: {employeeCounts.repair}</small>
                    </div>
                  </div>
                  <div className="billing-ticket-source-card">
                    <span className="billing-ticket-source-title">Subcontractors</span>
                    <strong className="billing-ticket-source-total">{subconInstall + subconRepair}</strong>
                    <div className="billing-ticket-source-breakdown">
                      <small>Install: {subconInstall}</small>
                      <small>Repair: {subconRepair}</small>
                    </div>
                  </div>
                  <div className="billing-ticket-source-card">
                    <span className="billing-ticket-source-title">Company</span>
                    <strong className="billing-ticket-source-total">{companyInstallTickets + companyRepairTickets}</strong>
                    <div className="billing-ticket-source-breakdown">
                      <small>Install: {companyInstallTickets}</small>
                      <small>Repair: {companyRepairTickets}</small>
                    </div>
                  </div>
                  <div className="billing-ticket-source-card emphasis">
                    <span className="billing-ticket-source-title">Combined</span>
                    <strong className="billing-ticket-source-total">{combinedInstallTickets + combinedRepairTickets}</strong>
                    <div className="billing-ticket-source-breakdown">
                      <small>Install: {combinedInstallTickets}</small>
                      <small>Repair: {combinedRepairTickets}</small>
                    </div>
                  </div>
                </div>
              </section>

              <section className="cbf-section cbf-section-card">
                <div className="cbf-section-heading">
                  <p className="cbf-section-label">Employee Tickets</p>
                </div>
                <div className="billing-details-section-head">
                  <div>
                    <h4>Employee Ticket Reference</h4>
                    <p>Closed employee tickets included in this billing period.</p>
                  </div>
                  <strong>{employeeDisplayTickets} tickets · {currency.format(employeeDisplayGross)}</strong>
                </div>
                <div className="billing-details-table-wrap">
                  <table className="billing-details-table billing-employee-reference-table">
                    <colgroup>
                      <col className="col-employee" />
                      <col className="col-ins" />
                      <col className="col-rep" />
                      <col className="col-tot" />
                      <col className="col-gross" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th className="billing-col-center"><span className="tbl-label-full">Install</span><span className="tbl-label-abbr">Ins</span></th>
                        <th className="billing-col-center"><span className="tbl-label-full">Repair</span><span className="tbl-label-abbr">Rep</span></th>
                        <th className="billing-col-center"><span className="tbl-label-full">Total</span><span className="tbl-label-abbr">Tot</span></th>
                        <th className="billing-col-right">Gross</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employeeRows.length === 0 ? (
                        <tr><td className="collection-empty" colSpan={5}>No employee ticket entries for this period.</td></tr>
                      ) : employeeRows.map((row) => (
                        <tr key={row.employeeId}>
                          <td className="billing-col-left" data-label="Employee">{row.employeeName}</td>
                          <td className="billing-col-center" data-label="Install">{row.install}</td>
                          <td className="billing-col-center" data-label="Repair">{row.repair}</td>
                          <td className="billing-col-center" data-label="Total">{row.install + row.repair}</td>
                          <td className="billing-col-right" data-label="Gross">{currency.format(row.gross)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="cbf-section cbf-section-card">
                <div className="cbf-section-heading">
                  <p className="cbf-section-label">Company Tickets <span className="cbf-section-sub">closed by the company, not an employee</span></p>
                </div>
                <div className="cbf-ticket-pair">
                  <div className="cbf-ticket-card">
                    <label className="cbf-ticket-field">
                      <span className="cbf-ticket-type">Installation</span>
                      <span className="cbf-ticket-input-wrap">
                        <input
                          className="cbf-ticket-input"
                          min="0"
                          type="number"
                          value={values.company_install_tickets}
                          onChange={(event) => setValues({ ...values, company_install_tickets: String(Math.max(0, Number(event.target.value) || 0)) })}
                        />
                      </span>
                    </label>
                  </div>
                  <div className="cbf-ticket-card">
                    <label className="cbf-ticket-field">
                      <span className="cbf-ticket-type">Repair</span>
                      <span className="cbf-ticket-input-wrap">
                        <input
                          className="cbf-ticket-input"
                          min="0"
                          type="number"
                          value={values.company_repair_tickets}
                          onChange={(event) => setValues({ ...values, company_repair_tickets: String(Math.max(0, Number(event.target.value) || 0)) })}
                        />
                      </span>
                    </label>
                  </div>
                </div>
                <div className="cbf-section-heading">
                  <p className="cbf-section-label">Disputed <span className="cbf-section-sub">deducted from billable</span></p>
                </div>
                <div className="cbf-ticket-pair">
                  <div className="cbf-ticket-card cbf-ticket-card--dispute">
                    <label className="cbf-ticket-field">
                      <span className="cbf-ticket-type">Installation</span>
                      <span className="cbf-ticket-input-wrap">
                        <input
                          className="cbf-ticket-input cbf-ticket-input--dispute"
                          disabled={companyInstallTickets === 0}
                          max={companyInstallTickets}
                          min="0"
                          type="number"
                          value={String(companyDisputedInstall)}
                          onChange={(event) => setValues({ ...values, company_disputed_install: String(Math.max(0, Math.min(companyInstallTickets, Number(event.target.value) || 0))) })}
                        />
                      </span>
                    </label>
                  </div>
                  <div className="cbf-ticket-card cbf-ticket-card--dispute">
                    <label className="cbf-ticket-field">
                      <span className="cbf-ticket-type">Repair</span>
                      <span className="cbf-ticket-input-wrap">
                        <input
                          className="cbf-ticket-input cbf-ticket-input--dispute"
                          disabled={companyRepairTickets === 0}
                          max={companyRepairTickets}
                          min="0"
                          type="number"
                          value={String(companyDisputedRepair)}
                          onChange={(event) => setValues({ ...values, company_disputed_repair: String(Math.max(0, Math.min(companyRepairTickets, Number(event.target.value) || 0))) })}
                        />
                      </span>
                    </label>
                  </div>
                </div>
              </section>

              <section className="cbf-section cbf-section-card cbf-section--dispute">
                <div className="cbf-section-heading">
                  <p className="cbf-section-label">Disputed Totals <span className="cbf-section-sub">deducted from billable</span></p>
                </div>
                <div className="cbf-dispute-summary">
                  <div className="cbf-dispute-summary-item">
                    <span>Installation tickets</span>
                    <strong>{installTickets}</strong>
                  </div>
                  <div className="cbf-dispute-summary-item">
                    <span>Repair tickets</span>
                    <strong>{repairTickets}</strong>
                  </div>
                </div>
                <div className="cbf-ticket-pair">
                  <div className="cbf-ticket-card cbf-ticket-card--dispute">
                    <label className="cbf-ticket-field">
                      <span className="cbf-ticket-type">Installation</span>
                      <span className="cbf-ticket-input-wrap">
                        <input
                          className="cbf-ticket-input cbf-ticket-input--dispute"
                          disabled={installTickets === 0}
                          max={installTickets}
                          min="0"
                          type="number"
                          value={String(disputedInstall)}
                          onChange={(event) => setValues({ ...values, disputed_install: String(Math.max(0, Math.min(installTickets, Number(event.target.value) || 0))) })}
                        />
                      </span>
                    </label>
                  </div>
                  <div className="cbf-ticket-card cbf-ticket-card--dispute">
                    <label className="cbf-ticket-field">
                      <span className="cbf-ticket-type">Repair</span>
                      <span className="cbf-ticket-input-wrap">
                        <input
                          className="cbf-ticket-input cbf-ticket-input--dispute"
                          disabled={repairTickets === 0}
                          max={repairTickets}
                          min="0"
                          type="number"
                          value={String(disputedRepair)}
                          onChange={(event) => setValues({ ...values, disputed_repair: String(Math.max(0, Math.min(repairTickets, Number(event.target.value) || 0))) })}
                        />
                      </span>
                    </label>
                  </div>
                </div>
              </section>

              <section className="cbf-section cbf-section-card">
                <div className="cbf-section-heading">
                  <p className="cbf-section-label">Subcontractor Tickets</p>
                </div>
```

- [ ] **Step 5: Run a build check after Step 4** (there will be unbalanced JSX until Step 6 closes the panels below — this is expected; do not run the build yet, proceed to Step 6 first).

- [ ] **Step 6: Close step 2, add the invoice-format step 3, and rebuild the footer**

Find (the remainder of the original body: the Subcontractor Tickets table contents, the old Notes section, and the entire old `.cbf-right` statement panel plus the old `.cbf-actions` footer):

```tsx
                <div className="billing-subcon-form-scroll">
                  <div className="billing-subcon-form-table">
                  <div className="billing-subcon-form-head">
                    <span><span className="tbl-label-full">Subcontractor</span><span className="tbl-label-abbr">Subcon</span></span>
                    <span><span className="tbl-label-full">Install</span><span className="tbl-label-abbr">Ins</span></span>
                    <span><span className="tbl-label-full">Repair</span><span className="tbl-label-abbr">Rep</span></span>
                    <span><span className="tbl-label-full">Disputed Install</span><span className="tbl-label-abbr">D.Ins</span></span>
                    <span><span className="tbl-label-full">Disputed Repair</span><span className="tbl-label-abbr">D.Rep</span></span>
                    <span><span className="tbl-label-full">Net Amount</span><span className="tbl-label-abbr">Net</span></span>
                    <span><span className="tbl-label-full">Collectibles Amount</span><span className="tbl-label-abbr">Collect</span></span>
                  </div>
                  {values.subcon_items.length === 0 ? (
                    <div className="billing-subcon-form-empty">No active subcontractors yet.</div>
                  ) : (
                    values.subcon_items.map((item, index) => {
                      const itemInstallTickets = Number(item.install_tickets) || 0;
                      const itemRepairTickets = Number(item.repair_tickets) || 0;
                      const itemDisputedInstall = Math.max(0, Math.min(itemInstallTickets, Number(item.disputed_install) || 0));
                      const itemDisputedRepair = Math.max(0, Math.min(itemRepairTickets, Number(item.disputed_repair) || 0));
                      const computed = computeSubconItem(
                        itemInstallTickets,
                        itemRepairTickets,
                        itemDisputedInstall,
                        itemDisputedRepair,
                        Number(item.installation_rate) || 0,
                        Number(item.repair_rate) || 0,
                        Number(item.payable_pct) || 0,
                      );
                      return (
                        <div className="billing-subcon-form-row" key={item.subcontractor_id}>
                          <div className="billing-subcon-name-cell">
                            <strong>{item.subcon_name}</strong>
                            <span>Install rate: {currency.format(Number(item.installation_rate) || 0)}</span>
                            <span>Repair rate: {currency.format(Number(item.repair_rate) || 0)}</span>
                          </div>
                          <div className="billing-subcon-inline-values"><span>{item.install_tickets}</span></div>
                          <div className="billing-subcon-inline-values"><span>{item.repair_tickets}</span></div>
                          <div className="billing-subcon-dispute-cell">
                            <input
                              disabled={itemInstallTickets === 0}
                              max={itemInstallTickets}
                              min="0"
                              type="number"
                              value={String(itemDisputedInstall)}
                              onChange={(event) => updateSubconItem(index, { disputed_install: String(Math.max(0, Math.min(itemInstallTickets, Number(event.target.value) || 0))) })}
                            />
                          </div>
                          <div className="billing-subcon-dispute-cell">
                            <input
                              disabled={itemRepairTickets === 0}
                              max={itemRepairTickets}
                              min="0"
                              type="number"
                              value={String(itemDisputedRepair)}
                              onChange={(event) => updateSubconItem(index, { disputed_repair: String(Math.max(0, Math.min(itemRepairTickets, Number(event.target.value) || 0))) })}
                            />
                          </div>
                          <div className="billing-subcon-amount">
                            <strong>{currency.format(computed.billingAmount)}</strong>
                            <span>{computed.billableTickets} billable tickets</span>
                          </div>
                          <div className="billing-subcon-amount billing-subcon-amount-payable">
                            <strong>{currency.format(computed.payableAmount)}</strong>
                            <span>{item.payable_pct}% payable</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                </div>
              </section>

              <section className="cbf-section cbf-section-card">
                <label className="cbf-section-label">
                  Notes <span className="cbf-section-sub">optional</span>
                  <textarea className="cbf-textarea" rows={2} value={values.notes} onChange={(event) => setValues({ ...values, notes: event.target.value })} />
                </label>
              </section>
            </div>

            <div className="cbf-right">
              <div className="cbf-statement">
                <div className="cbf-stmt-head">
                  <div>
                    <p className="cbf-stmt-period">{monthNames[Number(values.billing_month) - 1]} {values.billing_year}</p>
                    <p className="cbf-stmt-half">{billingPeriodLabel(values.billing_period)}</p>
                  </div>
                  <span className="cbf-draft-badge">Draft</span>
                </div>
                <div className="cbf-stmt-body">
                  <div className="cbf-stmt-hero">
                    <span className="cbf-stmt-hero-label">Total Billable</span>
                    <strong className="cbf-stmt-hero-amount">{currency.format(billingAmount)}</strong>
                  </div>
                  <div className="cbf-stmt-group">
                    <p className="cbf-stmt-group-label">Billable Breakdown</p>
                    <div className="cbf-stmt-row"><span>Install: {billableInstall} tickets</span><span>{currency.format(billableInstall * settings.installation_rate)}</span></div>
                    <div className="cbf-stmt-row"><span>Repair: {billableRepair} tickets</span><span>{currency.format(billableRepair * settings.repair_rate)}</span></div>
                    <div className="cbf-stmt-row cbf-stmt-row--total"><span>Total tickets</span><span>{billableTickets}</span></div>
                  </div>
                  <div className="cbf-stmt-group">
                    <p className="cbf-stmt-group-label">Subcontractor payout</p>
                    <div className="cbf-stmt-row"><span>Rows</span><span>{values.subcon_items.length}</span></div>
                    <div className="cbf-stmt-row"><span>Pending payable total</span><span>{currency.format(totalSubconNet)}</span></div>
                  </div>
                  <div className="cbf-stmt-group">
                    <p className="cbf-stmt-group-label">Split</p>
                    <div className="cbf-split-labels">
                      <div className="cbf-split-item cbf-split-item--collection">
                      <div>
                        <p className="cbf-split-label">Collection</p>
                        <strong className="cbf-split-amount">{currency.format(collectionsAmount)}</strong>
                      </div>
                      </div>
                      <div className="cbf-split-item cbf-split-item--payable">
                      <div>
                        <p className="cbf-split-label">Collectibles</p>
                        <strong className="cbf-split-amount">{currency.format(collectiblesAmount)}</strong>
                      </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="cbf-actions">
            <button className="cbf-btn-cancel" disabled={busy} onClick={onClose} type="button">Cancel</button>
            <button className="cbf-btn-submit" disabled={busy} type="submit">{busy ? "Saving..." : initial ? "Update Billing" : "Create Billing"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

Replace with:

```tsx
                <div className="billing-subcon-form-scroll">
                  <div className="billing-subcon-form-table">
                  <div className="billing-subcon-form-head">
                    <span><span className="tbl-label-full">Subcontractor</span><span className="tbl-label-abbr">Subcon</span></span>
                    <span><span className="tbl-label-full">Install</span><span className="tbl-label-abbr">Ins</span></span>
                    <span><span className="tbl-label-full">Repair</span><span className="tbl-label-abbr">Rep</span></span>
                    <span><span className="tbl-label-full">Disputed Install</span><span className="tbl-label-abbr">D.Ins</span></span>
                    <span><span className="tbl-label-full">Disputed Repair</span><span className="tbl-label-abbr">D.Rep</span></span>
                    <span><span className="tbl-label-full">Net Amount</span><span className="tbl-label-abbr">Net</span></span>
                    <span><span className="tbl-label-full">Collectibles Amount</span><span className="tbl-label-abbr">Collect</span></span>
                  </div>
                  {values.subcon_items.length === 0 ? (
                    <div className="billing-subcon-form-empty">No active subcontractors yet.</div>
                  ) : (
                    values.subcon_items.map((item, index) => {
                      const itemInstallTickets = Number(item.install_tickets) || 0;
                      const itemRepairTickets = Number(item.repair_tickets) || 0;
                      const itemDisputedInstall = Math.max(0, Math.min(itemInstallTickets, Number(item.disputed_install) || 0));
                      const itemDisputedRepair = Math.max(0, Math.min(itemRepairTickets, Number(item.disputed_repair) || 0));
                      const computed = computeSubconItem(
                        itemInstallTickets,
                        itemRepairTickets,
                        itemDisputedInstall,
                        itemDisputedRepair,
                        Number(item.installation_rate) || 0,
                        Number(item.repair_rate) || 0,
                        Number(item.payable_pct) || 0,
                      );
                      return (
                        <div className="billing-subcon-form-row" key={item.subcontractor_id}>
                          <div className="billing-subcon-name-cell">
                            <strong>{item.subcon_name}</strong>
                            <span>Install rate: {currency.format(Number(item.installation_rate) || 0)}</span>
                            <span>Repair rate: {currency.format(Number(item.repair_rate) || 0)}</span>
                          </div>
                          <div className="billing-subcon-inline-values"><span>{item.install_tickets}</span></div>
                          <div className="billing-subcon-inline-values"><span>{item.repair_tickets}</span></div>
                          <div className="billing-subcon-dispute-cell">
                            <input
                              disabled={itemInstallTickets === 0}
                              max={itemInstallTickets}
                              min="0"
                              type="number"
                              value={String(itemDisputedInstall)}
                              onChange={(event) => updateSubconItem(index, { disputed_install: String(Math.max(0, Math.min(itemInstallTickets, Number(event.target.value) || 0))) })}
                            />
                          </div>
                          <div className="billing-subcon-dispute-cell">
                            <input
                              disabled={itemRepairTickets === 0}
                              max={itemRepairTickets}
                              min="0"
                              type="number"
                              value={String(itemDisputedRepair)}
                              onChange={(event) => updateSubconItem(index, { disputed_repair: String(Math.max(0, Math.min(itemRepairTickets, Number(event.target.value) || 0))) })}
                            />
                          </div>
                          <div className="billing-subcon-amount">
                            <strong>{currency.format(computed.billingAmount)}</strong>
                            <span>{computed.billableTickets} billable tickets</span>
                          </div>
                          <div className="billing-subcon-amount billing-subcon-amount-payable">
                            <strong>{currency.format(computed.payableAmount)}</strong>
                            <span>{item.payable_pct}% payable</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                </div>
              </section>
            </div>
          )}

          {step === 3 && (
            <div className="cbf-step-panel">
              <div className="cbf-invoice">
                <h3 className="cbf-invoice-title">Billing Statement</h3>

                <p className="cbf-invoice-section-label">Client Information</p>
                <p className="cbf-invoice-line"><b>Billed To:</b></p>
                <p className="cbf-invoice-line"><b>Name:</b> {settings.client_name || "—"}</p>

                <hr className="cbf-invoice-hr" />

                <p className="cbf-invoice-section-label">Billing Information</p>
                <div className="cbf-invoice-meta">
                  <span className="cbf-invoice-meta-label">Date of Issue:</span>
                  <span className="cbf-invoice-meta-val">{statementDate}</span>
                  <span className="cbf-invoice-meta-label">Billing Statement No.:</span>
                  <span className="cbf-invoice-meta-val">
                    {initial ? initial.invoice_no : <span className="cbf-invoice-draft">DRAFT — assigned on save</span>}
                  </span>
                  <span className="cbf-invoice-meta-label">Due Date:</span>
                  <span className="cbf-invoice-meta-val">{values.due_date ? formatStatementDate(values.due_date) : "—"}</span>
                  <span className="cbf-invoice-meta-label">Period:</span>
                  <span className="cbf-invoice-meta-val">{statementPeriodLabel}</span>
                </div>

                <hr className="cbf-invoice-hr" />

                <p className="cbf-invoice-section-label">Itemized Charges</p>
                <table className="cbf-invoice-table">
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th className="cbf-invoice-num">Quantity</th>
                      <th className="cbf-invoice-num">Unit Price</th>
                      <th className="cbf-invoice-num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="cbf-invoice-desc">Installation Tickets</td>
                      <td className="cbf-invoice-num">{billableInstall}</td>
                      <td className="cbf-invoice-num">{currency.format(settings.installation_rate)}</td>
                      <td className="cbf-invoice-num">{currency.format(billableInstall * settings.installation_rate)}</td>
                    </tr>
                    <tr>
                      <td className="cbf-invoice-desc">Repair Tickets</td>
                      <td className="cbf-invoice-num">{billableRepair}</td>
                      <td className="cbf-invoice-num">{currency.format(settings.repair_rate)}</td>
                      <td className="cbf-invoice-num">{currency.format(billableRepair * settings.repair_rate)}</td>
                    </tr>
                    <tr className="cbf-invoice-subtotal-row">
                      <td colSpan={3}>Subtotal</td>
                      <td className="cbf-invoice-num">{currency.format(billingAmount)}</td>
                    </tr>
                    <tr className="cbf-invoice-grand-row">
                      <td colSpan={3}>Total Amount Due</td>
                      <td className="cbf-invoice-num">{currency.format(billingAmount)}</td>
                    </tr>
                  </tbody>
                </table>

                <div className="cbf-invoice-note">
                  <span className="cbf-invoice-note-label">Payment split (internal tracking)</span>
                  <div className="cbf-invoice-note-row"><span>Collection</span><span>{currency.format(collectionsAmount)}</span></div>
                  <div className="cbf-invoice-note-row"><span>Collectibles</span><span>{currency.format(collectiblesAmount)}</span></div>
                  <div className="cbf-invoice-note-row"><span>Subcontractor payout (not billed to client)</span><span>{currency.format(totalSubconNet)}</span></div>
                </div>
              </div>
            </div>
          )}

          <div className="cbf-actions">
            <button className="cbf-btn-cancel" disabled={busy} onClick={onClose} type="button">Cancel</button>
            <div className="cbf-nav-right">
              {step > 1 && (
                <button className="cbf-btn-back" disabled={busy} onClick={() => setStep((current) => (current - 1) as 1 | 2 | 3)} type="button">Back</button>
              )}
              {step < 3 ? (
                <button className="cbf-btn-next" disabled={busy} onClick={() => setStep((current) => (current + 1) as 1 | 2 | 3)} type="button">Next</button>
              ) : (
                <button className="cbf-btn-submit" disabled={busy} type="submit">{busy ? "Saving..." : initial ? "Update Billing" : "Create Billing"}</button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
```

Note: `billableTickets` (total tickets count) is no longer displayed anywhere after this change — it was only used in the old statement panel's "Total tickets" row, which the itemized-charges table replaces (Installation + Repair rows already show quantities). It remains a computed variable used nowhere else in the component; leave its declaration in place (Task keeps `const billableTickets = ...` untouched since removing it isn't required and it may still be useful context for a future reader) — do NOT delete that line, only the JSX that displayed it.

- [ ] **Step 7: Run the build to check for TypeScript/JSX errors**

Run: `npm run build`
Expected: exits 0. If it fails, the most likely cause is a JSX tag mismatch from Step 4/6 (an unclosed `<div>` or extra `</div>`) — compare brace/tag counts against the original 1453-2080 span before these edits.

- [ ] **Step 8: Run the existing test suite to confirm no regressions**

Run: `npm test`
Expected: all 120 tests still pass (this change touches no `src/domain/**` files, so this is a regression check, not new coverage).

- [ ] **Step 9: Commit**

```bash
git add src/features/billing/BillingFeature.tsx
git commit -m "$(cat <<'EOF'
Redesign New/Edit Billing dialog into a 3-step wizard

Splits the single scrollable two-column form into Billing Details ->
Review Tickets -> Billable Summary, with a clickable step indicator
and Back/Next navigation. Step 3 is restyled as an itemized billing
statement (client info, billing info, itemized charges, totals)
instead of the old always-visible stat-card sidebar. No computation
changes -- every displayed value was already computed in this
component.
EOF
)"
```

---

### Task 3: Manual verification

**Files:** none (verification only).

**Interfaces:**
- Consumes: the running dev server (`npm run dev`) and the app's live Supabase data, via Playwright browser tools.

**Important:** This app is connected to a real production Supabase project (see `.env`). Do NOT click "Create Billing" or "Update Billing" during this verification — that would create or mutate a real billing record. Verify by navigating and reading values only, then close the dialog via Cancel or the X button.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (in background)
Expected: prints a `Local: http://localhost:5173/` (or next available port) URL.

- [ ] **Step 2: Open New Billing and walk through all 3 steps**

Using Playwright (`mcp__playwright__browser_navigate` to `/billing`, then click "New Billing"):
- Confirm the stepper shows 3 pills: "Billing Details" (active/highlighted), "Review Tickets", "Billable Summary".
- Confirm only Billing Period, Due date, and Notes are visible — no ticket tables, no statement panel.
- Click **Next**. Confirm step 2 shows Ticket Sources, Employee Ticket Reference, Company Tickets, Disputed Totals, Subcontractor Tickets — and step 1's fields are no longer visible.
- Click **Next** again. Confirm step 3 shows the invoice-style "Billing Statement": Client Information (client name), Billing Information (Date of Issue, "DRAFT — assigned on save" badge, Due Date, Period), Itemized Charges table with Installation/Repair rows, Subtotal, Total Amount Due, and the Payment split note (Collection/Collectibles/Subcontractor payout).
- Note the Total Amount Due value shown.
- Click the "Billing Details" pill directly. Confirm it jumps back to step 1 (pill navigation works, not just Back/Next).
- Click **Next** twice to return to step 3. Confirm the Total Amount Due is the same value as before (data wasn't lost navigating back and forth).
- Click **Back** once. Confirm it returns to step 2.
- Close the dialog via **Cancel** (not submit).

- [ ] **Step 3: Open Edit Billing on an existing record and spot-check step 3 against pre-change numbers**

If any billing records exist (check the Billing list): open one for editing, navigate to step 3, and confirm:
- "Billing Statement No." shows the record's real `invoice_no` (not the DRAFT badge).
- "Date of Issue" shows the record's creation date.
- Total Amount Due matches `billing_amount` shown elsewhere for that record (e.g. in the Billing list row).
Close via Cancel (not Update).

- [ ] **Step 4: Check for console errors**

Use `mcp__playwright__browser_console_messages` with `level: "error"` after the above steps.
Expected: 0 errors introduced by this change.

- [ ] **Step 5: Stop the dev server**

Stop the background `npm run dev` process started in Step 1.
