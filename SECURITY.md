# Security Policy

## 1. Architecture & Threat Model

snooper-browser is a **browser-only, client-side single page application (SPA)**. It operates without any backend server, telemetry endpoint, database, or proxy hosted by the project maintainers.

### 1.1 Direct Provider Connectivity
All network communications (including chat completions, audio transcription, image analysis, and model discovery) are initiated directly from the user's browser runtime to the configured AI provider gateway (e.g., official MOSS API or user-specified custom reverse proxies).

```
┌─────────────────────────────────┐
│     User's Browser Runtime      │
│  - Reactive UI state            │
│  - Web Audio / MediaStream      │
│  - Key in localStorage / memory │
└───────────────┬─────────────────┘
                │ Direct HTTPS / WSS requests
                │ Authorization: Bearer <API_KEY>
                ▼
┌─────────────────────────────────┐
│    Third-Party AI Gateway       │
│  - MOSS / Custom Relay Service  │
└─────────────────────────────────┘
```

### 1.2 Credential Handling
1. **Zero Repository Secrets**: The repository contains no API keys, default tokens, or pre-configured credentials.
2. **Local Storage Isolation**:
   - API keys entered by the user are stored strictly inside the browser's origin-scoped `localStorage` / `sessionStorage`.
   - Credentials never touch any third-party analytics, error-tracking, or logging servers.
3. **Export & Persistence Boundary**:
   - Subtitle exports (`.srt`, `.vtt`), study notes (`.md`), and raw session backups (`.json`) are generated purely in-memory using Web Blob APIs and downloaded directly to the local disk.

---

## 2. Known Security Considerations & Limitations

Because snooper-browser runs entirely within the client-side browser sandbox, users should be aware of the following security realities:

### 2.1 XSS (Cross-Site Scripting) Exposure
Any malicious browser extension with broad DOM/storage permissions, or any malicious script injected into the origin hosting snooper-browser, can inspect `localStorage` and extract stored API credentials.

**Mitigation & Recommendations:**
- Deploy snooper-browser on a dedicated, isolated domain or run it locally (`http://localhost:5173`).
- Do not run untrusted or unverified browser extensions in the profile where snooper-browser is used.
- For shared or untrusted workstations, clear the credentials in **Settings (能力设置)** or use private browsing / Incognito mode.

### 2.2 Network Eavesdropping & CORS
Direct client-to-gateway connections expose your provider API key as an HTTP header (`Authorization: Bearer sk-...`) within outgoing network packets.

**Mitigation & Recommendations:**
- Always ensure provider `Base URL` endpoints strictly use encrypted transport (`https://` or `wss://`). Never point routes to plaintext `http://` relays.
- If your provider gateway requires custom CORS policies, avoid using public open-cors proxies (such as `cors-anywhere`) that inspect request headers. Use an owned, dedicated reverse proxy (e.g., Cloudflare Workers or Nginx with strict IP whitelisting).

---

## 3. Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

---

## 4. Reporting a Vulnerability

If you discover a potential security issue in snooper-browser (such as client-side script injection vulnerabilities, unintended credential leakage in loggers, or sanitization bypasses):

1. **Do not disclose the issue publicly** via GitHub Issues or Discussions.
2. Please report the findings via GitHub Private Vulnerability Reporting on this repository, or email the maintainer directly.
3. Include the following details in your report:
   - Description of the vulnerability and expected impact.
   - Minimal reproducible proof-of-concept (PoC).
   - Affected browser environments and operating systems.

We commit to acknowledging received reports within 48 hours and providing a coordinated patch release timeline.
