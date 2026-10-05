import { AsyncLocalStorage } from "node:async_hooks";

/**
 * 当前 MCP sessionId（由 server.ts 在 handleRequest 前注入）。
 * browser_* 工具用它把浏览器上下文按会话隔离，避免多客户端共用页面。
 */
export const mcpSessionContext = new AsyncLocalStorage<string | undefined>();
