import type { Page } from "playwright";
import type { GatewayConfig } from "../config.js";
import type { BrowserPool } from "./pool.js";
import type { Logger } from "../logger.js";
import { assertPublicHttpUrl } from "../fetch/ssrf.js";
import { pageScreenshot, pageSnapshot } from "./snapshot.js";

export interface ToolResult {
  ok: boolean;
  text?: string;
  screenshot?: { mimeType: string; base64: string };
  error?: string;
}

function okText(text: string): ToolResult {
  return { ok: true, text };
}

function errResult(err: unknown): ToolResult {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

export class BrowserTools {
  constructor(
    private pool: BrowserPool,
    private config: GatewayConfig,
    private logger: Logger,
  ) {}

  async navigate(url: string): Promise<ToolResult> {
    if (!this.pool.enabled) return errResult(new Error("浏览器功能未启用"));
    // SSRF：浏览器会自行解析并访问 URL，导航前校验协议 + 内网
    const check = await assertPublicHttpUrl(url, {
      exemptCidrs: this.config.fetchPrivateIpExemptCidrs,
      enabled: this.config.fetchBlockPrivateIps,
    });
    if (!check.ok) {
      return errResult(
        new Error(
          check.reason === "private_ip" ? `SSRF 防护：拒绝内网地址 ${url}` : `非法 URL: ${url}`,
        ),
      );
    }
    try {
      const { page } = await this.pool.acquireSession();
      await page.goto(url, { waitUntil: "networkidle", timeout: this.config.browserTimeoutMs });
      const snap = await pageSnapshot(page);
      if (!snap.ok) return errResult(new Error(snap.error));
      return okText(`已导航到 ${page.url()}\n\n${snap.snapshot}`);
    } catch (err) {
      return errResult(err);
    }
  }

  async snapshot(target?: string): Promise<ToolResult> {
    try {
      const { page } = await this.pool.acquireSession();
      const snap = await pageSnapshot(page, target);
      if (!snap.ok) return errResult(new Error(snap.error));
      return okText(snap.snapshot!);
    } catch (err) {
      return errResult(err);
    }
  }

  async takeScreenshot(): Promise<ToolResult> {
    try {
      const { page } = await this.pool.acquireSession();
      const shot = await pageScreenshot(page, this.config);
      if (!shot.ok) return errResult(new Error(shot.error));
      return { ok: true, screenshot: { mimeType: shot.mimeType!, base64: shot.base64! } };
    } catch (err) {
      return errResult(err);
    }
  }

  async click(target: string): Promise<ToolResult> {
    try {
      const { page } = await this.pool.acquireSession();
      await page.locator(target).first().click({ timeout: this.config.browserTimeoutMs });
      const snap = await pageSnapshot(page);
      if (!snap.ok) return okText(`已点击 ${target}`);
      return okText(`已点击 ${target}\n\n${snap.snapshot}`);
    } catch (err) {
      return errResult(err);
    }
  }

  async type(target: string, text: string): Promise<ToolResult> {
    try {
      const { page } = await this.pool.acquireSession();
      await page.locator(target).first().fill(text, { timeout: this.config.browserTimeoutMs });
      const snap = await pageSnapshot(page);
      if (!snap.ok) return okText(`已输入 ${target}`);
      return okText(`已输入 ${target}\n\n${snap.snapshot}`);
    } catch (err) {
      return errResult(err);
    }
  }

  async scroll(direction: "up" | "down" | "top" | "bottom"): Promise<ToolResult> {
    try {
      const { page } = await this.pool.acquireSession();
      if (direction === "top") await page.evaluate(() => window.scrollTo(0, 0));
      else if (direction === "bottom") await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      else await page.evaluate((d) => window.scrollBy(0, d === "down" ? window.innerHeight : -window.innerHeight), direction);
      const snap = await pageSnapshot(page);
      if (!snap.ok) return okText(`已滚动 ${direction}`);
      return okText(`已滚动 ${direction}\n\n${snap.snapshot}`);
    } catch (err) {
      return errResult(err);
    }
  }

  async find(text: string): Promise<ToolResult> {
    try {
      const { page } = await this.pool.acquireSession();
      const snap = await page.locator("body").ariaSnapshot();
      const lines = snap.split("\n").filter((l) => l.toLowerCase().includes(text.toLowerCase()));
      if (lines.length === 0) return okText(`未找到包含「${text}」的内容`);
      return okText(lines.slice(0, 30).join("\n"));
    } catch (err) {
      return errResult(err);
    }
  }

  async close(): Promise<ToolResult> {
    try {
      // 只关当前 MCP 会话的 context/page，不动共享渲染上下文与其它客户端
      await this.pool.closeSession();
      return okText("浏览器会话已关闭，资源已释放");
    } catch (err) {
      return errResult(err);
    }
  }
}
