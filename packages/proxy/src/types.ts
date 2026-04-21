export type Provider = "openai" | "lmstudio" | "ollama";
export type LocalProvider = "ollama" | "lmstudio";

export interface LocalProviderStatus {
  provider: LocalProvider;
  baseUrl: string;
  configuredModel: string;
  reachable: boolean;
  availableModels: string[];
  ready: boolean;
  detail: string;
}

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

export interface PageContext {
  url: string;
  title: string;
  lang?: string;
}

export interface TranslationSegment {
  id: string;
  text: string;
  contextBefore?: string;
  contextAfter?: string;
}

export interface TranslateRequest {
  provider: Provider;
  model?: string;
  targetLanguage: "zh-CN";
  page: PageContext;
  segments: TranslationSegment[];
}

export interface TranslateResponse {
  provider: Provider;
  model: string;
  segments: Array<{
    id: string;
    translation: string;
  }>;
  usage?: unknown;
}

export interface ModelAdapter {
  listModels(): Promise<string[]>;
  translate(request: TranslateRequest): Promise<TranslateResponse>;
}

export interface AuthAwareModelAdapter extends ModelAdapter {
  authStatus(): Promise<{ loggedIn: boolean; detail: string }>;
  startAuth(): Promise<{ started: boolean; detail: string }>;
}

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
