# Mokuro Reader (fork)

A manga reader for Japanese learners: pages carry mokuro OCR text, which the reader turns into dictionary lookups and Anki cards. This glossary covers the fork's lookup and mining vocabulary.

## Page text

**Text Box**:
One mokuro OCR block on a page: a bounding box plus its ordered lines of recognized text.
_Avoid_: Block (in UI and docs), bubble

**Line**:
One OCR line inside a Text Box, with its own position on the page. In vertical text a Line is a column.

**Panel**:
A framed region of a manga page that holds art and Text Boxes. Not part of mokuro data; the reader infers it.

## Lookup

**Tap Lookup**:
Tapping a character in a Text Box on the page to look up the Word that contains it.
_Avoid_: Text selection, search selection

**Segmentation**:
Splitting a Text Box's text into Words using the installed dictionaries.
_Avoid_: Tokenization, parsing

**Word**:
A span of a Text Box's text that Segmentation matched to dictionary entries, possibly inflected.
_Avoid_: Token, term (when meaning the span on the page)

**Sentence**:
The text around a Word that goes on the card, bounded by sentence punctuation within its Text Box.

**Lookup Sheet**:
The bottom sheet that shows lookup results while the page stays visible.
_Avoid_: Drawer, popup

**Word View**:
The Lookup Sheet view for one Word: the Sentence's Words with the chosen one selected, plus its dictionary entries. Tap Lookup always opens a Word View, even for a single-kanji Word.

**Kanji View**:
The Lookup Sheet view for one kanji. Reached only by tapping a kanji inside a Word View (or another Kanji View), never directly from the page.

**Common Words**:
Frequent Words containing a given kanji, ranked by frequency, shown in the Kanji View.

**Similar Kanji**:
Kanji that look like a given kanji and are easy to confuse with it.

**Components**:
The parts a kanji is built from (radicals and sub-shapes).
_Avoid_: Radicals (a subset), breakdown

## Anki

**Mining**:
Adding an Anki card for a Word from the Word View, with dictionary fields, the Sentence and a Panel Crop.
_Avoid_: Capture

**Capture**:
Upstream's card flow: double-tap or right-click a Text Box to create or update a card with a page image and the box's text, without dictionary data.
_Avoid_: Mining

**Panel Crop**:
The image attached to a mined card: the Panel containing the Word's Text Box, cut from the page.
_Avoid_: Screenshot
