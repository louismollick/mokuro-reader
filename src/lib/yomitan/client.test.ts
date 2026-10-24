import { beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  profile: {
    options: {
      tags: [] as string[],
      general: { popupTheme: 'light', mainDictionary: '' },
      dictionaries: [
        { name: 'Jiten (Manga)', enabled: true },
        { name: 'JMdict', enabled: true },
        { name: 'Off', enabled: false }
      ],
      anki: { enable: false }
    }
  }
}));

// The engine runs in a worker; the test connects straight to an in-memory client instead.
vi.mock('@yomitan-core/web', () => ({
  connectYomitan: async () => ({
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
    dictionaries: {
      import: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
      list: async () => [
        { title: 'Jiten (Manga)', counts: { terms: { total: 0 } } },
        { title: 'JMdict', counts: { terms: { total: 5 } } },
        { title: 'Off', counts: { terms: { total: 9 } } }
      ]
    },
    dispose: async () => {}
  })
}));
const settingsStore = await vi.hoisted(async () => {
  const { writable } = await import('svelte/store');
  return writable({ ankiConnectSettings: { enabled: true } });
});
vi.mock('$lib/settings', () => ({ settings: settingsStore }));
vi.mock('$lib/util/snackbar', () => ({ showSnackbar: vi.fn() }));
vi.mock('./profile-migration', () => ({
  applyPendingDictionaryPreferences: (_p: unknown, pending: unknown[]) => ({
    pending,
    changed: false
  })
}));

import { editProfile, getYomitan } from './client';

describe('editProfile', () => {
  beforeAll(() => {
    vi.stubGlobal('indexedDB', { databases: async () => [] });
    vi.stubGlobal(
      'Worker',
      class {
        addEventListener() {}
        postMessage() {}
        terminate() {}
      }
    );
    vi.stubGlobal(
      'MessageChannel',
      class {
        port1 = {};
        port2 = {};
      }
    );
  });

  it('enables popup Anki actions when the mokuro integration is enabled', async () => {
    const client = await getYomitan();
    expect(client.profile.get().options.anki.enable).toBe(true);
  });

  it('mirrors later changes of the AnkiConnect toggle into the profile', async () => {
    await getYomitan();
    settingsStore.set({ ankiConnectSettings: { enabled: false } });
    await vi.waitFor(() => expect(state.profile.options.anki.enable).toBe(false));
  });

  it('makes the first enabled term dictionary the main one, for merged lookups', async () => {
    await getYomitan();
    expect(state.profile.options.general.mainDictionary).toBe('JMdict');
  });

  it('starts a fresh profile on the dark popup theme', async () => {
    const client = await getYomitan();
    expect(client.profile.get().options.general.popupTheme).toBe('dark');
  });

  it('settles an edit made before the client finished initializing', async () => {
    vi.resetModules();
    const fresh = await import('./client');
    // No getYomitan() first: init queues its own edits, so this must not wait on them.
    await expect(
      Promise.race([
        fresh.editProfile(() => {}),
        new Promise((_, reject) => setTimeout(() => reject(new Error('deadlock')), 1000))
      ])
    ).resolves.toBeUndefined();
    await fresh.getYomitan();
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
