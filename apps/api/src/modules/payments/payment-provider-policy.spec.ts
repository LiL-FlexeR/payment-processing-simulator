import {
  createAllowed,
  CREATE_WINDOW_MS,
  retryDelay,
} from './payment-provider-policy.js';

describe('provider create cutoff/budget and request-driven backoff', () => {
  const now = new Date('2026-11-19T23:00:00.000Z');
  it('enforces the exact 23-hour boundary and six-call budget', () => {
    expect(
      createAllowed(
        { createAttemptCount: 0, firstProviderRequestAt: null },
        now,
      ),
    ).toBe(true);
    for (const count of [0, 1, 5])
      expect(
        createAllowed(
          {
            createAttemptCount: count,
            firstProviderRequestAt: new Date(
              now.getTime() - CREATE_WINDOW_MS + 1,
            ),
          },
          now,
        ),
      ).toBe(true);
    expect(
      createAllowed(
        { createAttemptCount: 6, firstProviderRequestAt: null },
        now,
      ),
    ).toBe(false);
    for (const extra of [0, 1, 3600000])
      expect(
        createAllowed(
          {
            createAttemptCount: 1,
            firstProviderRequestAt: new Date(
              now.getTime() - CREATE_WINDOW_MS - extra,
            ),
          },
          now,
        ),
      ).toBe(false);
  });
  it('uses persisted attempt counts, bounded jitter and longer provider delays without a request sleep loop', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => retryDelay(n, 0, 0))).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ]);
    expect(retryDelay(1, 0, 250)).toBe(1250);
    expect(retryDelay(1, 12000, 0)).toBe(12000);
  });
});
