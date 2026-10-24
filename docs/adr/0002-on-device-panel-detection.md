# Detect Panels with an on-device YOLO model, not a gutter heuristic

A mined card's Panel Crop is the Panel containing the Word's Text Box. We detect Panels with `manga-panel-detector-yolo26n` (ONNX, AGPL-3.0, trained on Manga109-s) run in the browser with onnxruntime-web, loaded lazily on the first Mining and cached by the service worker. The crop is the smallest detected Panel holding at least half of the Text Box, falling back to upstream's padded text-box crop.

## Considered Options

Scored on 81 sampled Text Boxes across Dorohedoro 01, Chainsaw Man 06 and Berserk 13 (October 2026), usable crops (good + OK):

- Upstream padded text-box crop: 65%, never an actual Panel.
- Gutter scan (expand from the Text Box until a background-colored band): 53%. Bubble tails, art bleeding into gutters and screentone break the clean-gutter assumption, so it usually returned the whole page.
- YOLO panel detector: 99% (85% good), about 80 ms per page on desktop CPU.
- Running the model on the VPS next to AnkiConnect was rejected: on-device works offline and adds no server.

## Consequences

The model is AGPL-3.0. The app is GPL-3.0 and its source is public, which satisfies AGPL's network clause for the hosted fork.
