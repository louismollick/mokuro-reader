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
    dictionaries: preferences.map((item) => ({
      title: item.title,
      enabled: item.enabled
    }))
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function normalizeDictionaryPreferences(
  installedTitles: string[],
  existingPreferences: DictionaryPreference[]
): DictionaryPreference[] {
  const seen = new Set<string>();
  const preferenceMap = new Map(existingPreferences.map((item) => [item.title, item]));

  const normalized: DictionaryPreference[] = [];

  for (const title of installedTitles) {
    if (seen.has(title)) continue;
    seen.add(title);

    const existing = preferenceMap.get(title);
    normalized.push({
      title,
      enabled: existing?.enabled ?? true
    });
  }

  return normalized;
}

export function moveDictionaryPreference(
  preferences: DictionaryPreference[],
  fromIndex: number,
  toIndex: number
): DictionaryPreference[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= preferences.length ||
    toIndex >= preferences.length ||
    fromIndex === toIndex
  ) {
    return preferences;
  }

  const next = [...preferences];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

