/**
 * Mining: adding a Word's Anki note with its Panel Crop. The crop is cut on the page from the
 * original page image and handed to the display controller as `{screenshot}` media; the controller
 * stores it through the page-side Anki transport, so the Blob never crosses the engine worker.
 */
import type { AnkiNoteContext, DisplayController, TermDictionaryEntry } from 'yomitan-core';
import { cropPanel } from '$lib/panel/panel-crop';
import type { Rect } from '$lib/panel/yolo';

/** Where a Word's Panel Crop is cut from: the page image and the Word's Text Box on it. */
export interface PanelSource {
  pageImage: Blob;
  /** Page pixels. */
  textBox: Rect;
}

/** A Panel Crop that went onto a note, kept for the sheet session so it can be adjusted. */
export interface MinedPanel {
  noteId: number;
  cardFormatIndex: number;
  source: PanelSource;
  /** The page rect the image was cut from. */
  rect: Rect;
  image: Blob;
}

export interface MineResult {
  noteId: number;
  /** Null when the note went in without a Panel Crop. */
  panel: MinedPanel | null;
  /** Things that didn't make it onto the note (crop, media storage). */
  warnings: string[];
}

/**
 * Adds `entry` to Anki with the Panel Crop for `source`. A crop that fails (corrupt image, no
 * canvas) is a warning and the note is still added; a failed add throws as the controller's does.
 */
export async function mineWord(
  controller: DisplayController,
  entry: TermDictionaryEntry,
  cardFormatIndex: number,
  context: AnkiNoteContext,
  extraMarkers: Record<string, string>,
  source: PanelSource | null,
  crop: typeof cropPanel = cropPanel
): Promise<MineResult> {
  const warnings: string[] = [];
  let cropped: { blob: Blob; rect: Rect } | null = null;
  if (source) {
    try {
      cropped = await crop(source.pageImage, source.textBox);
    } catch (error) {
      console.error('Panel Crop failed:', error);
      warnings.push('no Panel Crop');
    }
  }

  const { noteId, warnings: stored } = await controller.addNote(
    entry,
    cardFormatIndex,
    context,
    extraMarkers,
    cropped ? { screenshot: { data: cropped.blob, mediaType: cropped.blob.type } } : undefined
  );
  warnings.push(...stored);

  return {
    noteId,
    warnings,
    panel:
      source && cropped
        ? { noteId, cardFormatIndex, source, rect: cropped.rect, image: cropped.blob }
        : null
  };
}
