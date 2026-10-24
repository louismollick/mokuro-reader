/**
 * The Yomitan engine's worker: dictionary storage, lookups and segmentation run here so they never
 * compete with the reader's pan and zoom. The page sends the stored profile and one end of a
 * MessageChannel (`EngineInit`); the other end speaks `@yomitan-core/web`'s `connectYomitan`
 * protocol. Anything that needs the page (mokuro settings, AnkiConnect, the profile's localStorage
 * copy) stays in `client.ts`.
 */
import { createYomitan, headerImageInfoReader, type ImageInfoReader } from 'yomitan-core';
import {
  createBrowserImageInfoReader,
  createIndexedDbStorage,
  exposeYomitan
} from '@yomitan-core/web';
import { yomitanFetch } from './fetch';
import type { EngineFailure, EngineInit } from './engine-protocol';

const DATABASE_NAME = 'mokuro-reader-yomitan-v2';

/**
 * Decoding an image in a worker can't handle every format (SVG); fall back to reading the size
 * from the file header, which is what the engine does without a browser reader.
 */
const imageInfoReader: ImageInfoReader = {
  async getImageDetails(content, mediaType) {
    try {
      return await createBrowserImageInfoReader().getImageDetails(content, mediaType);
    } catch {
      return headerImageInfoReader.getImageDetails(content, mediaType);
    }
  }
};

self.addEventListener('message', async (event: MessageEvent<EngineInit>) => {
  try {
    const { profile, port } = event.data;
    const client = await createYomitan({
      storage: createIndexedDbStorage({ name: DATABASE_NAME }),
      imageInfoReader,
      fetch: yomitanFetch,
      profile
    });
    exposeYomitan(port, client);
  } catch (error) {
    const failure: EngineFailure = {
      error: error instanceof Error ? error.message : String(error)
    };
    self.postMessage(failure);
  }
});
