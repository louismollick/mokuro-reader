/**
 * Worker that runs the panel detector with onnxruntime-web (wasm, single thread so it needs no
 * cross-origin isolation and works on iOS). The session is created on the first request.
 */
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import type { DetectRequest, DetectResponse, WarmRequest } from './detect-panels';
import { decodePanels, INPUT_SIZE, rgbaToTensor } from './yolo';

ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = { wasm: wasmUrl };

let session: Promise<ort.InferenceSession> | undefined;

function getSession(modelUrl: string): Promise<ort.InferenceSession> {
  session ??= ort.InferenceSession.create(modelUrl, { executionProviders: ['wasm'] });
  // Let the next request retry if loading failed (e.g. offline before the first cache fill).
  session.catch(() => (session = undefined));
  return session;
}

self.onmessage = async ({ data }: MessageEvent<DetectRequest | WarmRequest>) => {
  if (data.warm) {
    await getSession(data.modelUrl).catch(() => {});
    return;
  }
  try {
    const s = await getSession(data.modelUrl);
    const input = new ort.Tensor('float32', rgbaToTensor(data.rgba), [
      1,
      3,
      INPUT_SIZE,
      INPUT_SIZE
    ]);
    const outputs = await s.run({ [s.inputNames[0]]: input });
    const output = outputs[s.outputNames[0]].data as Float32Array;
    self.postMessage({
      id: data.id,
      panels: decodePanels(output, data.letterbox)
    } satisfies DetectResponse);
  } catch (err) {
    self.postMessage({
      id: data.id,
      error: err instanceof Error ? err.message : 'Panel detection failed'
    } satisfies DetectResponse);
  }
};
