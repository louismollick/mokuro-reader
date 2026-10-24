/**
 * Where a tap landed in a Text Box's text, and the page highlight for a Word. Both work on the
 * rendered `.ocr-line` spans (`data-line-index` is the index into the Text Box's lines, which
 * hidden lines skip in the DOM) and convert between DOM positions and `BoxText` offsets.
 */
import type { BoxText, LineSpan } from './box-text';

type CaretPosition = { offsetNode: Node; offset: number };

/** `caretPositionFromPoint` (standard) or `caretRangeFromPoint` (WebKit/Blink), as a position. */
function caretAt(x: number, y: number): CaretPosition | null {
  const standard = (
    document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => CaretPosition | null;
    }
  ).caretPositionFromPoint;
  if (standard) return standard.call(document, x, y);
  const range = document.caretRangeFromPoint?.(x, y);
  return range ? { offsetNode: range.startContainer, offset: range.startOffset } : null;
}

function textNodes(line: Element): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  return nodes;
}

/** A character offset within a line's text as a DOM position (extensions may split the text node). */
function positionInLine(line: Element, charOffset: number): CaretPosition | null {
  let remaining = charOffset;
  const nodes = textNodes(line);
  for (const node of nodes) {
    if (remaining <= node.length) return { offsetNode: node, offset: remaining };
    remaining -= node.length;
  }
  const last = nodes.at(-1);
  return last ? { offsetNode: last, offset: last.length } : null;
}

/** The character offset within a line of a DOM position inside it. */
function charOffsetInLine(line: Element, node: Node, offset: number): number {
  let total = 0;
  for (const text of textNodes(line)) {
    if (text === node) return total + offset;
    total += text.length;
  }
  return total;
}

function lineElement(textBox: Element, lineIndex: number): HTMLElement | null {
  return textBox.querySelector<HTMLElement>(`.ocr-line[data-line-index="${lineIndex}"]`);
}

function containsPoint(rect: DOMRect, x: number, y: number) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/**
 * The character of `line` under the point: the caret lands between characters, so of the two it
 * touches, take the one whose glyph box holds the point.
 */
function charAtCaret(line: Element, caret: CaretPosition, x: number, y: number): number | null {
  const at = charOffsetInLine(line, caret.offsetNode, caret.offset);
  for (const candidate of [at, at - 1]) {
    const start = positionInLine(line, candidate);
    const end = positionInLine(line, candidate + 1);
    if (!start || !end || candidate < 0) continue;
    const range = document.createRange();
    range.setStart(start.offsetNode, start.offset);
    range.setEnd(end.offsetNode, end.offset);
    if (Array.from(range.getClientRects()).some((rect) => containsPoint(rect, x, y))) {
      return candidate;
    }
  }
  return null;
}

/**
 * The character index along a line for a point, by position along the line's reading axis.
 * Approximate (rotated lines use their bounding rect), for when the caret APIs can't see the text.
 */
export function offsetAlongLine(
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  vertical: boolean,
  x: number,
  y: number,
  length: number
): number {
  const size = vertical ? rect.height : rect.width;
  const fraction = size > 0 ? (vertical ? y - rect.top : x - rect.left) / size : 0;
  return Math.min(Math.max(Math.floor(fraction * length), 0), length - 1);
}

/**
 * The character of a line whose glyph box is nearest the point. Hidden text (the normal state of
 * a Text Box) has no hit target but still has layout, so its characters can be measured. Null
 * when the line has no layout at all.
 */
function nearestChar(line: Element, x: number, y: number): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  const length = line.textContent?.length ?? 0;
  for (let char = 0; char < length; char++) {
    const start = positionInLine(line, char);
    const end = positionInLine(line, char + 1);
    if (!start || !end) continue;
    const range = document.createRange();
    range.setStart(start.offsetNode, start.offset);
    range.setEnd(end.offsetNode, end.offset);
    for (const rect of range.getClientRects()) {
      const distance = Math.hypot(
        Math.max(rect.left - x, 0, x - rect.right),
        Math.max(rect.top - y, 0, y - rect.bottom)
      );
      if (distance < bestDistance) {
        best = char;
        bestDistance = distance;
      }
    }
  }
  return best;
}

/** The line whose rect is nearest the point (zero distance when inside). */
function nearestLine(textBox: Element, x: number, y: number): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestDistance = Infinity;
  for (const line of textBox.querySelectorAll<HTMLElement>('.ocr-line[data-line-index]')) {
    const rect = line.getBoundingClientRect();
    const distance = Math.hypot(
      Math.max(rect.left - x, 0, x - rect.right),
      Math.max(rect.top - y, 0, y - rect.bottom)
    );
    if (distance < bestDistance) {
      best = line;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The offset in `box.text` of the character tapped at viewport point (x, y): from the caret APIs
 * when they land in this Text Box's own lines, else geometrically: the nearest character of the
 * nearest line, or the position along the line when the text has no layout. Null when the box has
 * no usable text.
 */
export function tapOffset(
  textBox: HTMLElement,
  box: BoxText,
  lines: readonly string[],
  x: number,
  y: number
): number | null {
  const caret = caretAt(x, y);
  const caretLine =
    caret?.offsetNode.nodeType === Node.TEXT_NODE && textBox.contains(caret.offsetNode)
      ? (caret.offsetNode.parentElement?.closest<HTMLElement>('.ocr-line[data-line-index]') ?? null)
      : null;
  if (caret && caretLine) {
    const char = charAtCaret(caretLine, caret, x, y);
    if (char !== null) return box.toOffset(Number(caretLine.dataset.lineIndex), char);
  }

  const line = nearestLine(textBox, x, y);
  if (!line) return null;
  const lineIndex = Number(line.dataset.lineIndex);
  const length = lines[lineIndex]?.length ?? 0;
  if (length === 0) return null;
  const measured = nearestChar(line, x, y);
  if (measured !== null) return box.toOffset(lineIndex, measured);
  const vertical = getComputedStyle(textBox).writingMode.startsWith('vertical');
  return box.toOffset(
    lineIndex,
    offsetAlongLine(line.getBoundingClientRect(), vertical, x, y, length)
  );
}

const HIGHLIGHT_STYLE =
  'position:absolute;pointer-events:none;box-sizing:border-box;' +
  'outline:1.5px solid #f5c542;background:rgba(245,197,66,0.22);border-radius:2px';

/**
 * Draws the highlight for line runs as absolutely positioned boxes inside the Text Box, so the
 * page's pan and zoom carry them and they show even while the OCR text is hidden. Client rects are
 * converted to the box's local pixels, undoing the reader's CSS scale. Returns a function that
 * removes them.
 */
export function showHighlight(textBox: HTMLElement, spans: readonly LineSpan[]): () => void {
  const boxRect = textBox.getBoundingClientRect();
  if (boxRect.width === 0) return () => {};
  const scale = textBox.offsetWidth / boxRect.width;

  const layer = document.createElement('div');
  layer.dataset.lookupHighlight = '';
  layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:visible';

  for (const span of spans) {
    const line = lineElement(textBox, span.lineIndex);
    const start = line && positionInLine(line, span.start);
    const end = line && positionInLine(line, span.end);
    if (!start || !end) continue;
    const range = document.createRange();
    range.setStart(start.offsetNode, start.offset);
    range.setEnd(end.offsetNode, end.offset);
    for (const rect of range.getClientRects()) {
      const mark = document.createElement('div');
      mark.style.cssText = HIGHLIGHT_STYLE;
      mark.style.left = `${(rect.left - boxRect.left) * scale - textBox.clientLeft}px`;
      mark.style.top = `${(rect.top - boxRect.top) * scale - textBox.clientTop}px`;
      mark.style.width = `${rect.width * scale}px`;
      mark.style.height = `${rect.height * scale}px`;
      layer.append(mark);
    }
  }

  textBox.append(layer);
  return () => layer.remove();
}
