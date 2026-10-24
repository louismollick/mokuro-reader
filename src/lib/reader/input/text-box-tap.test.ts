import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TextBoxTapRouter } from './text-box-tap';

function setup(defer: boolean) {
  document.body.innerHTML =
    '<div class="textBox"><span id="in">猫</span></div><div id="out"></div>';
  const onLookup = vi.fn();
  const router = new TextBoxTapRouter({ deferForDoubleTap: () => defer, onLookup });
  const click = (id: string, init: MouseEventInit = {}) => {
    const event = new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 20, ...init });
    document.getElementById(id)!.dispatchEvent(event);
    return event;
  };
  return { router, onLookup, click };
}

describe('TextBoxTapRouter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    window.getSelection()?.removeAllRanges();
  });

  it('looks up immediately when Capture double-tap is off', () => {
    const { router, onLookup, click } = setup(false);
    router.click(click('in'), false);
    expect(onLookup).toHaveBeenCalledTimes(1);
    const tap = onLookup.mock.calls[0][0];
    expect(tap.textBox.className).toBe('textBox');
    expect([tap.x, tap.y]).toEqual([10, 20]);
  });

  it('ignores clicks after a drag and clicks outside text boxes', () => {
    const { router, onLookup, click } = setup(false);
    router.click(click('in'), true);
    router.click(click('out'), false);
    expect(onLookup).not.toHaveBeenCalled();
  });

  it('ignores a mouse click that left a text selection, but not a touch tap', () => {
    const { router, onLookup, click } = setup(false);
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('in')!);
    window.getSelection()!.addRange(range);

    router.click(click('in'), false);
    expect(onLookup).not.toHaveBeenCalled();

    const touch = click('in');
    Object.defineProperty(touch, 'pointerType', { value: 'touch' });
    router.click(touch, false);
    expect(onLookup).toHaveBeenCalledTimes(1);
  });

  it('holds the lookup for the double-tap window when Capture double-tap is on', () => {
    const { router, onLookup, click } = setup(true);
    router.click(click('in'), false);
    vi.advanceTimersByTime(299);
    expect(onLookup).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onLookup).toHaveBeenCalledTimes(1);
  });

  it('a second tap cancels the held lookup', () => {
    const { router, onLookup, click } = setup(true);
    router.click(click('in'), false);
    vi.advanceTimersByTime(100);
    router.click(click('in'), false);
    vi.advanceTimersByTime(1000);
    expect(onLookup).not.toHaveBeenCalled();
  });

  it('cancel drops a held lookup', () => {
    const { router, onLookup, click } = setup(true);
    router.click(click('in'), false);
    router.cancel();
    vi.advanceTimersByTime(1000);
    expect(onLookup).not.toHaveBeenCalled();
  });
});
