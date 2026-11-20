'use client';
import { useState } from 'react';
import {
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
import { Button } from '@/components/ui/button';
export function StripeConfirmationForm({
  amount,
  onObserved,
}: {
  amount: string;
  onObserved: () => Promise<void>;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  return (
    <form
      method="post"
      aria-label="Stripe test payment"
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!stripe || !elements || busy) return;
        setBusy(true);
        setMessage('');
        try {
          const result = await stripe.confirmPayment({
            elements,
            confirmParams: {
              return_url: `${window.location.origin}/payments/return`,
            },
            redirect: 'if_required',
          });
          setMessage(
            result.error
              ? 'The test method could not complete. Check the Payment Element and synchronize before retrying.'
              : 'Confirmation returned. The outcome remains provisional until synchronized details agree.',
          );
        } catch {
          setMessage(
            'Confirmation outcome is uncertain. Synchronize this payment before trying another confirmation.',
          );
        } finally {
          setBusy(false);
          await onObserved();
        }
      }}
    >
      <PaymentElement />
      <Button type="submit" disabled={!stripe || !elements || busy}>
        {busy ? 'Confirming…' : `Pay ${amount} in test mode`}
      </Button>
      <p role="status" className="text-body-sm">
        {message}
      </p>
    </form>
  );
}
