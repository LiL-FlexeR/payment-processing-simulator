import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { QueryProvider } from '@/components/shared/QueryProvider';
import { dashboardConfig } from '@/api/server/dashboard-config';
import './globals.css';

export const metadata: Metadata = {
  title: 'Payment Processing Simulator',
  description: 'A local, test-mode payment engineering workspace.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>
          <AppLayout provider={dashboardConfig().provider}>
            {children}
          </AppLayout>
        </QueryProvider>
      </body>
    </html>
  );
}
