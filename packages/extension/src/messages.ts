import type { ExtensionSettings } from "./settings.js";

export type BackgroundMessage =
  | { type: "TOGGLE_TRANSLATION"; settings?: ExtensionSettings }
  | { type: "GET_TAB_STATUS" };

export type ContentMessage =
  | { type: "TRANSLATE_TOGGLE"; settings: ExtensionSettings }
  | { type: "TRANSLATE_STATUS" };

export interface StatusResponse {
  enabled: boolean;
  pending: number;
  translated: number;
  error?: string;
}
