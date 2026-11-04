# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅        |

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private security advisory:

<https://github.com/snooper-browser/snooper-browser/security/advisories/new>

Include the affected version, reproduction steps, and impact. You can expect an
acknowledgement within 72 hours and a coordinated disclosure once a fix ships.

## Key handling

snooper runs entirely in the browser and ships **no server component**.

- Provider API keys live only in `localStorage` on your machine and are never
  sent to any first-party server.
- Requests go directly from your browser to the provider you configure.
- Audio is uploaded only as short 6-second segments to the provider handling the
  `audio` capability; images are sent as base64 to the provider handling `LLM`.
- Production deployments that need to hide keys should proxy requests through a
  short-lived server token instead of shipping a long-lived key to the client.

No credentials are hard-coded in this repository. `.env*` files are git-ignored;
`.env.example` contains empty placeholders only.
