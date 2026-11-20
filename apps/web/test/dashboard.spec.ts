import { test, expect, type Page } from '@playwright/test';

async function create(page: Page, amount = '25.00') {
  await page.goto('/payments');
  await page.getByLabel('Amount (required)').fill(amount);
  await page
    .getByRole('button', { name: 'Create payment', exact: true })
    .click();
  await expect(page).toHaveURL(/\/payments\/[a-f0-9-]{36}$/);
  return page.url().split('/').at(-1)!;
}
async function open(page: Page) {
  await page
    .getByRole('button', {
      name: /Open confirmation session|Recover confirmation session/,
    })
    .click();
  await expect(
    page.getByText('Fixed fake-provider confirmation'),
  ).toBeVisible();
  await expect(page.getByTestId('provider-intent')).toHaveText(/^pi_fake_/);
}
async function status(page: Page, text: string) {
  await expect(
    page.getByRole('status', { name: 'Current financial status' }),
  ).toContainText(text);
}
test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return ['localhost', '127.0.0.1'].includes(url.hostname)
      ? route.continue()
      : route.abort('blockedbyclient');
  });
});
test('exact validation, keyboard focus, create/list/detail/history and decline retry on the same intent', async ({
  page,
}) => {
  await page.goto('/payments');
  const input = page.getByLabel('Amount (required)');
  await expect(input).toHaveAttribute('aria-invalid', 'false');
  await input.fill('1.001');
  await page
    .getByRole('button', { name: 'Create payment', exact: true })
    .click();
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText(/at most two fractional digits/)).toBeVisible();
  await input.fill('27.31');
  await page.getByLabel('Currency', { exact: true }).selectOption('EUR');
  await page
    .getByRole('button', { name: 'Create payment', exact: true })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    '€27.31 EUR',
  );
  await expect(
    page.getByRole('heading', { name: 'payment created' }),
  ).toBeVisible();
  await open(page);
  const intent = await page.getByTestId('provider-intent').innerText();
  await page.getByRole('button', { name: 'Confirm fake decline' }).click();
  await status(page, 'Attempt declined; retry possible');
  await page.getByRole('button', { name: 'Confirm fake success' }).click();
  await status(page, 'Succeeded');
  await expect(page.getByTestId('provider-intent')).toHaveText(intent);
  await expect(
    page.getByRole('button', { name: 'Open confirmation session' }),
  ).toHaveCount(0);
  await page.getByRole('link', { name: 'Back to payments' }).click();
  await page.getByLabel('Status', { exact: true }).selectOption('SUCCEEDED');
  await expect(page.getByRole('table')).toContainText('€27.31 EUR');
});
test('lost committed creation response retains key and body; replay fetches current succeeded details', async ({
  page,
  request,
}) => {
  let firstKey = '';
  let paymentId = '';
  let calls = 0;
  await page.route('**/api/v1/payments', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    calls++;
    const key = route.request().headers()['idempotency-key']!;
    if (calls === 1) {
      firstKey = key;
      const response = await route.fetch();
      paymentId = (await response.json()).id;
      await route.abort('failed');
    } else {
      expect(key).toBe(firstKey);
      expect(route.request().postDataJSON()).toEqual({
        amount: 2500,
        currency: 'USD',
      });
      await route.continue();
    }
  });
  await page.goto('/payments');
  await page
    .getByRole('button', { name: 'Create payment', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Retry same request' }),
  ).toBeVisible();
  const headers = { Origin: 'http://localhost:3000' };
  await request.post(`/api/v1/payments/${paymentId}/confirmation-session`, {
    data: {},
    headers,
  });
  await request.post(`/api/v1/dev/simulations/payments/${paymentId}/confirm`, {
    data: { scenario: 'success' },
    headers,
  });
  await expect(page.getByLabel('Amount (required)')).toHaveAttribute(
    'readonly',
    '',
  );
  await page.getByRole('button', { name: 'Retry same request' }).click();
  await status(page, 'Succeeded');
  expect(calls).toBe(2);
  await expect(page).toHaveURL(new RegExp(paymentId));
});
test('sequential duplicate and ten-request races show database evidence', async ({
  page,
}) => {
  await page.goto('/payments');
  for (const label of ['Run two identical requests', 'Race ten requests']) {
    await page.getByRole('button', { name: label }).click();
    await expect(
      page.getByText('Assertions passed', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Unique payments: 1. Creation events: 1.'),
    ).toBeVisible();
  }
  await page.getByRole('link', { name: 'Inspect run payment' }).click();
  await expect(
    page.getByRole('heading', { name: '$25.00 USD', exact: true }),
  ).toBeVisible();
});
test('fresh signed event rolls back, then duplicate signed replay recovers exactly one transition', async ({
  page,
}) => {
  await create(page);
  await open(page);
  await page.getByRole('button', { name: 'Arm webhook rollback' }).click();
  await expect(page.getByText(/Armed webhook_before_commit/)).toBeVisible();
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/confirm') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Confirm fake success' }).click();
  const report = await (await response).json();
  expect(report.deliveryStatus).toBe(503);
  await status(page, 'Pending');
  await expect(page.getByText(/Webhook HTTP 503/)).toBeVisible();
  await page.getByLabel('Observed webhook event ID').fill(report.eventId);
  await expect(async () => {
    await page
      .getByRole('button', { name: 'Replay signed event twice' })
      .click();
    await expect(
      page.getByText('Replay assertions passed', { exact: true }),
    ).toBeVisible({ timeout: 1000 });
  }).toPass({ intervals: [1500], timeout: 10000 });
  await status(page, 'Succeeded');
  await expect(
    page.getByText(
      'Processing: PROCESSED. Financial transitions for this event: 1.',
    ),
  ).toBeVisible();
});
test('provider create response loss is uncertainty and same-intent recovery, no financial failure', async ({
  page,
}) => {
  await create(page);
  await page
    .getByRole('button', { name: 'Arm provider response timeout' })
    .click();
  await expect(page.getByText(/Armed provider_response_timeout/)).toBeVisible();
  await page.getByRole('button', { name: 'Open confirmation session' }).click();
  await expect(page.getByText('Operational state: RETRYABLE')).toBeVisible();
  await status(page, 'Created');
  await expect(
    page.getByText(/PROVIDER_OUTCOME_UNKNOWN/).first(),
  ).toBeVisible();
  await expect(async () => {
    await page
      .getByRole('button', { name: 'Recover confirmation session' })
      .click();
    await expect(
      page.getByText('Fixed fake-provider confirmation'),
    ).toBeVisible({ timeout: 1000 });
  }).toPass({ intervals: [1500], timeout: 10000 });
  const intent = await page.getByTestId('provider-intent').innerText();
  expect(intent).toMatch(/^pi_fake_/);
  await page.getByRole('button', { name: 'Synchronize with provider' }).click();
  await expect(page.getByTestId('provider-intent')).toHaveText(intent);
  await status(page, 'Pending');
});
test('proxy guards, no credential storage/cache, no real Stripe, safe return and responsive captures', async ({
  page,
  request,
}, testInfo) => {
  const foreign = await request.post('/api/v1/dev/simulations/request-race', {
    data: { scenario: 'duplicate_request', amount: 2500, currency: 'USD' },
    headers: { Origin: 'http://foreign.example' },
  });
  expect(foreign.status()).toBe(403);
  const host = await request.get('/api/v1/payments', {
    headers: { Host: 'foreign.example:3000' },
  });
  expect(host.status()).toBe(403);
  expect(
    (
      await request.post('/api/v1/payments', {
        data: { amount: 100, currency: 'USD' },
      })
    ).status(),
  ).toBe(403);
  expect(
    (await request.get('/api/v1/payments?target=http://foreign')).status(),
  ).toBe(400);
  const requests: string[] = [];
  page.on('request', (req) => requests.push(req.url()));
  const id = await create(page);
  await open(page);
  const caches = await page.locator('main').evaluate((el) => {
    type Fiber = {
      return?: Fiber;
      memoizedProps?: {
        client?: {
          getQueryCache(): { getAll(): unknown[] };
          getMutationCache(): { getAll(): unknown[] };
        };
      };
    };
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    let fiber = key ? (el as unknown as Record<string, Fiber>)[key] : undefined;
    while (fiber) {
      const client = fiber.memoizedProps?.client;
      if (client?.getQueryCache)
        return JSON.stringify({
          queries: client
            .getQueryCache()
            .getAll()
            .map((q: unknown) => (q as { state: unknown }).state),
          mutations: client
            .getMutationCache()
            .getAll()
            .map((q: unknown) => (q as { state: unknown }).state),
        });
      fiber = fiber.return;
    }
    return null;
  });
  expect(caches).not.toBeNull();
  expect(caches).not.toMatch(/clientSecret|_secret_|simulation_token/);
  expect(
    await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
      }),
    ),
  ).not.toMatch(/clientSecret|_secret_|simulation_token/);
  expect(requests.some((url) => /stripe\.com|stripe\.network/.test(url))).toBe(
    false,
  );
  expect(await page.locator('input').count()).toBe(1); // event ID only; no card inputs
  await page.goto(
    '/payments/return?redirect_status=succeeded&payment_intent_client_secret=untrusted',
  );
  await expect(page).toHaveURL(new RegExp(`/payments/${id}`));
  await status(page, 'Pending');
  expect(page.url()).not.toContain('secret');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1080 });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'payment created', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`details-${width}.png`),
      fullPage: true,
    });
    await page.goto('/payments');
    await expect(page.getByRole('table')).toBeVisible();
    await page.getByLabel('Amount (required)').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Currency', { exact: true })).toBeFocused();
    if (width === 390) {
      const table = page.getByRole('region', { name: /Payment ledger table/ });
      await table.focus();
      await page.keyboard.press('ArrowRight');
      await expect
        .poll(() => table.evaluate((el) => el.scrollLeft))
        .toBeGreaterThan(0);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`ledger-${width}.png`),
      fullPage: true,
    });
    await page.goto(`/payments/${id}`);
  }
});

test('ledger pagination preserves status filter and supports previous navigation', async ({
  page,
  request,
}) => {
  for (let i = 0; i < 11; i++) {
    const result = await request.post('/api/v1/payments', {
      data: { amount: 100 + i, currency: 'USD' },
      headers: {
        Origin: 'http://localhost:3000',
        'Idempotency-Key': crypto.randomUUID(),
      },
    });
    expect(result.status()).toBe(201);
  }
  await page.goto('/payments');
  await page.getByLabel('Status', { exact: true }).selectOption('CREATED');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText(/Page 2/)).toBeVisible();
  await expect(page.getByRole('table')).not.toContainText('Succeeded');
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(page.getByText(/Page 1/)).toBeVisible();
});
