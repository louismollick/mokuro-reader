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

/** The downstep positions of the first pitch dictionary that has any for the primary headword. */
export function primaryPitchPositions(entry: TermDictionaryEntry): number[] {
  const pronunciations = entry.pronunciations
    .filter(({ headwordIndex }) => headwordIndex === 0)
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
  return entry.frequencies
    .filter(({ headwordIndex }) => headwordIndex === 0)
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
