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

/** `termsContaining`, retried while the index is being built or the storage is busy. */
async function termsContaining(client: Yomitan, character: string): Promise<KanjiTerm[] | null> {
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

const warmed = new WeakSet<Yomitan>();

/**
 * Builds the frequency dictionary's kanji-term index in the background if it was never built
 * (dictionaries imported before the index existed get it on first use, which takes seconds), so
 * the first Kanji View doesn't wait for it. Once per client.
 */
export function warmUpCommonWords(client: Yomitan) {
  if (warmed.has(client)) return;
  warmed.add(client);
  client.lookup.termsContaining('日', { limit: 1 }).catch(() => warmed.delete(client));
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
  function entries(text: string, fallback: TermDictionaryEntry[] = []) {
    let found = entriesByText.get(text);
    if (!found) {
      found = client.lookup
        .terms(text, { mode: 'merge' })
        .then(({ entries }) =>
          entries.length > 0 ? entriesCoveringSpan(entries, text.length) : fallback
        )
        .catch(() => fallback);
      entriesByText.set(text, found);
    }
    return found;
  }

  async function word(text: string, fallback?: TermDictionaryEntry[]): Promise<WordData> {
    const found = await entries(text, fallback);
    const glossaries = await Promise.all(
      found.map((entry) => client.render.glossaries(entry, { media: 'placeholder' }))
    );
    return { kind: 'word', entries: found, glossaries };
  }

  /** The gloss of the entry that has this term (and reading), as the Word View would show it. */
  async function commonWord(term: KanjiTerm): Promise<CommonWord> {
    const found = await entries(term.term);
    const match =
      found.find(({ headwords }) =>
        headwords.some(
          (headword) =>
            headword.term === term.term && (!term.reading || headword.reading === term.reading)
        )
      ) ?? found[0];
    return { ...term, gloss: match ? firstGloss(match) : '' };
  }

  async function kanji(character: string): Promise<{ data: KanjiData; complete: boolean }> {
    const [info, terms] = await Promise.all([
      loadKanjiInfo(character),
      termsContaining(client, character)
    ]);
    const [words, similar, parts] = await Promise.all([
      Promise.all((terms ?? []).map(commonWord)),
      Promise.all(info.similar.map(loadKanjiInfo)),
      Promise.all(info.components.map(loadKanjiInfo))
    ]);
    return { data: { kind: 'kanji', info, words, similar, parts }, complete: terms !== null };
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
      if (view.kind === 'kanji') {
        data = kanji(view.character).then(({ data, complete }) => {
          if (!complete) views.delete(key);
          return data;
        });
      } else {
        data = text === null ? Promise.resolve(emptyWord) : word(text, fallback);
      }
      views.set(key, data);
      data.catch(() => views.delete(key));
    }
    return data;
  }

  return { load };
}

const emptyWord: WordData = { kind: 'word', entries: [], glossaries: [] };

export type ViewLoader = ReturnType<typeof createViewLoader>;
