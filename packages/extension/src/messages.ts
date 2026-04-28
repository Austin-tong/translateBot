import type { ExtensionSettings } from "./settings.js";

/** popup、background、content script 之间共享的消息协议。 */
export type BackgroundMessage =
  | { type: "TOGGLE_TRANSLATION"; settings?: ExtensionSettings }
  | { type: "UPDATE_TRANSLATION_SETTINGS"; settings: ExtensionSettings }
  | { type: "GET_TAB_STATUS" };

/** background 转发给内容脚本的消息，只包含翻译控制相关动作。 */
export type ContentMessage =
  | { type: "TRANSLATE_TOGGLE"; settings: ExtensionSettings }
  | { type: "TRANSLATE_UPDATE_SETTINGS"; settings: ExtensionSettings }
  | { type: "TRANSLATE_STATUS" };

/** 当前标签页翻译运行时的摘要状态，用于 popup 展示。 */
export interface StatusResponse {
  enabled: boolean;
  pending: number;
  translated: number;
  provider?: string;
  model?: string;
  error?: string;
}

/** background 或 popup 触发翻译开关时的统一返回结构。 */
export interface ToggleResponse {
  ok: boolean;
  error?: string;
  status?: StatusResponse;
}
