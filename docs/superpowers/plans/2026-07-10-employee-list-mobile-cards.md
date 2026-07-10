# Employee List Mobile Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Employees page a purpose-built, touch-friendly card layout on mobile (≤760px) without changing the desktop table in any way.

**Architecture:** `EmployeesView` (`src/App.tsx`) already renders one `<DataTable>`. Add a sibling `EmployeeMobileCardList` component that renders the same employee rows as cards; a CSS media query shows exactly one of the two at any width. No new state, no new routes, no domain-layer changes.

**Tech Stack:** React + TypeScript (existing `App.tsx`), plain CSS (`src/styles.css`), `lucide-react` icons (already a dependency).

## Global Constraints

- The existing `<DataTable>` in `EmployeesView` must remain byte-for-byte unchanged in markup, CSS, and rendered columns — desktop must look pixel-identical to before this plan.
- The new card list only becomes visible at `max-width: 760px`, matching this page's own existing breakpoint (`styles.css` line ~4674) — not the site-wide 640px generic table-card breakpoint.
- Reuse existing design tokens and classes only: `.employee-list-avatar` (avatar circle), `.emp-status-pill.active` / `.emp-status-pill.inactive` (status badge), `var(--color-*)` / `var(--radius-*)` / `var(--shadow-*)` / `var(--font-size-*)`. No new colors.
- Tap-to-open only — the whole card opens `EmployeeDetailsView` (same as today's row click). No quick-action buttons on the card face.
- "No." (row position) is intentionally dropped from the card face — it's a list-rendering artifact, not employee data, per the approved design (`docs/superpowers/specs/2026-07-10-employee-list-mobile-cards-design.md`).
- This project's established testing convention (see `CLAUDE.md` and every prior UI-only spec in `docs/superpowers/specs/`) scopes automated tests to `src/domain/**` only. UI-only changes are verified with `npx tsc --noEmit`, the existing `npm test` suite (must stay green — confirms no accidental domain regression), and manual/agent-driven browser verification. This plan follows that convention rather than inventing new unit tests for JSX/CSS.

---

### Task 1: Extract shared hire-date formatter (pure refactor, no visible change)

**Files:**
- Modify: `src/App.tsx:5251-5262` (add helper next to `employeeCodeFor`/`employeeInitialsFor`), `src/App.tsx:5442-5447` (use the new helper instead of the inline IIFE)

**Interfaces:**
- Produces: `formatHireDate(employee: Employee): string` — a plain function, same signature style as the existing `employeeCodeFor`/`employeeInitialsFor` defined immediately above it. Task 2 imports nothing new to use it — it's a local closure passed as a prop, same pattern as those two helpers already are (see Task 2's `EmployeeMobileCardList` call site).

This is a pure extraction: the exact same three lines of logic move from an inline IIFE into a named function, called from the same call site. Output is provably identical (same code, same inputs) — no behavior changes, so no new test is needed beyond confirming the app still builds and the existing test suite stays green.

- [ ] **Step 1: Read the current code to confirm line numbers haven't shifted**

Open `src/App.tsx` around line 5251. Confirm you see:

```tsx
  const employeeCodeFor = (employee: Employee) => `EMP-${employeeNumberMap.get(employee.id) ?? "000"}`;
  const employeeInitialsFor = (employee: Employee) => employee.full_name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "E";
```

If the surrounding code differs, locate `employeeCodeFor` via search instead of trusting the line number.

- [ ] **Step 2: Add the `formatHireDate` helper right after `employeeInitialsFor`**

Insert immediately after the `employeeInitialsFor` closing line (`.toUpperCase() || "E";`):

```tsx
  const formatHireDate = (employee: Employee) => {
    if (!employee.hire_date) return "—";
    const [y, m, d] = employee.hire_date.split("-").map(Number);
    const abbr = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
    return `${abbr} ${d}, ${y}`;
  };
```

- [ ] **Step 3: Replace the inline IIFE in the table's date column with a call to the helper**

Find this block inside the `DataTable`'s `rows.map` (around line 5442):

```tsx
            (() => {
              if (!employee.hire_date) return "—";
              const [y, m, d] = employee.hire_date.split("-").map(Number);
              const abbr = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1];
              return `${abbr} ${d}, ${y}`;
            })(),
```

Replace it with:

```tsx
            formatHireDate(employee),
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 5: Run the existing test suite**

Run: `npm test`
Expected: `6 passed (6)` test files, `120 passed (120)` tests — identical to before this change (this is a UI-only file with no domain tests of its own; this step just confirms nothing else broke).

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "Extract shared hire-date formatter in EmployeesView"
```

---

### Task 2: Add `EmployeeMobileCardList` component, its CSS, and wire it in

**Files:**
- Modify: `src/App.tsx:5464` (insert new component after `EmployeesView` closes, before `export function EmployeeDetailsView`), `src/App.tsx:5427-5452` (add the new component's render call as a sibling of `<DataTable>`)
- Modify: `src/styles.css:4636` (insert base card CSS after `.employee-list-panel .record-title strong`), `src/styles.css:4695` (insert two mobile-toggle rules inside the existing `@media (max-width: 760px)` block, right before the existing `.employee-list-panel td` rule)

**Interfaces:**
- Consumes: `Employee` type (already imported at `src/App.tsx:128`), `ChevronRight` icon (already imported at `src/App.tsx:13`), `employeeCodeFor`/`employeeInitialsFor`/`formatHireDate` from Task 1, `setDetailsEmployee` (existing state setter in `EmployeesView`), `rows` (existing filtered `Employee[]` in `EmployeesView`).
- Produces: `EmployeeMobileCardList` component, rendered only inside `EmployeesView`. Nothing else depends on it.

- [ ] **Step 1: Add the `EmployeeMobileCardList` component**

In `src/App.tsx`, find the closing of `EmployeesView` — the line reading:

```tsx
      {formOpen && (
        <EmployeeForm
          initial={editing}
          onClose={closeForm}
          onSubmit={saveEmployee}
          positions={positions}
        />
      )}
    </div>
  );
}
```

Immediately after that closing `}` of `EmployeesView`, and before `export function EmployeeDetailsView({`, insert:

```tsx
function EmployeeMobileCardList({
  employees,
  employeeCodeFor,
  employeeInitialsFor,
  formatHireDate,
  onOpenDetails,
}: {
  employees: Employee[];
  employeeCodeFor: (employee: Employee) => string;
  employeeInitialsFor: (employee: Employee) => string;
  formatHireDate: (employee: Employee) => string;
  onOpenDetails: (employee: Employee) => void;
}) {
  if (employees.length === 0) {
    return <p className="emp-mobile-empty">No employees yet.</p>;
  }
  return (
    <div className="emp-mobile-list">
      {employees.map((employee) => (
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
          <div className="employee-list-avatar">
            {employee.profile_photo_url
              ? <img alt="" src={employee.profile_photo_url} />
              : <span>{employeeInitialsFor(employee)}</span>}
          </div>
          <div className="emp-mobile-card-main">
            <strong className="emp-mobile-card-name">{employee.full_name}</strong>
            <span className="emp-mobile-card-email">{employee.email || "No email"}</span>
            <span className="emp-mobile-card-meta">
              {employee.department || "Unassigned"} <span className="emp-mobile-card-dot">•</span> {employee.role || "Unassigned"}
            </span>
          </div>
          <div className="emp-mobile-card-side">
            <span className="emp-mobile-card-id">{employeeCodeFor(employee)}</span>
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

- [ ] **Step 2: Render it as a sibling of `<DataTable>`**

In `EmployeesView`'s return statement, find:

```tsx
            <span className={employee.status === "active" ? "emp-status-pill active" : "emp-status-pill inactive"} key="status">
              {employee.status === "active" ? "Active" : "Inactive"}
            </span>,
          ])}
        />
      </section>
```

Replace the `/>\n      </section>` at the end with:

```tsx
            </span>,
          ])}
        />
        <EmployeeMobileCardList
          employeeCodeFor={employeeCodeFor}
          employeeInitialsFor={employeeInitialsFor}
          employees={rows}
          formatHireDate={formatHireDate}
          onOpenDetails={setDetailsEmployee}
        />
      </section>
```

(Only the `<DataTable ... />` closing tag changes — everything above it inside `<DataTable>` stays exactly as-is.)

- [ ] **Step 3: Type-check (component will not render correctly yet — CSS is added next — but it must compile)**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 4: Add the base card CSS**

In `src/styles.css`, find:

```css
.employee-list-panel .record-title strong {
  font-weight: 400;
}
```

Immediately after its closing `}`, insert:

```css
.emp-mobile-list {
  display: none;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
}

.emp-mobile-empty {
  color: var(--color-text-secondary);
  padding: 24px 14px;
  text-align: center;
}

.emp-mobile-card {
  align-items: flex-start;
  background: var(--color-surface);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  display: flex;
  gap: 12px;
  padding: 14px;
}

.emp-mobile-card:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
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

.emp-mobile-card-meta {
  color: var(--color-text-secondary);
  font-size: 12px;
  margin-top: 8px;
}

.emp-mobile-card-dot {
  color: var(--color-border);
}

.emp-mobile-card-side {
  align-items: flex-end;
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 6px;
}

.emp-mobile-card-id {
  color: var(--color-text-tertiary);
  font-size: 11px;
  font-weight: 600;
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

- [ ] **Step 5: Add the mobile toggle rules inside the existing 760px block**

In `src/styles.css`, find the existing block:

```css
@media (max-width: 760px) {
  .employee-summary-grid {
    grid-template-columns: 1fr;
  }

  .employee-list-panel .toolbar {
    align-items: stretch;
    flex-direction: column;
    padding: 16px;
  }

  .employee-list-panel .search-box,
  .employee-list-panel .toolbar > select {
    max-width: none;
    width: 100%;
  }

  .employee-list-panel .toolbar > select {
    transform: none;
  }

  .employee-list-panel td {
    grid-template-columns: 84px minmax(0, 1fr);
  }
```

Insert two new rules immediately before the `.employee-list-panel td { ... }` rule (after the `.employee-list-panel .toolbar > select { transform: none; }` block):

```css
  .employee-list-panel .table-wrap {
    display: none;
  }

  .emp-mobile-list {
    display: flex;
  }

```

The block should now read (showing the seam): `.toolbar > select { transform: none; }` → the two new rules above → `.employee-list-panel td { ... }` unchanged below.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 7: Run the existing test suite**

Run: `npm test`
Expected: `120 passed (120)` — unaffected, this is a CSS/JSX-only change.

- [ ] **Step 8: Manual/browser verification — mobile width**

Using the Playwright browser tool (or the project's dev server + a real browser):
1. Start the dev server if not already running: `npm run dev`
2. Navigate to the Employees page (`/employees` or via the sidebar), logged in.
3. Resize the viewport to `390x844`.
4. Confirm: each employee renders as a card (avatar/name/email left, chip meta line, Employee ID + date + status pill stacked on the right, chevron far right) — not the old stacked label/value table-card.
5. Run this in the page to confirm no horizontal overflow (same check used for the earlier Attendance/Daily Tickets fixes):

```js
() => {
  const viewportWidth = window.innerWidth;
  const results = [`viewport=${viewportWidth} bodyScrollWidth=${document.body.scrollWidth}`];
  document.querySelectorAll('*').forEach(el => {
    if (el.scrollWidth > viewportWidth + 2) {
      results.push(`${el.tagName}.${el.className} scrollWidth=${el.scrollWidth}`);
    }
  });
  return results.join('\n');
}
```

Expected: `bodyScrollWidth` equals `viewportWidth` (or within a couple px), and no elements listed.

6. Click/tap a card. Confirm it opens `EmployeeDetailsView` for that employee (same as clicking a desktop row does today).

- [ ] **Step 9: Manual/browser verification — desktop width**

1. Resize the viewport to `1440x900`.
2. Confirm the page renders the original 7-column `<DataTable>` (No., Employee ID, Employee, Department, Position, Date Hired, Status) exactly as it did before this plan — no card list visible, no layout shift, no visual difference from the pre-change screenshot.

- [ ] **Step 10: Commit**

```bash
git add src/App.tsx src/styles.css
git commit -m "Add touch-friendly mobile card layout to Employees list"
```
