import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODES, gitScopeFingerprint, parseCanonicalAbsolutePathText, parseLowerHexSha1, serializeConfig } from "@developer-os/core";
import type { DeveloperOsConfigV1 } from "@developer-os/core";
import { validateShadowConfigTemplate } from "@developer-os/security";

import { failureFrom } from "../../context.js";
import { createCommandFixture, removeCommandFixtures } from "../testing.js";
import { DESTINATION_SHADOW_TEMPLATE, GIT_SHADOW_TEMPLATE_HASHES, SOURCE_LOCAL_SHADOW_TEMPLATE, createProductionGitRuntime } from "./runtime.js";
import { createGitService, GitCommandRefusal, gitScopeOf, parseGitUserIdentity } from "./service.js";
import { scriptedEffectPorts, scriptedGitRuntime } from "./testing.js";

const roots: string[] = [];

afterEach(async () => {
  await removeCommandFixtures();
  for (const root of roots.splice(0)) await nodeFs.rm(root, { recursive: true, force: true });
});

const CONFIG: DeveloperOsConfigV1 = {
  schemaVersion: 1,
  brainPath: "/synthetic-brain",
  adapters: { claude: false, codex: false },
  git: { enabled: false },
  automation: { enabled: false },
  telemetry: false,
};

async function looseObject(gitDirectory: string, type: string, content: string): Promise<string> {
  const raw = Buffer.concat([Buffer.from(`${type} ${String(Buffer.byteLength(content))}\0`), Buffer.from(content)]);
  const oid = createHash("sha1").update(raw).digest("hex");
  await nodeFs.mkdir(join(gitDirectory, "objects", oid.slice(0, 2)), { recursive: true });
  await nodeFs.writeFile(join(gitDirectory, "objects", oid.slice(0, 2), oid.slice(2)), deflateSync(raw));
  return oid;
}

describe("the Git scope the Brain configuration defines", () => {
  it("is the default Brain layout with its own fingerprint", () => {
    const scope = gitScopeOf(CONFIG);
    expect(scope.topicFolders.length).toBeGreaterThan(0);
    expect(scope).toMatchObject({ brainPath: "/synthetic-brain", contentRoot: "content", indexesDir: "_indexes" });
    const { fingerprint, ...fields } = scope;
    expect(fingerprint).toBe(gitScopeFingerprint(fields));
  });

  it("changes its fingerprint with every scope-changing field", () => {
    const base = gitScopeOf(CONFIG).fingerprint;
    const brain = { schemaVersion: 1 as const, contentRoot: "content", topicFolders: ["DEV"], topicAliases: {}, indexesDir: "_indexes", retrieval: { maxCandidates: 10 }, staleness: { reviewAfterDays: 180 } };
    expect(gitScopeOf({ ...CONFIG, brain }).fingerprint).not.toBe(base);
    expect(gitScopeOf({ ...CONFIG, brain: { ...brain, indexesDir: "_idx" } }).fingerprint).not.toBe(gitScopeOf({ ...CONFIG, brain }).fingerprint);
  });

  it("refuses a relative Brain path as a scope outside the repository", () => {
    expect(() => gitScopeOf({ ...CONFIG, brainPath: "relative/brain" })).toThrow(GitCommandRefusal);
  });
});

describe("GitCommandRefusal", () => {
  it("publishes its reason as the failure kind and keeps its exit code", async () => {
    const fixture = await createCommandFixture("git-refusal-kind");
    const result = failureFrom(fixture.context, new GitCommandRefusal("scope_reconcile_required", EXIT_CODES.recoveryRequired, ["/p"]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("scope_reconcile_required");
      expect(result.code).toBe(EXIT_CODES.recoveryRequired);
    }
  });
});

describe("the read-only commit reader", () => {
  it("reads a loose commit's tree and parents without spawning", async () => {
    const root = await nodeFs.realpath(await nodeFs.mkdtemp(join(tmpdir(), "developer-os-git-commit-")));
    roots.push(root);
    const git = join(root, ".git");
    const parent = "1".repeat(40);
    const tree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
    const commit = await looseObject(git, "commit", `tree ${tree}\nparent ${parent}\nauthor a <a@example.invalid> 1 +0000\ncommitter a <a@example.invalid> 1 +0000\n\nchore(brain): sync\n`);
    const runtime = createProductionGitRuntime();
    const gitDirectory = parseCanonicalAbsolutePathText(git);
    await expect(runtime.commitTree(gitDirectory, parseLowerHexSha1(commit))).resolves.toBe(tree);
    await expect(runtime.commitParents(gitDirectory, parseLowerHexSha1(commit))).resolves.toEqual([parent]);
  });

  it("refuses a commit that is not a loose object, and a blob named as a commit", async () => {
    const root = await nodeFs.realpath(await nodeFs.mkdtemp(join(tmpdir(), "developer-os-git-commit-")));
    roots.push(root);
    const git = join(root, ".git");
    const blob = await looseObject(git, "blob", "not a commit\n");
    const runtime = createProductionGitRuntime();
    const gitDirectory = parseCanonicalAbsolutePathText(git);
    await expect(runtime.commitTree(gitDirectory, parseLowerHexSha1("2".repeat(40)))).rejects.toThrow("git_commit_not_loose");
    await expect(runtime.commitTree(gitDirectory, parseLowerHexSha1(blob))).rejects.toThrow("git_object_corrupt");
  });
});

describe("the sanitized shadow templates", () => {
  it("are valid closed templates with stable hashes a retry can re-bind", () => {
    expect(validateShadowConfigTemplate(SOURCE_LOCAL_SHADOW_TEMPLATE)).toEqual(SOURCE_LOCAL_SHADOW_TEMPLATE);
    expect(validateShadowConfigTemplate(DESTINATION_SHADOW_TEMPLATE)).toEqual(DESTINATION_SHADOW_TEMPLATE);
    expect(GIT_SHADOW_TEMPLATE_HASHES.sourceLocal).toMatch(/^[0-9a-f]{64}$/u);
    expect(GIT_SHADOW_TEMPLATE_HASHES.destination).not.toBe(GIT_SHADOW_TEMPLATE_HASHES.sourceLocal);
  });
});

describe("the Git service on a home with no installation", () => {
  it.each(["status", "previewDisable"] as const)("%s refuses before any Git process", async (method) => {
    const runtime = scriptedGitRuntime();
    const fixture = await createCommandFixture(`git-uninstalled-${method}`, { effectPorts: scriptedEffectPorts(runtime, { on: false }) });
    await nodeFs.mkdir(fixture.paths.home, { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(fixture.paths.configFile, serializeConfig({ ...CONFIG, brainPath: fixture.paths.brain }));
    const lifecycle = fixture.context.lifecycle;
    if (lifecycle === undefined) throw new Error("the fixture composed no lifecycle context");
    await expect(createGitService(fixture.context, lifecycle)[method]()).rejects.toThrow();
    expect(runtime.spawns).toEqual([]);
    expect(runtime.networkCalls).toEqual([]);
  });
});

describe("the Brain repository's committer identity", () => {
  const read = (text: string): unknown => {
    try {
      return parseGitUserIdentity(text, "/synthetic-brain/.git");
    } catch (error) {
      return error instanceof GitCommandRefusal ? error.reason : error;
    }
  };

  it("reads a plain and a quoted [user] identity", () => {
    expect(read('[user]\n\tname = "Synthetic Tester"\n\temail = tester@example.invalid\n')).toStrictEqual({
      name: "Synthetic Tester",
      email: "tester@example.invalid",
    });
  });

  it.each([
    ["an inline # comment", "[user]\n\tname = Synthetic # note\n\temail = tester@example.invalid\n"],
    ["an inline ; comment", "[user]\n\tname = Synthetic\n\temail = tester@example.invalid ; note\n"],
    ["an escape", "[user]\n\tname = Synthetic\\tTester\n\temail = tester@example.invalid\n"],
    ["a line continuation", "[user]\n\tname = Synthetic \\\nTester\n\temail = tester@example.invalid\n"],
    ["a partly quoted value", '[user]\n\tname = "Synthetic" Tester\n\temail = tester@example.invalid\n'],
    ["an include", "[include]\n\tpath = identity.inc\n[user]\n\tname = Synthetic\n\temail = tester@example.invalid\n"],
    ["a conditional include", '[includeIf "gitdir:~/"]\n\tpath = identity.inc\n[user]\n\tname = Synthetic\n\temail = tester@example.invalid\n'],
  ])("refuses %s instead of guessing what Git reads", (_label, text) => {
    expect(read(text)).toBe("git_identity_unsupported");
  });
});
