/** 代理层支持的翻译提供方；`openai` 走 Codex OAuth，其余两个走本机服务。 */
export type Provider = "openai" | "lmstudio" | "ollama";
/** 只用于本机可直连的模型服务，方便 setup 流程给出推荐目标。 */
export type LocalProvider = "ollama" | "lmstudio";

/** 单个本机服务在 setup 页面里的健康与模型可用性快照。 */
export interface LocalProviderStatus {
  provider: LocalProvider;
  baseUrl: string;
  configuredModel: string;
  reachable: boolean;
  availableModels: string[];
  ready: boolean;
  detail: string;
}

/** 启动代理前，扩展需要向用户展示的整体准备状态。 */
export interface SetupStatus {
  mode: "local-first";
  configPath: string;
  envFileExists: boolean;
  recommendedProvider: LocalProvider;
  providers: {
    ollama: LocalProviderStatus;
    lmstudio: LocalProviderStatus;
  };
  nextAction: "create-config" | "start-local-provider" | "select-model" | "ready";
  nextMessage: string;
}

/** 当前页面的上下文信息，供模型决定用词和保留结构。 */
export interface PageContext {
  url: string;
  title: string;
  lang?: string;
}

/** 单个待翻译片段及其邻近上下文。 */
export interface TranslationSegment {
  id: string;
  text: string;
  contextBefore?: string;
  contextAfter?: string;
}

/** 从扩展发往代理的一次翻译请求。 */
export interface TranslateRequest {
  provider: Provider;
  model?: string;
  targetLanguage: "zh-CN";
  page: PageContext;
  segments: TranslationSegment[];
}

/** 代理返回给扩展的翻译结果，按 segment id 对齐。 */
export interface TranslateResponse {
  provider: Provider;
  model: string;
  segments: Array<{
    id: string;
    translation: string;
  }>;
  usage?: unknown;
}

/** 所有模型适配器都必须实现“列出模型”和“翻译”这两个动作。 */
export interface ModelAdapter {
  listModels(): Promise<string[]>;
  translate(request: TranslateRequest): Promise<TranslateResponse>;
}

/** 只有 OpenAI Codex 适配器额外提供 OAuth 状态查询和启动入口。 */
export interface AuthAwareModelAdapter extends ModelAdapter {
  authStatus(): Promise<{ loggedIn: boolean; detail: string }>;
  startAuth(): Promise<{ started: boolean; detail: string }>;
}

/** 代理进程启动时读取的本地配置，包含端口、模型和超时。 */
export interface ProxyConfig {
  host: string;
  port: number;
  configPath: string;
  openaiModel: string;
  openaiCodexAuthPath: string;
  lmstudioBaseUrl: string;
  lmstudioModel: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  requestTimeoutMs: number;
}
