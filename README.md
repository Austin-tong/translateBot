# Translate Bot

Local Chrome/Chromium page translation extension with a Node proxy for OpenAI and LM Studio models.

## Install

```bash
npm install
npm run build
cp packages/proxy/.env.example packages/proxy/.env
```

For OpenAI cloud translation, this project uses Codex CLI login instead of an API key:

```bash
codex login
codex login status
```

That opens the browser authorization flow managed by Codex. The proxy invokes `codex exec`; it does not read or store Codex credentials or an OpenAI API key. In the extension popup, choose `OpenAI via Codex`.
You can also click `Open Codex login` in the extension popup after starting the proxy.
By default the proxy uses the Codex CLI default model. Leave the popup Model field empty or set `OPENAI_MODEL=default`; enter a model name only when you want to override it.

For LM Studio, start the local server and load a model, then set `LMSTUDIO_MODEL` to that model id.

## Run

```bash
npm run dev:proxy
```

In Chrome or another Chromium browser:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select `packages/extension/dist`.
5. Open a normal `http` or `https` page.
6. Use the extension popup button or `Alt+A` / `Option+A`.

Detailed browser setup is in [docs/browser-setup.md](docs/browser-setup.md).

The extension calls only the local proxy URL configured in the popup. It does not store an OpenAI API key.

## Checks

```bash
npm run build
npm test
```
