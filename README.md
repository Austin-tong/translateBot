# Translate Bot

Translate Bot 是一个本地优先的 Chromium 网页翻译插件。默认优先使用本地模型，通过 Ollama 或 LM Studio 就地翻译网页；OpenAI 仍然保留，但属于可选的高级路径。

## 快速开始

先 clone 仓库，再在项目根目录执行：

```bash
cd /path/to/translateBot
./scripts/bootstrap-local.sh
```

这条命令会依次完成：

1. 安装依赖
2. 探测本地运行时
3. 写入 `packages/proxy/.env`
4. 构建 unpacked extension
5. 直接启动本地 proxy

脚本最后会以前台方式运行 proxy。需要停止时，直接按 `Ctrl+C`。

## 加载扩展

bootstrap 完成并启动 proxy 后，在 Chrome 或其他 Chromium 浏览器中：

1. 打开 `chrome://extensions`
2. 开启 `Developer mode`
3. 点击 `Load unpacked`
4. 选择 `packages/extension/dist`
5. 打开普通的 `http://` 或 `https://` 页面
6. 使用扩展 popup 或快捷键 `Alt+A` / `Option+A`

更完整的浏览器启用说明见 [docs/browser-setup.md](docs/browser-setup.md)。

## 本地 Provider

### Ollama

默认推荐路径。启动 Ollama，并确保你要用的模型已经可用。

### LM Studio

支持的本地路径。启动 LM Studio server，加载模型后即可使用。

### OpenAI

可选的高级路径。适合你明确需要云端模型时使用，但扩展依旧只和本地 proxy 通信，不直接访问 OpenAI。

## 初始化与检查

如果你只想做环境探测，不立即写配置，可以运行：

```bash
npm run doctor:local
```

如果你需要手动重写本地配置，可以运行：

```bash
npm run setup:local -- --overwrite
```

## 常用命令

```bash
npm run build
npm test
```
