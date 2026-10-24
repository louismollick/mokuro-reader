/**
 * The yomitan-core client singleton: lazy, browser-only. Dictionaries live in IndexedDB
 * (`mokuro-reader-yomitan-v2`); the profile (dictionary order and flags, Anki card format, theme)
 * is persisted to localStorage after every change and restored on startup.
 */
import { get } from 'svelte/store';
import { createYomitan, type ProfileOptions, type Yomitan } from 'yomitan-core';
import { createBrowserImageInfoReader, createIndexedDbStorage } from '@yomitan-core/web';
import { settings } from '$lib/settings';
import { showSnackbar } from '$lib/util/snackbar';
import { applyPendingDictionaryPreferences } from './profile-migration';
import {
  loadDictionaryPreferences,
  saveDictionaryPreferences,
  type DictionaryPreference
} from './preferences';
import { loadStoredProfile, saveStoredProfile } from './profile-store';
import {
  ALLOWED_RECOMMENDED_DICTIONARY_URLS,
  buildRecommendedDictionaryProxyUrl
} from './recommended-dictionaries';

const DATABASE_NAME = 'mokuro-reader-yomitan-v2';
/** The Dexie database written by yomitan-core 1.x. Its layout is incompatible with the new storage. */
const LEGACY_DATABASE_NAME = 'mokuro-reader-yomitan';

type YomitanFetch = NonNullable<Parameters<typeof createYomitan>[0]['fetch']>;

let clientPromise: Promise<Yomitan> | null = null;

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

async function createClient(): Promise<Yomitan> {
  const stored = loadStoredProfile();
  const client = await createYomitan({
    storage: createIndexedDbStorage({ name: DATABASE_NAME }),
    imageInfoReader: createBrowserImageInfoReader(),
    fetch: yomitanFetch,
    profile: stored
  });

  if (stored === undefined) {
    // The drawer has always been dark; the theme is otherwise profile-driven.
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
    return queueEdit(
      () => client,
      (options) => {
        options.anki.enable = enabled;
      }
    );
  };

  await apply(get(settings).ankiConnectSettings.enabled);
  stopMirroringAnki?.();
  stopMirroringAnki = settings.subscribe(({ ankiConnectSettings }) => {
    void apply(ankiConnectSettings.enabled).catch((error) =>
      console.error('Failed to mirror the AnkiConnect toggle into the Yomitan profile:', error)
    );
  });
}

/** Applies legacy enabled flags to re-imported dictionaries, through the edit queue. */
async function applyPendingPreferences(client: Yomitan) {
  if (loadDictionaryPreferences().length === 0) return;
  let remaining = null as DictionaryPreference[] | null;
  await queueEdit(
    () => client,
    (options) => {
      remaining = applyPendingDictionaryPreferences(
        options.dictionaries,
        loadDictionaryPreferences()
      ).pending;
    }
  );
  // Consumed only once the profile holding the flags is saved.
  if (remaining !== null) saveDictionaryPreferences(remaining);
}

/**
 * Serializes profile edits: each one reads the latest profile, edits it and saves it inside a
 * shared chain, so concurrent edits never overwrite each other.
 */
export function editProfile(edit: (options: ProfileOptions) => void): Promise<void> {
  return queueEdit(getYomitan, edit);
}

function queueEdit(
  getClient: () => Yomitan | Promise<Yomitan>,
  edit: (options: ProfileOptions) => void
): Promise<void> {
  const run = editQueue.then(async () => {
    const yomitan = await getClient();
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
  });
}
