/**
 * Persistence for the yomitan-core profile (overhaul plan §3.2/§6). The profile is the single
 * source of truth for dictionaries, Anki card formats and popup theme; mokuro persists whatever
 * `profile.get()` returns and hands it back to `createYomitan` on the next load.
 */

const PROFILE_STORAGE_KEY = 'mokuro:yomitanProfile';

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
