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
  it('points the Panel Crop image at the new file', () => {
    expect(withScreenshot('<img src="shot_1.webp" />', 'shot_1.webp', 'new.webp')).toBe(
      '<img src="new.webp" />'
    );
    expect(
      withScreenshot('<div><img class="a" src=\'old.jpg\' alt="x"></div>', 'old.jpg', 'new.jpg')
    ).toBe('<div><img class="a" src="new.jpg" alt="x"></div>');
  });

  it('leaves other images and text in the field alone', () => {
    const field = '<img src="dictionary.png">定義<img src="shot_1.webp">その後';
    expect(withScreenshot(field, 'shot_1.webp', 'new.webp')).toBe(
      '<img src="dictionary.png">定義<img src="new.webp">その後'
    );
  });

  it('appends the image when the field never got the original (its store failed)', () => {
    expect(withScreenshot('', null, 'new.webp')).toBe('<img src="new.webp">');
    expect(withScreenshot('<b>text</b><img src="dictionary.png">', null, 'new.webp')).toBe(
      '<b>text</b><img src="dictionary.png"><img src="new.webp">'
    );
    expect(withScreenshot('text', 'gone.webp', 'new.webp')).toBe('text<img src="new.webp">');
  });

  it('matches the file name literally', () => {
    expect(withScreenshot('<img src="aXb.webp"><img src="a.b.webp">', 'a.b.webp', 'n.webp')).toBe(
      '<img src="aXb.webp"><img src="n.webp">'
    );
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

    await expect(
      replacePanel(7, ['Picture'], 'yomitan_screenshot_1.webp', image, request)
    ).resolves.toBe('mokuro_panel_9.webp');

    const store = request.mock.calls.find(([action]) => action === 'storeMediaFile');
    expect(store?.[1]).toMatchObject({ data: btoa('crop') });
    expect(request).toHaveBeenLastCalledWith('updateNoteFields', {
      note: { id: 7, fields: { Picture: '<img src="mokuro_panel_9.webp">' } }
    });
  });

  it('keeps dictionary images and text in a mixed field', async () => {
    const request = vi.fn<AnkiRequest>(async (action) => {
      if (action === 'notesInfo') {
        return [
          {
            fields: {
              Glossary: { value: '<img src="dict.png">to eat<img src="shot_1.webp">' },
              Notes: { value: 'my note' }
            }
          }
        ];
      }
      return action === 'storeMediaFile' ? 'new.webp' : null;
    });

    await replacePanel(7, ['Glossary', 'Notes'], 'shot_1.webp', image, request);

    expect(request).toHaveBeenLastCalledWith('updateNoteFields', {
      note: {
        id: 7,
        fields: {
          Glossary: '<img src="dict.png">to eat<img src="new.webp">',
          // The original store failed here, so the text stays and the image is added.
          Notes: 'my note<img src="new.webp">'
        }
      }
    });
  });

  it('reports a failure without touching the note', async () => {
    const request = vi.fn<AnkiRequest>(async (action) =>
      action === 'notesInfo' ? [{ fields: { Picture: { value: '' } } }] : undefined
    );
    await expect(replacePanel(7, ['Picture'], null, image, request)).resolves.toBeNull();
    expect(request.mock.calls.map(([action]) => action)).not.toContain('updateNoteFields');
  });
});
