/**
 * `git enable|disable|status|sync` on one shared real V2 home. The pinned Xcode Git never runs
 * here (Q5): a scripted `GitRuntimeV1` stands in for the quarantine rebuild and the local helper
 * graph, while every lifecycle participant — Foundation, manifest, both Git effects — is real.
 */
import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  EXIT_CODES,
  buildGitTree,
  encodeCanonicalJson,
  gitCommitObject,
  gitIndexBytes,
  gitIndexEntry,
  gitObject,
  gitTreeNodes,
  loadConfig,
  looseObjectBytes,
  looseObjectRelativePath,
  parseLifecycleActivationRecord,
  serializeConfig,
} from "@developer-os/core";
import type { CanonicalAbsolutePathV1, CanonicalJsonValue } from "@developer-os/core";
import { MacOsStableLockProvider } from "@developer-os/platform-macos";

import { createBootstrapEvidenceInspectionRequest } from "../../bootstrap/context.js";
import { inspectBootstrapEvidenceAdmission } from "../../bootstrap/report.js";
import { admitInstalledV2Home } from "../../lifecycle/admission.js";
import { lifecycleHomeKeyFromAdmission, residueFrom } from "../../lifecycle/context.js";
import { runBrain } from "../brain.js";
import { runConfig } from "../config.js";
import { runInit } from "../init.js";
import { manifestAdmissionFor } from "../../lifecycle/manifest-admission.js";
import { createCommandFixture, createLowEntropyFixtureRoot, REAL_FILESYSTEM_TIMEOUT_MS, removeCommandFixtures } from "../testing.js";
import type { CommandFixture } from "../testing.js";
import { runGit } from "./index.js";
import type { GitCommandDataV1 } from "./index.js";
import { gitScopeOf } from "./service.js";
import { createBareRemote, scriptedEffectPorts, scriptedGitRuntime } from "./testing.js";

afterAll(removeCommandFixtures);

const runtime = scriptedGitRuntime();
const rejectDestination = { on: false };

interface GitHomeFixtureV1 extends CommandFixture {
  readonly remote: string;
  readonly gitDirectory: string;
}

let shared: Promise<GitHomeFixtureV1> | null = null;

function sharedHome(): Promise<GitHomeFixtureV1> {
  shared ??= (async () => {
    const fixture = await createCommandFixture("git-v2", {
      root: await createLowEntropyFixtureRoot("git-v2"),
      bootstrapAvailable: true,
      effectPorts: scriptedEffectPorts(runtime, rejectDestination),
    });
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
    const result = await runInit(fixture.context, { dryRun: false, assumeYes: true });
    if (!result.ok) throw new Error(`fixture init failed: ${JSON.stringify(result)}`);
    const remote = await createBareRemote(join(fixture.root, "remote.git"));
    return { ...fixture, remote, gitDirectory: join(fixture.paths.brain, ".git") };
  })();
  return shared;
}

function note(title: string): string {
  return [
    "---",
    "schemaVersion: 1",
    `title: ${title}`,
    "type: knowledge-note",
    "created: 2026-01-01",
    "tags: [dev]",
    "summary: A synthetic note.",
    "stage: established",
    "author: human",
    "reviewed: 2026-07-01",
    "---",
    "",
    "Body.",
    "",
  ].join("\n");
}

async function writeNote(home: GitHomeFixtureV1, name: string): Promise<void> {
  const directory = join(home.paths.brain, "content", "DEV");
  await nodeFs.mkdir(directory, { recursive: true, mode: 0o700 });
  await nodeFs.writeFile(join(directory, `${name}.md`), note(name), { mode: 0o600 });
  const reindex = await runBrain(home.context, { subcommand: "reindex", query: null, limit: null, dryRun: false });
  expect(reindex.ok, JSON.stringify(reindex)).toBe(true);
}

function dataOf(result: Awaited<ReturnType<typeof runGit>>): GitCommandDataV1 {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.data;
}

function kindOf(result: Awaited<ReturnType<typeof runGit>>): string {
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.error.kind;
}

async function closureOf(home: GitHomeFixtureV1): Promise<string> {
  const lifecycle = home.context.lifecycle;
  if (lifecycle === undefined) throw new Error("the fixture composed no lifecycle context");
  const key = lifecycleHomeKeyFromAdmission(
    await admitInstalledV2Home({
      fs: lifecycle.fs,
      paths: home.paths,
      manifestAdmission: manifestAdmissionFor(home.paths, []),
      effectiveUid: lifecycle.effectiveUid,
    }),
    home.paths,
  );
  const residue = residueFrom(
    await inspectBootstrapEvidenceAdmission(
      createBootstrapEvidenceInspectionRequest({
        productHome: home.paths.home,
        stateDirectory: home.paths.stateDir,
        initialRoots: [home.paths.home, home.paths.stateDir, home.userHome],
      }),
    ),
  );
  return (await lifecycle.inspectLedger(key, residue)).closure.kind;
}

async function readOrNull(path: string): Promise<string | null> {
  return nodeFs.readFile(path, "utf8").catch(() => null);
}

describe("git on a real V2 home", () => {
  it(
    "is inert while disabled: status and sync spawn no Git and open no network",
    async () => {
      const home = await sharedHome();
      for (const subcommand of ["sync", "status"] as const) await runGit(home.context, { subcommand });
      expect(kindOf(await runGit(home.context, { subcommand: "sync" }))).toBe("git_disabled");
      expect(dataOf(await runGit(home.context, { subcommand: "status" }))).toMatchObject({ kind: "status", enabled: false, activation: "absent" });
      expect(runtime.spawns).toEqual([]);
      expect(runtime.networkCalls).toEqual([]);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "refuses with exit 6 while the global lock is held elsewhere, spawning no Git",
    async () => {
      const home = await sharedHome();
      const held = await new MacOsStableLockProvider().acquireExisting(join(home.paths.stateDir, ".lifecycle.lock") as CanonicalAbsolutePathV1);
      try {
        const result = await runGit(home.context, { subcommand: "sync" });
        expect(result.ok).toBe(false);
        expect(result.code).toBe(EXIT_CODES.recoveryRequired);
        expect(kindOf(result)).toBe("lifecycle_lock_busy");
        expect(runtime.spawns).toEqual([]);
      } finally {
        await held.release();
      }
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "keeps a forged config.toml lifecycle with no activation arm inert",
    async () => {
      const home = await sharedHome();
      const original = await nodeFs.readFile(home.paths.configFile, "utf8");
      const config = loadConfig(original);
      const url = `file://${home.remote}`;
      await nodeFs.writeFile(
        home.paths.configFile,
        serializeConfig({
          ...config,
          git: {
            enabled: true,
            lifecycle: {
              schemaVersion: 1,
              repositoryRoot: home.paths.brain as never,
              branch: "main" as never,
              remote: { name: "developer-os", transport: "local", declaredUrl: url as never, effectivePushUrl: url as never },
              scope: gitScopeOf(config),
            },
          },
        }),
      );
      try {
        expect(kindOf(await runGit(home.context, { subcommand: "sync" }))).toBe("git_activation_unproven");
        expect(runtime.spawns).toEqual([]);
      } finally {
        await nodeFs.writeFile(home.paths.configFile, original);
      }
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "prints the same allocation-free enable preview twice",
    async () => {
      const home = await sharedHome();
      const allocator = join(home.paths.stateDir, "lifecycle-id-allocator.json");
      const staging = join(home.paths.stagingDir, "lifecycle");
      const allocatorBefore = await nodeFs.readFile(allocator);
      const stagingBefore = await nodeFs.readdir(staging).catch(() => [] as string[]);
      const request = { subcommand: "enable", remote: home.remote, branch: null, apply: false } as const;
      const first = await runGit(home.context, request);
      const second = await runGit(home.context, request);
      expect(encodeCanonicalJson(first as unknown as CanonicalJsonValue)).toBe(encodeCanonicalJson(second as unknown as CanonicalJsonValue));
      expect(dataOf(first)).toMatchObject({ kind: "preview", command: "git_enable" });
      expect(await nodeFs.readFile(allocator)).toEqual(allocatorBefore);
      expect(await nodeFs.readdir(staging).catch(() => [] as string[])).toEqual(stagingBefore);
      expect(await readOrNull(join(home.gitDirectory, "HEAD"))).toBeNull();
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "abandons the Git effect plan and staging when the coordinator plan fails to publish",
    async () => {
      const home = await sharedHome();
      const lifecycle = home.context.lifecycle;
      if (lifecycle === undefined) throw new Error("the fixture composed no lifecycle context");
      const effectJournals = join(home.paths.stateDir, "git-effect-journals");
      const effectPlansAtPublish: string[] = [];
      const failing = {
        ...home.context,
        lifecycle: {
          ...lifecycle,
          store: (key: Parameters<typeof lifecycle.store>[0]) => {
            const store = lifecycle.store(key);
            Object.defineProperty(store, "publish", {
              value: async () => {
                effectPlansAtPublish.push(...(await nodeFs.readdir(effectJournals)));
                throw new Error("injected coordinator plan publication failure");
              },
            });
            return store;
          },
        },
      };
      const failed = await runGit(failing, { subcommand: "enable", remote: home.remote, branch: null, apply: true });
      expect(failed.ok).toBe(false);
      expect(effectPlansAtPublish).toHaveLength(1);

      expect(await nodeFs.readdir(effectJournals)).toEqual([]);
      expect(await nodeFs.readdir(join(home.paths.stagingDir, "lifecycle"))).toEqual([]);
      await nodeFs.mkdir(join(home.paths.brain, "content"), { recursive: true, mode: 0o700 });
      const next = await runBrain(home.context, { subcommand: "reindex", query: null, limit: null, dryRun: false });
      expect(next.ok, JSON.stringify(next)).toBe(true);
      expect(await closureOf(home)).toBe("clear");
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "keeps the Git effect plan when abandoning its staging fails, so recovery still clears both",
    async () => {
      const home = await sharedHome();
      const lifecycle = home.context.lifecycle;
      if (lifecycle === undefined) throw new Error("the fixture composed no lifecycle context");
      const effectJournals = join(home.paths.stateDir, "git-effect-journals");
      const staging = join(home.paths.stagingDir, "lifecycle");
      const locked: string[] = [];
      /** A read-only effect directory makes the CLI's own staging removal fail with EACCES. */
      const failing = {
        ...home.context,
        lifecycle: {
          ...lifecycle,
          store: (key: Parameters<typeof lifecycle.store>[0]) => {
            const store = lifecycle.store(key);
            Object.defineProperty(store, "publish", {
              value: async () => {
                const [coordinator] = await nodeFs.readdir(staging);
                const source = join(staging, String(coordinator), "git", "source");
                const [effect] = await nodeFs.readdir(source);
                locked.push(join(source, String(effect)));
                await nodeFs.chmod(join(source, String(effect)), 0o500);
                throw new Error("injected coordinator plan publication failure");
              },
            });
            return store;
          },
        },
      };
      expect((await runGit(failing, { subcommand: "enable", remote: home.remote, branch: null, apply: true })).ok).toBe(false);
      const [dir] = locked;
      if (dir === undefined) throw new Error("the injected failure never ran");
      await nodeFs.chmod(dir, 0o700);
      expect(await nodeFs.readdir(effectJournals)).toHaveLength(1);

      await nodeFs.mkdir(join(home.paths.brain, "content"), { recursive: true, mode: 0o700 });
      const next = await runBrain(home.context, { subcommand: "reindex", query: null, limit: null, dryRun: false });
      expect(next.ok, JSON.stringify(next)).toBe(true);
      expect(await closureOf(home)).toBe("clear");
      expect(await nodeFs.readdir(effectJournals)).toEqual([]);
      expect(await nodeFs.readdir(staging)).toEqual([]);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "recovers the residue a death between the Git effect plan and the coordinator plan leaves",
    async () => {
      const home = await sharedHome();
      const lifecycle = home.context.lifecycle;
      if (lifecycle === undefined) throw new Error("the fixture composed no lifecycle context");
      const effectJournals = join(home.paths.stateDir, "git-effect-journals");
      const staging = join(home.paths.stagingDir, "lifecycle");
      const aside = join(home.root, "sigterm-residue");
      /** The failure path would clean up; moving the residue aside before it runs leaves what a SIGTERM leaves. */
      const failing = {
        ...home.context,
        lifecycle: {
          ...lifecycle,
          store: (key: Parameters<typeof lifecycle.store>[0]) => {
            const store = lifecycle.store(key);
            Object.defineProperty(store, "publish", {
              value: async () => {
                await nodeFs.mkdir(join(aside, "effects"), { recursive: true, mode: 0o700 });
                await nodeFs.mkdir(join(aside, "staging"), { recursive: true, mode: 0o700 });
                for (const name of await nodeFs.readdir(effectJournals)) await nodeFs.rename(join(effectJournals, name), join(aside, "effects", name));
                for (const name of await nodeFs.readdir(staging)) await nodeFs.rename(join(staging, name), join(aside, "staging", name));
                throw new Error("injected death before the coordinator plan");
              },
            });
            return store;
          },
        },
      };
      expect((await runGit(failing, { subcommand: "enable", remote: home.remote, branch: null, apply: true })).ok).toBe(false);
      for (const name of await nodeFs.readdir(join(aside, "effects"))) await nodeFs.rename(join(aside, "effects", name), join(effectJournals, name));
      for (const name of await nodeFs.readdir(join(aside, "staging"))) await nodeFs.rename(join(aside, "staging", name), join(staging, name));
      expect(await nodeFs.readdir(effectJournals)).toHaveLength(1);

      await nodeFs.mkdir(join(home.paths.brain, "content"), { recursive: true, mode: 0o700 });
      const next = await runBrain(home.context, { subcommand: "reindex", query: null, limit: null, dryRun: false });
      expect(next.ok, JSON.stringify(next)).toBe(true);
      expect(await closureOf(home)).toBe("clear");
      expect(await nodeFs.readdir(effectJournals)).toEqual([]);
      expect(await nodeFs.readdir(staging)).toEqual([]);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "enables against a local bare remote, publishing activation and manifest ownership with the enabled config",
    async () => {
      const home = await sharedHome();
      const applied = dataOf(await runGit(home.context, { subcommand: "enable", remote: home.remote, branch: null, apply: true }));
      expect(applied).toMatchObject({ kind: "applied", operation: "git_enable" });
      expect(await readOrNull(join(home.gitDirectory, "HEAD"))).toBe("ref: refs/heads/main\n");
      expect((await nodeFs.stat(join(home.gitDirectory, "objects", "ff"))).isDirectory()).toBe(true);
      expect((await nodeFs.stat(join(home.gitDirectory, "logs", "refs", "heads"))).isDirectory()).toBe(true);
      const config = loadConfig(await nodeFs.readFile(home.paths.configFile, "utf8"));
      expect(config.git.enabled).toBe(true);
      const activation = parseLifecycleActivationRecord(await nodeFs.readFile(join(home.paths.stateDir, "lifecycle-activation.json")));
      expect(activation.git.state).toBe("active");
      expect(await nodeFs.readFile(home.paths.manifestFile, "utf8")).toContain(join(home.paths.stateDir, "lifecycle-activation.json"));
      expect(await closureOf(home)).toBe("clear");
      expect(await nodeFs.readdir(join(home.paths.stagingDir, "lifecycle"))).toEqual([]);
      expect(runtime.spawns).toEqual([]);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "refuses config set brainPath once Git records the repository identity",
    async () => {
      const home = await sharedHome();
      const result = await runConfig(home.context, { operation: "set", key: "brainPath", value: join(home.root, "elsewhere") });
      /** The envelope carries `config_refusal` and the reason's fixed text, never the reason code (Spec 1 §2.2). */
      expect(result).toMatchObject({
        ok: false,
        code: EXIT_CODES.invalidInput,
        error: { kind: "config_refusal", message: "brainPath: brainPath is repository identity while a Git lifecycle record exists" },
      });
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "syncs the scoped Brain to the local remote, then records a truthful no_changes",
    async () => {
      const home = await sharedHome();
      await nodeFs.appendFile(join(home.gitDirectory, "config"), "[user]\n\tname = Synthetic Tester\n\temail = tester@example.invalid\n");
      await writeNote(home, "first");
      const pushed = dataOf(await runGit(home.context, { subcommand: "sync" }));
      expect(pushed).toMatchObject({ kind: "sync", outcome: "pushed" });
      if (pushed.kind !== "sync") return;
      expect(await readOrNull(join(home.gitDirectory, "refs", "heads", "main"))).toBe(`${pushed.headOid}\n`);
      expect(await readOrNull(join(home.remote, "refs", "heads", "main"))).toBe(`${pushed.headOid}\n`);
      const record = JSON.parse((await readOrNull(join(home.paths.stateDir, "git-sync.json"))) ?? "null") as { outcome: string; headOid: string; managedPaths: string[] };
      expect(record).toMatchObject({ outcome: "pushed", headOid: pushed.headOid });
      expect(record.managedPaths).toContain("content/DEV/first.md");
      expect(runtime.spawns).toEqual([pushed.headOid]);

      const unchanged = dataOf(await runGit(home.context, { subcommand: "sync" }));
      expect(unchanged).toMatchObject({ kind: "sync", outcome: "no_changes", headOid: pushed.headOid });
      expect(runtime.spawns).toEqual([pushed.headOid]);

      expect(dataOf(await runGit(home.context, { subcommand: "status" }))).toMatchObject({
        kind: "status",
        enabled: true,
        activation: "active",
        scope: "current",
        distribution: "supported",
        closure: "clear",
        lastSync: { outcome: "no_changes", headOid: pushed.headOid },
      });
      expect(runtime.networkCalls).toEqual([]);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "preserves the prior sync record when push fails and retries only the persisted push",
    async () => {
      const home = await sharedHome();
      const previousSuccess = await readOrNull(join(home.paths.stateDir, "git-sync.json"));
      const remoteBefore = await readOrNull(join(home.remote, "refs", "heads", "main"));
      await writeNote(home, "second");
      rejectDestination.on = true;
      try {
        const failed = await runGit(home.context, { subcommand: "sync" });
        expect(failed.ok).toBe(false);
        expect(failed.code).toBe(EXIT_CODES.recoveryRequired);
        if (failed.ok) throw new Error("the rejected push must fail");
        // CLI-CMD-8: the pending push names its coordinator and head, so the retry is addressable.
        expect(failed.error.kind).toBe("push_pending");
        expect(failed.error.data).toEqual({
          transactionId: expect.stringMatching(/^lc_/u) as string,
          headOid: expect.stringMatching(/^[0-9a-f]{40}$/u) as string,
        });
        expect(await readOrNull(join(home.paths.stateDir, "git-sync.json"))).toBe(previousSuccess);
        expect(await readOrNull(join(home.remote, "refs", "heads", "main"))).toBe(remoteBefore);
        expect(await closureOf(home)).toBe("retry_only");
      } finally {
        rejectDestination.on = false;
      }
      const local = await readOrNull(join(home.gitDirectory, "refs", "heads", "main"));
      expect(local).not.toBe(remoteBefore);
      dataOf(await runGit(home.context, { subcommand: "sync" }));
      expect(await readOrNull(join(home.remote, "refs", "heads", "main"))).toBe(local);
      expect(await closureOf(home)).toBe("clear");
      expect(runtime.networkCalls).toEqual([]);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "reports an unsupported distribution in status without spawning, and sync refuses before any repository work",
    async () => {
      const home = await sharedHome();
      const spawned = [...runtime.spawns];
      runtime.drifted = true;
      try {
        expect(dataOf(await runGit(home.context, { subcommand: "status" }))).toMatchObject({ distribution: "unsupported_git_distribution" });
        await writeNote(home, "third");
        expect(kindOf(await runGit(home.context, { subcommand: "sync" }))).toBe("security_refusal");
        expect(runtime.spawns).toEqual(spawned);
      } finally {
        runtime.drifted = false;
      }
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "disables by publishing the inactive arm and clearing the flag, preserving .git",
    async () => {
      const home = await sharedHome();
      const head = await readOrNull(join(home.gitDirectory, "refs", "heads", "main"));
      expect(dataOf(await runGit(home.context, { subcommand: "disable", apply: false }))).toMatchObject({ kind: "preview", command: "git_disable" });
      expect(dataOf(await runGit(home.context, { subcommand: "disable", apply: true }))).toMatchObject({ kind: "applied", operation: "git_disable" });
      expect(loadConfig(await nodeFs.readFile(home.paths.configFile, "utf8")).git).toMatchObject({ enabled: false });
      const activation = parseLifecycleActivationRecord(await nodeFs.readFile(join(home.paths.stateDir, "lifecycle-activation.json")));
      expect(activation.git.state).toBe("inactive");
      expect(await readOrNull(join(home.gitDirectory, "refs", "heads", "main"))).toBe(head);
      expect(kindOf(await runGit(home.context, { subcommand: "sync" }))).toBe("git_disabled");
      expect(await closureOf(home)).toBe("clear");
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );
});

/** A synthetic one-commit repository with exactly the layout `git init` plus one commit leaves. */
async function createOneCommitRepository(worktree: string): Promise<void> {
  const gitDirectory = join(worktree, ".git");
  for (const directory of ["objects/info", "objects/pack", "refs/heads", "refs/tags", "logs/refs/heads"]) {
    await nodeFs.mkdir(join(gitDirectory, directory), { recursive: true, mode: 0o755 });
  }
  const content = new TextEncoder().encode("adopted\n");
  await nodeFs.writeFile(join(worktree, "README.md"), content, { mode: 0o644 });
  const blob = gitObject("blob", content);
  const entry = gitIndexEntry(new TextEncoder().encode("README.md"), 0o100644, blob.oid, content.byteLength);
  const root = buildGitTree([entry]);
  const commit = gitCommitObject(root.object.oid, null, { name: "Synthetic Tester", email: "tester@example.invalid", unixSeconds: 1767225600, utcOffset: "+0000" });
  for (const object of [blob, ...gitTreeNodes(root).map((node) => node.object), commit]) {
    const path = join(gitDirectory, looseObjectRelativePath(object.oid));
    // Git creates a fan-out directory only when an object lands in it.
    await nodeFs.mkdir(join(path, ".."), { recursive: true, mode: 0o755 });
    await nodeFs.writeFile(path, looseObjectBytes(object), { mode: 0o444 });
  }
  await nodeFs.writeFile(join(gitDirectory, "index"), gitIndexBytes([entry], null), { mode: 0o644 });
  await nodeFs.writeFile(join(gitDirectory, "HEAD"), "ref: refs/heads/main\n", { mode: 0o644 });
  await nodeFs.writeFile(join(gitDirectory, "refs", "heads", "main"), `${commit.oid}\n`, { mode: 0o644 });
  await nodeFs.writeFile(
    join(gitDirectory, "config"),
    "[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n[user]\n\tname = Synthetic Tester\n\temail = tester@example.invalid\n",
    { mode: 0o644 },
  );
}

describe("git on an adopted repository", () => {
  it(
    "publishes the missing loose-object fan-out directories at enable, so the first sync pushes",
    async () => {
      const home = await createCommandFixture("git-v2-adopt", {
        root: await createLowEntropyFixtureRoot("git-v2-adopt"),
        bootstrapAvailable: true,
        effectPorts: scriptedEffectPorts(runtime, rejectDestination),
      });
      await nodeFs.mkdir(home.paths.brain, { recursive: true, mode: 0o700 });
      const init = await runInit(home.context, { dryRun: false, assumeYes: true });
      expect(init.ok, JSON.stringify(init)).toBe(true);
      await createOneCommitRepository(home.paths.brain);
      const remote = await createBareRemote(join(home.root, "remote.git"));
      expect(dataOf(await runGit(home.context, { subcommand: "enable", remote, branch: null, apply: true }))).toMatchObject({
        kind: "applied",
        operation: "git_enable",
      });
      await writeNote({ ...home, remote, gitDirectory: join(home.paths.brain, ".git") }, "adopted");
      expect(dataOf(await runGit(home.context, { subcommand: "sync" }))).toMatchObject({ kind: "sync", outcome: "pushed" });
      const fanOut = (await nodeFs.readdir(join(home.paths.brain, ".git", "objects"))).filter((name) => /^[0-9a-f]{2}$/u.test(name));
      expect(fanOut).toHaveLength(256);
      expect(await closureOf({ ...home, remote, gitDirectory: join(home.paths.brain, ".git") })).toBe("clear");
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );
});
