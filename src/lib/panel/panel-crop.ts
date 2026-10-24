import { canvasToBlob, createCanvas, getContext2D } from './canvas';
import { choosePanelCrop } from './choose-panel';
import { detectPanels } from './detect-panels';
import type { PanelBox, Rect } from './yolo';

export type CropOptions = {
  /** Longest edge of the output in pixels; smaller crops are not upscaled. Default 1280. */
  maxSize?: number;
  /** Default image/webp; falls back to JPEG where the browser cannot encode it (iOS Safari). */
  type?: 'image/webp' | 'image/jpeg';
  quality?: number;
  /**
   * The page size `textBox` is measured in (the OCR's `img_width`/`img_height`). The decoded image
   * can be larger or smaller, so the box is scaled into its pixels. Default: the image's own size.
   */
  pageSize?: { width: number; height: number };
};

/** Cuts `rect` (page pixels) out of a decoded page and encodes it. */
async function cutRect(
  bitmap: ImageBitmap,
  rect: Rect,
  { maxSize = 1280, type = 'image/webp', quality = 0.85 }: CropOptions
): Promise<Blob> {
  const sx = Math.floor(rect.x1);
  const sy = Math.floor(rect.y1);
  const sw = Math.max(1, Math.ceil(rect.x2) - sx);
  const sh = Math.max(1, Math.ceil(rect.y2) - sy);
  const ratio = Math.min(1, maxSize / Math.max(sw, sh));
  const canvas = createCanvas(
    Math.max(1, Math.round(sw * ratio)),
    Math.max(1, Math.round(sh * ratio))
  );
  const ctx = getContext2D(canvas);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  const blob = await canvasToBlob(canvas, type, quality);
  return blob.type === type ? blob : await canvasToBlob(canvas, 'image/jpeg', quality);
}

/** Crops `rect` (page pixels) out of a page image, for a crop the user adjusted by hand. */
export async function cropRect(
  pageImage: Blob,
  rect: Rect,
  options: CropOptions = {}
): Promise<Blob> {
  const bitmap = await createImageBitmap(pageImage);
  try {
    return await cutRect(bitmap, rect, options);
  } finally {
    bitmap.close();
  }
}

/** `rect` from a page of `pageSize` scaled into the pixels of `bitmap`. */
function scaleToBitmap(
  rect: Rect,
  pageSize: CropOptions['pageSize'],
  bitmap: { width: number; height: number }
): Rect {
  if (!pageSize) return rect;
  const sx = bitmap.width / pageSize.width;
  const sy = bitmap.height / pageSize.height;
  return { x1: rect.x1 * sx, y1: rect.y1 * sy, x2: rect.x2 * sx, y2: rect.y2 * sy };
}

/** Detection gets this long on the first call (loading the model and wasm), then the warm limit. */
const COLD_DETECTION_MS = 6000;
const WARM_DETECTION_MS = 3000;
let detectedOnce = false;

/** Panels from the detector, or none if it fails or takes too long; a late result is ignored. */
async function detectWithin(bitmap: ImageBitmap): Promise<PanelBox[]> {
  const detection = detectPanels(bitmap);
  detection.catch(() => {}); // a late failure after the timeout is not an error anyone handles
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('Panel detection timed out')),
      detectedOnce ? WARM_DETECTION_MS : COLD_DETECTION_MS
    );
  });
  try {
    const panels = await Promise.race([detection, timeout]);
    detectedOnce = true;
    return panels;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Crops the panel holding `textBox` out of a page image. If detection fails or stalls
 * (model unavailable offline, etc.) it falls back to the padded text box.
 * Returns the encoded image and the source rect that was cut, in the image's own pixels.
 */
export async function cropPanel(
  pageImage: Blob,
  textBox: Rect,
  options: CropOptions = {}
): Promise<{ blob: Blob; rect: Rect }> {
  const bitmap = await createImageBitmap(pageImage);
  try {
    let panels: PanelBox[] = [];
    try {
      panels = await detectWithin(bitmap);
    } catch (err) {
      console.warn('Panel detection failed, using padded text box', err);
    }
    const rect = choosePanelCrop(panels, scaleToBitmap(textBox, options.pageSize, bitmap), bitmap);
    return { blob: await cutRect(bitmap, rect, options), rect };
  } finally {
    bitmap.close();
  }
}
