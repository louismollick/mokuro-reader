import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const resolve = (path: string) => new URL(path, import.meta.url).pathname;
const read = (path: string) => readFileSync(resolve(path), 'utf8');

// New weights must get a new URL: a fixed `/models/...` path would be served from the service
// worker's never-revalidated large-asset cache forever.
describe('panel model asset', () => {
  it('is imported with ?url so the build hashes its filename', () => {
    expect(read('./panel-worker.ts')).toMatch(/assets\/manga-panel-detector-yolo26n\.onnx\?url/);
    expect(existsSync(resolve('./assets/manga-panel-detector-yolo26n.onnx'))).toBe(true);
    expect(existsSync(resolve('../../../static/models'))).toBe(false);
  });

  it('is still matched by the service worker large-asset cache', () => {
    const rule = read('../../service-worker.js').match(/const isLargeAsset = \(path\) => (.*);/);
    const isLargeAsset = new Function('path', `return ${rule?.[1]}`) as (path: string) => boolean;
    expect(isLargeAsset('/_app/immutable/assets/manga-panel-detector-yolo26n.Ab12Cd.onnx')).toBe(
      true
    );
    expect(isLargeAsset('/_app/immutable/assets/ort-wasm-simd-threaded.Ab12Cd.wasm')).toBe(true);
    expect(isLargeAsset('/_app/immutable/chunks/app.js')).toBe(false);
  });
});
