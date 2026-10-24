import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import type { AnkiNoteContext, DisplayController, TermDictionaryEntry } from 'yomitan-core';
import WordView from '../WordView.svelte';
import { NoteStates } from '$lib/yomitan/note-states';
import { MinedPanels } from '$lib/yomitan/mined-panels.svelte';
import type { PanelSource } from '$lib/yomitan/mining';

const mocks = vi.hoisted(() => ({
  syncAnkiWeb: vi.fn(),
  showSnackbar: vi.fn(),
  cropPanel: vi.fn()
}));

vi.mock('$lib/anki-connect', () => ({ syncAnkiWeb: mocks.syncAnkiWeb }));
vi.mock('$lib/util/snackbar', () => ({ showSnackbar: mocks.showSnackbar }));
vi.mock('$lib/panel/panel-crop', () => ({ cropPanel: mocks.cropPanel }));
vi.mock('yomitan-core', () => ({
  findGlossImages: () => [],
  setGlossImageSource: () => {},
  DuplicateNoteError: class DuplicateNoteError extends Error {}
}));
vi.mock('@yomitan-core/web', () => ({ scopeCssToHost: (css: string) => css }));

/** A term entry shaped like a `lookup.segment` result for 食べる looked up as 食べなかった. */
const entry = {
  headwords: [
    {
      index: 0,
      headwordIndex: 0,
      term: '食べる',
      reading: 'たべる',
      sources: [{ isPrimary: true }]
    },
    {
      index: 1,
      headwordIndex: 1,
      term: '喰べる',
      reading: 'たべる',
      sources: [{ isPrimary: false }]
    },
    {
      index: 2,
      headwordIndex: 2,
      term: '食べる',
      reading: 'くべる',
      sources: [{ isPrimary: false }]
    }
  ],
  pronunciations: [
    {
      headwordIndex: 0,
      dictionaryIndex: 4,
      pronunciations: [{ type: 'pitch-accent', positions: 2 }]
    }
  ],
  frequencies: [
    {
      headwordIndex: 0,
      dictionaryIndex: 1,
      dictionary: 'Jiten (Manga)',
      dictionaryAlias: 'Jiten (Manga)',
      frequency: 1835,
      frequencyMode: 'rank-based'
    },
    {
      headwordIndex: 0,
      dictionaryIndex: 2,
      dictionary: 'JPDB',
      dictionaryAlias: 'JPDB',
      frequency: 912,
      frequencyMode: 'rank-based'
    }
  ],
  inflectionRuleChainCandidates: [
    { source: 'algorithm', inflectionRules: [{ name: 'negative' }, { name: 'past' }] }
  ]
} as unknown as TermDictionaryEntry;

const client = {
  profile: {
    get: () => ({
      options: {
        audio: { sources: [{}], enableDefaultAudioSources: false },
        anki: { cardFormats: [{ fields: { Picture: { value: '{screenshot}' } } }] }
      }
    })
  },
  audio: { urls: vi.fn(async () => [{ url: 'https://audio.test/a.mp3' }]) },
  dictionaries: { getMedia: vi.fn(async () => null) },
  render: {
    glossaries: vi.fn(async () => [
      {
        dictionary: 'JMdict [2026-10-23]',
        dictionaryAlias: 'JMdict [2026-10-23]',
        html: '<ol><li class="definition-item"><div class="definition-tag-list"><span class="tag" data-category="default">1</span><span class="tag" data-category="partOfSpeech">v1</span><span class="tag" data-category="dictionary">JMdict</span></div><ul class="gloss-list"><li class="gloss-item">to eat</li></ul></li></ol>'
      },
      {
        dictionary: 'Jitendex',
        dictionaryAlias: 'Jitendex',
        html: '<ol><li class="definition-item"><ul class="gloss-list"><li class="gloss-item">eat</li></ul></li></ol>'
      }
    ])
  }
};

const baseProps = {
  client: client as never,
  entries: [entry],
  surface: '食べなかった',
  compact: false,
  glossaryStyle: { css: '', attributes: { theme: 'dark' } },
  controller: null as DisplayController | null,
  noteContext: {} as AnkiNoteContext,
  extraMarkers: {},
  noteStates: new NoteStates(),
  panelSource: null as PanelSource | null,
  minedPanels: new MinedPanels(),
  onAdjust: vi.fn(),
  onKanji: vi.fn(),
  onQuery: vi.fn()
};

describe('WordView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom doesn't implement media playback.
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.stubGlobal(
      'CSSStyleSheet',
      class {
        replaceSync() {}
      }
    );
  });

  it('shows the headword with furigana, pitch, frequency and inflection', () => {
    const { container, getByText } = render(WordView, baseProps);

    expect(container.querySelector('ruby')?.textContent).toContain('食');
    expect(container.querySelector('rt')?.textContent).toBe('た');
    // 食べる [2]: た (low), べ (high, downstep), る (low).
    expect([...container.querySelectorAll('.pitch .high')].map((m) => m.textContent)).toEqual([
      'べ'
    ]);
    expect(container.querySelector('.pitch')?.textContent).toContain('[2]');
    expect(getByText('#1,835')).toBeTruthy();
    expect(getByText('Jiten')).toBeTruthy();
    expect(getByText('食べなかった ← negative · past')).toBeTruthy();
    // The entry's other readings and spellings go on one small line.
    expect(getByText('くべる · 喰べる')).toBeTruthy();
  });

  it('pushes a Kanji View from a headword kanji', async () => {
    const onKanji = vi.fn();
    const { getByRole } = render(WordView, { ...baseProps, onKanji });
    await fireEvent.click(getByRole('button', { name: 'Kanji 食' }));
    expect(onKanji).toHaveBeenCalledWith('食');
  });

  it('renders each dictionary in a shadow root with its name as the run-in label', async () => {
    const { container } = render(WordView, baseProps);
    await waitFor(() => expect(container.querySelectorAll('.glossary')).toHaveLength(2));

    const roots = [...container.querySelectorAll('.glossary')].map((host) => host.shadowRoot);
    // The label leads the first definition's tags (version suffix dropped)...
    const label = roots[0]?.querySelector('.dictionary-label');
    expect(label?.textContent).toBe('JMdict');
    expect(label?.parentElement?.classList.contains('definition-tag-list')).toBe(true);
    expect(roots[0]?.querySelector('.definition-item')?.textContent).toContain('to eat');
    // The sense number and dictionary tags repeat the list number and the label; part of speech stays.
    expect([...(roots[0]?.querySelectorAll('.tag') ?? [])].map((tag) => tag.textContent)).toEqual([
      'v1'
    ]);
    // ...or, with no tags, floats in front of the first gloss.
    const floated = roots[1]?.querySelector('.dictionary-label');
    expect(floated?.textContent).toBe('Jitendex');
    expect(floated?.classList.contains('float')).toBe(true);
  });

  it('keeps the peek to the first dictionary and first frequency', async () => {
    const { container, queryByText } = render(WordView, { ...baseProps, compact: true });
    await waitFor(() => expect(container.querySelectorAll('.glossary')).toHaveLength(1));
    expect(queryByText('#1,835')).toBeTruthy();
    expect(queryByText('#912')).toBeNull();
  });

  it('lists homographs after the first entry', async () => {
    const { container } = render(WordView, { ...baseProps, entries: [entry, entry] });
    await waitFor(() => expect(container.querySelectorAll('.glossary')).toHaveLength(4));
    expect(container.querySelectorAll('.entry.next')).toHaveLength(1);
  });

  it('only offers Anki when a controller is given, and saves with the note context', async () => {
    const off = render(WordView, baseProps);
    expect(off.queryByRole('button', { name: 'Add to Anki' })).toBeNull();
    off.unmount();

    const addNote = vi.fn(async () => ({ noteId: 1, overwritten: false, warnings: [] }));
    const getNoteStates = vi.fn(async () => [
      {
        entryIndex: 0,
        cardFormats: [
          { cardFormatIndex: 0, action: 'add', reason: null, state: { duplicateNoteIds: [] } }
        ]
      }
    ]);
    const noteContext = { sentence: { text: '食べなかった', offset: 0 }, query: '食べなかった' };
    const on = render(WordView, {
      ...baseProps,
      controller: { addNote, getNoteStates } as never,
      noteContext,
      extraMarkers: { series: 'S', volume: 'V' },
      noteStates: new NoteStates()
    });

    await waitFor(() => expect(getNoteStates).toHaveBeenCalled());
    await fireEvent.click(on.getByRole('button', { name: 'Add to Anki' }));

    await waitFor(() => expect(on.getByRole('img', { name: 'Added to Anki' })).toBeTruthy());
    expect(addNote).toHaveBeenCalledWith(
      entry,
      0,
      noteContext,
      { series: 'S', volume: 'V' },
      undefined
    );
    expect(mocks.syncAnkiWeb).toHaveBeenCalled();
  });

  it('adds the Panel Crop as the note screenshot and offers to adjust it', async () => {
    const image = new Blob(['crop'], { type: 'image/webp' });
    mocks.cropPanel.mockResolvedValue({ blob: image, rect: { x1: 1, y1: 2, x2: 30, y2: 40 } });
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:crop', revokeObjectURL() {} })
    );
    const addNote = vi.fn(async () => ({
      noteId: 7,
      overwritten: false,
      warnings: ['audio failed']
    }));
    const getNoteStates = vi.fn(async () => [
      {
        entryIndex: 0,
        cardFormats: [
          { cardFormatIndex: 0, action: 'add', reason: null, state: { duplicateNoteIds: [] } }
        ]
      }
    ]);
    const panelSource = {
      pageImage: new Blob(['page']),
      textBox: { x1: 10, y1: 10, x2: 20, y2: 20 }
    };
    const onAdjust = vi.fn();
    const view = render(WordView, {
      ...baseProps,
      controller: { addNote, getNoteStates } as never,
      noteStates: new NoteStates(),
      minedPanels: new MinedPanels(),
      panelSource,
      onAdjust
    });
    await fireEvent.click(await view.findByRole('button', { name: 'Add to Anki' }));

    await waitFor(() => expect(view.getByRole('img', { name: 'Added to Anki' })).toBeTruthy());
    expect(mocks.cropPanel).toHaveBeenCalledWith(panelSource.pageImage, panelSource.textBox);
    expect(addNote).toHaveBeenCalledWith(
      entry,
      0,
      {},
      {},
      {
        screenshot: { data: image, mediaType: 'image/webp' }
      }
    );
    expect(mocks.showSnackbar).toHaveBeenCalledWith('Added note, but audio failed.');

    await fireEvent.click(view.getByRole('button', { name: 'Adjust Panel Crop' }));
    expect(onAdjust).toHaveBeenCalledWith(entry);
  });

  it('shows a duplicate the profile prevents as already in Anki', async () => {
    const getNoteStates = vi.fn(async () => [
      {
        entryIndex: 0,
        cardFormats: [
          {
            cardFormatIndex: 0,
            action: 'disabled',
            reason: 'Duplicate',
            state: { duplicateNoteIds: [9] }
          }
        ]
      }
    ]);
    const { findByRole } = render(WordView, {
      ...baseProps,
      controller: { getNoteStates } as never,
      noteStates: new NoteStates()
    });
    expect(await findByRole('img', { name: 'In Anki' })).toBeTruthy();
  });

  it('reports a failed save and lets the user retry', async () => {
    const addNote = vi.fn(async () => {
      throw new Error('Anki is closed');
    });
    const getNoteStates = vi.fn(async () => [
      {
        entryIndex: 0,
        cardFormats: [
          { cardFormatIndex: 0, action: 'add', reason: null, state: { duplicateNoteIds: [] } }
        ]
      }
    ]);
    const { findByRole } = render(WordView, {
      ...baseProps,
      controller: { addNote, getNoteStates } as never,
      noteStates: new NoteStates()
    });
    await fireEvent.click(await findByRole('button', { name: 'Add to Anki' }));
    expect(await findByRole('button', { name: 'Add to Anki failed, retry' })).toBeTruthy();
    expect(mocks.showSnackbar).toHaveBeenCalledWith('Failed to add note: Anki is closed');
  });

  it('plays the first working audio source', async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockRejectedValueOnce(new Error('404'))
      .mockResolvedValue(undefined);
    client.audio.urls.mockResolvedValueOnce([
      { url: 'https://audio.test/missing.mp3' },
      { url: 'https://audio.test/ok.mp3' }
    ]);
    const { getByRole } = render(WordView, baseProps);
    await fireEvent.click(getByRole('button', { name: 'Play audio' }));
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    play.mockRestore();
  });

  describe('switching to another word', () => {
    const other = {
      ...entry,
      headwords: [
        {
          index: 0,
          headwordIndex: 0,
          term: '飲む',
          reading: 'のむ',
          sources: [{ isPrimary: true }]
        }
      ]
    } as unknown as TermDictionaryEntry;

    it('plays the new word, not the previous one', async () => {
      vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
      const view = render(WordView, baseProps);
      await fireEvent.click(view.getByRole('button', { name: 'Play audio' }));
      await waitFor(() => expect(client.audio.urls).toHaveBeenCalledWith('食べる', 'たべる'));

      await view.rerender({ entries: [other] });
      await fireEvent.click(view.getByRole('button', { name: 'Play audio' }));
      await waitFor(() => expect(client.audio.urls).toHaveBeenLastCalledWith('飲む', 'のむ'));
    });

    it('does not mark the new word as added when the old word finishes saving', async () => {
      let finish: () => void = () => {};
      const addNote = vi.fn(
        () =>
          new Promise((resolve) => {
            finish = () => resolve({ noteId: 1, overwritten: false, warnings: [] });
          })
      );
      const getNoteStates = vi.fn(async () => [
        {
          entryIndex: 0,
          cardFormats: [
            { cardFormatIndex: 0, action: 'add', reason: null, state: { duplicateNoteIds: [] } }
          ]
        }
      ]);
      const noteStates = new NoteStates();
      const view = render(WordView, {
        ...baseProps,
        controller: { addNote, getNoteStates } as never,
        noteStates
      });
      await fireEvent.click(await view.findByRole('button', { name: 'Add to Anki' }));

      await view.rerender({ entries: [other] });
      finish();
      await waitFor(() => expect(mocks.syncAnkiWeb).toHaveBeenCalled());

      expect(await view.findByRole('button', { name: 'Add to Anki' })).toBeTruthy();
      expect(view.queryByRole('img', { name: 'Added to Anki' })).toBeNull();
      // The saved word is remembered under its own name.
      const saved = await noteStates.get({ getNoteStates } as never, entry, {}, {});
      expect(saved?.inAnki).toBe(true);
    });
  });
});
