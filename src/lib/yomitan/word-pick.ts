/** The part of a Segmentation token that picking a Word looks at (`SegmentToken` fits). */
interface PickableToken {
  range: { start: number; end: number };
  entries: readonly unknown[];
}

/**
 * The index of the Word a tap at `offset` selects: the token holding the offset if it matched
 * dictionary entries, else the nearest matched token in the same Text Box (the following one on a
 * tie). Null when nothing in the box matched, so the sheet shows the Sentence with "No match".
 */
export function pickWordIndex(tokens: readonly PickableToken[], offset: number): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  tokens.forEach(({ range, entries }, index) => {
    if (entries.length === 0) return;
    // Zero inside the token; otherwise characters between the offset and the token's nearest edge.
    const distance =
      offset < range.start
        ? range.start - offset
        : offset >= range.end
          ? offset - range.end + 1
          : 0;
    // `<` keeps the earlier of two equidistant tokens, so `<=` after the offset prefers the follower.
    if (distance < bestDistance || (distance === bestDistance && range.start > offset)) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}
