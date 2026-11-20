import { proxy } from '@/api/server/proxy';
export const dynamic = 'force-dynamic';
export async function POST(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  return proxy(
    request,
    ['dev', 'simulations', ...(await context.params).path],
    true,
  );
}
