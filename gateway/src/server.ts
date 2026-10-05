import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { BrowserPool } from "./browser/pool.js";
import { BrowserTools } from "./browser/tools.js";
import type { GatewayConfig } from "./config.js";
import { ensureAdList, fetchAdList, isAdListStale, startAdListScheduler } from "./filter/adlist.js";
import { buildDomainFilter } from "./filter/domain-filter.js";
import { createFetchService } from "./fetch/service.js";
import { getHealth } from "./health.js";
import type { Logger } from "./logger.js";
import { createSearchService } from "./search/service.js";
import { mcpSessionContext } from "./utils/session-context.js";

export const GATEWAY_VERSION = "0.1.0";

// 浏览器池全局单例（跨 MCP 会话共享，避免每个 session 各开浏览器进程）
let sharedBrowserPool: BrowserPool | null = null;

function getBrowserPool(config: GatewayConfig, logger: Logger): BrowserPool {
  if (!sharedBrowserPool) {
    sharedBrowserPool = new BrowserPool(config, logger);
  }
  return sharedBrowserPool;
}

export async function createServer(config: GatewayConfig, logger: Logger): Promise<McpServer> {
  const startedAt = Date.now();
  const server = new McpServer(
    {
      name: "agent-search-gateway",
      version: GATEWAY_VERSION,
    },
    {
      capabilities: { tools: {} },
    },
  );

  // adlist 自动更新：缺失/过期时后台异步拉取（不阻塞 MCP 启动连接）
  if (config.adFilterAutoUpdate && config.adFilterEnabled && config.adFilterLevel !== "off") {
    ensureAdList(config, logger);
  }

  let domainFilter = buildDomainFilter(
    config.adFilterEnabled,
    config.adFilterLevel,
    config.adFilterExtraDomains,
    config.adFilterHostsFile,
    config.adFilterAllowlist,
  );
  if (domainFilter.enabled) {
    logger.info(`广告过滤已启用: level=${config.adFilterLevel} 域名数=${domainFilter.count}`);
  } else {
    logger.info("广告过滤未启用 (off 或 hosts 文件缺失)");
  }
  let searchService = createSearchService(config, domainFilter, logger);
  const browserPool = getBrowserPool(config, logger);
  const fetchService = createFetchService(config, logger, browserPool);
  const browserTools = new BrowserTools(browserPool, config, logger);

  // adlist 定期刷新：拉取成功后重建广告过滤集 + 搜索服务
  const refreshDomainFilter = () => {
    domainFilter = buildDomainFilter(
      config.adFilterEnabled,
      config.adFilterLevel,
      config.adFilterExtraDomains,
      config.adFilterHostsFile,
      config.adFilterAllowlist,
    );
    searchService = createSearchService(config, domainFilter, logger);
    logger.info(`广告过滤已刷新: level=${config.adFilterLevel} 域名数=${domainFilter.count}`);
  };
  const stopScheduler = startAdListScheduler(config, logger, refreshDomainFilter);

  // 优雅关闭时释放浏览器资源 + 停止调度器
  process.on("SIGTERM", () => {
    stopScheduler();
    void browserPool.closeAll().catch(() => {});
  });
  process.on("SIGINT", () => {
    stopScheduler();
    void browserPool.closeAll().catch(() => {});
  });

  server.registerTool(
    "health",
    {
      description:
        "检查网关与各后端（searxng、FlareSolverr）的连通状态。返回 JSON，包含每个后端的 up/down、延迟和错误信息。",
    },
    async () => {
      const report = await getHealth(config, startedAt);
      logger.debug(`health probe: searxng=${report.searxng.status} flaresolverr=${report.flaresolverr.status}`);
      return { content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }] };
    },
  );

  server.registerTool(
    "search",
    {
      description:
        "搜索网页，返回 markdown 文本结果。查询会聚合多个搜索引擎（searxng），自动过滤广告/垃圾域名，并置顶直接回答/建议等元数据。",
      inputSchema: {
        query: z.string().describe("搜索关键词"),
        language: z.string().optional().describe("语言代码，如 en/zh-CN，默认按 searxng 实例"),
        time_range: z
          .enum(["day", "week", "month", "year"])
          .optional()
          .describe("时间范围过滤"),
        safesearch: z.enum(["0", "1", "2"]).optional().describe("安全搜索：0 无/1 中/2 严"),
        categories: z.string().optional().describe("搜索类别，逗号分隔，如 general,news"),
        engines: z.string().optional().describe("指定搜索引擎，逗号分隔"),
        min_score: z.number().min(0).max(1).optional().describe("最低相关度分数 0-1"),
        num_results: z.number().int().min(1).max(20).optional().describe("返回结果条数上限"),
      },
    },
    async (args) => {
      const result = await searchService.search({
        query: args.query,
        language: args.language,
        timeRange: args.time_range,
        safeSearch: args.safesearch,
        categories: args.categories,
        engines: args.engines,
        minScore: args.min_score,
        numResults: args.num_results,
      });
      return { content: [{ type: "text" as const, text: result.text }] };
    },
  );

  server.registerTool(
    "fetch",
    {
      description:
        "抓取一个网页 URL 并转换为 markdown。返回页面标题和正文的 markdown 文本，默认清理导航/广告，可保留链接/表格/代码块。",
      inputSchema: {
        url: z.string().url().describe("要抓取的网页 URL"),
        max_chars: z
          .number()
          .int()
          .positive()
          .max(200000)
          .optional()
          .describe("输出 markdown 最大字符数（上限 200000）"),
      },
    },
    async (args) => {
      const result = await fetchService.fetch({ url: args.url, maxChars: args.max_chars });
      return { content: [{ type: "text" as const, text: result.text }] };
    },
  );

  // ---- browser_* 工具（agent 交互，透明转发到内嵌 playwright） ----
  const browserResultContent = (r: Awaited<ReturnType<BrowserTools["snapshot"]>>) => {
    const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];
    if (r.screenshot) {
      content.push({ type: "image", data: r.screenshot.base64, mimeType: r.screenshot.mimeType });
    }
    if (r.error) {
      content.push({ type: "text" as const, text: `错误：${r.error}` });
    } else if (r.text) {
      content.push({ type: "text" as const, text: r.text });
    }
    return { content };
  };

  if (browserPool.enabled) {
    server.registerTool(
      "browser_navigate",
      {
        description: "在浏览器中打开一个 URL，返回页面无障碍树快照（结构化内容，省 token）。用于操作复杂 JS 页面。",
        inputSchema: { url: z.string().url().describe("要打开的 URL") },
      },
      async (args) => browserResultContent(await browserTools.navigate(args.url)),
    );

    server.registerTool(
      "browser_snapshot",
      {
        description: "获取当前页面的无障碍树快照。可选 target 选择器限定范围。",
        inputSchema: { target: z.string().optional().describe("CSS 选择器，限定快照范围") },
      },
      async (args) => browserResultContent(await browserTools.snapshot(args.target)),
    );

    server.registerTool(
      "browser_take_screenshot",
      {
        description: "对当前页面截图，返回 base64 图片。",
        inputSchema: {},
      },
      async () => browserResultContent(await browserTools.takeScreenshot()),
    );

    server.registerTool(
      "browser_click",
      {
        description: "点击页面元素（CSS 选择器），返回点击后的无障碍树快照。",
        inputSchema: { target: z.string().describe("要点击的元素 CSS 选择器") },
      },
      async (args) => browserResultContent(await browserTools.click(args.target)),
    );

    server.registerTool(
      "browser_type",
      {
        description: "在输入框（CSS 选择器）中输入文本，返回输入后的无障碍树快照。",
        inputSchema: {
          target: z.string().describe("输入框 CSS 选择器"),
          text: z.string().describe("要输入的文本"),
        },
      },
      async (args) => browserResultContent(await browserTools.type(args.target, args.text)),
    );

    server.registerTool(
      "browser_scroll",
      {
        description: "滚动页面（up/down/top/bottom），返回滚动后的无障碍树快照。",
        inputSchema: { direction: z.enum(["up", "down", "top", "bottom"]).describe("滚动方向") },
      },
      async (args) => browserResultContent(await browserTools.scroll(args.direction)),
    );

    server.registerTool(
      "browser_find",
      {
        description: "在当前页面的无障碍树中搜索文本，返回匹配片段。",
        inputSchema: { text: z.string().describe("要搜索的文本") },
      },
      async (args) => browserResultContent(await browserTools.find(args.text)),
    );

    server.registerTool(
      "browser_close",
      {
        description: "关闭当前浏览器会话页面。",
        inputSchema: {},
      },
      async () => browserResultContent(await browserTools.close()),
    );
  }

  return server;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  lastSeenAt: number;
}

/**
 * session 空闲过期：客户端崩溃/断连不发 DELETE 时回收 transport +
 * 浏览器上下文，防 sessions Map 无限增长。客户端正常重连会重新
 * initialize，不受影响。
 */
const SESSION_IDLE_TTL_MS = 60 * 60 * 1000; // 1 小时无活动
const SESSION_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 每 5 分钟扫一次

function isInitializeRequest(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    "method" in body &&
    (body as { method?: unknown }).method === "initialize"
  );
}

/** POST body 上限（MCP 请求都很小，1MB 足够；防超大 body 打满内存） */
const MAX_BODY_BYTES = 1024 * 1024;

function readJsonBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    req.on("data", (c) => {
      received += (c as Buffer).byteLength;
      if (received > MAX_BODY_BYTES) {
        req.destroy(); // 中断连接，不继续累积
        reject(new Error(`request body exceeds ${MAX_BODY_BYTES} bytes`));
        return;
      }
      chunks.push(c as Buffer);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (!raw) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function writeJson(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export async function startHttpServer(
  deps: { config: GatewayConfig; logger: Logger },
  createMcpServer: (config: GatewayConfig, logger: Logger) => Promise<McpServer>,
): Promise<{ url: string; close: () => Promise<void> }> {
  const { config, logger } = deps;
  const { createServer: createHttp } = await import("node:http");

  const sessions = new Map<string, Session>();
  let shutdown = false;
  // session 结束时同步清理对应的浏览器上下文（context/page），防泄漏
  const releaseBrowserSession = (sessionId: string) => {
    const pool = sharedBrowserPool;
    if (!pool) return;
    void mcpSessionContext.run(sessionId, () => pool.closeSession()).catch(() => {});
  };

  const httpServer = createHttp(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    // 健康检查端点（不经 MCP）
    if (url.pathname === "/health" && req.method === "GET") {
      const report = await getHealth(config, Date.now());
      writeJson(res, 200, report);
      return;
    }

    if (url.pathname !== "/mcp") {
      writeJson(res, 404, { error: "not found" });
      return;
    }

    // 可选 Bearer token 认证
    if (config.token && req.headers.authorization !== `Bearer ${config.token}`) {
      writeJson(res, 401, { error: "unauthorized" });
      return;
    }

    const method = req.method ?? "GET";

    if (method === "POST") {
      const sessionId = (req.headers["mcp-session-id"] as string | undefined) ?? undefined;
      const body = await readJsonBody(req);

      let transport: StreamableHTTPServerTransport;
      let mcpServer: McpServer;

      if (sessionId && sessions.has(sessionId)) {
        const s = sessions.get(sessionId)!;
        s.lastSeenAt = Date.now();
        transport = s.transport;
        mcpServer = s.server;
        logger.debug(`reusing session: ${sessionId}`);
      } else if (isInitializeRequest(body)) {
        mcpServer = await createMcpServer(config, logger);
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            sessions.set(sid, { transport, server: mcpServer, lastSeenAt: Date.now() });
            logger.debug(`session initialized: ${sid}`);
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) {
            sessions.delete(transport.sessionId);
            releaseBrowserSession(transport.sessionId);
          }
        };
        await mcpServer.connect(transport);
      } else {
        // 无有效 session 且非 initialize
        writeJson(res, sessionId ? 404 : 400, {
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: missing or invalid session" },
          id: null,
        });
        return;
      }

      try {
        // 注入 sessionId 到 AsyncLocalStorage：browser_* 工具据此隔离上下文
        await mcpSessionContext.run(sessionId ?? undefined, () =>
          transport.handleRequest(req, res, body),
        );
      } catch (err) {
        logger.error(`transport handleRequest failed: ${String(err)}`);
        if (!res.headersSent) {
          writeJson(res, 500, { error: "internal error" });
        }
      }
      return;
    }

    if (method === "GET") {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (!sessionId || !sessions.has(sessionId)) {
        writeJson(res, 400, { error: "invalid or missing session id" });
        return;
      }
      try {
        await mcpSessionContext.run(sessionId ?? undefined, () =>
          sessions.get(sessionId)!.transport.handleRequest(req, res, undefined),
        );
      } catch (err) {
        logger.error(`GET /mcp failed: ${String(err)}`);
        if (!res.headersSent) {
          writeJson(res, 500, { error: "internal error" });
        }
      }
      return;
    }

    if (method === "DELETE") {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (sessionId && sessions.has(sessionId)) {
        const s = sessions.get(sessionId)!;
        sessions.delete(sessionId);
        releaseBrowserSession(sessionId);
        try {
          await s.transport.close();
        } catch (err) {
          logger.warn(`error closing session transport: ${String(err)}`);
        }
        logger.debug(`session deleted: ${sessionId}`);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    writeJson(res, 405, { error: "method not allowed" });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.port, config.host, () => resolve());
  });

  // 空闲 session 清扫：过期即关闭 transport + 浏览器上下文
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [sid, s] of sessions) {
      if (now - s.lastSeenAt > SESSION_IDLE_TTL_MS) {
        sessions.delete(sid);
        releaseBrowserSession(sid);
        void s.transport.close().catch(() => {});
        logger.debug(`session expired (idle > ${SESSION_IDLE_TTL_MS}ms): ${sid}`);
      }
    }
  }, SESSION_SWEEP_INTERVAL_MS);
  sweep.unref?.();

  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : config.port;
  logger.info(`gateway listening on http://${config.host}:${port}/mcp`);

  return {
    url: `http://${config.host}:${port}/mcp`,
    close: async () => {
      shutdown = true;
      clearInterval(sweep);
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      for (const [, s] of sessions) {
        try {
          await s.transport.close();
        } catch {
          /* ignore */
        }
      }
      sessions.clear();
    },
  };
}

export async function startStdioServer(
  deps: { config: GatewayConfig; logger: Logger },
  createMcpServer: (config: GatewayConfig, logger: Logger) => Promise<McpServer>,
): Promise<void> {
  const { config, logger } = deps;
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const mcpServer = await createMcpServer(config, logger);
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  logger.info("gateway ready on stdio transport");
}

