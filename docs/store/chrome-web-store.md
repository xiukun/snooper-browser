# Chrome Web Store submission

## Store description

**snooper-browser** is a browser-only multimodal workspace for real-time bilingual subtitles, visual understanding, notes, and provider routing.

Capture microphone or tab audio, transcribe it into short segments, and translate the result into subtitles without muting the original page. Open the in-page toolbar from the extension action, or use the side panel to review local notes, transcription history, and optional Obsidian exports.

The extension also supports multimodal chat and image understanding. Add images by paste, drag-and-drop, or file picker, then ask a configured vision model to describe, translate, read, or analyze them. LLM, audio, video, and image capabilities can be routed to separate OpenAI-compatible or MOSS-compatible providers.

There is no project backend, account, telemetry, or bundled API key. Provider URLs, API keys, model choices, notes, and history remain in the browser's extension storage. Requests go directly from the browser to the provider selected by the user.

## Permission justifications

| Permission | Justification |
| --- | --- |
| `activeTab` | Opens the toolbar and settings on the tab where the user invokes the extension action. |
| `scripting` | Injects the content script after an explicit user action when a tab was not initialized yet. |
| `storage` | Stores user-configured provider settings, notes, Obsidian settings, transcription history, and session state locally. |
| `tabCapture` | Obtains audio from the active tab after the user starts real-time transcription. It does not read page content. |
| `offscreen` | Runs the Web Audio capture and encoding pipeline in an offscreen document, as required for MV3 service workers. |
| `sidePanel` | Provides the optional notes, history, and Obsidian integration panel. |
| `<all_urls>` host permission | Runs the user-invoked in-page subtitle toolbar on arbitrary websites and supports pages selected by the user. No page data is sent until the user starts a feature. |

## Privacy disclosure

- The extension does not operate a backend, analytics service, advertising service, or telemetry endpoint.
- API keys are entered by the user and stored locally in Chrome extension storage.
- Audio is sent only to the configured audio provider when transcription is started.
- Images and chat text are sent only to the configured provider when the user submits a request.
- Notes and transcription history are stored locally. Obsidian sync is optional and sends notes only to the user's configured local Obsidian REST API endpoint.
- The extension does not sell personal information or use data for advertising.

Privacy policy reference: `SECURITY.md` in the project repository. Before publishing, replace this with a publicly reachable privacy policy URL in the Developer Dashboard.

## Reviewer test steps

1. Install the uploaded ZIP as an unpacked extension in Chrome 116 or newer.
2. Open any normal HTTPS page and click the snooper-browser toolbar icon.
3. Open the extension side panel and click **开始配置** to open provider settings in the active tab.
4. Enter a test provider URL and API key supplied by the reviewer, then choose models for LLM and Audio routes.
5. Start microphone or tab-audio transcription from the page toolbar. Confirm that the original page audio remains audible and subtitles appear.
6. Open the side panel's notes and history tabs. Confirm that records are local and can be exported or deleted.
7. Optionally configure Obsidian Local REST API and use **测试连接**.

No credentials are included in the uploaded package.
