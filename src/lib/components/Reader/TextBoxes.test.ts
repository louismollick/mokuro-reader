import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { writable } from 'svelte/store';
import TextBoxes from './TextBoxes.svelte';

vi.mock('$lib/settings', () => {
  const settings = writable({
    fontSize: 'auto',
    boldFont: false,
    displayOCR: true,
    textBoxBorders: false,
    textEditable: false,
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
  it('emits onTextBoxActivate with joined textbox text on click', async () => {
    const onTextBoxActivate = vi.fn();
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

    const { container } = render(TextBoxes, {
      page,
      volumeUuid: 'vol-1',
      onTextBoxActivate
    });

    const textBox = container.querySelector('.textBox') as HTMLElement;
    await fireEvent.click(textBox);

    expect(onTextBoxActivate).toHaveBeenCalledWith({
      lines: ['日本語', 'テスト'],
      text: '日本語 テスト',
      blockIndex: 0
    });
  });
});

