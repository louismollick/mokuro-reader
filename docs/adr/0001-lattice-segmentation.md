# Segment Text Boxes with a frequency-scored lattice over the installed dictionaries

Tap Lookup needs the Word containing the tapped character, so each Text Box is segmented into Words. We segment with a lattice built from yomitan-core's own term matches (every match length, with deinflection) and pick the cheapest path, where each Word costs `ln(frequency rank) + 6` from the first frequency dictionary in the profile's order (fewest Words when none is installed). This replaced yomitan-core's greedy longest-match `parse`, which swallows the next word (そのバ → その場, ができ → 臥する).

## Considered Options

Measured on 194 random taps across Dorohedoro 01, Chainsaw Man 06 and Berserk 13 (October 2026):

- Greedy longest match (previous behavior): 77% correct.
- Lattice: 83% correct, 0 extra bytes, ~7 ms per Text Box.
- MeCab/UniDic or Sudachi plus Yomitan's inflection merge rules: 70 to 72% correct. Morpheme boundaries don't line up with dictionary headwords, and the dictionaries are 18 to 200 MB.
- ichiran: about as accurate as the lattice, but server-only (Common Lisp plus a 4.7 GB Postgres).
- Frequency source barely matters for segmentation (JPDB, Jiten global and Jiten manga within one tap). Jiten manga is the recommended default because it also gives the best Common Words for manga.

## Consequences

Names and katakana SFX remain the main failure class. Adding UniDic proper nouns as extra lattice edges fixed 3 of 194 taps with no regressions, but costs an 18 MB+ dictionary, so it is deferred.
