import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

/**
 * The shape a real turn puts its response in, from
 * `tests/fixtures/codex/observed-exec-success-stream.jsonl`: the schema-
 * constrained JSON arrives as a **string** in the `text` of an `item.completed`
 * whose `item.type` is `agent_message`, and a `turn.completed` usage record
 * follows it.
 *
 * **Synthetic cases below wrap their payload with this rather than emitting a
 * bare JSON line, and that is a correction rather than a tidy-up.** Until
 * 2026-08-20 they emitted a bare `{"result":"done"}` as the last line, which no
 * observed run has ever produced — they were pinning the positional rule this
 * module used to apply, not a shape the vendor emits. NEW-21's two successful
 * turns are what falsified it.
 */
function agentMessageStream(payload: string, before: readonly string[] = []): string {
  return [
    ...before,
    JSON.stringify({
      type: "item.completed",
      item: { id: "item_0", type: "agent_message", text: payload },
    }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }),
  ].join("\n");
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
      { prompt: "summarise" },
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
    { name: "a missing prompt", args: {} },
    {
      name: "maxTurns, bounded under Claude and silently dropped under Codex",
      args: { prompt: "x", maxTurns: 3 },
    },
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

  /**
   * **The prompt is prose and is screened as prose** (BACKLOG NEW-12). It keeps
   * the positional rule — the case above still refuses every `-`-prefixed
   * prompt — and loses the word list, which cannot be reread as anything: the
   * terminal argument of this argv is a *capture body* under DOS-P6, and an
   * ordinary `EACCES` message names a permission.
   */
  it("invokes rather than refusing when the prompt is prose naming a permission", async () => {
    const { runner: capture, seen } = capturing({
      stdout: agentMessageStream('{"result":"done"}'),
    });
    const prompt = "npm ERR! EACCES: permission denied, open /usr/local/lib";

    const result = await invokeCodex(installation, invocation({ prompt }), {
      runner: capture,
    });

    expect(result).toEqual({ ok: true, payload: { result: "done" } });
    expect(seen()?.args).toContain(prompt);
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

  /**
   * **Inverted on 2026-08-17 (BACKLOG NEW-12), and this is the case the row was
   * opened for.** `workingRoot` is derived from the user's own `brainPath`, so
   * this refusal meant a vault at `~/Danger/DeveloperBrain` could never ingest
   * through `codex` — a permanent refusal of a directory the user named, under
   * a recovery line telling them to try again.
   *
   * The path is a plausible vault rather than the bare `permission-cache` it
   * used to be, so a reader can see whose string this is.
   */
  it("permits a workingRoot naming a word-list term, because it is the user's own vault path", async () => {
    const { runner: capturingRunner, seen } = capturing({ stdout: agentMessageStream("{}") });
    const result = await invokeCodex(
      installation,
      invocation({ workingRoot: "/synthetic/Danger/DeveloperBrain" }),
      { runner: capturingRunner },
    );
    expect(result).toEqual({ ok: true, payload: {} });
    /**
     * Asserted against argv rather than only against the absence of a refusal.
     * `not.toMatchObject({ reason: "refused" })` is satisfied by
     * `spawn-failed` and `malformed-output` too, so it would stay green if this
     * value stopped reaching the vendor for some entirely different reason.
     */
    expect(seen()?.args).toContain("/synthetic/Danger/DeveloperBrain");
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

  /**
   * **Inverted on 2026-08-17, and the inversion is the decision rather than a
   * convenience (BACKLOG NEW-12).** This case used to assert the refusal; it
   * asserts the acceptance now, because `outputSchemaPath` is a path this
   * product assembles — the product state root, plus a fixed
   * `schemas/<verb>.schema.json` tail. **Only the tail ships**: the prefix is
   * `DEVELOPER_OS_HOME` or the user's own home, so words the user chose are
   * certainly in it. What matters is that no party outside this process chose
   * the argument, which is what the word list needs in order to mean anything.
   * The refusal it pinned cost every ingest whose assembled path happened to
   * contain an ordinary English word.
   *
   * **The dash-rule case directly above is untouched and must stay green**: it
   * is the proof that the screen was narrowed rather than deleted, and the two
   * read as a pair on purpose.
   */
  it("permits an outputSchemaPath naming a word-list term, because this product assembled it", async () => {
    const { runner: capturingRunner, seen } = capturing({ stdout: agentMessageStream("{}") });
    const result = await invokeCodex(
      installation,
      invocation({ outputSchemaPath: "danger-zone.json" }),
      { runner: capturingRunner },
    );
    expect(result).toEqual({ ok: true, payload: {} });
    expect(seen()?.args).toContain("danger-zone.json");
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
  it("builds the full Codex architecture former §7 argv, in order, with every fixed flag present", async () => {
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
      runner: runner(() => ({ exitCode: 0, stdout: agentMessageStream('{"result":"done"}') })),
    });
    expect(result).toEqual({ ok: true, payload: { result: "done" } });
  });

  it("passes over a completed item that is not the agent's message", async () => {
    /**
     * The observed stream's first `item.completed` is a `command_execution`
     * with no `text` at all. A rule keyed on `item.completed` alone returns a
     * shell transcript here; the `item.type` test is what stops it.
     */
    const stdout = agentMessageStream('{"result":"done"}', [
      '{"type":"item.completed","item":{"id":"item_0","type":"command_execution","aggregated_output":"x"}}',
    ]);
    const result = await invokeCodex(installation, invocation(), {
      runner: runner(() => ({ exitCode: 0, stdout })),
    });
    expect(result).toEqual({ ok: true, payload: { result: "done" } });
  });

  it("passes over a later completed item that carries text but is not the agent's message", async () => {
    /**
     * **The `item.type` test is what this pins, and nothing pinned it before.**
     * The case above feeds a `command_execution` with no `text` field at all,
     * so `typeof message.text !== "string"` rejects it and the `item.type`
     * check never decides anything — deleting that check left the whole suite
     * green, which a fresh-context review caught on 2026-08-20.
     *
     * The input that makes it decide is an item that is **not** an
     * `agent_message`, **does** carry a `text` string, and arrives **after**
     * the response — which is the shape of a reasoning item. Under the
     * last-wins rule the guard is the only thing standing between that text
     * and the caller.
     *
     * Watched fail by deleting the `item.type` check: the assertion then
     * received `{ok: false, reason: "malformed-output"}`, because the
     * reasoning text is not JSON.
     */
    const stdout = [
      JSON.stringify({
        type: "item.completed",
        item: { id: "item_0", type: "agent_message", text: '{"result":"done"}' },
      }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "item_1", type: "reasoning", text: "Let me double-check that." },
      }),
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1 } }),
    ].join("\n");
    const result = await invokeCodex(installation, invocation(), {
      runner: runner(() => ({ exitCode: 0, stdout })),
    });
    expect(result).toEqual({ ok: true, payload: { result: "done" } });
  });

  it("yields the result even when it is preceded by other event types", async () => {
    const stdout = agentMessageStream('{"result":"final answer"}', [
      '{"type":"thread.started","thread_id":"abc"}',
      '{"type":"turn.started"}',
      '{"type":"item.started","item":{"id":"item_0","type":"agent_message"}}',
    ]);
    const result = await invokeCodex(installation, invocation(), {
      runner: runner(() => ({ exitCode: 0, stdout })),
    });
    expect(result).toEqual({ ok: true, payload: { result: "final answer" } });
  });

  it("ignores leading, trailing and interleaved blank lines", async () => {
    const stdout =
      '\n\n{"type":"thread.started"}\n\n' + agentMessageStream('{"result":"done"}') + "\n\n\n";
    const result = await invokeCodex(installation, invocation(), {
      runner: runner(() => ({ exitCode: 0, stdout })),
    });
    expect(result).toEqual({ ok: true, payload: { result: "done" } });
  });

  it("skips a trailing scalar line, which no rule keyed on an event shape can mistake for a payload", async () => {
    const stdout = agentMessageStream('{"result":"final answer"}') + "\n123";
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

  it("refuses a bare JSON object on stdout, which the positional rule used to accept", async () => {
    /**
     * **A narrowing, stated rather than discovered.** The superseded rule took
     * the last line that parsed, so a lone `{}` was a payload; keying on the
     * `agent_message` event means a stream carrying no such event yields `""`
     * and therefore `malformed-output`. Nothing observed emits a bare object —
     * a real turn always frames its response — so what is given up is a shape
     * that only ever existed in this file.
     */
    const result = await invokeCodex(installation, invocation(), {
      runner: runner(() => ({ exitCode: 0, stdout: "{}" })),
    });
    expect(result).toEqual({ ok: false, reason: "malformed-output" });
  });

  it("refuses a payload carrying a top-level __proto__ rather than returning it", async () => {
    const hostile = agentMessageStream('{"result":"x","__proto__":{"polluted":true}}');
    const result = await invokeCodex(installation, invocation(), {
      runner: runner(() => ({ exitCode: 0, stdout: hostile })),
    });
    expect(result).toEqual({ ok: false, reason: "malformed-output" });
  });
});

/**
 * **The cases whose input is not invented**, and since 2026-08-20 the synthetic
 * ones above are built from what these recordings show rather than from a
 * guess.
 *
 * **The 2026-08-15 reading of the vocabulary was itself too strong, and this is
 * where that is corrected.** It said the three names this package had guessed —
 * `session.created`, `item.completed`, `turn.completed` — were all wrong,
 * because none appears in a failed turn. NEW-21's successful turns emit two of
 * them: `item.completed` and `turn.completed` are real, and only
 * `session.created` is not — the vendor calls it `thread.started`. A failed
 * turn was never a stream those two could have appeared in, so the conclusion
 * reached past its evidence.
 *
 * This recording is the **failed** turn: it settles the framing and the
 * discriminating field, and its terminal `turn.failed` is what the exit-code
 * ordering protects a caller from. See `tests/fixtures/codex/README.md` and the
 * Codex architecture former §14.1 amendments of both dates.
 */
describe("invokeCodex against the stream Task 17 actually observed", () => {
  const observed = readFileSync(
    fileURLToPath(
      new URL("../../../tests/fixtures/codex/observed-exec-stream.jsonl", import.meta.url),
    ),
    "utf8",
  );

  it("keeps a failed turn's exit identity instead of returning its terminal event as a payload", async () => {
    /**
     * **The ordering was already pinned; what this adds is why it matters.**
     * `"reports a non-zero exit carrying the code"` above goes red under the
     * same mutation, because its synthetic `"{}"` parses just as happily. So
     * this case is not the first guard on the ordering and does not claim to
     * be. It is the first to show, against bytes a real vendor emitted, what
     * the ordering is *protecting against*: the observed stream's last parsing
     * line is `turn.failed` — **not** a response — so a rule that reached the
     * parse at all would hand a caller a vendor error shaped like a result. A
     * synthetic `"{}"` cannot show that.
     *
     * **The correction of 2026-08-20 sharpened this case rather than retiring
     * it.** `finalAgentMessage` finds no `agent_message` in a failed stream and
     * returns `""`, so the wrong answer it would now produce is
     * `malformed-output` rather than a forged payload — still the wrong answer,
     * because `exit` is what tells a caller to retry.
     *
     * Watched fail on 2026-08-15 by moving `parseStructuredPayload(...)` above
     * the exit-code check: the assertion then received
     * `{ok: true, payload: {type: "turn.failed", …}}`.
     */
    const result = await invokeCodex(installation, invocation(), {
      runner: runner(() => ({ exitCode: 1, stdout: observed })),
    });
    expect(result).toEqual({ ok: false, reason: "exit", exitCode: 1 });
  });

  it("shows every line of a real stream to be a JSON object carrying a discriminating type", () => {
    /**
     * Knowledge-pipeline architecture note §10 asks two questions of a real run. This answers the second:
     * **yes, `type` is a discriminating field** and it is present on every
     * line. Nothing filtered on it until 2026-08-20, because a narrowing wanted
     * a stream where the old rule and the new one agreed; what arrived instead
     * was a stream on which the old rule was **wrong**, and `finalAgentMessage`
     * now selects on `type` and on `item.type`. Codex architecture former §14.1
     * carries both amendments.
     */
    const lines = observed.split(/\r?\n/u).filter((line) => line.trim().length > 0);
    expect(lines).toHaveLength(4);
    const types = lines.map((line) => {
      const parsed: unknown = JSON.parse(line);
      expect(typeof parsed).toBe("object");
      expect(parsed).not.toBeNull();
      return (parsed as { type?: unknown }).type;
    });
    expect(types).toEqual(["thread.started", "turn.started", "error", "turn.failed"]);
  });
});

/**
 * The success path, observed 2026-08-20 by NEW-21 and recorded at
 * `tests/fixtures/codex/observed-exec-success-stream.jsonl`. Everything above
 * this block was written against a turn that failed on an exhausted usage
 * limit, which is why the rule these cases replace stood unchallenged for the
 * eight days between 2026-08-12 and 2026-08-20: a failed turn emits no
 * response, so nothing could show where the response actually sits.
 */
describe("invokeCodex against the successful turn NEW-21 observed", () => {
  const observed = readFileSync(
    fileURLToPath(
      new URL(
        "../../../tests/fixtures/codex/observed-exec-success-stream.jsonl",
        import.meta.url,
      ),
    ),
    "utf8",
  );

  it("returns the agent's response rather than the usage record that follows it", async () => {
    const result = await invokeCodex(installation, invocation(), {
      runner: runner(() => ({ exitCode: 0, stdout: observed })),
    });
    expect(result).toEqual({
      ok: true,
      payload: {
        schemaVersion: 1,
        notes: [
          {
            path: "codex-env-probe.md",
            contents:
              "---\ntitle: codex env probe\n---\nCODEX_CI=1\nCODEX_SANDBOX=seatbelt\nCODEX_SANDBOX_NETWORK_DISABLED=1\nCODEX_THREAD_ID=00000000-0000-7000-0000-000000000001\n",
            sourceCaptureId: "00000000000000ff",
          },
        ],
      },
    });
  });

  it("passes over an earlier completed item that is not the agent's message", () => {
    /**
     * The observed stream carries two `item.completed` lines. The first is a
     * `command_execution` whose `item` has no `text` at all, so a rule that
     * took the first completed item, or any completed item, would return a
     * shell transcript. Selecting on `item.type` is what this fixture exists
     * to pin.
     */
    const lines = observed.split(/\r?\n/u).filter((line) => line.trim().length > 0);
    const itemTypes = lines
      .map((line) => JSON.parse(line) as { type?: unknown; item?: { type?: unknown } })
      .filter((event) => event.type === "item.completed")
      .map((event) => event.item?.type);
    expect(itemTypes).toEqual(["command_execution", "agent_message"]);
  });

  it("returns the same response from the other sandbox branch this package emits", async () => {
    /**
     * **`-s` is derived from `writeScopes.length`, so there are two argv
     * branches and a claim about one is not a claim about both.** The
     * `workspace-write` run of 2026-08-20 is recorded beside the `read-only`
     * one for that reason; the sentence "identical under both sandbox modes"
     * in `agent.ts` and in knowledge-pipeline architecture note §10 rests on this file rather than on
     * somebody's memory of a terminal.
     */
    const other = readFileSync(
      fileURLToPath(
        new URL(
          "../../../tests/fixtures/codex/observed-exec-workspace-write-stream.jsonl",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    const shape = (stream: string): unknown[] =>
      stream
        .split(/\r?\n/u)
        .filter((line) => line.trim().length > 0)
        .map((line) => {
          const event = JSON.parse(line) as { type?: unknown; item?: { type?: unknown } };
          return [event.type, event.item?.type];
        });
    expect(shape(other)).toEqual(shape(observed));

    const { runner: capture, seen } = capturing({ exitCode: 0, stdout: other });
    const result = await invokeCodex(
      installation,
      invocation({ writeScopes: ["/synthetic/scope"] }),
      { runner: capture },
    );
    expect(seen()?.args).toContain("workspace-write");
    expect(result).toEqual({
      ok: true,
      payload: {
        schemaVersion: 1,
        notes: [
          {
            path: "codex-env-probe.md",
            contents:
              "---\ntitle: codex env probe\n---\nCODEX_CI=1\nCODEX_SANDBOX=seatbelt\nCODEX_SANDBOX_NETWORK_DISABLED=1\nCODEX_THREAD_ID=00000000-0000-7000-0000-000000000003\n",
            sourceCaptureId: "00000000000000ff",
          },
        ],
      },
    });
  });

  it("agrees with what --output-last-message wrote for the same turn", async () => {
    /**
     * **The alternative that was tested and declined, kept as evidence rather
     * than as a sentence.** `codex-adapter.md` §7 and Codex architecture former §14.1 record that
     * `--output-last-message` works and was rejected for the vendor-written
     * temp file it introduces. This is the run that showed it.
     *
     * **What executes is a comparison of two committed files**, so it cannot
     * distinguish "the vendor wrote both" from "somebody copied one into the
     * other" — that provenance is asserted in the fixture README, not proved
     * here. What it does prove is that the two stay equal: if a later change to
     * the parsing rule made the stream yield something else, this goes red.
     */
    const stream = readFileSync(
      fileURLToPath(
        new URL(
          "../../../tests/fixtures/codex/observed-exec-last-message-stream.jsonl",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    const file = readFileSync(
      fileURLToPath(
        new URL("../../../tests/fixtures/codex/observed-exec-last-message.txt", import.meta.url),
      ),
      "utf8",
    );
    const result = await invokeCodex(installation, invocation(), {
      runner: runner(() => ({ exitCode: 0, stdout: stream })),
    });
    const written: unknown = JSON.parse(file.trim());
    expect(result).toEqual({ ok: true, payload: written });
  });

  it("shows the terminal event of a successful turn is not the response", () => {
    /**
     * This is the question knowledge-pipeline architecture note §10 put to a real run and that the failed
     * turn of 2026-08-15 could not answer. The answer is **no**: the last
     * line is `turn.completed`, a usage record. The rule that shipped until
     * 2026-08-20 took exactly this line, and `parseStructuredPayload` would
     * have returned it as `ok: true` — a caller told nothing failed, over a
     * payload that is vendor telemetry.
     */
    const lines = observed.split(/\r?\n/u).filter((line) => line.trim().length > 0);
    const types = lines.map((line) => (JSON.parse(line) as { type?: unknown }).type);
    expect(types).toEqual([
      "thread.started",
      "turn.started",
      "item.started",
      "item.completed",
      "item.completed",
      "turn.completed",
    ]);
    const terminal = JSON.parse(lines[lines.length - 1] ?? "") as { type?: unknown };
    expect(terminal.type).toBe("turn.completed");
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
