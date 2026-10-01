import { beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  profile: { options: { tags: [] as string[], anki: { enable: false } } }
}));

vi.mock('yomitan-core', () => ({
  createYomitan: async () => ({
    profile: {
      get: () => structuredClone(state.profile),
      set: async (next: typeof state.profile) => {
        // Yield so an unserialized concurrent edit would interleave here.
        await new Promise((resolve) => setTimeout(resolve, 5));
        state.profile = structuredClone(next);
      },
      importYomitanSettings: async () => {},
      syncDictionaries: async () => {}
    },
    dictionaries: { import: vi.fn(), delete: vi.fn(), update: vi.fn() },
    dispose: async () => {}
  })
}));
vi.mock('@yomitan-core/web', () => ({
  createIndexedDbStorage: () => ({}),
  createBrowserImageInfoReader: () => ({})
}));
vi.mock('$lib/settings', () => ({
  settings: {
    subscribe: (run: (value: unknown) => void) => {
      run({ ankiConnectSettings: { enabled: true } });
      return () => {};
    }
  }
}));
vi.mock('$lib/util/snackbar', () => ({ showSnackbar: vi.fn() }));
vi.mock('./profile-migration', () => ({
  applyLegacySettingsToProfile: (profile: unknown) => profile,
  applyPendingDictionaryPreferences: (_p: unknown, pending: unknown[]) => ({
    pending,
    changed: false
  })
}));

import { editProfile, getYomitan } from './client';

describe('editProfile', () => {
  beforeAll(() => {
    vi.stubGlobal('indexedDB', { databases: async () => [] });
  });

  it('enables popup Anki actions when the mokuro integration is enabled', async () => {
    const client = await getYomitan();
    expect(client.profile.get().options.anki.enable).toBe(true);
  });

  it('serializes concurrent edits so both land', async () => {
    await Promise.all([
      editProfile((options: unknown) => {
        const o = options as { tags: string[] };
        o.tags = [...o.tags, 'a'];
      }),
      editProfile((options: unknown) => {
        const o = options as { tags: string[] };
        o.tags = [...o.tags, 'b'];
      })
    ]);

    expect(state.profile.options.tags).toEqual(['a', 'b']);
  });

  it('keeps the queue alive after a failed edit', async () => {
    await expect(
      editProfile(() => {
        throw new Error('nope');
      })
    ).rejects.toThrow('nope');
    await editProfile((options: unknown) => {
      (options as { tags: string[] }).tags = ['ok'];
    });
    expect(state.profile.options.tags).toEqual(['ok']);
  });
});
