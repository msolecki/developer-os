import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { HookRuntime } from "../registry.js";
import { guardPath } from "./path.js";

let home: string;
let project: string;

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), "developer-os-guard-path-")));
  project = join(home, "p");
  await mkdir(join(project, ".git"), { recursive: true });
  await mkdir(join(project, "sub"), { recursive: true });
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function runtime(userHome: string | null, cwd = project): HookRuntime {
  return {
    vendor: "claude",
    env: {},
    userHome,
    cwd,
    runner: { run: () => Promise.reject(new Error("no child in a path guard test")) },
    nodeExecutable: "/synthetic/node",
    now: () => new Date(0),
    io: {
      stdout: () => undefined,
      stderr: () => undefined,
      confirm: () => Promise.resolve(false),
      readStdin: () => Promise.resolve(null),
    },
    createContext: () => {
      throw new Error("guards build no context");
    },
  };
}

const run = (filePath: string | null, toolName = "Edit", userHome: string | null = home, cwd = project) =>
  guardPath({ cwd, toolName, command: null, filePath, prompt: null, stopHookActive: null }, runtime(userHome, cwd));

describe("guard path", () => {
  it("blocks every protected path, relative ones resolved against the project root (G7)", async () => {
    const blocked = [
      ".env",
      ".env.local",
      join(home, ".ssh", "id_ed25519"),
      join(home, ".claude", ".credentials.json"),
      join(home, ".aws", "config"),
      "sub/.env",
    ];
    expect(blocked.length).toBeGreaterThan(0);
    for (const filePath of blocked) {
      expect(await run(filePath)).toMatchObject({ kind: "block", ruleId: "protected-path" });
    }
  });

  it("resolves a relative path from a subdirectory cwd against the project root", async () => {
    expect(await run("sub/.env", "Write", home, join(project, "sub"))).toMatchObject({
      kind: "block",
      ruleId: "protected-path",
    });
  });

  it("blocks a project symlink named .env even though it resolves to an ordinary file", async () => {
    await writeFile(join(project, "plain.txt"), "synthetic\n");
    await symlink(join(project, "plain.txt"), join(project, ".env"));
    expect(await run(".env", "Write")).toMatchObject({ kind: "block", ruleId: "protected-path" });
  });

  it("allows an ordinary source file", async () => {
    expect(await run("src/index.ts")).toStrictEqual({ kind: "allow" });
    expect(await run("src/index.ts", "MultiEdit")).toStrictEqual({ kind: "allow" });
  });

  it("ignores a tool that is not a file matcher", async () => {
    expect(await run(".env", "Read")).toStrictEqual({ kind: "allow" });
  });

  it("blocks a file tool whose path field is missing (fail closed)", async () => {
    expect(await run(null)).toMatchObject({ kind: "block", ruleId: "payload-malformed" });
  });

  it("blocks when the user home is unknown (fail closed)", async () => {
    expect(await run("src/index.ts", "Edit", null)).toMatchObject({ kind: "block", ruleId: "hook-failed-closed" });
  });
});
