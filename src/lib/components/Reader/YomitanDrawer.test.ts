import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import YomitanDrawer from './YomitanDrawer.svelte';

type Token = {
  text: string;
  range: { start: number; end: number };
  segments: Array<{ text: string; reading: string }>;
  headwords?: unknown[][];
};

const clientMock = vi.hoisted(() => ({
  dictionaries: { list: vi.fn() },
  profile: { get: vi.fn() },
  lookup: {
    parse: vi.fn(),
    terms: vi.fn(),
    kanji: vi.fn(),
    sentence: vi.fn()
  }
}));

const ankiMocks = vi.hoisted(() => ({ syncAnkiWeb: vi.fn() }));
const snackbarMocks = vi.hoisted(() => ({ showSnackbar: vi.fn() }));
const controllerMocks = vi.hoisted(() => ({ createDisplayController: vi.fn() }));

vi.mock('$lib/yomitan/client', () => ({ getYomitan: async () => clientMock }));
vi.mock('$lib/yomitan/anki-transport', () => ({ createMokuroAnkiTransport: () => ({}) }));
vi.mock('$lib/anki-connect', () => ankiMocks);
vi.mock('$lib/util/snackbar', () => snackbarMocks);
vi.mock('yomitan-core', () => controllerMocks);
vi.mock('$lib/settings', () => ({
  settings: {
    subscribe: (run: (value: unknown) => void) => {
      run({
        ankiConnectSettings: { url: 'http://127.0.0.1:8765', androidModeOverride: 'auto' }
      });
      return () => {};
    }
  }
}));

// A stand-in for `<yomitan-entries>`: renders one div per entry and records the properties the
// drawer assigns. It renders into the light DOM because jsdom ignores selections inside shadow roots;
// the real element uses a shadow root, which the drawer's selection code looks through via `host`.
vi.mock('@yomitan-core/web', () => ({
  defineYomitanEntries: () => {
    if (customElements.get('yomitan-entries')) return;
    customElements.define(
      'yomitan-entries',
      class extends HTMLElement {
        client: unknown = null;
        controller: unknown = null;
        extraMarkers: unknown;
        noteContext: unknown;
        set entries(value: Array<{ label?: string; id?: unknown }>) {
          this.replaceChildren(
            ...value.map((entry, index) => {
              const node = document.createElement('div');
              node.textContent = entry.label ?? `entry-${index}`;
              return node;
            })
          );
        }
      }
    );
  }
}));

function setSelection(node: Node) {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(node);
  selection?.removeAllRanges();
  selection?.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
}

function word(text: string, start = 0): Token {
  return {
    text,
    range: { start, end: start + text.length },
    segments: [{ text, reading: '' }],
    headwords: [[{}]]
  };
}

function punct(text: string, start: number): Token {
  return { text, range: { start, end: start + text.length }, segments: [{ text, reading: '' }] };
}

function resultsElement(container: HTMLElement) {
  return container.ownerDocument.querySelector('yomitan-entries') as HTMLElement & {
    client: unknown;
    controller: unknown;
    extraMarkers: unknown;
    noteContext: { sentence?: unknown; query?: string };
  };
}

describe('YomitanDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientMock.dictionaries.list.mockResolvedValue([{ title: 'JMdict' }]);
    clientMock.profile.get.mockReturnValue({
      options: { dictionaries: [{ name: 'JMdict', enabled: true }] }
    });
    clientMock.lookup.sentence.mockImplementation((text: string, offset: number) => ({
      text,
      offset
    }));
    clientMock.lookup.terms.mockImplementation(async (query: string) => ({
      entries: [{ label: `term-${query}` }],
      originalTextLength: query.length
    }));
    clientMock.lookup.kanji.mockResolvedValue([]);
    controllerMocks.createDisplayController.mockReturnValue({ controller: true });
  });

  it('renders token buttons and passes the entries to the results element', async () => {
    clientMock.lookup.parse.mockResolvedValue([word('日本語')]);

    const { getByText, getByTestId, container } = render(YomitanDrawer, {
      open: true,
      sourceText: '日本語'
    });

    await waitFor(() => expect(getByText('日本語')).toBeTruthy());
    await waitFor(() => {
      expect(getByTestId('yomitan-results')).toBeTruthy();
      expect(resultsElement(container).textContent).toBe('term-日本語');
    });
    expect(clientMock.lookup.terms).toHaveBeenCalledWith('日本語');
    expect(resultsElement(container).client).toBe(clientMock);
  });

  it('derives the note sentence from the clicked token range', async () => {
    clientMock.lookup.parse.mockResolvedValue([punct('、', 0), word('猫', 1)]);

    const { container } = render(YomitanDrawer, {
      open: true,
      sourceText: '、猫',
      volumeMetadata: { seriesTitle: 'Series', volumeTitle: 'Vol 1' }
    });

    await waitFor(() => expect(clientMock.lookup.sentence).toHaveBeenCalledWith('、猫', 1, 1));
    await waitFor(() => {
      const element = resultsElement(container);
      expect(element.noteContext.sentence).toEqual({ text: '、猫', offset: 1 });
      expect(element.extraMarkers).toEqual({ series: 'Series', volume: 'Vol 1' });
    });
  });

  it('only gives the results a controller when Anki is enabled', async () => {
    clientMock.lookup.parse.mockResolvedValue([word('猫')]);

    const off = render(YomitanDrawer, { open: true, sourceText: '猫', ankiEnabled: false });
    await waitFor(() => expect(off.getByTestId('yomitan-results')).toBeTruthy());
    expect(resultsElement(off.container).controller).toBeNull();
    expect(controllerMocks.createDisplayController).not.toHaveBeenCalled();
    off.unmount();

    const on = render(YomitanDrawer, { open: true, sourceText: '猫', ankiEnabled: true });
    await waitFor(() => expect(controllerMocks.createDisplayController).toHaveBeenCalled());
    await waitFor(() =>
      expect(resultsElement(on.container).controller).toEqual({ controller: true })
    );
  });

  it('shows no entries message when lookup returns empty entries', async () => {
    clientMock.lookup.parse.mockResolvedValue([word('猫')]);
    clientMock.lookup.terms.mockResolvedValue({ entries: [], originalTextLength: 1 });

    const { getByText } = render(YomitanDrawer, { open: true, sourceText: '猫' });

    await waitFor(() => expect(getByText('猫')).toBeTruthy());
    await fireEvent.click(getByText('猫'));

    await waitFor(() => expect(getByText('No dictionary entries found for "猫".')).toBeTruthy());
  });

  it('shows the no dictionaries and all disabled errors', async () => {
    clientMock.lookup.parse.mockResolvedValue([word('猫')]);
    clientMock.dictionaries.list.mockResolvedValue([]);
    const none = render(YomitanDrawer, { open: true, sourceText: '猫' });
    await waitFor(() => expect(none.getByText(/No Yomitan dictionaries installed/)).toBeTruthy());
    none.unmount();

    clientMock.dictionaries.list.mockResolvedValue([{ title: 'JMdict' }]);
    clientMock.profile.get.mockReturnValue({
      options: { dictionaries: [{ name: 'JMdict', enabled: false }] }
    });
    const disabled = render(YomitanDrawer, { open: true, sourceText: '猫' });
    await waitFor(() => expect(disabled.getByText(/All dictionaries are disabled/)).toBeTruthy());
  });

  it('renders punctuation tokens as non-clickable text', async () => {
    clientMock.lookup.parse.mockResolvedValue([word('猫'), punct('、', 1)]);

    const { getByText, getAllByRole } = render(YomitanDrawer, { open: true, sourceText: '猫、' });

    await waitFor(() => expect(getByText('、')).toBeTruthy());
    expect(getByText('、').tagName.toLowerCase()).toBe('span');
    const wordButtons = getAllByRole('button').filter(
      (button) => button.textContent?.trim() === '猫'
    );
    expect(wordButtons).toHaveLength(1);
  });

  it('closes from close button and emits onClose once', async () => {
    clientMock.lookup.parse.mockResolvedValue([word('猫')]);
    const onClose = vi.fn();

    const { getByLabelText } = render(YomitanDrawer, { open: true, sourceText: '猫', onClose });

    await waitFor(() => expect(getByLabelText('Close')).toBeTruthy());
    await fireEvent.click(getByLabelText('Close'));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('keeps token taps working', async () => {
    clientMock.lookup.parse.mockResolvedValue([word('猫'), word('犬', 1)]);

    const { getByText } = render(YomitanDrawer, { open: true, sourceText: '猫犬' });

    const secondToken = await waitFor(() => getByText('犬'));
    await fireEvent.pointerDown(secondToken, { pointerId: 2, pointerType: 'touch' });
    await fireEvent.pointerUp(secondToken, { pointerId: 2, pointerType: 'touch' });
    await fireEvent.click(secondToken);

    await waitFor(() => {
      expect(clientMock.lookup.terms).toHaveBeenCalledTimes(2);
      expect(clientMock.lookup.terms).toHaveBeenLastCalledWith('犬');
    });
  });

  it('kanji-click shows kanji results and back restores cached term results', async () => {
    clientMock.lookup.parse.mockResolvedValue([word('会う')]);
    clientMock.lookup.kanji.mockResolvedValue([{ label: 'kanji-会' }]);

    const { getByTestId, getByRole, container } = render(YomitanDrawer, {
      open: true,
      sourceText: '会う'
    });

    await waitFor(() => expect(getByTestId('yomitan-results')).toBeTruthy());
    await waitFor(() => expect(resultsElement(container).textContent).toBeTruthy());
    resultsElement(container).dispatchEvent(
      new CustomEvent('kanji-click', { detail: { character: '会' } })
    );

    await waitFor(() => {
      expect(clientMock.lookup.kanji).toHaveBeenCalledWith('会');
      expect(resultsElement(container).textContent).toBe('kanji-会');
      expect(getByRole('button', { name: 'Back to 会う' })).toBeTruthy();
    });

    await fireEvent.click(getByRole('button', { name: 'Back to 会う' }));

    await waitFor(() => {
      expect(resultsElement(container).textContent).toBe('term-会う');
      expect(clientMock.lookup.terms).toHaveBeenCalledTimes(1);
    });
  });

  it('same-token retap restores cached term results without a new term lookup', async () => {
    clientMock.lookup.parse.mockResolvedValue([word('会う')]);
    clientMock.lookup.kanji.mockResolvedValue([{ label: 'kanji-会' }]);

    const { getByText, container } = render(YomitanDrawer, { open: true, sourceText: '会う' });

    await waitFor(() => expect(resultsElement(container)).toBeTruthy());
    await waitFor(() => expect(resultsElement(container).textContent).toBeTruthy());
    resultsElement(container).dispatchEvent(
      new CustomEvent('kanji-click', { detail: { character: '会' } })
    );
    await waitFor(() => expect(resultsElement(container).textContent).toBe('kanji-会'));

    await fireEvent.click(getByText('会う'));

    await waitFor(() => {
      expect(resultsElement(container).textContent).toBe('term-会う');
      expect(clientMock.lookup.terms).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps the term view and shows a notice when kanji lookup returns nothing', async () => {
    clientMock.lookup.parse.mockResolvedValue([word('会う')]);

    const { getByText, container } = render(YomitanDrawer, { open: true, sourceText: '会う' });

    await waitFor(() => expect(resultsElement(container).textContent).toBeTruthy());
    resultsElement(container).dispatchEvent(
      new CustomEvent('kanji-click', { detail: { character: '会' } })
    );

    await waitFor(() => {
      expect(getByText('No kanji dictionary entries found for "会".')).toBeTruthy();
      expect(resultsElement(container).textContent).toBe('term-会う');
    });
  });

  it('link-click pushes a term lookup of the query', async () => {
    clientMock.lookup.parse.mockResolvedValue([word('学校')]);

    const { getByRole, container } = render(YomitanDrawer, { open: true, sourceText: '学校' });

    await waitFor(() => expect(resultsElement(container).textContent).toBeTruthy());
    resultsElement(container).dispatchEvent(
      new CustomEvent('link-click', { detail: { query: '学生', href: 'yomitan://x' } })
    );

    await waitFor(() => {
      expect(clientMock.lookup.terms).toHaveBeenLastCalledWith('学生');
      expect(getByRole('button', { name: 'Back to 学校' })).toBeTruthy();
    });
  });

  it('syncs AnkiWeb and confirms when a note is added, and reports note errors', async () => {
    clientMock.lookup.parse.mockResolvedValue([word('猫')]);

    const { container } = render(YomitanDrawer, {
      open: true,
      sourceText: '猫',
      ankiEnabled: true
    });

    await waitFor(() => expect(resultsElement(container).textContent).toBeTruthy());
    resultsElement(container).dispatchEvent(
      new CustomEvent('note-added', { detail: { noteId: 1, overwritten: false } })
    );
    await waitFor(() => {
      expect(ankiMocks.syncAnkiWeb).toHaveBeenCalledTimes(1);
      expect(snackbarMocks.showSnackbar).toHaveBeenCalledWith('Added note to Anki.');
    });

    resultsElement(container).dispatchEvent(
      new CustomEvent('note-error', { detail: { error: new Error('boom') } })
    );
    await waitFor(() =>
      expect(snackbarMocks.showSnackbar).toHaveBeenCalledWith('Failed to add note: boom')
    );
  });

  it('respects outsideClose for backdrop interactions', async () => {
    clientMock.lookup.parse.mockResolvedValue([word('猫')]);

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

  describe('selection search', () => {
    function resultsText(container: HTMLElement, index = 0) {
      return resultsElement(container).children[index] as HTMLElement;
    }

    it('shows for Japanese selections inside the results and pushes a nested view', async () => {
      clientMock.lookup.parse.mockResolvedValue([word('学校')]);
      clientMock.lookup.terms.mockImplementation(async (query: string) => ({
        entries: [{ label: query === '学校' ? '学生' : `term-${query}` }],
        originalTextLength: query.length
      }));

      const view = render(YomitanDrawer, { open: true, sourceText: '学校' });

      await waitFor(() => expect(resultsText(view.container)?.textContent).toBe('学生'));
      setSelection(resultsText(view.container));

      await fireEvent.click(
        await waitFor(() => view.getByRole('button', { name: 'Search selection' }))
      );

      await waitFor(() => {
        expect(clientMock.lookup.terms).toHaveBeenLastCalledWith('学生');
        expect(view.getByRole('button', { name: 'Back to 学校' })).toBeTruthy();
      });
    });

    it('does not show for non-Japanese result selections', async () => {
      clientMock.lookup.parse.mockResolvedValue([word('学校')]);
      clientMock.lookup.terms.mockResolvedValue({
        entries: [{ label: 'student' }],
        originalTextLength: 2
      });

      const view = render(YomitanDrawer, { open: true, sourceText: '学校' });

      await waitFor(() => expect(resultsText(view.container)?.textContent).toBe('student'));
      setSelection(resultsText(view.container));

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(view.queryByRole('button', { name: 'Search selection' })).toBeNull();
    });

    it('shows for Japanese token-bar selections', async () => {
      clientMock.lookup.parse.mockResolvedValue([word('青'), word('空', 1)]);

      const view = render(YomitanDrawer, { open: true, sourceText: '青空' });

      setSelection(await waitFor(() => view.getByText('空')));

      await waitFor(() =>
        expect(view.getByRole('button', { name: 'Search selection' })).toBeTruthy()
      );
    });

    it('falls back to kanji lookup for single-character selection misses', async () => {
      clientMock.lookup.parse.mockResolvedValue([word('森')]);
      clientMock.lookup.terms.mockImplementation(async (query: string) => ({
        entries: query === '木' ? [] : [{ label: '木' }],
        originalTextLength: 1
      }));
      clientMock.lookup.kanji.mockResolvedValue([{ label: 'kanji-木' }]);

      const view = render(YomitanDrawer, { open: true, sourceText: '森' });

      await waitFor(() => expect(resultsText(view.container)?.textContent).toBe('木'));
      setSelection(resultsText(view.container));
      await fireEvent.click(
        await waitFor(() => view.getByRole('button', { name: 'Search selection' }))
      );

      await waitFor(() => {
        expect(clientMock.lookup.terms).toHaveBeenCalledWith('木');
        expect(clientMock.lookup.kanji).toHaveBeenCalledWith('木');
        expect(resultsElement(view.container).textContent).toBe('kanji-木');
      });
    });

    it('shows an empty nested view when single-character selection search finds nothing', async () => {
      clientMock.lookup.parse.mockResolvedValue([word('森')]);
      clientMock.lookup.terms.mockImplementation(async (query: string) => ({
        entries: query === '木' ? [] : [{ label: '木' }],
        originalTextLength: 1
      }));

      const view = render(YomitanDrawer, { open: true, sourceText: '森' });

      await waitFor(() => expect(resultsText(view.container)?.textContent).toBe('木'));
      setSelection(resultsText(view.container));
      await fireEvent.click(
        await waitFor(() => view.getByRole('button', { name: 'Search selection' }))
      );

      await waitFor(() => {
        expect(view.getByText('No dictionary entries found for "木".')).toBeTruthy();
        expect(view.queryByTestId('yomitan-results')).toBeNull();
        expect(view.getByRole('button', { name: 'Back to 森' })).toBeTruthy();
      });
    });

    it('does not fall back to kanji lookup for multi-character selection misses', async () => {
      clientMock.lookup.parse.mockResolvedValue([word('森')]);
      clientMock.lookup.terms.mockImplementation(async (query: string) => ({
        entries: query === '森林' ? [] : [{ label: '森林' }],
        originalTextLength: query.length
      }));

      const view = render(YomitanDrawer, { open: true, sourceText: '森' });

      await waitFor(() => expect(resultsText(view.container)?.textContent).toBe('森林'));
      setSelection(resultsText(view.container));
      await fireEvent.click(
        await waitFor(() => view.getByRole('button', { name: 'Search selection' }))
      );

      await waitFor(() => {
        expect(clientMock.lookup.terms).toHaveBeenCalledWith('森林');
        expect(clientMock.lookup.kanji).not.toHaveBeenCalled();
        expect(view.getByText('No dictionary entries found for "森林".')).toBeTruthy();
      });
    });

    it('uses the nested selection query as the Anki note context', async () => {
      clientMock.lookup.parse.mockResolvedValue([word('学校')]);
      clientMock.lookup.terms.mockImplementation(async (query: string) => ({
        entries: [{ label: query === '学校' ? '学生' : `term-${query}` }],
        originalTextLength: query.length
      }));

      const view = render(YomitanDrawer, { open: true, sourceText: '学校', ankiEnabled: true });

      await waitFor(() => expect(resultsText(view.container)?.textContent).toBe('学生'));
      setSelection(resultsText(view.container));
      await fireEvent.click(
        await waitFor(() => view.getByRole('button', { name: 'Search selection' }))
      );

      await waitFor(() => {
        expect(resultsElement(view.container).noteContext.query).toBe('学生');
        expect(clientMock.lookup.sentence).toHaveBeenCalledWith('学生', 0, 2);
      });
    });
  });
});
