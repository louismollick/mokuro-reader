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

vi.mock('$lib/yomitan/core', () => coreMocks);
vi.mock('$lib/yomitan/preferences', () => preferenceMocks);

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
