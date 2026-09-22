import { describe, expect, it } from "vitest";

import type { HookRuntime } from "../registry.js";
import { COMMIT_RULES, guardCommit } from "./commit.js";

const runtime: HookRuntime = {
  vendor: "claude",
  env: {},
  userHome: "/Users/synthetic",
  cwd: "/Users/synthetic/p",
  runner: { run: () => Promise.reject(new Error("no child in a commit guard test")) },
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

const run = (command: string | null, toolName = "Bash") =>
  guardCommit({ cwd: "/Users/synthetic/p", toolName, command, filePath: null, prompt: null, stopHookActive: null }, runtime);

const BLOCKS: readonly (readonly [string, string])[] = [
  ["hook-bypass", "git commit --no-verify -m x"],
  ["hook-bypass", "git commit -n -m x"],
  ["hook-bypass", "git push --no-verify"],
  ["hook-bypass", "git -C repo commit -n"],
  ["hook-bypass", "git commit -anm x"],
  ["hook-bypass", "npm test &&\ngit commit --no-verify"],
  ["hook-bypass", 'git commit -m "fix a; b" --no-verify'],
  ["hook-bypass", 'git commit -m "fix a && b" --no-verify'],
  ["hook-bypass", 'git commit -m "fix a | b" --no-verify'],
  ["hook-bypass", 'git commit -m "fix a & b" --no-verify'],
  ["hook-bypass", "git commit -m 'a; b' -n"],
  ["hook-bypass", 'git commit -m "" -n'],
  ["unterminated-quote", 'git commit -m "fix a; b --no-verify'],
  ["unterminated-quote", "git commit -m 'x -n"],
  ["force-push", "git push --force"],
  ["force-push", "git push -f origin main"],
  ["force-push", "git push origin +main"],
  ["force-push", "git -c color.ui=never push -uf origin main"],
];

const ALLOWS: readonly (readonly [string, string])[] = [
  ["force-push", "git push --force-with-lease"],
  ["force-push", "git push --force-if-includes --force-with-lease origin main"],
  ["force-push", "git push origin main"],
  ["hook-bypass", 'git commit -m "-n is fine"'],
  ["hook-bypass", "git commit -m -n"],
  ["hook-bypass", 'git commit -m "handle -n here"'],
  ["hook-bypass", "git commit -m 'skip --no-verify; later'"],
  ["hook-bypass", 'git commit -m "say \\"-n\\" twice"'],
  ["hook-bypass", "git commit -Skey -m x"],
  ["hook-bypass", "git commit -uno -m x"],
  ["hook-bypass", "git push -n origin main"],
  ["hook-bypass", "git status"],
  ["hook-bypass", "git log -- -n"],
  ["hook-bypass", "echo git commit -n"],
];

describe("guard commit", () => {
  it("has a block fixture and a near-miss allow fixture for every rule", () => {
    expect(COMMIT_RULES.length).toBeGreaterThan(0);
    for (const rule of COMMIT_RULES) {
      expect(BLOCKS.some(([id]) => id === rule.id)).toBe(true);
      expect(ALLOWS.some(([id]) => id === rule.id)).toBe(true);
    }
  });

  it.each(BLOCKS)("blocks %s: %j", async (ruleId, command) => {
    expect(await run(command)).toMatchObject({ kind: "block", ruleId });
  });

  it.each(ALLOWS)("allows a %s near miss: %j", async (_ruleId, command) => {
    expect(await run(command)).toStrictEqual({ kind: "allow" });
  });

  it("blocks a NUL in the command string", async () => {
    expect(await run("git status\0")).toMatchObject({ kind: "block", ruleId: "nul-byte" });
  });

  it("ignores a tool that is not the shell matcher", async () => {
    expect(await run(null, "Read")).toStrictEqual({ kind: "allow" });
  });

  it("blocks a shell call whose command field is missing (fail closed)", async () => {
    expect(await run(null)).toMatchObject({ kind: "block", ruleId: "payload-malformed" });
  });
});
