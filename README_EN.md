# Multi AI Web Automation

A Chrome / Edge browser extension (Manifest V3) that lets you **send one prompt to multiple AI web apps at once** from a single side panel, and read and compare every answer side by side in the same place.

Supports 7 AI platforms: **ChatGPT, Gemini, DeepSeek, Qwen, Z.AI, Doubao, Kimi**.

---

## Features

- **One-click broadcast** – Type a question in the side panel, pick the target platforms, and send it concurrently to all open / auto-opened AI web pages.
- **Embedded web view** – Each AI web page is rendered inside the extension via an `iframe` (a DNR rule strips `X-Frame-Options` / `Content-Security-Policy` so the pages can be nested), so you never have to jump between tabs.
- **Streaming capture** – Answers are captured in real time as they stream in, and shown per platform.
- **Multi-turn conversations** – Conversations are organized by session / turn so you can revisit prior context.
- **History** – Every session is saved automatically, with **keyword search**, **tag filtering / editing**, and **one-click Markdown export**.
- **Original-link restore** – Exports include the original web-page link for each AI; switching history / session / turn automatically navigates the embedded view back to the saved URL.
- **Manual grab** – Each AI tab offers "fullscreen / read / manual grab"; a top-right "📥 grab all manually" button is the fallback when streaming capture fails.
- **Themes** – Light / dark / system-following UI.
- **Large reader** – Open any single answer in a fullscreen reader to read and copy.
- **Kimi support** – Because Kimi only accepts trusted (`isTrusted`) events, sending is completed with a `chrome.debugger` trusted click.

---

## Supported platforms

| Platform | Domain |
| --- | --- |
| ChatGPT | `chatgpt.com` |
| Gemini | `gemini.google.com` |
| DeepSeek | `chat.deepseek.com` |
| Qwen | `chat.qwen.ai` |
| Z.AI | `chat.z.ai` |
| Doubao | `www.doubao.com` |
| Kimi | `kimi.moonshot.cn` |

> Log in to each web app before use. If a site is not logged in, the extension reports `login_required`.

---

## Architecture

Layered architecture:

```
Side Panel UI (React + Zustand)
   ↓ messages
Background Service Worker (task dispatcher)
   ↓ messages
Content Script (injected into each AI page, all_frames)
   ↓ calls
Site Adapter (per-site automation: locate input / fill / click send / watch answer)
```

The embedded web view (iframe) is bridged between the extension parent page and the in-iframe content script through a cross-origin `postMessage` protocol (`EMBED_MSG`): the parent requests execution / grab → the iframe reads the screen locally → results are sent back.

---

## Install & build

> Node.js 18+ recommended. pnpm is preferred.

```bash
# Install dependencies
pnpm install

# Build (type-check + bundle into dist/)
pnpm build

# Dev mode (with HMR)
pnpm dev
```

Build output goes to the `dist/` directory.

---

## Load the extension

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable "Developer mode" in the top-right.
3. Click "Load unpacked" and select the project's `dist/` folder.
4. Click the extension icon in the toolbar to open the side panel; you can also right-click the icon and choose "Open side panel".

> After changing code, run `pnpm build` again and click the "Reload" button on the extensions page.
> Because Kimi sending relies on `chrome.debugger`, the first send on Kimi may show a "Started debugging" banner at the top of the browser — this is expected.

---

## Usage

1. Type a question in the side panel and select the platforms to send to.
2. Click "Send" – the extension opens / reuses the pages and fills & submits automatically.
3. Watch each answer stream in the web view or per-platform tabs; switch to "fullscreen / read" mode as needed.
4. If streaming capture fails, use "manual grab" or the top-right "grab all manually" button.
5. Search, tag, and export sessions to Markdown (with original per-platform links) from the history bar.

---

## Permissions

| Permission | Purpose |
| --- | --- |
| `tabs` / `webNavigation` | Find, create, reuse and wait for AI web-page tabs |
| `storage` | Persist latest task, history, and settings |
| `scripting` | Inject / execute scripts in target pages |
| `sidePanel` | Provide the side-panel UI |
| `alarms` | Fallback timers (e.g. grab timeouts) |
| `downloads` | Download exported Markdown files |
| `debugger` | Trusted click needed to send on Kimi (used only there) |
| `declarativeNetRequestWithHostAccess` | Strip `X-Frame-Options` / CSP so AI pages can be iframed |

---

## Project structure

```
multi-ai-extension/
├─ public/                  # Static assets (icons, sidepanel.html)
├─ src/
│  ├─ background/           # Service Worker: dispatch, tab mgmt, message router, history store, debugger trusted click, DNR
│  ├─ content/
│  │  ├─ adapters/          # Per-site adapters (chatgpt/gemini/deepseek/qwen/zai/doubao/kimi)
│  │  ├─ dom/              # DOM observation helpers
│  │  └─ index.ts          # content script entry
│  ├─ sidepanel/           # Side-panel UI (React + Zustand) + embedded WebView
│  └─ shared/              # Types, constants, message protocol, export, utils
├─ manifest.ts              # MV3 manifest
├─ vite.config.ts
└─ package.json
```

---

## Known limitations

- Relies on each AI page's DOM structure; site redesigns may break selectors and require adapter updates.
- Kimi sending uses `chrome.debugger`, which may trigger a browser debugging banner.
- This extension automates web pages only; it does not use any official API. Please respect each platform's terms of service.

---

## License

MIT
