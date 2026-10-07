import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { LauncherEnvironmentV1 } from "./environment.js";
import { execAdmittedRelease } from "./handoff.js";

describe("execAdmittedRelease", () => {
  const cliDist = fileURLToPath(new URL("../../cli/dist/", import.meta.url));
  const env = { HOME: tmpdir(), DEVELOPER_OS_HOME: join(tmpdir(), "developer-os-handoff") } as LauncherEnvironmentV1;

  it("hands the child no descriptor beyond stdio, neither FD 3 nor any other the launcher holds (NEW-112)", async () => {
    // Node opens its own files O_CLOEXEC, so the launcher must hold descriptors
    // without it: `sh` opens FD 3 and FD 7 and execs the launcher, which inherits them as is.
    const directory = await mkdtemp(join(tmpdir(), "developer-os-handoff-"));
    try {
      const held = join(directory, "held");
      await writeFile(held, "");
      const probe = join(directory, "probe.mjs");
      await writeFile(probe, [
        `import { fstatSync, statSync } from "node:fs";`,
        // Node's own startup descriptors reach past 7, so compare identity, not openness.
        `const inode = (fd) => { try { return fstatSync(fd).ino; } catch { return null; } };`,
        `const held = statSync(${JSON.stringify(held)}).ino;`,
        `process.exitCode = inode(7) === held ? 9 : inode(3) === held ? 10 : 0;`,
      ].join("\n"));
      const launcher = join(directory, "launcher.mjs");
      await writeFile(launcher, [
        `import { fstatSync } from "node:fs";`,
        `import { execAdmittedRelease } from ${JSON.stringify(new URL("../dist/handoff.js", import.meta.url).href)};`,
        `try { fstatSync(3); fstatSync(7); } catch { process.exit(8); }`,
        `const [probe, env] = process.argv.slice(2);`,
        `process.exitCode = await execAdmittedRelease({ executable: process.execPath, argv: [probe], env: JSON.parse(env) });`,
      ].join("\n"));

      const outcome = await new Promise<number | null>((resolve, reject) => {
        const child = spawn(
          "/bin/sh",
          ["-c", 'exec 3<"$1" 7<"$1"; exec "$0" "$2" "$3" "$4"', process.execPath, held, launcher, probe, JSON.stringify(env)],
          { stdio: "inherit" },
        );
        child.once("error", reject);
        child.once("close", resolve);
      });

      expect(outcome).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("mirrors a child killed by a signal as 128 plus the signal number", async () => {
    const outcome = await execAdmittedRelease(
      { executable: process.execPath as never, argv: ["-e", "process.kill(process.pid, 'SIGTERM')"], env },
    );

    expect(outcome).toBe(143);
  });

  it("the CLI dispatches a command with no launcher flag", async () => {
    const outcome = await execAdmittedRelease(
      { executable: process.execPath as never, argv: [join(cliDist, "bin.js"), "--version"], env },
    );

    expect(outcome).toBe(0);
  });
});
