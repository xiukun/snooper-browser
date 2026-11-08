# Translation History, Markdown Assets, and Noise Filtering Design

Date: 2026-11-08
Status: Approved

## Goal

Make captured translation history useful after recording ends, make Markdown exports readable in normal editors and Obsidian, and reduce subtitles hallucinated from silence, music, and persistent background noise.

## Scope

- Persist complete subtitle lines in each extension history entry.
- Let the side panel expand a history entry and expose copy and Markdown export actions.
- Export note and transcript images as real files referenced by relative Markdown paths instead of embedding Base64 data URLs.
- Add a conservative audio-feature gate before ASR while retaining the existing text-side hallucination guards.
- Keep existing local-only storage, optional Obsidian sync, and bounded history behavior.

## Data Model

`HistoryEntry` gains `subtitles`, containing the original subtitle line fields needed for review: `at`, `endedAt`, `source`, `target`, and `latency`. Existing entries without `subtitles` remain readable as legacy summary records.

History continues to be stored in `chrome.storage.local` under the existing versioned key and remains bounded to 100 entries. A history record is written on stop, navigation, and tab close using the current session snapshot.

## History UX

The side panel history card remains compact by default and shows page metadata, language direction, and a subtitle preview. Selecting or opening a card reveals the full timestamped original/translation table. Actions are copy transcript, export this record as Markdown, and delete. Empty and legacy records explain when no subtitle body is available.

## Markdown Assets

All export paths use one asset extraction/serialization contract:

- Data URL images are decoded into binary image files under an `assets/` directory next to the Markdown file.
- SVG entries are written as `.svg` files under `assets/`.
- Markdown references local assets with relative paths for downloaded files.
- Obsidian sync uploads assets first and references them with Obsidian wikilinks.
- An image that cannot be materialized is represented by a short explanatory placeholder, never its raw Base64 payload.

## Noise Filtering

The existing RMS gate remains the cheap first stage. A second pure feature gate examines each segment's frame-level energy shape before ASR:

- speech-energy ratio,
- active-frame transitions,
- energy variation across active frames,
- minimum active duration.

The gate rejects long, continuously active, low-variation audio that is more consistent with music beds or steady noise than speech. It does not reject a short segment based on RMS shape alone, and the existing ASR phrase/repetition guards remain the final defense. Diagnostics record the gate reason and feature values.

## Verification

- Unit-style script tests cover history serialization, asset extraction, and audio-feature decisions.
- Existing audio hallucination, capture recovery, language, and keyed-task tests continue to pass.
- `npm run type-check`, `npm run build:app`, `npm run build:ext`, `git diff --check`, and final extension packaging pass.
