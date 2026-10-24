import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import KanjiView from '../KanjiView.svelte';
import fixtures from '$lib/yomitan/kanji-entries.fixture.json';
import { createKanjiInfoLoader, type KanjiEntryLike } from '$lib/yomitan/kanji-data';

const lookupKanji = async (character: string) =>
  ((fixtures as Record<string, unknown>)[character] ?? []) as KanjiEntryLike[];

const client = {
  lookup: {
    termsContaining: vi.fn(async () => [
      { term: '語学', reading: 'ごがく', frequency: 4210 },
      { term: '物語', reading: 'ものがたり', frequency: 977 }
    ])
  }
};

function setup(character: string) {
  const onKanji = vi.fn();
  const onWord = vi.fn();
  const view = render(KanjiView, {
    client: client as never,
    character,
    loadInfo: createKanjiInfoLoader(lookupKanji),
    onKanji,
    onWord
  });
  return { ...view, onKanji, onWord };
}

describe('KanjiView', () => {
  it('shows the keyword, stats and the readings with their shares', async () => {
    const { findByText, getByText } = setup('学');
    expect(await findByText('study')).toBeTruthy();
    expect(getByText('Grade 1 · N4 · 8 strokes · #63')).toBeTruthy();
    expect(getByText('がく 69% · がっ 26% · まな 4%')).toBeTruthy();
  });

  it('lists Common Words, with a tap pushing a Word View', async () => {
    const { findByText, container, onWord } = setup('語');
    await fireEvent.click((await findByText('ごがく')).closest('button')!);
    expect(onWord).toHaveBeenCalledWith('語学');
    expect(client.lookup.termsContaining).toHaveBeenCalledWith('語', { limit: 12 });
    expect(container.textContent).toContain('4,210');
  });

  it('shows Similar kanji with their keyword and Parts, each pushing a Kanji View', async () => {
    const { findByText, getByRole, onKanji } = setup('語');
    await findByText('word');
    // 話 / 詰 / 諾 are not in the fixture, so they show the glyph only; 言 and 吾 are parts.
    await fireEvent.click(getByRole('button', { name: '話' }));
    expect(onKanji).toHaveBeenCalledWith('話');
  });

  it('shows the remaining meanings and omits sections without data', async () => {
    const full = setup('学');
    expect(await full.findByText('learning, science')).toBeTruthy();
    expect(full.container.textContent).toContain('Words');
    full.unmount();

    client.lookup.termsContaining.mockResolvedValueOnce([]);
    const bare = setup('語');
    await waitFor(() => expect(bare.queryByText('speech, language')).toBeTruthy());
    expect(bare.container.textContent).not.toContain('Words');
  });
});
