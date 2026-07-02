import { isApprovedHtmlDownloadUrl } from '$lib/import/download-proxy';
import type { RequestHandler } from './$types';

const FORWARDED_HEADERS = [
  'content-type',
  'content-length',
  'content-disposition',
  'etag',
  'last-modified',
  'cache-control',
  'accept-ranges'
];

export const GET: RequestHandler = async ({ url, fetch }) => {
  const targetUrl = url.searchParams.get('url');
  if (!targetUrl) {
    return new Response('Missing url query parameter', { status: 400 });
  }

  if (!isApprovedHtmlDownloadUrl(targetUrl)) {
    return new Response('HTML download URL is not in the approved allowlist', { status: 403 });
  }

  try {
    const upstream = await fetch(targetUrl, {
      redirect: 'follow',
      cache: 'no-store'
    });

    if (!upstream.ok || !upstream.body) {
      return new Response(`Failed to download upstream resource (HTTP ${upstream.status})`, {
        status: upstream.status || 502
      });
    }

    const headers = new Headers();
    for (const header of FORWARDED_HEADERS) {
      const value = upstream.headers.get(header);
      if (value) headers.set(header, value);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers
    });
  } catch {
    return new Response('Failed to download upstream resource', { status: 502 });
  }
};
