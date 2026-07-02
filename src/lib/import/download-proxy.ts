const APPROVED_HTML_DOWNLOAD_HOSTNAMES = new Set(['mokuro.moe', 'reader.mokuro.app']);

export function isApprovedHtmlDownloadUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      APPROVED_HTML_DOWNLOAD_HOSTNAMES.has(parsed.hostname)
    );
  } catch {
    return false;
  }
}

export function buildHtmlDownloadProxyUrl(url: string): string {
  if (typeof window === 'undefined') {
    return url;
  }

  let parsed: URL;
  try {
    parsed = new URL(url, window.location.href);
  } catch {
    return url;
  }

  if (parsed.origin === window.location.origin) {
    return parsed.toString();
  }

  if (!isApprovedHtmlDownloadUrl(parsed.toString())) {
    return parsed.toString();
  }

  return `/api/html-download?url=${encodeURIComponent(parsed.toString())}`;
}
