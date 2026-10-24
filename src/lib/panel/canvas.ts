/** A 2D canvas that works on the main thread without OffscreenCanvas (older Safari). */
export type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
export type Context2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function getContext2D(canvas: AnyCanvas): Context2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  return ctx;
}

/** Encodes the canvas. Browsers that cannot encode `type` return PNG instead; callers check `blob.type`. */
export function canvasToBlob(canvas: AnyCanvas, type: string, quality: number): Promise<Blob> {
  if (canvas instanceof OffscreenCanvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Encoding failed'))),
      type,
      quality
    )
  );
}
