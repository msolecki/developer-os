import { access, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { EXIT_CODES } from "@developer-os/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RedactionResult } from "./redaction.js";
import {
  assertSafeCommand,
  NodeProcessRunner,
  type CommandPolicy,
  type ProcessRequest,
} from "./process.js";

const temporaryDirectories = new Set<string>();
const minimalEnvironment = { PATH: process.env.PATH ?? "" };

function createRequest(
  overrides: Partial<ProcessRequest>,
): ProcessRequest {
  return {
    executable: process.execPath,
    args: [],
    cwd: tmpdir(),
    stdin: "",
    timeoutMs: 1_000,
    env: minimalEnvironment,
    ...overrides,
  };
}

function identityRedaction(text: string): RedactionResult {
  return { text, findings: [] };
}

function allowCommandsPolicy(): CommandPolicy {
  return {
    assertCommand: (request) => {
      assertSafeCommand(request);
    },
    redact: identityRedaction,
  };
}

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), "developer-os-security-process-"),
  );
  temporaryDirectories.add(directory);
  return directory;
}

afterEach(async () => {
  const exactDirectories = [...temporaryDirectories];
  temporaryDirectories.clear();
  await Promise.all(
    exactDirectories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("assertSafeCommand", () => {
  it("normalizes line breaks before rejecting a shell-pipeline bypass", () => {
    const request = createRequest({
      executable: "/usr/bin/curl",
      args: ["https://example.invalid |\nsh"],
    });

    let refusal: unknown;
    try {
      assertSafeCommand(request);
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toMatchObject({ code: EXIT_CODES.securityRefusal });
  });

  const foreignPlatformExecutable = "C:\\tools\\curl.exe";
  it.skipIf(isAbsolute(foreignPlatformExecutable))(
    "rejects foreign-platform executable syntax that is not locally absolute",
    () => {
      expect(isAbsolute(foreignPlatformExecutable)).toBe(false);
      const request = createRequest({
        executable: foreignPlatformExecutable,
      });
      let refusal: unknown;

      try {
        assertSafeCommand(request);
      } catch (error) {
        refusal = error;
      }

      expect(refusal).toMatchObject({ code: EXIT_CODES.securityRefusal });
    },
  );

  const nul = "\u0000";

  it("refuses a NUL byte in the executable, by the executable's own message", () => {
    const request = createRequest({
      executable: `${process.execPath}${nul}`,
    });

    expect(() => {
      assertSafeCommand(request);
    }).toThrow(/absolute path without NUL bytes/u);
  });

  it("refuses a NUL byte in the working directory", () => {
    const request = createRequest({ cwd: `${tmpdir()}${nul}` });

    expect(() => {
      assertSafeCommand(request);
    }).toThrow(/request contains a NUL byte/u);
  });

  it("refuses a NUL byte in any argument, not only the first", () => {
    const request = createRequest({ args: ["--version", `value${nul}`] });

    expect(() => {
      assertSafeCommand(request);
    }).toThrow(/request contains a NUL byte/u);
  });

  it("refuses a NUL byte in stdin", () => {
    const request = createRequest({ stdin: `body${nul}` });

    expect(() => {
      assertSafeCommand(request);
    }).toThrow(/request contains a NUL byte/u);
  });
});

describe("NodeProcessRunner", () => {
  it("checks policy before execution and prevents a sentinel side effect", async () => {
    const temporaryDirectory = await makeTemporaryDirectory();
    const sentinel = join(temporaryDirectory, "must-not-exist");
    const refusal = Object.assign(new Error("synthetic security refusal"), {
      code: EXIT_CODES.securityRefusal,
    });
    const assertCommand = vi.fn(() => {
      throw refusal;
    });
    const policy: CommandPolicy = {
      assertCommand,
      redact: identityRedaction,
    };
    const runner = new NodeProcessRunner(policy);

    await expect(
      runner.run(
        createRequest({
          args: [
            "-e",
            'require("node:fs").writeFileSync(process.argv[1], "executed")',
            sentinel,
          ],
          cwd: temporaryDirectory,
        }),
      ),
    ).rejects.toMatchObject({ code: EXIT_CODES.securityRefusal });
    expect(assertCommand).toHaveBeenCalledTimes(1);
    await expect(access(sentinel)).rejects.toBeDefined();
  });

  it("keeps shell metacharacters as literal argv data", async () => {
    const runner = new NodeProcessRunner(allowCommandsPolicy());
    const argument = "value; echo injected";

    const result = await runner.run(createRequest({
      args: ["-e", "console.log(process.argv[1])", argument],
    }));

    expect(result).toMatchObject({
      stdout: `${argument}\n`,
      stderr: "",
      exitCode: 0,
      timedOut: false,
    });
  });

  it("honors injected cwd and stdin without a shell", async () => {
    const temporaryDirectory = await makeTemporaryDirectory();
    const canonicalWorkingDirectory = await realpath(temporaryDirectory);
    const runner = new NodeProcessRunner(allowCommandsPolicy());
    const stdin = "synthetic-input";

    const result = await runner.run(
      createRequest({
        args: [
          "-e",
          'let stdin = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (chunk) => { stdin += chunk; }); process.stdin.on("end", () => console.log(JSON.stringify({ cwd: process.cwd(), stdin })))',
        ],
        cwd: temporaryDirectory,
        stdin,
      }),
    );

    expect(result).toMatchObject({
      stdout: `${JSON.stringify({ cwd: canonicalWorkingDirectory, stdin })}\n`,
      stderr: "",
      exitCode: 0,
      timedOut: false,
    });
  });

  it("captures stdout, stderr, and a nonzero exit", async () => {
    const runner = new NodeProcessRunner(allowCommandsPolicy());

    const result = await runner.run(createRequest({
      args: [
        "-e",
        'process.stdout.write("synthetic-out"); process.stderr.write("synthetic-err"); process.exit(7)',
      ],
    }));

    expect(result).toMatchObject({
      stdout: "synthetic-out",
      stderr: "synthetic-err",
      exitCode: 7,
      timedOut: false,
    });
  });

  it("rejects stdout beyond the capture limit without reflecting emitted material", async () => {
    const runner = new NodeProcessRunner(allowCommandsPolicy());
    const syntheticUnit = "bounded-output-unit-q7z3";
    const captureLimitBytes = 1024 * 1024;
    const repetitions =
      Math.ceil(captureLimitBytes / Buffer.byteLength(syntheticUnit)) + 1;
    let refusal: unknown;

    try {
      await runner.run(
        createRequest({
          args: [
            "-e",
            `process.stdout.write(${JSON.stringify(syntheticUnit)}.repeat(${String(repetitions)}))`,
          ],
        }),
      );
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toMatchObject({ code: EXIT_CODES.securityRefusal });
    expect(String(refusal)).not.toContain(syntheticUnit);
    expect(JSON.stringify(refusal)).not.toContain(syntheticUnit);
  });

  it("terminates a process after its timeout without hanging", async () => {
    const runner = new NodeProcessRunner(allowCommandsPolicy());

    const result = await runner.run(createRequest({
      args: ["-e", "setTimeout(() => undefined, 10_000)"],
      timeoutMs: 50,
    }));

    expect(result.timedOut).toBe(true);
    expect(result.exitCode === null || result.exitCode !== 0).toBe(true);
  });

  it.runIf(process.platform === "darwin")(
    "terminates a descendant in the timed-out process group",
    async () => {
      const temporaryDirectory = await makeTemporaryDirectory();
      const sentinel = join(temporaryDirectory, "descendant-must-not-write");
      const runner = new NodeProcessRunner(allowCommandsPolicy());
      const grandchildScript =
        'setTimeout(() => require("node:fs").writeFileSync(process.argv[1], "synthetic-descendant-output"), 250)';
      const parentScript = [
        'const { spawn } = require("node:child_process")',
        `spawn(process.argv[1], ["-e", ${JSON.stringify(grandchildScript)}, process.argv[2]], { detached: false, env: JSON.parse(process.argv[3]), shell: false, stdio: "ignore" })`,
        "setTimeout(() => undefined, 10_000)",
      ].join("; ");

      const result = await runner.run(
        createRequest({
          args: [
            "-e",
            parentScript,
            process.execPath,
            sentinel,
            JSON.stringify(minimalEnvironment),
          ],
          cwd: temporaryDirectory,
          timeoutMs: 75,
        }),
      );

      expect(result.timedOut).toBe(true);
      await new Promise<void>((resolveWait) => {
        setTimeout(resolveWait, 350);
      });
      await expect(access(sentinel)).rejects.toBeDefined();
    },
  );

  it("redacts captured stdout and stderr through the injected policy", async () => {
    const syntheticSecret = "synthetic-process-secret-7xQ9";
    const policy: CommandPolicy = {
      assertCommand: (request) => {
        assertSafeCommand(request);
      },
      redact: (text) => ({
        text: text.replaceAll(syntheticSecret, "[REDACTED:test]"),
        findings: text.includes(syntheticSecret)
          ? [{ class: "test", fingerprint: "0123456789abcdef" }]
          : [],
      }),
    };
    const runner = new NodeProcessRunner(policy);

    const result = await runner.run(createRequest({
      args: [
        "-e",
        `process.stdout.write(${JSON.stringify(syntheticSecret)}); process.stderr.write(${JSON.stringify(syntheticSecret)})`,
      ],
    }));

    expect(result.stdout).toContain("[REDACTED:test]");
    expect(result.stderr).toContain("[REDACTED:test]");
    expect(result.stdout).not.toContain(syntheticSecret);
    expect(result.stderr).not.toContain(syntheticSecret);
  });
});
