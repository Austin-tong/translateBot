# 浏览器启用指南

这份指南用于在 Chrome 或其他 Chromium 内核浏览器中本地启用 Translate Bot。插件不需要上架插件市场，直接加载本机目录即可。

## 1. 准备项目

在项目根目录执行：

```bash
cd /Users/apple/translateBot
npm install
npm run build
cp packages/proxy/.env.example packages/proxy/.env
```

构建完成后，浏览器要加载的插件目录是：

```text
/Users/apple/translateBot/packages/extension/dist
```

## 2. 选择模型来源

默认优先使用 Ollama 本地模型。先确认 Ollama 服务已经启动，并且本机有 `gemma4:e2b` 模型。proxy 默认配置是：

```bash
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=gemma4:e2b
```

如果要检查 Ollama 模型列表，可以执行：

```bash
curl http://localhost:11434/api/tags
```

如果使用 OpenAI 云端模型，项目会走本机代理内置的 OpenAI Codex OAuth 网页授权，不使用 OpenAI API Key，也不再调用本地 `codex` CLI。授权完成后，proxy 会把 OAuth token 保存到本机文件，默认位置是：

```text
~/.translate-bot/openai-codex-oauth.json
```

这个文件只由本机 proxy 使用，浏览器扩展不会读取或保存 access token、refresh token。

注意：OpenAI Platform 的公开 API 文档仍然以 API key / Bearer token 为主；这里实现的是和 OpenClaw `openai-codex` provider 同类的 ChatGPT/Codex OAuth 路径，用于避免把 API key 放进扩展或网页端。

首次使用时，启动 proxy 后在插件弹窗里点击 `Open OpenAI login`。浏览器会打开 OpenAI 授权页，授权完成后页面会回跳到 `http://localhost:1455/auth/callback`，proxy 自动保存本机 token。

当前 OpenAI Codex OAuth 路径的默认模型是 `gpt-5.4-mini`。`Model` 输入框留空，或在 `/Users/apple/translateBot/packages/proxy/.env` 里写 `default`，都会使用这个默认模型：

```bash
OPENAI_MODEL=default
```

如果要手动切换模型，可以在插件弹窗的 `Model` 输入框里填模型名。当前内置提示列表包括：

```text
gpt-5.4-mini
gpt-5.4
gpt-5.3-codex
gpt-5.3-codex-spark
gpt-5.2-codex
gpt-5.2
```

如果某个模型在你的账号里不可用，proxy 日志会显示 OpenAI 返回的错误；把 `Model` 改回 `default` 或 `gpt-5.4-mini` 后重试。

如果使用 LM Studio，本机先启动 LM Studio server，并在 `/Users/apple/translateBot/packages/proxy/.env` 设置：

```bash
LMSTUDIO_BASE_URL=http://localhost:1234/v1
LMSTUDIO_MODEL=你的本地模型名
```

## 3. 启动本机代理

每次使用插件前，先启动代理：

```bash
cd /Users/apple/translateBot
npm run dev:proxy
```

启动成功后会看到类似：

```text
translate-bot proxy listening on http://127.0.0.1:8787
```

可以另开一个终端检查：

```bash
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/auth/openai/status
```

如果已经完成网页登录，第二条会返回 `loggedIn: true` 和 token 过期时间；如果没有登录，回到插件弹窗点击 `Open OpenAI login`。

## 4. 在浏览器加载插件

以 Chrome 为例：

1. 打开 `chrome://extensions`
2. 打开右上角 `Developer mode`
3. 点击 `Load unpacked`
4. 选择目录 `/Users/apple/translateBot/packages/extension/dist`
5. 浏览器工具栏会出现 `Translate Bot`

Edge、Arc、Brave 等 Chromium 内核浏览器的流程类似，入口通常也是扩展管理页和 `Load unpacked`。

## 5. 翻译网页

1. 打开一个普通网页，地址需要是 `http://` 或 `https://`
2. 点击浏览器工具栏里的 `Translate Bot`
3. 在 `Provider` 中选择：
   - `Ollama`：使用本机 Ollama 模型，默认 `gemma4:e2b`
   - `OpenAI Codex OAuth`：使用本机 proxy 的 OpenAI Codex OAuth 登录态调用云端模型
   - `LM Studio`：使用本机 LM Studio 模型
4. `Proxy URL` 保持默认 `http://127.0.0.1:8787`
5. `Model` 可以留空，使用代理默认模型；也可以填写模型名
6. 点击 `Check proxy` 确认代理可用
7. 点击 `Translate page` 开启翻译

`Model` 输入框修改后会自动保存；如果当前页面已经开启翻译，新模型会立即用于后续新增内容和重试请求，已显示的译文不会被强制重翻。如果 Provider 是 `Ollama`，填 `default` 或留空会使用 `.env` 里的 `OLLAMA_MODEL`，默认是 `gemma4:e2b`；如果 Provider 是 `OpenAI Codex OAuth`，填 `default` 或留空会使用 `gpt-5.4-mini`。

也可以使用快捷键：

```text
macOS: Option+A
Windows/Linux: Alt+A
```

再次点击 `Translate page` 或再次按快捷键，会关闭翻译并恢复原页面文本。

## 6. 常见问题

`chrome://`、浏览器设置页、插件市场页面不能翻译，这是浏览器限制。请在普通 `http` 或 `https` 网页使用。

如果点击翻译没有反应，先确认 `npm run dev:proxy` 还在运行，并点击插件弹窗里的 `Check proxy`。

如果 OpenAI Codex OAuth 提示未登录，在插件弹窗里点击 `Open OpenAI login`，完成浏览器授权后再试。

如果 Ollama 翻译失败，确认 Ollama 服务正在运行、`gemma4:e2b` 已经拉取或可用，并且 `.env` 里的 `OLLAMA_BASE_URL` 是 `http://localhost:11434`。

如果 LM Studio 翻译失败，确认 LM Studio server 已启动、模型已加载，并且 `.env` 里的 `LMSTUDIO_MODEL` 和本机模型名一致。

## 7. 翻译速度和动态页面策略

当前插件按“可见文本容器”翻译，而不是按单个 TextNode 翻译。这样一条推文、一个段落或一个列表项通常会作为一个片段提交给模型，减少请求数量，并避免把段落拆碎后破坏排版。

优化策略：

```text
首屏优先：只对接近视口的文本容器立即入队
大批量提交：OpenAI Codex OAuth 路径每批最多提交 40 个文本容器
长驻 proxy：云端路径直接复用 proxy 进程内的 OAuth token，不再为每批翻译启动 codex exec
限流保护：OpenAI 路径默认单并发大批量提交，避免并发小请求触发限流
Ollama 稳定性：Ollama 小模型使用 8 段小批次、单并发，避免大 JSON 批次超时或输出损坏
LM Studio 并发：LM Studio 路径允许更多并发，适合吞吐更高的本机模型服务
缓存复用：相同文本 hash 直接复用译文
持久召回：短文本译文会写入 chrome.storage.local，下次同样原文出现时直接回填，不再请求模型
动态刷新：MutationObserver 监听新增节点和字符变化，新文字出现后重新入队翻译
动态防漏：短时间内连续新增的多个正文块会合并扫描，不会只处理最后一个变化
旧请求保护：页面文字变化后，旧请求返回的译文不会覆盖新文本
```

如果仍觉得 OpenAI 路径慢，优先使用默认的 `Ollama` provider，或把 OpenAI 模型改成 `default` / `gpt-5.4-mini`，并观察代理日志里的 `segments` 和 `durationMs`。Ollama / LM Studio 本地模型适合对速度要求更高、能接受本地模型质量差异的场景。

翻译请求日志有两个位置：

```text
代理终端：显示 provider、model、segments、页面 URL、耗时
网页 DevTools Console：显示每批请求和响应的 provider、model、segments、耗时
```

代理日志示例：

```text
[translate-bot] translate request provider=openai model=default segments=12 url=https://example.com
[translate-bot] translate response provider=openai model=gpt-5.4-mini segments=12 durationMs=3200
```

新版日志还会带上 `ids` 和短 `sample`，用于确认某一段正文有没有真正发给模型。

修改代码后需要重新执行：

```bash
npm run build
```

然后在 `chrome://extensions` 里点击 Translate Bot 卡片上的刷新按钮，或重新加载 unpacked extension。

## 8. 更新后重新部署

代码或配置更新后按这个顺序操作：

```bash
cd /Users/apple/translateBot
npm run build
```

如果 `npm run dev:proxy` 正在某个终端里运行，先在那个终端按 `Ctrl+C` 停掉，再重新启动：

```bash
npm run dev:proxy
```

如果找不到之前的终端，可以先查看占用端口的进程：

```bash
lsof -nP -iTCP:8787 -sTCP:LISTEN
```

确认是旧的 Translate Bot 代理后，再结束对应 PID：

```bash
kill <PID>
npm run dev:proxy
```

然后打开 `chrome://extensions`，点击 Translate Bot 卡片上的刷新按钮，再刷新你要翻译的网页。

如果你之前已经复制过 `/Users/apple/translateBot/packages/proxy/.env`，并且里面还有旧模型：

```bash
OPENAI_MODEL=gpt-5.4-mini
```

把它改成：

```bash
OPENAI_MODEL=default
```
