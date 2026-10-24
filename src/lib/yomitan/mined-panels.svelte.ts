import { SvelteMap } from 'svelte/reactivity';
import type { TermDictionaryEntry } from 'yomitan-core';
import { headwordKey } from './entry-data';
import { ScreenshotLog, type MinedPanel } from './mining';

/** The Panel Crops mined during one Lookup Sheet session, per Word, for the Word View to show. */
export class MinedPanels {
  /** Filled by the session's Anki transport. */
  readonly screenshots = new ScreenshotLog();
  private panels = new SvelteMap<string, MinedPanel>();

  get(entry: TermDictionaryEntry): MinedPanel | undefined {
    return this.panels.get(headwordKey(entry));
  }

  set(entry: TermDictionaryEntry, panel: MinedPanel) {
    this.panels.set(headwordKey(entry), panel);
  }
}
