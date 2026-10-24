import { describe, expect, it } from 'vitest';
import { buildHtmlDownloadProxyUrl, isApprovedHtmlDownloadUrl } from './download-proxy';

describe('isApprovedHtmlDownloadUrl', () => {
  it('approves http(s) URLs on the allowlisted hosts only', () => {
    expect(isApprovedHtmlDownloadUrl('https://mokuro.moe/manga/a/b.cbz')).toBe(true);
    expect(isApprovedHtmlDownloadUrl('http://reader.mokuro.app/x')).toBe(true);
    expect(isApprovedHtmlDownloadUrl('https://evil.example/mokuro.moe')).toBe(false);
    expect(isApprovedHtmlDownloadUrl('https://mokuro.moe.evil.example/x')).toBe(false);
    expect(isApprovedHtmlDownloadUrl('ftp://mokuro.moe/x')).toBe(false);
    expect(isApprovedHtmlDownloadUrl('not a url')).toBe(false);
  });
});

describe('buildHtmlDownloadProxyUrl', () => {
  it('routes approved cross-origin URLs through the same-origin proxy, encoded', () => {
    const url = 'https://mokuro.moe/manga/Dr Stone/Dr Stone 01.cbz?token=a&b=c';
    const proxied = buildHtmlDownloadProxyUrl(url);
    expect(proxied.startsWith('/api/html-download?url=')).toBe(true);
    const target = new URL(proxied, window.location.href).searchParams.get('url');
    expect(target).toBe(new URL(url).toString());
  });

  it('leaves same-origin and non-approved URLs direct', () => {
    const sameOrigin = `${window.location.origin}/some/file.cbz`;
    expect(buildHtmlDownloadProxyUrl(sameOrigin)).toBe(sameOrigin);
    expect(buildHtmlDownloadProxyUrl('https://bunko.example/a.cbz')).toBe(
      'https://bunko.example/a.cbz'
    );
  });
});
