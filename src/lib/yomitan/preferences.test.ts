import { describe, expect, it } from 'vitest';
import {
  moveDictionaryPreference,
  normalizeDictionaryPreferences,
  type DictionaryPreference
} from './preferences';

describe('normalizeDictionaryPreferences', () => {
  it('keeps existing order and enabled states, adds new dictionaries enabled by default', () => {
    const existing: DictionaryPreference[] = [
      { title: 'JMdict', enabled: false },
      { title: 'KANJIDIC', enabled: true }
    ];

    const normalized = normalizeDictionaryPreferences(
      ['KANJIDIC', 'JMdict', 'JPDB Frequency'],
      existing
    );

    expect(normalized).toEqual([
      { title: 'KANJIDIC', enabled: true },
      { title: 'JMdict', enabled: false },
      { title: 'JPDB Frequency', enabled: true }
    ]);
  });
});

describe('moveDictionaryPreference', () => {
  it('reorders preferences when moving up or down', () => {
    const preferences: DictionaryPreference[] = [
      { title: 'A', enabled: true },
      { title: 'B', enabled: true },
      { title: 'C', enabled: false }
    ];

    const movedDown = moveDictionaryPreference(preferences, 0, 1);
    expect(movedDown.map((item) => item.title)).toEqual(['B', 'A', 'C']);

    const movedUp = moveDictionaryPreference(movedDown, 2, 1);
    expect(movedUp.map((item) => item.title)).toEqual(['B', 'C', 'A']);
  });
});

