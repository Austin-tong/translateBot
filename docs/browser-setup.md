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

如果使用 OpenAI 云端模型，项目会走 Codex 的网页登录授权，不使用 OpenAI API Key。

可以先在终端登录：

```bash
codex login
codex login status
```

看到 `Logged in using ChatGPT` 就表示 Codex 登录态可用。

也可以先不登录，等插件加载后在插件弹窗里点击 `Open Codex login`，由本机代理启动 Codex 登录流程。

Codex 登录态和 OpenAI API Key 的模型可用性不是一回事。当前 Codex CLI/IDE 的 ChatGPT 登录模式主要使用 GPT-5.1-Codex 模型族：

```text
gpt-5.1-codex-mini  更快，适合页面翻译优先使用
gpt-5.1-codex       平衡选项，是否可用取决于当前 Codex CLI/账号配置
gpt-5.1-codex-max   默认高能力选项，但页面翻译会更慢
```

本项目默认使用 Codex CLI 自己的默认模型。`Model` 输入框留空，或在 `/Users/apple/translateBot/packages/proxy/.env` 里写 `default`，都会让代理不传 `-m` 参数，直接使用 Codex 默认模型：

```bash
OPENAI_MODEL=default
```

如果要手动切换模型，可以在插件弹窗的 `Model` 输入框里填模型名，例如 `gpt-5.1-codex-mini`。

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

如果已经用 Codex 登录，第二条会返回 `Logged in using ChatGPT`。

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
   - `OpenAI via Codex`：使用 Codex 登录态调用云端模型
   - `LM Studio`：使用本机 LM Studio 模型
4. `Proxy URL` 保持默认 `http://127.0.0.1:8787`
5. `Model` 可以留空，使用代理默认模型；也可以填写模型名
6. 点击 `Check proxy` 确认代理可用
7. 点击 `Translate page` 开启翻译

`Model` 输入框修改后会自动保存；如果填 `default` 或留空，代理会使用 Codex CLI 默认模型。

也可以使用快捷键：

```text
macOS: Option+A
Windows/Linux: Alt+A
```

再次点击 `Translate page` 或再次按快捷键，会关闭翻译并恢复原页面文本。

## 6. 常见问题

`chrome://`、浏览器设置页、插件市场页面不能翻译，这是浏览器限制。请在普通 `http` 或 `https` 网页使用。

如果点击翻译没有反应，先确认 `npm run dev:proxy` 还在运行，并点击插件弹窗里的 `Check proxy`。

如果 OpenAI via Codex 提示未登录，执行 `codex login`，或在插件弹窗里点击 `Open Codex login`，完成浏览器授权后再试。

如果 LM Studio 翻译失败，确认 LM Studio server 已启动、模型已加载，并且 `.env` 里的 `LMSTUDIO_MODEL` 和本机模型名一致。

## 7. 翻译速度和动态页面策略

当前插件按“可见文本容器”翻译，而不是按单个 TextNode 翻译。这样一条推文、一个段落或一个列表项通常会作为一个片段提交给模型，减少 Codex CLI 启动次数，并避免把段落拆碎后破坏排版。

优化策略：

```text
首屏优先：只对接近视口的文本容器立即入队
大批量提交：Codex 路径每批最多提交 40 个文本容器
减少并发：Codex CLI 路径一次只跑 1 个进程，避免多个 codex exec 抢资源
本地并发：LM Studio 路径允许更多并发，适合本机模型服务
缓存复用：相同文本 hash 直接复用译文
动态刷新：MutationObserver 监听新增节点和字符变化，新文字出现后重新入队翻译
旧请求保护：页面文字变化后，旧请求返回的译文不会覆盖新文本
```

如果仍觉得 Codex 路径慢，这是 Codex CLI 每次 `codex exec` 都要启动一次非交互进程带来的固定开销。继续提速的优先方案是切到 LM Studio 本地模型，或后续把云端路径改成一个可复用会话的长驻服务。

翻译请求日志有两个位置：

```text
代理终端：显示 provider、model、segments、页面 URL、耗时
网页 DevTools Console：显示每批请求和响应的 provider、model、segments、耗时
```

代理日志示例：

```text
[translate-bot] translate request provider=openai model=default segments=12 url=https://example.com
[translate-bot] translate response provider=openai model=default segments=12 durationMs=8432
```

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
