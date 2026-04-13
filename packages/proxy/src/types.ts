export type Provider = "openai" | "lmstudio";

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
  openaiModel: string;
  codexCommand: string;
  lmstudioBaseUrl: string;
  lmstudioModel: string;
  requestTimeoutMs: number;
}
