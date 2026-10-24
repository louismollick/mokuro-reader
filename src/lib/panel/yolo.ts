/**
 * Pure pre/post-processing for the manga panel detector (YOLO26n, ONNX, no built-in NMS).
 * Mirrors ultralytics: letterbox to 640 with gray padding, keep the highest-scoring class per
 * anchor, confidence threshold 0.25, greedy NMS at IoU 0.7.
 */

/** Model input is a square of this many pixels. */
export const INPUT_SIZE = 640;
/** Letterbox padding value (ultralytics default). */
export const PAD_VALUE = 114;
/** Output channel layout: cx, cy, w, h, then one score per class. */
const PANEL_CLASS = 0; // classes: 0 = frame (panel), 1 = text
const NUM_CLASSES = 2;

export type Rect = { x1: number; y1: number; x2: number; y2: number };
/** A detected panel in source-image pixels. */
export type PanelBox = Rect & { score: number };

/** How a source image is scaled and padded into the model input. */
export type Letterbox = {
  srcWidth: number;
  srcHeight: number;
  /** Scaled image size inside the input square. */
  width: number;
  height: number;
  /** Top-left offset of the scaled image inside the input square. */
  padX: number;
  padY: number;
  scale: number;
};

export function computeLetterbox(srcWidth: number, srcHeight: number): Letterbox {
  const scale = Math.min(INPUT_SIZE / srcWidth, INPUT_SIZE / srcHeight);
  const width = Math.round(srcWidth * scale);
  const height = Math.round(srcHeight * scale);
  return {
    srcWidth,
    srcHeight,
    width,
    height,
    padX: Math.max(0, Math.round((INPUT_SIZE - width) / 2 - 0.1)),
    padY: Math.max(0, Math.round((INPUT_SIZE - height) / 2 - 0.1)),
    scale
  };
}

/** RGBA pixels of the letterboxed input square -> NCHW float32 in [0, 1]. */
export function rgbaToTensor(rgba: Uint8ClampedArray): Float32Array {
  const plane = INPUT_SIZE * INPUT_SIZE;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    out[i] = rgba[i * 4] / 255;
    out[plane + i] = rgba[i * 4 + 1] / 255;
    out[2 * plane + i] = rgba[i * 4 + 2] / 255;
  }
  return out;
}

function iou(a: Rect, b: Rect): number {
  const iw = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const ih = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  if (iw <= 0 || ih <= 0) return 0;
  const inter = iw * ih;
  const union = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
  return inter / union;
}

/** Greedy NMS: keep the best-scoring boxes, dropping any that overlap a kept box above the threshold. */
export function nms<T extends PanelBox>(boxes: T[], iouThreshold: number): T[] {
  const kept: T[] = [];
  for (const box of [...boxes].sort((a, b) => b.score - a.score)) {
    if (kept.every((k) => iou(k, box) <= iouThreshold)) kept.push(box);
  }
  return kept;
}

export type DecodeOptions = { confThreshold?: number; iouThreshold?: number };

/**
 * Model output (channel-major (1, 4 + classes, anchors)) -> panels in source-image pixels.
 * An anchor counts as a panel only if the panel class outscores the text class.
 */
export function decodePanels(
  output: ArrayLike<number>,
  letterbox: Letterbox,
  { confThreshold = 0.25, iouThreshold = 0.7 }: DecodeOptions = {}
): PanelBox[] {
  const anchors = output.length / (4 + NUM_CLASSES);
  const { padX, padY, scale, srcWidth, srcHeight } = letterbox;
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  const candidates: PanelBox[] = [];

  for (let i = 0; i < anchors; i++) {
    const score = output[(4 + PANEL_CLASS) * anchors + i];
    if (score < confThreshold || score < output[(5 - PANEL_CLASS) * anchors + i]) continue;
    const cx = output[i];
    const cy = output[anchors + i];
    const w = output[2 * anchors + i];
    const h = output[3 * anchors + i];
    candidates.push({
      x1: clamp((cx - w / 2 - padX) / scale, srcWidth),
      y1: clamp((cy - h / 2 - padY) / scale, srcHeight),
      x2: clamp((cx + w / 2 - padX) / scale, srcWidth),
      y2: clamp((cy + h / 2 - padY) / scale, srcHeight),
      score
    });
  }
  return nms(candidates, iouThreshold);
}
