import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AdFilterLevel } from "../config.js";

/**
 * StevenBlack hosts 各 level 对应的源 URL。
 * 说明：StevenBlack 的基础是 Unified hosts（ads + tracking，master/hosts），
 * 没有独立的 ads-only 变体；扩展是加 fakenews/gambling/porn/social。
 * 因此 ads 与 ads+tracking 均指向 Unified，full 额外加 fakenews。
 */
export const HOSTS_SOURCES: Record<Exclude<AdFilterLevel, "off">, string> = {
  ads: "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts",
  "ads+tracking": "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts",
  full: "https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/fakenews/hosts",
  "ads+porn": "https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/porn/hosts",
};

export interface DomainFilter {
  enabled: boolean;
  blocked: Set<string>;
  allowlist: Set<string>;
  count: number;
}

/**
 * 解析 StevenBlack hosts 文本 → 域名集合（小写）。
 * hosts 每行形如 `0.0.0.0 example.com`（可能带前导 `#` 注释）。
 */
export function parseHosts(text: string): Set<string> {
  const domains = new Set<string>();
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    // 格式: "0.0.0.0 domain" 或 "127.0.0.1 domain" 或 ":: domain"
    const m = /^\S+\s+([\w.-]+)/.exec(line);
    if (m && m[1].includes(".")) {
      domains.add(m[1].toLowerCase());
    }
  }
  return domains;
}

/** 从本地 hosts 文件加载域名集合。文件不存在返回空 Set。 */
export function loadHostsFile(path: string): Set<string> {
  if (!existsSync(path)) return new Set();
  const text = readFileSync(path, "utf-8");
  return parseHosts(text);
}

/**
 * 域名是否命中黑名单（含子域匹配：a.b.example.com 命中 example.com 即算）。
 * allowlist 优先：命中 allowlist 的域名永不屏蔽。
 */
export function isBlocked(
  hostname: string,
  blocked: Set<string>,
  allowlist: Set<string>,
): boolean {
  const host = hostname.toLowerCase();
  if (allowlist.has(host)) return false;
  let cur = host;
  for (;;) {
    if (blocked.has(cur)) {
      return !allowlist.has(cur);
    }
    const dot = cur.indexOf(".");
    if (dot < 0 || dot === cur.length - 1) return false;
    cur = cur.slice(dot + 1);
  }
}

/** 构建一个 DomainFilter（含 extra_domains 合并 + allowlist）。 */
export function buildDomainFilter(
  enabled: boolean,
  level: AdFilterLevel,
  extraDomains: string[],
  hostsFile: string,
  allowlist: string[],
): DomainFilter {
  if (!enabled || level === "off") {
    return { enabled: false, blocked: new Set(), allowlist: new Set(allowlist.map((d) => d.toLowerCase())), count: 0 };
  }
  const blocked = loadHostsFile(hostsFile);
  for (const d of extraDomains) {
    if (d) blocked.add(d.toLowerCase());
  }
  return {
    enabled: true,
    blocked,
    allowlist: new Set(allowlist.map((d) => d.toLowerCase())),
    count: blocked.size,
  };
}

/** 确保 hosts 文件目录存在。 */
export function ensureHostsDir(path: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
}
