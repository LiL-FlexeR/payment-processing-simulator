# Stage 2 — Payment Core

## Objective

Implement local payment persistence, a testable state machine, read APIs and concurrency-safe idempotent creation before contacting Stripe. **Complete — acceptance verified on 2026-11-19.**

## Prerequisites

[Stage 1](01-project-setup.md) is verified. Read the [database design](../../architecture/database-design.md), [lifecycle](../../architecture/payment-lifecycle.md), [API contracts](../../architecture/api-design.md) and [application idempotency algorithm](../../architecture/idempotency-and-webhooks.md#api-idempotency).

Follow the [backend layout and constructor-DI rules](../../architecture/project-structure.md#backend-layout). Keep Payments under `apps/api/src/modules/payments` and shared persistence/HTTP infrastructure under `src/shared`.

## Scope

Build the Payments module and local `Payment`, `IdempotencyRecord`, and `PaymentEvent` models. Define the full financial state enum and pure transition function now, but expose only local creation and read endpoints. Provider/receipt fields and operational synchronization are added in Stage 3.

## Technical Requirements

Use integer amounts with both API validation and SQL checks. Persist uppercase USD/EUR, UUID payment IDs, UTC timestamps, and bigint audit IDs serialized as strings. Follow the documented cursor ordering and explicit response DTO allowlists.

T1 atomically writes the payment, immutable creation-response record and version-1 creation event. The `(scope,key)` unique constraint is the final concurrency guard. Catch conflicts after rollback and read the committed winner. Do not use an in-memory mutex, read-then-write check alone or a provider call in T1. Persist the stable `providerOperationKey` now even though it is not used until Stage 3.

The state machine includes all transitions and same-state no-ops from the lifecycle contract. A transaction-aware status/audit helper must be testable using internal validated-observation fixtures; do not expose a status mutation endpoint to exercise it. Increment `statusVersion` and create exactly one matching event for real transitions. The 201 snapshot always remains `CREATED`, independent of mutable payment status.

## Recommended Codex Skills

All aids are optional to install. Follow the [skills policy](../ROADMAP.md#codex-skills-policy); use a later developer-supplied catalog for installation instructions if available.

| Skill | Purpose and relevance | Priority |
| --- | --- | --- |
| `nestjs-best-practices` | Review controller/service boundaries and transaction-aware dependency injection | Recommended |
| `supabase-postgres-best-practices` | Review native PostgreSQL uniqueness, checks, FKs, indexes and transaction contention; Supabase hosting is not required | Recommended |
| `prisma-client-api` | Review query/transaction usage only if its API matches the selected Prisma version | Recommended when compatible; omit for Prisma 8 |

If Prisma 8 is selected, use its version-specific official client/transaction documentation instead of treating `prisma-client-api` as authoritative. No optional skill is a prerequisite to this stage.

## Implementation Tasks

- [x] Create the three core entities with the applicable fields, checks, unique constraints and indexes from the database contract.
- [x] Create/review the first domain migration; apply it against an empty test database.
- [x] Add `src/modules/payments` with constructor-injected persistence, validated request/query DTOs, response DTOs and pure transition logic.
- [x] Keep a single controller/service/type/interface at module root; introduce each category folder only when that category contains two or more artifacts, updating imports/tests together.
- [x] Implement exact currency normalization, strict integer validation and canonical SHA-256 fingerprinting.
- [x] Reject missing/duplicate/invalid application key headers and unknown payload fields before writes.
- [x] Implement atomic T1 creation and store the exact 201 response snapshot and immutable provider operation key.
- [x] Implement specific uniqueness-conflict rollback handling, fresh winner reads and hash-based 409 responses.
- [x] Implement bounded retries for local transient transaction conflicts, without swallowing other constraint errors.
- [x] Implement list/details/events routes and validated tuple/bigint cursor pagination.
- [x] Add the transaction-aware status/audit helper and status-version uniqueness protection.
- [x] Add safe exception mapping, response allowlists, request IDs and redacted structured logs.
- [x] Generate local Swagger DTO documentation matching the API contract.
- [x] Write and run state/validation/idempotency unit tests and real PostgreSQL HTTP/concurrency/rollback tests.
- [x] Update README with verified local API examples and keep provider/dashboard behavior marked planned.

## Expected Files and Modules

Planned artifacts under `apps/api`: Prisma core schema/migration; `src/modules/payments/` module, controller, services as needed, DTOs, state machine, idempotency helper and audit helper; `src/shared/http/` error/request-ID handling; unit and integration/API test suites. Reuse Config/Database from `src/shared`. Apply category folders according to actual size rather than creating them all in advance. Do not introduce a generic repository package or separate Payment Events module.

## API / Database Changes

Add `POST /api/v1/payments`, `GET /api/v1/payments`, `GET /api/v1/payments/:id`, and `GET /api/v1/payments/:id/events`. Implement header/status/cursor/error schemas from [API design](../../architecture/api-design.md).

The initial Payment contains core identity, amount/currency, status/version, immutable provider operation key, timestamps and `provisioningStatus=NOT_STARTED`; details serialize future nullable provider fields as null. PaymentEvent's webhook FK is deferred until the WebhookEvent table exists in Stage 3. No provider secret, raw event payload, or card data is stored.

## Testing Requirements

- Unit: every permitted/rejected transition, terminal guards, same-state no-op, amount bounds/types, currency normalization, unknown fields, key syntax, canonical hashes and error classification.
- PostgreSQL/Supertest: persistence, unique scope/key, different-key identical payloads creating separate intentional payments, identical-key replay, conflicting payload 409, parallel same/different payload races and no orphan rows.
- Rollback: inject failure between core writes and verify zero partial payments/keys/events; retry succeeds with the original key.
- Snapshot: change a payment through the internal tested service fixture, then prove replay still returns the original 201 body while GET shows the new state.
- Read contracts: missing/invalid IDs, status filter, cursor ties, page exhaustion, bigint string serialization, no leaked internal fields.

Run races with real concurrent HTTP requests and separate database connections, not sequential promises or mocked Prisma. These tests are deterministic and require no Stripe credentials.

## Acceptance Criteria

- [x] Valid creation returns 201 and persists one Payment, key record and initial audit event atomically.
- [x] Ten simultaneous requests with the same key/payload all eventually obtain the same 201 body, leaving one payment and one creation event.
- [x] A conflicting-key payload returns 409 without creating a second payment; concurrent conflicts are also safe.
- [x] The original response is replayed after later state changes and after API restart.
- [x] Invalid amounts/currencies/headers are rejected without rows; SQL constraints independently reject invalid direct writes.
- [x] List/detail/event APIs obey schemas and pagination and return no provider secrets/internal lock data.
- [x] State-machine and status/audit rollback tests pass for every transition category.
- [x] No payment endpoint contacts Stripe, and all required unit/integration checks pass.
- [x] Payments uses constructor DI and feature-local artifacts, with shared code and category folders placed according to the structure contract.

## Definition of Done

Required functionality is implemented; all acceptance criteria have verification evidence; tests/checks pass; schema/API/setup docs are updated; no known blocking issues remain. Do not mark Stage 2 complete from generated schema/controller files alone.

## Verification Evidence — 2026-11-19

All acceptance criteria above passed before completion was recorded. Verification used Node 24.16.0/npm 11.13.0 on the host, the existing Node 24.22.3 API image, Prisma 7.10.1 and real PostgreSQL 17.9. No Stripe credentials were required and no optional Codex skills were installed.

| Criterion | Verified evidence |
| --- | --- |
| Migration and persistence | The [first domain migration](../../../apps/api/prisma/migrations/20261119000100_payment_core/migration.sql) deployed to the initially empty isolated tmpfs test database; subsequent deploys had no pending migrations. SQL tests independently rejected invalid amounts/types, currency, version and operation keys, restrictive FK violations and duplicate financial event versions. Multiple null operational event versions remain legal. |
| Atomic local creation | [PostgreSQL HTTP tests](../../../apps/api/test/payments.integration.spec.ts) assert the exact 201 representation, headers, immutable provider operation key and one payment/key/creation event. Database triggers injected failures at the creation-event and key-record writes: each response was sanitized, all three tables remained empty and the original key then succeeded. Test-only triggers/functions were removed. |
| Concurrent creation/conflicts | Three runs of ten simultaneous Supertest requests through two separate Nest applications/Prisma pools each returned ten identical 201 bodies, one winner and nine replays, with one payment/key/event. Distinct PostgreSQL backend PIDs confirmed separate connections. Ten mixed-payload requests yielded five identical 201s and five 409s, with no orphan rows. Different keys, including different case, intentionally created separate payments. |
| Snapshot durability | An internal validated-observation fixture advanced a payment to `SUCCEEDED`; creation replay remained the original `CREATED` body while GET showed version 2. The [restart suite](../../../apps/api/test/payments-restart.integration.spec.ts) stopped the compiled API process and started a new PID against the same PostgreSQL data: replay returned byte-identical 201 JSON, GET retained success and counts remained one payment/key with two events. |
| Validation and reads | Invalid body/header requests left no rows. Tests verify strict integers and bounds, normalized currency/canonical hashes, missing/duplicate singleton headers, unknown query/body fields, malformed/oversized/filter-mismatched cursors, invalid/missing IDs and read-body rejection. Tied timestamps paginate by descending UUID; event IDs above JavaScript's safe integer limit round-trip exactly as decimal strings with descending bigint cursors. Empty/exhausted pages return null cursors; explicit response allowlists exclude internal fields. |
| State and audit | [Unit tests](../../../apps/api/src/modules/payments/payment-core.spec.ts) cover all 25 financial state pairs and normalized phases. Real database fixtures exercise every observable transition category, terminal rejection, same-state no-op, unsupported observations, rollback after the helper and failure of the audit insert. Two concurrent success observations produce exactly one new version/event. There is no public status setter. |
| Safe HTTP and documentation | [HTTP tests](../../../apps/api/test/payment-http.spec.ts) verify sanitized 500/503 responses, `Retry-After`, 120/minute write throttling, equivalent trailing-slash routes, JSON media/encoding limits and production Swagger absence. Integration tests verify exact error/header schemas, a 16 KiB body limit, redacted structured logs and generated DTO/OpenAPI schemas. An actual unreachable database returns retryable `DATABASE_UNAVAILABLE` without connection details. |
| Checks and runtime | `npm test`: **118 passed** in four suites. `npm run test:integration`: **33 passed** in three suites, including actual process restart. `npm run db:validate`, `npm run lint`, `npm run typecheck`, formatting and diff checks passed. The API build passed; the unchanged web shell built successfully with `npm run build --workspace @simulator/web -- --webpack`. Compose rebuilt successfully, applied the migration before Nest startup and reached healthy API/database state. Host HTTP smoke checks exercised the README create/replay example, list/details/events, readiness and OpenAPI JSON. |
| Scope and structure | Payments owns one root controller, two constructor-DI services under `services/`, DTOs and local pure helpers. Shared HTTP/error/database concerns stay in `src/shared`. No repository abstraction, payment-events module, provider SDK/calls, frontend payment work, leases, webhooks, Redis or simulation endpoints were added. Design reference files were preserved. |

The default `npm run build` remains blocked in this managed environment by Turbopack's prohibition on binding its CSS worker socket, including after retry outside the command sandbox. This is the same environment limitation recorded in Stage 1; the API and Webpack fallback build pass. No frontend implementation or visual changes were required for Stage 2. The runtime-only npm audit reports zero findings; the full audit reports 18 moderate findings in the unchanged Jest/glob/minimatch development-tool tree, retained for Stage 5 review without unverified overrides or major downgrades. Provider smoke tests and dashboard/browser scenarios remain later-stage work.

## Out of Scope

Stripe calls, client secrets, provider confirmation, webhook receipt processing, leases, simulation controls and frontend payment workflows. Internal state-machine tests do not authorize an externally accessible status setter.

## Dependencies

Depends on Stage 1's Prisma/PostgreSQL and Jest/Supertest setup. Supplies the local consistency/idempotency foundation for [Stage 3](03-stripe-integration.md). Optional skills are never dependencies.
