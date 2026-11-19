# Repository Instructions

## Scope and Development Context

Payment Processing Simulator is a small, test-mode payment application. Follow the current user request and the five-stage roadmap; the presence of these instructions does not authorize starting an implementation stage. Documentation and design-reference tasks should change documentation only unless implementation is requested.

Before planning or implementing a development task, read:

1. [README.md](README.md) for project scope and actual implementation status.
2. [The roadmap](docs/features/ROADMAP.md) and the detailed document for the requested stage.
3. [The architecture index](docs/architecture/README.md), then the architecture contracts relevant to the change.
4. [The supplied design reference](docs/design/DESIGN.md) for the project's visual direction.

Before creating or moving source files, read [Project structure and dependency boundaries](docs/architecture/project-structure.md). It owns the backend/frontend layout and import conventions.

Before frontend setup, styling, component work or visual verification, also read these files together:

- [tokens.json](docs/design/tokens.json): structured colors, typography, spacing, radii and surfaces.
- [variables.css](docs/design/variables.css): CSS custom properties, named component roles and layout values.
- [theme.css](docs/design/theme.css): the supplied Tailwind theme mapping.

The actual directory is `docs/design/`. Do not create a parallel `docs/disgn/` directory. Re-read relevant references when the user changes them; a previous chat summary is not a replacement for the current files.

## Contract Ownership

- Architecture documents own payment behavior, persistence, API contracts, security and recovery rules.
- `docs/design/` owns the visual reference and token vocabulary. Its reconstructed HTML, example prompts and marketing copy are examples, not new application features.
- Stage documents own implementation order, task scope and acceptance criteria. Keep architecture, design integration and stage instructions consistent when changing a contract.
- Skills provide implementation guidance; they do not override the user's scope or the project's explicit behavior/design decisions.

Use the planned npm-workspace layout: `apps/api` for NestJS/Prisma, `apps/web` for Next.js App Router, `infra` for Docker configuration and `docs` for project documentation. Keep the modular monolith small; avoid new infrastructure or abstractions without a concrete MVP need.

Run the backend and PostgreSQL as separate Docker Compose services from Stage 1; a database-only Compose setup does not satisfy the local development plan. Redis is conditional: add it only for a concrete documented feature, and run it as another Compose service when needed. PostgreSQL remains authoritative for payment consistency, idempotency and webhook deduplication. See the [container runtime contract](docs/architecture/system-overview.md#local-container-runtime).

## Source Structure

- Backend source uses `apps/api/src/modules`, `shared`, `integrations`, `utils` and `constants`. Keep feature logic local; create shared/global helpers only for actual reuse.
- Use NestJS constructor DI and explicit provider tokens for interfaces. Payments injects the neutral `PaymentProvider` port; Stripe SDK/client/types stay in `integrations/stripe`, selected through the integration binding module.
- Inside a backend feature, keep a single controller/service/type/interface artifact at module root. Use the corresponding `controllers/`, `services/`, `types/` or `interfaces/` folder when that category contains two or more. Apply the rule independently per category and update imports when moving files.
- Frontend source uses `apps/web/src/app` for routing, page-local `components`/`hooks`, `src/components/ui`, `layouts` and `shared` for reusable components, and `src/api/hooks/<module>` for queries/mutations. Reserve global `src/types`, `utils` and `hooks` for actual cross-domain reuse.
- Every application/page component has its own folder and `index.tsx`; private hooks and types stay inside it. Apply the folder convention to shadcn primitives as well, preserving registry import names. Next.js special route/layout filenames remain unchanged.
- Use a typed Axios browser client and TanStack Query hooks, with explicit retries/polling/invalidation. Keep confirmation-session secrets out of query/mutation caches; retain them only in local component state. Preserve application idempotency keys across user-triggered retries.
- Do not create unused folders, extra modules or global barrel exports to fill a template. Auth/users are examples, not new MVP requirements. Follow the detailed [structure contract](docs/architecture/project-structure.md) for DI wiring, provider replacement limits and generator compatibility.

## Design Integration

- Use the supplied light theme, indigo action accent, navy text, restrained surfaces, fine dividers and flat components as the dashboard baseline. Adapt the reference to an operational payment interface rather than copying a marketing page.
- Map the provided values to application CSS, Tailwind and shadcn/ui semantic tokens. Reuse named tokens instead of inventing a separate palette, spacing scale or component style.
- Prefer explicit component rules and named CSS roles over contradictory generic examples. In the current export, buttons, inputs and cards use 4px radii; pill radii belong to tags. The pill-button example does not override those component definitions.
- Preserve readable tables, tabular numerals, keyboard focus, accessible contrast and responsive layouts. Communicate payment/error states through text and appropriate icons, not color alone. Document necessary accessibility or dashboard-density adaptations in the relevant stage documentation.
- No font files are supplied. Use the documented fallback stack unless an appropriate font asset is provided; declaring `sohne-var` does not make the font available.
- Treat `docs/design/` as supplied reference material. Preserve its files unless the requested task calls for changing them. Do not silently rewrite exports to resolve a discrepancy; record the chosen application mapping and its reason.
- Review the rendered result against the reference at narrow and wide sizes when implementing UI. Report any visual verification that could not be performed.

## Payment Invariants

- Use integer minor units and the documented USD/EUR bounds; never calculate payment amounts with floating-point arithmetic.
- Keep application idempotency, provider operation idempotency and webhook event deduplication separate.
- Preserve atomic local creation and immutable creation responses. Use database constraints for concurrent requests.
- Stripe's current validated state is authoritative. `FAILED` is retryable; `SUCCEEDED` and `CANCELED` are terminal. Browser callbacks and simulation controls cannot assign financial statuses.
- Verify webhook signatures against exact raw bytes. Apply financial changes, audit events and webhook completion atomically; receipt insertion alone does not justify acknowledging unfinished processing.
- Keep external HTTP calls outside database transactions. Preserve stable provider keys, fenced leases and the documented unknown-outcome recovery limits.
- Use Stripe test mode only. Never receive/store raw card data, expose secrets or enable development simulations in production.

## Local Skills

Installed skills live in `.agents/skills`; the [installation manifest](.agents/skills/install-manifest.json) records their sources and pinned revisions. Read a relevant skill's `SKILL.md` before applying it; avoid loading unrelated skills for every task.

Use the stage recommendations for NestJS, PostgreSQL/Prisma, Docker, React/shadcn, Playwright and GitHub Actions work. For UI work, `impeccable` and `frontend-design` should respect the supplied design direction. Follow `modern-web-guidance` for applicable web-platform changes and the other installed skills when their scope applies. Skills remain optional implementation aids if unavailable in another checkout.

Check Prisma compatibility before using examples: the installed `prisma-client-api` covers the earlier client API and is not an authoritative Prisma 8 reference. Use version-matched official/package guidance. Keep any explicitly requested skill installation project-local and inspect bundled scripts before execution. Do not treat installing a skill as permission to initialize the application or enable hooks.

## Verification and Handoff

- Inspect actual manifests/scripts before running project commands. Setup, build and test commands are not available merely because a stage proposes them; do not invent passing results.
- For implementation, run checks appropriate to the change and the stage's acceptance criteria. Use real PostgreSQL for transaction/concurrency tests, signed fixtures for webhook tests, and a deterministic fake for credential-free browser tests. Record real Stripe smoke checks separately.
- For documentation changes, verify local links and any affected examples; preserve the required stage format and distinguish planned behavior from implemented behavior.
- Keep repository documentation in English. Respond to the user in their preferred language.
- Update relevant documentation with verified behavior. Mark a stage complete only after its acceptance criteria and required checks pass, and report remaining limitations clearly.
