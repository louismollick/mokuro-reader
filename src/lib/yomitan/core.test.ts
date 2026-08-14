import { describe, expect, it } from 'vitest';
import { buildEnabledDictionaries, buildEnabledKanjiDictionaries } from './core';

describe('buildEnabledDictionaries', () => {
  it('returns the serializable v2 dictionary selection shape', () => {
    expect(
      buildEnabledDictionaries([
        { title: 'JMdict', enabled: true },
        { title: 'Disabled', enabled: false }
      ])
    ).toEqual([
      {
        id: 'JMdict',
        index: 0,
        priority: 0,
        alias: 'JMdict',
        allowSecondarySearches: false,
        partsOfSpeechFilter: true,
        useDeinflections: true
      }
    ]);
  });
});

describe('buildEnabledKanjiDictionaries', () => {
  it('keeps enabled preference order and filters non-kanji dictionaries', () => {
    const result = buildEnabledKanjiDictionaries(
      [
        { title: 'JMdict', enabled: true },
        { title: 'KANJIDIC', enabled: true },
        { title: 'Disabled Kanji', enabled: false },
        { title: 'JPDB Kanji', enabled: true }
      ],
      [
        { title: 'KANJIDIC', counts: { kanji: { total: 10 } } },
        { title: 'JMdict', counts: { kanji: { total: 0 } } },
        { title: 'JPDB Kanji', counts: { kanji: { total: 5 } } },
        { title: 'Disabled Kanji', counts: { kanji: { total: 12 } } }
      ] as never
    );

    expect(result).toEqual([
      { id: 'KANJIDIC', index: 0, alias: 'KANJIDIC' },
      { id: 'JPDB Kanji', index: 1, alias: 'JPDB Kanji' }
    ]);
  });
});
