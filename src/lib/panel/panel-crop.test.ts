import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ detectPanels: vi.fn(), drawImage: vi.fn() }));

vi.mock('./detect-panels', () => ({ detectPanels: mocks.detectPanels }));
vi.mock('./canvas', () => ({
  createCanvas: (width: number, height: number) => ({ width, height }),
  getContext2D: () => ({ drawImage: mocks.drawImage }),
  canvasToBlob: async (_canvas: unknown, type: string) => new Blob(['x'], { type })
}));

import { cropPanel } from './panel-crop';

describe('cropPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The decoded image is twice the size the OCR measured.
    vi.stubGlobal('createImageBitmap', async () => ({ width: 2000, height: 3000, close() {} }));
  });

  it('scales the OCR text box into the decoded image before choosing the panel', async () => {
    // Panels are in the decoded image's pixels. The box is 100..200 x 200..400 in OCR pixels, so
    // 200..400 x 400..800 in the image: the first panel holds it. The second panel holds only the
    // unscaled box, which is what a missing conversion would pick.
    mocks.detectPanels.mockResolvedValue([
      { x1: 150, y1: 300, x2: 800, y2: 900, score: 0.9 },
      { x1: 90, y1: 190, x2: 220, y2: 410, score: 0.9 }
    ]);
    const { rect } = await cropPanel(
      new Blob(['page']),
      { x1: 100, y1: 200, x2: 200, y2: 400 },
      { pageSize: { width: 1000, height: 1500 } }
    );
    expect(rect).toEqual({ x1: 150, y1: 300, x2: 800, y2: 900 });
    expect(mocks.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      150,
      300,
      650,
      600,
      0,
      0,
      650,
      600
    );
  });

  it('falls back to the padded text box when detection stalls, and ignores a late result', async () => {
    vi.useFakeTimers();
    try {
      let finish: (panels: unknown[]) => void = () => {};
      mocks.detectPanels.mockReturnValue(new Promise((resolve) => (finish = resolve)));
      const crop = cropPanel(new Blob(['page']), { x1: 100, y1: 200, x2: 200, y2: 400 });
      await vi.advanceTimersByTimeAsync(6000);
      const { rect } = await crop;
      // The padded box, not the (late) panel below.
      expect(rect).toEqual({ x1: 0, y1: 140, x2: 300, y2: 460 });
      finish([{ x1: 0, y1: 0, x2: 2000, y2: 3000, score: 1 }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('pads the scaled text box when no panel holds it', async () => {
    mocks.detectPanels.mockResolvedValue([]);
    const { rect } = await cropPanel(
      new Blob(['page']),
      { x1: 100, y1: 200, x2: 200, y2: 400 },
      { pageSize: { width: 1000, height: 1500 } }
    );
    // Scaled box 200..400 x 400..800, padded by 5% / 2% of the 2000x3000 image.
    expect(rect).toEqual({ x1: 100, y1: 340, x2: 500, y2: 860 });
  });
});
