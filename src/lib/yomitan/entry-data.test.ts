import { describe, expect, it } from 'vitest';
import type { TermDictionaryEntry } from 'yomitan-core';
import {
  alternateForms,
  entriesCoveringSpan,
  distributeFurigana,
  primaryHeadword,
  frequencyLabels,
  inflectionNames,
  primaryPitchPositions
} from './entry-data';

describe('distributeFurigana', () => {
  it('puts the reading only over kanji', () => {
    expect(distributeFurigana('食べる', 'たべる')).toEqual([
      { text: '食', reading: 'た' },
      { text: 'べる', reading: '' }
    ]);
    expect(distributeFurigana('学ぶ', 'まなぶ')).toEqual([
      { text: '学', reading: 'まな' },
      { text: 'ぶ', reading: '' }
    ]);
  });

  it('keeps one ruby over a kanji run with an unsplittable reading', () => {
    expect(distributeFurigana('大学', 'だいがく')).toEqual([{ text: '大学', reading: 'だいがく' }]);
  });

  it('handles kana around kanji and katakana', () => {
    expect(distributeFurigana('お願い', 'おねがい')).toEqual([
      { text: 'お', reading: '' },
      { text: '願', reading: 'ねが' },
      { text: 'い', reading: '' }
    ]);
    expect(distributeFurigana('ビル', 'ビル')).toEqual([{ text: 'ビル', reading: '' }]);
  });

  it('leaves kana-only terms and missing readings plain', () => {
    expect(distributeFurigana('ある', 'ある')).toEqual([{ text: 'ある', reading: '' }]);
    expect(distributeFurigana('猫', '')).toEqual([{ text: '猫', reading: '' }]);
  });

  it('falls back to a ruby over the whole term when the reading does not align', () => {
    expect(distributeFurigana('食べる', 'ごはん')).toEqual([{ text: '食べる', reading: 'ごはん' }]);
  });
});

function entry(partial: Partial<TermDictionaryEntry>): TermDictionaryEntry {
  return partial as TermDictionaryEntry;
}

const primaryOnly = [{ headwordIndex: 0, term: 'x', reading: 'x', sources: [{ isPrimary: true }] }];

describe('primaryHeadword and alternateForms', () => {
  // 言う merged with its variants, as lookup.terms(..., { mode: 'merge' }) returns it.
  const merged = entry({
    headwords: [
      ['言う', 'いう', true],
      ['言う', 'ゆう', true],
      ['云う', 'いう', false],
      ['云う', 'ゆう', false],
      ['謂う', 'いう', false],
      ['謂う', 'ゆう', false]
    ].map(([term, reading, isPrimary], headwordIndex) => ({
      term,
      reading,
      headwordIndex,
      sources: [{ isPrimary }]
    })) as never
  });

  it('takes the headword the lookup matched', () => {
    expect(primaryHeadword(merged)).toMatchObject({ term: '言う', reading: 'いう' });
    const secondPrimary = entry({
      headwords: [
        { term: 'a', sources: [{ isPrimary: false }] },
        { term: 'b', sources: [{ isPrimary: true }] }
      ] as never
    });
    expect(primaryHeadword(secondPrimary).term).toBe('b');
  });

  it('lists the other readings, then the other spellings, once each', () => {
    expect(alternateForms(merged)).toEqual(['ゆう', '云う', '謂う']);
    expect(alternateForms(entry({ headwords: primaryOnly as never }))).toEqual([]);
  });
});

describe('entriesCoveringSpan', () => {
  const matched = (term: string, originalText: string, isPrimary = true, matchType = 'exact') =>
    entry({ headwords: [{ term, sources: [{ originalText, isPrimary, matchType }] }] as never });
  // 言って: 言う covers all three characters, 言 (げん) only the first.
  const full = matched('言う', '言って');
  const prefix = matched('言', '言');

  it('drops shorter prefix matches', () => {
    expect(entriesCoveringSpan([full, prefix], 3)).toEqual([full]);
  });

  it('needs an exact primary source of the full length', () => {
    const sequence = matched('云う', '云う', false);
    const partial = matched('言う', '言って', true, 'prefix');
    expect(entriesCoveringSpan([sequence, partial, full], 3)).toEqual([full]);
  });

  it('keeps one entry when any headword of a merged entry covers the span', () => {
    const merged = entry({
      headwords: [
        { term: '云う', sources: [{ originalText: '云う', isPrimary: false, matchType: 'exact' }] },
        { term: '言う', sources: [{ originalText: '言って', isPrimary: true, matchType: 'exact' }] }
      ] as never
    });
    expect(entriesCoveringSpan([merged, prefix], 3)).toEqual([merged]);
  });

  it('falls back to every entry when none covers the span', () => {
    expect(entriesCoveringSpan([prefix], 5)).toEqual([prefix]);
    expect(entriesCoveringSpan([], 3)).toEqual([]);
  });
});

describe('primaryPitchPositions', () => {
  const pitch = (
    dictionaryIndex: number,
    headwordIndex: number,
    positions: (number | string)[]
  ) => ({
    headwordIndex,
    dictionaryIndex,
    pronunciations: positions.map((p) => ({ type: 'pitch-accent' as const, positions: p }))
  });

  it('takes the first pitch dictionary for the first headword, deduplicated', () => {
    const e = entry({
      headwords: primaryOnly as never,
      pronunciations: [pitch(3, 0, [1]), pitch(1, 1, [4]), pitch(2, 0, [0, 2, 0])] as never
    });
    expect(primaryPitchPositions(e)).toEqual([0, 2]);
  });

  it('ignores non-numeric patterns', () => {
    expect(
      primaryPitchPositions(
        entry({ headwords: primaryOnly as never, pronunciations: [pitch(0, 0, ['LHL'])] as never })
      )
    ).toEqual([]);
  });
});

describe('frequencyLabels', () => {
  const freq = (
    dictionaryIndex: number,
    dictionary: string,
    frequency: number,
    mode = 'rank-based'
  ) =>
    ({
      headwordIndex: 0,
      dictionaryIndex,
      dictionary,
      dictionaryAlias: dictionary,
      frequency,
      frequencyMode: mode
    }) as never;

  it('formats ranks and counts, one per dictionary in profile order', () => {
    const e = entry({
      headwords: primaryOnly as never,
      frequencies: [
        freq(2, 'JPDB', 9123),
        freq(1, 'Jiten (Manga)', 1835),
        freq(1, 'Jiten (Manga)', 4),
        freq(3, 'BCCWJ', 20, 'occurrence-based')
      ]
    });
    expect(frequencyLabels(e)).toEqual([
      { value: '#1,835', name: 'Jiten' },
      { value: '#9,123', name: 'JPDB' },
      { value: '20×', name: 'BCCWJ' }
    ]);
  });
});

describe('inflectionNames', () => {
  it('lists the first candidate chain', () => {
    const e = entry({
      inflectionRuleChainCandidates: [
        { source: 'algorithm', inflectionRules: [{ name: 'negative' }, { name: 'past' }] }
      ]
    });
    expect(inflectionNames(e)).toEqual(['negative', 'past']);
    expect(inflectionNames(entry({ inflectionRuleChainCandidates: [] }))).toEqual([]);
  });
});
