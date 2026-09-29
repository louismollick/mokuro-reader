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

    const [deckUrl, deckInit] = mocks.ankiConnect.mock.calls[0];
    expect(deckUrl).toBe('http://anki.test:8765');
    expect(JSON.parse(String(deckInit.body))).toMatchObject({
      action: 'createDeck',
      params: { deck: 'Mining::My Series' }
    });
    expect(mocks.ankiConnect.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.base.addNote.mock.invocationCallOrder[0]
    );
    expect(mocks.base.addNote).toHaveBeenCalledWith({ ...note, tags: ['my_series', 'mokuro'] });
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
