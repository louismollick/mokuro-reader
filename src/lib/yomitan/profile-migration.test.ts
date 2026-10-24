import { describe, expect, it } from 'vitest';
import type { DictionaryOptions } from 'yomitan-core';
import { applyPendingDictionaryPreferences } from './profile-migration';

function dictionariesWith(...entries: Array<[string, boolean]>): DictionaryOptions[] {
  // Only the keys this migration touches are populated.
  return entries.map(([name, enabled]) => ({ name, enabled }) as DictionaryOptions);
}

describe('applyPendingDictionaryPreferences', () => {
  it('applies legacy flags to re-imported dictionaries and consumes only those', () => {
    const dictionaries = dictionariesWith(['JMdict', true], ['KANJIDIC', true]);
    const pending = [
      { title: 'JMdict', enabled: false },
      { title: 'KANJIDIC', enabled: true },
      { title: 'NotYet', enabled: false }
    ];

    const result = applyPendingDictionaryPreferences(dictionaries, pending);

    expect(dictionaries.map((d) => [d.name, d.enabled])).toEqual([
      ['JMdict', false],
      ['KANJIDIC', true]
    ]);
    expect(result.changed).toBe(true);
    expect(result.pending).toEqual([{ title: 'NotYet', enabled: false }]);
  });

  it('keeps a flag pending while its dictionary is missing from the profile', () => {
    const dictionaries = dictionariesWith(['NewDict', true]);
    const pending = [{ title: 'JMdict', enabled: false }];

    const result = applyPendingDictionaryPreferences(dictionaries, pending);

    expect(result.changed).toBe(false);
    expect(result.pending).toBe(pending);
    expect(dictionaries[0].enabled).toBe(true);
  });
});
