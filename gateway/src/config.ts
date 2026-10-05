import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { z } from "zod";

const configSchema = z.object({
  gateway: z.object({
    host: z.string().default("127.0.0.1"),
    port: z.number().int().positive().max(65535).default(3000),
    token: z.string().default(""),
  }),
  logging: z
    .object({
      level: z.enum(["debug", "info", "warn", "error"]).default("info"),
      file: z.string().default(""),
    })
    .catch({ level: "info", file: "" }),
  searxng: z
    .object({
      url: z.string().url().default("http://127.0.0.1:8888"),
      timeout_ms: z.number().int().positive().default(10000),
    })
    .catch({ url: "http://127.0.0.1:8888", timeout_ms: 10000 }),
  flaresolverr: z
    .object({
      url: z.string().url().default("http://127.0.0.1:8192"),
      enabled: z.boolean().default(true),
      timeout_ms: z.number().int().positive().default(60000),
      max_concurrent: z.number().int().positive().max(16).default(2),
      trigger_status: z.array(z.number().int().positive()).default([403, 405, 429]),
      fallback_on_empty: z.boolean().default(true),
    })
    .catch({
      url: "http://127.0.0.1:8192",
      enabled: true,
      timeout_ms: 60000,
      max_concurrent: 2,
      trigger_status: [403, 405, 429],
      fallback_on_empty: true,
    }),
  search: z
    .object({
      max_results: z.number().int().positive().max(50).default(10),
      max_result_chars: z.number().int().positive().default(500),
      cache_ttl_ms: z.number().int().positive().default(300000),
      cache_max_entries: z.number().int().positive().default(200),
      max_concurrent: z.number().int().positive().max(16).default(2),
      fallback: z.boolean().default(true),
      tavily_api_key: z.string().default(""),
    })
    .catch({
      max_results: 10,
      max_result_chars: 500,
      cache_ttl_ms: 300000,
      cache_max_entries: 200,
      max_concurrent: 2,
      fallback: true,
      tavily_api_key: "",
    }),
  rerank: z
    .object({
      enabled: z.boolean().default(true),
      engine_boost: z.record(z.string(), z.number().nonnegative()).default({}),
    })
    .catch({ enabled: true, engine_boost: {} }),
  ad_filter: z
    .object({
      enabled: z.boolean().default(true),
      level: z.enum(["off", "ads", "ads+tracking", "ads+porn", "full"]).default("ads"),
      extra_domains: z.array(z.string()).default([]),
      hosts_file: z.string().default("data/adblock/hosts"),
      allowlist: z.array(z.string()).default([]),
      auto_update: z.boolean().default(true),
      auto_update_interval_ms: z.number().int().positive().default(86400000),
    })
    .catch({
      enabled: true,
      level: "ads",
      extra_domains: [],
      hosts_file: "data/adblock/hosts",
      allowlist: [],
      auto_update: true,
      auto_update_interval_ms: 86400000,
    }),
  fetch: z
    .object({
      timeout_ms: z.number().int().positive().default(15000),
      max_bytes: z.number().int().positive().default(5242880),
      user_agent: z.string().default(""),
      block_private_ips: z.boolean().default(true),
      private_ip_exempt_cidrs: z
        .array(z.string())
        .default(["198.18.0.0/15", "fdfe:dcba:9876::/64"]),
      structural: z.enum(["clean", "full"]).default("clean"),
      max_output_chars: z.number().int().positive().default(20000),
      cache_ttl_ms: z.number().int().positive().default(600000),
      cache_max_entries: z.number().int().positive().default(200),
    })
    .catch({
      timeout_ms: 15000,
      max_bytes: 5242880,
      user_agent: "",
      block_private_ips: true,
      private_ip_exempt_cidrs: ["198.18.0.0/15", "fdfe:dcba:9876::/64"],
      structural: "clean",
      max_output_chars: 20000,
      cache_ttl_ms: 600000,
      cache_max_entries: 200,
    }),
  browser: z
    .object({
      enabled: z.boolean().default(true),
      headless: z.boolean().default(true),
      pool_size: z.number().int().positive().max(4).default(1),
      idle_ttl_ms: z.number().int().positive().default(360000),
      timeout_ms: z.number().int().positive().default(30000),
      max_concurrent: z.number().int().positive().max(8).default(2),
      engine: z.enum(["chromium", "camoufox"]).default("chromium"),
      proxy_server: z.string().default(""),
      proxy_username: z.string().default(""),
      proxy_password: z.string().default(""),
      wait_for_selector: z.string().default(""),
      screenshot: z
        .object({
          enabled: z.boolean().default(true),
          max_size: z.number().int().positive().default(512),
          image_type: z.enum(["jpeg", "png"]).default("jpeg"),
        })
        .catch({ enabled: true, max_size: 512, image_type: "jpeg" }),
    })
    .catch({
      enabled: true,
      headless: true,
      pool_size: 1,
      idle_ttl_ms: 360000,
      timeout_ms: 30000,
      max_concurrent: 2,
      engine: "chromium",
      proxy_server: "",
      proxy_username: "",
      proxy_password: "",
      wait_for_selector: "",
      screenshot: { enabled: true, max_size: 512, image_type: "jpeg" },
    }),
});

export type AdFilterLevel = "off" | "ads" | "ads+tracking" | "ads+porn" | "full";

export interface GatewayConfig {
  host: string;
  port: number;
  token: string | undefined;
  logLevel: "debug" | "info" | "warn" | "error";
  logFile: string | undefined;
  searxngUrl: string;
  searxngTimeoutMs: number;
  flaresolverrUrl: string;
  flaresolverrEnabled: boolean;
  flaresolverrTimeoutMs: number;
  flaresolverrMaxConcurrent: number;
  flaresolverrTriggerStatus: number[];
  flaresolverrFallbackOnEmpty: boolean;
  searchMaxResults: number;
  searchMaxResultChars: number;
  searchCacheTtlMs: number;
  searchCacheMaxEntries: number;
  searchMaxConcurrent: number;
  searchFallback: boolean;
  searchTavilyApiKey: string | undefined;
  rerankEnabled: boolean;
  rerankEngineBoost: Record<string, number>;
  adFilterEnabled: boolean;
  adFilterLevel: AdFilterLevel;
  adFilterExtraDomains: string[];
  adFilterHostsFile: string;
  adFilterAllowlist: string[];
  adFilterAutoUpdate: boolean;
  adFilterAutoUpdateIntervalMs: number;
  fetchTimeoutMs: number;
  fetchMaxBytes: number;
  fetchUserAgent: string;
  fetchBlockPrivateIps: boolean;
  fetchPrivateIpExemptCidrs: string[];
  fetchStructural: "clean" | "full";
  fetchMaxOutputChars: number;
  fetchCacheTtlMs: number;
  fetchCacheMaxEntries: number;
  browserEnabled: boolean;
  browserHeadless: boolean;
  browserPoolSize: number;
  browserIdleTtlMs: number;
  browserTimeoutMs: number;
  browserMaxConcurrent: number;
  browserEngine: "chromium" | "camoufox";
  browserProxyServer: string;
  browserProxyUsername: string;
  browserProxyPassword: string;
  browserWaitForSelector: string;
  browserScreenshotEnabled: boolean;
  browserScreenshotMaxSize: number;
  browserScreenshotImageType: "jpeg" | "png";
}

export function getProjectRoot(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return resolve(here, "..");
  } catch {
    return process.cwd();
  }
}

export function defaultConfigPath(): string {
  if (process.env.GATEWAY_CONFIG && existsSync(process.env.GATEWAY_CONFIG)) {
    return resolve(process.env.GATEWAY_CONFIG);
  }
  const cwdPath = resolve(process.cwd(), "gateway.yaml");
  if (existsSync(cwdPath)) return cwdPath;

  const projectRoot = getProjectRoot();
  const rootConfig = resolve(projectRoot, "gateway.yaml");
  if (existsSync(rootConfig)) return rootConfig;

  const rootExample = resolve(projectRoot, "gateway.yaml.example");
  if (existsSync(rootExample)) return rootExample;

  return cwdPath;
}

/**
 * 加载 gateway.yaml，用 zod 校验，返回强类型配置。
 * token 优先用环境变量 GATEWAY_TOKEN 覆盖（避免密钥写文件）。
 * 找不到 yaml 或校验失败时抛错。
 */
export function loadConfig(configPath: string = defaultConfigPath()): GatewayConfig {
  if (!existsSync(configPath)) {
    throw new Error(
      `配置文件不存在: ${configPath}。请复制 gateway.yaml.example 为 gateway.yaml 后修改。`,
    );
  }

  let raw: unknown;
  try {
    raw = YAML.parse(readFileSync(configPath, "utf-8"));
  } catch (err) {
    throw new Error(`gateway.yaml 解析失败: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (raw === null || raw === undefined || typeof raw !== "object") {
    throw new Error(`gateway.yaml 内容为空或格式非法`);
  }

  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`gateway.yaml 校验失败: ${issues}`);
  }

  const v = parsed.data;
  const envToken = process.env.GATEWAY_TOKEN;
  const token = envToken && envToken.length > 0 ? envToken : v.gateway.token;

  const rawHosts = v.ad_filter.hosts_file;
  const hostsFile = isAbsolute(rawHosts) ? rawHosts : resolve(getProjectRoot(), rawHosts);

  const envTavilyKey = process.env.TAVILY_API_KEY;
  const tavilyKey = envTavilyKey && envTavilyKey.length > 0 ? envTavilyKey : v.search.tavily_api_key;

  return {
    host: v.gateway.host,
    port: v.gateway.port,
    token: token && token.length > 0 ? token : undefined,
    logLevel: v.logging.level,
    logFile: v.logging.file && v.logging.file.length > 0 ? v.logging.file : undefined,
    searxngUrl: v.searxng.url.replace(/\/+$/, ""),
    searxngTimeoutMs: v.searxng.timeout_ms,
    flaresolverrUrl: v.flaresolverr.url.replace(/\/+$/, ""),
    flaresolverrEnabled: v.flaresolverr.enabled,
    flaresolverrTimeoutMs: v.flaresolverr.timeout_ms,
    flaresolverrMaxConcurrent: v.flaresolverr.max_concurrent,
    flaresolverrTriggerStatus: v.flaresolverr.trigger_status,
    flaresolverrFallbackOnEmpty: v.flaresolverr.fallback_on_empty,
    searchMaxResults: v.search.max_results,
    searchMaxResultChars: v.search.max_result_chars,
    searchCacheTtlMs: v.search.cache_ttl_ms,
    searchCacheMaxEntries: v.search.cache_max_entries,
    searchMaxConcurrent: v.search.max_concurrent,
    searchFallback: v.search.fallback,
    searchTavilyApiKey: tavilyKey && tavilyKey.length > 0 ? tavilyKey : undefined,
    rerankEnabled: v.rerank.enabled,
    rerankEngineBoost: v.rerank.engine_boost,
    adFilterEnabled: v.ad_filter.enabled,
    adFilterLevel: v.ad_filter.level,
    adFilterExtraDomains: v.ad_filter.extra_domains,
    adFilterHostsFile: hostsFile,
    adFilterAllowlist: v.ad_filter.allowlist,
    adFilterAutoUpdate: v.ad_filter.auto_update,
    adFilterAutoUpdateIntervalMs: v.ad_filter.auto_update_interval_ms,
    fetchTimeoutMs: v.fetch.timeout_ms,
    fetchMaxBytes: v.fetch.max_bytes,
    fetchUserAgent: v.fetch.user_agent,
    fetchBlockPrivateIps: v.fetch.block_private_ips,
    fetchPrivateIpExemptCidrs: v.fetch.private_ip_exempt_cidrs,
    fetchStructural: v.fetch.structural,
    fetchMaxOutputChars: v.fetch.max_output_chars,
    fetchCacheTtlMs: v.fetch.cache_ttl_ms,
    fetchCacheMaxEntries: v.fetch.cache_max_entries,
    browserEnabled: v.browser.enabled,
    browserHeadless: v.browser.headless,
    browserPoolSize: v.browser.pool_size,
    browserIdleTtlMs: v.browser.idle_ttl_ms,
    browserTimeoutMs: v.browser.timeout_ms,
    browserMaxConcurrent: v.browser.max_concurrent,
    browserEngine: v.browser.engine,
    browserProxyServer: v.browser.proxy_server,
    browserProxyUsername: v.browser.proxy_username,
    browserProxyPassword: v.browser.proxy_password,
    browserWaitForSelector: v.browser.wait_for_selector,
    browserScreenshotEnabled: v.browser.screenshot.enabled,
    browserScreenshotMaxSize: v.browser.screenshot.max_size,
    browserScreenshotImageType: v.browser.screenshot.image_type,
  };
}
