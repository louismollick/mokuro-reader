/**
 * One-time conversion of mokuro's pre-2.0 Yomitan popup settings into a yomitan-core profile
 * (overhaul plan §6): `popupDeckName`, `popupModelName`, `popupFieldMappings`, `tags`,
 * and `popupDuplicateBehavior` move into `profile.options.anki.cardFormats[0]`,
 * `profile.options.anki.tags` and `profile.options.anki.duplicateBehavior`. Runs once (see
 * `needsLegacySettingsMigration`), then mokuro's settings screens edit the profile directly.
 *
 * Dictionary enabled flags cannot be converted up front: dictionaries are re-imported into the new
 * storage, so the legacy flags stay around as pending preferences and are applied to each
 * dictionary's profile entry as it is imported (`applyPendingDictionaryPreferences`).
 */
import type { AnkiConnectSettings } from '$lib/settings/settings';
import type { Profile } from 'yomitan-core';
import type { DictionaryPreference } from './preferences';

/** Popup fields mokuro never mapped (see the old `POPUP_FIELDS_TO_SKIP` in anki-note.ts). */
const SKIPPED_POPUP_FIELDS = new Set(['maindefinition']);

/**
 * Applies the legacy AnkiConnect popup settings onto a profile, mutating and returning it. Call
 * once, before the profile is first persisted.
 */
export function applyLegacySettingsToProfile(
  profile: Profile,
  ankiSettings: AnkiConnectSettings
): Profile {
  const options = profile.options;

  // The drawer has always been dark; the theme is otherwise profile-driven now.
  options.general.popupTheme = 'dark';

  // Popup Anki settings -> anki.cardFormats[0].
  const fields: Record<string, { value: string; overwriteMode: 'coalesce' }> = {};
  for (const [rawField, rawValue] of Object.entries(ankiSettings.popupFieldMappings ?? {})) {
    const field = rawField.trim();
    const value = rawValue.trim();
    if (!field || !value || SKIPPED_POPUP_FIELDS.has(field.toLowerCase())) {
      continue;
    }
    fields[field] = { value, overwriteMode: 'coalesce' };
  }

  if (Object.keys(fields).length > 0 && ankiSettings.popupModelName?.trim()) {
    options.anki.cardFormats = [
      {
        type: 'term',
        name: ankiSettings.popupModelName,
        deck: ankiSettings.popupDeckName?.trim() || 'Default',
        model: ankiSettings.popupModelName,
        fields,
        icon: 'big-circle'
      }
    ];
  }

  options.anki.tags = (ankiSettings.tags ?? '')
    .split(/\s+/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);

  // `popupDuplicateBehavior` was declared but ignored pre-2.0, and its type only ever allowed
  // 'new'. Carry it forward so the setting now actually takes effect (profile default is also
  // 'new', so this is a no-op today but keeps the mapping explicit and forward-compatible).
  options.anki.duplicateBehavior = ankiSettings.popupDuplicateBehavior ?? 'new';

  return profile;
}

/**
 * Applies pending legacy enabled flags to the dictionaries now in the profile. A flag is consumed
 * only once its dictionary's entry exists (so a later delete-and-reimport doesn't override what the
 * user chose since); flags for dictionaries not re-imported yet stay pending.
 */
export function applyPendingDictionaryPreferences(
  profile: Profile,
  pending: DictionaryPreference[]
): { pending: DictionaryPreference[]; changed: boolean } {
  let changed = false;
  const remaining = pending.filter((preference) => {
    const entry = profile.options.dictionaries.find(({ name }) => name === preference.title);
    if (!entry) return true;
    changed ||= entry.enabled !== preference.enabled;
    entry.enabled = preference.enabled;
    return false;
  });
  return { pending: remaining.length === pending.length ? pending : remaining, changed };
}
