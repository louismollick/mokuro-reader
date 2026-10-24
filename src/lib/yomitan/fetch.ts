/**
 * The fetch the Yomitan engine uses for dictionary URLs, update checks and audio sources. It runs
 * inside the engine worker, so it must not import anything that needs the page (stores, DOM).
 */
import type { createYomitan } from 'yomitan-core';
import {
  ALLOWED_RECOMMENDED_DICTIONARY_URLS,
  buildRecommendedDictionaryProxyUrl
} from './recommended-dictionaries';

type YomitanFetch = NonNullable<Parameters<typeof createYomitan>[0]['fetch']>;

async function fetchWithRetry(url: string, init: object | undefined, attempts = 3) {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        ...init,
        cache: 'no-store',
        redirect: 'follow'
      });
      if (response.ok) {
        return response;
      }

      if (response.status >= 500 && attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
        continue;
      }

      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
        continue;
      }
    }
  }

  throw lastError ?? new Error('Failed to fetch dictionary URL');
}

/** Approved recommended dictionaries go through mokuro's proxy (GitHub has no CORS headers). */
export const yomitanFetch: YomitanFetch = (input, init) => {
  if (ALLOWED_RECOMMENDED_DICTIONARY_URLS.has(input)) {
    return fetchWithRetry(buildRecommendedDictionaryProxyUrl(input), init);
  }
  return fetch(input, init as RequestInit);
};
