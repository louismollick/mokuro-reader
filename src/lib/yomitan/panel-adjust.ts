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

/**
 * `html` with the image `oldName` (the Panel Crop the note was added with) pointing at `newName`.
 * Other images and text in the field stay. When the field has no such image (the original store
 * failed, so the marker rendered empty), the new image is appended.
 */
export function withScreenshot(html: string, oldName: string | null, newName: string): string {
  const src = newName.replace(/"/g, '&quot;');
  if (oldName) {
    const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const image = new RegExp(`(<img\\b[^>]*?\\bsrc=)(?:"${escaped}"|'${escaped}')`, 'gi');
    if (image.test(html)) return html.replace(image, `$1"${src}"`);
  }
  return `${html}<img src="${src}">`;
}

/**
 * Stores `image` and rewrites `fields` of note `noteId` to show it instead of `oldName`. Resolves
 * to the new file name, or null when the note wasn't updated; failures were already reported by
 * `request`.
 */
export async function replacePanel(
  noteId: number,
  fields: string[],
  oldName: string | null,
  image: Blob,
  request: AnkiRequest = ankiConnect
): Promise<string | null> {
  const info = (await request('notesInfo', { notes: [noteId] })) as
    | { fields?: Record<string, { value: string }> }[]
    | undefined;
  const current = info?.[0]?.fields;
  if (!current) return null;

  const extension = image.type === 'image/jpeg' ? 'jpg' : 'webp';
  const stored = await request('storeMediaFile', {
    filename: `mokuro_panel_${Date.now()}.${extension}`,
    data: await toBase64(image)
  });
  if (typeof stored !== 'string') return null;

  const updated = Object.fromEntries(
    fields
      .filter((name) => name in current)
      .map((name) => [name, withScreenshot(current[name].value, oldName, stored)])
  );
  if (Object.keys(updated).length === 0) return null;
  const done = await request('updateNoteFields', { note: { id: noteId, fields: updated } });
  return done === undefined ? null : stored;
}
