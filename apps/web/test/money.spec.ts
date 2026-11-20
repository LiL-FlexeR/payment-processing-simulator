import { test, expect } from '@playwright/test';
import { parseMoney, formatMoney } from '../src/utils/money';
import { pollingInterval } from '../src/api/hooks/payments/usePaymentQuery';
import { makeQueryClient } from '../src/api/query-client';
import type { PaymentDetails } from '../src/api/payments.types';
test('decimal parsing and formatting preserve every integer boundary', () => {
  for (const [input, expected] of [
    ['1', 100],
    ['1.0', 100],
    ['1.01', 101],
    ['9999.99', 999999],
    ['10000.00', 1000000],
  ] as const)
    expect(parseMoney(input)).toBe(expected);
  for (const input of [
    '',
    '0',
    '0.99',
    '10000.01',
    '1.001',
    '1e2',
    'NaN',
    '-1',
    '1,25',
    ' 1.00',
    '.50',
    '01.00',
    '99999999999999999999',
  ])
    expect(() => parseMoney(input)).toThrow();
  expect(formatMoney(1000000, 'USD')).toBe('$10,000.00 USD');
  expect(formatMoney(101, 'EUR')).toBe('€1.01 EUR');
  expect(() => parseMoney('100000.00')).toThrow('between 1.00 and 10,000.00');
  for (let minor = 100; minor <= 1000000; minor += 997)
    expect(
      parseMoney(
        formatMoney(minor, 'USD')
          .replace('$', '')
          .replace(' USD', '')
          .replaceAll(',', ''),
      ),
    ).toBe(minor);
});
test('query retries and bounded polling are explicit', () => {
  const client = makeQueryClient();
  const options = client.getDefaultOptions();
  expect(options.queries).toMatchObject({
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  expect(options.mutations?.retry).toBe(false);
  expect(pollingInterval(undefined, 0, 59999)).toBe(2000);
  expect(pollingInterval(undefined, 0, 60000)).toBe(false);
  for (const status of ['SUCCEEDED', 'CANCELED'])
    expect(pollingInterval({ status } as PaymentDetails, 0, 10)).toBe(false);
  expect(pollingInterval({ status: 'FAILED' } as PaymentDetails, 0, 10)).toBe(
    2000,
  );
  client.clear();
});
