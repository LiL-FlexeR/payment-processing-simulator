# Stage 3 — Stripe Integration

## Objective

Connect the local payment core to Stripe test-mode Payment Intents with secure confirmation sessions, verified webhooks and recoverable status synchronization. **Stage complete as of 2026-11-19: implementation and deterministic acceptance criteria are verified. By the developer’s explicit decision on the same date, the real Stripe smoke check is deferred until test credentials/webhook forwarding are available and tracked in Stage 5. Actual Stripe behavior is not yet fully verified.**

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

- [x] Pin and document a compatible Stripe SDK/stable API version, snapshot webhook version and supported card-only create parameters.
- [x] Add mode-specific startup validation for test keys, expected Stripe account, stable instance metadata, webhook secret and fixed return URL.
- [x] Add the provider/lease/operational fields to Payment and the WebhookEvent migration; connect nullable audit FKs and required indexes/checks.
- [x] Define the neutral `PaymentProvider` interface, normalized types and runtime `PAYMENT_PROVIDER` token under `src/integrations`.
- [x] Implement the Stripe adapter under `src/integrations/stripe` and the guarded deterministic fake under `src/integrations/fake`, keeping SDK types/error/verification logic inside the adapter.
- [x] Register/export the selected provider through `PaymentProviderModule`; inject the token into feature services and override it in tests without importing the concrete Stripe provider into domain services.
- [x] Implement atomic lease acquisition, expiration, token-checked apply/release and create-parameter freezing.
- [x] Implement confirmation-session with same-key intent recovery and commit-before-secret behavior.
- [x] Implement explicit sync for linked intents without provider creation or confirmation.
- [x] Translate raw Stripe status/errors to the neutral observation phase inside the adapter, then project validated observations through the Payments state machine and transactional audit helper.
- [x] Preserve raw webhook bytes, enforce body limit and verify SDK signatures/timestamp tolerance before parsing business fields.
- [x] Insert/update sanitized receipts by event ID without treating existence as processed status.
- [x] Implement supported/foreign/unsupported-event dispositions and correlation of an unlinked payment using verified metadata plus current retrieval.
- [x] Implement atomic status/audit/receipt completion, same-state no-ops and permanent review dispositions.
- [x] Implement transient failures, persisted retry timing, six-create/23-hour stop rules and safe configuration blocking.
- [x] Add per-attempt receipt history and structured/redacted provider request identifiers.
- [x] Document the manual review procedure, authentic event resend, and operator-authorized reopening of reviewed receipts with an appended audit reason.
- [x] Add signed fake fixtures and PostgreSQL integration tests covering every failure boundary and stale-owner rejection.
- [x] Run deterministic unit/API and real-PostgreSQL integration tests without external provider calls.
- [x] Record the real Stripe smoke check as **SKIPPED / DEFERRED** and transfer execution to Stage 5 by the developer’s explicit decision; no real-provider coverage is claimed.
- [x] Update OpenAPI, environment instructions and architecture only to reflect verified implementation details.

## Expected Files and Modules

Implemented artifacts under `apps/api`: provider interface/token/types/binding module under `src/integrations/`, Stripe implementation under `src/integrations/stripe`, guarded fake under `src/integrations/fake`, `src/modules/payments/` provisioning/sync/lease services, `src/modules/webhooks/` controller/receipt orchestration, updated shared Config, provider/receipt migration and signed fixtures. Use category subfolders only where two or more artifacts exist; keep a lone controller at module root. Use version-compatible Prisma transactions rather than copying old client APIs.

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

- [x] Stripe/live-key and fake-production misconfiguration prevents startup; every accepted relevant object is test-mode and identity-validated.
- [x] Repeated/racing confirmation-session calls yield at most one provider intent creation operation and never reveal a secret before local commit.
- [x] A declined attempt maps to retryable `FAILED`; a timeout preserves financial state and exposes an operational error.
- [x] Invalid signatures/raw-byte tampering are rejected; simulations/tests cannot bypass verification.
- [x] Redelivery after commit produces no duplicate transition; redelivery after rollback recovers it.
- [x] A delayed event cannot regress a terminal payment; stale lease holders cannot overwrite newer work.
- [x] Unknown creates use the same frozen provider operation or stop for review; no unsafe post-cutoff create occurs.
- [x] All deterministic unit/integration checks pass without a network call or provider credentials.
- [x] Provider smoke execution or its explicitly skipped status is recorded separately and accurately.
- [x] Domain services use the neutral DI token, contain no Stripe SDK imports/types and run the same orchestration with a testing-module provider override.

## Definition of Done

Required integration/recovery behavior is implemented; every deterministic acceptance criterion is verified; required deterministic tests/checks pass; provider setup and recovery documentation is updated; no known blocking implementation issues remain. The developer explicitly approved Stage 3 closure on 2026-11-19 with real Stripe smoke execution deferred until credentials are available. This deferral permits Stage 4 development with the verified fake, but does not count as real-provider verification. The deferred smoke check remains visible in Stage 5 and must pass before claiming the full provider demonstration or MVP fully verified.

## Out of Scope

Checkout Sessions, frontend Payment Element, simulation HTTP controls, refunds, subscriptions, production payments, provider switching, background reconciliation and webhook workers. The fake is test infrastructure, not an additional supported payment provider.

## Dependencies

Depends on Stage 2's schema, idempotency and transition/audit invariants. Supplies safe APIs and signed fixtures to [Stage 4](04-payment-simulator.md). Skills are optional aids only.


## Verification Evidence — 2026-11-19

**Status: complete; deterministic acceptance verified; real-provider smoke SKIPPED / DEFERRED by the developer on 2026-11-19.** The developer will supply Stripe credentials later; smoke execution is tracked in Stage 5 and does not block Stage 3 closure or Stage 4 development. No actual Stripe coverage is claimed.

| Area | Verified evidence |
| --- | --- |
| Versions and wire parameters | `stripe` **23.2.0**, stable request/snapshot API **2026-11-18.endive**, matched to the installed SDK types. Create sends `amount`, lowercase `currency`, `confirmation_method=automatic`, `capture_method=automatic`, `allowed_payment_method_types=['card']`, and immutable metadata. No create-time confirmation occurs. The configured `/payments/return` URL is used at confirmation, where Stripe accepts it. |
| Configuration and DI | Explicit mode selection; fake requires simulation enablement, a distinct `whsec_fake_` secret, and a database ending `_fake`/`_test`. Production rejects fake/simulations. Stripe requires test secret/publishable keys, endpoint secret, expected account, exact API version and fixed return URL. Startup retrieves the key's current account and rejects mismatch. The fake is dynamically loaded only in its permitted mode. Tests override `PAYMENT_PROVIDER` and exercise the same domain services. |
| Persistence | Forward migration `20261119000200_stripe_integration`; nullable provider fields, safe defaults, receipt table, restrictive/indexed FKs, lease/count/status checks and immutable intent/frozen-parameter trigger. Existing creation snapshots/operation keys are preserved. |
| Synchronization | Independent Prisma pools race confirmation sessions; one external intent operation survives lost responses and linkage rollback. Database-clock leases, token/expiry checks, terminal guards, immutable identity validation and commit-before-secret behavior pass. |
| Webhooks and crashes | Exact Buffer verification, 256 KiB limit, test/account/version/envelope checks and immutable receipt identity. Sequential/concurrent duplicates, distinct same-state events, delayed decline, all T2–T5 write boundaries, fresh-app recovery, missing-correlation limit and per-attempt history pass. HTTP never spans a database transaction. |
| Retry/review | Persisted backoff and provider delay, six-create budget, exact 23-hour cutoff, known-ID retrieval after cutoff, blocked configuration, identity mismatch, unsupported state and terminal contradiction pass. No request sleep loop or worker exists. |
| Automated checks | `npm test`: **156 passed**. `npm run test:integration`: **62 passed** against real PostgreSQL on port 5433. The deterministic test setup rejects external provider HTTPS requests; all provider credentials are synthetic. Prisma validation, formatting, lint, both workspace typechecks and the API build pass. |
| Runtime and documentation | API image builds and an isolated container on loopback port 3103 passes readiness, committed session linkage, signed duplicate webhooks and immutable creation replay against the separate test PostgreSQL service. Environment generation validates both fake configurations with distinct secrets and 0600 files. Local Markdown paths/anchors pass. The full workspace build encounters the existing Turbopack worker-socket restriction; the unchanged frontend builds successfully with the documented webpack fallback outside the restricted worker sandbox. |
| Real Stripe | `npm run test:stripe-smoke` reports **SKIPPED**. No complete real test credentials/listener configuration is available. No success/decline or authentic forwarding coverage is claimed. |

`src/integrations/stripe/stripe-payment.provider.spec.ts` verifies SDK mapping, errors, signed-byte verification, current-account startup checks and card-only request construction. `test/stripe-integration.integration.spec.ts` verifies the orchestration with signed fake fixtures and PostgreSQL. The existing Payment Core and restart suites still pass. No optional skills were installed. No frontend/design files changed; visual verification is outside this backend-only stage.

### Local Setup and Upgrade

The committed environment examples and generator now choose an explicit, credential-free fake environment (`simulator_fake`) with random local signing/bearer secrets. The normal Compose API reads `apps/api/.env` and overrides its host database URL with `db:5432`. The isolated integration runner continues using `simulator_test` on port 5433 and explicitly selects the signed deterministic fake.

Existing ignored environment files are preserved. When upgrading Stage 2, add the provider/return-URL settings from `apps/api/.env.example`. Choose either a separate fake database or Stripe mode; do not point fake mode at the old `simulator_dev` database. PostgreSQL initialization does not create a new database when its existing volume is reused: create the chosen additional database explicitly, or keep the existing database for Stripe mode. Do not delete the volume to solve configuration errors. Keep the instance UUID stable within an environment and rotate it for a deliberate new/reset environment. Apply the new migration with `npm run db:migrate`; normal API startup deploys it too.

No fake confirmation/simulation HTTP routes exist yet; Stage 4 adds them. Synthetic intent state is process-local. A restarted deterministic fixture must reseed the external fake to represent Stripe's surviving state; local payments/receipts remain in PostgreSQL.

### Deferred Provider Verification

- [ ] After test credentials and authentic webhook forwarding are available, execute the existing Stripe smoke harness and record success/decline/webhook evidence. This task was explicitly deferred by the developer on 2026-11-19 and is owned by [Stage 5](05-testing-and-polish.md#implementation-tasks). It remains required before declaring the full provider demonstration or MVP fully verified.

### Opt-in Real Stripe Smoke

Use a distinct local database/environment. Set `PAYMENT_PROVIDER=stripe`, `SIMULATION_ENABLED=false`, valid `sk_test_` and `pk_test_` keys, `STRIPE_ACCOUNT_ID`, `STRIPE_API_VERSION=2026-11-18.endive`, and `PAYMENT_RETURN_URL=http://localhost:3000/payments/return`. Configure the **snapshot** webhook endpoint/listener to the same API version and subscribe to the six lifecycle events listed above. Keep test payment-method settings restricted to cards. Never use live or Connect credentials.

Use an already available Stripe CLI authenticated to the same test account to forward authentic events to `http://localhost:3001/api/v1/webhooks/stripe`; for example:

```bash
stripe listen --events payment_intent.created,payment_intent.processing,payment_intent.requires_action,payment_intent.payment_failed,payment_intent.succeeded,payment_intent.canceled --forward-to http://localhost:3001/api/v1/webhooks/stripe
```

Check the test account/destination's snapshot version before running. Put that listener's `whsec_` secret in the API configuration and restart the API. A dashboard endpoint's secret is different. With the Stripe-mode API and listener running:

```bash
STRIPE_SMOKE_ENABLED=true npm run test:stripe-smoke
```

The harness creates two intentional local payments, obtains committed sessions, confirms their linked intents with Stripe's supported `pm_card_visa` / `pm_card_chargeDeclined` test methods and the fixed return URL, then requires authentic forwarded `PROCESSED` receipts and the expected `SUCCEEDED` / retryable `FAILED` projections. Sync checks the final projection afterward. It prints only scenario/payment/intent/event IDs and status; no secrets or raw provider exceptions. Failure leaves test objects available for investigation. Record the execution/date/results here and in Stage 5 when credentials are supplied; Stage 3 is already closed under the explicit verification deferral above.

### Operator Recovery and Receipt Reopening

1. Inspect local payment/receipt IDs, safe error codes, provider request IDs and append-only processing history. Search the same Stripe test account's dashboard/request logs using `payment_id`, `app_instance_id` and the original `operation_key`. An empty search is not proof of failure.
2. For a linked payment, use explicit sync after backoff; it retrieves even after the create cutoff and may clear payment review without reopening old receipts. For an unknown unlinked outcome, reuse confirmation-session only inside the original budget/window. Never change its key/parameters/deadline or create a replacement intent to resolve ambiguity.
3. If exactly one matching current test intent is established after cutoff, resend an authentic allowed event using Workbench's resend action or Stripe CLI's `events resend` with the verified event and registered test endpoint. Confirm the forwarding/delivery route for a CLI listener. Do not manufacture or re-sign caller JSON. Normal verification/current retrieval can link the existing intent after cutoff.
4. A receipt already disposed as `REVIEW_REQUIRED` stays disposed on redelivery. An operator must review and authorize a **local parameterized maintenance transaction** first. Lock the receipt, verify its recorded identity/disposition, preserve all prior history, append `{at, outcome:'OPERATOR_REOPENED', code:'OPERATOR_REVIEW', reason:<reviewed investigation reason>}`, set `status='RETRYABLE'`, and clear `next_retry_at`/`last_error_code`. Do not alter delivery/attempt counts, event identity, payment state or provider operation fields. Resend the authentic event afterward. If a maintenance transaction also touches a payment, lock Payment before WebhookEvent.
5. For `BLOCKED`, establish the original operation outcome and safe protection window before authorizing a local transaction that sets the payment to `RETRYABLE`, clears its delay, and appends `PROVIDER_RETRY_SCHEDULED` with the investigation reason. Preserve frozen parameters, first-attempt time, count and key. If parameters must change, keep the existing operation blocked until absence/in-flight risk is conclusively resolved. Multiple/inconsistent matches remain under review.

There is no public maintenance endpoint and no direct financial-status maintenance command. Use bound parameters for IDs/reasons and commit the audit with the reopening. The architecture's [complete recovery contract](../../architecture/idempotency-and-webhooks.md#recovery-of-an-unknown-create) remains authoritative.
