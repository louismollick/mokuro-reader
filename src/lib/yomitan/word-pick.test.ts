import { describe, expect, it } from 'vitest';
import { pickWordIndex } from './word-pick';

const hit = (start: number, end: number) => ({ range: { start, end }, entries: [{}] });
const miss = (start: number, end: number) => ({ range: { start, end }, entries: [] });

describe('pickWordIndex', () => {
  it('picks the matched token holding the offset', () => {
    const tokens = [hit(0, 2), hit(2, 5), hit(5, 6)];
    expect(pickWordIndex(tokens, 3)).toBe(1);
    expect(pickWordIndex(tokens, 2)).toBe(1);
  });

  it('falls back to the nearest matched token when the tapped span has no entries', () => {
    const tokens = [hit(0, 2), miss(2, 3), miss(3, 4), hit(4, 6)];
    expect(pickWordIndex(tokens, 2)).toBe(0);
    expect(pickWordIndex(tokens, 3)).toBe(3);
  });

  it('prefers the following token when both neighbours are equally near', () => {
    const tokens = [hit(0, 2), miss(2, 4), hit(4, 6)];
    expect(pickWordIndex(tokens, 2)).toBe(0);
    expect(pickWordIndex(tokens, 3)).toBe(2);
    expect(pickWordIndex([hit(0, 1), miss(1, 2), hit(2, 3)], 1)).toBe(2);
  });

  it('returns null when nothing in the box matched', () => {
    expect(pickWordIndex([miss(0, 3)], 1)).toBeNull();
    expect(pickWordIndex([], 0)).toBeNull();
  });
});
