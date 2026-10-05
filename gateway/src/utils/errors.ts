/** 统一错误码：返回给 agent 的 text 以 [CODE] 前缀开头，便于程序化判断重试/放弃。 */

export const ErrorCodes = {
  // search
  SEARCH_TIMEOUT: "SEARCH_TIMEOUT",
  SEARCH_UPSTREAM: "SEARCH_UPSTREAM",
  SEARCH_INVALID: "SEARCH_INVALID",
  // fetch
  FETCH_TIMEOUT: "FETCH_TIMEOUT",
  FETCH_BLOCKED: "FETCH_BLOCKED",
  FETCH_NOT_HTML: "FETCH_NOT_HTML",
  FETCH_RENDER_FAIL: "FETCH_RENDER_FAIL",
  FETCH_NETWORK: "FETCH_NETWORK",
  FETCH_INVALID_URL: "FETCH_INVALID_URL",
  // browser
  BROWSER_UNAVAILABLE: "BROWSER_UNAVAILABLE",
  BROWSER_ERROR: "BROWSER_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/** 给错误文本加 [CODE] 前缀（仅当没有前缀时） */
export function withCode(code: ErrorCode, text: string): string {
  if (text.startsWith("[")) return text;
  return `[${code}] ${text}`;
}
