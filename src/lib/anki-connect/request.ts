import { get } from 'svelte/store';
import { settings } from '$lib/settings';

/** Read the current profile's key for each request, including connection tests. */
export function ankiRequestBody(action: string, params: Record<string, unknown> = {}): string {
  const key = get(settings).ankiConnectSettings.apiKey;
  return JSON.stringify({ action, params, version: 6, ...(key ? { key } : {}) });
}
