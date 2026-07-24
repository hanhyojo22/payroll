# New/Edit Billing Dialog: 3-Step Wizard Redesign

## Context

`BillingForm` (`src/features/billing/BillingFeature.tsx`, ~line 1453) is the shared
component behind both the "New Billing" and "Edit Billing" dialogs (title switches
on whether `initial` is passed). Today it renders as a single scrollable two-column
form: a left column (`.cbf-left`) with every input section stacked vertically, and a
sticky right column (`.cbf-right` / `.cbf-statement`) showing the computed billing
totals at all times.

This redesign turns it into a 3-step wizard. All existing state, computed values,
and submit handling are unchanged — only the layout/JSX changes.

## Goals

- Show only the current step's content (no more permanently-visible right panel).
- Add a clickable step indicator (3 pills) plus Back/Next footer navigation.
- Final billable summary is visible only on step 3, restyled as a cloned
  Philippines-style billing statement (client info → billing info → itemized
  charges → totals) instead of the current stat-card panel.
- Applies to both New Billing and Edit Billing (same component, no fork).

## Non-goals

- No changes to computation logic (`billableInstall`, `billingAmount`,
  `collectionsAmount`, `computeSubconItem`, etc. stay exactly as they are).
- No VAT/tax field. This app has no tax concept in its data model
  (`BillingSettings` has no rate field for it, `BillingRecord` has no column for
  it). The reference image's VAT row is intentionally omitted rather than
  fabricated.
- No per-step validation gating — Next is always enabled; validation stays at
  submit time exactly as today (native `required` attrs etc.).

## Step structure

Local state: `const [step, setStep] = useState<1 | 2 | 3>(1)`, reset to `1` when the
form is (re)mounted (i.e. whenever the dialog opens for a fresh record — `key`-based
remount already used for BillingForm at the call site, so no extra reset logic
needed beyond the initial `useState`).

### Step 1 — Billing Details

Single centered column (`.wiz-step1-col`-equivalent), roomy card spacing:
- Billing Period card: month select, year input, first/second-half toggle
  (existing `cbf-period-row` / `cbf-half-toggle` markup, unchanged handlers).
- Due date field.
- Notes textarea.

Source: current lines ~1685–1729 (Billing Period) and ~2017–2022 (Notes),
relocated as-is into the Step 1 panel.

### Step 2 — Review Tickets

Full-width single column, all sections get the modal's full width now that
there's no sidebar:
- Ticket Sources overview (Employees / Subcontractors / Company / Combined cards)
  — lines ~1731–1769.
- Employee Ticket Reference table — lines ~1771–1815.
- Company Tickets inputs + Disputed inputs (employee & company) — lines
  ~1817–1938.
- Subcontractor Tickets table — lines ~1940–2015.

All existing input handlers (`setValues`, `updateSubconItem`) unchanged.

### Step 3 — Billable Summary (cloned invoice format)

Replaces the current `.cbf-statement` stat-card panel with an invoice-statement
layout, centered, max-width ~620px, matching the structure of the reference
image:

1. **Title**: "Billing Statement"
2. **Client Information**
   - "Billed To:" label
   - Name: `settings.client_name`
3. **Billing Information** (label/value pairs)
   - Date of Issue: `initial ? formatted(initial.created_at) : formatted(today)`
   - Billing Statement No.: `initial ? initial.invoice_no : "DRAFT — assigned on save"`
     (styled as a small pill/badge for the draft case, since `invoice_no` is
     generated server-side on insert and doesn't exist yet for a new record)
   - Due Date: `values.due_date`
   - Period: `${billingPeriodLabel(values.billing_period)}, ${monthNames[...]} ${values.billing_year}`
4. **Itemized Charges** table (Description | Quantity | Unit Price | Total):
   - Installation Tickets: qty `billableInstall`, unit price
     `settings.installation_rate`, total `billableInstall * settings.installation_rate`
   - Repair Tickets: qty `billableRepair`, unit price `settings.repair_rate`,
     total `billableRepair * settings.repair_rate`
   - Subtotal row: `billingAmount`
   - Total Amount Due row (visually emphasized, no VAT row): `billingAmount`
     (same value as Subtotal — there is nothing additive between them in this
     app's model)
5. **Payment split (internal tracking)** — secondary note card below the
   itemized table, not styled as part of the client-facing invoice body:
   - Collection: `collectionsAmount`
   - Collectibles: `collectiblesAmount`
   - Subcontractor payout (not billed to client): `totalSubconNet`

All values above already exist as computed variables in `BillingForm` today
(`billableInstall`, `billableRepair`, `billingAmount`, `collectionsAmount`,
`collectiblesAmount`, `totalSubconNet`) — this step only changes how they're
displayed, not how they're computed.

## Stepper header

3 clickable pills (numbered circle + label), connecting line between them:
- "1 · Billing Details", "2 · Review Tickets", "3 · Billable Summary"
- Current step: accent-colored circle/label.
- Completed steps (index < current): filled/checked style, connecting line to
  them colored.
- Clicking any pill jumps directly to that step (no gating) — sets `step` state.
- Renders above the content pane, below the existing `.cbf-header` (title/eyebrow/
  close button, unchanged).

## Footer navigation

Replaces the current `.cbf-actions` bar:
- **Cancel** — always visible, calls `onClose` (unchanged behavior).
- **Back** — hidden/disabled on step 1, decrements `step`.
- **Next** — visible on steps 1–2, increments `step`. Not a submit button (no
  `type="submit"`), just changes local `step` state.
- **Create Billing / Update Billing** — replaces Next on step 3 only; this is the
  existing submit button, unchanged (`type="submit"`, `disabled={busy}`,
  `busy ? "Saving..." : initial ? "Update Billing" : "Create Billing"`).
- `ActionProgress` (shown while `busy`) stays where it is today, above the step
  content, visible regardless of which step is active (so progress is visible
  even though the user is on step 3 when they submit — this is already the only
  step where submission can happen).

## Styling

New CSS block in `src/styles.css` (`.cbf-stepper`, `.cbf-step`, `.cbf-step-panel`,
`.cbf-invoice*`, `.cbf-nav`) built from existing design tokens (`--color-accent`,
`--color-surface`, `--radius-lg`, `--shadow-card`, `--font-size-*`) rather than
introducing new colors. Existing `.cbf-section-card`, `.cbf-section-label`, table,
and input classes are reused as-is inside steps 1–2. `.cbf-cols` / `.cbf-left` /
`.cbf-right` become unused by `BillingForm` and are removed if nothing else
references them (grep before deleting — needs a check during implementation).

Mobile breakpoints (`@media (max-width: 760px)` etc. currently targeting
`.cbf-modal`/`.cbf-cols`) get equivalent rules for the new stepper/step-panel
structure — stepper pills shrink/stack labels below a width threshold, following
the same pattern as the existing responsive rules in that section of the file.

## Testing

This is a presentational change to a component with no domain logic of its own —
`BillingForm` calls into already-tested `src/domain/billing.ts` functions. No new
`src/domain/**/*.test.ts` coverage is needed (nothing new to unit test). Verification
is manual/visual: exercise New Billing and Edit Billing through all 3 steps,
confirm Back/Next/pill navigation, confirm step 3 numbers match what the old
panel showed for the same inputs, confirm submit still creates/updates a billing
record correctly.
