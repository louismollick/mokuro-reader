/**
 * Manga panel detection (main-thread side). The first call spawns a worker, which loads
 * onnxruntime-web and the model; later calls reuse them. See panel-worker.ts.
 */
import { base } from '$app/paths';
import { createCanvas, getContext2D } from './canvas';
import { computeLetterbox, INPUT_SIZE, PAD_VALUE, type Letterbox, type PanelBox } from './yolo';

export type { PanelBox, Rect } from './yolo';

export const MODEL_PATH = '/models/manga-panel-detector-yolo26n.onnx';

export type DetectRequest = {
  warm?: undefined;
  id: number;
  /** RGBA pixels of the letterboxed 640x640 input. */
  rgba: Uint8ClampedArray;
  letterbox: Letterbox;
  modelUrl: string;
};
/** Asks the worker to load the model and run it once on a blank input. */
export type WarmRequest = { warm: true; modelUrl: string };
export type DetectResponse = { id: number; panels?: PanelBox[]; error?: string };

let worker: Worker | undefined;
let nextId = 0;
const pending = new Map<number, { resolve: (p: PanelBox[]) => void; reject: (e: Error) => void }>();

function modelUrl(): string {
  return new URL(`${base}${MODEL_PATH}`, self.location.origin).href;
}

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./panel-worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = ({ data }: MessageEvent<DetectResponse>) => {
    const request = pending.get(data.id);
    pending.delete(data.id);
    if (data.panels) request?.resolve(data.panels);
    else request?.reject(new Error(data.error ?? 'Panel detection failed'));
  };
  w.onerror = (event) => {
    // Worker failed to start or crashed: fail everything in flight and respawn next call.
    for (const request of pending.values()) request.reject(new Error(event.message));
    pending.clear();
    w.terminate();
    worker = undefined;
  };
  worker = w;
  return w;
}

/** Draws the image into the model's gray-padded 640x640 input and returns its RGBA pixels. */
function renderLetterbox(bitmap: ImageBitmap, lb: Letterbox): Uint8ClampedArray {
  const canvas = createCanvas(INPUT_SIZE, INPUT_SIZE);
  const ctx = getContext2D(canvas);
  ctx.fillStyle = `rgb(${PAD_VALUE}, ${PAD_VALUE}, ${PAD_VALUE})`;
  ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, lb.padX, lb.padY, lb.width, lb.height);
  return ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
}

/**
 * Detects manga panels, returned in source-image pixels (order unspecified).
 * Does not close or detach a passed ImageBitmap.
 */
export async function detectPanels(image: ImageBitmap | Blob): Promise<PanelBox[]> {
  const bitmap = image instanceof Blob ? await createImageBitmap(image) : image;
  try {
    const letterbox = computeLetterbox(bitmap.width, bitmap.height);
    const rgba = renderLetterbox(bitmap, letterbox);
    const id = nextId++;
    const result = new Promise<PanelBox[]>((resolve, reject) =>
      pending.set(id, { resolve, reject })
    );
    const request: DetectRequest = {
      id,
      rgba,
      letterbox,
      modelUrl: modelUrl()
    };
    getWorker().postMessage(request, [rgba.buffer]);
    return await result;
  } finally {
    if (image instanceof Blob) bitmap.close();
  }
}

let warmed = false;

/**
 * Starts loading the model in idle time so the first crop doesn't pay for it. Safe to call often;
 * a failure (offline before the first cache fill) is left for the first real crop to retry.
 */
export function warmUpPanelDetector(): void {
  if (warmed) return;
  warmed = true;
  const start = () => {
    const request: WarmRequest = { warm: true, modelUrl: modelUrl() };
    getWorker().postMessage(request);
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(start, { timeout: 2000 });
  else setTimeout(start, 500);
}
