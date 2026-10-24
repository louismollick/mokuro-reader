import { describe, expect, it } from 'vitest';
import { offsetAlongLine } from './box-dom';

const rect = { left: 100, top: 50, width: 20, height: 200 };

describe('offsetAlongLine', () => {
  it('maps the position along a vertical line, top to bottom', () => {
    expect(offsetAlongLine(rect, true, 110, 50, 10)).toBe(0);
    expect(offsetAlongLine(rect, true, 110, 149, 10)).toBe(4);
    expect(offsetAlongLine(rect, true, 110, 249, 10)).toBe(9);
  });

  it('maps the position along a horizontal line, left to right', () => {
    const wide = { left: 0, top: 0, width: 100, height: 20 };
    expect(offsetAlongLine(wide, false, 25, 10, 4)).toBe(1);
    expect(offsetAlongLine(wide, false, 99, 10, 4)).toBe(3);
  });

  it('clamps points outside the line into it', () => {
    expect(offsetAlongLine(rect, true, 110, -500, 10)).toBe(0);
    expect(offsetAlongLine(rect, true, 110, 9999, 10)).toBe(9);
    expect(offsetAlongLine({ ...rect, height: 0 }, true, 110, 60, 5)).toBe(0);
  });
});
