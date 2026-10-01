/**
 * Legacy (pre-2.0) dictionary enabled flags. Dictionaries are re-imported into the new storage, so
 * these are kept as *pending* preferences and applied to each dictionary's profile entry when a
 * dictionary with the same title is imported (see `profile-migration.ts`).
 */
export interface DictionaryPreference {
  title: string;
  enabled: boolean;
}

interface DictionaryPreferencesStore {
  version: 1;
  dictionaries: DictionaryPreference[];
}

const STORAGE_KEY = 'yomitanDictionaryPreferences';

function isBrowser() {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

export function loadDictionaryPreferences(): DictionaryPreference[] {
  if (!isBrowser()) return [];

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as Partial<DictionaryPreferencesStore>;
    if (!Array.isArray(parsed.dictionaries)) return [];

    return parsed.dictionaries
      .filter(
        (item): item is DictionaryPreference =>
          !!item && typeof item.title === 'string' && typeof item.enabled === 'boolean'
      )
      .map((item) => ({ title: item.title, enabled: item.enabled }));
  } catch (error) {
    console.error('Failed to parse Yomitan dictionary preferences:', error);
    return [];
  }
}

export function saveDictionaryPreferences(preferences: DictionaryPreference[]): void {
  if (!isBrowser()) return;

  const store: DictionaryPreferencesStore = {
    version: 1,
    dictionaries: preferences.map((item) => ({ title: item.title, enabled: item.enabled }))
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}
