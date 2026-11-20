import 'server-only';
import { randomUUID } from 'node:crypto';
import { localOrigins } from './health';
import { dashboardConfig } from './dashboard-config';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const normal = [
  ['GET', /^payments$/, ['status', 'limit', 'cursor']],
  ['POST', /^payments$/, []],
  ['GET', /^payments\/[^/]+$/, []],
  ['GET', /^payments\/[^/]+\/events$/, ['limit', 'cursor']],
  ['POST', /^payments\/[^/]+\/(confirmation-session|sync)$/, []],
] as const;
const development =
  /^dev\/simulations\/(request-race|payments\/[a-f0-9-]{36}\/(fault|confirm)|webhooks\/evt_[A-Za-z0-9_]{1,200}\/replay)$/i;

export async function proxy(request: Request, parts: string[], dev = false) {
  const incoming = request.headers.get('x-request-id');
  const requestId = incoming && uuid.test(incoming) ? incoming : randomUUID();
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'X-Request-Id': requestId,
    'Referrer-Policy': 'no-referrer',
  });
  const error = (status: number, code: string, message: string) =>
    Response.json(
      {
        error: {
          code,
          message,
          requestId,
          retryable: status === 503,
          details: null,
        },
      },
      { status, headers },
    );
  const path = parts.join('/');
  const mode = dashboardConfig();
  if (
    dev &&
    (!mode.simulation ||
      (path.endsWith('/confirm') && mode.provider !== 'fake'))
  )
    return error(404, 'NOT_FOUND', 'Endpoint not found.');
  if (parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p)))
    return error(404, 'NOT_FOUND', 'Endpoint not found.');
  const rule = normal.find(
    ([method, pattern]) => method === request.method && pattern.test(path),
  );
  if (dev ? request.method !== 'POST' || !development.test(path) : !rule)
    return error(404, 'NOT_FOUND', 'Endpoint not found.');
  const { api, web } = localOrigins();
  if (
    request.headers.get('host') !== web.host ||
    (request.method === 'POST'
      ? request.headers.get('origin') !== web.origin
      : request.headers.has('origin') &&
        request.headers.get('origin') !== web.origin)
  )
    return error(403, 'FORBIDDEN', 'Local browser origin required.');
  const url = new URL(request.url);
  const allowed: readonly string[] = dev ? [] : rule![2];
  for (const key of url.searchParams.keys())
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1)
      return error(
        400,
        'VALIDATION_ERROR',
        'Unexpected or repeated query parameter.',
      );
  const upstream = new Headers({ 'X-Request-Id': requestId });
  let body: string | undefined;
  if (request.method === 'POST') {
    if (
      !/^application\/json(?:;\s*charset=utf-8)?$/i.test(
        request.headers.get('content-type') ?? '',
      )
    )
      return error(415, 'UNSUPPORTED_MEDIA_TYPE', 'Expected application/json.');
    // Bounded stream read also covers chunked requests without Content-Length.
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    if (reader) {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > 16384) {
          await reader.cancel();
          return error(413, 'PAYLOAD_TOO_LARGE', 'JSON body exceeds 16 KiB.');
        }
        chunks.push(chunk.value);
      }
    }
    body = Buffer.concat(chunks).toString('utf8');
    upstream.set('Content-Type', 'application/json');
    const key = request.headers.get('idempotency-key');
    if (key) upstream.set('Idempotency-Key', key);
  } else if (
    request.headers.has('transfer-encoding') ||
    Number(request.headers.get('content-length') ?? 0) > 0
  )
    return error(400, 'VALIDATION_ERROR', 'Read requests accept no body.');
  if (dev) {
    const token = process.env.SIMULATION_TOKEN ?? '';
    if (!/^[A-Za-z0-9_-]{32,}$/.test(token))
      return error(
        503,
        'PROXY_UNAVAILABLE',
        'Configure the server development environment.',
      );
    upstream.set('Authorization', `Bearer ${token}`);
  }
  try {
    const response = await fetch(new URL(`/api/v1/${path}${url.search}`, api), {
      method: request.method,
      headers: upstream,
      body,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(9500),
    });
    for (const name of ['idempotency-replayed', 'location', 'retry-after']) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    const data: unknown = await response.json();
    if (response.ok && path.endsWith('/confirmation-session')) {
      const id = path.split('/')[1]!;
      if (uuid.test(id))
        headers.set(
          'Set-Cookie',
          `pps-return-payment=${id}; HttpOnly; SameSite=Lax; Path=/payments/return; Max-Age=600`,
        );
    }
    return Response.json(data, { status: response.status, headers });
  } catch {
    return error(
      503,
      'PROXY_UNAVAILABLE',
      'API response is unavailable. Retry the same operation.',
    );
  }
}
