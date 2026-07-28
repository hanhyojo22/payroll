# Clean Architecture — Boundaries and Testability

**Date:** 2026-07-27
**Status:** DRAFT — presented, awaiting approval. No code written.
**Branch:** `fix/audit-remediation`

## Problem

The codebase is already partly clean: `src/domain/` is genuinely pure calculation with no
Supabase dependency, and every feature has a repository file. Three boundary violations remain.

**1. Inverted dependency.** `src/lib/supabaseData.ts` imports from eight feature repositories:

```
lib/supabaseData.ts → features/collections/collectionRepository
                    → features/billing/billingRepository
                    → features/billing/subconTicketRepository
                    → features/expenses/expenseRepository
                    → features/payroll/employeeAdvanceRepository
                    → features/payroll/payrollRepository
                    → features/salaryBonds/salaryBondRepository
                    → features/subcontractors/subcontractorAdvanceRepository
```

Infrastructure depending on features.

**2. No data-access seam.** Fifteen files import `SupabaseClient` or the concrete `supabase`
singleton, including six `*Feature.tsx` UI components. The UI reaches the database directly.

**3. Untestable orchestration.** Each feature component holds inline logic of the shape
"if `navigator.onLine` then call repository else queue mutation, then reload, then notify".
This is duplicated across nine features and has zero test coverage. It is also where the two
highest-severity bugs in the 2026-07-27 audit lived: the offline queue dropping partial-update
payloads, and the connectivity/server error misclassification.

A fourth, smaller issue: `domain/payroll.ts` imports `currency` from `shared/utils` (added
2026-07-27 alongside `payrollItemPayBasis`), putting formatting inside the domain layer.

## Goals

Testability is the driver. Specifically: make the offline/online orchestration unit-testable
without a live Supabase, because that is where failures cost money and where coverage is absent.

Non-goals, explicitly:

- Breaking up `App.tsx` (7,193 lines, 30 components). Out of scope by decision.
- Any UI markup or behaviour change. This work is structural only.
- Backend portability. Supabase is not being abstracted for the sake of swapping it; the port
  exists to enable fakes in tests. Abstraction beyond that is not warranted.

## Decisions

Four scoping decisions were settled before this design:

| Decision | Choice | Rejected |
|---|---|---|
| Scope | Fix boundaries, keep structure | Full ports & adapters rewrite; App.tsx breakup |
| Driver | Testability | Maintainability only; backend portability |
| Shape | Ports **and** extracted use-cases | Ports only (leaves orchestration untested) |
| Rollout | One vertical at a time | Big-bang sweep; money-paths only |

## Target layering

```
src/
  domain/              unchanged — pure calculation
  core/ports/          NEW  interfaces + Result type
  adapters/supabase/   NEW  the only place SupabaseClient may be imported
  features/<f>/
    useCases.ts        NEW  orchestration as plain async functions
    <F>Feature.tsx     thin — rendering + calling use-cases
  app/                 composition root + resource loading (moved from lib/)
  lib/                 true infrastructure only: offlineDb, offlineSync
  shared/              unchanged
```

**Dependency rule:** `domain ← core/ports ← useCases ← components`. Adapters implement ports
and are wired only at the composition root. Outside `adapters/`, `SupabaseClient` is
unimportable — worth enforcing with a lint rule once the migration completes.

## Components

### The port

Per-feature interfaces rather than one aggregate gateway, so each in-memory fake stays small
enough to write by hand.

```ts
// core/ports/result.ts
export type Result<T> =
  | { data: T; error: null }
  | { data: null; error: AppError };

// core/ports/collections.ts
export interface CollectionRepository {
  list(): Promise<Result<CollectionReminder[]>>;
  save(input: CollectionInput): Promise<Result<void>>;
  recordPayment(input: PaymentInput): Promise<Result<void>>;
  archive(id: string): Promise<Result<void>>;
}
```

`Result<T>` replaces the ad-hoc `{ data, error }` shapes currently returned by `settle()` and
the repositories, giving one type across the boundary.

### Use-cases

Plain async functions taking dependencies explicitly. Deliberately **not** hooks, so tests run
with no renderer and no DOM.

```ts
export type UseCaseDeps = {
  repos: Repositories;
  queue: QueueOfflineMutation;
  notify: Notifier;
  isOnline: () => boolean;
  reload: () => Promise<void>;
};
```

Injecting `isOnline` is the change that unlocks everything else. Today every feature calls
`navigator.onLine` directly, which is precisely why the offline branch has never been testable.

### Dependency injection

A React context at the root supplies a `Repositories` object; components read it through a
`useRepositories()` hook. Tests bypass React entirely and pass fakes straight into the
use-case functions.

### Fixing the inverted dependency

`lib/supabaseData.ts` aggregating feature repositories is not wrong in principle — composing
features is an application concern. It is in a folder that reads as infrastructure. Moving it
to `src/app/resources.ts` corrects the direction with no rewiring. This is the cheapest
possible fix for violation 1.

### Closing the domain leak

`payrollItemPayBasis` is presentation, not calculation. It moves to `features/payroll/`,
restoring `domain/` to pure computation and dropping the `currency` import.

## Data flow

Unchanged at runtime. A save currently goes:

```
component → (inline online check) → repository → supabase
                                 └→ queueMutation → IndexedDB
```

After:

```
component → useCase → repos.<feature>.save() → adapter → supabase
                   └→ queue() → IndexedDB
```

Same calls, same order, same offline semantics. The difference is that every arrow out of
`useCase` is now an injected dependency that a test can replace.

## Error handling

No behavioural change. Repositories keep returning errors rather than throwing; `friendlyError`
and `isOfflineLikeError` continue to classify them. The only change is that both now sit behind
`Result<T>` instead of per-repository ad-hoc shapes.

## Testing

In-memory fakes per port live in `src/testing/fakes.ts`. Use-case tests run in the node
environment — no DOM, no React, no Supabase.

Representative cases, all currently impossible to write:

- offline → `queue` called, `repos.save` **not** called
- online, repo returns error → `notify.error` called, `reload` **not** called
- online, repo succeeds → `reload` called exactly once
- server-coded error while offline-like → surfaced, not requeued

The existing 161 tests must stay green at every commit.

## Rollout

| Commit | Content |
|---|---|
| 1 | Infrastructure: `Result`, collections port, DI context, fakes, `app/resources` move, domain leak fix |
| 2 | Collections vertical + use-case tests — the reference implementation |
| 3…10 | One feature per commit, same pattern |

Each commit independently shippable: `tsc --noEmit` clean, full suite green, `npm run build`
passing.

## Risks

**Commit 1 is pure overhead.** It adds indirection with no user-visible benefit. If the work
stops after commit 1, the codebase is worse than before it started — new abstraction, no payoff.
The value begins at commit 2. If that trade is unattractive, extracting use-cases *first* and
adding ports later reaches test coverage sooner at the cost of architectural tidiness.

**Mixed conventions during migration.** Converted and unconverted features coexist for the
duration. This is accepted, and should be recorded in `CLAUDE.md` so it reads as deliberate
rather than accidental drift.

**No UI safety net.** There are no component tests for the nine feature components being
touched. Mitigated by converting one vertical per commit and by the structural-only constraint
(no markup or behaviour changes), but it remains the principal risk.

## Open question

Approval of this design. Nothing has been implemented; `src/core`, `src/adapters` and `src/app`
do not exist, and no `useCases.ts` file has been created.
