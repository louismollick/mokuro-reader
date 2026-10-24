import { describe, expect, it } from 'vitest';
import { buildBoxText } from './box-text';

describe('buildBoxText', () => {
  it('joins lines like the old joinTextBoxLines: trim, drop empties, strip whitespace', () => {
    expect(buildBoxText(['  日本 ', '', '語 ですね　']).text).toBe('日本語ですね');
  });

  it('maps a line character to its offset in the joined text', () => {
    const box = buildBoxText(['日本', '語です']);
    expect(box.toOffset(0, 0)).toBe(0);
    expect(box.toOffset(0, 1)).toBe(1);
    expect(box.toOffset(1, 0)).toBe(2);
    expect(box.toOffset(1, 2)).toBe(4);
  });

  it('keeps offsets correct when whitespace precedes the character', () => {
    const box = buildBoxText(['  猫 が', ' 走る']);
    expect(box.text).toBe('猫が走る');
    expect(box.toOffset(0, 2)).toBe(0);
    expect(box.toOffset(0, 4)).toBe(1);
    expect(box.toOffset(1, 1)).toBe(2);
  });

  it('maps a dropped whitespace character to the next kept one, clamped into the text', () => {
    const box = buildBoxText(['猫 が']);
    expect(box.toOffset(0, 1)).toBe(1);
    expect(box.toOffset(0, 99)).toBe(1);
    expect(buildBoxText(['  ']).toOffset(0, 0)).toBeNull();
    expect(box.toOffset(5, 0)).toBeNull();
  });

  it('maps a text range back to line runs', () => {
    const box = buildBoxText(['日本', '語です', 'ね']);
    expect(box.spans(1, 4)).toEqual([
      { lineIndex: 0, start: 1, end: 2 },
      { lineIndex: 1, start: 0, end: 2 }
    ]);
    expect(box.spans(4, 99)).toEqual([
      { lineIndex: 1, start: 2, end: 3 },
      { lineIndex: 2, start: 0, end: 1 }
    ]);
    expect(box.spans(3, 3)).toEqual([]);
  });

  it('skips empty lines without shifting later line indices', () => {
    const box = buildBoxText(['', '猫']);
    expect(box.toOffset(1, 0)).toBe(0);
    expect(box.spans(0, 1)).toEqual([{ lineIndex: 1, start: 0, end: 1 }]);
  });
});
