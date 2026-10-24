import { expandTextBoxBounds } from '$lib/anki-connect/cropper';
import type { PanelBox, Rect } from './yolo';

function area(r: Rect): number {
  return Math.max(0, r.x2 - r.x1) * Math.max(0, r.y2 - r.y1);
}

function overlapArea(a: Rect, b: Rect): number {
  return area({
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
    x2: Math.min(a.x2, b.x2),
    y2: Math.min(a.y2, b.y2)
  });
}

/**
 * The crop for a mined card: the smallest panel holding at least half of the text box,
 * else the text box padded like upstream's Anki crop. Always clamped to the page.
 */
export function choosePanelCrop(
  panels: PanelBox[],
  textBox: Rect,
  page: { width: number; height: number }
): Rect {
  const textArea = area(textBox);
  let best: PanelBox | undefined;
  for (const panel of panels) {
    if (textArea === 0 || overlapArea(panel, textBox) / textArea < 0.5) continue;
    if (!best || area(panel) < area(best)) best = panel;
  }

  const [x1, y1, x2, y2] = best
    ? [best.x1, best.y1, best.x2, best.y2]
    : expandTextBoxBounds(
        { box: [textBox.x1, textBox.y1, textBox.x2, textBox.y2] },
        { img_width: page.width, img_height: page.height }
      );
  const clampX = (v: number) => Math.min(Math.max(v, 0), page.width);
  const clampY = (v: number) => Math.min(Math.max(v, 0), page.height);
  return { x1: clampX(x1), y1: clampY(y1), x2: clampX(x2), y2: clampY(y2) };
}
