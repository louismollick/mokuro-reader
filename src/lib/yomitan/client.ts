/**
 * The yomitan-core client singleton: lazy, browser-only. Dictionaries live in IndexedDB
 * (`mokuro-reader-yomitan-v2`); the profile (dictionary order and flags, Anki card format, theme)
 * is persisted to localStorage after every change and restored on startup.
 */
import { get } from 'svelte/store';
import { createYomitan, type Yomitan } from 'yomitan-core';
import { createBrowserImageInfoReader, createIndexedDbStorage } from '@yomitan-core/web';
import { settings } from '$lib/settings';
import { showSnackbar } from '$lib/util/snackbar';
import {
  applyLegacySettingsToProfile,
  applyPendingDictionaryPreference
} from './profile-migration';
import { loadDictionaryPreferences, saveDictionaryPreferences } from './preferences';
import {
  loadStoredProfile,
  markLegacySettingsMigrated,
  needsLegacySettingsMigration,
  saveStoredProfile
} from './profile-store';
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
    let existed: boolean | null = null;
    if (typeof indexedDB.databases === 'function') {
      existed = (await indexedDB.databases()).some(({ name }) => name === LEGACY_DATABASE_NAME);
      if (!existed) return;
    }

    await deleteDatabase(LEGACY_DATABASE_NAME);
    if (existed) {
      showSnackbar(
        'Yomitan was upgraded. Please re-import your dictionaries in Settings > Yomitan.',
        10000
      );
    }
  } catch (error) {
    console.error('Failed to remove the legacy Yomitan database:', error);
  }
}

function persistProfile(client: Yomitan) {
  saveStoredProfile(client.profile.get());
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
    const next = client.profile.get();
    const { pending, changed } = applyPendingDictionaryPreference(
      next,
      installed.title,
      loadDictionaryPreferences()
    );
    saveDictionaryPreferences(pending);
    if (changed) {
      await client.profile.set(next);
    } else {
      persistProfile(client);
    }
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

  if (stored === undefined && needsLegacySettingsMigration()) {
    const profile = applyLegacySettingsToProfile(
      client.profile.get(),
      get(settings).ankiConnectSettings
    );
    await client.profile.set(profile);
  }
  markLegacySettingsMigrated();
  await client.profile.syncDictionaries();
  persistProfile(client);
  persistOnChange(client);

  void removeLegacyDatabase();
  return client;
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
    void previous?.then((client) => client.dispose()).catch(() => {});
  });
}
