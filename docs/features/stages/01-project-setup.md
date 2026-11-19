# Stage 1 — Project Setup

## Objective

Create a reproducible workspace for a local NestJS API, Next.js dashboard and PostgreSQL, with validated environment configuration and meaningful health checks. This stage has not started.

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

- [ ] Record the selected supported version matrix and npm workspace decision in README.
- [ ] Initialize root workspace metadata and one lockfile; add `apps/api` and `apps/web` without extra packages.
- [ ] Initialize NestJS with Express/TypeScript and Next.js with App Router/TypeScript/Tailwind using `apps/web/src/app`.
- [ ] Place backend Config/Database under `src/shared` and Health under `src/modules/health`, using constructor DI and the one-versus-many folder rule.
- [ ] Configure the frontend `@/*` source alias and folder-based shell/layout component entry points; create optional shared/global folders only when used.
- [ ] Record how the supplied design exports map to the selected Tailwind version and the web shell; preserve the reference files and leave dashboard components for Stage 4.
- [ ] Establish formatting, linting, strict type checks and reproducible build entry points.
- [ ] Add validated Config and Database modules; create one shared Prisma connection per API process with clean shutdown.
- [ ] Add Prisma configuration appropriate to the chosen version; generate a client without domain models or a domain migration.
- [ ] Add an API development Dockerfile and build context exclusions for secrets, installed skills and unrelated artifacts.
- [ ] Add Compose services `api` and `db` with pinned base images, database health dependency, API readiness probe, loopback publishing and a named database volume.
- [ ] Configure API-to-database service networking, host-facing proxy/tool settings, source synchronization and container-owned dependencies.
- [ ] Add placeholder environment examples, ignore real secrets and document separate test connection settings.
- [ ] Implement the two health routes with a bounded readiness query and safe response schemas.
- [ ] Add Jest/Supertest configuration and tests for health/configuration behavior.
- [ ] Verify container startup, source reload, dependency-refresh/rebuild behavior, API/database restart, volume persistence and database outage/readiness recovery.
- [ ] Document only setup/development/check commands actually created and exercised; retain planned labels for later features.

## Expected Files and Modules

Planned artifacts: root `package.json`/`package-lock.json`, runtime version declaration, `.gitignore`, environment examples, `apps/api/src/main.ts`, `src/app.module.ts`, `src/shared/config`, `src/shared/database`, `src/modules/health`, Prisma configuration/schema location compatible with the selected version, API health tests, `apps/web/src/app/` shell and any used `src/components/layouts/<Name>/index.tsx`, `apps/api/Dockerfile` with a development target, root `.dockerignore` and `infra/compose.yaml` with `api`/`db` services. Backend `src` paths in this list are relative to `apps/api`.

These are future implementation files, not links to existing files. Keep Prisma-owned schema/migrations under `apps/api`; `infra` owns infrastructure configuration. Use one consistent location in later stages.

## API / Database Changes

Add only `GET /api/v1/health/live` and `GET /api/v1/health/ready`. Connect to PostgreSQL without creating Payment tables. No provider endpoints, domain migrations, simulation endpoints or business status changes exist yet.

## Testing Requirements

Use Jest to validate missing/invalid configuration and health services. Use Supertest against the real HTTP pipeline for 200 health schemas and 503 readiness when the database is unreachable. Verify with real PostgreSQL that a bounded probe succeeds before domain migrations. Exercise the same health endpoints through the API container's published port, then verify database outage/recovery and normal container restarts with persistent database data. Check source reload and dependency-refresh/rebuild behavior. Validate Compose without printing resolved secrets. Test that exceptions/logs do not contain connection strings. Exercise basic web and API build/type/lint checks. No Playwright or Stripe networking is needed yet.

## Acceptance Criteria

- [ ] A clean checkout can install from the lockfile and start the documented development environment.
- [ ] The backend and PostgreSQL run in separate Compose services; the frontend shell reaches the API through its published loopback port.
- [ ] Database health gates initial API startup; source changes reload in the API container, and normal restarts preserve development database data.
- [ ] Liveness remains 200 during database outage while readiness becomes 503 and later recovers.
- [ ] Invalid required local configuration stops startup with a safe actionable message.
- [ ] Unit/API tests, builds, type checks and lint checks pass using the documented scripts.
- [ ] No application key, webhook secret or database password is committed in real configuration files.
- [ ] The README records actual versions and verified setup commands without claiming later features work.
- [ ] Frontend configuration documents the supplied token/theme integration and does not introduce an unrelated visual theme.
- [ ] Backend modules/shared infrastructure and the frontend `src/app` shell follow the structure contract; DI resolves through module imports/exports and no empty template folders are added.

## Definition of Done

Required functionality is implemented; every acceptance criterion is verified; required tests/checks pass; configuration/setup documentation is updated; no known blocking issues remain. Mark Stage 1 completed only with verification evidence, never merely because initialization generated files.

## Out of Scope

Payment schema, payment APIs, Stripe SDK integration, dashboard workflows, simulation behavior, hardened runtime images, frontend container and GitHub Actions. Redis has no baseline use case and is not added speculatively. Do not perform implementation tasks during the documentation-only design assignment.

## Dependencies

No preceding implementation stage. Establishes the workspace, database access and test runner required by [Stage 2](02-payment-core.md). The [architecture index](../../architecture/README.md) governs all later contracts.

