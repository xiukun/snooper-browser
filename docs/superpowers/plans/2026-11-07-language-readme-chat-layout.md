# Language, README, and Chat Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict real-time subtitle source-language choices to automatic detection, Chinese, and English; keep the existing translation targets; document the tool with screenshots; and make the companion/note editors more usable.

**Architecture:** Keep source and target language arrays separate in the shared model metadata and in the MV3 content script, because the content script is bundled independently. The source list is used for ASR and defaults to `auto`; the target list remains the existing ten translation languages and excludes `auto`. The shared editor CSS receives a larger initial height with a bounded scrollable maximum.

**Tech Stack:** TypeScript, esbuild MV3 extension build, Markdown README files, CSS embedded in `src/ext/content.ts`, Node assertion scripts.

## Global Constraints

- Preserve unrelated working-tree changes; stage only files belonging to this request.
- Keep source language default as `auto`.
- Keep the existing target-language choices unchanged.
- Keep UI copy concise and in Chinese in the extension.
- Do not add dependencies or expose credentials in screenshots, docs, or commits.
- Run `node scripts/test-languages.mjs`, `npm run test:guards`, `npm run type-check`, `npm run build:app`, `npm run build:ext`, and `git diff --check` before committing.

### Task 1: Split language metadata and menus

**Files:**
- Modify: `src/lib/models.ts`
- Modify: `src/ext/content.ts`
- Create: `scripts/test-languages.mjs`

**Interfaces:**
- Produces `SOURCE_LANGUAGES` with `auto`, `zh`, `en`.
- Produces `TARGET_LANGUAGES` with the existing target list: `zh`, `en`, `ja`, `ko`, `fr`, `de`, `es`, `ru`, `ar`, `pt`.

- [ ] Add a failing language metadata test that asserts exact source and target codes and rejects `auto` as a target.
- [ ] Run `node scripts/test-languages.mjs` and confirm it fails against the current shared list.
- [ ] Implement the two shared arrays and update language-label lookup to cover both arrays without duplicate language entries.
- [ ] Replace the content script's single local `LANGUAGES` array with source and target arrays; render each menu from its corresponding array.
- [ ] Run the language test and confirm it passes.

### Task 2: Improve companion and note editor height

**Files:**
- Modify: `src/ext/content.ts:890-920`

- [ ] Set the shared chat/note editor and Markdown preview to a usable initial height around 68px and a bounded maximum around 160px.
- [ ] Keep `overflow-y: auto`, placeholder behavior, and the existing single-row attachment/send layout intact.
- [ ] Build the extension and inspect the generated CSS-bearing bundle for the new limits.

### Task 3: Document features and screenshots

**Files:**
- Create: `docs/screenshots/toolbar-language-and-subtitles.jpg`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

- [ ] Copy the supplied screenshot into the repository without credentials.
- [ ] Add a bilingual feature overview covering subtitles, companion chat, notes/export, image understanding, provider routing, model discovery, and privacy/data flow.
- [ ] Add the screenshot with a caption explaining the language selector, subtitle overlay, companion drawer, and pause/silent-audio state.
- [ ] Correct the real-time subtitle language wording to distinguish source choices from translation targets.
- [ ] Keep English and Chinese README sections structurally aligned.

### Task 4: Verify and commit

- [ ] Run all commands listed in Global Constraints and read their exit status.
- [ ] Inspect the staged diff and confirm no `.env` or credential files are included.
- [ ] Stage only the language, layout, README, screenshot, test, and plan files from this request.
- [ ] Commit with `feat(ext): clarify languages and companion layout`.
