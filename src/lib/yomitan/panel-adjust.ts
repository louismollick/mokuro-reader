/**
 * Adjusting a mined note's Panel Crop: store the re-cropped image in Anki and point the note's
 * `{screenshot}` fields at it. Goes through the AnkiConnect request helper, so the API key and the
 * CORS permission retry behave as for every other request.
 */
import type { Yomitan } from 'yomitan-core';
import { ankiConnect } from '$lib/anki-connect';

/** An AnkiConnect call; resolves to its result, or undefined when it failed. */
export type AnkiRequest = (action: string, params: Record<string, unknown>) => Promise<unknown>;

async function toBase64(blob: Blob): Promise<string> {
  let binary = '';
  for (const byte of new Uint8Array(await blob.arrayBuffer())) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The fields of a card format whose template holds `{screenshot}`. */
export function screenshotFields(fields: Record<string, { value: string }>): string[] {
  return Object.entries(fields)
    .filter(([, { value }]) => value.includes('{screenshot}'))
    .map(([name]) => name);
}

/** The `{screenshot}` fields of the profile's card format number `cardFormatIndex`. */
export function profileScreenshotFields(client: Yomitan, cardFormatIndex: number): string[] {
  return screenshotFields(
    client.profile.get().options.anki.cardFormats[cardFormatIndex]?.fields ?? {}
  );
}

/** `html` with the `src` of its `<img>` tags set to `fileName`, or a new `<img>` if it has none. */
export function withScreenshot(html: string, fileName: string): string {
  const src = fileName.replace(/"/g, '&quot;');
  if (!/<img\b/i.test(html)) return `<img src="${src}">`;
  return html.replace(/(<img\b[^>]*?\bsrc=)(?:"[^"]*"|'[^']*')/gi, `$1"${src}"`);
}

/**
 * Stores `image` and rewrites `fields` of note `noteId` to show it. Resolves to whether the note
 * was updated; failures were already reported by `request`.
 */
export async function replacePanel(
  noteId: number,
  fields: string[],
  image: Blob,
  request: AnkiRequest = ankiConnect
): Promise<boolean> {
  const info = (await request('notesInfo', { notes: [noteId] })) as
    | { fields?: Record<string, { value: string }> }[]
    | undefined;
  const current = info?.[0]?.fields;
  if (!current) return false;

  const extension = image.type === 'image/jpeg' ? 'jpg' : 'webp';
  const stored = await request('storeMediaFile', {
    filename: `mokuro_panel_${Date.now()}.${extension}`,
    data: await toBase64(image)
  });
  if (typeof stored !== 'string') return false;

  const updated = Object.fromEntries(
    fields
      .filter((name) => name in current)
      .map((name) => [name, withScreenshot(current[name].value, stored)])
  );
  if (Object.keys(updated).length === 0) return false;
  return (
    (await request('updateNoteFields', { note: { id: noteId, fields: updated } })) !== undefined
  );
}
