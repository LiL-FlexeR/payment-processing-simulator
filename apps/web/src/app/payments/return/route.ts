export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  // Correlate through an HttpOnly local ID, never through a URL outcome/secret.
  const id = /(?:^|;\s*)pps-return-payment=([a-f0-9-]{36})(?:;|$)/i.exec(
    request.headers.get('cookie') ?? '',
  )?.[1];
  const target = id ? `/payments/${id}?returned=1` : '/payments';
  return new Response(null, {
    status: 303,
    headers: {
      Location: target,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Set-Cookie':
        'pps-return-payment=; HttpOnly; SameSite=Lax; Path=/payments/return; Max-Age=0',
    },
  });
}
