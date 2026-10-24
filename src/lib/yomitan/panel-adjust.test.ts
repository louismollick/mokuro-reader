import { describe, expect, it, vi } from 'vitest';
import { replacePanel, type AnkiRequest, screenshotFields, withScreenshot } from './panel-adjust';

describe('screenshotFields', () => {
  it('lists the fields whose template holds {screenshot}', () => {
    expect(
      screenshotFields({
        Picture: { value: '{screenshot}' },
        Expression: { value: '{expression}' },
        Other: { value: '<div>{screenshot}</div>' }
      })
    ).toEqual(['Picture', 'Other']);
  });
});

describe('withScreenshot', () => {
  it('points the existing image at the new file', () => {
    expect(withScreenshot('<img src="yomitan_screenshot_1.webp">', 'mokuro_panel_2.webp')).toBe(
      '<img src="mokuro_panel_2.webp">'
    );
    expect(withScreenshot('<div><img class="a" src=\'old.jpg\' alt="x"></div>', 'new.jpg')).toBe(
      '<div><img class="a" src="new.jpg" alt="x"></div>'
    );
  });

  it('adds an image to a field that has none', () => {
    expect(withScreenshot('', 'new.webp')).toBe('<img src="new.webp">');
  });
});

describe('replacePanel', () => {
  const image = new Blob(['crop'], { type: 'image/webp' });

  it('stores the image, then rewrites every screenshot field of the note', async () => {
    const request = vi.fn<AnkiRequest>(async (action) => {
      if (action === 'notesInfo') {
        return [
          {
            fields: {
              Picture: { value: '<img src="yomitan_screenshot_1.webp">' },
              Expression: { value: '食べる' }
            }
          }
        ];
      }
      if (action === 'storeMediaFile') return 'mokuro_panel_9.webp';
      return null;
    });

    await expect(replacePanel(7, ['Picture'], image, request)).resolves.toBe(true);

    const store = request.mock.calls.find(([action]) => action === 'storeMediaFile');
    expect(store?.[1]).toMatchObject({ data: btoa('crop') });
    expect(request).toHaveBeenLastCalledWith('updateNoteFields', {
      note: { id: 7, fields: { Picture: '<img src="mokuro_panel_9.webp">' } }
    });
  });

  it('reports a failure without touching the note', async () => {
    const request = vi.fn<AnkiRequest>(async (action) =>
      action === 'notesInfo' ? [{ fields: { Picture: { value: '' } } }] : undefined
    );
    await expect(replacePanel(7, ['Picture'], image, request)).resolves.toBe(false);
    expect(request.mock.calls.map(([action]) => action)).not.toContain('updateNoteFields');
  });
});
