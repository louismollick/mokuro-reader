import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import KanjiView from '../KanjiView.svelte';
import fixtures from '$lib/yomitan/kanji-entries.fixture.json';
import { parseKanjiInfo, type KanjiEntryLike } from '$lib/yomitan/kanji-data';
import type { CommonWord, KanjiData } from '$lib/yomitan/lookup-loader';

const info = (character: string) =>
  parseKanjiInfo(
    character,
    ((fixtures as Record<string, unknown>)[character] ?? []) as KanjiEntryLike[]
  );

const words: CommonWord[] = [
  { term: '物語', reading: 'ものがたり', frequency: 977, gloss: 'story; tale' },
  { term: '語学', reading: 'ごがく', frequency: 4210, gloss: 'study of foreign languages' }
];

function setup(character: string, overrides: Partial<KanjiData> = {}) {
  const onKanji = vi.fn();
  const onWord = vi.fn();
  const kanji = info(character);
  const data: KanjiData = {
    kind: 'kanji',
    info: kanji,
    words,
    similar: kanji.similar.map(info),
    parts: kanji.components.map(info),
    ...overrides
  };
  const view = render(KanjiView, { data, onKanji, onWord });
  return { ...view, onKanji, onWord };
}

describe('KanjiView', () => {
  it('shows the keyword, stats and the readings with their shares', () => {
    const { getByText } = setup('学');
    expect(getByText('study')).toBeTruthy();
    expect(getByText('Grade 1 · N4 · 8 strokes · #63')).toBeTruthy();
    expect(getByText('がく 69% · がっ 26% · まな 4%')).toBeTruthy();
  });

  it('lists Common Words with their gloss and rank, a tap pushing a Word View', async () => {
    const { getByText, container, onWord } = setup('語');
    expect(getByText('story; tale')).toBeTruthy();
    expect(container.textContent).toContain('4,210');
    await fireEvent.click(getByText('ごがく').closest('button')!);
    expect(onWord).toHaveBeenCalledWith('語学');
  });

  it('shows Similar kanji with their keyword and Parts, each pushing a Kanji View', async () => {
    const { getByRole, onKanji } = setup('語');
    // 話 / 詰 / 諾 are not in the fixture, so they show the glyph only; 言 and 吾 are parts.
    await fireEvent.click(getByRole('button', { name: '話' }));
    expect(onKanji).toHaveBeenCalledWith('話');
  });

  it('shows the remaining meanings and omits sections without data', () => {
    const full = setup('学');
    expect(full.getByText('learning, science')).toBeTruthy();
    expect(full.container.textContent).toContain('Words');
    full.unmount();

    const bare = setup('語', { words: [] });
    expect(bare.getByText('speech, language')).toBeTruthy();
    expect(bare.container.textContent).not.toContain('Words');
  });
});
