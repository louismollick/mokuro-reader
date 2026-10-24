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

/**
 * Crops the panel holding `textBox` out of a page image, in page pixels. If detection fails
 * (model unavailable offline, etc.) it falls back to the padded text box.
 * Returns the encoded image and the source rect that was cut.
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
      panels = await detectPanels(bitmap);
    } catch (err) {
      console.warn('Panel detection failed, using padded text box', err);
    }
    const rect = choosePanelCrop(panels, textBox, bitmap);
    return { blob: await cutRect(bitmap, rect, options), rect };
  } finally {
    bitmap.close();
  }
}
