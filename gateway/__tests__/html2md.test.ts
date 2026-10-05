import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "../src/fetch/html2md.js";

describe("htmlToMarkdown", () => {
  it("提取 title", () => {
    const r = htmlToMarkdown("<html><head><title>  Page Title </title></head><body><p>hi</p></body></html>", {
      structural: "clean",
      baseUrl: "https://example.com",
      maxOutputChars: 10000,
    });
    expect(r.title).toBe("Page Title");
  });

  it("clean 模式移除 nav/footer/script/style/广告容器", () => {
    const html = `
      <html><body>
        <nav>navigation</nav>
        <footer>footer</footer>
        <div class="ad-banner">ad</div>
        <script>evil()</script>
        <style>.x{}</style>
        <article><h1>Content</h1><p>real text</p></article>
      </body></html>`;
    const r = htmlToMarkdown(html, { structural: "clean", baseUrl: "https://e.com", maxOutputChars: 10000 });
    expect(r.markdown).not.toContain("navigation");
    expect(r.markdown).not.toContain("footer");
    expect(r.markdown).not.toContain("ad");
    expect(r.markdown).not.toContain("evil");
    expect(r.markdown).toContain("Content");
    expect(r.markdown).toContain("real text");
  });

  it("full 模式保留 nav/footer", () => {
    const html = `<html><body><nav>nav text</nav><p>body</p><footer>foot</footer></body></html>`;
    const r = htmlToMarkdown(html, { structural: "full", baseUrl: "https://e.com", maxOutputChars: 10000 });
    expect(r.markdown).toContain("nav text");
    expect(r.markdown).toContain("foot");
  });

  it("相对 URL 转绝对", () => {
    const html = `<html><body><a href="/about">about</a><img src="img.png"></body></html>`;
    const r = htmlToMarkdown(html, { structural: "clean", baseUrl: "https://example.com/docs/", maxOutputChars: 10000 });
    expect(r.markdown).toContain("https://example.com/about"); // 根相对 → 域根
    expect(r.markdown).toContain("https://example.com/docs/img.png"); // 相对 → 相对 base 目录
  });

  it("保留链接/代码块/标题层级", () => {
    const html = `<html><body><h1>H1</h1><pre><code>const x = 1</code></pre><a href="https://x.com">link</a></body></html>`;
    const r = htmlToMarkdown(html, { structural: "clean", baseUrl: "https://e.com", maxOutputChars: 10000 });
    expect(r.markdown).toContain("# H1");
    expect(r.markdown).toContain("```");
    expect(r.markdown).toContain("[link](https://x.com/)");
  });

  it("超长内容截断", () => {
    const long = "<html><body>" + "<p>word</p>".repeat(5000) + "</body></html>";
    const r = htmlToMarkdown(long, { structural: "clean", baseUrl: "https://e.com", maxOutputChars: 200 });
    expect(r.markdown.length).toBeLessThanOrEqual(220);
    expect(r.markdown).toContain("内容已截断");
  });
});
