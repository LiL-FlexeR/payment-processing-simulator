# Project Structure and Dependency Boundaries

This document owns the source layout, dependency injection rules, component conventions and frontend API organization. These are implementation instructions. Stage 1 establishes Config, Database, Health and the frontend shell; Stage 2 adds local Payments, DTOs, two services and shared HTTP/error handling. Stage 3 adds provider-neutral contracts/binding, Stripe/fake adapters, payment lease/sync services and Webhooks; Stage 4 implements the frontend layout below and guarded Simulation orchestration. Keep the five-stage order and [runtime contract](system-overview.md#local-container-runtime).

## Backend Layout

Application source belongs under `apps/api/src`. Organize business features under `modules`, reusable infrastructure under `shared`, and external provider implementations under `integrations`.

```text
apps/api/
├── prisma/                         # Schema/migrations for the selected Prisma version
└── src/
    ├── main.ts
    ├── app.module.ts
    ├── modules/
    │   ├── payments/
    │   │   ├── payments.module.ts
    │   │   ├── payments.controller.ts
    │   │   ├── services/            # Once two or more services exist
    │   │   │   ├── payments.service.ts
    │   │   │   └── payment-sync.service.ts
    │   │   ├── dto/
    │   │   ├── types/               # Once multiple type artifacts exist
    │   │   └── payment-state-machine.ts
    │   ├── webhooks/
    │   ├── simulation/
    │   └── health/
    ├── shared/
    │   ├── config/
    │   ├── database/
    │   └── http/                    # Shared exception/request-ID handling
    ├── integrations/
    │   ├── payment-provider.module.ts
    │   ├── payment-provider.interface.ts
    │   ├── payment-provider.token.ts
    │   ├── payment-provider.types.ts
    │   ├── stripe/
    │   │   ├── stripe.module.ts
    │   │   ├── stripe-payment.provider.ts
    │   │   └── stripe-error.util.ts
    │   └── fake/                    # Guarded development/test provider
    ├── utils/                       # Pure utilities reused across features, if needed
    └── constants/                   # Application-wide constants, if needed
```

The tree illustrates eventual locations, not a requirement to create empty folders or split services before their responsibilities exist. `auth` and `users` are examples of future feature names, not additions to this MVP. Keep PaymentEvent ownership in Payments; it needs no standalone module.

### Module Folder Rule

Apply the following independently inside each `src/modules/<module>`:

| Category | One artifact | Two or more artifacts |
| --- | --- | --- |
| Controllers | `<module>.controller.ts` at module root | `controllers/` |
| Services | `<name>.service.ts` at module root | `services/` |
| Types | `<name>.type.ts` or a local type file at module root | `types/` |
| Interfaces | `<name>.interface.ts` at module root | `interfaces/` |

When a category grows to two or more, move that category's existing files into the folder and update imports/tests. A second service does not require a `controllers/` folder when there is still one controller. Test files and the module declaration do not count as additional controllers/services. DTOs stay with their feature, usually in `dto/`; do not promote feature-specific shapes, constants or helpers into global folders merely because several files in the feature use them.

Use `shared` for genuinely reused injectable infrastructure, such as Config, Database and common HTTP concerns. It must not become a home for payment business logic. Use `utils` for shared pure functions without injected dependencies and `constants` only for application-wide values. Keep Stripe-specific error codes/helpers beside the Stripe adapter and payment-specific rules beside Payments.

### Dependency Injection and Provider Replacement

Use NestJS constructor injection and explicit module imports/exports. Injectable services and integrations are registered providers; business services must not instantiate them with `new` or look them up through a service locator. Pure functions such as the state machine do not need DI.

Define the provider-neutral `PaymentProvider` interface and normalized request/result types in `src/integrations`. Use the runtime symbol token `PAYMENT_PROVIDER` from `payment-provider.token.ts` for injection; a TypeScript interface alone is not a runtime token. See [NestJS custom providers](https://docs.nestjs.com/fundamentals/custom-providers).

`PaymentProviderModule` is the small binding/composition module: it imports the selected integration and exports `PAYMENT_PROVIDER`. `PaymentsModule` and `WebhooksModule` import that module and inject the port. The binding selects Stripe or the existing guarded fake using validated configuration; it must not load or register the fake in production. Tests override the token with a controlled fake.

The Stripe module creates its SDK client through a Nest provider factory using injected configuration, then injects that client into the adapter. SDK construction stays in this composition code, with no global client or direct construction inside feature services.

Dependency direction is explicit:

- Feature modules may import shared infrastructure and provider-neutral contracts/bindings.
- Integrations may import shared infrastructure and their neutral contracts; they do not import feature modules.
- Shared infrastructure, global utilities and global constants do not import feature modules or Stripe implementations.
- Stripe SDK imports, SDK types, API-specific parameters, signature verification, error normalization and test-event replay helpers stay in `src/integrations/stripe`.

Payments retains local creation, idempotency, state-machine decisions, leases and transaction/audit orchestration. Webhooks retains the HTTP endpoint, raw-body handoff, durable receipt/deduplication and orchestration; the Stripe adapter performs provider-specific verification and returns normalized data. No feature service/controller depends directly on `StripePaymentProvider`, Stripe SDK types or a Stripe client. Composition/binding code is the place where the concrete implementation is chosen.

The normalized observation phase is `AWAITING_PAYMENT`, `ACTION_REQUIRED`, `PROCESSING`, `DECLINED`, `SUCCEEDED`, `CANCELED` or `UNSUPPORTED`. The Stripe adapter translates raw intent states/errors into this phase. Payments maps the phase to the local state machine and enforces transitions. Keep the original `providerStatus` string for the existing audit/details contract, not for Stripe-specific branching in domain services. The [lifecycle mapping](payment-lifecycle.md#normalized-provider-mapping) defines both steps.

This boundary enables replacing the adapter in future. It does not introduce a second real provider, generic plugin registry or provider-switching UI into the MVP. Existing `stripePaymentIntentId` fields, event/API contracts and Stripe Payment Element are intentionally Stripe-specific; replacing Stripe would require a separate schema/contract/UI migration as well as a new adapter.

## Frontend Layout

Application source belongs under `apps/web/src`; use `src/app` rather than a second top-level `app` directory.

```text
apps/web/
├── public/
└── src/
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx
    │   ├── globals.css
    │   ├── api/v1/                  # Allowlisted Next.js proxy route handlers
    │   └── payments/
    │       ├── page.tsx
    │       ├── [id]/page.tsx
    │       ├── components/
    │       │   └── PaymentForm/
    │       │       ├── index.tsx
    │       │       ├── types.ts
    │       │       └── hooks/
    │       │           └── usePaymentForm.ts
    │       └── hooks/               # Hooks shared within this page/domain
    ├── components/
    │   ├── ui/
    │   │   └── button/index.tsx     # shadcn primitive, folder entry point
    │   ├── layouts/
    │   │   └── AppLayout/
    │   │       ├── index.tsx
    │   │       ├── types.ts
    │   │       └── hooks/useAppLayout.ts
    │   └── shared/
    │       └── QueryProvider/index.tsx
    ├── api/
    │   ├── client.ts                # Browser Axios configuration
    │   ├── query-client.ts          # TanStack Query configuration/factory
    │   ├── payments.ts             # Typed HTTP request functions
    │   ├── payments.types.ts       # Payment API transport types
    │   └── hooks/
    │       └── payments/
    │           ├── usePaymentsQuery.ts
    │           ├── usePaymentQuery.ts
    │           ├── usePaymentEventsQuery.ts
    │           ├── useCreatePaymentMutation.ts
    │           └── useSyncPaymentMutation.ts
    ├── types/                      # Types shared across unrelated domains
    ├── utils/                      # Shared pure helpers, e.g. exact-money formatting
    └── hooks/                      # Genuinely shared custom UI hooks, if needed
```

Hooks and `types.ts` in the examples are created only when the component needs them. `src/api` is application HTTP/query infrastructure; `src/app/api` contains Next.js route handlers. They are different responsibilities despite the shared name. Keep the proxy's server-only configuration/credentials out of browser-imported API modules.

### Components, Hooks and Imports

Every reusable or page-associated React component has a folder with an `index.tsx` entry point. Put its implementation/exports there and colocate private hooks, types, tests and supporting files as needed. Use PascalCase folders for application components, including layouts. Keep shadcn registry names lowercase, e.g. `src/components/ui/button/index.tsx`, so imports such as `@/components/ui/button` remain stable.

Configure shadcn aliases to the chosen `src/components/ui` and shared utility locations. If the selected CLI generates a flat primitive file, move its implementation into that primitive's folder entry point, fix relative imports and remove the flat duplicate. Inspect future add/update diffs so the generator does not silently reintroduce a parallel implementation. This is a project convention layered on top of [shadcn alias configuration](https://ui.shadcn.com/docs/components-json).

The current CLI's `info` command does not enumerate these nested `index.tsx` primitives. Inspect `src/components/ui/<name>/index.tsx` before adding/updating even when its component list is empty. Normalize generated helper imports to the existing `@/utils/cn` rather than introducing another class-merging implementation.

Next.js special files (`page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `route.ts`, and other framework-defined names) retain their required filenames. They can compose folder-based components. Do not replace a route's `page.tsx` with `page/index.tsx`. Page-local components can be colocated without defining additional pages/routes; follow [Next.js file conventions](https://nextjs.org/docs/app/getting-started/project-structure).

Keep a page's components in `src/app/<page>/components` and its domain-only UI hooks in that page's `hooks` folder. Component-private hooks belong inside the component folder. Promote a hook to `src/hooks` only when unrelated consumers actually share it. API query/mutation hooks belong in `src/api/hooks/<module>`, not `src/hooks` or component files.

Keep dependencies flowing from pages/components to API hooks and request functions. `src/api` must not import page/layout components. Shared components must not import a page's private implementation. Keep component-prop types local, domain API transport types with the API domain, and only genuinely cross-domain types in `src/types`. Avoid central component barrel files that eagerly re-export every component; a component's own `index.tsx` is its explicit entry point.

### Styling Conventions

Use shadcn/ui for available UI primitives and Tailwind utility classes in JSX for layout, spacing and responsive behavior. Keep semantic HTML for page landmarks and content structure; a footer does not require a special UI primitive. Use component variants for reusable visual treatments and the shared `cn()` helper for conditional/merged classes.

Keep `src/app/globals.css` limited to Tailwind/reference imports, theme/semantic token mappings and base element styles. Do not add application-specific selectors such as `.shell-footer`, `.service-row` or `.payment-card`, or hide the same patterns behind global `@apply` rules. Extract repeated markup into a folder-based local/shared component when appropriate. If a future behavior genuinely needs CSS that utilities cannot express, keep it scoped to that component and document the reason.

The supplied reference files remain unchanged. Reuse their values through semantic utilities or explicit CSS-variable utilities; note that the imported spacing names use normalized pixel values, so do not assume every numeric spacing token has Tailwind's default meaning. Shadcn source variants are adapted to the flat reference theme, named radii and accessible action sizes instead of overriding their appearance separately at every call site.

### HTTP and Query/Mutation Hooks

Use **Axios** for typed browser HTTP requests and **TanStack Query** for domain queries/mutations. These are the selected defaults for the requested `src/api/hooks/<module>` organization. Pin compatible versions when implementing Stage 4; do not add an additional server-state library or Redux/Zustand layer. Local form/interaction state remains in component/domain hooks.

Create one configured browser Axios instance in `src/api/client.ts`, using the same-origin `/api/v1` base, a bounded 10-second timeout and safe API-error normalization. Domain request functions use this instance rather than configuring HTTP separately inside each component. Pass application idempotency keys per create request, never as a mutable global default header. Do not add automatic POST retries or log raw Axios request/response objects. See [Axios instances](https://axios-http.com/docs/instance).

Use a small client `QueryProvider` with a stable browser QueryClient; keep the root layout a server component. Do not share a mutable QueryClient across server requests. Backend proxy route handlers use server-only networking and never import browser hooks/provider state. Their native `fetch` calls do not create a second browser API layer.

Configure query/mutation behavior explicitly rather than relying on library retry/refetch defaults. For the MVP, disable automatic retries for both reads and mutations and disable focus/reconnect refetches. Drive payment polling explicitly at the documented two-second interval and stop after 60 seconds or a terminal result; offer explicit refresh/recovery. Query keys include the domain, resource ID and applicable list filters/cursor. See [TanStack Query defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults).

After create/sync/scenario mutations, invalidate/refetch affected lists, details and event queries. A replayed 201 creation snapshot is not current payment state: use its payment ID to fetch current details rather than inserting its `CREATED` status as authoritative query data. Do not optimistically assign financial statuses.

The query cache is transient browser memory for local API projections. It is not a payment authority, a persisted cache or a replacement for `Cache-Control: no-store`. Do not add query persistence or cache Stripe client secrets. Obtain confirmation sessions through a typed Axios request invoked by a payment-local hook, retaining the returned secret only in component-local memory; keep session results out of both QueryCache and MutationCache. Browser API code never handles Stripe secret keys or the simulation bearer token.

## Stage Integration and Verification

- Stage 1 establishes `src` layouts, shared Config/Database and the Health feature without creating unused feature folders.
- Stage 2 adds `modules/payments`, local DI services, DTOs and pure domain logic; apply the per-category folder rule as it grows.
- Stage 3 adds provider-neutral contracts/binding, `integrations/stripe`, the guarded fake and `modules/webhooks`.
- Stage 4 adds folder-based dashboard components, typed Axios calls, query/mutation hooks and `modules/simulation`.
- Stage 5 verifies imports/DI replacement, component conventions, CLI update compatibility and API-hook behavior alongside the existing reliability checks.

Verify DI with Nest testing-module provider overrides, preserving the same domain behavior for a controlled fake. Verify that API hooks preserve request keys and respect polling/retry limits, that stale creation snapshots do not regress displayed state, and that client secrets/credentials do not enter query caches or browser output. Keep [design references](../design/DESIGN.md) and [payment/API contracts](README.md) intact while applying the structure.
