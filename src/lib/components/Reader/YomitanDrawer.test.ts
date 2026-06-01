import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import YomitanDrawer from './YomitanDrawer.svelte';

const termRendererMocks = vi.hoisted(() => ({
  prepareHost: vi.fn(),
  renderTermEntries: vi.fn(),
  updateHost: vi.fn(),
  destroy: vi.fn()
}));

const kanjiRendererMocks = vi.hoisted(() => ({
  prepareHost: vi.fn(),
  renderKanjiEntries: vi.fn(),
  updateHost: vi.fn(),
  destroy: vi.fn()
}));

const coreMocks = vi.hoisted(() => ({
  getInstalledDictionaries: vi.fn(),
  buildEnabledDictionaryMap: vi.fn(),
  buildEnabledKanjiDictionaryMap: vi.fn(),
  tokenizeText: vi.fn(),
  lookupKanji: vi.fn(),
  lookupTerm: vi.fn(),
  createTermEntryRenderer: vi.fn(),
  createKanjiEntryRenderer: vi.fn()
}));

const preferenceMocks = vi.hoisted(() => ({
  loadDictionaryPreferences: vi.fn(),
  normalizeDictionaryPreferences: vi.fn(),
  saveDictionaryPreferences: vi.fn()
}));

const ankiNoteMocks = vi.hoisted(() => ({
  addPopupAnkiNote: vi.fn(),
  getPopupAnkiButtonStates: vi.fn()
}));

vi.mock('$lib/yomitan/core', () => coreMocks);
vi.mock('$lib/yomitan/preferences', () => preferenceMocks);
vi.mock('$lib/yomitan/anki-note', () => ankiNoteMocks);

function setSelection(node: Node) {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(node);
  selection?.removeAllRanges();
  selection?.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
}

describe('YomitanDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    termRendererMocks.renderTermEntries.mockImplementation((entries: unknown[]) => {
      return entries.map((entry, index) => {
        const entryNode = document.createElement('div');
        entryNode.textContent = `entry-${index}`;

        return {
          index,
          entry,
          entryNode
        };
      });
    });
    kanjiRendererMocks.renderKanjiEntries.mockImplementation((entries: unknown[]) => {
      return entries.map((entry, index) => {
        const entryNode = document.createElement('div');
        entryNode.textContent = `kanji-entry-${index}`;

        return {
          index,
          entry,
          entryNode
        };
      });
    });

    coreMocks.createTermEntryRenderer.mockReturnValue(termRendererMocks);
    coreMocks.createKanjiEntryRenderer.mockReturnValue(kanjiRendererMocks);
    coreMocks.getInstalledDictionaries.mockResolvedValue([
      { title: 'JMdict', importDate: Date.now(), counts: { kanji: { total: 0 } } },
      { title: 'KANJIDIC', importDate: Date.now(), counts: { kanji: { total: 10 } } }
    ]);
    preferenceMocks.loadDictionaryPreferences.mockReturnValue([{ title: 'JMdict', enabled: true }]);
    preferenceMocks.normalizeDictionaryPreferences.mockReturnValue([
      { title: 'JMdict', enabled: true },
      { title: 'KANJIDIC', enabled: true }
    ]);
    coreMocks.buildEnabledDictionaryMap.mockReturnValue(
      new Map([['JMdict', { index: 0, priority: 0 }]])
    );
    coreMocks.buildEnabledKanjiDictionaryMap.mockReturnValue(
      new Map([['KANJIDIC', { index: 0, alias: 'KANJIDIC' }]])
    );
    ankiNoteMocks.addPopupAnkiNote.mockResolvedValue({ noteId: 123, errors: [] });
    ankiNoteMocks.getPopupAnkiButtonStates.mockResolvedValue({
      buttonStates: [],
      hadConnectionError: false
    });
  });

  it('renders token buttons and mounts yomitan results renderer after token click', async () => {
    coreMocks.tokenizeText.mockResolvedValue([
      { text: '日本語', reading: 'にほんご', term: '日本語', selectable: true, kind: 'word' }
    ]);
    coreMocks.lookupTerm.mockResolvedValue({ entries: [{ id: 1 }], originalTextLength: 3 });

    const { getByText, queryByTitle, getByTestId } = render(YomitanDrawer, {
      open: true,
      sourceText: '日本語'
    });

    await waitFor(() => expect(getByText('日本語')).toBeTruthy());
    await fireEvent.click(getByText('日本語'));

    await waitFor(() => {
      expect(coreMocks.createTermEntryRenderer).toHaveBeenCalled();
      expect(termRendererMocks.renderTermEntries).toHaveBeenCalled();
      expect(getByTestId('yomitan-results')).toBeTruthy();
      expect(queryByTitle('Yomitan dictionary results')).toBeNull();
    });
  });

  it('shows no entries message when lookup returns empty entries', async () => {
    coreMocks.tokenizeText.mockResolvedValue([
      { text: '猫', reading: 'ねこ', term: '猫', selectable: true, kind: 'word' }
    ]);
    coreMocks.lookupTerm.mockResolvedValue({ entries: [], originalTextLength: 1 });

    const { getByText } = render(YomitanDrawer, {
      open: true,
      sourceText: '猫'
    });

    await waitFor(() => expect(getByText('猫')).toBeTruthy());
    await fireEvent.click(getByText('猫'));

    await waitFor(() => expect(getByText('No dictionary entries found for "猫".')).toBeTruthy());
  });

  it('renders punctuation tokens as non-clickable text', async () => {
    coreMocks.tokenizeText.mockResolvedValue([
      { text: '猫', reading: 'ねこ', term: '猫', selectable: true, kind: 'word' },
      { text: '、', reading: '', term: '、', selectable: false, kind: 'other' }
    ]);
    coreMocks.lookupTerm.mockImplementation(async (term: string) => ({
      entries: term === '木' ? [] : [{ id: 1 }],
      originalTextLength: 1
    }));

    const { getByText, getAllByRole } = render(YomitanDrawer, {
      open: true,
      sourceText: '猫、'
    });

    await waitFor(() => {
      expect(coreMocks.createTermEntryRenderer).toHaveBeenCalled();
    });

    const punctuation = getByText('、');
    expect(punctuation.tagName.toLowerCase()).toBe('span');

    const wordButtons = getAllByRole('button').filter(
      (button) => button.textContent?.trim() === '猫'
    );
    expect(wordButtons).toHaveLength(1);
  });

  it('closes from close button and emits onClose once', async () => {
    coreMocks.tokenizeText.mockResolvedValue([
      { text: '猫', reading: 'ねこ', term: '猫', selectable: true, kind: 'word' }
    ]);
    coreMocks.lookupTerm.mockResolvedValue({ entries: [{ id: 1 }], originalTextLength: 1 });
    const onClose = vi.fn();

    const { getByLabelText } = render(YomitanDrawer, {
      open: true,
      sourceText: '猫',
      onClose
    });

    await waitFor(() => expect(getByLabelText('Close')).toBeTruthy());
    await fireEvent.click(getByLabelText('Close'));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('keeps token taps working', async () => {
    coreMocks.tokenizeText.mockResolvedValue([
      { text: '猫', reading: 'ねこ', term: '猫', selectable: true, kind: 'word' },
      { text: '犬', reading: 'いぬ', term: '犬', selectable: true, kind: 'word' }
    ]);
    coreMocks.lookupTerm.mockImplementation(async (term: string) => ({
      entries: [{ id: term }],
      originalTextLength: 1
    }));

    const { getByText } = render(YomitanDrawer, {
      open: true,
      sourceText: '猫犬'
    });

    const secondToken = await waitFor(() => getByText('犬'));
    await fireEvent.pointerDown(secondToken, {
      pointerId: 2,
      clientX: 100,
      clientY: 100,
      pointerType: 'touch',
      isPrimary: true
    });
    await fireEvent.pointerMove(secondToken, {
      pointerId: 2,
      clientX: 101,
      clientY: 105,
      pointerType: 'touch',
      isPrimary: true
    });
    await fireEvent.pointerUp(secondToken, {
      pointerId: 2,
      clientX: 101,
      clientY: 105,
      pointerType: 'touch',
      isPrimary: true
    });
    await fireEvent.click(secondToken);

    await waitFor(() => {
      expect(coreMocks.lookupTerm).toHaveBeenCalledTimes(2);
      expect(coreMocks.lookupTerm).toHaveBeenLastCalledWith('犬', expect.any(Map));
    });
  });

  it('clicks headword kanji to show kanji results and back restores cached term results', async () => {
    coreMocks.tokenizeText.mockResolvedValue([
      { text: '会う', reading: 'あう', term: '会う', selectable: true, kind: 'word' }
    ]);
    coreMocks.lookupTerm.mockResolvedValue({ entries: [{ id: 1 }], originalTextLength: 2 });
    coreMocks.lookupKanji.mockResolvedValue([{ character: '会' }]);
    termRendererMocks.renderTermEntries.mockImplementation((entries: unknown[]) => {
      return entries.map((entry, index) => {
        const entryNode = document.createElement('div');
        const link = document.createElement('a');
        link.className = 'headword-kanji-link';
        link.dataset.character = '会';
        link.textContent = '会';
        entryNode.appendChild(link);

        return {
          index,
          entry,
          entryNode
        };
      });
    });

    const { getByText, getByTestId, getByRole, queryByTestId } = render(YomitanDrawer, {
      open: true,
      sourceText: '会う'
    });

    await waitFor(() => expect(getByTestId('yomitan-results')).toBeTruthy());
    await fireEvent.click(getByText('会'));

    await waitFor(() => {
      expect(coreMocks.lookupKanji).toHaveBeenCalledWith(
        '会',
        new Map([['KANJIDIC', { index: 0, alias: 'KANJIDIC' }]])
      );
      expect(getByTestId('yomitan-kanji-results')).toBeTruthy();
      expect(queryByTestId('yomitan-results')).toBeNull();
      expect(getByRole('button', { name: 'Back to 会う' })).toBeTruthy();
    });

    await fireEvent.click(getByRole('button', { name: 'Back to 会う' }));

    await waitFor(() => {
      expect(getByTestId('yomitan-results')).toBeTruthy();
      expect(queryByTestId('yomitan-kanji-results')).toBeNull();
      expect(coreMocks.lookupTerm).toHaveBeenCalledTimes(1);
    });
  });

  it('same-token retap restores cached term results without a new term lookup', async () => {
    coreMocks.tokenizeText.mockResolvedValue([
      { text: '会う', reading: 'あう', term: '会う', selectable: true, kind: 'word' }
    ]);
    coreMocks.lookupTerm.mockResolvedValue({ entries: [{ id: 1 }], originalTextLength: 2 });
    coreMocks.lookupKanji.mockResolvedValue([{ character: '会' }]);
    termRendererMocks.renderTermEntries.mockImplementation((entries: unknown[]) => {
      return entries.map((entry, index) => {
        const entryNode = document.createElement('div');
        const link = document.createElement('a');
        link.className = 'headword-kanji-link';
        link.dataset.character = '会';
        link.textContent = '会';
        entryNode.appendChild(link);

        return {
          index,
          entry,
          entryNode
        };
      });
    });

    const { getByText, getByTestId, queryByTestId } = render(YomitanDrawer, {
      open: true,
      sourceText: '会う'
    });

    await waitFor(() => expect(getByTestId('yomitan-results')).toBeTruthy());
    await fireEvent.click(getByText('会'));
    await waitFor(() => expect(getByTestId('yomitan-kanji-results')).toBeTruthy());

    await fireEvent.click(getByText('会う'));

    await waitFor(() => {
      expect(getByTestId('yomitan-results')).toBeTruthy();
      expect(queryByTestId('yomitan-kanji-results')).toBeNull();
      expect(coreMocks.lookupTerm).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps term view visible when no enabled kanji dictionaries exist', async () => {
    coreMocks.tokenizeText.mockResolvedValue([
      { text: '会う', reading: 'あう', term: '会う', selectable: true, kind: 'word' }
    ]);
    coreMocks.lookupTerm.mockResolvedValue({ entries: [{ id: 1 }], originalTextLength: 2 });
    coreMocks.buildEnabledKanjiDictionaryMap.mockReturnValue(new Map());
    termRendererMocks.renderTermEntries.mockImplementation((entries: unknown[]) => {
      return entries.map((entry, index) => {
        const entryNode = document.createElement('div');
        const link = document.createElement('a');
        link.className = 'headword-kanji-link';
        link.dataset.character = '会';
        link.textContent = '会';
        entryNode.appendChild(link);

        return {
          index,
          entry,
          entryNode
        };
      });
    });

    const { getByText, getByTestId, queryByTestId } = render(YomitanDrawer, {
      open: true,
      sourceText: '会う'
    });

    await waitFor(() => expect(getByTestId('yomitan-results')).toBeTruthy());
    await fireEvent.click(getByText('会'));

    await waitFor(() => {
      expect(coreMocks.lookupKanji).not.toHaveBeenCalled();
      expect(getByText('No enabled kanji dictionaries.')).toBeTruthy();
      expect(getByTestId('yomitan-results')).toBeTruthy();
      expect(queryByTestId('yomitan-kanji-results')).toBeNull();
    });
  });

  it('hides button until precheck completes, then shows duplicate state', async () => {
    coreMocks.tokenizeText.mockResolvedValue([
      { text: '猫', reading: 'ねこ', term: '猫', selectable: true, kind: 'word' }
    ]);
    coreMocks.lookupTerm.mockResolvedValue({ entries: [{ id: 1 }], originalTextLength: 1 });

    let resolvePrecheck: ((value: unknown) => void) | null = null;
    ankiNoteMocks.getPopupAnkiButtonStates.mockReturnValue(
      new Promise<unknown>((resolve) => {
        resolvePrecheck = resolve;
      })
    );

    const view = render(YomitanDrawer, {
      open: true,
      sourceText: '猫',
      ankiEnabled: true
    });

    await waitFor(() => {
      expect(view.queryByRole('button', { name: 'Add duplicate' })).toBeNull();
      expect(view.queryByRole('button', { name: 'Add to Anki' })).toBeNull();
    });

    if (!resolvePrecheck) {
      throw new Error('Expected precheck resolver to be set');
    }
    (resolvePrecheck as (value: unknown) => void)({
      buttonStates: [{ state: 'duplicate' }],
      hadConnectionError: false
    });

    await waitFor(() => {
      expect(view.getByRole('button', { name: 'Add duplicate' })).toBeTruthy();
    });
  });

  it('transitions adding to added when Add to Anki succeeds', async () => {
    coreMocks.tokenizeText.mockResolvedValue([
      { text: '猫', reading: 'ねこ', term: '猫', selectable: true, kind: 'word' }
    ]);
    coreMocks.lookupTerm.mockResolvedValue({ entries: [{ id: 1 }], originalTextLength: 1 });
    ankiNoteMocks.getPopupAnkiButtonStates.mockResolvedValue({
      buttonStates: [{ state: 'ready' }],
      hadConnectionError: false
    });
    ankiNoteMocks.addPopupAnkiNote.mockResolvedValue({ noteId: 42, errors: [] });

    const view = render(YomitanDrawer, {
      open: true,
      sourceText: '猫',
      ankiEnabled: true
    });

    const addButton = await waitFor(() => view.getByRole('button', { name: 'Add to Anki' }));
    await fireEvent.click(addButton);

    await waitFor(() => {
      expect(ankiNoteMocks.addPopupAnkiNote).toHaveBeenCalled();
      expect(view.getByRole('button', { name: 'Added ✓' })).toBeTruthy();
    });
  });

  it('ignores stale precheck results after switching tokens', async () => {
    coreMocks.tokenizeText.mockResolvedValue([
      { text: '猫', reading: 'ねこ', term: '猫', selectable: true, kind: 'word' },
      { text: '犬', reading: 'いぬ', term: '犬', selectable: true, kind: 'word' }
    ]);
    coreMocks.lookupTerm.mockImplementation(async (term: string) => ({
      entries: [{ id: term }],
      originalTextLength: 1
    }));

    let resolveCat: ((value: unknown) => void) | null = null;
    let resolveDog: ((value: unknown) => void) | null = null;
    ankiNoteMocks.getPopupAnkiButtonStates.mockImplementation(
      async (_entries: unknown[], source: string) => {
        return await new Promise<unknown>((resolve) => {
          if (source === '猫') {
            resolveCat = resolve;
          } else {
            resolveDog = resolve;
          }
        });
      }
    );

    const { getByText, queryByRole, getByRole } = render(YomitanDrawer, {
      open: true,
      sourceText: '猫犬',
      ankiEnabled: true
    });

    await waitFor(() => expect(getByText('犬')).toBeTruthy());
    await fireEvent.click(getByText('犬'));

    await waitFor(() => expect(ankiNoteMocks.getPopupAnkiButtonStates).toHaveBeenCalledTimes(2));
    if (!resolveCat || !resolveDog) {
      throw new Error('Expected precheck resolvers to be set');
    }

    (resolveCat as (value: unknown) => void)({
      buttonStates: [{ state: 'duplicate' }],
      hadConnectionError: false
    });
    (resolveDog as (value: unknown) => void)({
      buttonStates: [{ state: 'ready' }],
      hadConnectionError: false
    });

    await waitFor(() => {
      expect(getByRole('button', { name: 'Add to Anki' })).toBeTruthy();
      expect(queryByRole('button', { name: 'Add duplicate' })).toBeNull();
    });
  });

  it('respects outsideClose for backdrop interactions', async () => {
    coreMocks.tokenizeText.mockResolvedValue([
      { text: '猫', reading: 'ねこ', term: '猫', selectable: true, kind: 'word' }
    ]);
    coreMocks.lookupTerm.mockResolvedValue({ entries: [{ id: 1 }], originalTextLength: 1 });

    const onCloseAllowed = vi.fn();
    const first = render(YomitanDrawer, {
      open: true,
      sourceText: '猫',
      outsideClose: true,
      onClose: onCloseAllowed
    });
    await waitFor(() => expect(first.container.querySelector('dialog')).toBeTruthy());
    await fireEvent.mouseDown(first.container.querySelector('dialog') as HTMLDialogElement, {
      clientX: 999,
      clientY: 1
    });
    await waitFor(() => expect(onCloseAllowed).toHaveBeenCalledTimes(1));

    first.unmount();

    const onCloseBlocked = vi.fn();
    const second = render(YomitanDrawer, {
      open: true,
      sourceText: '猫',
      outsideClose: false,
      onClose: onCloseBlocked
    });
    await waitFor(() => expect(second.container.querySelector('dialog')).toBeTruthy());
    await fireEvent.mouseDown(second.container.querySelector('dialog') as HTMLDialogElement, {
      clientX: 999,
      clientY: 1
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onCloseBlocked).not.toHaveBeenCalled();
  });

  it('shows selection search for Japanese result-body selections and pushes nested term view', async () => {
    coreMocks.tokenizeText.mockResolvedValue([
      { text: '学校', reading: 'がっこう', term: '学校', selectable: true, kind: 'word' }
    ]);
    coreMocks.lookupTerm.mockImplementation(async (term: string) => ({
      entries: [{ id: term }],
      originalTextLength: term.length
    }));
    termRendererMocks.renderTermEntries.mockImplementation((entries: unknown[]) => {
      return entries.map((entry, index) => {
        const entryNode = document.createElement('div');
        const jp = document.createElement('span');
        jp.textContent = index === 0 ? '学生' : '別';
        const en = document.createElement('span');
        en.textContent = 'student';
        entryNode.append(jp, en);
        return { index, entry, entryNode };
      });
    });

    const view = render(YomitanDrawer, {
      open: true,
      sourceText: '学校'
    });

    await waitFor(() => expect(view.getByTestId('yomitan-results')).toBeTruthy());
    setSelection(view.getByText('学生'));

    await waitFor(() =>
      expect(view.getByRole('button', { name: 'Search selection' })).toBeTruthy()
    );
    await fireEvent.click(view.getByRole('button', { name: 'Search selection' }));

    await waitFor(() => {
      expect(coreMocks.lookupTerm).toHaveBeenLastCalledWith('学生', expect.any(Map));
      expect(view.getByRole('button', { name: 'Back to 学校' })).toBeTruthy();
    });
  });

  it('does not show selection search for non-Japanese result selections', async () => {
    coreMocks.tokenizeText.mockResolvedValue([
      { text: '学校', reading: 'がっこう', term: '学校', selectable: true, kind: 'word' }
    ]);
    coreMocks.lookupTerm.mockResolvedValue({ entries: [{ id: 1 }], originalTextLength: 2 });
    termRendererMocks.renderTermEntries.mockImplementation((entries: unknown[]) => {
      return entries.map((entry, index) => {
        const entryNode = document.createElement('div');
        const en = document.createElement('span');
        en.textContent = index === 0 ? 'student' : 'gloss';
        entryNode.appendChild(en);
        return { index, entry, entryNode };
      });
    });

    const view = render(YomitanDrawer, {
      open: true,
      sourceText: '学校'
    });

    await waitFor(() => expect(view.getByTestId('yomitan-results')).toBeTruthy());
    setSelection(view.getByText('student'));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(view.queryByRole('button', { name: 'Search selection' })).toBeNull();
  });

  it('shows selection search for Japanese token-bar selections', async () => {
    coreMocks.tokenizeText.mockResolvedValue([
      { text: '青', reading: 'あお', term: '青', selectable: true, kind: 'word' },
      { text: '空', reading: 'そら', term: '空', selectable: true, kind: 'word' }
    ]);
    coreMocks.lookupTerm.mockImplementation(async (term: string) => ({
      entries: [{ id: term }],
      originalTextLength: 1
    }));

    const view = render(YomitanDrawer, {
      open: true,
      sourceText: '青空'
    });

    const token = await waitFor(() => view.getByText('空'));
    setSelection(token);

    await waitFor(() =>
      expect(view.getByRole('button', { name: 'Search selection' })).toBeTruthy()
    );
  });

  it('falls back to kanji lookup for single-character selection misses', async () => {
    coreMocks.tokenizeText.mockResolvedValue([
      { text: '森', reading: 'もり', term: '森', selectable: true, kind: 'word' }
    ]);
    coreMocks.lookupTerm.mockImplementation(async (term: string) => ({
      entries: term === '木' ? [] : [{ id: term }],
      originalTextLength: 1
    }));
    coreMocks.lookupKanji.mockResolvedValue([{ character: '木' }]);
    termRendererMocks.renderTermEntries.mockImplementation((entries: unknown[]) => {
      return entries.map((entry, index) => {
        const entryNode = document.createElement('div');
        const jp = document.createElement('span');
        jp.textContent = index === 0 ? '木' : '森';
        entryNode.appendChild(jp);
        return { index, entry, entryNode };
      });
    });

    const view = render(YomitanDrawer, {
      open: true,
      sourceText: '森'
    });

    await waitFor(() => expect(view.getByTestId('yomitan-results')).toBeTruthy());
    setSelection(view.getByText('木'));
    await fireEvent.click(
      await waitFor(() => view.getByRole('button', { name: 'Search selection' }))
    );

    await waitFor(() => {
      expect(coreMocks.lookupTerm).toHaveBeenCalledWith('木', expect.any(Map));
      expect(coreMocks.lookupKanji).toHaveBeenCalledWith(
        '木',
        new Map([['KANJIDIC', { index: 0, alias: 'KANJIDIC' }]])
      );
      expect(view.getByTestId('yomitan-kanji-results')).toBeTruthy();
    });
  });

  it('shows an empty nested view when single-character selection search finds nothing', async () => {
    coreMocks.tokenizeText.mockResolvedValue([
      { text: '森', reading: 'もり', term: '森', selectable: true, kind: 'word' }
    ]);
    coreMocks.lookupTerm.mockImplementation(async (term: string) => ({
      entries: term === '木' ? [] : [{ id: 1 }],
      originalTextLength: 1
    }));
    coreMocks.lookupKanji.mockResolvedValue([]);
    termRendererMocks.renderTermEntries.mockImplementation((entries: unknown[]) => {
      return entries.map((entry, index) => {
        const entryNode = document.createElement('div');
        const jp = document.createElement('span');
        jp.textContent = index === 0 ? '木' : '森';
        entryNode.appendChild(jp);
        return { index, entry, entryNode };
      });
    });

    const view = render(YomitanDrawer, {
      open: true,
      sourceText: '森'
    });

    await waitFor(() => expect(view.getByTestId('yomitan-results')).toBeTruthy());
    setSelection(view.getByText('木'));
    await fireEvent.click(
      await waitFor(() => view.getByRole('button', { name: 'Search selection' }))
    );

    await waitFor(() => {
      expect(view.getByText('No dictionary entries found for "木".')).toBeTruthy();
      expect(view.queryByTestId('yomitan-results')).toBeNull();
      expect(view.queryByTestId('yomitan-kanji-results')).toBeNull();
      expect(view.getByRole('button', { name: 'Back to 森' })).toBeTruthy();
    });
  });

  it('shows an empty nested view for kanji-only multi-character selection misses', async () => {
    coreMocks.tokenizeText.mockResolvedValue([
      { text: '森', reading: 'もり', term: '森', selectable: true, kind: 'word' }
    ]);
    coreMocks.lookupTerm.mockImplementation(async (term: string) => ({
      entries: term === '森林' ? [] : [{ id: 1 }],
      originalTextLength: term.length
    }));
    termRendererMocks.renderTermEntries.mockImplementation((entries: unknown[]) => {
      return entries.map((entry, index) => {
        const entryNode = document.createElement('div');
        const jp = document.createElement('span');
        jp.textContent = index === 0 ? '森林' : '森';
        entryNode.appendChild(jp);
        return { index, entry, entryNode };
      });
    });

    const view = render(YomitanDrawer, {
      open: true,
      sourceText: '森'
    });

    await waitFor(() => expect(view.getByTestId('yomitan-results')).toBeTruthy());
    setSelection(view.getByText('森林'));
    await fireEvent.click(
      await waitFor(() => view.getByRole('button', { name: 'Search selection' }))
    );

    await waitFor(() => {
      expect(coreMocks.lookupTerm).toHaveBeenCalledWith('森林', expect.any(Map));
      expect(coreMocks.lookupKanji).not.toHaveBeenCalled();
      expect(view.getByText('No dictionary entries found for "森林".')).toBeTruthy();
      expect(view.getByRole('button', { name: 'Back to 森' })).toBeTruthy();
    });
  });

  it('uses nested selection query for Anki source text', async () => {
    coreMocks.tokenizeText.mockResolvedValue([
      { text: '学校', reading: 'がっこう', term: '学校', selectable: true, kind: 'word' }
    ]);
    coreMocks.lookupTerm.mockImplementation(async (term: string) => ({
      entries: [{ id: term }],
      originalTextLength: term.length
    }));
    ankiNoteMocks.getPopupAnkiButtonStates.mockResolvedValue({
      buttonStates: [{ state: 'ready' }],
      hadConnectionError: false
    });
    termRendererMocks.renderTermEntries.mockImplementation((entries: unknown[]) => {
      return entries.map((entry, index) => {
        const entryNode = document.createElement('div');
        const jp = document.createElement('span');
        jp.textContent = index === 0 ? '学生' : '学校';
        entryNode.appendChild(jp);
        return { index, entry, entryNode };
      });
    });

    const view = render(YomitanDrawer, {
      open: true,
      sourceText: '学校',
      ankiEnabled: true
    });

    await waitFor(() => expect(view.getByTestId('yomitan-results')).toBeTruthy());
    setSelection(view.getByText('学生'));
    await fireEvent.click(
      await waitFor(() => view.getByRole('button', { name: 'Search selection' }))
    );
    const addButton = await waitFor(() => view.getByRole('button', { name: 'Add to Anki' }));
    await fireEvent.click(addButton);

    await waitFor(() => {
      expect(ankiNoteMocks.addPopupAnkiNote).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: '学生' }),
        '学生',
        undefined
      );
    });
  });
});
