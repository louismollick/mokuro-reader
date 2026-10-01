/**
 * Persistence for the yomitan-core profile (overhaul plan §3.2/§6). The profile is the single
 * source of truth for dictionaries, Anki card formats and popup theme; mokuro persists whatever
 * `profile.get()` returns and hands it back to `createYomitan` on the next load.
 */

const PROFILE_STORAGE_KEY = 'mokuro:yomitanProfile';
const LEGACY_MIGRATION_FLAG_KEY = 'mokuro:yomitanProfileMigrated';

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

/** The last profile saved by `saveStoredProfile`, or `undefined` for a fresh install. */
export function loadStoredProfile(): unknown {
  if (!isBrowser()) return undefined;

  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return undefined;
    return JSON.parse(raw);
  } catch (error) {
    console.error('Failed to parse stored Yomitan profile:', error);
    return undefined;
  }
}

export function saveStoredProfile(profile: unknown): void {
  if (!isBrowser()) return;
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
}

/** Whether the one-time conversion from mokuro's legacy Anki/dictionary settings still needs to run. */
export function needsLegacySettingsMigration(): boolean {
  if (!isBrowser()) return false;
  return localStorage.getItem(LEGACY_MIGRATION_FLAG_KEY) !== '1';
}

export function markLegacySettingsMigrated(): void {
  if (!isBrowser()) return;
  localStorage.setItem(LEGACY_MIGRATION_FLAG_KEY, '1');
}
