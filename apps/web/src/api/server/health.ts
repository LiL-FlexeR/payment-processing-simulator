import 'server-only';

export function localOrigins() {
  try {
    const api = new URL(
      process.env.API_INTERNAL_ORIGIN ?? 'http://127.0.0.1:3001',
    );
    const web = new URL(process.env.WEB_ORIGIN ?? 'http://localhost:3000');
    for (const [url, port] of [
      [api, '3001'],
      [web, '3000'],
    ] as const) {
      if (
        url.protocol !== 'http:' ||
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        url.port !== port ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
      )
        throw new Error(
          'Configure exact local API/web origins in the server environment.',
        );
    }
    return { api, web };
  } catch {
    throw new Error(
      'Configure exact local API/web origins in the server environment.',
    );
  }
}

export async function readHealth(probe: 'live' | 'ready', requestId?: string) {
  const { api } = localOrigins();
  try {
    const response = await fetch(new URL(`/api/v1/health/${probe}`, api), {
      cache: 'no-store',
      signal: AbortSignal.timeout(2500),
      redirect: 'error',
      headers: requestId ? { 'X-Request-Id': requestId } : undefined,
    });
    const body: unknown = await response.json();
    // Never forward arbitrary backend error text or unexpected response fields.
    if (
      probe === 'live' &&
      response.status === 200 &&
      (body as { status?: unknown }).status === 'ok'
    )
      return { status: 200, body: { status: 'ok' } };
    if (
      probe === 'ready' &&
      response.status === 200 &&
      (body as { status?: unknown; database?: unknown }).status === 'ready' &&
      (body as { database?: unknown }).database === 'up'
    )
      return { status: 200, body: { status: 'ready', database: 'up' } };
  } catch {
    /* A failed probe exposes no internal connection information. */
  }
  return {
    status: 503,
    body:
      probe === 'ready'
        ? { status: 'not_ready', database: 'down' }
        : { status: 'unavailable' },
  };
}
