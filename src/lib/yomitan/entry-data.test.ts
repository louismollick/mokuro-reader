import { describe, expect, it } from 'vitest';
import type { TermDictionaryEntry } from 'yomitan-core';
import {
  distributeFurigana,
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
      pronunciations: [pitch(3, 0, [1]), pitch(1, 1, [4]), pitch(2, 0, [0, 2, 0])] as never
    });
    expect(primaryPitchPositions(e)).toEqual([0, 2]);
  });

  it('ignores non-numeric patterns', () => {
    expect(
      primaryPitchPositions(entry({ pronunciations: [pitch(0, 0, ['LHL'])] as never }))
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
