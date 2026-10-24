import type { TextBoxTap } from '$lib/reader/input/text-box-tap';

/** A Tap Lookup: the tapped Text Box, where in it, and its lines as rendered. */
export interface LookupRequest extends TextBoxTap {
  /** Distinct per tap, so tapping the same Text Box again restarts the lookup. */
  id: number;
  /** The Text Box's lines (all of them, including ones the page doesn't render). */
  lines: string[];
  /** Identifies the Text Box's text (volume, page, block) for the segmentation cache. */
  boxKey: string;
}
