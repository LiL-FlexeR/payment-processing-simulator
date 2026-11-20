import { dashboardConfig } from '@/api/server/dashboard-config';
import { PaymentForm } from './components/PaymentForm';
import { PaymentList } from './components/PaymentList';
import { RaceScenarios } from './components/RaceScenarios';
import { Separator } from '@/components/ui/separator';
export const dynamic = 'force-dynamic';
export default function PaymentsPage() {
  return (
    <>
      <div className="mb-10 flex flex-col gap-4">
        <h1 className="text-heading-lg tracking-[var(--tracking-heading-lg)]">
          Payments
        </h1>
        <p className="max-w-[70ch]">
          Follow a payment from local creation to a verified outcome. Explore
          retries and duplicate prevention with test data.
        </p>
      </div>
      <div className="grid items-start gap-10 lg:grid-cols-[304px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-8 rounded-md border border-border bg-muted p-6">
          <PaymentForm />
          {dashboardConfig().simulation ? (
            <>
              <Separator />
              <RaceScenarios />
            </>
          ) : null}
        </aside>
        <PaymentList />
      </div>
    </>
  );
}
