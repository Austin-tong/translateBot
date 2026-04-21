# Translate Bot

Translate Bot is a local-first Chromium page translation plugin. It is designed to translate pages in place with local models first, using Ollama or LM Studio, while keeping OpenAI available as an optional advanced path.

## Quick Start

```bash
cd /path/to/translateBot
./scripts/bootstrap-local.sh
npm run dev:proxy
```

Clone the repo first, then run the bootstrap script from the project root. The bootstrap flow installs dependencies, detects local runtimes, writes `packages/proxy/.env`, and builds the unpacked extension.

After bootstrap, load the unpacked extension from:

```text
packages/extension/dist
```

In Chrome or another Chromium browser:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select `packages/extension/dist`.
5. Open a normal `http` or `https` page.
6. Use the extension popup button or `Alt+A` / `Option+A`.

Detailed browser setup is in [docs/browser-setup.md](docs/browser-setup.md).

## Local Providers

### Ollama

Recommended for the default local-first path. Start Ollama locally, make sure the model you want is available, and keep the provider on `Ollama`.

### LM Studio

Supported for local model translation. Start the LM Studio server, load a model, and point the proxy at that model id.

### OpenAI

Optional and advanced. Use this only when you want cloud translation through the local proxy. The extension still talks to the local proxy, not directly to OpenAI.

## What Bootstrap Does

`./scripts/bootstrap-local.sh` is the clone-after bootstrap entrypoint. It:

- installs project dependencies
- detects local runtimes such as Ollama and LM Studio
- writes `packages/proxy/.env`
- builds the unpacked extension output

## Checks

```bash
npm run build
npm test
```
