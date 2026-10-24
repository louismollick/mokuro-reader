import { describe, expect, it } from 'vitest';
import { choosePanelCrop } from './choose-panel';
import type { PanelBox } from './yolo';

const page = { width: 800, height: 1200 };
const panel = (x1: number, y1: number, x2: number, y2: number): PanelBox => ({
  x1,
  y1,
  x2,
  y2,
  score: 0.9
});

describe('choosePanelCrop', () => {
  const textBox = { x1: 300, y1: 400, x2: 360, y2: 500 };

  it('picks the smallest panel containing the text box', () => {
    const whole = panel(0, 0, 800, 1200);
    const inner = panel(250, 350, 500, 700);
    expect(choosePanelCrop([whole, inner], textBox, page)).toEqual({
      x1: 250,
      y1: 350,
      x2: 500,
      y2: 700
    });
  });

  it('accepts a panel covering at least half of the text box', () => {
    // Covers exactly the left half of the text box (x 300..330 of 300..360).
    const half = panel(100, 300, 330, 600);
    expect(choosePanelCrop([half], textBox, page)).toMatchObject({ x1: 100, x2: 330 });
  });

  it('ignores panels covering less than half of the text box', () => {
    const sliver = panel(100, 300, 320, 600); // 20 of 60 px wide
    const crop = choosePanelCrop([sliver], textBox, page);
    expect(crop.x1).toBeLessThan(textBox.x1);
    expect(crop.x2).toBeGreaterThan(textBox.x2);
    expect(crop.x2).not.toBe(320);
  });

  it('falls back to the padded text box when there are no panels', () => {
    // 5% of 800 horizontally, 2% of 1200 vertically
    expect(choosePanelCrop([], textBox, page)).toEqual({ x1: 260, y1: 376, x2: 400, y2: 524 });
  });

  it('clamps the fallback and panels to the page', () => {
    expect(choosePanelCrop([], { x1: 0, y1: 0, x2: 50, y2: 50 }, page)).toEqual({
      x1: 0,
      y1: 0,
      x2: 90,
      y2: 74
    });
    expect(choosePanelCrop([panel(-10, -5, 900, 1300)], textBox, page)).toEqual({
      x1: 0,
      y1: 0,
      x2: 800,
      y2: 1200
    });
  });

  it('falls back for an empty text box', () => {
    const empty = { x1: 300, y1: 400, x2: 300, y2: 400 };
    expect(choosePanelCrop([panel(0, 0, 800, 1200)], empty, page)).toEqual({
      x1: 260,
      y1: 376,
      x2: 340,
      y2: 424
    });
  });
});
