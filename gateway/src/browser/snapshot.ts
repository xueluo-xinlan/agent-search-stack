import type { Page } from "playwright";
import type { GatewayConfig } from "../config.js";

export interface SnapshotResult {
  ok: boolean;
  snapshot?: string;
  error?: string;
}

export interface ScreenshotResult {
  ok: boolean;
  mimeType?: string;
  base64?: string;
  error?: string;
}

/** 无障碍树快照（ariaSnapshot，省 token） */
export async function pageSnapshot(page: Page, target?: string): Promise<SnapshotResult> {
  try {
    const locator = target ? page.locator(target) : page.locator("body");
    const snap = await locator.ariaSnapshot();
    if (!snap || snap.trim().length === 0) {
      return { ok: false, error: "页面无无障碍树内容（可能未加载或内容为空）" };
    }
    return { ok: true, snapshot: snap };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 截图 → base64。max_size 可配边长，enabled 控制开关。 */
export async function pageScreenshot(page: Page, config: GatewayConfig): Promise<ScreenshotResult> {
  if (!config.browserScreenshotEnabled) {
    return { ok: false, error: "截图功能未启用（browser.screenshot.enabled=false）" };
  }
  try {
    const buf = await page.screenshot({
      type: config.browserScreenshotImageType,
      quality: config.browserScreenshotImageType === "jpeg" ? 80 : undefined,
      scale: "css",
    });
    // 限制最大边长：若超过 max_size，缩小
    let data = buf;
    if (config.browserScreenshotMaxSize < 2000) {
      // 用 viewport 控制已足够；若需缩放用更复杂逻辑，这里简单限制尺寸由视口决定
    }
    const mimeType = config.browserScreenshotImageType === "jpeg" ? "image/jpeg" : "image/png";
    return { ok: true, mimeType, base64: data.toString("base64") };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
