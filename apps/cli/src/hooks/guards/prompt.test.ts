import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { HookPayloadV1 } from "../payload.js";
import type { HookRuntime } from "../registry.js";
import { guardPrompt, MAX_SKILL_RULES_BYTES, parseSkillRules } from "./prompt.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function project(rules?: string): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "developer-os-guard-prompt-")));
  dirs.push(root);
  await mkdir(join(root, ".git"));
  if (rules !== undefined) {
    await mkdir(join(root, ".developer-os"));
    await writeFile(join(root, ".developer-os", "skill-rules.json"), rules);
  }
  return root;
}

function runtimeFor(cwd: string): HookRuntime {
  return {
    vendor: "claude",
    env: {},
    userHome: "/Users/synthetic",
    cwd,
    runner: { run: () => Promise.reject(new Error("prompt spawned a process")) },
    nodeExecutable: "/synthetic/bin/node",
    redact: (text) => text,
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

function prompted(prompt: string): HookPayloadV1 {
  return { cwd: null, toolName: null, command: null, filePath: null, prompt, stopHookActive: null };
}

const rule = (skill: string, keywords: readonly string[]) => ({ skill, keywords });
const file = (rules: readonly unknown[]) => JSON.stringify({ schemaVersion: 1, rules });

describe("guardPrompt", () => {
  it("allows with no note when the rules file is absent", async () => {
    expect(await guardPrompt(prompted("please deploy"), runtimeFor(await project()))).toStrictEqual({
      kind: "allow",
    });
  });

  it("returns one context line after an NFC lowercase match", async () => {
    const root = await project(file([rule("deploy-app", ["Deploy"]), rule("unrelated", ["zebra"])]));
    expect(await guardPrompt(prompted("please DEPLOY now"), runtimeFor(root))).toStrictEqual({
      kind: "context",
      text: "developer-os: relevant skills: deploy-app",
    });
  });

  it("names at most 3 skills, in rule order and deduplicated", async () => {
    const root = await project(
      file([rule("a", ["x"]), rule("a", ["x"]), rule("b", ["x"]), rule("c", ["x"]), rule("d", ["x"])]),
    );
    const outcome = await guardPrompt(prompted("x"), runtimeFor(root));
    expect(outcome).toStrictEqual({ kind: "context", text: "developer-os: relevant skills: a, b, c" });
    expect(outcome.kind === "context" ? outcome.text.split("\n") : []).toHaveLength(1);
  });

  it.each([
    ["65,537 bytes", `${file([rule("a", ["x"])])}${" ".repeat(MAX_SKILL_RULES_BYTES + 1)}`.slice(0, MAX_SKILL_RULES_BYTES + 1)],
    ["a schema violation", JSON.stringify({ schemaVersion: 1, rules: [], extra: true })],
    ["201 rules", file(Array.from({ length: 201 }, () => rule("a", ["x"])))],
    ["21 keywords", file([rule("a", Array.from({ length: 21 }, () => "x"))])],
  ])("allows with a note naming the file for %s", async (_name, text) => {
    const root = await project(text);
    const outcome = await guardPrompt(prompted("x"), runtimeFor(root));
    expect(outcome.kind).toBe("allow");
    expect(outcome.kind === "allow" ? outcome.note : "").toContain(join(root, ".developer-os", "skill-rules.json"));
  });
});

describe("parseSkillRules", () => {
  it("accepts the documented shape and the bounds", () => {
    expect(parseSkillRules(file([rule("a", Array.from({ length: 20 }, () => "k".repeat(64)))]))).toHaveLength(1);
    expect(parseSkillRules(file(Array.from({ length: 200 }, () => rule("a", ["x"]))))).toHaveLength(200);
  });

  it.each([
    JSON.stringify({ schemaVersion: 2, rules: [] }),
    JSON.stringify({ rules: [] }),
    file([{ skill: "a", keywords: ["x"], extra: 1 }]),
    file([rule("Upper", ["x"])]),
    file([rule("a", [""])]),
    file([rule("a", ["k".repeat(65)])]),
    file([{ skill: "a", keywords: [1] }]),
    "[]",
    "{",
  ])("refuses %s", (text) => {
    expect(parseSkillRules(text)).toBeNull();
  });
});
