import { describe, expect, it } from 'vitest';
import { joinTextBoxLines } from './text';

describe('joinTextBoxLines', () => {
  it('joins trimmed non-empty lines and strips whitespace', () => {
    expect(joinTextBoxLines([' 日本 ', '', '語 です　ね'])).toBe('日本語ですね');
  });
});
