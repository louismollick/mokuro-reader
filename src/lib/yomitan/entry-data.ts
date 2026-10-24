/** Small readers over a term entry for the Word View's headword row. Pure; no DOM. */
import type { TermDictionaryEntry } from 'yomitan-core';

export interface FuriganaSegment {
  text: string;
  /** Empty for kana. */
  reading: string;
}

const toHiragana = (text: string) =>
  text.replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));
const isKana = (char: string) => /[ぁ-ゖァ-ヺー]/.test(char);

/** Runs of the term that are all kana or all non-kana. */
function groupTerm(term: string): { kana: boolean; text: string }[] {
  const groups: { kana: boolean; text: string }[] = [];
  for (const char of term) {
    const kana = isKana(char);
    const last = groups.at(-1);
    if (last && last.kana === kana) last.text += char;
    else groups.push({ kana, text: char });
  }
  return groups;
}

/** Assigns the reading to the term's groups, kana groups matching themselves; null if it can't. */
function segmentize(
  reading: string,
  groups: { kana: boolean; text: string }[],
  index: number
): FuriganaSegment[] | null {
  const group = groups[index];
  if (!group) return reading === '' ? [] : null;

  if (group.kana) {
    if (!toHiragana(reading).startsWith(toHiragana(group.text))) return null;
    const rest = segmentize(reading.slice(group.text.length), groups, index + 1);
    return rest && [{ text: group.text, reading: '' }, ...rest];
  }

  // The last kanji group takes everything left; earlier ones try the longest reading first.
  const last = index === groups.length - 1;
  for (let end = reading.length; end >= group.text.length; end--) {
    const rest = segmentize(reading.slice(end), groups, index + 1);
    if (rest) return [{ text: group.text, reading: reading.slice(0, end) }, ...rest];
    if (last) break;
  }
  return null;
}

/**
 * Splits a term into furigana segments: 食べる + たべる → [食 た, べ, る] style runs, so kana
 * inside the term carry no ruby. If the reading can't be aligned, the whole term gets it.
 */
export function distributeFurigana(term: string, reading: string): FuriganaSegment[] {
  if (!reading || toHiragana(reading) === toHiragana(term)) return [{ text: term, reading: '' }];
  return segmentize(reading, groupTerm(term), 0) ?? [{ text: term, reading }];
}

/**
 * The headword the lookup matched. In a merged entry (one per word, carrying every spelling and
 * reading) that is the first one with a primary source, not the entry's other forms.
 */
export function primaryHeadword(
  entry: TermDictionaryEntry
): TermDictionaryEntry['headwords'][number] {
  return (
    entry.headwords.find(({ sources }) => sources.some(({ isPrimary }) => isPrimary)) ??
    entry.headwords[0]
  );
}

/** Identifies an entry's Word within a Lookup Sheet session (Anki state, Panel Crop). */
export function headwordKey(entry: TermDictionaryEntry): string {
  const { term, reading } = primaryHeadword(entry);
  return `${term}|${reading}`;
}

/**
 * The entries with an exact primary match over the whole `length` of the span, dropping the
 * shorter prefix matches a lookup also returns (the rule of yomitan-core's `segment`). Falls back
 * to all entries when none covers the span, as for a selection that isn't a Word.
 */
export function entriesCoveringSpan(
  entries: TermDictionaryEntry[],
  length: number
): TermDictionaryEntry[] {
  const covering = entries.filter(({ headwords }) =>
    headwords.some(({ sources }) =>
      sources.some(
        ({ matchType, isPrimary, originalText }) =>
          matchType === 'exact' && isPrimary && originalText.length === length
      )
    )
  );
  return covering.length > 0 ? covering : entries;
}

/**
 * The entry's other readings of the primary spelling, then its other spellings, for one small
 * line under the headword (`ゆう · 云う · 謂う`).
 */
export function alternateForms(entry: TermDictionaryEntry): string[] {
  const primary = primaryHeadword(entry);
  const readings = entry.headwords
    .filter(({ term }) => term === primary.term)
    .map(({ reading }) => reading);
  const spellings = entry.headwords.map(({ term }) => term);
  return [...new Set([...readings, ...spellings])].filter(
    (form) => form !== primary.reading && form !== primary.term && form !== ''
  );
}

/** The downstep positions of the first pitch dictionary that has any for the primary headword. */
export function primaryPitchPositions(entry: TermDictionaryEntry): number[] {
  const { headwordIndex: primaryIndex } = primaryHeadword(entry);
  const pronunciations = entry.pronunciations
    .filter(({ headwordIndex }) => headwordIndex === primaryIndex)
    .sort((a, b) => a.dictionaryIndex - b.dictionaryIndex);
  for (const { pronunciations: pitches } of pronunciations) {
    const positions = pitches.flatMap((pitch) =>
      pitch.type === 'pitch-accent' && /^\d+$/.test(String(pitch.positions))
        ? [Number(pitch.positions)]
        : []
    );
    if (positions.length > 0) return [...new Set(positions)];
  }
  return [];
}

export interface FrequencyLabel {
  /** `#1,835` for a rank, `1,835×` for an occurrence count. */
  value: string;
  /** The dictionary's name without a parenthetical: `Jiten (Manga)` becomes `Jiten`. */
  name: string;
}

/** One value per frequency dictionary for the primary headword, in profile order. */
export function frequencyLabels(entry: TermDictionaryEntry): FrequencyLabel[] {
  const seen = new Set<string>();
  const { headwordIndex: primaryIndex } = primaryHeadword(entry);
  return entry.frequencies
    .filter(({ headwordIndex }) => headwordIndex === primaryIndex)
    .sort((a, b) => a.dictionaryIndex - b.dictionaryIndex)
    .flatMap((frequency) => {
      if (seen.has(frequency.dictionary)) return [];
      seen.add(frequency.dictionary);
      const count = frequency.frequency.toLocaleString('en-US');
      return {
        value: frequency.frequencyMode === 'occurrence-based' ? `${count}×` : `#${count}`,
        name: frequency.dictionaryAlias.replace(/\s*\(.*\)\s*$/, '')
      };
    });
}

/** The deinflection steps from the looked-up form to this entry, e.g. `['negative', 'past']`. */
export function inflectionNames(entry: TermDictionaryEntry): string[] {
  return entry.inflectionRuleChainCandidates[0]?.inflectionRules.map(({ name }) => name) ?? [];
}
