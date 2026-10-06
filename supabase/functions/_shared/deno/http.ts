import { fnLog } from '../logger.ts';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

/** Wrap a handler: CORS preflight, JSON errors without internals or PHI. */
export function serveHandler(name: string, handler: (req: Request) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const started = Date.now();
    try {
      const res = await handler(req);
      fnLog.info('fn.done', { fn: name, status: res.status, latencyMs: Date.now() - started });
      return res;
    } catch (e) {
      if (e instanceof HttpError) {
        fnLog.warn('fn.rejected', { fn: name, status: e.status, code: e.code });
        return json({ error: e.code }, e.status);
      }
      fnLog.error('fn.failed', { fn: name, latencyMs: Date.now() - started });
      return json({ error: 'internal_error' }, 500);
    }
  });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
