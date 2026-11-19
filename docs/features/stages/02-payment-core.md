# Stage 2 — Payment Core

## Objective

Implement local payment persistence, a testable state machine, read APIs and concurrency-safe idempotent creation before contacting Stripe. This stage has not started.

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

- [ ] Create the three core entities with the applicable fields, checks, unique constraints and indexes from the database contract.
- [ ] Create/review the first domain migration; apply it against an empty test database.
- [ ] Add `src/modules/payments` with constructor-injected persistence, validated request/query DTOs, response DTOs and pure transition logic.
- [ ] Keep a single controller/service/type/interface at module root; introduce each category folder only when that category contains two or more artifacts, updating imports/tests together.
- [ ] Implement exact currency normalization, strict integer validation and canonical SHA-256 fingerprinting.
- [ ] Reject missing/duplicate/invalid application key headers and unknown payload fields before writes.
- [ ] Implement atomic T1 creation and store the exact 201 response snapshot and immutable provider operation key.
- [ ] Implement specific uniqueness-conflict rollback handling, fresh winner reads and hash-based 409 responses.
- [ ] Implement bounded retries for local transient transaction conflicts, without swallowing other constraint errors.
- [ ] Implement list/details/events routes and validated tuple/bigint cursor pagination.
- [ ] Add the transaction-aware status/audit helper and status-version uniqueness protection.
- [ ] Add safe exception mapping, response allowlists, request IDs and redacted structured logs.
- [ ] Generate local Swagger DTO documentation matching the API contract.
- [ ] Write and run state/validation/idempotency unit tests and real PostgreSQL HTTP/concurrency/rollback tests.
- [ ] Update README with verified local API examples and keep provider/dashboard behavior marked planned.

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

- [ ] Valid creation returns 201 and persists one Payment, key record and initial audit event atomically.
- [ ] Ten simultaneous requests with the same key/payload all eventually obtain the same 201 body, leaving one payment and one creation event.
- [ ] A conflicting-key payload returns 409 without creating a second payment; concurrent conflicts are also safe.
- [ ] The original response is replayed after later state changes and after API restart.
- [ ] Invalid amounts/currencies/headers are rejected without rows; SQL constraints independently reject invalid direct writes.
- [ ] List/detail/event APIs obey schemas and pagination and return no provider secrets/internal lock data.
- [ ] State-machine and status/audit rollback tests pass for every transition category.
- [ ] No payment endpoint contacts Stripe, and all required unit/integration checks pass.
- [ ] Payments uses constructor DI and feature-local artifacts, with shared code and category folders placed according to the structure contract.

## Definition of Done

Required functionality is implemented; all acceptance criteria have verification evidence; tests/checks pass; schema/API/setup docs are updated; no known blocking issues remain. Do not mark Stage 2 complete from generated schema/controller files alone.

## Out of Scope

Stripe calls, client secrets, provider confirmation, webhook receipt processing, leases, simulation controls and frontend payment workflows. Internal state-machine tests do not authorize an externally accessible status setter.

## Dependencies

Depends on Stage 1's Prisma/PostgreSQL and Jest/Supertest setup. Supplies the local consistency/idempotency foundation for [Stage 3](03-stripe-integration.md). Optional skills are never dependencies.
