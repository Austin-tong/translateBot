# Translate Bot

Translate Bot 是一个本地优先的 Chromium 网页翻译插件。默认优先使用本地模型，通过 Ollama 或 LM Studio 就地翻译网页；OpenAI 仍然保留，但属于可选的高级路径。

## 为什么用 Translate Bot

### 1. 本地优先，成本和数据路径都更可控

默认工作流围绕 Ollama 和 LM Studio 设计，网页文本先进入你本机上的 proxy，再转发到本地模型。这样做的直接好处是：

- 日常使用不依赖云端 API key
- 能把翻译成本压到接近本地算力成本
- 数据路径更清晰，适合对隐私和可控性有要求的场景

### 2. 安装路径简单，适合真实用户上手

项目不是“clone 之后自己拼命找文档”的原型状态，而是面向正式使用整理过的本地优先流程。核心路径就是：

```bash
./scripts/bootstrap-local.sh
```

这条命令会自动安装依赖、探测本地运行时、写配置、构建扩展并直接启动 proxy，尽量把首次启动的摩擦压到最低。

### 3. Provider 路径清晰，不会把云端依赖绑死

你可以把 Ollama 作为默认主路径，也可以切到 LM Studio；如果确实需要更强模型，再使用 OpenAI。也就是说，这个项目不是“只能连云端”的封闭方案，而是：

- 本地模型优先
- 云端模型可选
- 切换路径明确

这让它更适合长期演进，而不是被单一 provider 绑定。

### 4. 不是只会翻短句的 demo，而是在处理真实网页

项目里已经围绕真实网页做了不少工程化处理，而不只是把一段文本丢给模型：

- 按网页块做翻译，不直接破坏原始页面结构
- 为每段携带邻近上下文，降低机械直译概率
- 对本地模型失败批次做自动拆分重试，提高长文本场景的成功率
- popup 会显示当前 setup 状态、翻译状态和可操作的下一步

这类能力的价值在于，项目更接近“能持续使用的浏览器工具”，而不是一次性演示。

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
