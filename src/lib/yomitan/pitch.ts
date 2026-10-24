/**
 * Pitch accent helpers, ported from hatsuon (https://github.com/DJTB/hatsuon, MIT) as used by Kiku.
 * A pitch accent is the downstep position `n`: 0 = heiban (flat, no drop), 1 = atamadaka (high on
 * the first mora only), n >= 2 = nakadaka or odaka (rises after the first mora, drops after mora n).
 */

const SMALL_KANA = new Set('ぁぃぅぇぉゃゅょゎゕゖァィゥェォャュョヮヵヶ');

/** Splits kana into morae: a small kana joins the mora before it (しゅ), っ ん ー stand alone. */
export function getMorae(reading: string): string[] {
  const morae: string[] = [];
  for (const char of reading) {
    if (SMALL_KANA.has(char) && morae.length > 0) morae[morae.length - 1] += char;
    else morae.push(char);
  }
  return morae;
}

export interface PitchMora {
  text: string;
  /** Drawn with an overline. */
  high: boolean;
  /** The pitch drops right after this mora (draw the downstep tick). */
  downstep: boolean;
}

/**
 * The reading split into morae with their pitch. Empty if `position` is not a valid downstep for
 * this reading (a downstep after the last mora is odaka and valid; beyond it is not).
 */
export function pitchMorae(reading: string, position: number): PitchMora[] {
  const morae = getMorae(reading);
  if (!Number.isInteger(position) || position < 0 || position > morae.length) return [];
  return morae.map((text, i) => ({
    text,
    high: position === 0 ? i > 0 : position === 1 ? i === 0 : i > 0 && i < position,
    downstep: position > 0 && i === position - 1
  }));
}
