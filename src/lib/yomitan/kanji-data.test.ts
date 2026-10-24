import { describe, expect, it, vi } from 'vitest';
import fixtures from './kanji-entries.fixture.json';
import {
  createKanjiInfoLoader,
  parseJpdbKanji,
  parseKanjidic,
  parseKanjiInfo,
  parseSimilarKanji,
  parseTheKanjiMapComponents,
  type KanjiEntryLike
} from './kanji-data';

// Real `lookup.kanji` results for 学 語 大 from KANJIDIC_english, JPDB Kanji, TheKanjiMap and
// Similar Kanji, with the stats trimmed to the ones read here.
const entries = (character: keyof typeof fixtures) => fixtures[character] as KanjiEntryLike[];
const from = (character: keyof typeof fixtures, dictionary: string) =>
  entries(character).filter((entry) => entry.dictionary.startsWith(dictionary));

describe('parseKanjidic', () => {
  it('reads the keyword, other meanings, stats and readings', () => {
    expect(parseKanjidic(from('学', 'KANJIDIC')[0])).toEqual({
      keyword: 'study',
      meanings: ['learning', 'science'],
      statsLine: 'Grade 1 · N4 · 8 strokes · #63',
      readings: [{ reading: 'ガク' }, { reading: 'まな.ぶ' }]
    });
  });

  it('omits missing stats', () => {
    const entry: KanjiEntryLike = {
      dictionary: 'KANJIDIC',
      onyomi: [],
      kunyomi: [],
      definitions: [],
      stats: { misc: [{ name: 'strokes', value: '1' }] }
    };
    expect(parseKanjidic(entry)).toMatchObject({ statsLine: '1 stroke', keyword: undefined });
  });
});

describe('parseJpdbKanji', () => {
  it('reads reading shares and drops readings without one', () => {
    expect(parseJpdbKanji(from('学', 'JPDB')[0]).readings).toEqual([
      { reading: 'がく', percent: 69 },
      { reading: 'がっ', percent: 26 },
      { reading: 'まな', percent: 4 }
    ]);
  });

  it('reads the components after the 漢字分解 marker', () => {
    expect(parseJpdbKanji(from('学', 'JPDB')[0]).components).toEqual(['𭕄', '冖', '子']);
    expect(parseJpdbKanji(from('語', 'JPDB')[0]).components).toEqual(['言', '五', '口']);
  });
});

describe('parseTheKanjiMapComponents', () => {
  it('splits parts on ideographic and ASCII spaces', () => {
    expect(parseTheKanjiMapComponents(from('学', 'TheKanjiMap')[0])).toEqual(['子']);
    expect(parseTheKanjiMapComponents(from('語', 'TheKanjiMap')[0])).toEqual(['言', '吾']);
  });

  it('ignores the other rows (radical info, compositions)', () => {
    const rows = from('大', 'TheKanjiMap');
    expect(rows).toHaveLength(2);
    expect(rows.map(parseTheKanjiMapComponents)).toEqual([[], []]);
  });
});

describe('parseSimilarKanji', () => {
  it('returns the similar kanji', () => {
    expect(parseSimilarKanji(from('語', 'Similar Kanji')[0])).toEqual(['話', '詰', '諾']);
  });
});

describe('parseKanjiInfo', () => {
  it('merges the dictionaries, preferring TheKanjiMap components and JPDB readings', () => {
    const info = parseKanjiInfo('語', entries('語'));
    expect(info).toMatchObject({
      character: '語',
      keyword: 'word',
      meanings: ['speech', 'language'],
      components: ['言', '吾'],
      similar: ['話', '詰', '諾'],
      known: true
    });
    expect(info.readings[0]).toEqual({ reading: 'ご', percent: 45 });
  });

  it('falls back to JPDB components and KANJIDIC readings', () => {
    const noMap = entries('学').filter((e) => !e.dictionary.startsWith('TheKanjiMap'));
    expect(parseKanjiInfo('学', noMap).components).toEqual(['𭕄', '冖', '子']);

    const kanjidicOnly = from('学', 'KANJIDIC');
    expect(parseKanjiInfo('学', kanjidicOnly).readings).toEqual([
      { reading: 'ガク' },
      { reading: 'まな.ぶ' }
    ]);
  });

  it('reports a kanji no dictionary knows', () => {
    expect(parseKanjiInfo('猫', [])).toMatchObject({ known: false, readings: [], components: [] });
  });
});

describe('createKanjiInfoLoader', () => {
  it('looks each kanji up once', async () => {
    const lookup = vi.fn(async (character: string) => entries(character as '学'));
    const load = createKanjiInfoLoader(lookup);
    const [a, b] = await Promise.all([load('学'), load('学')]);
    expect(a).toBe(b);
    expect(a.keyword).toBe('study');
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});
