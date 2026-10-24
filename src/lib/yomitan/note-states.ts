import type { AnkiNoteContext, DisplayController, TermDictionaryEntry } from 'yomitan-core';

export interface NoteTarget {
  /** The card format the add button saves with. */
  cardFormatIndex: number;
  /** Already saved, and the profile's duplicate behavior stops another. */
  inAnki: boolean;
  /** Why the add button is off, or null. */
  disabled: string | null;
}

/**
 * What the Anki button shows per headword, asked of Anki once per Lookup Sheet session:
 * `getNoteStates` costs a duplicate check round trip, and the same headword shows up again as
 * the user switches Words.
 */
export class NoteStates {
  private cache = new Map<string, Promise<NoteTarget | null>>();

  private key(entry: TermDictionaryEntry) {
    const { term, reading } = entry.headwords[0];
    return `${term}|${reading}`;
  }

  get(
    controller: DisplayController,
    entry: TermDictionaryEntry,
    context: AnkiNoteContext,
    extraMarkers: Record<string, string>
  ): Promise<NoteTarget | null> {
    const key = this.key(entry);
    let target = this.cache.get(key);
    if (!target) {
      target = controller.getNoteStates([entry], context, extraMarkers).then(([state]) => {
        const format = state?.cardFormats[0];
        if (!format) return null;
        const inAnki = format.action === 'disabled' && format.state.duplicateNoteIds.length > 0;
        return {
          cardFormatIndex: format.cardFormatIndex,
          inAnki,
          disabled:
            format.action === 'disabled' && !inAnki ? (format.reason ?? 'Unavailable') : null
        };
      });
      // A failed check (Anki closed) is retried on the next ask.
      target.catch(() => this.cache.delete(key));
      this.cache.set(key, target);
    }
    return target;
  }

  /** The entry was just saved. */
  markAdded(entry: TermDictionaryEntry) {
    const key = this.key(entry);
    const known = this.cache.get(key);
    this.cache.set(
      key,
      (known ?? Promise.resolve(null)).then((target) =>
        target ? { ...target, inAnki: true } : target
      )
    );
  }
}
