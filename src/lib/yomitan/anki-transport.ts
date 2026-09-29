/**
 * Mokuro's `AnkiTransport` for the yomitan-core display controller (overhaul plan §6). It wraps
 * mokuro's existing AnkiConnect setup (URL setting, CORS permission retry) with yomitan-core's own
 * `createAnkiConnectTransport`, which implements Yomitan's exact duplicate-detection and
 * note-building AnkiConnect calls. Wiring mokuro's own `fetch` in means URL changes, CORS retries and
 * self-signed setups keep working exactly as they do for mokuro's other Anki features.
 *
 * `addNote` first creates the note's deck and sanitizes tags. Capabilities are trimmed for
 * AnkiConnect Android (`isAndroidMode`), which does not implement `canAddNotesWithErrorDetail`,
 * `notesInfo` or `guiBrowseNotes`.
 */
import { get } from 'svelte/store';
import type { AnkiTransport } from 'yomitan-core';
import { createAnkiConnectTransport } from 'yomitan-core';
import { ankiConnect, isAndroidMode } from '$lib/anki-connect';
import { settings } from '$lib/settings';

const DEFAULT_URL = 'http://127.0.0.1:8765';

async function requestAnkiPermission(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ action: 'requestPermission', version: 6 })
    });
    const json = (await res.json()) as { result?: { permission?: string } };
    return json.result?.permission === 'granted';
  } catch {
    return false;
  }
}

/** `fetch`, but retried once through AnkiConnect's permission popup on a CORS failure. */
function createMokuroFetch(url: string): typeof fetch {
  return async (input, init) => {
    try {
      return await fetch(input, init);
    } catch (error) {
      const isCorsFailure = error instanceof TypeError && /failed to fetch/i.test(error.message);
      if (!isCorsFailure || !(await requestAnkiPermission(url))) {
        throw error;
      }
      return await fetch(input, init);
    }
  };
}

/** Anki tags cannot contain spaces (the old `resolveDynamicTags` replaced them the same way). */
function sanitizeTags(tags: string[]): string[] {
  return tags.map((tag) => tag.trim().replace(/\s+/g, '_')).filter((tag) => tag.length > 0);
}

/**
 * Builds mokuro's AnkiTransport for the current AnkiConnect URL and mode. Call it fresh whenever
 * the URL setting or Android override changes; it is cheap (no connection is opened eagerly).
 */
export function createMokuroAnkiTransport(): AnkiTransport {
  const url = get(settings).ankiConnectSettings.url || DEFAULT_URL;
  const base = createAnkiConnectTransport({
    server: url,
    fetch: createMokuroFetch(url) as never
  });

  const transport: AnkiTransport = {
    // Decks like `Mining::{series}` may not exist yet, so create the deck first (a no-op when it
    // exists; unsupported on AnkiConnect Android, where the failure is ignored).
    async addNote(note) {
      if (note.deckName) {
        await ankiConnect('createDeck', { deck: note.deckName }, { silent: true });
      }
      return await base.addNote({ ...note, tags: sanitizeTags(note.tags ?? []) });
    },
    updateNoteFields: (note) => base.updateNoteFields(note),
    canAddNotes: (notes) => base.canAddNotes(notes),
    findNoteIds: (notes) => base.findNoteIds(notes)
  };

  // AnkiConnect Android lacks these actions; leave them out so the display controller degrades the
  // way Yomitan does (duplicate check falls back to `canAddNotes`, "view note" disappears).
  if (!isAndroidMode()) {
    transport.canAddNotesWithErrorDetail = base.canAddNotesWithErrorDetail;
    transport.notesInfo = base.notesInfo;
    transport.guiBrowseNotes = base.guiBrowseNotes;
  }
  return transport;
}
