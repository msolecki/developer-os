import { describe, expect, it } from "vitest";

import { decodeHookPayload, editedPaths, MAX_HOOK_PAYLOAD_BYTES } from "./payload.js";

const TRANSCRIPT_FIELD = ["transcript", "path"].join("_");
const bytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
const bash = { cwd: "/Users/synthetic/p", tool_name: "Bash", tool_input: { command: "echo synthetic" } };

describe("decodeHookPayload", () => {
  it("reads only the allow-listed fields", () => {
    const decoded = decodeHookPayload(bytes({ ...bash, [TRANSCRIPT_FIELD]: "/x", extra: 1 }), "claude", "command");
    expect(decoded).toStrictEqual({
      ok: true,
      payload: {
        cwd: "/Users/synthetic/p",
        toolName: "Bash",
        command: "echo synthetic",
        filePath: null,
        prompt: null,
        stopHookActive: null,
      },
    });
  });

  it("hits the 1 MiB boundary exactly", () => {
    const pad = (n: number): Uint8Array => {
      const base = JSON.stringify({ ...bash, pad: "" });
      return new TextEncoder().encode(base.replace('"pad":""', `"pad":"${"a".repeat(n - base.length)}"`));
    };
    expect(pad(MAX_HOOK_PAYLOAD_BYTES).byteLength).toBe(MAX_HOOK_PAYLOAD_BYTES);
    expect(decodeHookPayload(pad(MAX_HOOK_PAYLOAD_BYTES), "claude", "command").ok).toBe(true);
    expect(decodeHookPayload(pad(MAX_HOOK_PAYLOAD_BYTES + 1), "claude", "command")).toStrictEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it.each([
    ["not_utf8", Uint8Array.of(0x7b, 0xff, 0x7d)],
    ["nul", new TextEncoder().encode('{"cwd":"a\u0000"}')],
    ["not_json", new TextEncoder().encode("{")],
    ["not_object", new TextEncoder().encode("[]")],
  ])("refuses %s", (reason, input) => {
    expect(decodeHookPayload(input, "claude", "command")).toStrictEqual({ ok: false, reason });
  });

  it("treats an absent stdin as malformed", () => {
    expect(decodeHookPayload(null, "claude", "stop")).toStrictEqual({ ok: false, reason: "absent" });
  });

  it("refuses a wrongly typed required field", () => {
    expect(decodeHookPayload(bytes({ ...bash, tool_input: { command: 7 } }), "claude", "command")).toStrictEqual({
      ok: false,
      reason: "field_type",
    });
    expect(decodeHookPayload(bytes({ cwd: "/a" }), "claude", "stop")).toStrictEqual({
      ok: false,
      reason: "field_type",
    });
  });

  it("refuses a non-boolean stop flag", () => {
    expect(decodeHookPayload(bytes({ cwd: "/a", stop_hook_active: "yes" }), "claude", "stop")).toStrictEqual({
      ok: false,
      reason: "field_type",
    });
  });

  it("decodes Codex with its observed spellings and never reads a file path field", () => {
    const patch = "*** Begin Patch\n*** Add File: note.txt\n+synthetic\n*** End Patch\n";
    const decoded = decodeHookPayload(
      bytes({ cwd: "/Users/synthetic/p", tool_name: "apply_patch", tool_input: { command: patch, file_path: "/x" } }),
      "codex",
      "path",
    );
    expect(decoded).toStrictEqual({
      ok: true,
      payload: { cwd: "/Users/synthetic/p", toolName: "apply_patch", command: patch, filePath: null, prompt: null, stopHookActive: null },
    });
    if (decoded.ok) expect(editedPaths(decoded.payload, "codex")).toStrictEqual(["note.txt"]);
  });

  it("reads Claude's file path as the one edited path", () => {
    const decoded = decodeHookPayload(
      bytes({ cwd: "/a", tool_name: "Write", tool_input: { file_path: "/a/b.txt" } }),
      "claude",
      "path",
    );
    expect(decoded.ok && editedPaths(decoded.payload, "claude")).toStrictEqual(["/a/b.txt"]);
  });
});
