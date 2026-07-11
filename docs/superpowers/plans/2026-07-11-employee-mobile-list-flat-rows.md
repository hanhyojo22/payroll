# Employee Mobile List Flat-Row Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the existing Employees mobile card list (`EmployeeMobileCardList` in `src/App.tsx`) to match a reference screenshot: flat rows separated by divider lines (no per-row card border/shadow), a leading row number, department/role shown as pill badges instead of bullet-separated text, and the employee-ID line removed from the row's right side.

**Architecture:** Pure UI change confined to one component (`EmployeeMobileCardList`, App.tsx:5474-5534) and its CSS block (`styles.css:4638-4798`, plus `.emp-status-pill` reference at `styles.css:6629`). No new state, no data-layer changes, no new dependencies.

**Tech Stack:** React + TypeScript (App.tsx), plain CSS (styles.css), existing `lucide-react` `ChevronRight` icon.

## Global Constraints

- Scope is the mobile card list only (≤760px breakpoint). Do not touch the desktop `DataTable`/`.employee-list-panel` table markup, or the shared `Toolbar`/`search-box`/status `<select>`.
- No unit tests apply — this repo's test suite covers `src/domain/**/*.test.ts` only (per CLAUDE.md). Verification is manual: run the dev server and inspect the Employees page at a mobile viewport width.
- Preserve existing behavior: click-to-open-details and Enter/Space keyboard activation on each row, avatar photo/initials rendering, empty-state message (`emp-mobile-empty`, fixed in commit `1e8c246` — must still render correctly when the filtered list is empty).
- Follow the spec at `docs/superpowers/specs/2026-07-11-employee-mobile-list-flat-rows-design.md`.

---

### Task 1: Restyle CSS — flat divided rows, index, badges

**Files:**
- Modify: `src/styles.css:4638-4798` (`.emp-mobile-list`, `.emp-mobile-card`, `.emp-mobile-card-main`, `.emp-mobile-card-name`, `.emp-mobile-card-email`, `.emp-mobile-card-meta`, `.emp-mobile-card-dot`, `.emp-mobile-card-side`, `.emp-mobile-card-id`, `.emp-mobile-card-date`, `.emp-mobile-card-chevron`)

**Interfaces:**
- Produces: CSS classes `.emp-mobile-card-index`, `.emp-mobile-card-badges`, `.emp-mobile-card-badge` (new) — consumed by Task 2's JSX. Removes `.emp-mobile-card-meta`, `.emp-mobile-card-dot`, `.emp-mobile-card-id` (no longer referenced after Task 2).

- [ ] **Step 1: Replace the `.emp-mobile-card` block and remove now-unused rules**

Read the current block first (`src/styles.css:4651-4725`), then replace lines 4651-4724 (`.emp-mobile-card` through `.emp-mobile-card-chevron`, inclusive of `.emp-mobile-card-meta`, `.emp-mobile-card-dot`, `.emp-mobile-card-id`) with:

```css
.emp-mobile-card {
  align-items: flex-start;
  border-bottom: 1px solid var(--color-border-light);
  cursor: pointer;
  display: flex;
  gap: 12px;
  padding: 14px 0;
}

.emp-mobile-card:last-child {
  border-bottom: none;
}

.emp-mobile-card:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.emp-mobile-card-index {
  color: var(--color-text-tertiary);
  flex: 0 0 auto;
  font-size: 12px;
  padding-top: 2px;
  text-align: center;
  width: 18px;
}

.emp-mobile-card-main {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
}

.emp-mobile-card-name {
  color: var(--color-text);
  font-size: var(--font-size-sm);
  font-weight: 700;
}

.emp-mobile-card-email {
  color: var(--color-text-tertiary);
  font-size: 12px;
  margin-top: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.emp-mobile-card-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.emp-mobile-card-badge {
  background: var(--color-surface-secondary);
  border-radius: 999px;
  color: var(--color-text-secondary);
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  white-space: nowrap;
}

.emp-mobile-card-side {
  align-items: flex-end;
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 6px;
}

.emp-mobile-card-date {
  color: var(--color-text-secondary);
  font-size: 12px;
  white-space: nowrap;
}

.emp-mobile-card-chevron {
  align-self: center;
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}
```

`--color-surface-secondary` (`#f5f5f7`) is an existing token defined at `src/styles.css:22` and already used elsewhere in the file — no new token needed.

- [ ] **Step 2: Confirm the old classes are still referenced by App.tsx (expected, until Task 2)**

Run: `grep -rn "emp-mobile-card-meta\|emp-mobile-card-dot\|emp-mobile-card-id" src/App.tsx`

Expected: matches found (App.tsx still uses these class names — Task 2 removes them). This just confirms Task 2 has real work to do; no action here.

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "Restyle Employees mobile list rows as flat dividers with index/badge classes"
```

---

### Task 2: Update `EmployeeMobileCardList` JSX — index, badges, drop ID

**Files:**
- Modify: `src/App.tsx:5494-5533` (the `.emp-mobile-list` render inside `EmployeeMobileCardList`)

**Interfaces:**
- Consumes: CSS classes from Task 1 — `.emp-mobile-card-index`, `.emp-mobile-card-badges`, `.emp-mobile-card-badge`.
- Consumes existing props unchanged: `employees: Employee[]`, `employeeCodeFor: (employee: Employee) => string` (kept in the function signature for API stability even though no longer rendered in this component — still used by the desktop `DataTable` caller), `employeeInitialsFor`, `formatHireDate`, `onOpenDetails`.
- Produces: no change to the component's exported signature — `EmployeesView` (App.tsx:5454-5460) calls it with the same props, no caller changes needed.

- [ ] **Step 1: Replace the row-mapping JSX**

Read the current block first (`src/App.tsx:5494-5533`), then replace the `return (...)` block (from `return (` through the closing `);` that follows `.emp-mobile-list` map, i.e. lines 5494-5533) with:

```tsx
  return (
    <div className="emp-mobile-list">
      {employees.map((employee, index) => (
        <div
          className="emp-mobile-card"
          key={employee.id}
          onClick={() => onOpenDetails(employee)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onOpenDetails(employee);
            }
          }}
          role="button"
          tabIndex={0}
        >
          <span className="emp-mobile-card-index">{index + 1}</span>
          <div className="employee-list-avatar">
            {employee.profile_photo_url
              ? <img alt="" src={employee.profile_photo_url} />
              : <span>{employeeInitialsFor(employee)}</span>}
          </div>
          <div className="emp-mobile-card-main">
            <strong className="emp-mobile-card-name">{employee.full_name}</strong>
            <span className="emp-mobile-card-email">{employee.email || "No email"}</span>
            <div className="emp-mobile-card-badges">
              <span className="emp-mobile-card-badge">{employee.department || "Unassigned"}</span>
              <span className="emp-mobile-card-badge">{employee.role || "Unassigned"}</span>
            </div>
          </div>
          <div className="emp-mobile-card-side">
            <span className="emp-mobile-card-date">{formatHireDate(employee)}</span>
            <span className={employee.status === "active" ? "emp-status-pill active" : "emp-status-pill inactive"}>
              {employee.status === "active" ? "Active" : "Inactive"}
            </span>
          </div>
          <ChevronRight className="emp-mobile-card-chevron" size={18} />
        </div>
      ))}
    </div>
  );
}
```

This removes the `employeeCodeFor(employee)` call and the `emp-mobile-card-id` span, and replaces the meta line with the badges block. The `employeeCodeFor` parameter stays in the function's destructured props and type signature (unused within the function body is fine — TypeScript won't error on an unused destructured prop; it will only warn on genuinely unused local variables, and this one is still part of the declared prop contract). Do not remove it from the signature, since removing it would be a breaking API change to a component whose props are otherwise still passed by `EmployeesView`.

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: exits 0 (runs `tsc --noEmit && vite build`). `tsconfig.json` does not set `noUnusedLocals`/`noUnusedParameters`, so the now-unused-in-body `employeeCodeFor` destructured prop will not cause a type error.

- [ ] **Step 3: Start the dev server and visually verify**

Run: `npm run dev`

In a browser, open the app, navigate to Employees, resize the viewport to ≤760px (or use device toolbar), and confirm:
- Rows are flat with a thin bottom divider, no border/shadow/rounded corners per row, last row has no divider.
- Each row shows a number (1, 2, 3…) before the avatar.
- Department and role render as two separate small pill badges under the email.
- No `EMP-xxx` code is shown on the row.
- Date and status pill are right-aligned, stacked, followed by the chevron.
- Clicking a row and pressing Enter/Space while it's focused both open the employee details view.
- Filtering the list down to zero results still shows the "No employees yet." empty state correctly (regression check for the fix in commit `1e8c246`).

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "Redesign Employees mobile list rows with numbering and dept/role badges"
```

---

### Task 3: Final full-suite check

**Files:** none (verification only)

- [ ] **Step 1: Run the build**

Run: `npm run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 2: Run the test suite**

Run: `npm test`
Expected: all existing `src/domain/**/*.test.ts` tests still pass (this change touches no domain logic, so no test count change is expected).

- [ ] **Step 3: Confirm desktop view is untouched**

In the browser, widen the viewport above 760px and confirm the Employees page still shows the original `DataTable` with columns (No., Employee ID, Employee, Department, Position, Date Hired, Status) — unchanged from before this plan.
