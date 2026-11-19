# Implementation Roadmap

Implement exactly these five stages in order. **Stage 1 is complete and verified; Stages 2–5 are not started.** Documentation completion does not complete an implementation stage. The [architecture contract](../architecture/README.md) is the source of truth; detailed tasks and verification belong in the linked stage documents.

Read [AGENTS.md](../../AGENTS.md) and the [supplied design reference](../design/DESIGN.md) before development. Use all four files in `docs/design/` for frontend setup, dashboard implementation and visual verification; the [README context guide](../../README.md#design-and-development-context) explains their roles. Stages 1, 4 and 5 explicitly cover design integration and verification without changing the five-stage scope.

Follow the [project structure contract](../architecture/project-structure.md) throughout all stages: backend features under `src/modules` with constructor DI and providers under `src/integrations`; frontend routing under `src/app`, folder-based components and domain API hooks under `src/api/hooks`. Shared/global folders are used only when their contents have actual shared scope.

## Codex Skills Policy

Repository inspection found no `skills.md`. Recommendations therefore use the fallback identifiers supplied in the project task. The developer subsequently requested project-local installation; the [installation manifest](../../.agents/skills/install-manifest.json) records the installed revisions, including `impeccable`. Skills remain optional implementation aids, not functional dependencies. Do not create a catalog or install/synchronize additional skills as a side effect of documentation work. If the developer later supplies `skills.md`, use it for installation instructions and compatibility checks without modifying it.

For future explicitly requested installation, use project-local scope only. Inspect community skill instructions/scripts before use. No stage requires a skill. For Prisma 8, use version-specific official documentation and the catalog's version-specific guidance; the generic `prisma-client-api` is not an authoritative Prisma 8 reference. Do not execute `npx prisma skills sync` during documentation. Do not recommend retired `next-best-practices` or specialized Cache Components skills for this uncached local dashboard. Redis skills become relevant only if a concrete feature introduces Redis; BullMQ and AWS skills remain reserved for future features adopting those technologies. Do not install additional skills automatically.

## Stage 1 — Project Setup

- [x] Complete — acceptance verified on 2026-11-19

**Objective:** establish a reproducible local workspace and empty database connection. **Scope:** npm monorepo, NestJS/Next.js initialization, PostgreSQL/Prisma setup, backend-plus-database Compose environment, API development image, environment validation and health checks. **Dependencies:** architecture documents, Node/npm and Docker; no previous implementation stage.

**Main deliverables:** `apps/api`, `apps/web`, workspace scripts/lockfile, version matrix, database configuration, environment examples, API development Dockerfile, local Compose services `api` and `db`, and tested health routes. **Recommended Codex Skills:** `nestjs-best-practices`, `prisma-orm-setup`, `docker-compose-patterns` (recommended); `docker-build-strategies` (optional aid for the development image). All remain optional to install.

**Acceptance:** a clean local setup starts the backend and PostgreSQL in Compose plus the frontend shell; API container readiness detects database loss; invalid configuration fails safely; source synchronization and restart persistence work; health tests pass. Redis is omitted unless a concrete feature requires it. No payment schema or Stripe calls yet.

Details and verification evidence: [Stage 1 instructions](stages/01-project-setup.md#verification-evidence--2026-11-19).

## Stage 2 — Payment Core

- [ ] Not started

**Objective:** prove local payment creation and concurrency invariants before adding a provider. **Scope:** core schema, pure state machine, payment service, create/list/detail/event API, immutable idempotency responses, constraints, unit and PostgreSQL integration tests. **Dependencies:** Stage 1 verified.

**Main deliverables:** core Prisma migration, Payments module, validated DTOs, OpenAPI contracts, state transition tests and concurrent creation/rollback tests. **Recommended Codex Skills:** `nestjs-best-practices`, `supabase-postgres-best-practices` (recommended); `prisma-client-api` (recommended only when compatible with selected Prisma; omit for Prisma 8).

**Acceptance:** ten concurrent same-key requests leave one payment and creation event; identical retries replay the same 201 body; changed payload returns 409; invalid inputs create no rows; list/details/events agree with persistence.

Details: [Stage 2 instructions](stages/02-payment-core.md).

## Stage 3 — Stripe Integration

- [ ] Not started

**Objective:** add safe provider confirmation, verified webhooks and recoverable synchronization. **Scope:** Stripe test configuration, one-intent integration, confirmation sessions, raw-body signature checks, receipt deduplication, fenced leases, state mapping, provider errors and recovery. **Dependencies:** Stage 2 verified and optional test-account credentials for provider smoke checks.

**Main deliverables:** provider/receipt migration, Stripe adapter and fake, Webhooks module, session/sync routes, current-state projection and signed integration fixtures. **Recommended Codex Skills:** `nestjs-best-practices`, `supabase-postgres-best-practices` (recommended). There is no dedicated Stripe skill in the supplied catalog; use official Stripe documentation and the selected SDK.

**Acceptance:** signed duplicate/out-of-order events cannot duplicate or regress financial transitions; an unknown create retries the same key within the cutoff; stale lease owners cannot commit; business rollback keeps receipts unfinished; credentials are unnecessary for deterministic tests.

Details: [Stage 3 instructions](stages/03-stripe-integration.md).

## Stage 4 — Payment Simulator

- [ ] Not started

**Objective:** expose the payment workflows and failure evidence in a compact dashboard. **Scope:** creation and confirmation UI, list/details/timeline, status/error presentation, development scenario orchestration and guarded proxies. **Dependencies:** Stage 3 APIs and provider fake verified.

**Main deliverables:** accessible dashboard following the component-folder convention, typed Axios client, TanStack Query domain hooks, exact-money form, Payment Element integration, fake confirmation control, scenario controls and initial Playwright tests. **Recommended Codex Skills:** `shadcn`, `frontend-design`, `vercel-react-best-practices` (recommended); `vercel-composition-patterns`, `web-design-guidelines`, `modern-web-guidance` (optional).

**Acceptance:** a developer can create/inspect a payment, complete success or observe decline, run duplicate/concurrent scenarios, and demonstrate signed redelivery/rollback recovery. Production has no simulation routes and the browser receives no simulation secret.

Details: [Stage 4 instructions](stages/04-payment-simulator.md).

## Stage 5 — Testing and Polish

- [ ] Not started

**Objective:** verify the complete reliability story and prepare the portfolio demonstration. **Scope:** complete E2E and concurrency/failure matrix, security review, GitHub Actions, runtime image hardening, frontend container, full-stack Compose verification and final docs. **Dependencies:** Stage 4 verified; the backend/database Compose setup and earlier unit/integration/browser tests already exist.

**Main deliverables:** comprehensive regression coverage, credential-free CI, verified Docker images and clean setup procedure, operator recovery notes and an interview demo script. **Recommended Codex Skills:** `playwright-cli`, `github-actions-hardening`, `docker-build-strategies` (recommended); `web-design-guidelines`, `docker-compose-patterns` (optional).

**Acceptance:** the documented deterministic suite passes from clean state, including restart/fencing and rollback; opt-in Stripe smoke results are separately recorded; live keys/fake production mode are rejected; documented setup and demonstration steps are actually verified.

Details: [Stage 5 instructions](stages/05-testing-and-polish.md).

