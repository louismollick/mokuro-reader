/**
 * The Lookup Sheet's view history, as pure transitions. The root is the Word View for the tapped
 * Text Box (its Sentence strip lets the user switch Word in place); a selection in the strip or a
 * Common Word pushes a standalone Word View, a kanji in a headword pushes a Kanji View, and a new
 * Tap Lookup starts a fresh history.
 */

export type LookupView =
  /** The Text Box's Word View; `wordIndex` indexes its Segmentation tokens (null: nothing matched). */
  | { kind: 'box'; wordIndex: number | null }
  /** A Word View for arbitrary text, without the Sentence strip. */
  | { kind: 'term'; query: string }
  | { kind: 'kanji'; character: string };

export type LookupHistory = readonly [LookupView, ...LookupView[]];

export function startHistory(wordIndex: number | null): LookupHistory {
  return [{ kind: 'box', wordIndex }];
}

/** Switching Word in the Sentence strip replaces the root view in place. */
export function selectWord(wordIndex: number | null): LookupHistory {
  return startHistory(wordIndex);
}

export function pushView(history: LookupHistory, view: LookupView): LookupHistory {
  return [...history, view];
}

export function popView(history: LookupHistory): LookupHistory {
  return history.length > 1 ? (history.slice(0, -1) as unknown as LookupHistory) : history;
}

export function currentView(history: LookupHistory): LookupView {
  return history[history.length - 1];
}

/** The view's name for the back control: the Word's text, the query or the kanji. */
export function viewTitle(view: LookupView, wordText: (index: number) => string | undefined) {
  switch (view.kind) {
    case 'box':
      return (view.wordIndex !== null && wordText(view.wordIndex)) || '';
    case 'term':
      return view.query;
    case 'kanji':
      return view.character;
  }
}

/** The title of the view the back control returns to, or null at the root. */
export function backTitle(
  history: LookupHistory,
  wordText: (index: number) => string | undefined
): string | null {
  return history.length > 1 ? viewTitle(history[history.length - 2], wordText) : null;
}
