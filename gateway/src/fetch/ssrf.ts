import { lookup } from "node:dns/promises";

const PRIVATE_CIDRS = [
  "127.0.0.0/8",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "169.254.0.0/16",
  "0.0.0.0/8",
  "100.64.0.0/10",
  "::1/128",
  "fc00::/7",
  "fe80::/10",
];

/** 默认豁免段：Clash/类似代理的 fake-ip 区间，连接后由 TUN 转发到真实出站，不触达内网。 */
export const DEFAULT_EXEMPT_CIDRS = [
  "198.18.0.0/15",
  "fdfe:dcba:9876::/64",
];

function ipToBigInt(ip: string): bigint | null {
  // 支持 IPv4 和 IPv6
  if (ip.includes(".") && !ip.includes(":")) {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
    return (
      (BigInt(parts[0]) << 24n) |
      (BigInt(parts[1]) << 16n) |
      (BigInt(parts[2]) << 8n) |
      BigInt(parts[3])
    );
  }
  if (ip.includes(":")) {
    const addr = ip.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
    const groups = addr.split("::");
    const left = groups[0] ? groups[0].split(":") : [];
    const right = groups.length > 1 && groups[1] ? groups[1].split(":") : [];
    const missing = 8 - left.length - right.length;
    if (missing < 0) return null;
    const full = [...left, ...Array(missing).fill("0"), ...right];
    if (full.length !== 8) return null;
    let n = 0n;
    for (const g of full) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      n = (n << 16n) | BigInt(parseInt(g, 16));
    }
    return n;
  }
  return null;
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [net, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  if (Number.isNaN(bits) || bits < 0 || bits > 128) return false;
  const addr = ipToBigInt(ip);
  const netAddr = ipToBigInt(net);
  if (addr === null || netAddr === null) return false;

  // 地址族一致性：IPv6 地址只跟 IPv6 网段比，IPv4 同理。
  // 否则 128 位 IPv6 数值与 32 位 IPv4 mask 跨族位运算会误命中
  // （实测公网 240d:c010::… 会撞上 0.0.0.0/8）。
  const ipIsV4 = ip.includes(".") && !ip.includes(":");
  const netIsV4 = net.includes(".") && !net.includes(":");
  if (ipIsV4 !== netIsV4) return false;

  const maxBits = netIsV4 ? 32 : 128;
  if (bits > maxBits) return false;

  const mask =
    bits === 0
      ? 0n
      : (BigInt("0xffffffffffffffffffffffffffffffff") << BigInt(maxBits - bits)) &
        BigInt(netIsV4 ? "0xffffffff" : "0xffffffffffffffffffffffffffffffff");
  return (addr & mask) === (netAddr & mask);
}

export function isPrivateIp(ip: string, exemptCidrs: string[] = []): boolean {
  const normalized = ip.replace(/^\[|\]$/g, "").split("%")[0];
  if (normalized === "::1") return true;
  // 命中豁免段视为非私有（如 Clash fake-ip）
  if (exemptCidrs.some((cidr) => ipInCidr(normalized, cidr))) return false;
  return PRIVATE_CIDRS.some((cidr) => ipInCidr(normalized, cidr));
}

/** 解析 hostname 的所有 A/AAAA 记录，任一为私网 IP 即视为私有（SSRF 防护）。 */
export async function isPrivateHost(
  hostname: string,
  opts: { exemptCidrs?: string[] } = {},
): Promise<boolean> {
  const exemptCidrs = opts.exemptCidrs ?? DEFAULT_EXEMPT_CIDRS;
  if (hostname === "localhost") return true;
  try {
    const records = await lookup(hostname, { all: true });
    return records.some((r) => isPrivateIp(r.address, exemptCidrs));
  } catch {
    // 解析失败：保守起见视为不可解析（由调用方决定）
    return false;
  }
}

export interface UrlCheckResult {
  ok: boolean;
  /** 拒绝原因：invalid_url | protocol | private_ip */
  reason?: "invalid_url" | "protocol" | "private_ip";
}

/**
 * 校验一个 http(s) URL 是否允许访问（协议 + 非内网）。
 * 供浏览器渲染 / FlareSolverr 等「独立解析并访问」的链路使用，
 * 与 directFetch 的 checkUrlAllowed 语义一致。
 * enabled=false 时仅做协议检查（对应配置 fetch.block_private_ips=false）。
 */
export async function assertPublicHttpUrl(
  urlStr: string,
  opts: { exemptCidrs: string[]; enabled: boolean },
): Promise<UrlCheckResult> {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "protocol" };
  }
  if (!opts.enabled) return { ok: true };
  let privateHost = false;
  try {
    privateHost = await isPrivateHost(url.hostname, { exemptCidrs: opts.exemptCidrs });
  } catch {
    /* 解析失败按非私有处理 */
  }
  if (privateHost) {
    return { ok: false, reason: "private_ip" };
  }
  return { ok: true };
}
