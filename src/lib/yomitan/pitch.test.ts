import { describe, expect, it } from 'vitest';
import { getMorae, pitchMorae } from './pitch';

const highs = (reading: string, position: number) =>
  pitchMorae(reading, position).map(({ high }) => (high ? 1 : 0));

describe('getMorae', () => {
  it('keeps small kana with the mora before them', () => {
    expect(getMorae('しゅう')).toEqual(['しゅ', 'う']);
    expect(getMorae('ファイル')).toEqual(['ファ', 'イ', 'ル']);
  });

  it('counts っ ん ー as morae', () => {
    expect(getMorae('がっこう')).toEqual(['が', 'っ', 'こ', 'う']);
    expect(getMorae('らーめん')).toHaveLength(4);
  });
});

describe('pitchMorae', () => {
  it('heiban: low then high, no downstep', () => {
    expect(highs('さくら', 0)).toEqual([0, 1, 1]);
    expect(pitchMorae('さくら', 0).some((mora) => mora.downstep)).toBe(false);
  });

  it('atamadaka: only the first mora is high', () => {
    expect(highs('いのち', 1)).toEqual([1, 0, 0]);
    expect(pitchMorae('いのち', 1)[0].downstep).toBe(true);
  });

  it('nakadaka: high from the second mora up to the downstep', () => {
    expect(highs('たまご', 2)).toEqual([0, 1, 0]);
    expect(highs('おとうと', 3)).toEqual([0, 1, 1, 0]);
    expect(pitchMorae('おとうと', 3)[2].downstep).toBe(true);
  });

  it('odaka: high to the last mora, the drop is after it', () => {
    expect(highs('はな', 2)).toEqual([0, 1]);
    expect(pitchMorae('はな', 2)[1].downstep).toBe(true);
  });

  it('counts digraphs as one mora', () => {
    expect(highs('しゅくだい', 0)).toEqual([0, 1, 1, 1]);
  });

  it('rejects positions outside the reading', () => {
    expect(pitchMorae('はな', 3)).toEqual([]);
    expect(pitchMorae('はな', -1)).toEqual([]);
    expect(pitchMorae('', 0)).toEqual([]);
  });
});
