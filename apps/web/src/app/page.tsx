import { readHealth } from '@/api/server/health';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/utils/cn';
import { HealthStatusRow } from './components/HealthStatusRow';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const [live, ready] = await Promise.all([
    readHealth('live'),
    readHealth('ready'),
  ]);
  return (
    <>
      <h1 className="mb-[var(--spacing-24)] text-[clamp(2rem,1.5rem_+_2vw,3rem)] leading-[var(--leading-heading-lg)] tracking-[var(--tracking-heading-lg)]">
        Local environment
      </h1>
      <p className="mb-[var(--spacing-32)] max-w-[65ch]">
        The foundation for exploring reliable payments. This setup checks the
        API and database connection. Payment workflows arrive in later stages.
      </p>
      <dl
        className="my-[var(--spacing-40)] border-y border-border"
        aria-label="Environment status"
      >
        <HealthStatusRow label="API process">
          {live.status === 200 ? 'Running' : 'Unavailable — start the API'}
        </HealthStatusRow>
        <HealthStatusRow label="Database connection">
          {ready.status === 200 ? 'Ready' : 'Unavailable — check PostgreSQL'}
        </HealthStatusRow>
        <HealthStatusRow label="Payment processing">
          Not enabled
        </HealthStatusRow>
      </dl>
      <div className="flex flex-wrap gap-[var(--spacing-16)]">
        <form action="/" method="get">
          <Button type="submit">Check again</Button>
        </form>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- This link opens a JSON document, not a React page. */}
        <a
          href="/api/v1/health/ready"
          className={cn(buttonVariants({ variant: 'outline' }))}
        >
          View readiness response
        </a>
      </div>
    </>
  );
}
