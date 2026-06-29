# Billing Form: Combined Ticket Totals Display

**Date:** 2026-06-29  
**Status:** Approved

## Problem

The `BillingForm` pre-fills `install_tickets` and `repair_tickets` from employee daily tickets only. Subcontractor tickets for the same period are shown as a separate reference row but are not included in the auto-filled inputs or the combined total display. The user must manually add employee + subcon counts to get the real billing total.

## Goal

When creating a billing record, the form should:
1. Display a clear combined total (employee + subcon) in the reference section.
2. Auto-fill the `Install tickets` and `Repair tickets` inputs with the combined total so the billing amount is correct without manual arithmetic.

## Design

### Auto-fill inputs with combined total

Both places that populate `install_tickets` / `repair_tickets` are updated to sum employee and subcontractor counts:

```
install_tickets = employeeCounts.installation + subconTotals.install
repair_tickets  = employeeCounts.repair        + subconTotals.repair
```

**Affected locations in `BillingForm`:**
- Initial `useState` IIFE (runs once on form open) — add inline subcon filter+reduce matching the existing `subconTotals` logic.
- `useEffect` that re-runs on `billing_month` / `billing_year` / `billing_period` change — add the same subcon calculation before calling `setValues`.

The `subconDailyTickets` prop is already available in scope for both locations.

### Combined total reference row

The existing `billing-form-ticket-ref` section has two rows: employee and subcon. A third row is added below both:

```
Employee tickets this period   Install: 50   Repair: 60   Total: 110
Subcon tickets this period     Install: 10   Repair:  5   Total:  15
──────────────────────────────────────────────────────────────────────
Combined total                 Install: 60   Repair: 65   Total: 125
```

The combined values are derived from the already-computed `employeeCounts` and `subconTotals` constants — no new data fetching needed.

### Edit mode

When `initial` (editing an existing record) is set, inputs are pre-filled from the saved record and the `useEffect` is skipped — existing behavior is preserved. The combined total row is still shown as a live reference for the current period.

### Billing calculation

No changes to `createBilling`, `updateBilling`, or any domain functions. They read from form inputs, so they automatically benefit from the corrected pre-fill.

## Files changed

| File | Change |
|------|--------|
| `src/features/billing/BillingFeature.tsx` | Update `useState` IIFE and `useEffect` to include subcon in auto-fill; add "Combined total" row to reference section |

## Out of scope

- Changing how subcontractor billing items (`billing_subcon_items`) are computed — that is a separate billing concern.
- Changing the disputed ticket logic.
- Any backend/schema changes.
