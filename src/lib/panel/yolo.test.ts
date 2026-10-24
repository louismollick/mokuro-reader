import { describe, expect, it } from 'vitest';
import {
  computeLetterbox,
  decodePanels,
  INPUT_SIZE,
  nms,
  rgbaToTensor,
  type Letterbox
} from './yolo';

describe('computeLetterbox', () => {
  it('pads a portrait page horizontally', () => {
    const lb = computeLetterbox(844, 1200);
    expect(lb.scale).toBeCloseTo(640 / 1200);
    expect(lb).toMatchObject({ width: 450, height: 640, padX: 95, padY: 0 });
  });

  it('pads a landscape page vertically', () => {
    expect(computeLetterbox(1200, 600)).toMatchObject({
      width: 640,
      height: 320,
      padX: 0,
      padY: 160
    });
  });

  it('upscales small images to fill the input', () => {
    expect(computeLetterbox(320, 320)).toMatchObject({ width: 640, height: 640, padX: 0, padY: 0 });
  });

  it('rounds the padding like ultralytics (odd leftover favors top/left)', () => {
    const lb = computeLetterbox(1000, 999);
    expect(lb.height).toBe(639);
    expect(lb.padY).toBe(0); // round(0.5 - 0.1)
  });
});

describe('rgbaToTensor', () => {
  it('converts RGBA to normalized NCHW', () => {
    const rgba = new Uint8ClampedArray(INPUT_SIZE * INPUT_SIZE * 4);
    rgba.set([255, 51, 0, 255], 0);
    rgba.set([0, 0, 255, 255], 4);
    const plane = INPUT_SIZE * INPUT_SIZE;
    const t = rgbaToTensor(rgba);
    expect(t).toHaveLength(3 * plane);
    expect(t[0]).toBe(1);
    expect(t[plane]).toBeCloseTo(51 / 255, 6);
    expect(t[2 * plane]).toBe(0);
    expect([t[1], t[plane + 1], t[2 * plane + 1]]).toEqual([0, 0, 1]);
  });
});

describe('nms', () => {
  const box = (x1: number, y1: number, x2: number, y2: number, score: number) => ({
    x1,
    y1,
    x2,
    y2,
    score
  });

  it('keeps the best of heavily overlapping boxes and distinct boxes', () => {
    const kept = nms(
      [box(0, 0, 100, 100, 0.6), box(2, 2, 100, 100, 0.9), box(200, 0, 300, 100, 0.5)],
      0.7
    );
    expect(kept.map((b) => b.score)).toEqual([0.9, 0.5]);
  });

  it('keeps boxes whose IoU is at or below the threshold', () => {
    // IoU = 50 / 150 = 1/3
    expect(nms([box(0, 0, 10, 10, 0.9), box(5, 0, 15, 10, 0.8)], 0.7)).toHaveLength(2);
    expect(nms([box(0, 0, 10, 10, 0.9), box(5, 0, 15, 10, 0.8)], 0.3)).toHaveLength(1);
  });
});

describe('decodePanels', () => {
  const anchors = 5;
  /** Builds a channel-major (6, anchors) output from per-anchor [cx, cy, w, h, panel, text]. */
  function output(rows: number[][]): Float32Array {
    const out = new Float32Array(6 * anchors);
    rows.forEach((row, i) => row.forEach((v, c) => (out[c * anchors + i] = v)));
    return out;
  }

  // 844x1200 page -> 450x640 inside the input, 95 px of horizontal padding, scale 0.5333
  const lb: Letterbox = computeLetterbox(844, 1200);

  it('maps boxes from input space back to the source image', () => {
    // Input-space box 95..545 x 0..640 is the whole page.
    const [panel] = decodePanels(output([[320, 320, 450, 640, 0.9, 0.1]]), lb);
    expect(panel.x1).toBeCloseTo(0, 3);
    expect(panel.y1).toBeCloseTo(0, 3);
    expect(panel.x2).toBeCloseTo(844, 0);
    expect(panel.y2).toBeCloseTo(1200, 3);
    expect(panel.score).toBeCloseTo(0.9);
  });

  it('applies the confidence threshold', () => {
    const rows = [[320, 320, 100, 100, 0.2, 0.0]];
    expect(decodePanels(output(rows), lb)).toHaveLength(0);
    expect(decodePanels(output(rows), lb, { confThreshold: 0.1 })).toHaveLength(1);
  });

  it('skips anchors where the text class wins', () => {
    expect(decodePanels(output([[320, 320, 100, 100, 0.6, 0.8]]), lb)).toHaveLength(0);
  });

  it('clamps boxes to the image and runs NMS', () => {
    const panels = decodePanels(
      output([
        [100, 20, 300, 100, 0.8, 0], // spills past the left and top edges
        [102, 20, 300, 100, 0.7, 0], // near duplicate, suppressed
        [450, 450, 100, 100, 0.9, 0]
      ]),
      lb
    );
    expect(panels).toHaveLength(2);
    const edge = panels.find((p) => Math.abs(p.score - 0.8) < 1e-6)!;
    expect(edge.x1).toBe(0);
    expect(edge.y1).toBe(0);
  });
});
