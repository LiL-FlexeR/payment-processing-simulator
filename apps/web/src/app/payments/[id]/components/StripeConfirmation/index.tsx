'use client';
import { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js/pure';
import { Elements } from '@stripe/react-stripe-js';
import type { ConfirmationSession } from '@/api/payments.types';
import { StripeConfirmationForm } from './components/StripeConfirmationForm';

export function StripeConfirmation({
  session,
  amount,
  onObserved,
}: {
  session: ConfirmationSession;
  amount: string;
  onObserved: () => Promise<void>;
}) {
  const [configuration] = useState(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      stripe: loadStripe(session.publishableKey),
      variables: {
        colorPrimary: style.getPropertyValue('--primary').trim(),
        colorText: style.getPropertyValue('--foreground').trim(),
        borderRadius: style.getPropertyValue('--radius-inputs').trim(),
        fontFamily: getComputedStyle(document.body).fontFamily,
      },
    };
  });
  return (
    <Elements
      stripe={configuration.stripe}
      options={{
        clientSecret: session.clientSecret,
        appearance: {
          theme: 'stripe',
          variables: configuration.variables,
        },
      }}
    >
      <StripeConfirmationForm amount={amount} onObserved={onObserved} />
    </Elements>
  );
}
