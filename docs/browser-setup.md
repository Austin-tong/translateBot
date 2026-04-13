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

也可以使用快捷键：

```text
macOS: Command+Shift+Y
Windows/Linux: Ctrl+Shift+Y
```

再次点击 `Translate page` 或再次按快捷键，会关闭翻译并恢复原页面文本。

## 6. 常见问题

`chrome://`、浏览器设置页、插件市场页面不能翻译，这是浏览器限制。请在普通 `http` 或 `https` 网页使用。

如果点击翻译没有反应，先确认 `npm run dev:proxy` 还在运行，并点击插件弹窗里的 `Check proxy`。

如果 OpenAI via Codex 提示未登录，执行 `codex login`，或在插件弹窗里点击 `Open Codex login`，完成浏览器授权后再试。

如果 LM Studio 翻译失败，确认 LM Studio server 已启动、模型已加载，并且 `.env` 里的 `LMSTUDIO_MODEL` 和本机模型名一致。

修改代码后需要重新执行：

```bash
npm run build
```

然后在 `chrome://extensions` 里点击 Translate Bot 卡片上的刷新按钮，或重新加载 unpacked extension。
