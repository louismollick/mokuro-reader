import { describe, expect, it, vi } from 'vitest';
import type { DisplayController, TermDictionaryEntry } from 'yomitan-core';
import { NoteStates } from './note-states';

const entry = {
  headwords: [{ term: '猫', reading: 'ねこ' }]
} as unknown as TermDictionaryEntry;

function controllerWith(format: object | undefined) {
  const getNoteStates = vi.fn(async () => [{ entryIndex: 0, cardFormats: format ? [format] : [] }]);
  return { controller: { getNoteStates } as unknown as DisplayController, getNoteStates };
}

describe('NoteStates', () => {
  it('asks Anki once per headword', async () => {
    const { controller, getNoteStates } = controllerWith({
      cardFormatIndex: 1,
      action: 'add',
      reason: null,
      state: { duplicateNoteIds: [] }
    });
    const states = new NoteStates();
    const first = await states.get(controller, entry, {}, {});
    await states.get(controller, entry, {}, {});
    expect(getNoteStates).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ cardFormatIndex: 1, inAnki: false, disabled: null });
  });

  it('reports a duplicate that the profile prevents as already in Anki', async () => {
    const { controller } = controllerWith({
      cardFormatIndex: 0,
      action: 'disabled',
      reason: 'Duplicate',
      state: { duplicateNoteIds: [7] }
    });
    expect(await new NoteStates().get(controller, entry, {}, {})).toMatchObject({ inAnki: true });
  });

  it('keeps a duplicate that the profile allows addable, and surfaces why a note is off', async () => {
    const dup = controllerWith({
      cardFormatIndex: 0,
      action: 'add-duplicate',
      reason: null,
      state: { duplicateNoteIds: [7] }
    });
    expect(await new NoteStates().get(dup.controller, entry, {}, {})).toMatchObject({
      inAnki: false,
      disabled: null
    });

    const off = controllerWith({
      cardFormatIndex: 0,
      action: 'disabled',
      reason: 'Empty field',
      state: { duplicateNoteIds: [] }
    });
    expect(await new NoteStates().get(off.controller, entry, {}, {})).toMatchObject({
      inAnki: false,
      disabled: 'Empty field'
    });
  });

  it('returns null with no card format, and remembers a saved note', async () => {
    const none = controllerWith(undefined);
    expect(await new NoteStates().get(none.controller, entry, {}, {})).toBeNull();

    const { controller } = controllerWith({
      cardFormatIndex: 0,
      action: 'add',
      reason: null,
      state: { duplicateNoteIds: [] }
    });
    const states = new NoteStates();
    await states.get(controller, entry, {}, {});
    states.markAdded(entry);
    expect(await states.get(controller, entry, {}, {})).toMatchObject({ inAnki: true });
  });
});
