'use client';
import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useCreatePaymentMutation } from '@/api/hooks/payments/useCreatePaymentMutation';
import type { CreatePayment } from '@/api/payments.types';
import { RequestError } from '@/api/client';
import { parseMoney } from '@/utils/money';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  Field,
  FieldLabel,
  FieldGroup,
  FieldDescription,
} from '@/components/ui/field';
import { RequestFeedback } from '@/components/shared/RequestFeedback';

export function PaymentForm() {
  const router = useRouter();
  const mutation = useCreatePaymentMutation();
  const [amount, setAmount] = useState('25.00');
  const [currency, setCurrency] = useState<'USD' | 'EUR'>('USD');
  const [validation, setValidation] = useState('');
  const [retained, setRetained] = useState(false);
  const logical = useRef<{ key: string; body: CreatePayment } | null>(null);
  const busy = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    if (!logical.current) {
      try {
        logical.current = {
          key: crypto.randomUUID(),
          body: { amount: parseMoney(amount), currency },
        };
      } catch (error) {
        setValidation((error as Error).message);
        input.current?.focus();
        return;
      }
    }
    busy.current = true;
    setRetained(true);
    setValidation('');
    try {
      const result = await mutation.mutateAsync(logical.current);
      router.push(`/payments/${result.id}`);
    } catch (error) {
      if (
        error instanceof RequestError &&
        error.status >= 400 &&
        error.status < 500 &&
        !error.retryable
      ) {
        logical.current = null;
        setRetained(false);
      }
    } finally {
      busy.current = false;
    }
  }
  return (
    <section aria-labelledby="create-heading" className="flex flex-col gap-6">
      <div>
        <h2 id="create-heading" className="text-subheading">
          New payment
        </h2>
        <p className="mt-2 text-body-sm text-muted-foreground">
          Create locally, then confirm a test payment.
        </p>
      </div>
      <form
        method="post"
        action="/api/v1/payments"
        aria-labelledby="create-heading"
        noValidate
        onSubmit={submit}
        className="flex flex-col gap-6"
      >
        <FieldGroup>
          <Field data-invalid={Boolean(validation)} data-disabled={retained}>
            <FieldLabel htmlFor="amount">Amount (required)</FieldLabel>
            <Input
              ref={input}
              id="amount"
              name="amount"
              inputMode="decimal"
              autoComplete="off"
              required
              value={amount}
              readOnly={retained}
              aria-invalid={Boolean(validation)}
              aria-describedby={
                validation ? 'amount-help amount-error' : 'amount-help'
              }
              onChange={(e) => {
                setAmount(e.target.value);
                if (validation) setValidation('');
              }}
            />
            <FieldDescription id="amount-help">
              1.00–10,000.00. Up to two decimal places.
            </FieldDescription>
            <p id="amount-error" aria-live="polite" className="text-body-sm">
              {validation}
            </p>
          </Field>
          <Field data-disabled={retained}>
            <FieldLabel htmlFor="currency">Currency</FieldLabel>
            <NativeSelect
              id="currency"
              name="currency"
              value={currency}
              disabled={retained}
              onChange={(e) => setCurrency(e.target.value as 'USD' | 'EUR')}
            >
              <NativeSelectOption value="USD">
                USD — US dollar
              </NativeSelectOption>
              <NativeSelectOption value="EUR">EUR — Euro</NativeSelectOption>
            </NativeSelect>
          </Field>
        </FieldGroup>
        <Button type="submit" disabled={mutation.isPending}>
          <Plus data-icon="inline-start" aria-hidden="true" />
          {mutation.isPending
            ? 'Creating…'
            : retained
              ? 'Retry same request'
              : 'Create payment'}
        </Button>
        {retained && mutation.isError ? (
          <p role="status" className="text-body-sm">
            The original amount and request key are retained. Retry to find the
            committed payment.
          </p>
        ) : null}
        <RequestFeedback error={mutation.error} />
      </form>
    </section>
  );
}
