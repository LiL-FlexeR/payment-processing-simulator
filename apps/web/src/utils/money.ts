export function parseMoney(input: string): number {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(input))
    throw new Error(
      'Enter a decimal amount with at most two fractional digits, such as 25.00.',
    );
  const [whole, fraction = ''] = input.split('.');
  if (whole!.length > 5)
    throw new Error('Amount must be between 1.00 and 10,000.00 USD or EUR.');
  const minor = Number(BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0')));
  if (minor < 100 || minor > 1000000)
    throw new Error('Amount must be between 1.00 and 10,000.00 USD or EUR.');
  return minor;
}
export function formatMoney(minor: number, currency: 'USD' | 'EUR') {
  if (!Number.isSafeInteger(minor) || minor < 0)
    throw new Error('Invalid minor units.');
  const value = BigInt(minor);
  const whole = (value / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency === 'USD' ? '$' : '€'}${whole}.${(value % 100n).toString().padStart(2, '0')} ${currency}`;
}
