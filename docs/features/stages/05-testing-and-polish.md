# Stage 5 — Testing and Polish

## Objective

Complete the reliability regression suite, secure reproducible CI/container workflows, and an evidence-based portfolio demonstration. This stage has not started.

## Prerequisites

[Stage 4](04-payment-simulator.md) is verified. Unit/integration tests from Stages 1–3 and initial Playwright tests from Stage 4 already exist and pass. Review the [architecture index](../../architecture/README.md), [transaction/constraint design](../../architecture/database-design.md), [failure algorithms](../../architecture/idempotency-and-webhooks.md), [security/runtime boundary](../../architecture/system-overview.md), and [API contracts](../../architecture/api-design.md).

Review [AGENTS.md](../../../AGENTS.md) and the [design reference](../../design/DESIGN.md) with its [JSON tokens](../../design/tokens.json), [CSS variables](../../design/variables.css) and [Tailwind theme](../../design/theme.css) before the final UI verification. Include Stage 4's documented adaptations in that comparison.

Review the [project structure and dependency boundaries](../../architecture/project-structure.md), including category-folder growth, provider DI isolation, component entry points and frontend query/mutation behavior.

## Scope

Extend existing tests to the full scenario matrix, verify recovery across process restarts and lease takeover, review security, add GitHub Actions, harden the existing API Docker setup, add the web runtime image, verify full-stack Compose workflows and finalize public documentation. The backend/database development containers already exist from Stage 1. Do not defer earlier foundational tests into this stage or repeat already proven coverage without a new integration risk.

## Technical Requirements

Use Jest/Supertest with PostgreSQL for consistency checks and Playwright with the deterministic fake for credential-free E2E. Isolate databases/schemas per parallel test worker or serialize suites sharing state. Assert row counts, immutable IDs and status-version audit invariants, not just HTTP status or screenshots. Use provider fakes for concurrency/load tests, never Stripe's sandbox.

CI must install from the lockfile, apply real migrations to an isolated PostgreSQL service, run lint/type/build and deterministic tests, and retain useful redacted failure artifacts. Give workflow jobs minimal permissions (`contents: read` unless a concrete job requires more), pin third-party actions to reviewed full commit SHAs, and prevent untrusted pull requests from accessing secrets or running privileged publishing. Do not use `pull_request_target` to execute untrusted checked-out code. No deployment/publishing job is required.

Use pinned Node/PostgreSQL image versions, multi-stage API/web Docker builds, non-root runtime users, no build-time secrets or unnecessary development dependencies in runtime images, and explicit health checks. Complete Compose services for API/web/database while preserving loopback host bindings. Local secrets are runtime environment inputs and excluded from images/build context. Document data volume reset as destructive, opt-in maintenance, not a routine test cleanup step.

## Recommended Codex Skills

All aids are optional. Follow the [skills policy](../ROADMAP.md#codex-skills-policy) and a future existing catalog for installation instructions; do not assume any are installed.

| Skill | Purpose and relevance | Priority |
| --- | --- | --- |
| `playwright-cli` | Exercise full dashboard scenarios and inspect meaningful browser failures | Recommended |
| `github-actions-hardening` | Review job permissions, action pinning and untrusted-PR boundaries | Recommended |
| `docker-build-strategies` | Review reproducible multi-stage builds and minimal runtime images | Recommended |
| `web-design-guidelines` | Final accessibility, focus and interaction review | Optional |
| `docker-compose-patterns` | Verify full-stack health/startup/network/volume behavior | Optional |

The baseline needs no Redis, BullMQ, AWS or specialized cache skill. If an earlier feature justifiably introduced Redis, include that feature's connection/failure checks in final verification; do not add Redis solely for this stage.

## Implementation Tasks

- [ ] Build a traceable regression matrix from each invariant and API contract to existing/new tests.
- [ ] Review source/import boundaries, per-category backend folders, provider-token test overrides and frontend component entry points; verify shadcn updates do not leave duplicate flat primitives.
- [ ] Verify API-hook retries, polling/invalidation, stale creation replay handling and exclusion of client secrets from query/mutation caches.
- [ ] Extend PostgreSQL races to mixed same-key payloads, independent keys and multiple API processes sharing the database.
- [ ] Test lease takeover and stale-owner apply/release rejection with a deliberately delayed provider response.
- [ ] Test API restart after local commit, receipt commit, provider request acceptance and final business commit.
- [ ] Verify rollback at each multi-write boundary leaves no orphan/partial business effect.
- [ ] Complete Playwright success, decline/retry, history, request-race, duplicate webhook, transient failure and recovery flows.
- [ ] Verify the main screens against the supplied design/tokens at narrow and wide widths, including focus, contrast and readable status/error presentation.
- [ ] Add cutoff/budget tests using controlled time without long sleeps or real Stripe load.
- [ ] Review test/live mode validation, raw signatures, proxy allowlists, request limits, production route removal and secret redaction.
- [ ] Verify impossible terminal observations and unresolved correlation end in visible review dispositions rather than silent success.
- [ ] Add minimal-permission, SHA-pinned GitHub Actions checks with PostgreSQL and no Stripe secrets.
- [ ] Extend/review the existing API Dockerfile with a hardened runtime target and add the web runtime Dockerfile; verify multi-stage builds, ignored contexts, non-root users and no secrets in images.
- [ ] Extend and verify Compose startup, readiness, persistence, shutdown and application/database restart recovery.
- [ ] Run documented setup and checks from a clean checkout and empty test database, recording actual results/limitations.
- [ ] Run opt-in real Stripe test-mode success/decline/webhook smoke checks separately and record their date and outcome. This includes the [Stage 3 follow-up](03-stripe-integration.md#deferred-provider-verification), explicitly deferred by the developer on 2026-11-19 until credentials are available; it remains required before declaring the full provider demonstration or MVP fully verified.
- [ ] Update README with verified commands, exact versions, actual feature status and honest screenshots only if captured.
- [ ] Add the portfolio demonstration and operator recovery steps to existing docs; avoid creating extra placeholder documents.
- [ ] Resolve all blocking failures and mark stages complete only after their acceptance evidence exists.

## Expected Files and Modules

Planned artifacts: expanded API unit/integration suites, Playwright E2E suites/fixtures, `.github/workflows/ci.yml`, hardened runtime targets in the existing API Dockerfile, a web Dockerfile, reviewed `.dockerignore` files and completed `infra/compose.yaml` including `web`. Update README and existing architecture/stage documents rather than adding an unrelated documentation hierarchy. No new business module/table is expected.

## API / Database Changes

No new functional API, table or financial state is planned. Correct contract discrepancies discovered by tests in their owning modules and update affected documentation. Verify migration-from-empty, FK restrictions, unique application/provider/event IDs and SQL checks against PostgreSQL. Do not weaken signature checks or terminal-state guards to make tests pass.

## Testing Requirements

| Scenario | Required evidence and primary layer |
| --- | --- |
| Successful payment | E2E form/session/confirmation, committed `SUCCEEDED`, one financial success transition; separate Stripe smoke |
| Failed payment | E2E decline shows retryable `FAILED`; method retry succeeds on the same IDs |
| Duplicate create | Same key returns same 201 snapshot/Location, one Payment/key/creation event; API + E2E |
| Concurrent same-key create | Ten simultaneous HTTP requests, same result IDs/body, one durable creation; PostgreSQL integration + UI report |
| Key/payload conflict | Concurrent different payload has one winner and conflicts; no extra rows; unit/integration |
| Duplicate webhook | Repeated and concurrent same event IDs plus distinct semantic duplicates; delivery counts rise, financial event count does not |
| Transient failure | Signed new event faults before T4 commit; non-2xx, no partial state/audit/completion; integration + E2E |
| Recovery | Later signed delivery/sync converges on same intent and one committed transition; integration + E2E |
| Unknown create | Provider accepted but response lost; repeated stable provider key gives same object; fake integration |
| Terminal delayed event | Late failure cannot regress success/cancellation; current retrieve and terminal guard; integration |
| Restart/lease takeover | Receipt/key survives process restart; stale owner cannot apply or release after replacement; integration |
| Retry cutoff | Six-create budget and 23-hour boundary stop unlinked create; known-ID reads remain available; unit/integration |
| Security | Missing/tampered/stale signatures, live keys/objects, fake production mode, denied simulation/proxy access and sanitized outputs |

For deterministic E2E, let the real application serve requests and use the fake only at the external provider boundary. Fake events must be signed and traverse HTTP verification. Stripe smoke tests are opt-in and serial, use only test credentials/methods, and are excluded from ordinary PR CI. CI must pass with no Stripe environment values. A skipped real-provider smoke must be reported as skipped, not passed.

## Acceptance Criteria

- [ ] Required unit, PostgreSQL/API and deterministic Playwright suites pass from clean state without provider credentials or Stripe networking.
- [ ] Every required demonstration scenario has observable UI output and database/provider-identity assertions.
- [ ] Restart, rollback, unknown-outcome, out-of-order and fencing tests establish the documented recovery behavior.
- [ ] CI repeats the documented checks with minimal permissions, pinned actions and isolated PostgreSQL.
- [ ] Docker builds and full Compose health/start/stop/restart workflows are verified with loopback publishing and no embedded secrets.
- [ ] Production/fake/live-key guard tests and secret-redaction review pass.
- [ ] Actual Stripe test-mode success and decline smoke checks are recorded separately before claiming the full provider demonstration ready.
- [ ] Public README has only verified commands, accurate implementation status, working navigation and real captured artifacts if any.
- [ ] Final visual verification follows the supplied design references and records justified application-specific adaptations without altering the source exports.
- [ ] Source structure and DI/import boundaries match the documented conventions, and browser API hooks preserve payment/idempotency/security semantics.
- [ ] No known blocking reliability/security/contract defect remains; future enhancements remain outside the MVP.

## Definition of Done

All required functionality is implemented; all five stages' acceptance criteria are verified; required tests/builds/security/Docker checks pass; relevant documentation is current; no known blocking issues remain. Record actual results and any skipped optional checks. Mark the MVP implementation complete only when the required Stripe smoke evidence also exists; documentation-only completion never checks off these stages.

## Out of Scope

Real payments, production deployment, complex authentication, refunds, subscriptions, a reconciliation engine, queues/workers, speculative Redis adoption, multiple providers, AWS and Kubernetes. Any Redis already introduced for a documented feature is verified, not expanded into a new capability here. Future capabilities must not become hidden prerequisites for this stage.

## Dependencies

Depends on all four preceding verified stages. Completes the [five-stage roadmap](../ROADMAP.md) without adding a sixth implementation stage. Optional skills remain developer-controlled aids.


## Deferred Real Provider Browser Verification

On 2026-11-19 the developer explicitly approved moving Stage 4’s manual hosted Payment Element verification to this stage because local Stripe test credentials are unavailable. Stage 4’s deterministic browser/API/PostgreSQL acceptance is verified; no real Stripe behavior is claimed passed. This adds to the existing Stage 3 provider-smoke follow-up and does not start Stage 5 implementation.

- [ ] Configure the real Stripe test environment and authentic snapshot webhook forwarding documented in Stage 3.
- [ ] In the actual Payment Element, confirm a test success and a declined attempt followed by success on the same intent; inspect the synchronized local status/history.
- [ ] Verify hosted authentication/return navigation, clean detail redirects, HttpOnly local-ID correlation, no URL logging/referrer leakage, and actual Stripe redirect query handling. The application does not add a client secret to its return URL, but Stripe-controlled redirects may append provider parameters; inspect the complete real flow before claiming the strict URL secrecy requirement verified.
- [ ] Verify test-mode styles/focus inside the hosted iframe and confirm that success/cancellation never reopen confirmation.
- [ ] Record dated results separately from the credential-free Playwright suite; run the Stage 3 opt-in provider smoke as well.
