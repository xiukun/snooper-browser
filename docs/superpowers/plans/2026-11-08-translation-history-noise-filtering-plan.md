# Translation History, Markdown Assets, and Noise Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist complete translation records, export readable Markdown with real image assets, and filter persistent non-speech audio before ASR.

**Architecture:** Extend the existing local history record with bounded subtitle snapshots. Share pure export helpers between page and side-panel downloads, while keeping Obsidian upload conversion at the background bridge. Add a pure audio-feature classifier between the existing RMS gate and ASR so its thresholds are testable without browser APIs.

**Tech Stack:** TypeScript, Chrome MV3 extension APIs, browser `Blob`/`FileReader` primitives, existing Node + esbuild script tests, Vue app build.

## Global Constraints

- Keep storage local and preserve existing versioned keys.
- Do not add runtime dependencies.
- Preserve the existing `STOCK_LINES`, repetition, and RMS guards.
- Keep Markdown free of raw Base64 payloads.
- Keep README.md and README.zh-CN.md structurally synchronized.
- Run `npm run type-check` and `npm run build:ext` before claiming completion.

### Task 1: Persist Complete History Records

**Files:**
- Modify: `src/ext/background/history.ts`
- Modify: `src/ext/background/router/offscreen-events.ts`
- Modify: `src/ext/background/session-store.ts` only if the snapshot type needs a shared export
- Test: `scripts/test-history-export.mjs`

**Interfaces:**
- `HistoryEntry.subtitles` is an array of `{ at?: number; endedAt?: number | null; source: string; target: string; latency?: number }`.
- `persistSessionHistory(tabId)` serializes the current session subtitles without changing existing lifecycle callers.

- [ ] Add the subtitle snapshot type and include it in new records.
- [ ] Preserve legacy records when reading and avoid failing on missing subtitle arrays.
- [ ] Add a pure serialization assertion to the history/export script.
- [ ] Run the focused script and verify new records contain original, translation, and timestamps.

### Task 2: Make History Readable in the Side Panel

**Files:**
- Modify: `src/ext/sidepanel/panel.ts`
- Modify: `ext/sidepanel/panel.css` if the generated source is maintained here
- Modify: `src/ext/sidepanel/index.html` or its source template if needed
- Test: `scripts/test-history-export.mjs`

**Interfaces:**
- History cards render from `HistoryEntry` returned by `GET_HISTORY`.
- Detail rendering accepts legacy entries with no subtitle body.

- [ ] Add an expand/collapse control to each history card.
- [ ] Render timestamped source/target rows with safe `textContent` assignment.
- [ ] Add copy and single-record Markdown export actions.
- [ ] Keep delete and bulk delete behavior unchanged.
- [ ] Verify the generated side-panel bundle contains the new detail actions.

### Task 3: Unify Markdown Asset Export

**Files:**
- Modify: `src/ext/content/exporter.ts`
- Modify: `src/ext/sidepanel/panel.ts`
- Modify: `src/ext/background/obsidian.ts`
- Modify: `src/ext/content/obsidian-export.ts`
- Test: `scripts/test-history-export.mjs`

**Interfaces:**
- `collectNoteAssets()` remains the source of asset plans for notes and chat images.
- New helper converts a data URL into bytes and produces a Markdown reference without exposing the data URL.

- [ ] Add binary asset decoding for PNG/JPEG/WebP/GIF data URLs and raw SVG files.
- [ ] Make single-file Markdown use explanatory placeholders for local-only image data, and add a ZIP export path containing `record.md` plus `assets/<file>` files so relative references work reliably.
- [ ] Make side-panel single-note export use the same asset naming and placeholder rules.
- [ ] Preserve Obsidian upload-first ordering and wikilink references.
- [ ] Test that output contains no `data:image` string and that assets retain their MIME-derived extensions.

### Task 4: Add Conservative Audio Feature Gate

**Files:**
- Create: `src/lib/audio-noise-gate.ts`
- Modify: `src/ext/offscreen/capture.ts`
- Modify: `scripts/test-audio-guards.mjs`

**Interfaces:**
- `classifyAudioFrames(frameRms: number[], frameLens: number[], sampleRate: number): { accept: boolean; reason: string; speechRatio: number; transitions: number; variation: number }`.

- [ ] Add failing cases for silent audio, short clicks, steady noise, and speech with pauses.
- [ ] Implement a frame-level classifier using RMS-derived active frames, transition count, and active-frame variation.
- [ ] Call it after `speechDurationMs` and before creating the WAV request.
- [ ] Record a structured `dropped non-speech audio` diagnostic with feature values.
- [ ] Verify real short speech is not rejected solely for being short or low-transition.

### Task 5: Documentation, Full Verification, and Git Delivery

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `doc/adr/ADR-028_Idempotent_Capture_Startup.md`

- [ ] Document where translation history is opened and how to expand/export it.
- [ ] Document that Markdown image assets are exported as files and how Obsidian sync handles them.
- [ ] Record the noise-gate decision and test evidence in the ADR.
- [ ] Run `npm run test:guards`, history/export tests, `npm run type-check`, `npm run build:app`, `npm run build:ext`, `npm run package:ext`, and `git diff --check`.
- [ ] Inspect ZIP contents and SHA-256.
- [ ] Commit only the intended implementation, documentation, and generated extension artifacts with a concise conventional commit.
