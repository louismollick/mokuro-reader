/**
 * Mining: adding a Word's Anki note with its Panel Crop. The crop is cut on the page from the
 * original page image and handed to the display controller as `{screenshot}` media; the controller
 * stores it through the page-side Anki transport, so the Blob never crosses the engine worker.
 */
import type {
  AnkiMediaSource,
  AnkiNoteContext,
  DisplayController,
  TermDictionaryEntry
} from 'yomitan-core';
import { cropPanel } from '$lib/panel/panel-crop';
import { matchFilesToPages } from '$lib/reader/image-cache';
import type { Page } from '$lib/types';
import type { Rect } from '$lib/panel/yolo';

/** Where a Word's Panel Crop is cut from: the page image and the Word's Text Box on it. */
export interface PanelSource {
  pageImage: Blob;
  /** In `pageSize` pixels. */
  textBox: Rect;
  /** The page size the OCR measured `textBox` in; the image itself may be scaled differently. */
  pageSize: { width: number; height: number };
}

/**
 * The Panel Crop source for a Text Box: the page's original image, found the way the reader finds
 * it (the OCR may say 001.png for a 001.webp file), and the box with the OCR's page size.
 * Null when the page has no image.
 */
export function panelSourceFor(
  files: Record<string, File>,
  pages: Page[],
  pageIndex: number,
  blockIndex: number
): PanelSource | null {
  const page = pages[pageIndex];
  const block = page?.blocks[blockIndex];
  const pageImage = matchFilesToPages(files, pages)[pageIndex];
  if (!block || !pageImage) return null;
  const [x1, y1, x2, y2] = block.box;
  return {
    pageImage,
    textBox: { x1, y1, x2, y2 },
    pageSize: { width: page.img_width, height: page.img_height }
  };
}

/** A Panel Crop that went onto a note, kept for the sheet session so it can be adjusted. */
export interface MinedPanel {
  noteId: number;
  cardFormatIndex: number;
  source: PanelSource;
  /** The image's file in Anki's media folder; null when storing it failed. */
  fileName: string | null;
  /** The rect the image was cut from, in the page image's own pixels. */
  rect: Rect;
  image: Blob;
}

/**
 * The screenshots the transport stored, so a mined note's Panel Crop can be told from its other
 * images (the controller doesn't say which file is which). A stored file is matched to its crop
 * by name and by size, so two adds in flight don't swap files.
 */
export class ScreenshotLog {
  private stored: { fileName: string; base64Length: number }[] = [];

  /** The transport stored `fileName` from `source`. */
  record(fileName: string, source: AnkiMediaSource) {
    if ('data' in source && fileName.includes('screenshot')) {
      this.stored.push({ fileName, base64Length: source.data.length });
    }
  }

  /** The stored file of the crop `image`, forgetting it. */
  take(image: Blob): string | null {
    const base64Length = Math.ceil(image.size / 3) * 4;
    const index = this.stored.findIndex((file) => file.base64Length === base64Length);
    return index < 0 ? null : this.stored.splice(index, 1)[0].fileName;
  }
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
export async function mineWord({
  controller,
  entry,
  cardFormatIndex,
  context,
  extraMarkers,
  source,
  screenshots,
  crop = cropPanel
}: {
  controller: DisplayController;
  entry: TermDictionaryEntry;
  cardFormatIndex: number;
  context: AnkiNoteContext;
  extraMarkers: Record<string, string>;
  source: PanelSource | null;
  /** What the controller's transport stored, from `createMokuroAnkiTransport`. */
  screenshots: ScreenshotLog;
  crop?: typeof cropPanel;
}): Promise<MineResult> {
  const warnings: string[] = [];
  let cropped: { blob: Blob; rect: Rect } | null = null;
  if (source) {
    try {
      cropped = await crop(source.pageImage, source.textBox, { pageSize: source.pageSize });
    } catch (error) {
      console.error('Panel Crop failed:', error);
      warnings.push('no Panel Crop');
    }
  }

  let added: Awaited<ReturnType<DisplayController['addNote']>>;
  let fileName: string | null = null;
  try {
    added = await controller.addNote(
      entry,
      cardFormatIndex,
      context,
      extraMarkers,
      cropped ? { screenshot: { data: cropped.blob, mediaType: cropped.blob.type } } : undefined
    );
  } finally {
    // Also after a failed add: the transport may have stored the file, and a stale record must not
    // be matched to a later crop of the same size.
    if (cropped) fileName = screenshots.take(cropped.blob);
  }
  const { noteId, warnings: stored } = added;
  warnings.push(...stored);

  return {
    noteId,
    warnings,
    panel:
      source && cropped
        ? {
            noteId,
            cardFormatIndex,
            source,
            fileName,
            rect: cropped.rect,
            image: cropped.blob
          }
        : null
  };
}
