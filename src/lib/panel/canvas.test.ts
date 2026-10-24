import { afterEach, describe, expect, it, vi } from 'vitest';
import { canvasToBlob, createCanvas } from './canvas';

afterEach(() => vi.unstubAllGlobals());

// Safari before 16.4 has no OffscreenCanvas at all, so even naming it in `instanceof` throws.
describe('without OffscreenCanvas', () => {
  it('creates a DOM canvas and encodes it through toBlob', async () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    const canvas = createCanvas(4, 3);
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);

    const blob = new Blob(['x'], { type: 'image/webp' });
    vi.spyOn(canvas as HTMLCanvasElement, 'toBlob').mockImplementation((callback) =>
      callback(blob)
    );
    await expect(canvasToBlob(canvas, 'image/webp', 0.8)).resolves.toBe(blob);
  });
});
