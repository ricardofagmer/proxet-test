# ADR 0001 — Budgets live in TanStack Start server functions, not a NestJS backend

**Status:** Accepted
**Date:** 2026-11-06
**Deciders:** Ricardo Fagmer (developer), spec grilling session
**Related:** [docs/specs/monthly-budgets.md](../specs/monthly-budgets.md) (decision D1)

## Context

The monthly-budgets feature (`TASK.md`) needs persistence, aggregation over the
category tree, plan gating, email alerts and compliance hooks. The developer's
global engineering constitution says every application backend uses NestJS.
The project's own `CLAUDE.md` mandates the opposite shape for this repository:

- Route components in `src/routes/` may only import `*.functions.ts`
  (`createServerFn` wrappers); server-only logic lives in `*.server.ts`.
- Route components call server functions through TanStack Query.
- All user-facing text goes through Paraglide messages.

The existing feature set (accounts, categories, transactions, imports,
receipts, billing, compliance) is built exactly this way, including the plan
gate (`src/server/billing.server.ts` `checkAccountLimit`), ownership checks
(`src/server/ownership.server.ts`), email (`src/server/email.ts`) and the
in-process maintenance loop (`src/server/maintenance.server.ts`).

The database driver selection in `src/db/index.ts` is decisive for any
out-of-process design:

```
//   - DATABASE_URL set (postgres://…)  → node-postgres pool (production/managed PG)
//   - TEST_MODE=1                      → in-memory PGlite (unit tests, E2E dev server)
//   - otherwise                        → persistent PGlite at ./data/pg (local dev)
```

Local development and the whole E2E suite run on embedded PGlite
(`new PGlite("./data/pg")` or `memory://`), which is opened by the single app
process; a second process cannot share that store. `README.md:19-20` promises
"No `.env` is needed for local development".

The constitution itself ranks project conventions above its own rules
("Project conventions win over these rules when they conflict: project
`CLAUDE.md` > EngineOS > defaults") and requires an existing non-Nest backend
to be reported as a deviation with migration scoped separately rather than
silently extended or rewritten.

## Decision

Implement budgets with the repository's established pattern:

- `src/server/budgets.server.ts` — domain logic: month helpers, spend
  aggregation over the category subtree, alert evaluation and the sweep.
- `src/server/budgets.functions.ts` — `createServerFn` wrappers with zod
  `inputValidator` and `requireUserId`; ownership scoped in the same query.
- `src/routes/_authed/budgets.tsx` — page using `useServerFn`, `useQuery`,
  `useMutation`, module-level query keys and invalidation on success.
- Plan gating, email, compliance and ownership are extended in their existing
  modules rather than duplicated.

No NestJS code is added. The deviation from the global "NestJS for every
backend" rule is recorded here; a migration of this application to NestJS is
out of scope for this feature and would be a separate, whole-repository
decision.

## Alternatives considered

### A. NestJS standalone application context in-process

Boot a `NestFactory.createApplicationContext` inside the TanStack Start server
and resolve a `BudgetsService` from DI inside the server-function handlers.

Rejected because it introduces `reflect-metadata`, decorators and a second
composition style for a single feature, while every neighbouring module keeps
the plain-function style. It adds boot cost and a new mental model without any
boundary benefit: the handlers would still be TanStack server functions, and
the service would still use the same Drizzle `db`.

### B. Separate NestJS service on Postgres via `DATABASE_URL`

Run budgets as its own NestJS process that owns the budgets tables, with the
app calling it over HTTP.

Rejected because:

- The embedded PGlite store at `./data/pg` is single-process (`src/db/index.ts`);
  a second process cannot open it, so local development and E2E would require
  a real Postgres and a `.env`, breaking the README's "no `.env` needed"
  promise and the hermetic TEST_MODE setup (`tests/setup.ts` deletes
  `DATABASE_URL`).
- Session validation, ownership checks, entitlements, email and compliance
  export/deletion would have to be duplicated or exposed over a new internal
  API, multiplying the security surface for one table pair.
- The project `CLAUDE.md` mandates server functions for server data access,
  and it outranks the global rule.

## Consequences

### Positive

- One architecture, one driver, one deployment shape; nothing new to run.
- Unit tests import `budgets.server.ts` and run on in-memory PGlite like
  `tests/billing.test.ts` and `tests/compliance.test.ts`.
- Reuses `checkAccountLimit`-style gating, `sendEmail` capture for E2E,
  `/test-run-sweep` style deterministic triggers and the existing export/delete
  code paths.
- Client bundle safety is preserved by the `.functions.ts` / `.server.ts`
  split already enforced by convention.

### Negative

- The repository remains a non-NestJS backend relative to the developer's
  global constitution; the deviation is now explicit instead of implicit.
- Alert evaluation runs inline in request handlers (fire-and-forget) and in an
  in-process hourly loop; there is no job queue, so delivery is at-most-once
  with the idempotency ledger as the guarantee.
- Domain logic stays in plain modules without DI; test doubles are passed as
  parameters (`db` default parameter pattern) rather than injected.

## Follow-ups

- If the application is ever migrated to NestJS, budgets should move with the
  rest of the server modules under a single migration decision; nothing in this
  feature should be migrated alone.
- Revisit the in-process alert evaluation if a job runner is introduced for
  other features (imports, receipt scanning).
