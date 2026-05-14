import { describe, it, expect, afterEach } from "vitest";

const ORIGINAL_ENV = process.env["CHROME_USER_DATA_DIR"];

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env["CHROME_USER_DATA_DIR"];
  } else {
    process.env["CHROME_USER_DATA_DIR"] = ORIGINAL_ENV;
  }
});

describe("BrowserExtractor", () => {
  it("CHROME_USER_DATA_DIR 未設定時は canHandle() が false を返す", async () => {
    delete process.env["CHROME_USER_DATA_DIR"];
    const { BrowserExtractor } = await import("../web/browser.js");
    const extractor = new BrowserExtractor();
    expect(extractor.canHandle("https://example.com")).toBe(false);
  });

  it("CHROME_USER_DATA_DIR 設定時は canHandle() が true を返す", async () => {
    process.env["CHROME_USER_DATA_DIR"] = "C:\\Users\\test\\AppData\\Local\\Google\\Chrome\\User Data";
    const { BrowserExtractor } = await import("../web/browser.js");
    const extractor = new BrowserExtractor({ userDataDir: "C:\\Users\\test\\AppData\\Local\\Google\\Chrome\\User Data" });
    expect(extractor.canHandle("https://example.com")).toBe(true);
  });

  it("X/Twitter URL は userDataDir 設定済みでも canHandle() が false を返す", async () => {
    const { BrowserExtractor } = await import("../web/browser.js");
    const extractor = new BrowserExtractor({ userDataDir: "C:\\Users\\test\\AppData\\Local\\Google\\Chrome\\User Data" });
    expect(extractor.canHandle("https://x.com/user/status/123")).toBe(false);
    expect(extractor.canHandle("https://twitter.com/user/status/123")).toBe(false);
    expect(extractor.canHandle("https://mobile.x.com/user/status/123")).toBe(false);
    expect(extractor.canHandle("https://mobile.twitter.com/user/status/123")).toBe(false);
    expect(extractor.canHandle("https://t.co/abc123")).toBe(false);
  });

  it("tier が 'browser' であること", async () => {
    const { BrowserExtractor } = await import("../web/browser.js");
    const extractor = new BrowserExtractor();
    expect(extractor.tier).toBe("browser");
  });

  it("HTTP URL は canHandle() が false を返す", async () => {
    const { BrowserExtractor } = await import("../web/browser.js");
    const extractor = new BrowserExtractor({ userDataDir: "C:\\Users\\test\\AppData\\Local\\Google\\Chrome\\User Data" });
    expect(extractor.canHandle("http://example.com")).toBe(false);
  });
});
