# 浏览器启用指南

这份指南面向 clone-after bootstrap 流程。先把仓库克隆到本地，再从项目根目录启动 bootstrap。

## 1. 一键 bootstrap

```bash
cd <repo-root>
./scripts/bootstrap-local.sh
```

这一步会安装依赖、检测本地运行时、写入 `packages/proxy/.env`，构建可加载的 unpacked extension，并在最后直接启动本地 proxy。

如果你想先检查本机环境，再继续 bootstrap，可以运行：

```bash
npm run doctor:local
```

## 2. 保持本机代理运行

bootstrap 完成后，脚本不会立即退出，而是会直接以前台方式运行本机 proxy。

- 看到 `translate-bot proxy listening on ...` 说明 proxy 已经启动
- 需要停止时，直接按 `Ctrl+C`
- 如果你后面手动重启，也可以单独运行：

```bash
npm run dev:proxy
```

代理运行后，扩展会通过本机 proxy 访问所选 provider。

## 3. 加载扩展

浏览器需要加载的 unpacked extension 目录是：

```text
packages/extension/dist
```

以 Chrome 为例：

1. 打开 `chrome://extensions`
2. 打开 `Developer mode`
3. 点击 `Load unpacked`
4. 选择 `packages/extension/dist`

Edge、Arc、Brave 等 Chromium 内核浏览器的流程类似。

## 4. Popup 里的 Setup assistant

首次打开插件弹窗时，你会看到 `Setup assistant` card。它会给出一个基于当前状态的检查摘要，通常包括：

- 当前 setup 是否完成
- setup status 评估到的本地 provider/model 是否可用
- 需要时下一步该做什么，例如启动 proxy 或切换到推荐的本地模型

如果这里显示有缺失，先检查当前终端里的 proxy 是否仍在运行；这通常是最常见的缺失条件之一。若 proxy 已停止，可以重新执行 `npm run dev:proxy`。若本机环境还没准备好，再运行 `npm run doctor:local`；只有在 bootstrap 尚未完成时，才重新执行 `./scripts/bootstrap-local.sh`。

## 5. 本地 provider

### Ollama

默认推荐的本地路径。确保 Ollama 服务已启动，并且目标模型可用。

### LM Studio

支持的本地路径。启动 LM Studio server，加载模型后即可使用。

### OpenAI

可选的高级路径。用于需要云端模型时，但仍然通过本机 proxy 访问，不直接在扩展里配置 API key。

## 6. 翻译使用

在普通 `http://` 或 `https://` 页面中打开扩展，使用 popup 中的翻译控制即可。`chrome://`、浏览器设置页和插件市场页面仍然不能翻译，这是浏览器限制。
