# IWA shell prototype

A throwaway Isolated Web App whose only job is to answer, with evidence,
whether **Controlled Frame** is a viable primitive for a canvas-browser built
on flow-md — before we commit to it.

## Running it

Two terminals:

```bash
pnpm --filter @flow-md/iwa-shell dev          # dev server on :5193
cargo run --manifest-path packages/iwa-launcher/Cargo.toml
```

The launcher starts a *fresh* Chrome process against a dedicated profile
(`~/.flow-md/iwa-profile`) with IWA dev mode enabled and installs the shell
from the dev server. A fresh process matters: IWA flags are only read at
browser startup, so reusing a running Chrome silently drops them.

Installing does not launch it. Open `chrome://web-app-internals` in that
profile to find the app under **Installed Dev Mode IWAs**, or launch it from
`chrome://apps`.

Opened in a normal tab the shell still runs, but falls back to `<iframe>` and
shows a banner saying so.

## What it verifies

All confirmed on **stable Chrome 150 / macOS** — notably *not* ChromeOS, and
without an enterprise policy:

| Question | Result |
| --- | --- |
| Is Controlled Frame available off ChromeOS? | **Yes** — `HTMLControlledFrameElement`, 25 members |
| Do live pages survive a CSS-transformed canvas? | **Yes** — pan/zoom over real sites |
| Can we script guests (the archive story)? | **Yes** — `executeScript` returned `{title,url,bytes}` from `example.com` |
| Does `partition="persist:…"` persist? | **Yes** — probe counter went `#1` → `#2` across loads |
| Is runtime codegen blocked? | **Yes** — `new Function` and `AsyncFunction` both throw `EvalError` |

The API surface Chrome actually exposes:

```
addContentScripts, back, canGoBack, canGoForward, captureVisibleRegion,
clearData, executeScript, forward, getAudioState, getUserAgent, getZoom, go,
insertCSS, isAudioMuted, isUserAgentOverridden, print, reload,
removeContentScripts, setAudioMuted, setClientHintsUABrandEnabled,
setUserAgentOverride, setZoom, setZoomMode, stop
```

`captureVisibleRegion` + `executeScript` + `insertCSS` is most of a web-archiver.

## Two constraints worth remembering

**A guest cannot load the IWA's own origin.** `src` must be http/https/data,
so a relative `/probe.html` resolves against `isolated-app://` and silently
leaves the frame on `about:blank`. The probe therefore points at an absolute
`http://localhost:5193/...`.

**Runtime codegen really is blocked**, by the enforced CSP:

```
script-src 'self' 'wasm-unsafe-eval'; require-trusted-types-for 'script'; …
```

`innerHTML` and inline `<script>` are blocked by Trusted Types too. This is
what breaks `@mdx-js/mdx`'s `evaluate()`, and it's why removing runtime MDX
compilation is a prerequisite for shipping flow-md as an IWA.

Beware when testing this: **DevTools/CDP evaluation is exempt from CSP**, so
probing eval through `page.evaluate()` reports a false "allowed". The
`cspSelfTest()` in `src/main.ts` runs from real page script for that reason.
