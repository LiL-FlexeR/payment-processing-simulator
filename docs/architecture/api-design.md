# REST API Design

## Conventions and Shared Schemas

Backend base path: `/api/v1`. Local backend origin: `http://localhost:3001`; the browser uses the Next.js same-origin proxy on port 3000. Stages 1–3 implement health, payment create/list/detail/events, confirmation sessions, explicit sync and signed snapshot webhooks, with local Swagger at `/api/docs`. Simulation routes remain **future Stage 4 contracts**. Stage 3 is complete with deterministic checks passing; the developer explicitly deferred real Stripe smoke execution to Stage 5 until credentials are available. Actual Stripe behavior remains unverified. The frontend proxy still exposes only health until Stage 4. See the [Stage 2 verification evidence](../features/stages/02-payment-core.md#verification-evidence--2026-11-19). Use JSON with camelCase fields, UUID payment IDs, uppercase local status/currency, UTC ISO-8601 timestamps, and decimal strings for audit bigint IDs. Reject unknown body fields and duplicate singleton headers. Do not coerce monetary strings or floats into integers.

Normal JSON requests use `Content-Type: application/json` and optional `X-Request-Id` (UUID; otherwise generate one). Responses echo a safe generated/validated `X-Request-Id`, use `Cache-Control: no-store`, and never include a stack trace. No authentication is required for the local demo payment endpoints; the loopback-only boundary in the [system overview](system-overview.md) is part of this contract. Browser-facing proxy requests must satisfy its Host/Origin policy.

All monetary input is integer minor units, 100–1,000,000 inclusive. Currency accepts case-insensitive `USD`/`EUR`, trimmed then normalized to uppercase. JSON request limit is 16 KiB, except the raw webhook limit of 256 KiB. Wrong JSON media type is 415; malformed JSON is 400; excess body size is 413; request throttling is 429 with `Retry-After`. All endpoints may return generic 500 for unexpected faults and 503 for unavailable persistence. These shared statuses apply in addition to each endpoint's table.

### CreatePaymentBody

```json
{"amount":2500,"currency":"USD"}
```

Exactly these fields are accepted. Payment amounts and currency are immutable after creation. Format/parse currency values using integer/string operations, including decimal input in the UI; never use floating-point multiplication or rounding for money. These conservative ranges intentionally avoid introducing currency exponent and provider-minimum configuration.

### CreationRepresentation

```json
{
  "id":"9d576a31-e423-4422-9a4c-c1346ad6534e",
  "amount":2500,
  "currency":"USD",
  "status":"CREATED",
  "createdAt":"2026-11-19T15:00:00.000Z"
}
```

### PaymentSummary and PaymentDetails

`PaymentSummary` has the creation fields plus current `status` (the full enum), `updatedAt`, `statusVersion` (positive integer), and `provisioningStatus`. Its creation timestamp is unchanged. `PaymentDetails` adds nullable `stripePaymentIntentId`, `providerStatus`, `lastSyncedAt`, `nextProviderRetryAt`, and `lastProviderErrorCode`. Provisioning enum: `NOT_STARTED`, `READY`, `RETRYABLE`, `BLOCKED`, `REVIEW_REQUIRED`. Exclude provider parameters, leases, application keys, request hashes, complete provider objects and client secrets.

```json
{
  "id":"9d576a31-e423-4422-9a4c-c1346ad6534e",
  "amount":2500,"currency":"USD","status":"SUCCEEDED",
  "createdAt":"2026-11-19T15:00:00.000Z",
  "updatedAt":"2026-11-19T15:01:00.000Z","statusVersion":3,
  "provisioningStatus":"READY","stripePaymentIntentId":"pi_example",
  "providerStatus":"succeeded","lastSyncedAt":"2026-11-19T15:01:00.000Z",
  "nextProviderRetryAt":null,"lastProviderErrorCode":null
}
```

### Errors

```json
{
  "error":{
    "code":"IDEMPOTENCY_KEY_REUSED",
    "message":"This key was already used with a different request.",
    "requestId":"56901bf7-a8e3-4ab8-936b-1542f91e947a",
    "retryable":false,
    "details":null
  }
}
```

`details` is null or an array of safe `{field, message}` validation entries. Do not echo submitted sensitive values. Codes are stable application enums. `retryable` indicates whether the same operation can be retried later; it never instructs the caller to generate a new key or reconfirm a payment.

| Code | Status | Meaning |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Header, body, query, cursor or UUID invalid |
| `INVALID_WEBHOOK` | 400 | Invalid signature, envelope, mode or event identity |
| `FORBIDDEN` | 403 | Development token/origin checks failed |
| `PAYMENT_NOT_FOUND`, `EVENT_NOT_FOUND` | 404 | Resource missing |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Same application key, different canonical payload |
| `OPERATION_IN_PROGRESS` | 409 | Payment lease busy; retry later |
| `PAYMENT_NOT_CONFIRMABLE` | 409 | Terminal status or intent currently processing |
| `PROVIDER_NOT_INITIALIZED` | 409 | Sync requested without a linked intent |
| `PROVIDER_CONFIGURATION_ERROR` | 502 | Definitive provider configuration failure; fix before retry |
| `PROVIDER_UNAVAILABLE`, `PROVIDER_OUTCOME_UNKNOWN` | 503 | Transient retrieve failure or ambiguous create outcome |
| `DATABASE_UNAVAILABLE` | 503 | Transaction unavailable or retries exhausted |
| `REVIEW_REQUIRED` | 409 | Safe automation stopped; operator investigation required |
| `INTERNAL_ERROR` | 500 | Unexpected failure; safe generic message |
| `NOT_FOUND` | 404 | Route not registered |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Expected JSON media type or supported encoding |
| `PAYLOAD_TOO_LARGE` | 413 | JSON body exceeds its size limit |
| `RATE_LIMITED` | 429 | Local creation request limit reached; retry after the indicated delay |

The API limits local creation to 120 requests per minute per IP per API process. This modest in-memory abuse limit is independent of durable payment idempotency; it is not a consistency lock. Structured HTTP logs allow only safe correlation IDs, route templates, methods, statuses, durations, error codes and replay flags. Request bodies, keys, query strings, database/driver messages and provider data are excluded.

Set `Retry-After` to the rounded-up remaining backoff/lease seconds on retryable 409/503 responses, with a minimum of 1. A `REVIEW_REQUIRED` financial observation on sync is returned as a 409 after its disposition is committed. Webhook permanent review dispositions instead return 200 as described below.

## POST /api/v1/payments

**Purpose:** create one durable local payment. **Headers:** standard JSON plus required `Idempotency-Key`, 16–128 characters matching `[A-Za-z0-9._:-]+`; optional `X-Request-Id`. **Body:** `CreatePaymentBody`. **Validation:** shared money/currency/unknown-field rules. **Provider calls:** none.

**Response:** 201 `CreationRepresentation` with `Location: /api/v1/payments/<id>` and `Idempotency-Replayed: false` for the winner, `true` for a replay. Same status and JSON body on identical retries, even if live financial status later changes. **Errors:** 400 validation, 409 key/payload conflict, 503 persistence contention/failure. A rollback leaves no accepted key. Only a committed 201 response is retained.

```http
POST /api/v1/payments
Content-Type: application/json
Idempotency-Key: 37718d8d-075e-493d-a419-c060381959ef

{"amount":2500,"currency":"usd"}
```

Response: 201 with the creation example above. Repeating that key with `amount:2600` yields the error example. Scope is the global `demo:create-payment:v1` namespace with no expiry; see [idempotency rules](idempotency-and-webhooks.md).

## GET /api/v1/payments

**Purpose:** payment history. **Headers:** optional request ID; no body, idempotency key or provider call. **Query:** optional `status` (exact local enum), `limit` (integer 1–100, default 20), and opaque `cursor`. Reject unknown query fields and malformed/oversized cursors (maximum 1,024 characters).

**Response:** 200 `{items: PaymentSummary[], nextCursor: string|null}`. Sort by `(createdAt DESC,id DESC)`. The cursor encodes the last tuple and active status filter in base64url JSON; validate types and filter match. Cursor contents are not authorization claims. Use a strict tuple comparison, not offset pagination. Empty/end pages return `nextCursor:null`. Rows may change status between reads; pagination is not a database snapshot.

```http
GET /api/v1/payments?status=SUCCEEDED&limit=20
```

```json
{"items":[],"nextCursor":null}
```

**Errors:** 400 invalid filter/limit/cursor. **Idempotency:** read-only; does not synchronize or advance provider operations.

## GET /api/v1/payments/:id

**Purpose:** current local details. **Headers:** optional request ID. **Body/query:** none. **Validation:** UUID `id`; reject unknown query fields. **Response:** 200 `PaymentDetails`, using the example above. **Errors:** 400 invalid ID, 404 `PAYMENT_NOT_FOUND`. **Idempotency:** read-only; no provider lookup or status update.

```http
GET /api/v1/payments/9d576a31-e423-4422-9a4c-c1346ad6534e
```

## GET /api/v1/payments/:id/events

**Purpose:** ordered audit history. **Headers:** optional request ID. **Body:** none. **Query:** `limit` 1–100 default 50; opaque cursor encoding the last positive bigint event ID, maximum 1,024 characters. Validate payment UUID and cursor; reject other query fields.

**Response:** 200 `{items: PaymentEventRepresentation[], nextCursor: string|null}`, newest first by audit ID. Each event includes `id` (decimal string), `paymentId`, `type`, nullable `fromStatus`, `toStatus`, `statusVersion`, `webhookEventId`, allowlisted `details`, and `createdAt`. **Errors:** 400 invalid query/ID, 404 missing payment. **Idempotency:** read-only; duplicate delivery counts are not fabricated as financial events.

```http
GET /api/v1/payments/9d576a31-e423-4422-9a4c-c1346ad6534e/events?limit=50
```

```json
{
  "items":[{
    "id":"1","paymentId":"9d576a31-e423-4422-9a4c-c1346ad6534e",
    "type":"PAYMENT_CREATED","fromStatus":null,"toStatus":"CREATED",
    "statusVersion":1,"webhookEventId":null,"details":{"source":"api"},
    "createdAt":"2026-11-19T15:00:00.000Z"
  }],
  "nextCursor":null
}
```

## POST /api/v1/payments/:id/confirmation-session

**Purpose:** create/recover the one intent, or retrieve its current confirmation session. **Headers:** standard JSON/request ID; no application idempotency header required because operation identity derives from payment ID. **Body:** exactly `{}`. **Validation:** UUID, local payment exists, retry time permits, financial status is not terminal/processing, and create safety budget permits if not linked.

**Response:** 200 `{paymentId, provider, clientSecret, publishableKey, providerStatus}`; required strings, with `provider` equal to `stripe` or `fake`. This is the only API response containing a Stripe client secret. Send it only after validated linkage commits; never cache it. Existing linked intents are retrieved, not created again. A `FAILED` payment may obtain the same intent's secret to retry its method. `requires_action` can resume through Stripe.js. Fake sessions contain clearly synthetic credentials and must never be passed to Stripe.js.

```http
POST /api/v1/payments/9d576a31-e423-4422-9a4c-c1346ad6534e/confirmation-session
Content-Type: application/json

{}
```

```json
{"paymentId":"9d576a31-e423-4422-9a4c-c1346ad6534e","provider":"stripe","clientSecret":"pi_example_secret_REDACTED","publishableKey":"pk_test_REDACTED","providerStatus":"requires_payment_method"}
```

**Errors:** 400 validation, 404 missing payment, 409 busy/terminal/processing/review, 502 blocked configuration, 503 transient provider/database failure. Check terminal state again after retrieval; if retrieval discovers success/cancellation/processing, commit the observation and return `PAYMENT_NOT_CONFIRMABLE` instead of a usable secret. The UI then fetches details. Repeated calls need not return byte-identical provider status; they are operation-idempotent through the stable provider key and lease, unlike the frozen create response.

## POST /api/v1/payments/:id/sync

**Purpose:** explicitly refresh a known intent and recover a missed webhook or retrieve timeout. **Headers:** standard JSON/request ID. **Body:** exactly `{}`; no provider ID, amount, target status or arbitrary payload accepted. **Validation:** UUID, existing linked payment, retry timing/lease rules.

**Response:** 200 `PaymentDetails` after commit, including same-state observations. Financial status changes and audit commit atomically. This endpoint never creates an intent or automatically reconfirms one.

```http
POST /api/v1/payments/9d576a31-e423-4422-9a4c-c1346ad6534e/sync
Content-Type: application/json

{}
```

Response: 200 with the details example. **Errors:** 400 validation, 404 missing payment, 409 `PROVIDER_NOT_INITIALIZED` / busy / permanent review, 502 blocked configuration, 503 retrieve/database failure. **Idempotency:** repeating sync converges the projection and cannot duplicate a financial transition. Unlinked unknown creation is recovered through confirmation-session or a verified correlated webhook, not this endpoint.

## POST /api/v1/webhooks/stripe

**Purpose:** process Stripe snapshot intent events. **Headers:** `Stripe-Signature` required; JSON content type; exact raw bytes are the verifier input. No application key, browser Origin or simulation token required. **Body:** SDK-verified Stripe event envelope, not a custom payment DTO. Verify timestamp tolerance, test mode and account/environment context before recording it. There are no query parameters.

**Response:** 200 `{"received":true}` only after a durable `PROCESSED`, `IGNORED`, or explicit `REVIEW_REQUIRED` disposition. A duplicate previously disposed event returns the same body after delivery-count commit. An actionable event cannot receive success after receipt insertion alone. **Errors:** 400 `INVALID_WEBHOOK`, 413 body too large, 503 unfinished/busy/transient processing. Do not return 409 for a busy webhook. Never mark an event processed if its business transaction rolled back.

```http
POST /api/v1/webhooks/stripe
Content-Type: application/json
Stripe-Signature: t=EXAMPLE,v1=EXAMPLE

{"id":"evt_example","object":"event","livemode":false,"type":"payment_intent.succeeded","data":{"object":{"id":"pi_example"}}}
```

This abbreviated envelope/signature is illustrative and cannot pass verification. Stage 3 tests generate complete version-compatible fixtures and valid SDK/fake signatures; this abbreviated example is not a fixture. **Deduplication:** unique event ID, independently of payment API keys; separate event IDs are still checked against current provider state. See [the complete processing algorithm](idempotency-and-webhooks.md).

## Development-Only Simulation Contracts

These routes share `/api/v1/dev/simulations`. They are registered only when `NODE_ENV` is development/test and `SIMULATION_ENABLED=true`. Backend requests require `Authorization: Bearer <server-only SIMULATION_TOKEN>`. The allowlisted Next.js development proxy adds this header after validating the local browser Host/Origin. Production returns 404, even with a valid token; wrong/missing token when enabled returns 403. Never accept a caller-supplied webhook URL, signing secret, raw event, target status, or Stripe live object.

The fake provider operates only on a separate local/test database and emits complete, signed synthetic events. The Stripe provider uses real test-mode objects. Both pass the normal verifier, lease and state machine. Simulation endpoints are orchestration, not a second payment API.

### POST /api/v1/dev/simulations/request-race

**Purpose:** demonstrate duplicate and concurrent local creation. **Headers:** development bearer and JSON. **Body:** `{scenario:"duplicate_request"|"concurrent_requests", amount, currency}` with shared money rules. The server generates a fresh application key for each run; duplicate mode sends two sequential HTTP requests, concurrent mode sends ten simultaneous requests through the real creation HTTP endpoint at a fixed local origin. No Stripe calls.

**Response:** 200 `{runId, scenario, idempotencyKey, paymentIds, responseStatuses, uniquePaymentCount, creationEventCount}`. `paymentIds`/`responseStatuses` list every request result; counts come from PostgreSQL. Expected counts are both 1. Returning a report does not imply its assertions passed; display unexpected counts as failures. **Errors:** 400 validation; shared 403/404 guard; 503 if orchestration cannot complete. Retrying this endpoint starts a new explicitly labeled demonstration run and is not idempotent; it never causes provider charges.

```json
{"scenario":"duplicate_request","amount":2500,"currency":"USD"}
```

```json
{"runId":"6bd50024-1e04-4405-93d6-e20ec57ec594","scenario":"duplicate_request","idempotencyKey":"37718d8d-075e-493d-a419-c060381959ef","paymentIds":["9d576a31-e423-4422-9a4c-c1346ad6534e","9d576a31-e423-4422-9a4c-c1346ad6534e"],"responseStatuses":[201,201],"uniquePaymentCount":1,"creationEventCount":1}
```

Concurrent reports contain all ten observations. The example above is the two-request sequential duplicate scenario.

### POST /api/v1/dev/simulations/payments/:id/fault

**Purpose:** arm a one-shot failure for one selected local payment. **Headers:** development bearer and JSON. **Body:** `{point:"webhook_before_commit"|"provider_response_timeout"}`. Validate UUID/payment, no other fields. No fault may be applied globally or to an arbitrary provider operation.

**Response:** 200 `{paymentId, point, remaining:1, expiresAt}`. `webhook_before_commit` throws immediately before T4 business commit so both status/audit and receipt completion roll back. `provider_response_timeout` discards the next successful create/retrieve response after the provider call, exercising an ambiguous outcome without modifying Stripe. Both expire after 60 seconds and are consumed once in memory; process restart clears them. Reject a second different active fault with 409; repeating the same active arm returns its existing expiry and does not stack faults.

```json
{"point":"webhook_before_commit"}
```

```json
{"paymentId":"9d576a31-e423-4422-9a4c-c1346ad6534e","point":"webhook_before_commit","remaining":1,"expiresAt":"2026-11-19T15:02:00.000Z"}
```

**Errors:** 400 input, 404 payment, 409 active conflicting fault. Recover with signed redelivery and/or the existing session/sync endpoints; there is no endpoint to write a payment status.

### POST /api/v1/dev/simulations/webhooks/:eventId/replay

**Purpose:** deliver an already observed event twice through the actual webhook endpoint. **Headers:** development bearer and JSON. **Body:** exactly `{"deliveries":2}`. Validate an event ID matching `evt_` plus 1–200 ASCII alphanumeric/underscore characters, a stored verified receipt, and association with this environment's local payment.

In Stripe mode, retrieve that original event through the test SDK, validate test mode/identity/metadata and the stored immutable envelope, serialize it, and generate fresh SDK test-signature headers with the configured test endpoint secret. In fake mode, use the previously generated immutable fixture and the separate test secret. Post both deliveries to the fixed internal webhook URL. Signature verification is always executed. Never re-sign arbitrary caller JSON, change event contents or retrieve caller-selected unrelated provider objects.

**Response:** 200 `{eventId, deliveryStatuses:[number,number], storedDeliveryCount, processingStatus, financialTransitionCount}`. The transition count is the number of status-versioned audit entries linked to this event and can legitimately be zero; it must not increase on duplicate processing. **Errors:** 400 input; 404 unknown/foreign event; 409 unavailable original event or review disposition; 503 provider retrieval/orchestration failure. The route intentionally repeats deliveries on each call; business effects remain idempotent.

```json
{"eventId":"evt_example","deliveryStatuses":[200,200],"storedDeliveryCount":3,"processingStatus":"PROCESSED","financialTransitionCount":1}
```

For a rollback demonstration, arm the fault before a new event is first processed. If an already processed event is replayed, deduplication bypasses business processing and the fault will not fire. For Stripe mode, complete a new test payment; for deterministic E2E, the fake confirmation action creates a fresh signed event. Show the first 503 and later successful replay/recovery as separate outcomes.

### POST /api/v1/dev/simulations/payments/:id/confirm

**Purpose:** deterministic browser confirmation for the fake provider only. **Headers:** development bearer and JSON. **Body:** exactly `{scenario:"success"|"decline"}`. Validate the local UUID, linked fake intent and the development guards. Permit a confirmable state, or an identical success observation after synthetic success; reject cancellation or an attempted decline after success with 409. Return 404 in Stripe mode even if other simulation routes are enabled. No caller-supplied target status, payment method details or provider ID is accepted.

Under the fake provider's internal per-intent serialization, apply the fixed fixture outcome to that synthetic intent: success produces `succeeded`; decline produces `requires_payment_method` with a normalized test decline error. A prior synthetic success/cancellation cannot be regressed. The fake creates an immutable event fixture with a new event ID and posts it with a valid test signature to the fixed webhook URL. Local Payment state changes only through normal verified synchronization. If a matching Payment lease is busy, return 409 before starting another fake confirmation.

**Response:** 200 `{paymentId, eventId, deliveryStatus}`. A `deliveryStatus` of 503 reports an intentionally failed webhook processing attempt; the confirmation operation itself may already have succeeded at the fake provider. Recover by replay or sync rather than reconfirming. Repeated calls re-observe a terminal fake success and may deliver another signed observation, but cannot generate a second charge or regress it; a retry after decline may advance to success on the same synthetic intent.

```http
POST /api/v1/dev/simulations/payments/9d576a31-e423-4422-9a4c-c1346ad6534e/confirm
Content-Type: application/json
Authorization: Bearer REDACTED

{"scenario":"success"}
```

```json
{"paymentId":"9d576a31-e423-4422-9a4c-c1346ad6534e","eventId":"evt_fake_example","deliveryStatus":200}
```

**Errors:** 400 invalid input, 404 unavailable mode/payment, 409 busy/not-confirmable, shared 403 guard and 503 orchestration failure. This fixture-only route cannot operate on any real Stripe object. Fake state is process-local and intentionally not durable; deterministic restart tests reseed the external fake to represent Stripe's surviving state, while local receipts/payments remain in PostgreSQL.

## Health Endpoints

| Method / path | Headers/body | Validation | Success | Failure / idempotency |
| --- | --- | --- | --- | --- |
| `GET /api/v1/health/live` | Optional request ID; no body/query | Reject unknown query | 200 `{"status":"ok"}` | Process liveness only; read-only |
| `GET /api/v1/health/ready` | Optional request ID; no body/query | Reject unknown query | 200 `{"status":"ready","database":"up"}` | 503 `{"status":"not_ready","database":"down"}`; bounded DB probe, read-only |

Health responses intentionally use these small schemas rather than the payment error envelope and disclose no secret values. OpenAPI documentation will be generated at `/api/docs` in local development from DTOs and explicit examples; it is not an additional business endpoint. Add integration tests that assert status, headers, error schemas, raw-body handling, and replay behavior against this contract.
