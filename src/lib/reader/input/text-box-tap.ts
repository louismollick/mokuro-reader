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
 *   (`TapDiscriminator`) and a second tap cancels it, so a Capture never also looks up.
 *   Otherwise it commits immediately.
 */
import { TapDiscriminator } from './tap';

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

export class TextBoxTapRouter {
  private config: TextBoxTapConfig;
  private pending: TextBoxTap | null = null;
  private discriminator: TapDiscriminator;

  constructor(config: TextBoxTapConfig) {
    this.config = config;
    this.discriminator = new TapDiscriminator({
      onTap: () => {
        const tap = this.pending;
        this.pending = null;
        if (tap) this.config.onLookup(tap);
      },
      onDoubleTap: () => {
        this.pending = null;
      }
    });
  }

  /** Report a click whose target is inside a text box. */
  click(event: MouseEvent, wasDrag: boolean): void {
    const textBox =
      event.target instanceof Element ? event.target.closest<HTMLElement>('.textBox') : null;
    if (!textBox || wasDrag || leftTextSelection(event)) return;

    const tap = { textBox, x: event.clientX, y: event.clientY };
    if (!this.config.deferForDoubleTap()) {
      this.cancel();
      this.config.onLookup(tap);
      return;
    }
    this.pending = tap;
    this.discriminator.tap(tap.x, tap.y);
  }

  /** Drop any held lookup (component teardown). */
  cancel(): void {
    this.pending = null;
    this.discriminator.cancel();
  }
}
