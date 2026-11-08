/**
 * Loads everything a Lookup Sheet view shows before the sheet swaps to it, so a view appears
 * whole instead of section by section, and caches it for the sheet's session so going back (or
 * opening a Common Word whose entries the Kanji View already fetched) is instant.
 */
import type { GlossaryBlock, KanjiTerm, TermDictionaryEntry, Yomitan } from 'yomitan-core';
import { entriesCoveringSpan, firstGloss } from './entry-data';
import { createKanjiInfoLoader, type KanjiInfo } from './kanji-data';
import type { LookupView } from './lookup-session';

export interface WordData {
  kind: 'word';
  /** Best first; empty when nothing matched. */
  entries: TermDictionaryEntry[];
  /** Each entry's glossaries, split by dictionary (`render.glossaries`). */
  glossaries: GlossaryBlock[][];
}

export interface CommonWord extends KanjiTerm {
  /** The first gloss of the word's first sense; '' when no dictionary defines it. */
  gloss: string;
}

export interface KanjiData {
  kind: 'kanji';
  info: KanjiInfo;
  words: CommonWord[];
  similar: KanjiInfo[];
  parts: KanjiInfo[];
}

export type ViewData = WordData | KanjiData;

/** How many Common Words the Kanji View lists. */
export const COMMON_WORDS_LIMIT = 10;
/** Waits before retrying the kanji-term index, which is busy while it is first built. */
const TERMS_CONTAINING_RETRIES = [400, 1200];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `termsContaining`, retried while the index is being built or the storage is busy. Waits for
 * the warm-up first: while it builds the index, the engine hides the dictionary and answers `[]`.
 */
async function termsContaining(client: Yomitan, character: string): Promise<KanjiTerm[] | null> {
  await warmUpCommonWords(client);
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.lookup.termsContaining(character, { limit: COMMON_WORDS_LIMIT });
    } catch (error) {
      if (attempt >= TERMS_CONTAINING_RETRIES.length) {
        console.warn(`Common Words for ${character} failed:`, error);
        return null;
      }
      await wait(TERMS_CONTAINING_RETRIES[attempt]);
    }
  }
}

const warmUps = new WeakMap<Yomitan, Promise<unknown>>();

/**
 * Builds the frequency dictionary's kanji-term index in the background if it was never built
 * (dictionaries imported before the index existed get it on first use, which takes seconds), so
 * the first Kanji View doesn't wait for it. Once per client; a failed warm-up runs again later.
 */
export function warmUpCommonWords(client: Yomitan): Promise<unknown> {
  let warming = warmUps.get(client);
  if (!warming) {
    warming = client.lookup.termsContaining('日', { limit: 1 }).catch(() => {
      warmUps.delete(client);
    });
    warmUps.set(client, warming);
  }
  return warming;
}

/** The view loader for one Lookup Sheet session. */
export function createViewLoader(client: Yomitan) {
  const entriesByText = new Map<string, Promise<TermDictionaryEntry[]>>();
  const views = new Map<string, Promise<ViewData>>();
  const loadKanjiInfo = createKanjiInfoLoader((character) => client.lookup.kanji(character));

  /**
   * The entries the Word View shows for a text: a merge-mode lookup, so a word with several
   * readings or spellings is one entry, without the shorter prefix matches (Segmentation itself
   * is unchanged). Falls back to `fallback` (the segmentation's own entries) if the lookup fails.
   */
  function lookUp(text: string) {
    let found = entriesByText.get(text);
    if (!found) {
      found = client.lookup
        .terms(text, { mode: 'merge' })
        .then(({ entries }) => entriesCoveringSpan(entries, text.length));
      entriesByText.set(text, found);
      // A failed lookup is asked again next time.
      found.catch(() => entriesByText.delete(text));
    }
    return found;
  }

  /** The lookup's entries, else `fallback`; `complete` is false when the lookup failed. */
  async function entries(text: string, fallback: TermDictionaryEntry[] = []) {
    try {
      const found = await lookUp(text);
      return { entries: found.length > 0 ? found : fallback, complete: true };
    } catch {
      return { entries: fallback, complete: false };
    }
  }

  async function word(text: string, fallback?: TermDictionaryEntry[]) {
    const { entries: found, complete } = await entries(text, fallback);
    const glossaries = await Promise.all(
      found.map((entry) => client.render.glossaries(entry, { media: 'placeholder' }))
    );
    const data: WordData = { kind: 'word', entries: found, glossaries };
    return { data, complete };
  }

  /** The gloss of the entry that has this term (and reading), as the Word View would show it. */
  async function commonWord(term: KanjiTerm): Promise<{ word: CommonWord; complete: boolean }> {
    const { entries: found, complete } = await entries(term.term);
    const match =
      found.find(({ headwords }) =>
        headwords.some(
          (headword) =>
            headword.term === term.term && (!term.reading || headword.reading === term.reading)
        )
      ) ?? found[0];
    return { word: { ...term, gloss: match ? firstGloss(match) : '' }, complete };
  }

  async function kanji(character: string): Promise<{ data: KanjiData; complete: boolean }> {
    const [info, terms] = await Promise.all([
      loadKanjiInfo(character),
      termsContaining(client, character)
    ]);
    const [common, similar, parts] = await Promise.all([
      Promise.all((terms ?? []).map(commonWord)),
      Promise.all(info.similar.map(loadKanjiInfo)),
      Promise.all(info.components.map(loadKanjiInfo))
    ]);
    const words = common.map(({ word }) => word);
    // Missing words or glosses are looked up again the next time the view is asked for.
    const complete = terms !== null && common.every((word) => word.complete);
    return { data: { kind: 'kanji', info, words, similar, parts }, complete };
  }

  /**
   * Everything `view` shows. `fallback` is the Text Box Word's own entries from Segmentation.
   * Failures, and Kanji Views whose Common Words could not load, are not cached: asking again
   * retries.
   */
  function load(view: LookupView, text: string | null, fallback?: TermDictionaryEntry[]) {
    const key = view.kind === 'kanji' ? `kanji|${view.character}` : `word|${text ?? ''}`;
    let data = views.get(key);
    if (!data) {
      const loading =
        view.kind === 'kanji'
          ? kanji(view.character)
          : text === null
            ? Promise.resolve({ data: emptyWord, complete: true })
            : word(text, fallback);
      data = loading.then(({ data, complete }) => {
        if (!complete) views.delete(key);
        return data;
      });
      views.set(key, data);
      data.catch(() => views.delete(key));
    }
    return data;
  }

  return { load };
}

const emptyWord: WordData = { kind: 'word', entries: [], glossaries: [] };

export type ViewLoader = ReturnType<typeof createViewLoader>;
