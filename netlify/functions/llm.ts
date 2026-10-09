/**
 * Optional proxy for providers that refuse calls from a browser.
 *
 * Some inference APIs (NVIDIA NIM among them) send no CORS headers, so a page
 * cannot call them directly however correct the request is. Pointing Scrabbler's
 * "API base URL" at /.netlify/functions/llm routes through here instead: the
 * request is same-origin, so CORS never applies, and the key lives in Netlify's
 * environment rather than on the device.
 *
 * Set two environment variables in Netlify (Site configuration → Environment
 * variables):
 *   LLM_BASE_URL  e.g. https://integrate.api.nvidia.com/v1
 *   LLM_API_KEY   your provider key
 *
 * Only /chat/completions and /models are forwarded. Streaming passes straight
 * through, so answers still appear word by word.
 */

const ALLOWED = ['/chat/completions', '/models'];

export default async (req: Request): Promise<Response> => {
  const base = process.env.LLM_BASE_URL?.replace(/\/$/, '');
  const key = process.env.LLM_API_KEY;
  if (!base || !key) {
    return json({ error: { message: 'Proxy is not configured: set LLM_BASE_URL and LLM_API_KEY in Netlify.' } }, 500);
  }

  // Everything after the function name is the upstream path.
  const path = new URL(req.url).pathname.replace(/^.*\/functions\/llm/, '') || '/models';
  if (!ALLOWED.includes(path)) return json({ error: { message: `Path not allowed: ${path}` } }, 404);

  let upstream: Response;
  try {
    upstream = await fetch(`${base}${path}`, {
      method: req.method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(req.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: req.method === 'POST' ? await req.text() : undefined,
    });
  } catch (e) {
    return json({ error: { message: `Could not reach the provider: ${(e as Error).message}` } }, 502);
  }

  // Pass the body through untouched so server-sent events keep streaming.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
      'Cache-Control': 'no-store',
    },
  });
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
