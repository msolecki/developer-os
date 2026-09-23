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

  describe("on Codex, from apply_patch headers", () => {
    const codex = (command: string, toolName = "apply_patch", cwd = project) =>
      guardPath(
        { cwd, toolName, command, filePath: null, prompt: null, stopHookActive: null },
        { ...runtime(home, cwd), vendor: "codex" },
      );
    const patch = (...lines: string[]): string => ["*** Begin Patch", ...lines, "*** End Patch", ""].join("\n");

    it("blocks a patch that names a protected path in any header", async () => {
      expect(await codex(patch("*** Add File: a.txt", "+x", "*** Add File: sub/.env", "+A=1"))).toMatchObject({
        kind: "block",
        ruleId: "protected-path",
      });
      expect(await codex(patch("*** Update File: a.txt", "*** Move to: .env.local", "@@", "-x", "+y"))).toMatchObject({
        kind: "block",
        ruleId: "protected-path",
      });
      expect(await codex(patch("*** Delete File: .env"))).toMatchObject({ kind: "block", ruleId: "protected-path" });
    });

    it("allows a patch of ordinary files", async () => {
      expect(await codex(patch("*** Add File: note.txt", "+synthetic"))).toStrictEqual({ kind: "allow" });
    });

    it("blocks a patch outside the observed grammar", async () => {
      expect(await codex(patch("*** Add File: /etc/hosts", "+x"))).toMatchObject({ kind: "block", ruleId: "patch-malformed" });
      expect(await codex("not a patch")).toMatchObject({ kind: "block", ruleId: "patch-malformed" });
    });

    it("blocks a header whose path ends in whitespace Codex trims away", async () => {
      expect(await codex(patch("*** Update File: .env\u0085", "@@", "-S=1", "+S=2"))).toMatchObject({
        kind: "block",
        ruleId: "patch-malformed",
      });
    });

    it("blocks a .env header hidden behind a leading space as a context line", async () => {
      expect(
        await codex(patch("*** Add File: new.txt", "+x", " *** Update File: .env", "@@", "-S=1", "+S=pwned")),
      ).toMatchObject({ kind: "block", ruleId: "patch-malformed" });
    });

    it("resolves a relative header against the session cwd, not the project root", async () => {
      await mkdir(join(home, ".aws"), { recursive: true });
      await symlink(join(home, ".aws"), join(project, "sub", "link"));
      expect(await codex(patch("*** Update File: link/config", "@@", "-x", "+y"), "apply_patch", join(project, "sub"))).toMatchObject({
        kind: "block",
        ruleId: "protected-path",
      });
    });

    it("ignores the Bash tool", async () => {
      expect(await codex("echo synthetic > .env", "Bash")).toStrictEqual({ kind: "allow" });
    });
  });
});
