import { describe, expect, it, vi } from 'vitest';
import type { DisplayController, TermDictionaryEntry } from 'yomitan-core';
import { mineWord, type PanelSource } from './mining';

const entry = {} as TermDictionaryEntry;
const source: PanelSource = {
  pageImage: new Blob(['page']),
  textBox: { x1: 1, y1: 2, x2: 3, y2: 4 }
};
const rect = { x1: 0, y1: 0, x2: 100, y2: 80 };
const blob = new Blob(['crop'], { type: 'image/webp' });

function controller(warnings: string[] = []) {
  const addNote = vi.fn(async () => ({ noteId: 5, overwritten: false, warnings }));
  return { addNote, controller: { addNote } as unknown as DisplayController };
}

describe('mineWord', () => {
  it('hands the Panel Crop to the controller as the screenshot', async () => {
    const { addNote, controller: fake } = controller(['audio failed']);
    const crop = vi.fn(async () => ({ blob, rect }));

    const result = await mineWord(fake, entry, 2, {}, { series: 'S' }, source, crop);

    expect(crop).toHaveBeenCalledWith(source.pageImage, source.textBox);
    expect(addNote).toHaveBeenCalledWith(
      entry,
      2,
      {},
      { series: 'S' },
      {
        screenshot: { data: blob, mediaType: 'image/webp' }
      }
    );
    expect(result).toEqual({
      noteId: 5,
      warnings: ['audio failed'],
      panel: { noteId: 5, cardFormatIndex: 2, source, rect, image: blob }
    });
  });

  it('adds the note without media when the crop fails, and says so', async () => {
    const { addNote, controller: fake } = controller();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await mineWord(fake, entry, 0, {}, {}, source, async () => {
      throw new Error('decode failed');
    });

    expect(addNote).toHaveBeenCalledWith(entry, 0, {}, {}, undefined);
    expect(result.panel).toBeNull();
    expect(result.warnings).toEqual(['no Panel Crop']);
  });

  it('skips the crop without a page image', async () => {
    const { controller: fake } = controller();
    const crop = vi.fn();
    const result = await mineWord(fake, entry, 0, {}, {}, null, crop);
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
    await expect(mineWord(fake, entry, 0, {}, {}, null)).rejects.toThrow('Anki is closed');
  });
});
