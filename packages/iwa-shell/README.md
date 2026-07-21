# IWA shell

An Isolated Web App that is **an Arc-shaped browser whose tabs we own**.
Chrome gives us one app window; the sidebar, spaces, command bar and tab
lifecycle are all ours, because every tab is a `<controlledframe>` we create
and control.

Arc-isms: tabs live in a vertical sidebar rather than a strip, pinned tabs
sit above ephemeral ones, each space has its own gradient **and its own
partition** (so spaces are real containers — separate cookies, storage and
logins), and there's no persistent address bar — ⌘L/⌘T open a floating
command bar.

| key | |
| --- | --- |
| ⌘T | new tab (command bar) |
| ⌘L | edit this tab's address |
| ⌘S | toggle sidebar |
| ⌘W | close tab |

flow-md itself is just a tab — an ordinary page served by the local process —
so **nothing about the app has to change**. MDX with live components,
`@mdx-js/mdx`'s runtime `evaluate()`, and everything else a normal web page
can do keep working, because the IWA's strict CSP applies to *this document
only*, never to guests.

A React SPA (Vite + CSS Modules), matching the main app's conventions.

## Running it

Two terminals:

```bash
mise run iwa:shell   # the shell's dev server on :5193
mise run iwa         # build the launcher and open the app in Chrome
```

Extra browser flags pass straight through, e.g.
`mise run iwa -- -- --remote-debugging-port=9222` (the first `--` ends
mise's args, the second the launcher's).

The launcher starts a fresh Chrome against a dedicated profile with IWA dev
mode enabled, installs the shell on first run, and opens it as an app window.
See `packages/iwa-launcher`.

The default tabs are `http://localhost:4748` (flow-md) and `example.com`, so
have `flow-md serve` and the app running for the first to load.

Opened in a normal browser tab the shell still runs, but falls back to
`<iframe>` and shows a banner saying so.

## Architecture

React owns the chrome; guests live in `src/lib/frames.ts`, deliberately
**outside** React's reconciliation. Two reasons:

- `partition` must be set *before* `src`, or it silently doesn't apply.
- A guest must never be unmounted and remounted by a re-render — that throws
  away the loaded page.

Inactive tabs stay loaded and are hidden with `visibility`, not `display`, so
switching is instant and page state survives.

## What it verifies

All on **stable Chrome 150 / macOS** — not ChromeOS, no enterprise policy:

| Question | Result |
| --- | --- |
| Is Controlled Frame available off ChromeOS? | **Yes** — `HTMLControlledFrameElement`, 25 members |
| Do arbitrary third-party sites load? | **Yes** — including ones that refuse framing |
| Does flow-md run as a guest, MDX and all? | **Yes** — components render; no app changes |
| Can we script guests (the archive story)? | **Yes** — `executeScript` returns `{title,url,bytes}` |
| Does `partition="persist:…"` persist? | **Yes** — probe counter survived relaunches |
| Is runtime codegen blocked *in the shell*? | **Yes** — `new Function`/`AsyncFunction` throw `EvalError` |

The API Chrome exposes on a Controlled Frame:

```
addContentScripts, back, canGoBack, canGoForward, captureVisibleRegion,
clearData, executeScript, forward, getAudioState, getUserAgent, getZoom, go,
insertCSS, isAudioMuted, isUserAgentOverridden, print, reload,
removeContentScripts, setAudioMuted, setClientHintsUABrandEnabled,
setUserAgentOverride, setZoom, setZoomMode, stop
```

`captureVisibleRegion` + `executeScript` + `insertCSS` is most of a
web-archiver already.

## Sharp edges worth remembering

**No `@vitejs/plugin-react`.** It injects an *inline* Fast Refresh preamble,
and an IWA's `script-src 'self'` blocks inline script — the app then dies on a
missing `$RefreshReg$`. Vite's esbuild compiles `.tsx` from tsconfig's
`jsx: react-jsx` anyway, so we only give up Fast Refresh (HMR still reloads).

**A guest cannot load the IWA's own origin.** `src` must be http/https/data,
so a relative `/probe.html` resolves against `isolated-app://` and silently
leaves the frame on `about:blank`. Use absolute `http://` URLs.

**StrictMode double-invokes effects**, and creating guests is an imperative
side effect — the boot effect is ref-guarded or you get two of every tab.

**CSP testing is easy to get wrong.** DevTools and CDP `Runtime.evaluate` are
exempt from CSP and report a false "allowed" for eval. `cspSelfTest()` in
`src/lib/env.ts` runs from real page script for that reason.
