import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TermDictionaryEntry, Yomitan } from 'yomitan-core';
import { createViewLoader } from './lookup-loader';

/** A merged entry for `term`/`reading` whose only gloss is `gloss`, matched over the whole text. */
const entryFor = (term: string, reading: string, gloss: string) =>
  ({
    headwords: [
      {
        term,
        reading,
        sources: [{ isPrimary: true, matchType: 'exact', originalText: term }]
      }
    ],
    definitions: [{ entries: [gloss] }]
  }) as unknown as TermDictionaryEntry;

function fakeClient() {
  const glosses: Record<string, TermDictionaryEntry> = {
    物語: entryFor('物語', 'ものがたり', 'story'),
    語学: entryFor('語学', 'ごがく', 'language study')
  };
  return {
    lookup: {
      terms: vi.fn(async (text: string) => ({ entries: glosses[text] ? [glosses[text]] : [] })),
      kanji: vi.fn(async () => []),
      termsContaining: vi.fn(async () => [
        { term: '物語', reading: 'ものがたり', frequency: 977 },
        { term: '語学', reading: 'ごがく', frequency: 4210 }
      ])
    },
    render: { glossaries: vi.fn(async () => [{ dictionary: 'D', html: '<p>x</p>' }]) }
  };
}

describe('createViewLoader', () => {
  afterEach(() => vi.useRealTimers());

  it('loads a Word View whole: entries and their glossaries, once per text', async () => {
    const client = fakeClient();
    const loader = createViewLoader(client as unknown as Yomitan);
    const view = { kind: 'term', query: '物語' } as const;
    const data = await loader.load(view, '物語');
    expect(data).toMatchObject({ kind: 'word', glossaries: [[{ dictionary: 'D' }]] });
    expect(await loader.load(view, '物語')).toBe(data);
    expect(client.render.glossaries).toHaveBeenCalledTimes(1);
  });

  it('gives Common Words their first gloss, reusing the lookups a Word View would make', async () => {
    const client = fakeClient();
    const loader = createViewLoader(client as unknown as Yomitan);
    const data = await loader.load({ kind: 'kanji', character: '語' }, null);
    expect(data.kind === 'kanji' && data.words.map(({ term, gloss }) => [term, gloss])).toEqual([
      ['物語', 'story'],
      ['語学', 'language study']
    ]);
    await loader.load({ kind: 'term', query: '語学' }, '語学');
    expect(client.lookup.terms.mock.calls.filter(([text]) => text === '語学')).toHaveLength(1);
  });

  it('retries Common Words while the kanji-term index is busy, and never caches a failure', async () => {
    vi.useFakeTimers();
    const client = fakeClient();
    client.lookup.termsContaining
      .mockRejectedValueOnce(new Error('busy'))
      .mockRejectedValueOnce(new Error('busy'))
      .mockRejectedValueOnce(new Error('busy'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loader = createViewLoader(client as unknown as Yomitan);
    const view = { kind: 'kanji', character: '語' } as const;

    const loading = loader.load(view, null);
    await vi.runAllTimersAsync();
    const first = await loading;
    expect(first.kind === 'kanji' && first.words).toEqual([]);
    expect(client.lookup.termsContaining).toHaveBeenCalledTimes(3);

    // Asking again (going back and forth) tries once more, and now the index answers.
    const second = await loader.load(view, null);
    expect(second.kind === 'kanji' && second.words).toHaveLength(2);
  });
});
