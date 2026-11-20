# Architecture Documentation

This is the implementation contract for the Payment Processing Simulator. The application is a local, single-developer, test-mode modular monolith. These documents specify the full intended behavior. Stages 1–2 have implemented and verified workspace/configuration, database connectivity, health routes, the frontend shell and local Payment Core (creation, idempotency, reads and internal audited transitions). Stage 3 is complete with provider synchronization, confirmation sessions and signed webhook recovery deterministically verified; the developer explicitly deferred real Stripe smoke execution to Stage 5 until credentials are available. Actual Stripe behavior remains unverified. Stage 4 implements the dashboard and guarded simulation workflows, verified with real PostgreSQL/API and deterministic browser checks; the developer explicitly deferred manual real Payment Element verification to Stage 5. See the [roadmap](../features/ROADMAP.md) for verified implementation status.

## Reading Order and Contract Ownership

| Document | Owns |
| --- | --- |
| [System overview](system-overview.md) | Component/module boundaries, provider choice, configuration, security and runtime assumptions |
| [Project structure](project-structure.md) | Source layout, dependency injection, provider isolation, component conventions and frontend API hooks |
| [Database design](database-design.md) | Entity fields, constraints, indexes, persistence invariants and transaction boundaries |
| [Payment lifecycle](payment-lifecycle.md) | Financial statuses, valid transitions and provider-to-local mapping |
| [Idempotency and webhooks](idempotency-and-webhooks.md) | Concurrency, leases, delivery semantics, retries and recovery algorithms |
| [API design](api-design.md) | Public requests, responses, validation, pagination and error contracts |

Read them in this order, then follow the [roadmap](../features/ROADMAP.md). Stage documents describe how to implement these contracts and link back to the relevant decisions. If a change affects another contract, update all affected documents before marking the stage complete. The owning document resolves accidental duplication; do not implement contradictory interpretations.

## Design and Agent Context

[AGENTS.md](../../AGENTS.md) defines the required development reading order. The supplied [design reference](../design/DESIGN.md), [JSON tokens](../design/tokens.json), [CSS variables](../design/variables.css) and [Tailwind theme](../design/theme.css) govern visual implementation. Read them before frontend configuration, UI work and visual review. Architecture remains authoritative for financial states, APIs and security; visual examples do not redefine those contracts.

## Shared Invariants

- One global demo namespace; no user accounts, tenants or Stripe Connect.
- Integer minor units only; USD/EUR and 100–1,000,000 minor units in the MVP.
- One local `Payment` and immutable creation response per application idempotency key.
- At most one Stripe PaymentIntent creation operation per payment, using a stable provider key.
- `FAILED` is retryable. `SUCCEEDED` and `CANCELED` are terminal.
- Provider observations are authoritative; local status is a durable projection.
- Every actual status transition and its `PaymentEvent` commit atomically.
- A verified webhook is acknowledged only after its durable processing disposition commits.
- No external HTTP calls occur inside database transactions.
- Optional skills are aids; the roadmap works with none installed.

## Decision Boundaries

The design deliberately uses synchronous, bounded webhook handling with Stripe redelivery and an explicit synchronization endpoint. Durable receipt alone is not sufficient for acknowledging an actionable webhook because no worker will drain unfinished receipts. A later queue design must explicitly change that contract.

The four domain entities are `Payment`, `IdempotencyRecord`, `PaymentEvent`, and `WebhookEvent`. A separate `PaymentAttempt` is unnecessary: the MVP has one intent and no independent server-side charge-attempt workflow. Raw provider payloads and payment credentials are outside the stored data model.

Provider isolation is an implementation boundary for future replacement, not a claim that switching providers is configuration-only. The database/API/UI currently contain intentional Stripe-specific contracts; replacing Stripe requires a separately scoped migration.

