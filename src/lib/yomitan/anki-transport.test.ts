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

vi.mock('$lib/anki-connect', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/anki-connect')>()),
  isAndroidMode: mocks.isAndroidMode
}));
vi.mock('$lib/settings', () => ({
  settings: {
    subscribe: (run: (value: unknown) => void) => {
      run({
        ankiConnectSettings: {
          url: 'http://anki.test:8765',
          apiKey: 'popup-test-key',
          tags: '{series} {volume} mokuro'
        }
      });
      return () => {};
    }
  }
}));
vi.mock('yomitan-core', () => ({ createAnkiConnectTransport: vi.fn(() => mocks.base) }));

import { createAnkiConnectTransport } from 'yomitan-core';
import { createMokuroAnkiTransport, createMokuroFetch } from './anki-transport';

const actionOf = (init?: RequestInit) => JSON.parse(String(init?.body)).action as string;

describe('createMokuroAnkiTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAndroidMode.mockReturnValue(false);
    mocks.base.addNote.mockResolvedValue(42);
    vi.stubGlobal(
      'fetch',
      mocks.ankiConnect.mockImplementation(async () => ({ json: async () => ({ result: null }) }))
    );
  });

  it('creates the deck, then adds the note with the resolved global tags', async () => {
    const transport = createMokuroAnkiTransport({
      seriesTitle: 'My Series',
      volumeTitle: 'Vol 1'
    });
    const note = {
      deckName: 'Mining::My Series',
      modelName: 'Basic',
      fields: {},
      options: {},
      tags: ['{series}', 'profile-tag']
    };

    await expect(transport.addNote(note)).resolves.toBe(42);

    const [deckUrl, deckInit] = mocks.ankiConnect.mock.calls[0];
    expect(deckUrl).toBe('http://anki.test:8765');
    expect(createAnkiConnectTransport).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'popup-test-key' })
    );
    expect(JSON.parse(String(deckInit.body))).toMatchObject({
      key: 'popup-test-key',
      action: 'createDeck',
      params: { deck: 'Mining::My Series' }
    });
    expect(mocks.ankiConnect.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.base.addNote.mock.invocationCallOrder[0]
    );
    // The profile's own tags are replaced, and no literal `{series}` reaches Anki.
    expect(mocks.base.addNote).toHaveBeenCalledWith({
      ...note,
      tags: ['My_Series', 'Vol_1', 'mokuro']
    });
  });

  it('drops the placeholders when no volume is open', async () => {
    await createMokuroAnkiTransport().addNote({
      deckName: 'D',
      modelName: 'Basic',
      fields: {},
      options: {},
      tags: []
    });
    expect(mocks.base.addNote).toHaveBeenCalledWith(expect.objectContaining({ tags: ['mokuro'] }));
  });

  it('creates the deck after a CORS permission grant', async () => {
    let denied = true;
    mocks.ankiConnect.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (actionOf(init) === 'requestPermission') {
        denied = false;
        return { json: async () => ({ result: { permission: 'granted' } }) };
      }
      if (denied) throw new TypeError('Failed to fetch');
      return { json: async () => ({ result: null }) };
    });
    await createMokuroAnkiTransport().addNote({
      deckName: 'New',
      modelName: 'Basic',
      fields: {},
      options: {},
      tags: []
    });
    expect(mocks.ankiConnect.mock.calls.map(([, init]) => actionOf(init))).toEqual([
      'createDeck',
      'requestPermission',
      'createDeck'
    ]);
  });

  it('never retries addNote after a failed request', async () => {
    mocks.ankiConnect.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });
    const request = { method: 'POST', body: JSON.stringify({ action: 'addNote', params: {} }) };
    await expect(
      createMokuroFetch('http://anki.test:8765')('http://anki.test:8765', request)
    ).rejects.toThrow('Failed to fetch');
    expect(mocks.ankiConnect).toHaveBeenCalledTimes(1);
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
