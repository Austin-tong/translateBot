# Translate Bot

Local Chrome/Chromium page translation extension with a Node proxy for Ollama, OpenAI, and LM Studio models.

## Install

```bash
npm install
npm run build
cp packages/proxy/.env.example packages/proxy/.env
```

For OpenAI cloud translation, this project uses OpenAI Codex OAuth in the local proxy instead of an API key or the local `codex` CLI.

After starting the proxy, choose `OpenAI Codex OAuth` in the extension popup and click `Open OpenAI login`. The proxy opens the browser authorization flow and stores its local OAuth token at `~/.translate-bot/openai-codex-oauth.json`; the extension never stores OpenAI credentials.

By default the proxy maps `OPENAI_MODEL=default` to `gpt-5.4-mini`. Enter a model name in the popup only when you want to override it.

For LM Studio, start the local server and load a model, then set `LMSTUDIO_MODEL` to that model id.

For Ollama, start the local Ollama service and make sure the model is available. The default local provider is `Ollama`, with `OLLAMA_MODEL=gemma4:e2b`.

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
