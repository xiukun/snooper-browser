# Microsoft Edge Add-ons submission

## Short description

Real-time bilingual subtitles, visual understanding, notes, and provider routing in your browser.

## Long description

**snooper-browser** is a browser-only multimodal workspace for real-time bilingual subtitles, image understanding, notes, and transcription history.

Start transcription from the active tab or microphone, keep the original page audio audible, and receive short subtitle lines with context-aware translation. The extension includes an in-page toolbar and an optional side panel for local notes, history, and Obsidian Local REST API integration.

Configure your own MOSS-compatible or OpenAI-compatible providers. LLM, Audio, Video, and Image capabilities have independent provider and model routes. Chat and image understanding accept text, images, and code, with paste, drag-and-drop, and file-picker input.

The project has no backend, account system, telemetry, bundled API key, or advertising SDK. Provider URLs, keys, notes, and history stay in the browser. Network requests are sent directly to the provider chosen by the user.

## Permission and certification notes

- `activeTab` and `scripting` are used to open or inject the toolbar after the user invokes the extension.
- `storage` is used for local provider configuration, notes, Obsidian settings, history, and session recovery.
- `tabCapture` and `offscreen` are used only after the user starts audio transcription.
- `sidePanel` provides the optional notes and history surface.
- `<all_urls>` is required because the user can use the toolbar on arbitrary websites. The extension does not upload page content unless the user explicitly starts a transcription, chat, or image request.
- No remote code is loaded or executed. The ZIP contains the built JavaScript and all runtime assets.

## Privacy

Audio, chat text, and images are sent only when the user submits the related feature to the provider they configured. API keys and local records remain in extension storage. Obsidian integration is opt-in and targets the local endpoint configured by the user.

Privacy policy URL: replace this placeholder with a public HTTPS privacy policy URL before submission.

## Reviewer test steps

1. Install the ZIP in Microsoft Edge 116 or newer.
2. Open a normal HTTPS page and invoke the snooper-browser toolbar icon.
3. Open the side panel and choose **开始配置**.
4. Configure a reviewer-provided provider and models for LLM and Audio.
5. Start transcription, verify subtitles, and verify that page playback is not muted.
6. Review the local notes and history tabs, then test export and deletion.
7. Optionally test the Obsidian connection with a local Obsidian REST API endpoint.

No API keys or private endpoints are included in the package.
