import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TextBoxTapRouter } from './text-box-tap';

function setup(defer: boolean) {
  document.body.innerHTML =
    '<div class="textBox"><span id="in">猫</span></div>' +
    '<div class="textBox"><span id="other">犬</span></div><div id="out"></div>';
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

  it('a desktop double-click cancels the held lookup even though it selected a word', () => {
    const { router, onLookup, click } = setup(true);
    router.click(click('in'), false);
    vi.advanceTimersByTime(100);
    // The browser selected the word before the second click landed.
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('in')!);
    window.getSelection()!.addRange(range);
    router.click(click('in', { detail: 2 }), false);
    vi.advanceTimersByTime(1000);
    expect(onLookup).not.toHaveBeenCalled();
  });

  it('a tap on another text box replaces the held one and gets its own window', () => {
    const { router, onLookup, click } = setup(true);
    router.click(click('in'), false);
    vi.advanceTimersByTime(100);
    router.click(click('other'), false);
    vi.advanceTimersByTime(299);
    expect(onLookup).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onLookup).toHaveBeenCalledTimes(1);
    expect(onLookup.mock.calls[0][0].textBox.textContent).toBe('犬');
  });

  it('a second tap on the same box but far away is a new tap, not a double', () => {
    const { router, onLookup, click } = setup(true);
    router.click(click('in', { clientX: 10, clientY: 10 }), false);
    vi.advanceTimersByTime(100);
    router.click(click('in', { clientX: 200, clientY: 200 }), false);
    vi.advanceTimersByTime(300);
    expect(onLookup).toHaveBeenCalledTimes(1);
    expect(onLookup.mock.calls[0][0].x).toBe(200);
  });
});
