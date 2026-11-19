# Stage 1 — Project Setup

## Objective

Create a reproducible workspace for a local NestJS API, Next.js dashboard and PostgreSQL, with validated environment configuration and meaningful health checks. **Completed and acceptance-verified on 2026-11-19.**

## Prerequisites

Read the [root README](../../../README.md), [system overview](../../architecture/system-overview.md) and [health contracts](../../architecture/api-design.md#health-endpoints). Have a supported Node.js LTS release, npm, Docker and Compose available. No Stripe credentials are required for this stage's verification.

Read [AGENTS.md](../../../AGENTS.md) and the [design reference](../../design/DESIGN.md). Before frontend configuration, inspect [tokens.json](../../design/tokens.json), [variables.css](../../design/variables.css) and [theme.css](../../design/theme.css) together to choose a version-compatible Tailwind/token integration.

Read the [source structure and DI contract](../../architecture/project-structure.md) before application initialization. Both apps use `src`; the frontend router belongs in `apps/web/src/app`.

## Scope

Initialize npm workspaces and both applications, connect Prisma to an empty development database, and establish basic quality checks. Create separate `api` (NestJS) and `db` (PostgreSQL) Compose services, including an API development image and persistent database storage. The backend runs in Docker from this stage; Next.js initially runs on the host. Stage 5 hardens runtime images, adds the frontend container and verifies the complete containerized stack.

## Technical Requirements

Use the planned `apps/api`, `apps/web`, `infra`, and `docs` layout, one npm lockfile and NestJS's Express adapter. Pick mutually compatible supported stable Node, NestJS, Next.js, React, Prisma, PostgreSQL and Jest versions. Record exact resolved versions, runtime constraints and the Prisma client/adapter choice in the README before copying setup examples. Do not infer a package version from an optional skill.

Validate typed configuration at startup. Before Stage 3, provider calls are disabled; Stripe values may be absent. Stage 3 will make test Stripe values mandatory only in Stripe mode. Keep `.env.example` placeholders separate from ignored real `.env` files and use a separate test database. Publish API/database ports on loopback only. Use a named database volume for development; never point integration tests at it.

The API listens on all container interfaces and connects to `db:5432` on the Compose network. Host-run tools use separate connection settings; the host-run Next.js proxy uses the API's loopback-published port. Wait for database health at initial API startup, synchronize source changes without overwriting container dependencies, and refresh dependencies/rebuild when workspace manifests or the lockfile change. Use the repository root as the API build context and exclude secrets, installed skills and unrelated build artifacts. Follow the [container runtime contract](../../architecture/system-overview.md#local-container-runtime).

Implement liveness and database readiness exactly as the API contract. Readiness must not depend on domain tables or migrations. Establish Jest and Supertest once; do not add Vitest alongside them. Redis is omitted by default; add a Compose service only if a concrete feature requires it and its purpose/failure policy is documented. Do not add a queue, monorepo orchestration framework or CI workflow yet.

## Recommended Codex Skills

All are optional aids; none is assumed installed. Follow the [skills policy](../ROADMAP.md#codex-skills-policy). No repository catalog currently exists; if later supplied, reference its installation and compatibility instructions without editing it.

| Skill | Purpose and relevance | Priority |
| --- | --- | --- |
| `nestjs-best-practices` | Review module/bootstrap/configuration structure before establishing API conventions | Recommended |
| `prisma-orm-setup` | Review connection, client generation and selected-version adapter configuration | Recommended |
| `docker-compose-patterns` | Review local service health, loopback publishing, volume and environment choices | Recommended |
| `docker-build-strategies` | Review the API development image, workspace build context and dependency caching | Optional |

For Prisma 8, official version-specific setup instructions supersede generic examples. The task-supplied sync guidance is for future developer-controlled installation, not an instruction to execute it now.

## Implementation Tasks

- [x] Record the selected supported version matrix and npm workspace decision in README.
- [x] Initialize root workspace metadata and one lockfile; add `apps/api` and `apps/web` without extra packages.
- [x] Initialize NestJS with Express/TypeScript and Next.js with App Router/TypeScript/Tailwind using `apps/web/src/app`.
- [x] Place backend Config/Database under `src/shared` and Health under `src/modules/health`, using constructor DI and the one-versus-many folder rule.
- [x] Configure the frontend `@/*` source alias and folder-based shell/layout component entry points; create optional shared/global folders only when used.
- [x] Record how the supplied design exports map to the selected Tailwind version and the web shell; preserve the reference files and leave dashboard components for Stage 4.
- [x] Establish formatting, linting, strict type checks and reproducible build entry points.
- [x] Add validated Config and Database modules; create one shared Prisma connection per API process with clean shutdown.
- [x] Add Prisma configuration appropriate to the chosen version; generate a client without domain models or a domain migration.
- [x] Add an API development Dockerfile and build context exclusions for secrets, installed skills and unrelated artifacts.
- [x] Add Compose services `api` and `db` with pinned base images, database health dependency, API readiness probe, loopback publishing and a named database volume.
- [x] Configure API-to-database service networking, host-facing proxy/tool settings, source synchronization and container-owned dependencies.
- [x] Add placeholder environment examples, ignore real secrets and document separate test connection settings.
- [x] Implement the two health routes with a bounded readiness query and safe response schemas.
- [x] Add Jest/Supertest configuration and tests for health/configuration behavior.
- [x] Verify container startup, source reload, dependency-refresh/rebuild behavior, API/database restart, volume persistence and database outage/readiness recovery.
- [x] Document only setup/development/check commands actually created and exercised; retain planned labels for later features.

## Expected Files and Modules

Implemented artifacts: root `package.json`/`package-lock.json`, runtime version declaration, `.gitignore`, environment examples, `apps/api/src/main.ts`, `src/app.module.ts`, `src/shared/config`, `src/shared/database`, `src/modules/health`, Prisma configuration/schema location compatible with the selected version, API health tests, `apps/web/src/app/` shell and any used `src/components/layouts/<Name>/index.tsx`, `apps/api/Dockerfile` with a development target, root `.dockerignore` and `infra/compose.yaml` with `api`/`db` services. Backend `src` paths in this list are relative to `apps/api`.

These artifacts now exist. Prisma configuration/schema are under `apps/api`; no domain migration exists yet. `infra` owns development/test Compose configuration and the local environment-file generator. Keep these locations consistent in later stages.

## API / Database Changes

Add only `GET /api/v1/health/live` and `GET /api/v1/health/ready`. Connect to PostgreSQL without creating Payment tables. No provider endpoints, domain migrations, simulation endpoints or business status changes exist yet.

## Testing Requirements

Use Jest to validate missing/invalid configuration and health services. Use Supertest against the real HTTP pipeline for 200 health schemas and 503 readiness when the database is unreachable. Verify with real PostgreSQL that a bounded probe succeeds before domain migrations. Exercise the same health endpoints through the API container's published port, then verify database outage/recovery and normal container restarts with persistent database data. Check source reload and dependency-refresh/rebuild behavior. Validate Compose without printing resolved secrets. Test that exceptions/logs do not contain connection strings. Exercise basic web and API build/type/lint checks. No Playwright or Stripe networking is needed yet.

## Acceptance Criteria

- [x] A clean checkout can install from the lockfile and start the documented development environment.
- [x] The backend and PostgreSQL run in separate Compose services; the frontend shell reaches the API through its published loopback port.
- [x] Database health gates initial API startup; source changes reload in the API container, and normal restarts preserve development database data.
- [x] Liveness remains 200 during database outage while readiness becomes 503 and later recovers.
- [x] Invalid required local configuration stops startup with a safe actionable message.
- [x] Unit/API tests, builds, type checks and lint checks pass using the documented scripts.
- [x] No application key, webhook secret or database password is committed in real configuration files.
- [x] The README records actual versions and verified setup commands without claiming later features work.
- [x] Frontend configuration documents the supplied token/theme integration and does not introduce an unrelated visual theme.
- [x] Backend modules/shared infrastructure and the frontend `src/app` shell follow the structure contract; DI resolves through module imports/exports and no empty template folders are added.

## Definition of Done

Required functionality is implemented; every acceptance criterion is verified; required tests/checks pass; configuration/setup documentation is updated; no known blocking issues remain. Mark Stage 1 completed only with verification evidence, never merely because initialization generated files.

## Verification Evidence — 2026-11-19

All acceptance criteria above were checked against running services and the final sources before marking this stage complete.

| Area | Observed evidence |
| --- | --- |
| Clean setup | A temporary source copy without installed dependencies, generated client, build output or real environment files passed `npm ci`, `npm run setup:env`, `npm run db:generate` and all 26 unit/HTTP tests. API image builds also installed from the root lockfile and generated the empty client from the restricted build context. |
| Runtime and network | `npm run infra:check`, `npm run infra:up`, `npm run dev` and `npm run dev:web` were exercised. Compose started PostgreSQL first, waited for its health, then started a healthy API. Published API/database ports bind only to `127.0.0.1`; the API uses `db:5432`. The host frontend returned 200 and its health proxy returned the exact backend readiness schema through port 3001. |
| Source and dependency refresh | A temporary HTTP header appeared after source sync without replacing the API container; removing the header reloaded successfully. A manifest edit triggered Watch's rebuild, a fresh `npm ci`, client generation and API container replacement. The final dev command uses Nest CLI `--no-shell` so it terminates the Node process directly during reloads in the slim image. All temporary source edits were restored. |
| Outage and recovery | With the actual development DB stopped, liveness stayed 200 and readiness returned 503 `{"status":"not_ready","database":"down"}` (observed probe: 21ms). Docker marked the API unhealthy. Starting PostgreSQL restored readiness to 200 without restarting the API. Timeouts are configured at one second for connection acquisition, query execution and server statement execution. |
| Restart persistence | A UUID marker row in a uniquely named verification schema survived API/database restart and complete container recreation using the named volume. The verification schema was removed afterward; the public schema still contains zero domain tables. Normal Compose interruption stopped both services gracefully. |
| Configuration and secrecy | Compiled API startup with invalid required configuration exited 1 with an actionable field-only message and did not echo the input value. Config tests cover missing/invalid values and disabled provider/simulation settings. Real environment files are ignored; image inspection/filesystem checks exclude credentials, skills and unrelated sources; container logs contain no generated database password. |
| Automated checks | `npm run db:validate`, `npm run format:check`, `npm run typecheck`, `npm run lint`, `npm test` (26 tests), `npm run test:integration` (2 real-PostgreSQL tests), and `npm run build` (both apps) passed. Integration tests used only the isolated test service/database on port 5433. |
| Proxy boundary | Live requests verified 200 for both health routes, 400 for unexpected queries, 404 for unlisted probes, 403 for untrusted Host/Origin, and 405 for POST. Readiness responses use `Cache-Control: no-store`; a validated request ID is preserved and echoed. |
| Structure and DI | Real Nest HTTP tests import AppModule and override exported infrastructure providers. Config/Database live under `src/shared`, Health under `src/modules/health`. The Next.js alias, `src/app` router and folder-based AppLayout passed strict type checks/builds. No unused feature directories, payment models, provider SDK, Redis, queue or CI workflow were added. |
| Visual reference | The rendered shell was captured and inspected at 1440×900 and 390×844 (full-page mobile capture). The heading/actions and source-derived unavailable states were reviewed; the refresh action worked at both sizes. The mechanical check returned no findings, and an independent finish review found no material Stage 1 UI issues. Supplied design exports remain unchanged. Local captures are verification artifacts, not committed application assets. |

### Application Design Mapping

The shell inherits the supplied light canvas, navy text, indigo actions, fine frost dividers and flat components. Tailwind v4 imports the reference variables/theme directly; application CSS maps them to semantic roles. The fallback font stack is used without downloading font assets. Buttons/cards/inputs retain the named 4px radius; only tags use pill radii. Body weight 400 and 1.5 line-height support operational readability, steel provides muted-text contrast, and deep violet preserves contrast for filled-action hover. Narrow status rows stack and action targets are at least 48px. The requested follow-up styling refactor introduces shadcn Button/Badge and Tailwind JSX utilities now; dashboard workflows and additional primitives remain for Stage 4.

The follow-up removes application-specific selectors from `globals.css`, keeping only imports, token mappings and base element styles. Shared class merging recognizes the supplied typography roles; control variants preserve the original palette, dimensions and focus treatment. Browser checks passed at 1440, 390 and 320 CSS pixels: no horizontal overflow, preserved desktop/mobile geometry, visible skip-link/button focus, working refresh submission and an actual readiness JSON response. No browser runtime errors were observed. Type checking, lint and formatting passed; the production build passed with `npm run build --workspace @simulator/web -- --webpack`. Default Turbopack production verification was blocked by the environment's prohibition on creating its worker socket, including outside the command sandbox; the project's normal build script was not changed.

### Remaining Scope and Nonblocking Limitations

Stages 2–5 remain not started. No domain migration, payment behavior, Stripe networking, committed browser automation suite, runtime production image or CI was claimed by this verification. Jest ESM uses Node's experimental VM-module flag. The original Stage 1 dependency audit reported moderate advisories in development tooling; the subsequent UI dependency installation reported zero vulnerabilities without changing existing package versions. The full dependency/security review remains in Stage 5. No optional Codex skills were installed or hooks enabled.

## Out of Scope

Payment schema, payment APIs, Stripe SDK integration, dashboard workflows, simulation behavior, hardened runtime images, frontend container and GitHub Actions. Redis has no baseline use case and is not added speculatively. Do not perform implementation tasks during the documentation-only design assignment.

## Dependencies

No preceding implementation stage. Establishes the workspace, database access and test runner required by [Stage 2](02-payment-core.md). The [architecture index](../../architecture/README.md) governs all later contracts.

