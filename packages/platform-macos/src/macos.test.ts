import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { homedir, release, tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EXIT_CODES, resolveRuntimePaths } from "@developer-os/core";
import {
  redactText,
  type ProcessRequest,
  type ProcessResult,
  type ProcessRunner,
} from "@developer-os/security";

import type { AgentDiscovery, PlatformFacts } from "./types.js";
import {
  MacOsPlatformAdapter,
  type MacOsPlatformAdapterOptions,
  type MacOsPlatformEnvironment,
  MacOsPlatformDiscoveryError,
  MacOsPlatformInputError,
  MacOsPlatformUnsupportedError,
} from "./macos.js";

const REDACTION_KEY = new Uint8Array(32).fill(7);

const DARWIN_ENVIRONMENT: MacOsPlatformEnvironment = {
  platform: "darwin",
  architecture: "arm64",
  release: "25.5.0",
  userHome: "/Users/example",
};

function processResult(overrides: Partial<ProcessResult>): ProcessResult {
  return {
    stdout: "",
    stderr: "",
    exitCode: 0,
    signal: null,
    timedOut: false,
    ...overrides,
  };
}

class RecordingRunner implements ProcessRunner {
  readonly requests: ProcessRequest[] = [];

  readonly #reply: (request: ProcessRequest) => ProcessResult;

  constructor(reply: (request: ProcessRequest) => ProcessResult) {
    this.#reply = reply;
  }

  run(request: ProcessRequest): Promise<ProcessResult> {
    this.requests.push(request);
    return Promise.resolve(this.#reply(request));
  }
}

function runnerReturning(result: Partial<ProcessResult>): RecordingRunner {
  return new RecordingRunner(() => processResult(result));
}

function createAdapter(
  overrides: Partial<MacOsPlatformAdapterOptions> = {},
): MacOsPlatformAdapter {
  return new MacOsPlatformAdapter({
    environment: DARWIN_ENVIRONMENT,
    runner: runnerReturning({ exitCode: 1 }),
    searchPath: "/usr/bin:/bin",
    ...overrides,
  });
}

async function captureRejection(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
  } catch (error: unknown) {
    return error;
  }
  throw new Error("expected the operation to reject");
}

function captureThrow(operation: () => unknown): unknown {
  try {
    operation();
  } catch (error: unknown) {
    return error;
  }
  throw new Error("expected the operation to throw");
}

describe("MacOsPlatformAdapter.inspect", () => {
  it("reports Darwin facts for a supported architecture", async () => {
    const adapter = createAdapter();

    const facts: PlatformFacts = await adapter.inspect();

    expect(facts).toStrictEqual({
      platform: "darwin",
      architecture: "arm64",
      release: "25.5.0",
      userHome: "/Users/example",
    });
  });

  it("supports Intel Macs", async () => {
    const adapter = createAdapter({
      environment: { ...DARWIN_ENVIRONMENT, architecture: "x64" },
    });

    const facts = await adapter.inspect();

    expect(facts.architecture).toBe("x64");
  });

  it("refuses a non-Darwin platform with the capability-unavailable code", async () => {
    const adapter = createAdapter({
      environment: { ...DARWIN_ENVIRONMENT, platform: "linux" },
    });

    const error = await captureRejection(adapter.inspect());

    expect(error).toBeInstanceOf(MacOsPlatformUnsupportedError);
    expect((error as MacOsPlatformUnsupportedError).code).toBe(
      EXIT_CODES.capabilityUnavailable,
    );
  });

  it("refuses an unsupported architecture with the capability-unavailable code", async () => {
    const adapter = createAdapter({
      environment: { ...DARWIN_ENVIRONMENT, architecture: "ia32" },
    });

    const error = await captureRejection(adapter.inspect());

    expect(error).toBeInstanceOf(MacOsPlatformUnsupportedError);
    expect((error as MacOsPlatformUnsupportedError).code).toBe(
      EXIT_CODES.capabilityUnavailable,
    );
  });

  it("refuses an empty OS release", async () => {
    const adapter = createAdapter({
      environment: { ...DARWIN_ENVIRONMENT, release: "" },
    });

    const error = await captureRejection(adapter.inspect());

    expect(error).toBeInstanceOf(MacOsPlatformUnsupportedError);
  });

  it("canonicalizes a symlinked home directory", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "developer-os-platform-")),
    );
    const realHome = join(root, "real-home");
    const linkedHome = join(root, "linked-home");
    await mkdir(realHome);
    await symlink(realHome, linkedHome);

    try {
      const adapter = createAdapter({
        environment: { ...DARWIN_ENVIRONMENT, userHome: linkedHome },
      });

      const facts = await adapter.inspect();

      expect(facts.userHome).toBe(realHome);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a relative home directory as invalid input", async () => {
    const adapter = createAdapter({
      environment: { ...DARWIN_ENVIRONMENT, userHome: "relative/home" },
    });

    const error = await captureRejection(adapter.inspect());

    expect(error).toBeInstanceOf(MacOsPlatformInputError);
    expect((error as MacOsPlatformInputError).code).toBe(
      EXIT_CODES.invalidInput,
    );
  });

  it("refuses an upward-traversing home directory before canonicalizing", async () => {
    let canonicalized = false;
    const adapter = createAdapter({
      environment: { ...DARWIN_ENVIRONMENT, userHome: "/Users/example/.." },
      canonicalize: (path: string) => {
        canonicalized = true;
        return Promise.resolve(path);
      },
    });

    const error = await captureRejection(adapter.inspect());

    expect(error).toBeInstanceOf(MacOsPlatformInputError);
    expect(canonicalized).toBe(false);
  });

  it("refuses the filesystem root as a home directory", async () => {
    const adapter = createAdapter({
      environment: { ...DARWIN_ENVIRONMENT, userHome: "/" },
    });

    const error = await captureRejection(adapter.inspect());

    expect(error).toBeInstanceOf(MacOsPlatformInputError);
  });

  it.runIf(process.platform === "darwin")(
    "reads host facts when no environment is injected",
    async () => {
      const adapter = new MacOsPlatformAdapter({
        runner: runnerReturning({ exitCode: 1 }),
      });

      const facts = await adapter.inspect();

      expect(facts.architecture).toBe(process.arch);
      expect(facts.release).toBe(release());
      expect(facts.userHome).toBe(await realpath(homedir()));
    },
  );

  it.skipIf(process.platform === "darwin")(
    "refuses host facts on a non-Darwin host",
    async () => {
      const adapter = new MacOsPlatformAdapter({
        runner: runnerReturning({ exitCode: 1 }),
      });

      const error = await captureRejection(adapter.inspect());

      expect(error).toBeInstanceOf(MacOsPlatformUnsupportedError);
    },
  );

  it("starts no process", async () => {
    const runner = runnerReturning({ exitCode: 1 });
    const adapter = createAdapter({ runner });

    await adapter.inspect();

    expect(runner.requests).toStrictEqual([]);
  });
});

describe("MacOsPlatformAdapter.discoverExecutable", () => {
  it("locates an agent through /usr/bin/which", async () => {
    const runner = runnerReturning({
      exitCode: 0,
      stdout: "/opt/homebrew/bin/claude\n",
    });
    const adapter = createAdapter({ runner });

    const discovery: AgentDiscovery =
      await adapter.discoverExecutable("claude");

    expect(discovery).toStrictEqual({
      name: "claude",
      installed: true,
      executablePath: "/opt/homebrew/bin/claude",
      version: null,
    });
    expect(runner.requests).toHaveLength(1);
    expect(runner.requests[0]?.executable).toBe("/usr/bin/which");
    expect(runner.requests[0]?.args).toStrictEqual(["claude"]);
    expect(runner.requests[0]?.stdin).toBe("");
    expect(runner.requests[0]?.cwd).toBe("/");
    expect(runner.requests[0]?.timeoutMs).toBeGreaterThanOrEqual(1_000);
  });

  it("forwards only PATH to the discovery process", async () => {
    const runner = runnerReturning({ exitCode: 1 });
    const adapter = createAdapter({ runner, searchPath: "/opt/homebrew/bin" });

    await adapter.discoverExecutable("codex");

    expect(runner.requests[0]?.env).toStrictEqual({
      PATH: "/opt/homebrew/bin",
    });
  });

  it.runIf((process.env.PATH ?? "").length > 0)(
    "defaults the search path to the inherited PATH",
    async () => {
      const runner = runnerReturning({ exitCode: 1 });
      const adapter = new MacOsPlatformAdapter({
        environment: DARWIN_ENVIRONMENT,
        runner,
      });

      await adapter.discoverExecutable("claude");

      expect(runner.requests[0]?.env["PATH"]).toBe(process.env.PATH);
    },
  );

  it("falls back to a usable search path when PATH is empty", async () => {
    const runner = runnerReturning({ exitCode: 1 });
    const adapter = createAdapter({ runner, searchPath: "" });

    await adapter.discoverExecutable("claude");

    expect(runner.requests[0]?.env["PATH"]).toBe("/usr/bin:/bin:/usr/sbin:/sbin");
  });

  it("refuses discovery on an unsupported architecture", async () => {
    const runner = runnerReturning({ exitCode: 0 });
    const adapter = createAdapter({
      environment: { ...DARWIN_ENVIRONMENT, architecture: "ia32" },
      runner,
    });

    const error = await captureRejection(adapter.discoverExecutable("claude"));

    expect(error).toBeInstanceOf(MacOsPlatformUnsupportedError);
    expect(runner.requests).toStrictEqual([]);
  });

  it("reports a missing executable as data rather than an error", async () => {
    const adapter = createAdapter({
      runner: runnerReturning({ exitCode: 1, stdout: "" }),
    });

    const discovery = await adapter.discoverExecutable("codex");

    expect(discovery).toStrictEqual({
      name: "codex",
      installed: false,
      executablePath: null,
      version: null,
    });
  });

  it("reports empty output as a missing executable", async () => {
    const adapter = createAdapter({
      runner: runnerReturning({ exitCode: 0, stdout: "\n" }),
    });

    const discovery = await adapter.discoverExecutable("claude");

    expect(discovery.installed).toBe(false);
    expect(discovery.executablePath).toBeNull();
  });

  it("fails operationally on a relative discovery result", async () => {
    const adapter = createAdapter({
      runner: runnerReturning({ exitCode: 0, stdout: "bin/claude\n" }),
    });

    const error = await captureRejection(adapter.discoverExecutable("claude"));

    expect(error).toBeInstanceOf(MacOsPlatformDiscoveryError);
  });

  it("fails operationally on a multi-line discovery result", async () => {
    const adapter = createAdapter({
      runner: runnerReturning({
        exitCode: 0,
        stdout: "/opt/homebrew/bin/claude\n/usr/local/bin/claude\n",
      }),
    });

    const error = await captureRejection(adapter.discoverExecutable("claude"));

    expect(error).toBeInstanceOf(MacOsPlatformDiscoveryError);
  });

  it("fails operationally on a NUL-bearing discovery result", async () => {
    const adapter = createAdapter({
      runner: runnerReturning({ exitCode: 0, stdout: "/usr/local/bin/cl\0aude\n" }),
    });

    const error = await captureRejection(adapter.discoverExecutable("claude"));

    expect(error).toBeInstanceOf(MacOsPlatformDiscoveryError);
  });

  it("fails operationally on a control-character discovery result", async () => {
    const adapter = createAdapter({
      runner: runnerReturning({
        exitCode: 0,
        stdout: "/usr/local/bin/cl\u001baude\n",
      }),
    });

    const error = await captureRejection(adapter.discoverExecutable("claude"));

    expect(error).toBeInstanceOf(MacOsPlatformDiscoveryError);
  });

  it("never reports a redacted path as an installed executable", async () => {
    const redactedStdout = `${
      redactText("/Users/u/.cache/Qk3mZ9pLxV7wR2tYn4Bc8FdHj6Ks1AeU5Gv0/bin/claude", REDACTION_KEY).text
    }\n`;
    const adapter = createAdapter({
      runner: runnerReturning({ exitCode: 0, stdout: redactedStdout }),
    });

    expect(redactedStdout).toContain("[REDACTED:");

    const error = await captureRejection(adapter.discoverExecutable("claude"));

    expect(error).toBeInstanceOf(MacOsPlatformDiscoveryError);
  });

  it("fails operationally when discovery times out", async () => {
    const adapter = createAdapter({
      runner: runnerReturning({ exitCode: null, timedOut: true }),
    });

    const error = await captureRejection(adapter.discoverExecutable("claude"));

    expect(error).toBeInstanceOf(MacOsPlatformDiscoveryError);
    expect((error as MacOsPlatformDiscoveryError).code).toBe(
      EXIT_CODES.operationalFailure,
    );
  });

  it("fails operationally when discovery is killed by a signal", async () => {
    const adapter = createAdapter({
      runner: runnerReturning({ exitCode: null, signal: "SIGKILL" }),
    });

    const error = await captureRejection(adapter.discoverExecutable("claude"));

    expect(error).toBeInstanceOf(MacOsPlatformDiscoveryError);
  });

  it("refuses an unknown agent name", async () => {
    const runner = runnerReturning({ exitCode: 0 });
    const adapter = createAdapter({ runner });

    const error = await captureRejection(
      adapter.discoverExecutable("launchctl" as "claude"),
    );

    expect(error).toBeInstanceOf(MacOsPlatformInputError);
    expect((error as MacOsPlatformInputError).code).toBe(
      EXIT_CODES.invalidInput,
    );
    expect(runner.requests).toStrictEqual([]);
  });

  it("refuses a search path containing a NUL byte", async () => {
    const runner = runnerReturning({ exitCode: 0 });
    const adapter = createAdapter({ runner, searchPath: "/usr/bin\0/bin" });

    const error = await captureRejection(adapter.discoverExecutable("claude"));

    expect(error).toBeInstanceOf(MacOsPlatformInputError);
    expect(runner.requests).toStrictEqual([]);
  });

  it("refuses discovery on a non-Darwin platform", async () => {
    const runner = runnerReturning({ exitCode: 0 });
    const adapter = createAdapter({
      environment: { ...DARWIN_ENVIRONMENT, platform: "linux" },
      runner,
    });

    const error = await captureRejection(adapter.discoverExecutable("claude"));

    expect(error).toBeInstanceOf(MacOsPlatformUnsupportedError);
    expect(runner.requests).toStrictEqual([]);
  });

  it("runs no Keychain, scheduler, or discovered executable", async () => {
    const runner = runnerReturning({
      exitCode: 0,
      stdout: "/opt/homebrew/bin/claude\n",
    });
    const adapter = createAdapter({ runner });

    await adapter.discoverExecutable("claude");
    await adapter.discoverExecutable("codex");

    const executables = runner.requests.map((request) => request.executable);
    expect(executables).toStrictEqual(["/usr/bin/which", "/usr/bin/which"]);
    expect(
      runner.requests.every((request) => request.args.length === 1),
    ).toBe(true);
  });
});

describe("MacOsPlatformAdapter path defaults", () => {
  it("places product state below the user home", () => {
    const adapter = createAdapter();

    expect(adapter.productStateRoot("/Users/example")).toBe(
      "/Users/example/.developer-os",
    );
  });

  it("proposes a Brain root beside the product state", () => {
    const adapter = createAdapter();

    expect(adapter.proposedBrainRoot("/Users/example")).toBe(
      "/Users/example/DeveloperBrain",
    );
  });

  it("keeps the product state and the proposed Brain root distinct", () => {
    const adapter = createAdapter();

    expect(adapter.productStateRoot("/Users/example")).not.toBe(
      adapter.proposedBrainRoot("/Users/example"),
    );
  });

  it("agrees with the core runtime path resolver", () => {
    const adapter = createAdapter();
    const userHome = "/Users/example";
    const runtimePaths = resolveRuntimePaths({ HOME: userHome });

    expect(adapter.productStateRoot(userHome)).toBe(runtimePaths.home);
    expect(adapter.proposedBrainRoot(userHome)).toBe(runtimePaths.brain);
  });

  it("resolves path defaults without an architecture or release check", () => {
    const adapter = createAdapter({
      environment: { ...DARWIN_ENVIRONMENT, architecture: "ia32", release: "" },
    });

    expect(adapter.productStateRoot("/Users/example")).toBe(
      "/Users/example/.developer-os",
    );
  });

  it("refuses the filesystem root as a home", () => {
    const adapter = createAdapter();

    const error = captureThrow(() => adapter.proposedBrainRoot("/"));

    expect(error).toBeInstanceOf(MacOsPlatformInputError);
  });

  it("normalizes a trailing separator", () => {
    const adapter = createAdapter();

    expect(adapter.productStateRoot("/Users/example/")).toBe(
      "/Users/example/.developer-os",
    );
  });

  it("refuses a relative home", () => {
    const adapter = createAdapter();

    const error = captureThrow(() => adapter.productStateRoot("Users/example"));

    expect(error).toBeInstanceOf(MacOsPlatformInputError);
    expect((error as MacOsPlatformInputError).code).toBe(
      EXIT_CODES.invalidInput,
    );
  });

  it("refuses an upward-traversing home", () => {
    const adapter = createAdapter();

    const error = captureThrow(() =>
      adapter.proposedBrainRoot("/Users/example/.."),
    );

    expect(error).toBeInstanceOf(MacOsPlatformInputError);
  });

  it("refuses a NUL-bearing home", () => {
    const adapter = createAdapter();

    const error = captureThrow(() =>
      adapter.productStateRoot("/Users/exa\0mple"),
    );

    expect(error).toBeInstanceOf(MacOsPlatformInputError);
  });

  it("refuses path defaults on a non-Darwin platform", () => {
    const adapter = createAdapter({
      environment: { ...DARWIN_ENVIRONMENT, platform: "linux" },
    });

    const error = captureThrow(() => adapter.productStateRoot("/Users/example"));

    expect(error).toBeInstanceOf(MacOsPlatformUnsupportedError);
  });
});
