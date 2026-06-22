# Employee Details Page Redesign

## Summary

Redesign the EmployeeDetailsView from a hero + tabs vertical stack to a compact single-row header + pill tabs + full-width content layout. No sidebar. Clean, modern SaaS styling with better whitespace, typography, and visual hierarchy.

## Layout Structure

### Desktop (>= 768px)

```
┌──────────────────────────────────────────────────────────────┐
│ [←] [Avatar Name · Status] [Position · Dept · Reassign] [Stats] │
│ ──────────────────────────────────────────────────────────── │
│ [Info] [Payroll] [Tickets] [Bond] [Payments] [Documents]    │
│                                                              │
│ Tab content (full width)                                     │
└──────────────────────────────────────────────────────────────┘
```

### Mobile (< 768px)

Header wraps to two rows — identity on top, stats below. Tabs scroll horizontally. Content full-width.

## Header Row

A single compact row replacing the current hero section. Contents left to right:

- **Back button:** arrow icon, navigates to employee list
- **Avatar:** 40px circle, initials fallback (current logic)
- **Name + Status:** employee full_name (bold, 16px) + status pill inline
- **Position block:** position name · department · "Reassign" link button
- **Stat chips:** 2-3 compact rounded chips showing:
  - Total Net Pay (from payroll history)
  - Pending Pay
  - Closed Tickets (total from payroll ticket history)

The header has a white background, bottom border, and sits flush above the tab bar. No box shadow — just a clean 1px border-bottom.

### CSS approach

```
.emp-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 22px;
  background: var(--color-surface);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
}
```

Stats push to the right with `margin-left: auto`. On mobile, `flex-wrap: wrap` lets it flow to two rows.

## Tab Bar

Replace the current underline tabs with **pill-style segment buttons**:

- Rounded background on active tab (accent color, white text)
- No border-bottom underline
- Slightly more padding (8px 16px)
- Smooth transition on hover/active
- Horizontal scroll on mobile with `-webkit-overflow-scrolling: touch`

```
.emp-tabs button {
  border-radius: var(--radius-pill);
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  background: transparent;
  color: var(--color-text-secondary);
  border: none;
  transition: all 150ms;
}

.emp-tabs button.active {
  background: var(--color-accent);
  color: #fff;
}

.emp-tabs button:hover:not(.active) {
  background: var(--color-hover);
}
```

## Tab Content

Each tab keeps its existing data. Style changes only:

### Information tab
- Two-column grid of field items (`display: grid; grid-template-columns: 1fr 1fr; gap: 16px`)
- Each field: muted label (12px, secondary color) above, value (14px, bold) below
- Position field keeps the inline "Reassign" action (already built)
- Government IDs (SSS, PhilHealth, Pag-IBIG, TIN) grouped in a sub-section below a subtle divider
- Single column on mobile

### Payroll tab
- 3 stat chips in a row at top (Total Net, Paid, Pending) — compact rounded cards with icon + label + value
- Payroll history DataTable below, unchanged

### Tickets tab
- Position category rates table
- Ticket history table
- Same data, inherits cleaner table styles

### Salary Bond / Payments / Documents tabs
- Same content and tables, inheriting the cleaner styles

## Global Style Improvements

Applied to all tab content:

- **More whitespace:** card padding increases from 22px to 24px, gap between sections 20px
- **Lighter borders:** use `var(--color-border-light)` consistently, no heavy borders
- **Subtler shadows:** `box-shadow: 0 1px 3px rgba(0,0,0,0.04)` instead of current heavier shadow
- **Typography:** labels 12px muted, values 14px semi-bold, section headings 15px bold
- **Tables:** tighter row padding (10px 14px), alternating row background `rgba(0,0,0,0.015)`, no heavy row borders — just bottom border `1px solid var(--color-border-light)`
- **Stat chips:** consistent rounded style across all tabs — `border-radius: var(--radius-md)`, `padding: 12px 16px`, subtle left accent border for the primary stat

## Scope

**Changed:**
- `EmployeeDetailsView` component in `src/App.tsx` — restructure JSX from hero+tabs to header+pills+content
- `src/styles.css` — replace `.employee-detail-hero`, `.employee-detail-tabs`, `.employee-detail-card` styles with new `.emp-header`, `.emp-tabs`, `.emp-content` classes
- Information tab layout — switch from single-column `details-grid` to two-column grid with ID sub-section

**Not changed:**
- No data model changes
- No new components — pure CSS + JSX restructure
- Tabs keep the same 6 sections with same data
- Reassign position action stays as-is (already functional)
- Main app sidebar/nav untouched
