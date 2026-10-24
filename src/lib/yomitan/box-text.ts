/** A run of characters inside one OCR line: `[start, end)` in that line's own text. */
export interface LineSpan {
  lineIndex: number;
  start: number;
  end: number;
}

export interface BoxText {
  /** The Text Box's lines joined with all whitespace removed: the string Segmentation sees. */
  text: string;
  /**
   * The offset in `text` of character `charOffset` of line `lineIndex`. A whitespace character
   * (dropped from `text`) maps to the next kept character; clamped into `text`. Null if `text`
   * is empty.
   */
  toOffset(lineIndex: number, charOffset: number): number | null;
  /** The line runs holding `text[start, end)`, in reading order (for the page highlight). */
  spans(start: number, end: number): LineSpan[];
}

/**
 * Joins a Text Box's lines into the string Segmentation works on and keeps the mapping back to
 * each line's characters, so a tap on the page (line + character) and a highlight on the page
 * (line + character range) survive whitespace removal. Lines are trimmed, empty ones dropped and
 * all whitespace stripped.
 */
export function buildBoxText(lines: readonly string[]): BoxText {
  let text = '';
  const lineOf: number[] = [];
  const charOf: number[] = [];
  /** `nextKept[line][char]` = index in `text` of the first kept character at or after `char`. */
  const nextKept: number[][] = [];

  lines.forEach((line, lineIndex) => {
    const next: number[] = new Array(line.length + 1);
    for (let i = 0; i < line.length; i++) {
      next[i] = text.length;
      if (/\s/.test(line[i])) continue;
      text += line[i];
      lineOf.push(lineIndex);
      charOf.push(i);
    }
    next[line.length] = text.length;
    nextKept.push(next);
  });

  return {
    text,
    toOffset(lineIndex, charOffset) {
      const next = nextKept[lineIndex];
      if (!next || text.length === 0) return null;
      const offset = next[Math.min(Math.max(charOffset, 0), next.length - 1)];
      return Math.min(offset, text.length - 1);
    },
    spans(start, end) {
      const spans: LineSpan[] = [];
      for (let i = Math.max(start, 0); i < Math.min(end, text.length); i++) {
        const last = spans.at(-1);
        if (last && last.lineIndex === lineOf[i]) last.end = charOf[i] + 1;
        else spans.push({ lineIndex: lineOf[i], start: charOf[i], end: charOf[i] + 1 });
      }
      return spans;
    }
  };
}
