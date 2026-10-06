import { describe, expect, it } from "vitest";
import type {
  ProcessRequest,
  ProcessResult,
  ProcessRunner,
} from "@developer-os/security";
import { probeClaude } from "./probe.js";

function runner(
  handler: (request: ProcessRequest) => Partial<ProcessResult>,
): ProcessRunner {
  return {
    run(request: ProcessRequest): Promise<ProcessResult> {
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0,
        signal: null,
        timedOut: false,
        ...handler(request),
      });
    },
  };
}

const installation = { executable: "claude", version: "2.1.216" } as const;
const pluginDirectory = "/synthetic/plugin";

/** The shipped tree's shape: a manifest, a skill per workflow and the catalog agents. */
const skillsPresent = (): Promise<readonly string[]> =>
  Promise.resolve([
    ".claude-plugin/plugin.json",
    "skills/developer-os-shared/SKILL.md",
    "agents/code-reviewer.md",
  ]);

describe("probeClaude", () => {
  it("observes the validate-settled capabilities when validate succeeds", async () => {
    const seen = await probeClaude(installation, {
      runner: runner(() => ({ exitCode: 0, stdout: "OK" })),
      pluginDirectory,
      listPluginFiles: skillsPresent,
    });
    expect(seen.get("skills")).toBe("observed");
  });

  /**
   * `claude plugin validate` checks agent frontmatter, and the tree ships the
   * catalog agents under `agents/` (D87, NEW-186): a clean exit over a listed
   * `agents/*.md` observes `subagents`. A tree without one is `absent`, the
   * same non-empty-set rule `skills` follows.
   */
  it("observes subagents only when the validated tree holds an agent file", async () => {
    const seen = await probeClaude(installation, {
      runner: runner(() => ({ exitCode: 0, stdout: "OK" })),
      pluginDirectory,
      listPluginFiles: skillsPresent,
    });
    expect(seen.get("subagents")).toBe("observed");
    const agentless = await probeClaude(installation, {
      runner: runner(() => ({ exitCode: 0, stdout: "OK" })),
      pluginDirectory,
      listPluginFiles: () => Promise.resolve([".claude-plugin/plugin.json", "skills/x/SKILL.md"]),
    });
    expect(agentless.get("subagents")).toBe("absent");
  });

  /**
   * Hooks are observed only through firing records (`hooks.md` §3.6): a clean
   * exit code from `claude plugin validate` never settles `plugin_hooks`.
   * Found by fresh-context review, 2026-08-11.
   */
  it("settles nothing about plugin hooks", async () => {
    const seen = await probeClaude(installation, {
      runner: runner(() => ({ exitCode: 0, stdout: "OK" })),
      pluginDirectory,
      listPluginFiles: skillsPresent,
    });
    expect(seen.has("plugin_hooks")).toBe(false);
  });

  it("marks them absent when validate exits non-zero", async () => {
    const seen = await probeClaude(installation, {
      runner: runner(() => ({ exitCode: 1, stderr: "bad manifest" })),
      pluginDirectory,
      listPluginFiles: skillsPresent,
    });
    expect(seen.get("skills")).toBe("absent");
  });

  it("marks them unavailable when the runner throws", async () => {
    const seen = await probeClaude(installation, {
      runner: {
        run(): Promise<ProcessResult> {
          throw new Error("spawn failed");
        },
      },
      pluginDirectory,
      listPluginFiles: skillsPresent,
    });
    expect(seen.get("skills")).toBe("unavailable");
  });

  it("marks them unavailable when the runner rejects", async () => {
    const seen = await probeClaude(installation, {
      runner: {
        run(): Promise<ProcessResult> {
          return Promise.reject(new Error("spawn failed"));
        },
      },
      pluginDirectory,
      listPluginFiles: skillsPresent,
    });
    expect(seen.get("skills")).toBe("unavailable");
  });

  it("marks a timed-out probe unavailable, not absent", async () => {
    const seen = await probeClaude(installation, {
      runner: runner(() => ({ timedOut: true, exitCode: null })),
      pluginDirectory,
      listPluginFiles: skillsPresent,
    });
    expect(seen.get("skills")).toBe("unavailable");
  });

  /**
   * Named for what it checks. A signal death surfaces in `ProcessResult` as a
   * null exit code, and that null is what this asserts on — `probeClaude` never
   * reads `signal`. The earlier name claimed the signal was the cause, which
   * would have kept passing if signal handling were removed entirely.
   */
  it("marks a probe with no exit code unavailable, not absent", async () => {
    const seen = await probeClaude(installation, {
      runner: runner(() => ({ exitCode: null, signal: "SIGKILL" })),
      pluginDirectory,
      listPluginFiles: skillsPresent,
    });
    expect(seen.get("skills")).toBe("unavailable");
  });

  /**
   * Claude architecture former §6.1: a lifecycle surface is verified only when a hook is *observed to
   * fire*, and a `SessionEnd` hook cannot be made to fire without a real
   * session. `claude plugin validate` settles the manifest and frontmatter; it
   * settles no lifecycle event, and must never be read as if it did.
   */
  it("never records a lifecycle capability as observed", async () => {
    const seen = await probeClaude(installation, {
      runner: runner(() => ({ exitCode: 0 })),
      pluginDirectory,
      listPluginFiles: skillsPresent,
    });
    for (const lifecycle of [
      "session_start_injection",
      "session_end_capture",
      "pre_compact_backup",
    ]) {
      expect(seen.get(lifecycle), `${lifecycle} must not be observed`).not.toBe(
        "observed",
      );
    }
  });

  it("passes argv as an array and never through a shell", async () => {
    let request: ProcessRequest | null = null;
    await probeClaude(installation, {
      runner: runner((incoming) => {
        request = incoming;
        return { exitCode: 0 };
      }),
      pluginDirectory,
      listPluginFiles: skillsPresent,
    });
    const seen = request as ProcessRequest | null;
    expect(seen?.args).toEqual(["plugin", "validate", pluginDirectory]);
    expect(seen?.stdin).toBe("");
    expect(seen?.env).toEqual({});
  });

  it("reports a non-empty observation set, so a clean result means something", async () => {
    const seen = await probeClaude(installation, {
      runner: runner(() => ({ exitCode: 0 })),
      pluginDirectory,
      listPluginFiles: skillsPresent,
    });
    expect(seen.size).toBeGreaterThan(0);
  });
});
