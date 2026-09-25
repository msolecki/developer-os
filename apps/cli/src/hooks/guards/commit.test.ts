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
  redact: (text) => text,
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

// Spec §5.2 step 3 (amended, D62): a line break collapses to one LF, and an unquoted LF ends a segment.
describe("a command on its own line", () => {
  it.each([
    ["force-push", "cd repo\ngit push --force"],
    ["force-push", "cd repo\r\ngit push --force"],
    ["force-push", "cd repo\rgit push --force"],
    ["hook-bypass", "cd repo\ngit commit -n -m x"],
    ["hook-bypass", "cd repo\r\ngit commit -n -m x"],
  ])("blocks %s: %j", async (ruleId, command) => {
    expect(await run(command)).toMatchObject({ kind: "block", ruleId });
  });

  it("allows a line break inside a quoted message", async () => {
    expect(await run('git commit -m "subject\n\ngit push --force"')).toStrictEqual({ kind: "allow" });
  });
});

// Phase review N1: an apostrophe in a comment or a heredoc body opens no quote, and a `<<` in a
// comment arms no heredoc, so the command on the next line still splits off.
describe("a quote in a comment or a heredoc body", () => {
  it.each([
    "# Don't forget\ngit push --force\n# that's it",
    "cat <<EOF > notes.md\nDon't panic\nEOF\ngit push --force\necho done # that's all",
    "echo hi # <<EOF\ngit push --force\nEOF",
  ])("blocks force-push: %j", async (command) => {
    expect(await run(command)).toMatchObject({ kind: "block", ruleId: "force-push" });
  });

  it("allows an apostrophe in a heredoc body", async () => {
    expect(await run("cat <<EOF > f\nit's\nEOF\ngit status")).toStrictEqual({ kind: "allow" });
  });
});

// Phase review N2: a here-string `<<<` arms no heredoc.
it("blocks force-push after a here-string", async () => {
  expect(await run("grep x <<< EOF\ngit push --force\nEOF")).toMatchObject({ kind: "block", ruleId: "force-push" });
});

// Phase review minor 2: an arithmetic shift arms no heredoc.
it("blocks force-push after an arithmetic shift", async () => {
  expect(await run("(( x = 1 << 3 ))\ngit push --force\n3")).toMatchObject({ kind: "block", ruleId: "force-push" });
});

// Spec §5.2 step 2 joins every backslash–newline pair, where bash does not (residual in hooks.md §3.8).
describe("a backslash before a line break bash does not join", () => {
  it.todo("blocks force-push on the line after `echo` ending in two backslashes");
  it.todo("blocks force-push on the line after a comment ending in a backslash");
});

// Task 2 parity (founder): the rules read only a segment's first token, so a prefix hides the call.
describe("a prefixed git call (residual in hooks.md §3.8)", () => {
  it.todo("blocks force-push: env git push -f");
  it.todo("blocks force-push: FOO=1 git push -f");
  it.todo("blocks force-push: (git push -f)");
  it.todo("blocks hook-bypass: git -c core.hooksPath=/dev/null commit");
});
