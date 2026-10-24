/**
 * Tap Lookup intent: a single tap on a `.textBox` asks the Reader to look up the tapped Word.
 * Surfaces feed it every click that lands on a text box (with their tracker's `wasDrag`); it
 * decides whether the click is a tap and when to commit it.
 *
 * - A click after a drag is not a tap (touch pans across text boxes).
 * - A mouse/pen click that left a text selection is not a tap: drags select text for Yomitan and
 *   Migaku users, which a lookup must never interrupt. Touch has no drag-selection, so it never
 *   checks.
 * - When Capture's double-tap trigger is on, the lookup waits out the double-tap window
 *   (`DOUBLE_TAP_DELAY_MS`, shared with `TapDiscriminator`) and a second tap on the same text box,
 *   close to the first, cancels it, so a Capture never also looks up. A tap on another box
 *   replaces the held one. Otherwise it commits immediately.
 */
import { DOUBLE_TAP_DELAY_MS } from './tap';

export interface TextBoxTap {
  textBox: HTMLElement;
  /** Viewport coordinates of the tap. */
  x: number;
  y: number;
}

export interface TextBoxTapConfig {
  /** Capture's double-tap trigger is enabled, so a lone tap must wait for a possible second. */
  deferForDoubleTap(): boolean;
  onLookup(tap: TextBoxTap): void;
}

/** Whether Capture's double-tap trigger is on for this `ankiConnectSettings.triggerMethod`. */
export function captureUsesDoubleTap(triggerMethod: string): boolean {
  return triggerMethod === 'doubleTap' || triggerMethod === 'both';
}

function leftTextSelection(event: MouseEvent): boolean {
  if ((event as PointerEvent).pointerType === 'touch') return false;
  const selection = window.getSelection();
  return !!selection && !selection.isCollapsed && selection.toString() !== '';
}

/** A second tap further than this from the held one is a new tap, not a double. */
const MAX_DOUBLE_TAP_DISTANCE_PX = 40;

export class TextBoxTapRouter {
  private config: TextBoxTapConfig;
  private pending: { tap: TextBoxTap; timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(config: TextBoxTapConfig) {
    this.config = config;
  }

  /** Report a click whose target is inside a text box. */
  click(event: MouseEvent, wasDrag: boolean): void {
    const textBox =
      event.target instanceof Element ? event.target.closest<HTMLElement>('.textBox') : null;
    if (!textBox) return;
    const tap = { textBox, x: event.clientX, y: event.clientY };

    // First of all, a second tap on the same spot cancels the held lookup: it is Capture's
    // double-tap. This comes before the selection check because a desktop double-click selects
    // a word before its second click lands.
    const held = this.pending?.tap;
    if (
      held &&
      (event.detail >= 2 ||
        (held.textBox === textBox &&
          Math.hypot(held.x - tap.x, held.y - tap.y) <= MAX_DOUBLE_TAP_DISTANCE_PX))
    ) {
      this.cancel();
      return;
    }
    if (wasDrag || leftTextSelection(event)) return;

    // A tap elsewhere replaces the held one and gets its own window.
    this.cancel();
    if (!this.config.deferForDoubleTap()) {
      this.config.onLookup(tap);
      return;
    }
    const timer = setTimeout(() => {
      this.pending = null;
      this.config.onLookup(tap);
    }, DOUBLE_TAP_DELAY_MS);
    this.pending = { tap, timer };
  }

  /** Drop any held lookup (component teardown, page change). */
  cancel(): void {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = null;
  }
}
