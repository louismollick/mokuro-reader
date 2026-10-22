import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ apiKey: undefined as string | undefined }));
vi.mock('$lib/settings', () => ({
  DEFAULT_MODEL_CONFIGS: {},
  settings: {
    subscribe: (run: (value: unknown) => void) => {
      run({ ankiConnectSettings: { url: 'https://anki.example.com/api', apiKey: state.apiKey } });
      return () => {};
    }
  }
}));
vi.mock('$lib/util', () => ({ showSnackbar: vi.fn() }));
vi.mock('$lib/util/platform', () => ({ isMobilePlatform: () => false }));
vi.mock('./cropper', () => ({}));

import { getDeckNames, testConnection } from './index';

describe('AnkiConnect authentication', () => {
  beforeEach(() => {
    state.apiKey = 'private-test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        return {
          json: async () => ({ result: body.action === 'version' ? 6 : ['Default'], error: null })
        };
      })
    );
  });

  it('authenticates connection tests and collection requests with the current key', async () => {
    await expect(testConnection()).resolves.toMatchObject({ success: true });
    state.apiKey = 'rotated-test-key';
    await expect(getDeckNames()).resolves.toEqual(['Default']);
    const bodies = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies).toEqual([
      { action: 'version', params: {}, version: 6, key: 'private-test-key' },
      { action: 'deckNames', params: {}, version: 6, key: 'rotated-test-key' }
    ]);
  });

  it('supports existing profiles connected to local servers without keys', async () => {
    state.apiKey = undefined;
    await expect(testConnection()).resolves.toMatchObject({ success: true });
    const init = vi.mocked(fetch).mock.calls[0][1];
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('key');
  });
});
