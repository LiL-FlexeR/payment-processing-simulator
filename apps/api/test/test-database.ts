export function assertTestDatabase(): void {
  const testUrl = new URL(process.env.DATABASE_URL ?? '');
  if (
    process.env.NODE_ENV !== 'test' ||
    !testUrl.pathname.endsWith('_test') ||
    !['localhost', '127.0.0.1'].includes(testUrl.hostname) ||
    testUrl.port !== '5433'
  )
    throw new Error(
      'Integration tests require NODE_ENV=test and a separate loopback database ending in _test on port 5433.',
    );
}
