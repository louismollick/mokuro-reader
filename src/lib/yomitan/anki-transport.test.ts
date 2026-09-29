import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ankiConnect: vi.fn(),
  isAndroidMode: vi.fn(),
  base: {
    addNote: vi.fn(),
    updateNoteFields: vi.fn(),
    canAddNotes: vi.fn(),
    findNoteIds: vi.fn(),
    canAddNotesWithErrorDetail: vi.fn(),
    notesInfo: vi.fn(),
    guiBrowseNotes: vi.fn()
  }
}));

vi.mock('$lib/anki-connect', () => ({
  ankiConnect: mocks.ankiConnect,
  isAndroidMode: mocks.isAndroidMode
}));
vi.mock('$lib/settings', () => ({
  settings: {
    subscribe: (run: (value: unknown) => void) => {
      run({ ankiConnectSettings: { url: 'http://anki.test:8765' } });
      return () => {};
    }
  }
}));
vi.mock('yomitan-core', () => ({ createAnkiConnectTransport: () => mocks.base }));

import { createMokuroAnkiTransport } from './anki-transport';

describe('createMokuroAnkiTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAndroidMode.mockReturnValue(false);
    mocks.base.addNote.mockResolvedValue(42);
  });

  it('creates the deck, then adds the note with sanitized tags', async () => {
    const transport = createMokuroAnkiTransport();
    const note = {
      deckName: 'Mining::My Series',
      modelName: 'Basic',
      fields: {},
      options: {},
      tags: ['my series', '  ', 'mokuro']
    };

    await expect(transport.addNote(note)).resolves.toBe(42);

    expect(mocks.ankiConnect).toHaveBeenCalledWith(
      'createDeck',
      { deck: 'Mining::My Series' },
      { silent: true }
    );
    expect(mocks.ankiConnect.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.base.addNote.mock.invocationCallOrder[0]
    );
    expect(mocks.base.addNote).toHaveBeenCalledWith({ ...note, tags: ['my_series', 'mokuro'] });
  });

  it('exposes the full capability set on desktop', () => {
    const transport = createMokuroAnkiTransport();
    expect(transport.canAddNotesWithErrorDetail).toBeDefined();
    expect(transport.notesInfo).toBeDefined();
    expect(transport.guiBrowseNotes).toBeDefined();
  });

  it('omits unsupported capabilities in Android mode', () => {
    mocks.isAndroidMode.mockReturnValue(true);
    const transport = createMokuroAnkiTransport();
    expect(transport.canAddNotesWithErrorDetail).toBeUndefined();
    expect(transport.notesInfo).toBeUndefined();
    expect(transport.guiBrowseNotes).toBeUndefined();
    expect(transport.canAddNotes).toBeDefined();
  });
});
