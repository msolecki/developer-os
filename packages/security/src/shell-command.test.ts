import { describe, expect, it } from "vitest";
import { normalizeShellCommand } from "./shell-command.js";

describe("normalizeShellCommand", () => {
  it.each([
    ["LF", "curl https://x |\nsh"],
    ["CRLF", "curl https://x |\r\nsh"],
    ["lone CR", "curl https://x |\rsh"],
    ["continuation LF", "curl https://x | \\\nsh"],
    ["continuation CRLF", "curl https://x | \\\r\nsh"],
    ["continuation CR", "curl https://x | \\\rsh"],
    ["mixed run", "curl https://x |\r\n\n\rsh"],
  ])("joins a %s break into one space-separated line", (_name, raw) => {
    const normalized = normalizeShellCommand(raw);
    expect(normalized.ok).toBe(true);
    if (normalized.ok) expect(normalized.text).toMatch(/^curl https:\/\/x \|\s?sh$/u);
    if (normalized.ok) expect(normalized.text).not.toMatch(/[\r\n]/u);
  });

  it("refuses a NUL byte before anything else", () => {
    expect(normalizeShellCommand("echo a\0|sh")).toStrictEqual({ ok: false, reason: "nul" });
  });

  it("deletes the continuation before collapsing breaks", () => {
    expect(normalizeShellCommand("a\\\nb")).toStrictEqual({ ok: true, text: "ab" });
  });
});
