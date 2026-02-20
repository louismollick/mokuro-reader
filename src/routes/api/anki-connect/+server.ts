import type { RequestHandler } from './$types';

function isAllowedProtocol(protocol: string): boolean {
  return protocol === 'http:' || protocol === 'https:';
}

export const POST: RequestHandler = async ({ url, request, fetch }) => {
  const targetUrl = url.searchParams.get('target');
  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'Missing target query parameter', result: null }), {
      status: 400,
      headers: { 'content-type': 'application/json' }
    });
  }

  let parsedTarget: URL;
  try {
    parsedTarget = new URL(targetUrl);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid target URL', result: null }), {
      status: 400,
      headers: { 'content-type': 'application/json' }
    });
  }

  if (!isAllowedProtocol(parsedTarget.protocol)) {
    return new Response(JSON.stringify({ error: 'Unsupported target protocol', result: null }), {
      status: 400,
      headers: { 'content-type': 'application/json' }
    });
  }

  const body = await request.text();

  try {
    const upstream = await fetch(parsedTarget.toString(), {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json'
      }
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'application/json'
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: `Proxy request failed: ${message}`, result: null }),
      {
        status: 502,
        headers: { 'content-type': 'application/json' }
      }
    );
  }
};
