import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppLayout } from '@/components/layouts/AppLayout';
import './globals.css';

export const metadata: Metadata = {
  title: 'Payment Processing Simulator',
  description: 'A local, test-mode payment engineering workspace.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppLayout>{children}</AppLayout>
      </body>
    </html>
  );
}
