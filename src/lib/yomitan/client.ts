/**
 * The yomitan-core client singleton: lazy, browser-only. The engine itself runs in a Web Worker
 * (`engine.worker.ts`) and this is its connected client. Dictionaries live in IndexedDB
 * (`mokuro-reader-yomitan-v2`, opened by the worker); the profile (dictionary order and flags, Anki
 * card format, theme) is persisted to localStorage here after every change and handed to the worker
 * on startup.
 */
import { get } from 'svelte/store';
import type { ProfileOptions, Yomitan } from 'yomitan-core';
import { settings } from '$lib/settings';
import { showSnackbar } from '$lib/util/snackbar';
import { applyPendingDictionaryPreferences } from './profile-migration';
import {
  loadDictionaryPreferences,
  saveDictionaryPreferences,
  type DictionaryPreference
} from './preferences';
import { loadStoredProfile, saveStoredProfile } from './profile-store';
import type { EngineFailure, EngineInit } from './engine-protocol';

/** The Dexie database written by yomitan-core 1.x. Its layout is incompatible with the new storage. */
const LEGACY_DATABASE_NAME = 'mokuro-reader-yomitan';

let clientPromise: Promise<Yomitan> | null = null;
let engineWorker: Worker | null = null;

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/** Deletes the 1.x database, telling the user once (if we can tell it existed) to re-import. */
async function removeLegacyDatabase() {
  try {
    let existed = false;
    if (typeof indexedDB.databases === 'function') {
      existed = (await indexedDB.databases()).some(({ name }) => name === LEGACY_DATABASE_NAME);
      if (!existed) return;
    }

    // Notify before deleting: another tab still on 1.x blocks the deletion until it closes.
    if (existed) {
      showSnackbar(
        'Yomitan was upgraded. Please re-import your dictionaries in Settings > Yomitan.',
        10000
      );
    }
    await deleteDatabase(LEGACY_DATABASE_NAME);
  } catch (error) {
    console.error('Failed to remove the legacy Yomitan database:', error);
  }
}

function persistProfile(client: Yomitan) {
  // A full or blocked localStorage must not make the client unusable; the profile stays in memory.
  try {
    saveStoredProfile(client.profile.get());
  } catch (error) {
    console.error('Failed to save the Yomitan profile:', error);
  }
}

/** Persist the profile after every change made through the client. */
function persistOnChange(client: Yomitan) {
  const { profile, dictionaries } = client;

  const wrapProfile = (key: 'set' | 'importYomitanSettings' | 'syncDictionaries') => {
    const original = profile[key] as (...args: unknown[]) => Promise<unknown>;
    (profile as unknown as Record<string, unknown>)[key] = async (...args: unknown[]) => {
      const result = await original(...args);
      persistProfile(client);
      return result;
    };
  };
  wrapProfile('set');
  wrapProfile('importYomitanSettings');
  wrapProfile('syncDictionaries');

  const originalImport = dictionaries.import;
  dictionaries.import = async (options) => {
    const installed = await originalImport(options);

    // A re-imported dictionary keeps the enabled flag it had before the upgrade.
    await applyPendingPreferences(client);
    await ensureMainDictionary(client);
    return installed;
  };

  for (const key of ['delete', 'update'] as const) {
    const original = dictionaries[key] as (...args: unknown[]) => Promise<unknown>;
    (dictionaries as unknown as Record<string, unknown>)[key] = async (...args: unknown[]) => {
      const result = await original(...args);
      persistProfile(client);
      return result;
    };
  }
}

/** Starts the engine worker and connects to it; rejects if the worker can't boot. */
async function connectEngine(profile: unknown): Promise<Yomitan> {
  const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), {
    type: 'module',
    name: 'yomitan'
  });
  const { port1, port2 } = new MessageChannel();
  const failed = new Promise<never>((_, reject) => {
    worker.addEventListener('error', (event) => reject(new Error(event.message)));
    worker.addEventListener('message', (event: MessageEvent<EngineFailure>) =>
      reject(new Error(event.data.error))
    );
  });
  const init: EngineInit = { profile, port: port2 };
  worker.postMessage(init, [port2]);

  try {
    // Loaded here, not at the top: the library is large and Settings (and so the reader's chunk)
    // imports this file just to reach the client.
    const { connectYomitan } = await import('@yomitan-core/web');
    const client = await Promise.race([connectYomitan(port1), failed]);
    engineWorker = worker;
    return client;
  } catch (error) {
    worker.terminate();
    throw error;
  }
}

async function createClient(): Promise<Yomitan> {
  const stored = loadStoredProfile();
  const client = await connectEngine(stored);

  if (stored === undefined) {
    // The reader has always been dark; the theme is otherwise profile-driven.
    const profile = client.profile.get();
    profile.options.general.popupTheme = 'dark';
    await client.profile.set(profile);
  }
  await client.profile.syncDictionaries();
  persistProfile(client);
  persistOnChange(client);
  await mirrorAnkiEnabled(client);
  // Flags a lost race left pending are applied on the next start.
  await applyPendingPreferences(client);
  await ensureMainDictionary(client);

  void removeLegacyDatabase();
  return client;
}

let editQueue: Promise<unknown> = Promise.resolve();
let stopMirroringAnki: (() => void) | null = null;

/**
 * Keeps the profile's `anki.enable` equal to mokuro's AnkiConnect toggle (`ankiConnectSettings`
 * owns the connection). yomitan-core's display reads it to show its Add to Anki buttons; the
 * server URL and API key reach the AnkiConnect transport directly, so they are not mirrored.
 */
async function mirrorAnkiEnabled(client: Yomitan) {
  let mirrored: boolean | undefined;
  const apply = (enabled: boolean) => {
    if (enabled === mirrored) return Promise.resolve();
    mirrored = enabled;
    return queueEdit(client, (options) => {
      options.anki.enable = enabled;
    });
  };

  await apply(get(settings).ankiConnectSettings.enabled);
  stopMirroringAnki?.();
  stopMirroringAnki = settings.subscribe(({ ankiConnectSettings }) => {
    void apply(ankiConnectSettings.enabled).catch((error) =>
      console.error('Failed to mirror the AnkiConnect toggle into the Yomitan profile:', error)
    );
  });
}

/**
 * Merged results (one entry per word with all its spellings and readings, which the Word View
 * shows) need a main dictionary. When none is usable, the first enabled term dictionary becomes it.
 */
async function ensureMainDictionary(client: Yomitan) {
  const { dictionaries, general } = client.profile.get().options;
  const enabled = dictionaries.filter(({ enabled }) => enabled).map(({ name }) => name);
  if (enabled.includes(general.mainDictionary)) return;

  const installed = await client.dictionaries.list();
  const main = enabled.find(
    (name) => installed.find(({ title }) => title === name)?.counts?.terms.total
  );
  if (main) {
    await queueEdit(client, (options) => {
      options.general.mainDictionary = main;
    });
  }
}

/** Applies legacy enabled flags to re-imported dictionaries, through the edit queue. */
async function applyPendingPreferences(client: Yomitan) {
  if (loadDictionaryPreferences().length === 0) return;
  let remaining = null as DictionaryPreference[] | null;
  await queueEdit(client, (options) => {
    remaining = applyPendingDictionaryPreferences(
      options.dictionaries,
      loadDictionaryPreferences()
    ).pending;
  });
  // Consumed only once the profile holding the flags is saved.
  if (remaining !== null) saveDictionaryPreferences(remaining);
}

/**
 * Serializes profile edits: each one reads the latest profile, edits it and saves it inside a
 * shared chain, so concurrent edits never overwrite each other.
 */
export async function editProfile(edit: (options: ProfileOptions) => void): Promise<void> {
  // Resolve the client BEFORE queueing: init itself queues edits, so a queued op that waited on
  // init would deadlock with them.
  return queueEdit(await getYomitan(), edit);
}

function queueEdit(yomitan: Yomitan, edit: (options: ProfileOptions) => void): Promise<void> {
  const run = editQueue.then(async () => {
    const profile = yomitan.profile.get();
    edit(profile.options);
    await yomitan.profile.set(profile);
  });
  editQueue = run.catch(() => {});
  return run;
}

/** The shared client. Browser only; the first call opens the database and restores the profile. */
export function getYomitan(): Promise<Yomitan> {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('Yomitan is only available in the browser'));
  }

  clientPromise ??= createClient().catch((error) => {
    clientPromise = null;
    throw error;
  });
  return clientPromise;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    const previous = clientPromise;
    clientPromise = null;
    stopMirroringAnki?.();
    stopMirroringAnki = null;
    void previous?.then((client) => client.dispose()).catch(() => {});
    engineWorker?.terminate();
    engineWorker = null;
  });
}
