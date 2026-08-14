import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildEnabledDictionaries,
  buildEnabledKanjiDictionaries,
  disposeYomitan,
  getInstalledDictionaries
} from './core';

const lifecycleMocks = vi.hoisted(() => ({
  createYomitan: vi.fn(),
  DictionaryDB: vi.fn(() => ({}))
}));

vi.mock('yomitan-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('yomitan-core')>()),
  createYomitan: lifecycleMocks.createYomitan,
  DictionaryDB: lifecycleMocks.DictionaryDB
}));

beforeEach(async () => {
  await disposeYomitan();
  vi.clearAllMocks();
});

describe('Yomitan client lifecycle', () => {
  it('shares pending initialization and does not restore a client disposed during startup', async () => {
    let finishInitialization = () => {};
    const initialization = new Promise<void>((resolve) => {
      finishInitialization = resolve;
    });
    const firstClient = {
      initialize: vi.fn(() => initialization),
      dispose: vi.fn(async () => {}),
      dictionaries: { list: vi.fn(async () => []) }
    };
    const secondClient = {
      initialize: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
      dictionaries: { list: vi.fn(async () => []) }
    };
    lifecycleMocks.createYomitan.mockReturnValueOnce(firstClient).mockReturnValueOnce(secondClient);

    const firstLookup = getInstalledDictionaries();
    const secondLookup = getInstalledDictionaries();
    const lookupOutcomes = Promise.allSettled([firstLookup, secondLookup]);
    const disposal = disposeYomitan();
    finishInitialization();

    await disposal;
    expect(await lookupOutcomes).toEqual([
      expect.objectContaining({ status: 'rejected' }),
      expect.objectContaining({ status: 'rejected' })
    ]);
    expect(lifecycleMocks.createYomitan).toHaveBeenCalledTimes(1);
    expect(firstClient.dispose).toHaveBeenCalledTimes(1);

    await expect(getInstalledDictionaries()).resolves.toEqual([]);
    expect(lifecycleMocks.createYomitan).toHaveBeenCalledTimes(2);
  });
});

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
