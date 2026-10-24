import { ALLOWED_RECOMMENDED_DICTIONARY_URLS } from '$lib/yomitan/recommended-dictionaries';
import type { RequestHandler } from './$types';

const FORWARDED_HEADERS = ['content-type', 'content-disposition', 'etag'];

export const GET: RequestHandler = async ({ url, fetch }) => {
  const targetUrl = url.searchParams.get('url');
  if (!targetUrl) {
    return new Response('Missing url query parameter', { status: 400 });
  }

  if (!ALLOWED_RECOMMENDED_DICTIONARY_URLS.has(targetUrl)) {
    return new Response('Dictionary URL is not in the approved allowlist', { status: 403 });
  }

  try {
    // Uncompressed upstream bytes keep content-length honest: the server fetch decodes gzip, and on
    // Vercel it also drops content-encoding, so a compressed length would truncate the body.
    const upstream = await fetch(targetUrl, {
      redirect: 'follow',
      cache: 'no-store',
      headers: { 'accept-encoding': 'identity' }
    });

    if (!upstream.ok || !upstream.body) {
      return new Response(`Failed to download dictionary (HTTP ${upstream.status})`, {
        status: upstream.status || 502
      });
    }

    const headers = new Headers();
    for (const header of FORWARDED_HEADERS) {
      const value = upstream.headers.get(header);
      if (value) headers.set(header, value);
    }
    // A length is only trusted for an uncompressed body (it drives download progress for archives).
    const length = upstream.headers.get('content-length');
    if (length && !upstream.headers.has('content-encoding')) headers.set('content-length', length);

    return new Response(upstream.body, {
      status: 200,
      headers
    });
  } catch {
    return new Response('Failed to download dictionary from upstream source', { status: 502 });
  }
};
