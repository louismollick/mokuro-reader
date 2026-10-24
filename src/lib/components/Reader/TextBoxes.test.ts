import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { writable } from 'svelte/store';
import TextBoxes from './TextBoxes.svelte';

vi.mock('$lib/settings', () => {
  const settings = writable({
    fontSize: 'auto',
    boldFont: false,
    displayOCR: true,
    textBoxBorders: false,
    ankiConnectSettings: {
      triggerMethod: 'neither',
      tags: '',
      enabled: false
    }
  });

  const volumes = writable({});
  return { settings, volumes };
});

vi.mock('$lib/anki-connect', () => ({
  showCropper: vi.fn(),
  expandTextBoxBounds: vi.fn(() => [0, 0, 10, 10])
}));

describe('TextBoxes', () => {
  it('tags each text box and rendered line with the indices Tap Lookup reads back', () => {
    const page = {
      img_width: 1000,
      img_height: 1000,
      img_path: 'page001.jpg',
      blocks: [
        {
          box: [10, 10, 300, 200],
          font_size: 20,
          lines: ['日本語', 'テスト'],
          vertical: false
        }
      ]
    } as any;

    const { container } = render(TextBoxes, { page, volumeUuid: 'vol-1' });

    const textBox = container.querySelector('.textBox') as HTMLElement;
    expect(textBox.dataset.blockIndex).toBe('0');
    const lines = [...textBox.querySelectorAll<HTMLElement>('.ocr-line')];
    expect(lines.map((line) => line.dataset.lineIndex)).toEqual(['0', '1']);
    expect(lines.map((line) => line.textContent)).toEqual(['日本語', 'テスト']);
  });
});
