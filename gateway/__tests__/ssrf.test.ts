import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({
  lookup: mocks.lookup,
}));

import { isPrivateHost, isPrivateIp } from "../src/fetch/ssrf.js";

describe("isPrivateIp", () => {
  const priv = [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.5.5",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.1.1",
    "::1",
    "fc00::1",
    "fe80::1",
  ];
  const pub = [
    "93.184.216.34",
    "8.8.8.8",
    "1.1.1.1",
    "172.32.0.1", // 172.32 不在 172.16/12 内
    "198.18.0.136",
    "2606:4700::6810:84e5",
  ];

  it("私有 IP 判定为私有", () => {
    for (const ip of priv) expect(isPrivateIp(ip), ip).toBe(true);
  });

  it("公网 IP 判定为非私有", () => {
    for (const ip of pub) expect(isPrivateIp(ip), ip).toBe(false);
  });

  it("命中豁免段判定为非私有（fake-ip v4）", () => {
    expect(isPrivateIp("198.18.0.136", ["198.18.0.0/15"])).toBe(false);
  });

  it("命中豁免段判定为非私有（fake-ip v6 ULA）", () => {
    expect(isPrivateIp("fdfe:dcba:9876::44", ["fdfe:dcba:9876::/64"])).toBe(false);
  });

  it("豁免段不影响其它私网段判定", () => {
    expect(isPrivateIp("192.168.1.1", ["198.18.0.0/15"])).toBe(true);
    expect(isPrivateIp("10.0.0.5", ["198.18.0.0/15"])).toBe(true);
  });

  it("自定义豁免段可放行指定私有段", () => {
    expect(isPrivateIp("10.0.0.5", ["10.0.0.0/24"])).toBe(false);
  });

  it("公网 IPv6（GUA）不误判为私有——跨地址族不比较", () => {
    // 知乎/APNIC、Wikimedia、HN、Facebook 的真实公网 IPv6：
    // 之前 128 位 IPv6 数值与 IPv4 段 0.0.0.0/8 跨族位运算误命中
    const gua = [
      "240d:c010:15c:1::178",
      "2001:df2:e500:ed1a::1",
      "2606:7100:1:67::26",
      "2a03:2880:f328:22:face:b00c:0:4420",
      "2606:4700::6810:84e5",
    ];
    for (const ip of gua) expect(isPrivateIp(ip), ip).toBe(false);
  });

  it("真 IPv6 私有段仍拦截（不因族检查放行）", () => {
    expect(isPrivateIp("fc00::1")).toBe(true); // ULA
    expect(isPrivateIp("fd12:3456:789a::1")).toBe(true); // ULA fd00::/8
    expect(isPrivateIp("fe80::1")).toBe(true); // link-local
    expect(isPrivateIp("::1")).toBe(true); // loopback
  });
});

describe("isPrivateHost", () => {
  beforeEach(() => {
    mocks.lookup.mockReset();
    mocks.lookup.mockImplementation(async (host: string) => {
      if (/^[\d.]+$/.test(host)) return [{ address: host, family: 4 }];
      return [];
    });
  });

  it("localhost 视为私有", async () => {
    expect(await isPrivateHost("localhost")).toBe(true);
  });

  it("IP 字面量主机判定", async () => {
    expect(await isPrivateHost("127.0.0.1")).toBe(true);
    expect(await isPrivateHost("8.8.8.8")).toBe(false);
  });

  it("域名解析出 fake-ip 时判定为非私有（默认豁免 Clash fake-ip 段）", async () => {
    mocks.lookup.mockResolvedValue([
      { address: "fdfe:dcba:9876::44", family: 6 },
      { address: "198.18.0.68", family: 4 },
    ]);
    expect(await isPrivateHost("github.com")).toBe(false);
  });

  it("域名解析出真实 ULA 时仍判定为私有", async () => {
    mocks.lookup.mockResolvedValue([{ address: "fc00::1", family: 6 }]);
    expect(await isPrivateHost("internal.example.com")).toBe(true);
  });

  it("域名解析出私网 IP 时判定为私有", async () => {
    mocks.lookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    expect(await isPrivateHost("intranet.example.com")).toBe(true);
  });
});
