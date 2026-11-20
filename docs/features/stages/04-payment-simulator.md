# Stage 4 — Payment Simulator

## Objective

Build a compact dashboard that makes test payment outcomes, duplicate prevention and recovery easy to demonstrate. Implemented and deterministically verified on 2026-11-19. The developer explicitly deferred manual real Stripe Payment Element verification to Stage 5 because test credentials are unavailable; this does not claim actual Stripe behavior is verified.

## Prerequisites

[Stage 3](03-stripe-integration.md) APIs, provider fake and PostgreSQL tests are verified. Read [system boundaries and development guards](../../architecture/system-overview.md), [API/UI contracts](../../architecture/api-design.md), [lifecycle meanings](../../architecture/payment-lifecycle.md) and [failure sequences](../../architecture/idempotency-and-webhooks.md).

Read [AGENTS.md](../../../AGENTS.md), [DESIGN.md](../../design/DESIGN.md), [tokens.json](../../design/tokens.json), [variables.css](../../design/variables.css) and [theme.css](../../design/theme.css) before UI work. These supplied references define the visual baseline; preserve any token integration already established in Stage 1.

Read the [frontend structure and API-hook policy](../../architecture/project-structure.md#frontend-layout), including component entry points, private/shared hook placement and the boundary between `src/api` and Next.js route handlers in `src/app/api`.

## Scope

Implement the payment list, creation form, details, event history, Payment Element confirmation, and guarded scenario controls. Add initial Playwright browser coverage. The visual design should be a professional, simple table/form/details interface using shadcn/ui; workflow clarity takes priority over decorative motion or a large component library.

## Technical Requirements

Use `apps/web/src/app` for App Router layouts/pages, Tailwind and shadcn/ui. Use server components for static layout and small client components for forms, polling and scenario controls. Browser requests use a typed Axios client in `src/api` and TanStack Query hooks in `src/api/hooks/<module>`; local UI state stays in component/domain hooks. Do not add another global state/server-state framework, persistent query cache or Next.js Cache Components.

Place page components under `src/app/<page>/components`, reusable primitives/layouts/shared components under their respective `src/components` categories, and give each component a folder with `index.tsx`. Colocate private hooks and `types.ts` only when needed. Preserve Next.js special filenames. Configure shadcn aliases and normalize generated primitives into their folder entry points, checking update diffs for duplicate flat files.

Reuse the shell's existing shadcn Button/Badge and add other primitives only as the workflows need them. Use Tailwind utilities in JSX and component variants for styling; keep global CSS limited to imports, theme tokens and base styles, without page/layout selectors such as `.shell-footer`. The [styling convention](../../architecture/project-structure.md#styling-conventions) applies to every dashboard screen.

Map the provided indigo/navy light theme, typography, spacing, component radii and surfaces into application and shadcn/ui semantic tokens. Follow explicit component definitions over inconsistent generic examples: buttons/inputs/cards use 4px radii, while tags may be pills. Adapt marketing-page spacing to readable dashboard tables/forms, use the documented font fallback when assets are unavailable, and record any necessary accessibility/density adjustments. Do not rewrite the supplied exports or replace their direction with a skill's default aesthetic.

The form accepts an exact decimal string and converts it to integer minor units by validated string parsing, with at most two fractional digits. Format money through integer/string quotient/remainder operations. Never use `parseFloat`, floating-point multiplication/rounding, or accept raw card fields in an application form. Support only the contract's USD/EUR/range constraints.

Generate a UUID key for each intentional payment; hold key/body through timeout and duplicate clicks until a definitive response. The immutable 201 representation is an acknowledgement, not current financial state. Fetch details after creation/replay. Use the confirmation session with Stripe.js/Payment Element, retaining the secret only in component memory. A browser success message is provisional until synchronized details agree. Display `FAILED` as “attempt declined; retry possible,” preserving the same intent for a new test method.

Use a fixed-origin, allowlisted Next.js API proxy with no response caching. Add server-only development proxy handlers that verify exact local Host/Origin and inject the simulation token. Reject arbitrary target URLs/paths/methods. Backend guards remain mandatory even when the UI hides its controls.

In fake mode, render a clearly labeled fixed success/decline confirmation control instead of mounting real Stripe Elements. It invokes only the fake-only confirmation contract, which generates signed fixtures through the normal webhook endpoint. Never load fake secrets into Stripe.js or make real Stripe calls in deterministic Playwright tests. Stripe mode exposes no synthetic outcome setter.

## Recommended Codex Skills

All are optional aids. Follow the [skills policy](../ROADMAP.md#codex-skills-policy) and any later existing catalog's installation instructions; no skill is assumed installed.

| Skill | Purpose and relevance | Priority |
| --- | --- | --- |
| `shadcn` | Build consistent form, table, alert, badge and dialog primitives | Recommended |
| `frontend-design` | Review dashboard hierarchy and clear financial/operational feedback | Recommended |
| `vercel-react-best-practices` | Review App Router boundaries, client state and rendering behavior | Recommended |
| `vercel-composition-patterns` | Review reusable payment detail/scenario components if duplication warrants it | Optional |
| `web-design-guidelines` | Check labels, keyboard navigation, focus and responsive usability | Optional |
| `modern-web-guidance` | Review browser behavior and accessible interaction patterns | Optional |

Do not recommend the retired generic Next.js skill or specialized Cache Components workflows for this application.

## Implementation Tasks

- [x] Create the dashboard shell with a persistent test-mode/fake-mode indicator and navigation between list and details.
- [x] Pin compatible Axios/TanStack Query versions; add the typed browser client, domain request functions and client QueryProvider with explicit retry/refetch settings.
- [x] Group payment/scenario query and mutation hooks under `src/api/hooks/<module>`; invalidate/refetch affected projections without optimistic financial-state updates.
- [x] Apply component folder/`index.tsx` conventions, page-local components/hooks and shadcn aliases; keep global types/utilities/hooks limited to actual shared scope.
- [x] Apply the supplied design tokens to the shell and shadcn/ui primitives; document semantic mappings and resolved export discrepancies before building the remaining screens.
- [x] Build the creation form with exact-money validation, currency select, accessible errors and retained logical-request key.
- [x] Build the paginated payment list with status filter, loading/empty/error states and details navigation.
- [x] Build details with local/provider status, operational error/retry timing, provider ID and creation/update/sync times.
- [x] Build a newest-first audit timeline with safe error codes and webhook correlations; never expose raw provider payloads.
- [x] Implement confirmation-session fetching, Stripe Payment Element mounting/confirmation and retry after decline on the existing intent.
- [x] Keep confirmation-session results out of QueryCache/MutationCache by invoking the typed request from a payment-local hook and retaining the secret only in component-local memory.
- [x] Handle configured return navigation by fetching/synchronizing details, without trusting URL query claims of success.
- [x] Add bounded local polling and explicit synchronize/recover actions; avoid automatic card confirmation retries.
- [x] Implement normal API proxy allowlists, no-store handling and separate guarded server-only simulation forwarding.
- [x] Add the conditional Simulation module and HTTP scenario contracts; verify they are unregistered in production.
- [x] Implement sequential duplicate and ten-request race demonstrations through the actual payment HTTP route and database counts.
- [x] Add scoped one-shot rollback/response-timeout faults with 60-second expiry and immutable signed-event replay.
- [x] Add fake-only fixed confirmation scenarios that use the same signature verifier and transaction path.
- [x] Show run observations, response statuses, unique payment/event counts and recovery results as evidence, including failed assertions.
- [x] Add initial deterministic Playwright flows and guard/signature integration tests.
- [x] Verify keyboard/focus/error announcement behavior and narrow/wide layouts; update demo instructions with real steps.

## Expected Files and Modules

Planned web artifacts: `apps/web/src/app/` routes and allowlisted proxy handlers; page-local component folders with `index.tsx`; `src/components/ui`, `layouts` and `shared`; `src/api/client.ts`, query configuration, domain request functions/types and `src/api/hooks/payments` / `simulation`; exact-money helpers; Playwright fixtures/configuration. Use `src/types`, `utils` and `hooks` only for genuinely shared artifacts. Planned API artifacts: `apps/api/src/modules/simulation/` guarded controller/orchestrator/fault registry and fake-only confirmation helper. Reuse Payments and Webhooks; do not duplicate status mutation logic.

## API / Database Changes

Consume the existing payment/session/sync/event endpoints. Add the four development endpoints defined in [API design](../../architecture/api-design.md#development-only-simulation-contracts): request-race, arm fault, replay webhook and fake confirmation. No new domain table or production payment endpoint is needed. Faults are scoped ephemeral development state; audit/receipts still use PostgreSQL.

## Testing Requirements

Playwright with a real API and PostgreSQL plus fake provider: exact amount validation; create/list/detail/history; key retention after lost response; fixed success and decline/retry confirmation; duplicate/concurrent reports; transient webhook rollback and recovery; provider-response loss followed by same-intent recovery. Sign fixtures normally; do not intercept requests with invented success responses for these browser flows.

API tests must prove production 404, disabled-mode 404, token rejection, foreign Origin rejection at the frontend proxy, no token/client-secret leakage, immutable replay validation and fake-confirmation rejection in Stripe mode. Unit-test decimal string conversions/boundaries where they prevent monetary errors. Manually check Payment Element in real Stripe test mode separately; hosted iframe behavior is not faked into the deterministic suite.

Inspect the rendered list, form, details, timeline and scenario controls at narrow and wide widths against `docs/design/`. Verify token consistency, readable amounts, focus states and status/error labels that do not rely on color alone. Record actual captures/results only when the UI exists and can run.

Verify API-hook retry/polling limits, retained idempotency keys after a lost response, query invalidation after mutations and a creation replay after the payment has already succeeded. Confirm that displayed status comes from current details and that neither query nor mutation caches contain confirmation-session secrets. Build/type checks must resolve component entry-point imports after shadcn file normalization.

## Acceptance Criteria

- [x] A developer can create, find and inspect a payment and its audit timeline without raw database queries.
- [x] Monetary input/formatting preserves exact integer values; invalid precision and bounds are explained accessibly.
- [x] A decline is visibly retryable and can later succeed on the same payment/intent; terminal states cannot reopen confirmation.
- [x] Duplicate/concurrent scenario reports prove one local payment and one creation event.
- [x] A duplicate signed event creates no second financial transition; a new event's injected rollback returns failure and later recovers.
- [x] A response timeout is shown as uncertainty/operational failure and recovers by observing the same provider object.
- [x] The browser receives neither simulation token nor raw card fields/client secrets in logs, URLs or persistent storage.
- [x] Production/disabled simulation routes are absent and fake confirmation is unavailable in Stripe mode.
- [x] Initial browser/API checks pass; keyboard navigation and responsive details are verified.
- [x] Dashboard styling follows the supplied design references and named tokens, with any accessibility/density adaptations documented and visually verified.
- [x] Source folders, component entry points, API-hook grouping and DI-backed simulation paths follow the structure contract; no credentials enter client query caches.

## Definition of Done

All required UI and scenario functionality is implemented, acceptance criteria are verified, required browser/API/unit checks pass, workflow/demo documentation is updated, and no known blocking issues remain. A rendered dashboard alone does not complete the stage.

## Out of Scope

Authentication systems, multi-tenancy, advanced charting, a general design system, arbitrary provider mutations, production fault injection, screenshot fabrication, and comprehensive CI/container hardening owned by Stage 5.

## Dependencies

Depends on Stage 3's complete provider and webhook contracts. Supplies a demonstrable application and initial Playwright suite for [Stage 5](05-testing-and-polish.md). Optional skill installation is never required.



## Verification Evidence — 2026-11-19

Stage 4 implementation and deterministic acceptance are complete. The developer explicitly approved moving the real hosted Payment Element check to Stage 5 on 2026-11-19. The [Stage 5 follow-up](05-testing-and-polish.md#deferred-real-provider-browser-verification) tracks this together with Stage 3’s still-unverified real Stripe smoke. No optional Codex skill was installed, synchronized or enabled; the existing reference exports remain unchanged.

| Check | Actual result |
| --- | --- |
| Backend unit/API tests (`npm test`) | 159 passed across 7 suites, including production/disabled route absence and scoped fault expiry |
| PostgreSQL integration (`npm run test:integration`) | 69 passed across 5 suites using real PostgreSQL 17.9 on the isolated `_test` database |
| Browser/money/query-policy checks (`npm run test:e2e`) | 9 passed, serial Chromium with real API/PostgreSQL and signed fake fixtures |
| Typecheck / ESLint / formatting | Passed with normalized component entry-point imports |
| API build / web production build | Passed; web used the documented `--webpack` fallback after this environment rejected a Turbopack worker socket |
| Production and disabled Next.js proxy HTTP checks | All four development routes returned 404/no-store; scenario controls were absent |
| Visual review | Actual ledger/form/details/history/scenario captures at 1440 and 390 px; no page-level horizontal overflow, long IDs wrap, the ledger remains locally scrollable |
| Keyboard/accessibility | Invalid exact money focuses its input, `aria-invalid` and described errors agree; Tab reaches currency, visible focus is retained, arrow keys scroll the named table region |
| Local Compose runtime | API and PostgreSQL healthy after rebuild; existing legacy development data preserved in its original database and the application uses a separate `simulator_fake` database |
| Real Stripe / hosted Payment Element | **SKIPPED / DEFERRED** by explicit developer approval; no credentials available, no actual Stripe behavior claimed verified |

Browser coverage verifies exact 27.31 EUR creation; current details and newest-first history; fake decline then success on the same intent; a real committed create response discarded at the transport boundary followed by same-key/body replay **after that payment has already succeeded**; two sequential/ten concurrent request reports; a new signed event returning 503 on injected rollback then two successful signed replay deliveries with one transition; provider response loss followed by same-operation recovery; exact foreign Host/Origin rejection; query/mutation cache inspection excluding session secrets; no credential persistence or real Stripe requests; untrusted return outcome claims ignored; and status-preserving list pagination.

The PostgreSQL scenario tests assert one payment/creation event, unchanged financial state and no transition after rollback, unfinished receipt recovery, provider object identity after response loss, immutable replay rejection, exact signature verification, active-lease exclusion and fake-confirmation rejection in Stripe mode. Existing tests also verify raw bytes, live/foreign event rejection, state machine/fencing/cutoff and audit atomicity. The restart fixture now clears its guarded test data before running, so an earlier E2E run does not change its counts. Do not run the two PostgreSQL suites concurrently or regenerate Prisma while another check builds the API.

Captured files are generated by `apps/web/test/dashboard.spec.ts` under the ignored `apps/web/test-results/` directory (`ledger-1440.png`, `ledger-390.png`, `details-1440.png`, `details-390.png`). These are actual runtime screenshots, not fabricated references. Playwright traces are off to avoid recording confirmation-session response secrets. The mechanical design detector returned an empty finding list; the rendered comparison also checked the supplied visual rules directly.

## Application Mapping and Accessibility Adaptations

The Stage 1 semantic mapping is preserved: white canvas/card, navy foreground, indigo actions/focus, deep-violet filled-action hover, steel muted text, slate input boundaries, frost dividers and periwinkle status tags. Named 4px button/input/card radii take precedence over the reconstructed pill-button example; only tags use pills. No shadows, extra status palette or font download was added. Body/control text uses the supplied fallback stack at weight 400 for operational readability; light headings retain the reference direction.

Dashboard groups use the supplied 24/32/40/48px roles instead of 96px marketing gaps. The detail grid stacks at narrow widths; IDs and webhook correlations wrap. Tables retain columns and exact tabular amounts inside an explicitly named, keyboard-focusable horizontal scroll region. Inputs and ordinary actions have 48px targets, compact pagination/refresh actions retain visible focus, and all financial states have text and line icons. Errors are linked to inputs and announced after interaction, with focus moved after a failed submit. Skeleton motion respects reduced motion. Stripe Appearance reads the same computed semantic tokens rather than defining another palette.

## Implemented Boundaries and Demo

See the [README demo](../../../README.md#stage-4-dashboard-demo) for real steps and commands. Server-only web environment values must match API mode/token; clean `setup:env` generates them together and preserves existing ignored files. Normal proxy methods/paths/query fields are allowlisted with no-store; POST requires the exact local Origin and Host. Development forwarding is separate and injects the bearer only on the server. Normal operation fixes the local API port at 3001; the explicit server-only E2E flag reserves 3102.

`SimulationModule.register()` registers no controllers/instrumentation in production or disabled mode; its guard independently rechecks validated configuration and timing-safe bearer equality. Payments consumes an optional neutral instrumentation token through DI; it does not depend on the Simulation feature or import a concrete provider. The global feature binding avoids a circular import. The orchestrator sends real HTTP requests to its configured loopback API, reads PostgreSQL counts, and signs only provider-owned immutable test fixtures after matching the receipt and local payment. It never accepts arbitrary target URLs/raw events/secrets/statuses. The fake confirmation is a fixed provider capability absent from Stripe, shares the payment lease, and releases before the signed webhook HTTP request. Local financial updates still go exclusively through the normal synchronization transaction.

The response-timeout fault discards a successful create/retrieve result before linkage/apply. The rollback fault throws inside T4 after its writes and before commit, so financial status/audit/receipt completion all roll back together. Both are one-shot, payment-scoped, expire in 60 seconds and do not persist across restart. Session results bypass TanStack caches; every other affected projection is invalidated/refetched with no optimistic financial changes, no automatic POST retries, and bounded two-second/60-second detail polling. Fake fixtures/objects remain process-local as documented in Stage 3.

For real provider return handling, only a local UUID enters a short-lived HttpOnly/SameSite cookie; outcome query claims are ignored. `/payments/return` clears that cookie and redirects to clean details for sync, with no-store/no-referrer and incoming URL logging disabled. The application never puts a client secret in its configured return URL. Stripe-controlled redirects may add provider query parameters; verifying that real hosted flow and its strict URL-secrecy behavior remains part of the explicitly deferred check, not a claim established by the fake suite.
