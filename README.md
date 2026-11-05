# snooper

**See it. Translate it. Understand it.**

[![License: MIT](https://img.shields.io/badge/license-MIT-7c5cff.svg)](./LICENSE)
[![Vue 3](https://img.shields.io/badge/Vue-3.5-3ee6d5.svg)](https://vuejs.org)
[![Vite](https://img.shields.io/badge/Vite-8-9c85ff.svg)](https://vite.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-7ef2e4.svg)](https://tailwindcss.com)

English · [简体中文](./README.zh-CN.md)

snooper is an open-source multimodal workspace that runs entirely in the browser. Capture tab or microphone audio for real-time bilingual subtitles, question a vision model about what is on screen, and route every capability to whichever provider you trust. No backend, no bundled keys, no telemetry.

## Features

### Real-time subtitles

- Two audio sources: microphone, or tab audio through `getDisplayMedia({ audio: true })`.
- The original playback is **never muted** — subtitles and video coexist.
- 6-second segments → speech-to-text → context-aware translation → subtitles appear line by line.
- Ten language pairs (zh / en / ja / ko / fr / de / es / ru / ar / pt); switching applies to the next line.
- Built-in demo stream, so the subtitle animation can be reviewed without any key.

### Chat

- Multimodal input: text, images and code in the same thread.
- Markdown rendering with Shiki highlighting; streaming output can be stopped at any time.
- History is flattened into a single user message, which is what single-turn models require.
- Attach images by drag-and-drop, paste, or file picker.

### Image understanding

- Up to 10 images per run, 20 MB each, compressed in-browser before upload.
- Six presets: full description, text extraction, chart reading, code reading, image translation, product analysis.
- Markdown results, run history, and a lightbox for the source images.

### Provider management

- **Multiple providers side by side**: official gateway, third-party relay, or a self-hosted endpoint, each with its own base URL and key.
- **Three independent capability routes**: `LLM` (chat / vision / translation), `Audio` (ASR) and `Video` (low-latency frame understanding) may point at different providers and models.
- **Model discovery** via `GET /models`, cached per provider with status and the raw error message.
- Works with any OpenAI-compatible relay; the MOSS protocol is built in.
- Configuration and keys live only in `localStorage`.

## Quick start

```bash
cd app
pnpm install
cp .env.example .env.local   # optional — the app can be configured in the UI
pnpm dev                     # http://localhost:5173
```

Production build:

```bash
pnpm build
pnpm preview
```

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_MOSS_API_KEY` | No | Pre-fills the key of the default provider on first launch |
| `VITE_MOSS_BASE_URL` | No | Base URL of the default provider (defaults to `https://api.mosi.cn/v1`) |

Both are **development conveniences only**. Regular users add providers in the app; changing them does not require a rebuild. `.env.local` is git-ignored — never commit a real key.

## Configuration

1. Open **Settings → Providers**, fill in a name, base URL and API key, then pick a protocol (`MOSS native` or `OpenAI compatible`).
2. Click **Fetch models** to call `GET {baseUrl}/models`. Results are cached; failures are shown verbatim on the provider card.
3. In **Capability routes**, choose a provider and model for **LLM / Audio / Video**. The model field autocompletes from the fetched list but accepts free text, because many relays do not implement `/models`.
4. Chat, image understanding and subtitle translation share the `LLM` route; the listening half of the subtitle pipeline uses the `Audio` route.

> Keys are written to `localStorage` and requests go straight from your browser to the provider you configured. If you deploy this publicly and need to hide the key, put a proxy in front of it.

## Tech stack

| Layer | Choice | Why this and not the alternative |
| --- | --- | --- |
| Framework | Vue 3.5 (`<script setup lang="ts">`) | One reactive store per capability, no router, no SSR — a single-page tool does not need a meta-framework. |
| Build | Vite 8 | Native ESM dev server; the only build-time plugin is Vue's. |
| Language | TypeScript 6, `strict` + `noUnusedLocals` | Catches the whole class of "renamed a field and forgot a call site" bugs in the config/routing layer. |
| Styling | Tailwind CSS 4 (design tokens in `main.css`) | Tokens are the design system; no component library to fight against. |
| Icons | `@lucide/vue` | Tree-shaken imports, consistent stroke weight. |
| Markdown | `markdown-it` + Shiki | Shiki ships the TextMate grammar, so code rendered in chat looks like an editor, not a `<pre>`. It loads lazily on the first markdown view with five core languages. |
| Toasts | `vue-sonner` | Two lines of integration, accessible by default. |

### Version policy

- Dependencies track the latest release, **with one deliberate exception**: TypeScript is pinned to the latest 6.x. `vue-tsc` 3.3.x resolves `typescript/lib/tsc`, which TypeScript 7 no longer exports — running `vue-tsc` against TS 7 fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Revisit when `vue-tsc` ships TS 7 support.
- `@types/node` tracks the Node major used for the build (currently 22), not the newest published types.
- `lucide-vue-next` was replaced by `@lucide/vue` after the former was deprecated upstream.
- Updates arrive weekly through Dependabot; majors are reviewed by hand. The check is always the same: `pnpm exec vue-tsc -b --force && pnpm build`.

## Project structure

```
app/
├── index.html
├── public/favicon.svg
└── src/
    ├── assets/main.css        # design tokens, glass surfaces, markdown typography
    ├── components/            # brand mark, layout shell, form primitives
    ├── composables/
    │   ├── useRealtime.ts     # capture → segment → transcribe → translate → subtitles
    │   ├── useChat.ts         # conversation and attachments
    │   ├── useVision.ts       # image analysis
    │   ├── useSettings.ts     # provider CRUD, routes, /models sync
    │   └── useNavigation.ts
    ├── lib/
    │   ├── providers.ts       # config model, defaults, migration, resolveRoute
    │   ├── moss.ts            # OpenAI-compatible client: streaming fallback, ASR, vision
    │   ├── models.ts          # message types, model catalogue, languages
    │   ├── markdown.ts        # Shiki highlighting
    │   ├── navigation.ts      # views and keyboard shortcuts
    │   └── brand.ts           # brand and storage keys
    └── views/                 # Translate / Chat / Vision / Settings
```

## Browser support

- Chrome / Edge 116+ for tab audio and screen capture.
- Microphone capture needs `getUserMedia` permission; tab audio needs an explicit share grant.
- Safari and Firefox run chat and image understanding; audio capture support is limited.

## Privacy

- No backend, no analytics, no accounts.
- Audio is sent in 6-second segments to the provider behind your `Audio` route; images are sent as base64 to the provider behind your `LLM` route.
- Provider URLs, keys and model choices stay in the browser. See [SECURITY.md](./SECURITY.md) for the threat model.

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request. Security issues should follow [SECURITY.md](./SECURITY.md) instead of the public tracker.

## License

[MIT](./LICENSE) © 2026 snooper-browser contributors
