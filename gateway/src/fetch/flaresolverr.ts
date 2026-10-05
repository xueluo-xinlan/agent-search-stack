import type { GatewayConfig } from "../config.js";
import { assertPublicHttpUrl } from "./ssrf.js";

export interface FlareSolverrResult {
  ok: boolean;
  renderedHtml?: string;
  finalUrl?: string;
  statusCode?: number;
  errorKind?: "timeout" | "http" | "network" | "not_ok" | "empty" | "invalid_json" | "too_large" | "blocked";
  errorMessage?: string;
}

interface Solution {
  url?: string;
  status?: number;
  response?: string;
  cookies?: unknown[];
  userAgent?: string;
}

interface V1Response {
  status?: string;
  message?: string;
  solution?: Solution;
}

/** 简单信号量：限制并发数，超出排队等待。 */
class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;

  constructor(private max: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return this.release;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
    return this.release;
  }

  private release = (): void => {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  };
}

const MAX_BODY_BYTES = 20 * 1024 * 1024; // 渲染 HTML 上限 20MB

/**
 * 调用 FlareSolverr /v1 request.get，获取浏览器渲染后的 HTML。
 * 关键：returnOnlyCookies=false → solution.response 返回渲染后 DOM。
 */
export function createFlareSolverrClient(config: GatewayConfig) {
  const sem = new Semaphore(config.flaresolverrMaxConcurrent);

  async function requestGet(url: string): Promise<FlareSolverrResult> {
    const release = await sem.acquire();
    try {
      return await doRequest(url);
    } finally {
      release();
    }
  }

  async function doRequest(url: string): Promise<FlareSolverrResult> {
    // FlareSolverr 会自行解析并访问 URL，网关必须前置校验协议 + 内网（SSRF）
    const check = await assertPublicHttpUrl(url, {
      exemptCidrs: config.fetchPrivateIpExemptCidrs,
      enabled: config.fetchBlockPrivateIps,
    });
    if (!check.ok) {
      return {
        ok: false,
        errorKind: "blocked",
        errorMessage:
          check.reason === "private_ip"
            ? `SSRF 防护：拒绝内网地址 ${url}`
            : `非法 URL: ${url}`,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.flaresolverrTimeoutMs);
    try {
      const res = await fetch(`${config.flaresolverrUrl}/v1`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cmd: "request.get",
          url,
          maxTimeout: config.flaresolverrTimeoutMs,
          returnOnlyCookies: false,
        }),
      });

      if (!res.ok) {
        return { ok: false, errorKind: "http", errorMessage: `FlareSolverr HTTP ${res.status}` };
      }

      // 限制读取 body
      const reader = res.body?.getReader();
      if (!reader) {
        return { ok: false, errorKind: "network", errorMessage: "FlareSolverr 无响应体" };
      }
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        received += value.byteLength;
        if (received > MAX_BODY_BYTES) {
          await reader.cancel().catch(() => {});
          return { ok: false, errorKind: "too_large", errorMessage: "FlareSolverr 响应过大" };
        }
        chunks.push(value);
      }

      let data: V1Response;
      try {
        data = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as V1Response;
      } catch {
        return { ok: false, errorKind: "invalid_json", errorMessage: "FlareSolverr 返回非 JSON" };
      }

      if (data.status !== "ok") {
        return { ok: false, errorKind: "not_ok", errorMessage: data.message ?? "FlareSolverr 处理失败" };
      }

      const html = data.solution?.response;
      if (!html || html.length === 0) {
        return { ok: false, errorKind: "empty", errorMessage: "FlareSolverr 渲染结果为空" };
      }

      return {
        ok: true,
        renderedHtml: html,
        finalUrl: data.solution?.url,
        statusCode: data.solution?.status,
      };
    } catch (err) {
      const e = err as Error;
      if (e.name === "AbortError") {
        return { ok: false, errorKind: "timeout", errorMessage: `FlareSolverr 超时 (>${config.flaresolverrTimeoutMs}ms)` };
      }
      return { ok: false, errorKind: "network", errorMessage: e.message };
    } finally {
      clearTimeout(timer);
    }
  }

  return { requestGet };
}

export type FlareSolverrClient = ReturnType<typeof createFlareSolverrClient>;
