# Stage 4 — Payment Simulator

## Objective

Build a compact dashboard that makes test payment outcomes, duplicate prevention and recovery easy to demonstrate. This stage has not started.

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

- [ ] Create the dashboard shell with a persistent test-mode/fake-mode indicator and navigation between list and details.
- [ ] Pin compatible Axios/TanStack Query versions; add the typed browser client, domain request functions and client QueryProvider with explicit retry/refetch settings.
- [ ] Group payment/scenario query and mutation hooks under `src/api/hooks/<module>`; invalidate/refetch affected projections without optimistic financial-state updates.
- [ ] Apply component folder/`index.tsx` conventions, page-local components/hooks and shadcn aliases; keep global types/utilities/hooks limited to actual shared scope.
- [ ] Apply the supplied design tokens to the shell and shadcn/ui primitives; document semantic mappings and resolved export discrepancies before building the remaining screens.
- [ ] Build the creation form with exact-money validation, currency select, accessible errors and retained logical-request key.
- [ ] Build the paginated payment list with status filter, loading/empty/error states and details navigation.
- [ ] Build details with local/provider status, operational error/retry timing, provider ID and creation/update/sync times.
- [ ] Build a newest-first audit timeline with safe error codes and webhook correlations; never expose raw provider payloads.
- [ ] Implement confirmation-session fetching, Stripe Payment Element mounting/confirmation and retry after decline on the existing intent.
- [ ] Keep confirmation-session results out of QueryCache/MutationCache by invoking the typed request from a payment-local hook and retaining the secret only in component-local memory.
- [ ] Handle configured return navigation by fetching/synchronizing details, without trusting URL query claims of success.
- [ ] Add bounded local polling and explicit synchronize/recover actions; avoid automatic card confirmation retries.
- [ ] Implement normal API proxy allowlists, no-store handling and separate guarded server-only simulation forwarding.
- [ ] Add the conditional Simulation module and HTTP scenario contracts; verify they are unregistered in production.
- [ ] Implement sequential duplicate and ten-request race demonstrations through the actual payment HTTP route and database counts.
- [ ] Add scoped one-shot rollback/response-timeout faults with 60-second expiry and immutable signed-event replay.
- [ ] Add fake-only fixed confirmation scenarios that use the same signature verifier and transaction path.
- [ ] Show run observations, response statuses, unique payment/event counts and recovery results as evidence, including failed assertions.
- [ ] Add initial deterministic Playwright flows and guard/signature integration tests.
- [ ] Verify keyboard/focus/error announcement behavior and narrow/wide layouts; update demo instructions with real steps.

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

- [ ] A developer can create, find and inspect a payment and its audit timeline without raw database queries.
- [ ] Monetary input/formatting preserves exact integer values; invalid precision and bounds are explained accessibly.
- [ ] A decline is visibly retryable and can later succeed on the same payment/intent; terminal states cannot reopen confirmation.
- [ ] Duplicate/concurrent scenario reports prove one local payment and one creation event.
- [ ] A duplicate signed event creates no second financial transition; a new event's injected rollback returns failure and later recovers.
- [ ] A response timeout is shown as uncertainty/operational failure and recovers by observing the same provider object.
- [ ] The browser receives neither simulation token nor raw card fields/client secrets in logs, URLs or persistent storage.
- [ ] Production/disabled simulation routes are absent and fake confirmation is unavailable in Stripe mode.
- [ ] Initial browser/API checks pass; keyboard navigation and responsive details are verified.
- [ ] Dashboard styling follows the supplied design references and named tokens, with any accessibility/density adaptations documented and visually verified.
- [ ] Source folders, component entry points, API-hook grouping and DI-backed simulation paths follow the structure contract; no credentials enter client query caches.

## Definition of Done

All required UI and scenario functionality is implemented, acceptance criteria are verified, required browser/API/unit checks pass, workflow/demo documentation is updated, and no known blocking issues remain. A rendered dashboard alone does not complete the stage.

## Out of Scope

Authentication systems, multi-tenancy, advanced charting, a general design system, arbitrary provider mutations, production fault injection, screenshot fabrication, and comprehensive CI/container hardening owned by Stage 5.

## Dependencies

Depends on Stage 3's complete provider and webhook contracts. Supplies a demonstrable application and initial Playwright suite for [Stage 5](05-testing-and-polish.md). Optional skill installation is never required.

