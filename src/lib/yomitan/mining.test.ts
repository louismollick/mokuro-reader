import { describe, expect, it, vi } from 'vitest';
import type { DisplayController, TermDictionaryEntry } from 'yomitan-core';
import type { Page } from '$lib/types';
import { mineWord, panelSourceFor, ScreenshotLog, type PanelSource } from './mining';

const entry = {} as TermDictionaryEntry;
const source: PanelSource = {
  pageImage: new Blob(['page']),
  textBox: { x1: 1, y1: 2, x2: 3, y2: 4 },
  pageSize: { width: 1000, height: 1500 }
};
const rect = { x1: 0, y1: 0, x2: 100, y2: 80 };
const blob = new Blob(['crop'], { type: 'image/webp' });

function controller(warnings: string[] = []) {
  const addNote = vi.fn(async () => ({ noteId: 5, overwritten: false, warnings }));
  return { addNote, controller: { addNote } as unknown as DisplayController };
}

describe('mineWord', () => {
  const run = (fake: DisplayController, extra: Partial<Parameters<typeof mineWord>[0]> = {}) =>
    mineWord({
      controller: fake,
      entry,
      cardFormatIndex: 0,
      context: {},
      extraMarkers: {},
      source,
      screenshots: new ScreenshotLog(),
      ...extra
    });

  it('hands the Panel Crop to the controller as the screenshot', async () => {
    const { addNote, controller: fake } = controller(['audio failed']);
    const crop = vi.fn(async () => ({ blob, rect }));
    const screenshots = new ScreenshotLog();
    // The transport stores the crop (as the controller asks), then something else.
    addNote.mockImplementationOnce(async () => {
      screenshots.record('yomitan_browser_screenshot_1.webp', { data: 'A'.repeat(8) });
      screenshots.record('yomitan_glossary_1.png', { data: 'B'.repeat(8) });
      return { noteId: 5, overwritten: false, warnings: ['audio failed'] };
    });

    const result = await run(fake, {
      cardFormatIndex: 2,
      extraMarkers: { series: 'S' },
      crop,
      screenshots
    });

    expect(crop).toHaveBeenCalledWith(source.pageImage, source.textBox, {
      pageSize: source.pageSize
    });
    expect(addNote).toHaveBeenCalledWith(
      entry,
      2,
      {},
      { series: 'S' },
      { screenshot: { data: blob, mediaType: 'image/webp' } }
    );
    expect(result).toEqual({
      noteId: 5,
      warnings: ['audio failed'],
      panel: {
        noteId: 5,
        cardFormatIndex: 2,
        source,
        fileName: 'yomitan_browser_screenshot_1.webp',
        rect,
        image: blob
      }
    });
  });

  it('adds the note without media when the crop fails, and says so', async () => {
    const { addNote, controller: fake } = controller();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await run(fake, {
      crop: async () => {
        throw new Error('decode failed');
      }
    });

    expect(addNote).toHaveBeenCalledWith(entry, 0, {}, {}, undefined);
    expect(result.panel).toBeNull();
    expect(result.warnings).toEqual(['no Panel Crop']);
  });

  it('keeps the panel without a file name when storing the crop failed', async () => {
    const { controller: fake } = controller(['screenshot failed']);
    const result = await run(fake, { crop: async () => ({ blob, rect }) });
    expect(result.panel?.fileName).toBeNull();
  });

  it('forgets the stored file when the add fails', async () => {
    const screenshots = new ScreenshotLog();
    const failing = {
      addNote: vi.fn(async () => {
        screenshots.record('yomitan_browser_screenshot_1.webp', { data: 'A'.repeat(8) });
        throw new Error('Anki is closed');
      })
    } as unknown as DisplayController;
    await expect(run(failing, { crop: async () => ({ blob, rect }), screenshots })).rejects.toThrow(
      'Anki is closed'
    );
    // A later crop of the same size must not pick up the failed add's file.
    expect(screenshots.take(blob)).toBeNull();
  });

  it('skips the crop without a page image', async () => {
    const { controller: fake } = controller();
    const crop = vi.fn();
    const result = await run(fake, { source: null, crop });
    expect(crop).not.toHaveBeenCalled();
    expect(result.panel).toBeNull();
    expect(result.warnings).toEqual([]);
  });

  it('does not swallow a failed add', async () => {
    const fake = {
      addNote: vi.fn(async () => {
        throw new Error('Anki is closed');
      })
    } as unknown as DisplayController;
    await expect(run(fake, { source: null })).rejects.toThrow('Anki is closed');
  });
});

describe('ScreenshotLog', () => {
  it('matches each crop to the file of its own size, once', () => {
    const log = new ScreenshotLog();
    log.record('yomitan_browser_screenshot_a.webp', { data: 'x'.repeat(8) }); // 6 bytes
    log.record('yomitan_browser_screenshot_b.webp', { data: 'x'.repeat(12) }); // 9 bytes
    log.record('yomitan_audio_a.mp3', { url: 'https://audio.test/a.mp3' });
    expect(log.take(new Blob(['123456789']))).toBe('yomitan_browser_screenshot_b.webp');
    expect(log.take(new Blob(['123456']))).toBe('yomitan_browser_screenshot_a.webp');
    expect(log.take(new Blob(['123456']))).toBeNull();
  });
});

describe('panelSourceFor', () => {
  const pages = [
    {
      img_path: 'vol/001.png',
      img_width: 1000,
      img_height: 1500,
      blocks: [{ box: [10, 20, 30, 40] }]
    }
  ] as unknown as Page[];

  it('finds the page image the way the reader does and keeps the OCR page size', () => {
    // The OCR says 001.png; the volume stores the converted 001.webp.
    const file = new File(['x'], 'vol/001.webp', { type: 'image/webp' });
    expect(panelSourceFor({ 'vol/001.webp': file }, pages, 0, 0)).toEqual({
      pageImage: file,
      textBox: { x1: 10, y1: 20, x2: 30, y2: 40 },
      pageSize: { width: 1000, height: 1500 }
    });
  });

  it('is null without a matching image or block', () => {
    expect(panelSourceFor({}, pages, 0, 0)).toBeNull();
    const file = new File(['x'], 'vol/001.png');
    expect(panelSourceFor({ 'vol/001.png': file }, pages, 0, 5)).toBeNull();
  });
});
