import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { HookPayloadV1 } from "../payload.js";
import type { HookRuntime } from "../registry.js";
import { guardEdit } from "./edit.js";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "developer-os-guard-edit-")));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map(async (dir) => {
      await chmod(join(dir, "locked"), 0o700).catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

async function project(): Promise<string> {
  const root = await tempDir();
  await mkdir(join(root, ".git"));
  return root;
}

function runtimeFor(cwd: string): HookRuntime {
  return {
    vendor: "claude",
    env: {},
    userHome: "/Users/synthetic",
    cwd,
    runner: { run: () => Promise.reject(new Error("edit spawned a process")) },
    nodeExecutable: "/synthetic/bin/node",
    now: () => new Date(0),
    io: {
      stdout: () => undefined,
      stderr: () => undefined,
      confirm: () => Promise.resolve(false),
      readStdin: () => Promise.resolve(null),
    },
    createContext: () => {
      throw new Error("a hook verb built a context");
    },
  };
}

function edited(filePath: string): HookPayloadV1 {
  return { cwd: null, toolName: "Edit", command: null, filePath, prompt: null, stopHookActive: null };
}

describe("guardEdit", () => {
  it("advises shared-file when a path inside the root resolves outside it", async () => {
    const outside = await tempDir();
    await writeFile(join(outside, "shared.md"), "shared\n");
    const root = await project();
    await symlink(join(outside, "shared.md"), join(root, "CLAUDE.md"));
    const outcome = await guardEdit(edited("CLAUDE.md"), runtimeFor(root));
    expect(outcome.kind).toBe("advise");
    expect(outcome.kind === "advise" ? outcome.ruleId : undefined).toBe("shared-file");
    expect(outcome.kind === "advise" ? outcome.detail : "").toContain("CLAUDE.md");
  });

  it("allows a plain file inside the root", async () => {
    const root = await project();
    await writeFile(join(root, "a.ts"), "export {};\n");
    expect(await guardEdit(edited(join(root, "a.ts")), runtimeFor(root))).toStrictEqual({ kind: "allow" });
  });

  it("allows a path outside the root", async () => {
    const outside = await tempDir();
    await writeFile(join(outside, "b.ts"), "export {};\n");
    const root = await project();
    expect(await guardEdit(edited(join(outside, "b.ts")), runtimeFor(root))).toStrictEqual({ kind: "allow" });
  });

  it("allows a missing file", async () => {
    const root = await project();
    expect(await guardEdit(edited("missing.ts"), runtimeFor(root))).toStrictEqual({ kind: "allow" });
  });

  it("never opens the file, so an unreadable path still resolves without failing", async () => {
    const root = await project();
    await writeFile(join(root, "secret.ts"), "export {};\n", { mode: 0o000 });
    await mkdir(join(root, "locked"));
    await writeFile(join(root, "locked", "c.ts"), "export {};\n");
    await chmod(join(root, "locked"), 0o000);
    for (const path of ["secret.ts", join("locked", "c.ts")]) {
      const outcome = await guardEdit(edited(path), runtimeFor(root));
      expect(["allow", "advise"]).toContain(outcome.kind);
    }
  });

  it("ignores a Read tool", async () => {
    const outside = await tempDir();
    await writeFile(join(outside, "shared.md"), "shared\n");
    const root = await project();
    await symlink(join(outside, "shared.md"), join(root, "CLAUDE.md"));
    expect(await guardEdit({ ...edited("CLAUDE.md"), toolName: "Read" }, runtimeFor(root))).toStrictEqual({
      kind: "allow",
    });
  });
});
