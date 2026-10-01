import type { KanjiDictionaryEntry, Sentence, TermDictionaryEntry } from 'yomitan-core';

export type DrawerSelectionOrigin = 'results' | 'tokens';

export interface DrawerSelectionState {
  text: string;
  origin: DrawerSelectionOrigin;
}

export interface DrawerViewUiMeta {
  title: string;
  backLabel: string;
}

interface DrawerViewBase {
  id: number;
  query: string;
  rootSourceText: string;
  popupSourceText: string;
  ui: DrawerViewUiMeta;
}

export interface DrawerTermView extends DrawerViewBase {
  kind: 'term';
  entries: TermDictionaryEntry[];
  tokenIndex: number | null;
  /** The text-box sentence around the looked-up text, for `{sentence}` / cloze Anki fields. */
  sentence: Sentence;
}

export interface DrawerKanjiView extends DrawerViewBase {
  kind: 'kanji';
  entries: KanjiDictionaryEntry[];
}

export type DrawerSearchView = DrawerTermView | DrawerKanjiView;

const JAPANESE_SELECTION_PATTERN =
  /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}々〆ヵヶー]+$/u;

export function normalizeDrawerSelectionText(text: string): string {
  return text.replace(/\s+/g, '').trim();
}

export function isJapaneseSelection(text: string): boolean {
  return JAPANESE_SELECTION_PATTERN.test(text);
}

export function getSelectionCodePointLength(text: string): number {
  return [...text].length;
}
