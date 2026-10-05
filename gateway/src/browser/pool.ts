import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { GatewayConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { isPrivateHost } from "../fetch/ssrf.js";
import { mcpSessionContext } from "../utils/session-context.js";

export class BrowserPoolError extends Error {}

export interface BrowserSession {
  page: Page;
  lastActiveAt: number;
}

/** 无 sessionId（fetch 渲染路径）使用的共享 context 键 */
const SHARED_KEY = "__shared__";

interface SessionState {
  context: BrowserContext;
  page: Page;
  lastActiveAt: number;
}

/** 简单信号量 */
class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;
  constructor(private max: number) {}
  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return this.release;
    }
    await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    return this.release;
  }
  private release = (): void => {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  };
}

/**
 * playwright 浏览器实例池。
 * - 懒加载：首次调用才启动 Chromium
 * - TTL：空闲 idle_ttl_ms 无操作自动关闭（省内存）
 * - pool_size 限制同时启动的浏览器数
 * - engine: camoufox 预留（当前仅 chromium，camoufox 需后续接入）
 */
export class BrowserPool {
  private browsers: Browser[] = [];
  /** 共享 context（fetch 渲染等无 sessionId 的场景） */
  private shared: SessionState | null = null;
  /** per-session context：browser_* 工具按 MCP sessionId 隔离 */
  private sessions = new Map<string, SessionState>();
  private lastActiveAt = 0;
  private ttlTimer: ReturnType<typeof setTimeout> | null = null;
  private sem: Semaphore;
  private closed = false;
  /** 每次 closeAll 递增；launch 前后不一致说明期间发生过关闭 */
  private generation = 0;
  /** hostname → 私网判定缓存（避免每个子资源请求都做 DNS 查询） */
  private ssrfCache = new Map<string, { blocked: boolean; at: number }>();
  private static readonly SSRF_CACHE_TTL_MS = 60_000;
  private static readonly SSRF_CACHE_MAX = 500;

  constructor(
    private config: GatewayConfig,
    private logger: Logger,
  ) {
    this.sem = new Semaphore(config.browserMaxConcurrent);
  }

  /**
   * route 级 SSRF 防护：拦截页面内所有请求（导航重定向/子资源），
   * 非 http(s) 或解析为内网 IP 的一律 abort。
   */
  private async setupSsrfGuard(ctx: BrowserContext): Promise<void> {
    if (!this.config.fetchBlockPrivateIps) return;
    await ctx.route("**/*", async (route) => {
      const url = route.request().url();
      if (!/^https?:/i.test(url)) {
        await route.abort().catch(() => {});
        return;
      }
      let host: string;
      try {
        host = new URL(url).hostname;
      } catch {
        await route.abort().catch(() => {});
        return;
      }
      const cached = this.ssrfCache.get(host);
      let blocked: boolean;
      if (cached && Date.now() - cached.at < BrowserPool.SSRF_CACHE_TTL_MS) {
        blocked = cached.blocked;
      } else {
        try {
          blocked = await isPrivateHost(host, {
            exemptCidrs: this.config.fetchPrivateIpExemptCidrs,
          });
        } catch {
          blocked = false;
        }
        this.ssrfCache.set(host, { blocked, at: Date.now() });
        if (this.ssrfCache.size > BrowserPool.SSRF_CACHE_MAX) this.ssrfCache.clear();
      }
      if (blocked) {
        this.logger.debug(`SSRF guard: 拦截内网请求 ${url}`);
        await route.abort("blockedbyclient").catch(() => {});
        return;
      }
      await route.continue().catch(() => {});
    });
  }

  get enabled(): boolean {
    return this.config.browserEnabled;
  }

  private launchOptions(): Parameters<typeof chromium.launch>[0] {
    const opts: Parameters<typeof chromium.launch>[0] = {
      headless: this.config.browserHeadless,
      args: [
        "--no-zygote",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--mute-audio",
      ],
    };
    if (this.config.browserProxyServer) {
      opts.proxy = {
        server: this.config.browserProxyServer,
        username: this.config.browserProxyUsername || undefined,
        password: this.config.browserProxyPassword || undefined,
      };
    }
    return opts;
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.closed) throw new BrowserPoolError("浏览器池已关闭");
    if (this.browsers.length > 0) return this.browsers[0];
    if (this.config.browserEngine === "camoufox") {
      throw new BrowserPoolError("camoufox 引擎尚未接入（预留）。当前请使用 chromium。");
    }
    this.logger.debug("启动 playwright chromium...");
    const gen = this.generation;
    const browser = await chromium.launch(this.launchOptions());
    if (gen !== this.generation) {
      // launch 期间发生过 closeAll：立即关掉新实例，避免逃逸回收（永不释放）
      await browser.close().catch(() => {});
      throw new BrowserPoolError("浏览器池已关闭，请重试");
    }
    this.browsers.push(browser);
    return browser;
  }

  private resetTtl(): void {
    if (this.ttlTimer) clearTimeout(this.ttlTimer);
    this.ttlTimer = setTimeout(() => {
      void this.closeIdle();
    }, this.config.browserIdleTtlMs);
    this.ttlTimer.unref?.();
  }

  private async closeIdle(): Promise<void> {
    if (this.closed || this.browsers.length === 0) return;
    const idle = Date.now() - this.lastActiveAt >= this.config.browserIdleTtlMs;
    if (!idle) {
      this.resetTtl();
      return;
    }
    this.logger.debug("浏览器空闲超时，关闭实例...");
    await this.closeAll();
  }

  /** 创建新 context（含 SSRF route guard）。 */
  private async newContext(): Promise<BrowserContext> {
    const browser = await this.ensureBrowser();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await this.setupSsrfGuard(ctx);
    return ctx;
  }

  /**
   * 获取一个 page（会话）。TTL 复位。并发受信号量保护。
   * 有 mcpSessionContext 时按 sessionId 隔离（每个 MCP 客户端独立
   * context/page，cookie 与浏览状态互不可见）；否则用共享 context
   * （fetch 渲染路径）。
   */
  async acquireSession(): Promise<BrowserSession> {
    const release = await this.sem.acquire();
    try {
      const sessionId = mcpSessionContext.getStore();
      let state: SessionState | undefined;
      if (sessionId) {
        state = this.sessions.get(sessionId);
        if (state && (state.page.isClosed() || !state.context.pages().includes(state.page))) {
          // 页面被意外关闭，重建 page（context 保留，保住 cookie/存储）
          state = undefined;
        }
        if (!state) {
          const context = await this.newContext();
          state = { context, page: await context.newPage(), lastActiveAt: 0 };
          this.sessions.set(sessionId, state);
        }
      } else {
        if (this.shared && (this.shared.page.isClosed() || !this.shared.context.pages().includes(this.shared.page))) {
          this.shared = null;
        }
        if (!this.shared) {
          const context = await this.newContext();
          this.shared = { context, page: await context.newPage(), lastActiveAt: 0 };
        }
        state = this.shared;
      }
      state.lastActiveAt = Date.now();
      this.lastActiveAt = Date.now();
      this.resetTtl();
      return { page: state.page, lastActiveAt: state.lastActiveAt };
    } finally {
      release();
    }
  }

  /**
   * 关闭当前 MCP 会话的页面+context（browser_close 工具用）。
   * 只影响调用方会话，不动其它客户端，也不关共享渲染 context。
   */
  async closeSession(): Promise<void> {
    const sessionId = mcpSessionContext.getStore();
    if (sessionId && this.sessions.has(sessionId)) {
      const state = this.sessions.get(sessionId)!;
      this.sessions.delete(sessionId);
      try {
        await state.context.close();
      } catch {
        /* ignore */
      }
    }
  }

  async closeAll(): Promise<void> {
    this.closed = true;
    this.generation += 1;
    if (this.ttlTimer) clearTimeout(this.ttlTimer);
    this.ttlTimer = null;
    for (const b of this.browsers) {
      await b.close().catch(() => {});
    }
    this.browsers = [];
    this.shared = null;
    this.sessions.clear();
    this.closed = false; // 允许重新创建
  }

  isRunning(): boolean {
    return this.browsers.length > 0;
  }
}
