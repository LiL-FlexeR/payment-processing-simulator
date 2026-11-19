# Stage 3 — Stripe Integration

## Objective

Connect the local payment core to Stripe test-mode Payment Intents with secure confirmation sessions, verified webhooks and recoverable status synchronization. This stage has not started.

## Prerequisites

[Stage 2](02-payment-core.md) is verified, including PostgreSQL concurrency tests. Read the [system/provider boundaries](../../architecture/system-overview.md), [database additions and transaction boundaries](../../architecture/database-design.md), [lifecycle mapping](../../architecture/payment-lifecycle.md), [complete idempotency/webhook algorithm](../../architecture/idempotency-and-webhooks.md), and [session/sync/webhook API contracts](../../architecture/api-design.md).

Read [DI and provider replacement boundaries](../../architecture/project-structure.md#dependency-injection-and-provider-replacement). Stripe implementation belongs under `src/integrations/stripe`, while Payments/Webhooks remain domain modules using the injected neutral port.

Deterministic work requires no Stripe credentials. A separate opt-in smoke check needs a Stripe test account/sandbox, test keys and the appropriate webhook forwarding secret. Use official documentation and the installed SDK's types as primary references.

## Scope

Add the provider adapter/port, provider fields and receipt model, fenced synchronization, confirmation-session/sync routes, and Webhooks module. Add a deterministic fake provider for tests now; Stage 4 will expose its fixed confirmation scenarios and other development controls. Payment Element UI is Stage 4 work.

## Technical Requirements

Use Payment Intents, automatic confirmation/capture and supported card restriction parameters from the explicitly pinned Stripe API version. Attach immutable payment/environment metadata. Create at most one intent operation per local payment. The client secret is returned only after local linkage commits and only through confirmation-session.

All create/retrieve/status-application paths share the 30-second database lease and token fencing. Freeze exact provider parameters and first-attempt time before create. Disable implicit SDK retries; use the documented request-driven backoff, six-create budget and conservative 23-hour cutoff. Never start a new provider operation to resolve an unknown outcome.

Process allowed snapshot events synchronously with bounded HTTP calls. Verify signatures using exact raw bytes, record the sanitized receipt durably, retrieve current provider status, and atomically apply business/audit/receipt completion. Return 503 for unfinished transient processing. No worker is introduced. Terminal guards, identity validation and current retrieval handle delayed events; do not rely on event timestamps.

The fake implements the same normalized provider port and signed event envelope but never calls Stripe. It is permitted only in development/test with explicit simulation enablement, uses a separate signing secret/database and fixed fixtures, and must be rejected in production.

## Recommended Codex Skills

Installation is optional and developer-controlled; follow the [skills policy](../ROADMAP.md#codex-skills-policy), and a future existing catalog for installation instructions.

| Skill | Purpose and relevance | Priority |
| --- | --- | --- |
| `nestjs-best-practices` | Review provider injection, raw-body configuration, webhook orchestration and narrow service ownership | Recommended |
| `supabase-postgres-best-practices` | Review receipt uniqueness, row locking, lease fencing and atomic audit/status writes | Recommended |

No dedicated Stripe skill exists in the supplied mapping. Do not add an unrelated skill. Consult [Stripe intent creation](https://docs.stripe.com/api/payment_intents/create), [webhooks](https://docs.stripe.com/webhooks), [idempotency](https://docs.stripe.com/api/idempotent_requests) and [NestJS raw body](https://docs.nestjs.com/faq/raw-body). These are references, not instructions to run installation/setup commands during documentation.

## Implementation Tasks

- [ ] Pin and document a compatible Stripe SDK/stable API version, snapshot webhook version and supported card-only create parameters.
- [ ] Add mode-specific startup validation for test keys, expected Stripe account, stable instance metadata, webhook secret and fixed return URL.
- [ ] Add the provider/lease/operational fields to Payment and the WebhookEvent migration; connect nullable audit FKs and required indexes/checks.
- [ ] Define the neutral `PaymentProvider` interface, normalized types and runtime `PAYMENT_PROVIDER` token under `src/integrations`.
- [ ] Implement the Stripe adapter under `src/integrations/stripe` and the guarded deterministic fake under `src/integrations/fake`, keeping SDK types/error/verification logic inside the adapter.
- [ ] Register/export the selected provider through `PaymentProviderModule`; inject the token into feature services and override it in tests without importing the concrete Stripe provider into domain services.
- [ ] Implement atomic lease acquisition, expiration, token-checked apply/release and create-parameter freezing.
- [ ] Implement confirmation-session with same-key intent recovery and commit-before-secret behavior.
- [ ] Implement explicit sync for linked intents without provider creation or confirmation.
- [ ] Translate raw Stripe status/errors to the neutral observation phase inside the adapter, then project validated observations through the Payments state machine and transactional audit helper.
- [ ] Preserve raw webhook bytes, enforce body limit and verify SDK signatures/timestamp tolerance before parsing business fields.
- [ ] Insert/update sanitized receipts by event ID without treating existence as processed status.
- [ ] Implement supported/foreign/unsupported-event dispositions and correlation of an unlinked payment using verified metadata plus current retrieval.
- [ ] Implement atomic status/audit/receipt completion, same-state no-ops and permanent review dispositions.
- [ ] Implement transient failures, persisted retry timing, six-create/23-hour stop rules and safe configuration blocking.
- [ ] Add per-attempt receipt history and structured/redacted provider request identifiers.
- [ ] Document the manual review procedure, authentic event resend, and operator-authorized reopening of reviewed receipts with an appended audit reason.
- [ ] Add signed fake fixtures and PostgreSQL integration tests covering every failure boundary and stale-owner rejection.
- [ ] Run deterministic tests; separately perform and record an opt-in real Stripe smoke check when test credentials are available.
- [ ] Update OpenAPI, environment instructions and architecture only to reflect verified implementation details.

## Expected Files and Modules

Planned artifacts under `apps/api`: provider interface/token/types/binding module under `src/integrations/`, Stripe implementation under `src/integrations/stripe`, guarded fake under `src/integrations/fake`, `src/modules/payments/` provisioning/sync/lease services, `src/modules/webhooks/` controller/receipt orchestration, updated shared Config, provider/receipt migration and signed fixtures. Use category subfolders only where two or more artifacts exist; keep a lone controller at module root. Use version-compatible Prisma transactions rather than copying old client APIs.

No application endpoint accepts raw card data, arbitrary target status or caller-controlled provider operation parameters. Keep fake-only mutation helpers out of the production provider implementation. Do not create a standalone PaymentAttempt model.

## API / Database Changes

Add `POST /api/v1/payments/:id/confirmation-session`, `POST /api/v1/payments/:id/sync`, and `POST /api/v1/webhooks/stripe`. Extend payment details with provider/operational fields and the event query with optional webhook correlation. Implement the exact schemas/statuses in [API design](../../architecture/api-design.md), including busy-webhook 503 versus interactive 409.

Add all deferred Payment provider fields, WebhookEvent and nullable PaymentEvent webhook FK. Existing local records retain their original response snapshots and operation keys; backfill safe `NOT_STARTED`/zero/null defaults without inventing provider observations.

## Testing Requirements

- Unit: provider mapping, decline versus transport error, safe error classification, parameter freezing, cutoff/budget/backoff calculations and signature rejection.
- HTTP/PostgreSQL: valid signed fixtures; tampered bytes, wrong/missing secret, expired signature, malformed envelope, live-mode and foreign-account rejection.
- Duplicate/out-of-order: same event concurrently/sequentially; different IDs reporting the same state; delayed decline after success; canceled terminal guard; no extra status-versioned events.
- Transactions: fail T4 before commit, prove no partial status/event/processed receipt, then process redelivery successfully.
- Unknown outcomes: fake provider accepts create then loses response; same-key recovery returns the same intent; a webhook can link it before the create response is saved.
- Ownership: expire/take over a lease while an earlier retrieve is blocked; late owner cannot commit or release the new token. Confirm no HTTP call runs inside a database transaction.
- Retry/review: 429/5xx, known-ID retrieve after cutoff, unlinked create cutoff, six-attempt exhaustion, permanent mismatches and missing-correlation attempt limit.
- Separate opt-in Stripe smoke: create a test intent, confirm through a Stripe-supported test harness/method, forward authentic webhooks and inspect success/decline mapping. Do not require credentials for the deterministic suite or claim smoke coverage when skipped.

Use a controllable fake provider and test clock where appropriate; use real PostgreSQL for leases and transactions. Simulate expiry in isolated test data rather than waiting 30 seconds in every test. Browser confirmation coverage arrives in Stage 4.

## Acceptance Criteria

- [ ] Stripe/live-key and fake-production misconfiguration prevents startup; every accepted relevant object is test-mode and identity-validated.
- [ ] Repeated/racing confirmation-session calls yield at most one provider intent creation operation and never reveal a secret before local commit.
- [ ] A declined attempt maps to retryable `FAILED`; a timeout preserves financial state and exposes an operational error.
- [ ] Invalid signatures/raw-byte tampering are rejected; simulations/tests cannot bypass verification.
- [ ] Redelivery after commit produces no duplicate transition; redelivery after rollback recovers it.
- [ ] A delayed event cannot regress a terminal payment; stale lease holders cannot overwrite newer work.
- [ ] Unknown creates use the same frozen provider operation or stop for review; no unsafe post-cutoff create occurs.
- [ ] All deterministic unit/integration checks pass without a network call or provider credentials.
- [ ] Provider smoke execution or its explicitly skipped status is recorded separately and accurately.
- [ ] Domain services use the neutral DI token, contain no Stripe SDK imports/types and run the same orchestration with a testing-module provider override.

## Definition of Done

Required integration/recovery behavior is implemented; every deterministic acceptance criterion is verified; required tests/checks pass; provider setup and recovery documentation is updated; no known blocking issues remain. If real Stripe access is unavailable, deterministic development can proceed, but the provider smoke verification remains visibly outstanding and must be resolved before claiming the Stripe integration fully verified.

## Out of Scope

Checkout Sessions, frontend Payment Element, simulation HTTP controls, refunds, subscriptions, production payments, provider switching, background reconciliation and webhook workers. The fake is test infrastructure, not an additional supported payment provider.

## Dependencies

Depends on Stage 2's schema, idempotency and transition/audit invariants. Supplies safe APIs and signed fixtures to [Stage 4](04-payment-simulator.md). Skills are optional aids only.

