import { describe, expect, it } from 'vitest';
import { buildEnabledKanjiDictionaryMap } from './core';

describe('buildEnabledKanjiDictionaryMap', () => {
  it('keeps enabled preference order and filters non-kanji dictionaries', () => {
    const result = buildEnabledKanjiDictionaryMap(
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

    expect([...result.entries()]).toEqual([
      ['KANJIDIC', { index: 0, alias: 'KANJIDIC' }],
      ['JPDB Kanji', { index: 1, alias: 'JPDB Kanji' }]
    ]);
  });
});
