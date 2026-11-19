import type { ReactNode } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-[var(--page-max-width)] px-[var(--spacing-24)] sm:px-[var(--spacing-32)]">
      <a
        href="#main"
        className="absolute start-[var(--spacing-8)] top-[var(--spacing-8)] -translate-y-[200%] bg-background p-[var(--spacing-8)] focus:translate-y-0"
      >
        Skip to content
      </a>
      <header className="flex min-h-[80px] flex-wrap items-center justify-between gap-[var(--spacing-16)] border-b border-border py-[var(--spacing-24)] sm:flex-nowrap">
        <Link
          href="/"
          className="text-body text-foreground no-underline"
          prefetch={false}
        >
          Payment Processing Simulator
        </Link>
        <Badge variant="accent">Test mode only</Badge>
      </header>
      <main
        id="main"
        className="max-w-[880px] py-[var(--spacing-48)] sm:py-[var(--spacing-64)]"
      >
        {children}
      </main>
      <footer className="border-t border-border py-[var(--spacing-24)] text-body-sm text-muted-foreground">
        Local development · No payment data is collected
      </footer>
    </div>
  );
}
