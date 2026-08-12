import { describe, expect, it } from "vitest";
import type {
  ProcessRequest,
  ProcessResult,
  ProcessRunner,
} from "@developer-os/security";
import { DEFAULT_TIMEOUT_MS, invocationFromAgentPrompt, invokeCodex } from "./invoke.js";
import type { CodexInvocation } from "./invoke.js";

const installation = { executable: "/opt/synthetic/bin/codex", version: "0.147.0" } as const;

function invocation(overrides: Partial<CodexInvocation> = {}): CodexInvocation {
  return {
    prompt: "summarise the vault",
    workingRoot: "/synthetic/work",
    writeScopes: [],
    outputSchemaPath: "/synthetic/work/schema.json",
    timeoutMs: DEFAULT_TIMEOUT_MS,
    ...overrides,
  };
}

function runner(handler: (request: ProcessRequest) => Partial<ProcessResult>): ProcessRunner {
  return {
    run(request: ProcessRequest): Promise<ProcessResult> {
      return Promise.resolve({
        stdout: "{}",
        stderr: "",
        exitCode: 0,
        signal: null,
        timedOut: false,
        ...handler(request),
      });
    },
  };
}

function capturing(result: Partial<ProcessResult> = {}): {
  runner: ProcessRunner;
  seen: () => ProcessRequest | null;
} {
  let request: ProcessRequest | null = null;
  return {
    seen: () => request,
    runner: {
      run(incoming: ProcessRequest): Promise<ProcessResult> {
        request = incoming;
        return Promise.resolve({
          stdout: "{}",
          stderr: "",
          exitCode: 0,
          signal: null,
          timedOut: false,
          ...result,
        });
      },
    },
  };
}

describe("invocationFromAgentPrompt", () => {
  it("accepts a well-formed with block through the shared schema", () => {
    const built = invocationFromAgentPrompt(
      { prompt: "summarise", maxTurns: 3 },
      { workingRoot: "/synthetic/work", writeScopes: [], outputSchemaPath: "/synthetic/s.json" },
    );
    expect(built.ok).toBe(true);
  });

  it.each([
    { name: "an unknown key", args: { prompt: "x", executable: "/bin/sh" } },
    {
      name: "a prototype-polluting key",
      args: JSON.parse('{"prompt":"x","__proto__":{"a":1}}') as unknown,
    },
    { name: "a missing prompt", args: { maxTurns: 3 } },
    { name: "a non-object", args: "just a string" },
  ])("refuses $name, through the one schema both adapters use", ({ args }) => {
    const built = invocationFromAgentPrompt(args, {
      workingRoot: "/synthetic/work",
      writeScopes: [],
      outputSchemaPath: "/synthetic/s.json",
    });
    expect(built.ok).toBe(false);
  });

  it("applies the default timeout, since no with-block field can override it", () => {
    const built = invocationFromAgentPrompt(
      { prompt: "summarise" },
      { workingRoot: "/synthetic/work", writeScopes: [], outputSchemaPath: "/synthetic/s.json" },
    );
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.invocation.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
  });

  it("never echoes the rejected value, which reaches a log", () => {
    const built = invocationFromAgentPrompt(
      { prompt: "x", secret: "hunter2" },
      { workingRoot: "/synthetic/work", writeScopes: [], outputSchemaPath: "/synthetic/s.json" },
    );
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.detail).not.toContain("hunter2");
  });
});

describe("the three refused flags, and the sandbox that is never full access", () => {
  const hostile = [
    "--dangerously-bypass-approvals-and-sandbox",
    "--dangerously-bypass-hook-trust",
    "--ignore-user-config",
    "danger-full-access",
  ];

  it.each(hostile)("never constructs an argv containing %s", async (value) => {
    let seen: ProcessRequest | null = null;
    const result = await invokeCodex(
      installation,
      invocation({ prompt: value, writeScopes: [value] }),
      { runner: runner((request) => { seen = request; return {}; }) },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("refused");
    expect(((seen as ProcessRequest | null)?.args ?? []).join(" ")).not.toContain(value);
  });

  it("refuses a hostile write scope even with a benign prompt, before the runner is called", async () => {
    let called = false;
    const result = await invokeCodex(
      installation,
      invocation({ prompt: "summarise the vault", writeScopes: ["danger-full-access"] }),
      { runner: runner(() => { called = true; return {}; }) },
    );
    expect(result).toEqual({
      ok: false,
      reason: "refused",
      detail: "a write scope names a permission or bypass surface that is refused in a value position",
    });
    expect(called).toBe(false);
  });

  it("refuses a hostile workingRoot before spawning", async () => {
    let called = false;
    const result = await invokeCodex(
      installation,
      invocation({ workingRoot: "--dangerously-bypass-approvals-and-sandbox" }),
      { runner: runner(() => { called = true; return {}; }) },
    );
    expect(result).toEqual({
      ok: false,
      reason: "refused",
      detail: 'the working root may not begin with "-": it would be read as an option, not a value',
    });
    expect(called).toBe(false);
  });

  it("refuses a workingRoot naming a permission or bypass surface, with no leading dash to trip the positional rule first", async () => {
    let called = false;
    const result = await invokeCodex(
      installation,
      invocation({ workingRoot: "permission-cache" }),
      { runner: runner(() => { called = true; return {}; }) },
    );
    expect(result).toEqual({
      ok: false,
      reason: "refused",
      detail: "the working root names a permission or bypass surface that is refused in a value position",
    });
    expect(called).toBe(false);
  });

  it("refuses a hostile outputSchemaPath before spawning", async () => {
    let called = false;
    const result = await invokeCodex(
      installation,
      invocation({ outputSchemaPath: "--ignore-user-config" }),
      { runner: runner(() => { called = true; return {}; }) },
    );
    expect(result).toEqual({
      ok: false,
      reason: "refused",
      detail: 'the output schema path may not begin with "-": it would be read as an option, not a value',
    });
    expect(called).toBe(false);
  });

  it("refuses an outputSchemaPath naming a permission or bypass surface, with no leading dash to trip the positional rule first", async () => {
    let called = false;
    const result = await invokeCodex(
      installation,
      invocation({ outputSchemaPath: "danger-zone.json" }),
      { runner: runner(() => { called = true; return {}; }) },
    );
    expect(result).toEqual({
      ok: false,
      reason: "refused",
      detail: "the output schema path names a permission or bypass surface that is refused in a value position",
    });
    expect(called).toBe(false);
  });

  it("chooses the sandbox from the scope count, so full access is unreachable by argument", async () => {
    let seen: ProcessRequest | null = null;
    await invokeCodex(installation, invocation({ writeScopes: ["/synthetic/vault"] }), {
      runner: runner((request) => { seen = request; return {}; }),
    });
    const args = (seen as ProcessRequest | null)?.args ?? [];
    expect(args).toContain("workspace-write");
    expect(args).not.toContain("danger-full-access");
  });
});

describe("invokeCodex argv", () => {
  it("builds the full spec §7 argv, in order, with every fixed flag present", async () => {
    const { runner: capturingRunner, seen } = capturing();
    await invokeCodex(installation, invocation({ writeScopes: ["/synthetic/vault"] }), {
      runner: capturingRunner,
    });
    expect(seen()?.args).toEqual([
      "exec",
      "--json",
      "--output-schema",
      "/synthetic/work/schema.json",
      "-s",
      "workspace-write",
      "--add-dir",
      "/synthetic/vault",
      "--skip-git-repo-check",
      "-C",
      "/synthetic/work",
      "summarise the vault",
    ]);
  });

  it("uses read-only and adds no --add-dir when there are no write scopes", async () => {
    const { runner: capturingRunner, seen } = capturing();
    await invokeCodex(installation, invocation({ writeScopes: [] }), {
      runner: capturingRunner,
    });
    expect(seen()?.args).toContain("read-only");
    expect(seen()?.args).not.toContain("--add-dir");
    expect(seen()?.args).not.toContain("workspace-write");
  });

  it("hands the runner the host cwd, no stdin, no environment, and the invocation's own timeout", async () => {
    const { runner: capturingRunner, seen } = capturing();
    await invokeCodex(installation, invocation({ timeoutMs: 12_345 }), {
      runner: capturingRunner,
    });
    const request = seen();
    expect(request?.cwd).toBe(process.cwd());
    expect(request?.stdin).toBe("");
    expect(request?.env).toEqual({});
    expect(request?.timeoutMs).toBe(12_345);
  });
});

describe("invokeCodex failure identity", () => {
  it("reports a timeout as a timeout, never as malformed output", async () => {
    const result = await invokeCodex(installation, invocation(), {
      runner: runner(() => ({ timedOut: true, exitCode: null, stdout: "" })),
    });
    expect(result).toEqual({ ok: false, reason: "timeout" });
  });

  it("reports a signal death distinctly", async () => {
    const result = await invokeCodex(installation, invocation(), {
      runner: runner(() => ({ exitCode: null, signal: "SIGKILL" })),
    });
    expect(result).toEqual({ ok: false, reason: "signal", signal: "SIGKILL" });
  });

  it("reports a non-zero exit carrying the code", async () => {
    const result = await invokeCodex(installation, invocation(), {
      runner: runner(() => ({ exitCode: 3, stdout: "{}" })),
    });
    expect(result).toEqual({ ok: false, reason: "exit", exitCode: 3 });
  });

  it("reports unparseable stdout as malformed output", async () => {
    const result = await invokeCodex(installation, invocation(), {
      runner: runner(() => ({ exitCode: 0, stdout: "not json" })),
    });
    expect(result).toEqual({ ok: false, reason: "malformed-output" });
  });

  it("reports a spawn failure rather than throwing", async () => {
    const result = await invokeCodex(installation, invocation(), {
      runner: {
        run(): Promise<ProcessResult> {
          throw new Error("spawn failed");
        },
      },
    });
    expect(result).toEqual({ ok: false, reason: "spawn-failed" });
  });

  it("returns the parsed payload on success", async () => {
    const result = await invokeCodex(installation, invocation(), {
      runner: runner(() => ({ exitCode: 0, stdout: '{"result":"done"}' })),
    });
    expect(result).toEqual({ ok: true, payload: { result: "done" } });
  });

  it("reduces a multi-line JSONL stream to the last object", async () => {
    const stdout = [
      '{"type":"item.completed","item":{"id":"1"}}',
      '{"result":"done"}',
    ].join("\n");
    const result = await invokeCodex(installation, invocation(), {
      runner: runner(() => ({ exitCode: 0, stdout })),
    });
    expect(result).toEqual({ ok: true, payload: { result: "done" } });
  });

  it("yields the result even when it is preceded by other event types", async () => {
    const stdout = [
      '{"type":"session.created","session_id":"abc"}',
      '{"type":"item.completed","item":{"id":"1"}}',
      '{"type":"turn.completed","usage":{"tokens":10}}',
      '{"result":"final answer"}',
    ].join("\n");
    const result = await invokeCodex(installation, invocation(), {
      runner: runner(() => ({ exitCode: 0, stdout })),
    });
    expect(result).toEqual({ ok: true, payload: { result: "final answer" } });
  });

  it("ignores leading, trailing and interleaved blank lines", async () => {
    const stdout = '\n\n{"type":"session.created"}\n\n{"result":"done"}\n\n\n';
    const result = await invokeCodex(installation, invocation(), {
      runner: runner(() => ({ exitCode: 0, stdout })),
    });
    expect(result).toEqual({ ok: true, payload: { result: "done" } });
  });

  it("skips a trailing scalar line and keeps the real result, since a bare value is never the payload", async () => {
    const stdout = ['{"result":"final answer"}', "123"].join("\n");
    const result = await invokeCodex(installation, invocation(), {
      runner: runner(() => ({ exitCode: 0, stdout })),
    });
    expect(result).toEqual({ ok: true, payload: { result: "final answer" } });
  });

  it("reports malformed output when no line in the stream parses", async () => {
    const stdout = "not json\nalso not json\n";
    const result = await invokeCodex(installation, invocation(), {
      runner: runner(() => ({ exitCode: 0, stdout })),
    });
    expect(result).toEqual({ ok: false, reason: "malformed-output" });
  });

  it("still works against a single-object stdout, unchanged from before the JSONL reduction", async () => {
    const result = await invokeCodex(installation, invocation(), {
      runner: runner(() => ({ exitCode: 0, stdout: "{}" })),
    });
    expect(result).toEqual({ ok: true, payload: {} });
  });

  it("refuses a payload carrying a top-level __proto__ rather than returning it", async () => {
    const hostile = '{"result":"x","__proto__":{"polluted":true}}';
    const result = await invokeCodex(installation, invocation(), {
      runner: runner(() => ({ exitCode: 0, stdout: hostile })),
    });
    expect(result).toEqual({ ok: false, reason: "malformed-output" });
  });
});

describe("invokeCodex refuses before spawning", () => {
  it("refuses a non-absolute executable rather than spawning it", async () => {
    let seen: ProcessRequest | null = null;
    const result = await invokeCodex(
      { executable: "codex", version: "0.147.0" },
      invocation(),
      { runner: runner((request) => { seen = request; return {}; }) },
    );
    expect(result).toEqual({ ok: false, reason: "spawn-failed" });
    expect(seen).toBeNull();
  });
});
