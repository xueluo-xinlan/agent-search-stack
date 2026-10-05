import type { GatewayConfig } from "../config.js";
import { isPrivateHost } from "./ssrf.js";

const DEFAULT_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

export type FetchErrorKind =
  | "invalid_url"
  | "blocked_private_ip"
  | "timeout"
  | "http"
  | "network"
  | "too_large"
  | "not_html"
  | "empty";

export interface DirectFetchResult {
  ok: boolean;
  status?: number;
  contentType?: string;
  finalUrl?: string;
  html?: string;
  truncated?: boolean;
  errorKind?: FetchErrorKind;
  errorMessage?: string;
}

const MAX_REDIRECTS = 5;
const HTML_TYPES = ["text/html", "application/xhtml+xml"];

/** TextDecoder 支持的常见 charset 别名（大小写不敏感） */
const KNOWN_CHARSETS = new Set([
  "utf-8", "utf8", "gbk", "gb2312", "gb18030", "big5", "shift_jis", "shift-jis",
  "euc-jp", "euc-kr", "iso-8859-1", "iso-8859-2", "iso-8859-15", "latin1",
  "windows-1250", "windows-1251", "windows-1252", "windows-1256", "koi8-r",
  "us-ascii", "ascii", "utf-16le", "utf-16be",
]);

function isHtmlContentType(ct: string): boolean {
  const base = ct.split(";")[0].trim().toLowerCase();
  return HTML_TYPES.some((t) => base === t || base.startsWith(t));
}

/**
 * 从 HTML 头部探测 charset：很多老站（尤其中文站）只在
 * <meta charset> / <meta http-equiv> 声明，HTTP header 没有。
 * 返回 null 表示未声明（调用方回退 header/utf-8）。
 */
function sniffHtmlCharset(buf: Buffer): string | null {
  // charset 声明基本都在前 4KB；ascii 片段即可匹配
  const head = buf.subarray(0, 4096).toString("latin1");
  // <meta charset="gbk"> / <meta charset=gbk>
  let m = /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(head);
  if (!m) {
    // <meta http-equiv="Content-Type" content="text/html; charset=gbk">
    m = /<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([\w-]+)/i.exec(head);
  }
  if (!m) return null;
  const cs = m[1].toLowerCase();
  return KNOWN_CHARSETS.has(cs) ? cs : null;
}

/**
 * 校验 URL 是否允许抓取：协议必须 http/https，且（启用时）hostname 非内网。
 * 初始 URL 与每次重定向目标都调用 —— 防止 302 跳转绕过 SSRF 检查直达内网。
 */
async function checkUrlAllowed(
  config: GatewayConfig,
  url: URL,
): Promise<
  | { ok: true }
  | { ok: false; errorKind: "invalid_url" | "blocked_private_ip"; errorMessage: string }
> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, errorKind: "invalid_url", errorMessage: `仅支持 http/https: ${url.toString()}` };
  }
  if (config.fetchBlockPrivateIps) {
    let privateHost = false;
    try {
      privateHost = await isPrivateHost(url.hostname, {
        exemptCidrs: config.fetchPrivateIpExemptCidrs,
      });
    } catch {
      /* 解析失败按非私有处理，交由请求阶段决定 */
    }
    if (privateHost) {
      return {
        ok: false,
        errorKind: "blocked_private_ip",
        errorMessage: `SSRF 防护：拒绝内网地址 ${url.hostname}`,
      };
    }
  }
  return { ok: true };
}

/**
 * 直接 HTTP 抓取目标 URL。
 * - 只收 text/html
 * - 流式读响应体到 max_bytes，超限截断并标注 truncated
 * - SSRF 防护：blockPrivateIps=true 时拒绝私网主机
 * - 跟随重定向（≤MAX_REDIRECTS）
 */
export async function directFetch(
  config: GatewayConfig,
  urlStr: string,
): Promise<DirectFetchResult> {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return { ok: false, errorKind: "invalid_url", errorMessage: `非法 URL: ${urlStr}` };
  }

  // SSRF 防护（初始 URL；重定向目标在循环内同样检查）
  const initialCheck = await checkUrlAllowed(config, url);
  if (!initialCheck.ok) {
    return { ok: false, errorKind: initialCheck.errorKind, errorMessage: initialCheck.errorMessage };
  }

  const ua = config.fetchUserAgent && config.fetchUserAgent.length > 0 ? config.fetchUserAgent : DEFAULT_UA;

  let currentUrl = url;
  let currentHtml: string | undefined;
  let truncated = false;
  let status = 0;
  let contentType = "";

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.fetchTimeoutMs);
    try {
      const res = await fetch(currentUrl.toString(), {
        signal: controller.signal,
        redirect: "manual",
        headers: { "User-Agent": ua, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
      });
      status = res.status;
      contentType = res.headers.get("content-type") ?? "";

      // 重定向：先校验目标协议/内网，再继续（防 SSRF 跳板）
      if (status >= 300 && status < 400) {
        const loc = res.headers.get("location");
        if (!loc) {
          return { ok: false, errorKind: "http", status, errorMessage: `重定向无 location (${status})` };
        }
        let nextUrl: URL;
        try {
          nextUrl = new URL(loc, currentUrl);
        } catch {
          return { ok: false, errorKind: "invalid_url", status, errorMessage: `重定向 location 非法: ${loc}` };
        }
        const nextCheck = await checkUrlAllowed(config, nextUrl);
        if (!nextCheck.ok) {
          return {
            ok: false,
            errorKind: nextCheck.errorKind,
            errorMessage: `${nextCheck.errorMessage}（重定向目标 ${nextUrl.hostname}）`,
          };
        }
        currentUrl = nextUrl;
        continue;
      }

      if (status < 200 || status >= 300) {
        return { ok: false, errorKind: "http", status, errorMessage: `HTTP ${status}` };
      }

      if (!isHtmlContentType(contentType)) {
        return { ok: false, errorKind: "not_html", status, contentType, errorMessage: `非网页内容: ${contentType || "未知"}` };
      }

      // 流式读 body 到 max_bytes
      const reader = res.body?.getReader();
      if (!reader) {
        return { ok: false, errorKind: "empty", errorMessage: "响应无内容" };
      }
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        received += value.byteLength;
        if (received > config.fetchMaxBytes) {
          truncated = true;
          // 保留已读部分即可
          chunks.push(value.subarray(0, Math.max(0, config.fetchMaxBytes - (received - value.byteLength))));
          break;
        }
        chunks.push(value);
      }
      await reader.cancel().catch(() => {});

      // 解码：header charset 优先，缺失时嗅探 <meta charset>（老中文站常见）
      const buf = Buffer.concat(chunks);
      let charset = /charset=([\w-]+)/i.exec(contentType)?.[1];
      if (!charset) charset = sniffHtmlCharset(buf) ?? "utf-8";
      currentHtml = new TextDecoder(charset as BufferEncoding, { fatal: false }).decode(buf);

      return {
        ok: true,
        status,
        contentType,
        finalUrl: currentUrl.toString(),
        html: currentHtml,
        truncated,
      };
    } catch (err) {
      const e = err as Error;
      if (e.name === "AbortError") {
        return { ok: false, errorKind: "timeout", errorMessage: `抓取超时 (>${config.fetchTimeoutMs}ms)` };
      }
      return { ok: false, errorKind: "network", errorMessage: e.message };
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, errorKind: "http", status, errorMessage: "重定向次数超限" };
}
