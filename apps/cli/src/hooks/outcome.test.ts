import { describe, expect, it } from "vitest";

import { excerpt, MAX_HOOK_REASON_BYTES, writeHookOutcome } from "./outcome.js";
import type { HookOutcome } from "./outcome.js";

const sink = () => {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (l: string) => void out.push(l), stderr: (l: string) => void err.push(l) },
    out,
    err,
  };
};
const identity = (t: string): string => t;

describe("writeHookOutcome", () => {
  it.each([
    [{ kind: "allow" }, 0, [], []],
    [{ kind: "context", text: "ctx" }, 0, ["ctx"], []],
    [{ kind: "block", ruleId: "pipe-to-shell", detail: "curl x | sh" }, 2, [], ["developer-os pipe-to-shell: curl x | sh"]],
    [{ kind: "advise", ruleId: "format-failed", detail: "exit 1" }, 2, [], ["developer-os format-failed: exit 1"]],
  ])("maps %j on Claude", (outcome, code, out, err) => {
    const s = sink();
    expect(writeHookOutcome(outcome as HookOutcome, "claude", s.io, identity)).toBe(code);
    expect(s.out).toStrictEqual(out);
    expect(s.err).toStrictEqual(err);
  });

  it("never writes an allow note to stdout", () => {
    const s = sink();
    expect(writeHookOutcome({ kind: "allow", note: "brain absent" }, "claude", s.io, identity)).toBe(0);
    expect(s.out).toStrictEqual([]);
    expect(s.err).toStrictEqual(["developer-os: brain absent"]);
  });

  it("caps a reason at 2 KiB after screening and redaction", () => {
    const s = sink();
    writeHookOutcome({ kind: "block", ruleId: "r", detail: "é".repeat(5000) }, "claude", s.io, identity);
    expect(s.err).toHaveLength(1);
    expect(new TextEncoder().encode(s.err[0]).byteLength).toBeLessThanOrEqual(MAX_HOOK_REASON_BYTES);
  });

  it("quotes at most 200 bytes of matched input", () => {
    expect(new TextEncoder().encode(excerpt("x".repeat(1000))).byteLength).toBeLessThanOrEqual(200);
  });

  it("passes context through the redactor and screen", () => {
    const s = sink();
    writeHookOutcome({ kind: "context", text: "secret\u001b[31m" }, "claude", s.io, () => "redacted\u001b[31m");
    expect(s.out.join("")).toContain("redacted");
    expect(s.out.join("")).not.toContain("secret");
    expect(s.out.join("")).not.toContain("\u001b");
  });

  it("keeps the line breaks of multi-line context", () => {
    const s = sink();
    writeHookOutcome({ kind: "context", text: "a\nb" }, "claude", s.io, identity);
    expect(s.out).toStrictEqual(["a\nb"]);
  });

  it("falls back to exit 0 with one stderr line while the Codex map is unobserved", () => {
    const s = sink();
    expect(writeHookOutcome({ kind: "block", ruleId: "r", detail: "d" }, "codex", s.io, identity)).toBe(0);
    expect(s.err).toHaveLength(1);
    expect(s.out).toStrictEqual([]);
  });
});
