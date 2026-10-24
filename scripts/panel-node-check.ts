/**
 * Dev check, not CI: runs the panel pipeline (yolo.ts decode + choosePanelCrop) under
 * onnxruntime-node on sampled text boxes and compares the chosen crops to a reference run
 * (the ultralytics .pt model), reporting IoU and per-page inference time.
 *
 * Needs `npm i --no-save onnxruntime-node sharp`. Usage:
 *   npx vite-node scripts/panel-node-check.ts <exp-dir> [model.onnx] [blocks-per-volume]
 * <exp-dir> holds data/<vol>/images/*, out/<vol>-tests.json and out/<vol>-yolo.json.
 */
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import { choosePanelCrop } from '../src/lib/panel/choose-panel';
import {
  computeLetterbox,
  decodePanels,
  INPUT_SIZE,
  PAD_VALUE,
  rgbaToTensor,
  type Rect
} from '../src/lib/panel/yolo';
import { readFileSync } from 'node:fs';

type Sample = { img: string; box: [number, number, number, number]; W: number; H: number };
type Reference = { crop: [number, number, number, number] };

const args = process.argv.slice(2);
const [dir, modelPath = 'src/lib/panel/assets/manga-panel-detector-yolo26n.onnx', perVolume = '7'] =
  args;
const volumes = ['dorohedoro', 'chainsaw', 'berserk'];

function iou(a: Rect, b: Rect): number {
  const iw = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const ih = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  if (iw <= 0 || ih <= 0) return 0;
  const inter = iw * ih;
  return inter / ((a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter);
}

/** Letterboxes like the browser path (resize + gray padding), but with sharp. */
async function letterboxRgba(path: string, w: number, h: number) {
  const lb = computeLetterbox(w, h);
  const scaled = await sharp(path)
    .resize(lb.width, lb.height, { kernel: 'linear' })
    .removeAlpha()
    .ensureAlpha()
    .raw()
    .toBuffer();
  const rgba = new Uint8ClampedArray(INPUT_SIZE * INPUT_SIZE * 4).fill(PAD_VALUE);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  for (let y = 0; y < lb.height; y++) {
    const src = y * lb.width * 4;
    rgba.set(scaled.subarray(src, src + lb.width * 4), ((y + lb.padY) * INPUT_SIZE + lb.padX) * 4);
  }
  return { lb, rgba };
}

const session = await ort.InferenceSession.create(modelPath, { intraOpNumThreads: 1 });
const ious: number[] = [];
const times: number[] = [];

for (const vol of volumes) {
  const samples: Sample[] = JSON.parse(readFileSync(`${dir}/out/${vol}-tests.json`, 'utf8'));
  const refs: Record<string, Reference> = JSON.parse(
    readFileSync(`${dir}/out/${vol}-yolo.json`, 'utf8')
  );
  const cache = new Map<string, ReturnType<typeof decodePanels>>();

  for (const [i, s] of samples.slice(0, Number(perVolume)).entries()) {
    if (!cache.has(s.img)) {
      const { lb, rgba } = await letterboxRgba(`${dir}/data/${vol}/images/${s.img}`, s.W, s.H);
      const input = new ort.Tensor('float32', rgbaToTensor(rgba), [1, 3, INPUT_SIZE, INPUT_SIZE]);
      const t0 = performance.now();
      const out = await session.run({ [session.inputNames[0]]: input });
      times.push(performance.now() - t0);
      cache.set(s.img, decodePanels(out[session.outputNames[0]].data as Float32Array, lb));
    }
    const [x1, y1, x2, y2] = s.box;
    const crop = choosePanelCrop(
      cache.get(s.img)!,
      { x1, y1, x2, y2 },
      { width: s.W, height: s.H }
    );
    const [rx1, ry1, rx2, ry2] = refs[String(i)].crop;
    ious.push(iou(crop, { x1: rx1, y1: ry1, x2: rx2, y2: ry2 }));
  }
}

const warm = times.slice(1);
console.log(
  `blocks ${ious.length}, pages ${times.length}, IoU>=0.9: ${((100 * ious.filter((v) => v >= 0.9).length) / ious.length).toFixed(1)}%,`,
  `mean IoU ${(ious.reduce((a, b) => a + b, 0) / ious.length).toFixed(3)}, min ${Math.min(...ious).toFixed(3)},`,
  `inference ${(warm.reduce((a, b) => a + b, 0) / warm.length).toFixed(0)} ms/page (excl. first)`
);
