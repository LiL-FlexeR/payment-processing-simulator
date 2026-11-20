import { notFound } from 'next/navigation';
import { dashboardConfig } from '@/api/server/dashboard-config';
import { PaymentDetailsView } from './components/PaymentDetailsView';
export const dynamic = 'force-dynamic';
export default async function PaymentDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      id,
    )
  )
    notFound();
  return (
    <PaymentDetailsView
      id={id}
      simulation={dashboardConfig().simulation}
      returned={(await searchParams).returned === '1'}
    />
  );
}
