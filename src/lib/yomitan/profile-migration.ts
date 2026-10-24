/**
 * Dictionary enabled flags from mokuro's pre-2.0 Yomitan setup cannot be converted up front:
 * dictionaries are re-imported into the new storage, so the legacy flags stay around as pending
 * preferences (`preferences.ts`) and are applied to each dictionary's profile entry as it is
 * imported (`applyPendingDictionaryPreferences`).
 */
import type { DictionaryOptions } from 'yomitan-core';
import type { DictionaryPreference } from './preferences';

/**
 * Applies pending legacy enabled flags to the dictionaries now in the profile. A flag is consumed
 * only once its dictionary's entry exists (so a later delete-and-reimport doesn't override what the
 * user chose since); flags for dictionaries not re-imported yet stay pending.
 */
export function applyPendingDictionaryPreferences(
  dictionaries: DictionaryOptions[],
  pending: DictionaryPreference[]
): { pending: DictionaryPreference[]; changed: boolean } {
  let changed = false;
  const remaining = pending.filter((preference) => {
    const entry = dictionaries.find(({ name }) => name === preference.title);
    if (!entry) return true;
    changed ||= entry.enabled !== preference.enabled;
    entry.enabled = preference.enabled;
    return false;
  });
  return { pending: remaining.length === pending.length ? pending : remaining, changed };
}
