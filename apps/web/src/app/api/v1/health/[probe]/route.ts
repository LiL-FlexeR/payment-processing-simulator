import { localOrigins, readHealth } from '@/api/server/health';
import { randomUUID } from 'node:crypto';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ probe: string }> },
) {
  const incoming = request.headers.get('x-request-id');
  const requestId =
    incoming &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      incoming,
    )
      ? incoming
      : randomUUID();
  const headers = { 'Cache-Control': 'no-store', 'X-Request-Id': requestId };
  const { web } = localOrigins();
  if (
    request.headers.get('host') !== web.host ||
    (request.headers.get('origin') &&
      request.headers.get('origin') !== web.origin)
  )
    return Response.json({ error: 'Forbidden' }, { status: 403, headers });
  const { probe } = await context.params;
  if (probe !== 'live' && probe !== 'ready')
    return Response.json({ error: 'Not found' }, { status: 404, headers });
  if (
    new URL(request.url).search ||
    request.headers.get('transfer-encoding') ||
    Number(request.headers.get('content-length') ?? 0) > 0
  )
    return Response.json(
      { error: 'This endpoint accepts no query or body.' },
      { status: 400, headers },
    );
  const result = await readHealth(probe, requestId);
  return Response.json(result.body, { status: result.status, headers });
}
