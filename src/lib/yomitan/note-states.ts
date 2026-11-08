import { headwordKey } from './entry-data';
import type { AnkiNoteContext, DisplayController, TermDictionaryEntry } from 'yomitan-core';

export interface NoteTarget {
  /** The card format the add button saves with. */
  cardFormatIndex: number;
  /**
   * Anki already has a note for it. Whatever the profile's duplicate behavior: Yomitan's default
   * (`new`) still allows another, but the word is known, which is what the button shows.
   */
  inAnki: boolean;
  /** Why the add button is off, or null. */
  disabled: string | null;
}

/** How long a failed Anki check stands before the headword is asked about again. */
const RETRY_AFTER_MS = 10_000;

/**
 * What the Anki button shows per headword, asked of Anki once per Lookup Sheet session:
 * `getNoteStates` costs a duplicate check round trip, and the same headword shows up again as
 * the user switches Words.
 */
export class NoteStates {
  private cache = new Map<string, Promise<NoteTarget | null>>();

  get(
    controller: DisplayController,
    entry: TermDictionaryEntry,
    context: AnkiNoteContext,
    extraMarkers: Record<string, string>
  ): Promise<NoteTarget | null> {
    const key = headwordKey(entry);
    let target = this.cache.get(key);
    if (!target) {
      target = controller.getNoteStates([entry], context, extraMarkers).then(([state]) => {
        const format = state?.cardFormats[0];
        if (!format) return null;
        const inAnki = format.state.duplicateNoteIds.length > 0;
        return {
          cardFormatIndex: format.cardFormatIndex,
          inAnki,
          disabled:
            format.action === 'disabled' && !inAnki ? (format.reason ?? 'Unavailable') : null
        };
      });
      // A failed check (Anki closed) is asked again, but not before `RETRY_AFTER_MS`: views wait
      // briefly for the check, and an unreachable Anki must not slow every one of them.
      const failed = target;
      failed.catch(() =>
        setTimeout(() => {
          if (this.cache.get(key) === failed) this.cache.delete(key);
        }, RETRY_AFTER_MS)
      );
      this.cache.set(key, target);
    }
    return target;
  }

  /** The entry was just saved. */
  markAdded(entry: TermDictionaryEntry) {
    const key = headwordKey(entry);
    const known = this.cache.get(key);
    this.cache.set(
      key,
      (known ?? Promise.resolve(null))
        .catch(() => null)
        .then((target) => (target ? { ...target, inAnki: true } : target))
    );
  }
}
