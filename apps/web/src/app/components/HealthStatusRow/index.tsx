import type { ReactNode } from 'react';

export function HealthStatusRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-[var(--spacing-8)] border-border py-[var(--spacing-24)] sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-[var(--spacing-16)] [&:not(:last-child)]:border-b">
      <dt className="text-foreground">{label}</dt>
      <dd className="m-0 text-start sm:text-end">{children}</dd>
    </div>
  );
}
