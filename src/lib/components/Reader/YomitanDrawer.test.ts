import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import YomitanDrawer from './YomitanDrawer.svelte';

const coreMocks = vi.hoisted(() => ({
  getInstalledDictionaries: vi.fn(),
  buildEnabledDictionaryMap: vi.fn(),
  tokenizeText: vi.fn(),
  lookupTerm: vi.fn(),
  renderTermEntriesHtml: vi.fn()
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

describe('YomitanDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coreMocks.getInstalledDictionaries.mockResolvedValue([
      { title: 'JMdict', importDate: Date.now() }
    ]);
    preferenceMocks.loadDictionaryPreferences.mockReturnValue([{ title: 'JMdict', enabled: true }]);
    preferenceMocks.normalizeDictionaryPreferences.mockReturnValue([
      { title: 'JMdict', enabled: true }
    ]);
    coreMocks.buildEnabledDictionaryMap.mockReturnValue(
      new Map([['JMdict', { index: 0, priority: 0 }]])
    );
    ankiNoteMocks.addPopupAnkiNote.mockResolvedValue({ noteId: 123, errors: [] });
    ankiNoteMocks.getPopupAnkiButtonStates.mockResolvedValue({
      buttonStates: [],
      hadConnectionError: false
    });
  });

  it('renders token buttons and dictionary iframe after token click', async () => {
    coreMocks.tokenizeText.mockResolvedValue([
      { text: '日本語', reading: 'にほんご', term: '日本語', selectable: true, kind: 'word' }
    ]);
    coreMocks.lookupTerm.mockResolvedValue({ entries: [{ id: 1 }], originalTextLength: 3 });
    coreMocks.renderTermEntriesHtml.mockResolvedValue(
      '<html><body><div>result</div></body></html>'
    );

    const { getByText, container } = render(YomitanDrawer, {
      open: true,
      sourceText: '日本語'
    });

    await waitFor(() => expect(getByText('日本語')).toBeTruthy());
    await fireEvent.click(getByText('日本語'));

    await waitFor(() => {
      const iframe = container.querySelector('iframe');
      expect(iframe).toBeTruthy();
      expect((iframe as HTMLIFrameElement).srcdoc).toContain('result');
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

    await waitFor(() =>
      expect(getByText('No dictionary entries found for this token.')).toBeTruthy()
    );
  });

  it('renders punctuation tokens as non-clickable text', async () => {
    coreMocks.tokenizeText.mockResolvedValue([
      { text: '猫', reading: 'ねこ', term: '猫', selectable: true, kind: 'word' },
      { text: '、', reading: '', term: '、', selectable: false, kind: 'other' }
    ]);
    coreMocks.lookupTerm.mockResolvedValue({ entries: [{ id: 1 }], originalTextLength: 1 });
    coreMocks.renderTermEntriesHtml.mockResolvedValue(
      '<html><body><div>result</div></body></html>'
    );

    const { container, getByText, getAllByRole } = render(YomitanDrawer, {
      open: true,
      sourceText: '猫、'
    });

    await waitFor(() => {
      const iframe = container.querySelector('iframe');
      expect(iframe).toBeTruthy();
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
    coreMocks.renderTermEntriesHtml.mockResolvedValue(
      '<html><body><div>result</div></body></html>'
    );
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
    coreMocks.renderTermEntriesHtml.mockResolvedValue(
      '<html><body><div>result</div></body></html>'
    );

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

  it('renders checking state first, then duplicate state after precheck', async () => {
    coreMocks.tokenizeText.mockResolvedValue([
      { text: '猫', reading: 'ねこ', term: '猫', selectable: true, kind: 'word' }
    ]);
    coreMocks.lookupTerm.mockResolvedValue({ entries: [{ id: 1 }], originalTextLength: 1 });
    coreMocks.renderTermEntriesHtml.mockResolvedValue(
      '<html><body><div>result</div></body></html>'
    );

    let resolvePrecheck: ((value: unknown) => void) | null = null;
    ankiNoteMocks.getPopupAnkiButtonStates.mockReturnValue(
      new Promise<unknown>((resolve) => {
        resolvePrecheck = resolve;
      })
    );

    render(YomitanDrawer, {
      open: true,
      sourceText: '猫',
      ankiEnabled: true
    });

    await waitFor(() => {
      const hasCheckingState = coreMocks.renderTermEntriesHtml.mock.calls.some(
        ([, options]) => options?.ankiButtonStates?.[0]?.state === 'checking'
      );
      expect(hasCheckingState).toBe(true);
    });

    if (!resolvePrecheck) {
      throw new Error('Expected precheck resolver to be set');
    }
    (resolvePrecheck as (value: unknown) => void)({
      buttonStates: [{ state: 'duplicate' }],
      hadConnectionError: false
    });

    await waitFor(() => {
      const hasDuplicateState = coreMocks.renderTermEntriesHtml.mock.calls.some(
        ([, options]) => options?.ankiButtonStates?.[0]?.state === 'duplicate'
      );
      expect(hasDuplicateState).toBe(true);
    });
  });

  it('transitions adding to added when Add to Anki succeeds', async () => {
    coreMocks.tokenizeText.mockResolvedValue([
      { text: '猫', reading: 'ねこ', term: '猫', selectable: true, kind: 'word' }
    ]);
    coreMocks.lookupTerm.mockResolvedValue({ entries: [{ id: 1 }], originalTextLength: 1 });
    coreMocks.renderTermEntriesHtml.mockResolvedValue(
      '<html><body><div>result</div></body></html>'
    );
    ankiNoteMocks.getPopupAnkiButtonStates.mockResolvedValue({
      buttonStates: [{ state: 'ready' }],
      hadConnectionError: false
    });
    ankiNoteMocks.addPopupAnkiNote.mockResolvedValue({ noteId: 42, errors: [] });

    const { container } = render(YomitanDrawer, {
      open: true,
      sourceText: '猫',
      ankiEnabled: true
    });

    const iframe = await waitFor(() => {
      const frame = container.querySelector('iframe');
      expect(frame).toBeTruthy();
      return frame as HTMLIFrameElement;
    });

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'yomitan-add-note', entryIndex: 0 },
        source: iframe.contentWindow
      })
    );

    await waitFor(() => {
      expect(ankiNoteMocks.addPopupAnkiNote).toHaveBeenCalled();
      const hasAddingState = coreMocks.renderTermEntriesHtml.mock.calls.some(
        ([, options]) => options?.ankiButtonStates?.[0]?.state === 'adding'
      );
      const hasAddedState = coreMocks.renderTermEntriesHtml.mock.calls.some(
        ([, options]) => options?.ankiButtonStates?.[0]?.state === 'added'
      );
      expect(hasAddingState).toBe(true);
      expect(hasAddedState).toBe(true);
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
    coreMocks.renderTermEntriesHtml.mockResolvedValue(
      '<html><body><div>result</div></body></html>'
    );

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

    const { getByText } = render(YomitanDrawer, {
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
      const lastCall =
        coreMocks.renderTermEntriesHtml.mock.calls[
          coreMocks.renderTermEntriesHtml.mock.calls.length - 1
        ];
      expect(lastCall?.[1]?.ankiButtonStates?.[0]?.state).toBe('ready');
    });
  });

  it('respects outsideClose for backdrop interactions', async () => {
    coreMocks.tokenizeText.mockResolvedValue([
      { text: '猫', reading: 'ねこ', term: '猫', selectable: true, kind: 'word' }
    ]);
    coreMocks.lookupTerm.mockResolvedValue({ entries: [{ id: 1 }], originalTextLength: 1 });
    coreMocks.renderTermEntriesHtml.mockResolvedValue(
      '<html><body><div>result</div></body></html>'
    );

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
});
