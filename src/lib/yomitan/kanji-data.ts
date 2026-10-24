/**
 * Readers for the kanji dictionaries behind the Kanji View. Each dictionary has its own row format
 * (see the per-function notes), identified by the dictionary's title; everything is pure so the
 * formats are covered by tests built from real rows.
 */
import type { KanjiDictionaryEntry } from 'yomitan-core';

/** The part of a kanji entry the parsers read. */
export type KanjiEntryLike = Pick<
  KanjiDictionaryEntry,
  'dictionary' | 'onyomi' | 'kunyomi' | 'definitions'
> & {
  stats: Record<string, { name: string; value: number | string }[]>;
};

export interface KanjiReading {
  reading: string;
  /** Share of the kanji's words using this reading, when the dictionary says (JPDB Kanji). */
  percent?: number;
}

export interface KanjiInfo {
  character: string;
  /** The first KANJIDIC meaning. */
  keyword?: string;
  /** The other KANJIDIC meanings. */
  meanings: string[];
  /** `Grade 1 · N4 · 8 strokes · #63`, missing parts omitted. */
  statsLine: string;
  readings: KanjiReading[];
  components: string[];
  similar: string[];
  /** Whether any installed dictionary knows this kanji. */
  known: boolean;
}

const isKanjidic = ({ dictionary }: KanjiEntryLike) => dictionary.startsWith('KANJIDIC');
const isJpdbKanji = ({ dictionary }: KanjiEntryLike) => dictionary === 'JPDB Kanji';
const isTheKanjiMap = ({ dictionary }: KanjiEntryLike) => dictionary.startsWith('TheKanjiMap');
const isSimilarKanji = ({ dictionary }: KanjiEntryLike) => dictionary === 'Similar Kanji';

/** `\s` includes the ideographic space TheKanjiMap separates parts with. */
const splitParts = (text: string) => text.split(/\s+/).filter(Boolean);

/**
 * KANJIDIC_english: `definitions` are the meanings, `stats` hold `grade`, `jlpt`, `strokes` and
 * `freq` (newspaper frequency rank) as strings, `onyomi` / `kunyomi` the readings (`まな.ぶ`).
 */
export function parseKanjidic(entry: KanjiEntryLike) {
  const stat = (name: string) => {
    for (const group of Object.values(entry.stats)) {
      const found = group.find((item) => item.name === name);
      if (found) return String(found.value);
    }
  };
  const parts = [
    stat('grade') && `Grade ${stat('grade')}`,
    stat('jlpt') && `N${stat('jlpt')}`,
    stat('strokes') && `${stat('strokes')} stroke${stat('strokes') === '1' ? '' : 's'}`,
    stat('freq') && `#${stat('freq')}`
  ].filter(Boolean);
  return {
    keyword: entry.definitions[0],
    meanings: entry.definitions.slice(1),
    statsLine: parts.join(' · '),
    readings: [...entry.onyomi, ...entry.kunyomi].map((reading) => ({ reading }))
  };
}

/**
 * JPDB Kanji: readings with their share of words, `がく(69%)`, as the on and kun fields (some
 * readings carry no share and are dropped). The meanings list is example words, then an empty
 * string, `漢字分解:` and a space-separated list of components.
 */
export function parseJpdbKanji(entry: KanjiEntryLike) {
  const readings = [...entry.onyomi, ...entry.kunyomi].flatMap((item) => {
    const match = /^(.+)\((\d+)%\)$/.exec(item);
    return match ? [{ reading: match[1], percent: Number(match[2]) }] : [];
  });
  const marker = entry.definitions.indexOf('漢字分解:');
  const components = marker >= 0 ? splitParts(entry.definitions[marker + 1] ?? '') : [];
  return { readings, components };
}

/**
 * TheKanjiMap Kanji Radicals/Composition has several rows per kanji; the one whose first line is
 * `＝＝＝＝＝分解＝＝＝＝＝` lists the components, one or more per line, separated by spaces.
 */
export function parseTheKanjiMapComponents(entry: KanjiEntryLike): string[] {
  const [heading, ...lines] = entry.definitions;
  return heading?.includes('分解') ? lines.flatMap(splitParts) : [];
}

/** Similar Kanji (built by scripts/build-similar-kanji-dictionary.mjs): the meanings are the similar kanji. */
export function parseSimilarKanji(entry: KanjiEntryLike): string[] {
  return entry.definitions;
}

/** Merges whatever the installed dictionaries know about one kanji (`lookup.kanji` results). */
export function parseKanjiInfo(character: string, entries: readonly KanjiEntryLike[]): KanjiInfo {
  const kanjidic = entries.find(isKanjidic);
  const jpdb = entries.find(isJpdbKanji);
  const jpdbData = jpdb && parseJpdbKanji(jpdb);
  const kanjidicData = kanjidic && parseKanjidic(kanjidic);

  const theKanjiMap = entries.filter(isTheKanjiMap).flatMap(parseTheKanjiMapComponents);
  const components = theKanjiMap.length > 0 ? theKanjiMap : (jpdbData?.components ?? []);

  return {
    character,
    keyword: kanjidicData?.keyword,
    meanings: kanjidicData?.meanings ?? [],
    statsLine: kanjidicData?.statsLine ?? '',
    readings: jpdbData?.readings.length ? jpdbData.readings : (kanjidicData?.readings ?? []),
    components,
    similar: entries.filter(isSimilarKanji).flatMap(parseSimilarKanji),
    known: entries.length > 0
  };
}

/** A `character => KanjiInfo` loader over `lookup.kanji` that asks the engine once per kanji. */
export function createKanjiInfoLoader(
  lookupKanji: (character: string) => Promise<KanjiEntryLike[]>
) {
  const cache = new Map<string, Promise<KanjiInfo>>();
  return (character: string): Promise<KanjiInfo> => {
    let info = cache.get(character);
    if (!info) {
      info = lookupKanji(character).then((entries) => parseKanjiInfo(character, entries));
      cache.set(character, info);
    }
    return info;
  };
}
