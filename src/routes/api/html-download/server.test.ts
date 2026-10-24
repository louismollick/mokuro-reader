import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

type Event = Parameters<typeof GET>[0];

/** Calls the proxy for `target` with a fake server fetch answering `response`. */
async function proxy(target: string, response: Response) {
  const fetch = vi.fn(async () => response);
  const url = new URL(`http://localhost/api/html-download?url=${encodeURIComponent(target)}`);
  const result = await GET({ url, fetch } as unknown as Event);
  return { result, fetch };
}

describe('/api/html-download', () => {
  it('asks upstream for an uncompressed body and forwards its length', async () => {
    const { result, fetch } = await proxy(
      'https://mokuro.moe/catalog/api/manifest?series=A&volume=B',
      new Response('{"ok":true}', {
        headers: { 'content-type': 'application/json', 'content-length': '11' }
      })
    );
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toEqual({ 'accept-encoding': 'identity' });
    expect(result.headers.get('content-length')).toBe('11');
    expect(await result.text()).toBe('{"ok":true}');
  });

  it('drops the length of a body upstream still compressed', async () => {
    const { result } = await proxy(
      'https://mokuro.moe/a.mokuro',
      new Response('decoded body', {
        headers: { 'content-encoding': 'gzip', 'content-length': '5' }
      })
    );
    expect(result.headers.get('content-length')).toBeNull();
  });

  it('refuses hosts outside the allowlist', async () => {
    const { result, fetch } = await proxy('https://example.com/x', new Response('x'));
    expect(result.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
});
