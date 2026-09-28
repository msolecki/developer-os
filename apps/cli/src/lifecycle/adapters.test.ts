import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  EXIT_CODES,
  GitEffectExecutor,
  LifecycleRecoveryRequiredError,
  parseCanonicalAbsolutePathText,
  parseLowerHexSha256,
  parseUInt64Decimal,
  resolveRuntimePaths,
} from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  LifecycleInstallNonceV1,
  LowerHexSha256,
  RuntimePaths,
  TransactionLockHandle,
  TransactionLockProvider,
} from "@developer-os/core";
import {
  LaunchdEffectJournalStore,
  MacOsStableLockProvider,
  launchdEffectPlan,
} from "@developer-os/platform-macos";

import { createCommandFixture, removeCommandFixtures } from "../commands/testing.js";
import { manifestAdmissionFor } from "./manifest-admission.js";
import { pathEnvironmentFor, publishBootstrapInitialJournalNoReplace } from "../context.js";
import {
  REJECTING_LAUNCHD_HOST,
  createLifecycleEffectAdapters,
  createLifecycleEffectPorts,
  createLifecycleManifestAdapter,
} from "./adapters.js";
import type { LaunchdHostV1, LifecycleEffectPortsV1 } from "./adapters.js";
import type { LifecycleExecutionPlanV1 } from "./codecs.js";
import { createLifecycleContext } from "./context.js";
import type { CliLifecycleContext } from "./context.js";
import { gateManifestAdmission } from "./mutation-gate.js";
import {
  SYNTHETIC_MANIFEST_AFTER_BYTES,
  syntheticAutomationLiveOnly,
  syntheticGitEnable,
  syntheticGitSync,
  syntheticUninstall,
} from "./testing.js";

const UID = process.getuid?.() ?? 0;
const NONCE: LifecycleInstallNonceV1 = parseLowerHexSha256("5d".repeat(32));

const LEDGER_DIRECTORIES = [
  "state",
  "state/transactions",
  "state/lifecycle-journals",
  "state/git-effect-journals",
  "state/launchd-effect-journals",
  "staging",
  "staging/transactions",
  "staging/lifecycle",
  "backups",
  "backups/transactions",
] as const;

const roots: string[] = [];

afterEach(async () => {
  await removeCommandFixtures();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) await nodeFs.rm(root, { recursive: true, force: true });
  }
});

class InProcessTransactionLocks implements TransactionLockProvider {
  readonly #held = new Set<string>();

  acquire(path: string): Promise<TransactionLockHandle> {
    if (this.#held.has(path)) return Promise.reject(new Error("lock already held"));
    this.#held.add(path);
    return Promise.resolve({
      release: (): Promise<void> => {
        this.#held.delete(path);
        return Promise.resolve();
      },
    });
  }
}

/** Every host member records its call and rejects, so a test can prove none was reached. */
function recordingHost(calls: string[]): LaunchdHostV1 {
  const reject = (name: string) => (): Promise<never> => {
    calls.push(name);
    return Promise.reject(new Error(`unexpected ${name}`));
  };
  return {
    runner: {
      beginPhase: () => {
        calls.push("beginPhase");
        throw new Error("unexpected beginPhase");
      },
      run: reject("run"),
    },
    consoleUserUid: reject("consoleUserUid"),
    host: { operatingSystem: reject("operatingSystem"), inspect: reject("inspect") },
    inspectEmptyDirectory: reject("inspectEmptyDirectory"),
  };
}

interface HomeV1 {
  readonly paths: RuntimePaths;
  readonly productHome: CanonicalAbsolutePathV1;
  readonly lifecycle: CliLifecycleContext;
  readonly hostCalls: string[];
}

async function newHome(
  label: string,
  effectPorts?: (context: CliLifecycleContext) => LifecycleEffectPortsV1,
): Promise<HomeV1> {
  const created = await nodeFs.mkdtemp(join(tmpdir(), `developer-os-adapters-${label}-`));
  const root = await nodeFs.realpath(created);
  roots.push(root);
  const userHome = join(root, "home");
  await nodeFs.mkdir(userHome, { recursive: true, mode: 0o700 });
  const paths = resolveRuntimePaths(pathEnvironmentFor({ userHome, env: {} }));
  await nodeFs.mkdir(paths.home, { recursive: true, mode: 0o700 });
  for (const relative of LEDGER_DIRECTORIES) {
    await nodeFs.mkdir(join(paths.home, relative), { recursive: true, mode: 0o700 });
  }
  const hostCalls: string[] = [];
  const lifecycle = createLifecycleContext({
    paths,
    renameNoReplace: publishBootstrapInitialJournalNoReplace,
    locks: new MacOsStableLockProvider(),
    transactionLocks: new InProcessTransactionLocks(),
    effectiveUid: UID,
    now: () => new Date("2026-09-23T00:00:00.000Z"),
    launchdHost: recordingHost(hostCalls),
    ...(effectPorts === undefined ? {} : { effectPorts }),
  });
  return { paths, productHome: parseCanonicalAbsolutePathText(paths.home), lifecycle, hostCalls };
}

function recordingPush(outcomes: readonly ("succeeded" | "failed")[]): {
  readonly port: LifecycleEffectPortsV1["push"];
  readonly calls: { readonly plan: LifecycleExecutionPlanV1; readonly pushPlanHash: LowerHexSha256 }[];
} {
  const calls: { readonly plan: LifecycleExecutionPlanV1; readonly pushPlanHash: LowerHexSha256 }[] = [];
  const pending = [...outcomes];
  return {
    calls,
    port: {
      push: (plan, pushPlanHash) => {
        calls.push({ plan, pushPlanHash });
        const outcome = pending.shift();
        return outcome === undefined ? Promise.reject(new Error("unexpected push")) : Promise.resolve(outcome);
      },
    },
  };
}

describe("the composed lifecycle effect adapters", () => {
  it("routes both Git arms to one executor and both launchd positions to one resolver", async () => {
    const home = await newHome("arms");
    const adapters = createLifecycleEffectAdapters(home.lifecycle, home.lifecycle.effectPorts());

    expect(adapters.sourceGitEffect).toBeInstanceOf(GitEffectExecutor);
    expect(adapters.destinationGitEffect).toBe(adapters.sourceGitEffect);
    expect(adapters.launchdAfterFiles).toBe(adapters.launchdBeforeFiles);
  });

  it("hands a push_pending plan's bound push to the injected port and retries it once through the same port", async () => {
    const push = recordingPush(["failed", "succeeded"]);
    const home = await newHome("push", (context) => ({ ...createLifecycleEffectPorts(context, REJECTING_LAUNCHD_HOST), push: push.port }));
    const plan = syntheticGitSync(home.productHome, NONCE, 1n, "existing_network");
    const adapters = createLifecycleEffectAdapters(home.lifecycle, home.lifecycle.effectPorts());
    const step = plan.steps[0];
    if (step?.kind !== "network_push") throw new Error("existing_network starts with its bound push");

    expect(await adapters.networkPush?.push(plan, step.pushPlanHash)).toBe("failed");
    expect(await adapters.networkPush?.push(plan, step.pushPlanHash)).toBe("succeeded");
    expect(push.calls).toHaveLength(2);
    expect(push.calls.every((call) => call.pushPlanHash === step.pushPlanHash && call.plan === plan)).toBe(true);
  });

  it("refuses an unpublished launchd effect plan as recovery-required without reaching the host", async () => {
    const home = await newHome("unpublished");
    const plan = syntheticAutomationLiveOnly(home.productHome, NONCE, 1n);
    const ref = plan.participants.launchdAfterFiles;
    if (ref === null) throw new Error("the live-only fixture loads doctor");
    const adapters = createLifecycleEffectAdapters(home.lifecycle, home.lifecycle.effectPorts());

    await expect(adapters.launchdAfterFiles?.observe(ref)).rejects.toMatchObject({
      code: EXIT_CODES.recoveryRequired,
      reason: "lifecycle_effect_plan_shape",
    });
    expect(home.hostCalls).toStrictEqual([]);
  });

  it("resolves a published launchd effect plan through its own coordinator and refuses one whose coordinator is gone", async () => {
    const home = await newHome("resolve");
    const plan = syntheticAutomationLiveOnly(home.productHome, NONCE, 1n);
    const ref = plan.participants.launchdAfterFiles;
    const launchd = plan.participants.launchd;
    if (ref === null || launchd === null) throw new Error("the live-only fixture loads doctor");
    const effect = launchdEffectPlan(launchd, "after_files");
    if (effect === null) throw new Error("the live-only fixture has an after_files effect");
    const journals = new LaunchdEffectJournalStore({
      fs: home.lifecycle.fs,
      roots: home.lifecycle.roots,
      locks: home.lifecycle.transactionLocks,
      uuid: home.lifecycle.uuid,
    });
    expect(await journals.publishPlan(effect)).toBe(ref.planHash);
    const adapters = createLifecycleEffectAdapters(home.lifecycle, home.lifecycle.effectPorts());

    const refusal = adapters.launchdAfterFiles?.observe(ref);
    await expect(refusal).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    await expect(refusal).rejects.toMatchObject({ reason: "lifecycle_coordinator_plan_shape" });
    expect(home.hostCalls).toStrictEqual([]);
  });

  it("composes the injected ports once per context and defaults the launchd host to one that rejects", async () => {
    let built = 0;
    const home = await newHome("ports", (context) => {
      built += 1;
      return createLifecycleEffectPorts(context, REJECTING_LAUNCHD_HOST);
    });

    expect(home.lifecycle.effectPorts()).toBe(home.lifecycle.effectPorts());
    expect(built).toBe(1);
    await expect(REJECTING_LAUNCHD_HOST.runner.run({} as never)).rejects.toThrow(/without injecting a runner/u);
    await expect(REJECTING_LAUNCHD_HOST.host.operatingSystem()).rejects.toThrow();
    await expect(REJECTING_LAUNCHD_HOST.host.inspect("/bin/launchctl" as CanonicalAbsolutePathV1)).rejects.toThrow();
  });

  it("refuses a no-replace rename whose source left its identity, and the network push (D59)", async () => {
    const home = await newHome("placeholders");
    const ports = createLifecycleEffectPorts(home.lifecycle, REJECTING_LAUNCHD_HOST);
    const plan = syntheticGitSync(home.productHome, NONCE, 1n, "existing_network");
    const vanished = parseCanonicalAbsolutePathText(join(home.productHome, "vanished-pack"));
    const source = { path: vanished, dev: parseUInt64Decimal("1"), ino: parseUInt64Decimal("1"), kind: "file" };

    await expect(
      ports.git.fs.renameGitNoReplace(source as never, parseCanonicalAbsolutePathText(join(home.productHome, "dest"))),
    ).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired, reason: "git_effect_third_state" });
    await expect(ports.push.push(plan, parseLowerHexSha256("0".repeat(64)))).rejects.toMatchObject({
      code: EXIT_CODES.securityRefusal,
      message: "unsupported_git_distribution",
    });
    expect(ports.git.journalRoot).toBe(home.lifecycle.roots.gitEffectJournals);
  });
});

describe("the lifecycle manifest adapter", () => {
  it("refuses an uninstall plan and the uninstall-only commit_absence transition", async () => {
    const fixture = await createCommandFixture("adapters-manifest");
    const home = await newHome("manifest");
    const adapter = createLifecycleManifestAdapter(home.lifecycle, gateManifestAdmission(fixture.context));
    const uninstall = syntheticUninstall(home.productHome, NONCE, 1n).plan;

    await expect(adapter.observe(uninstall)).rejects.toMatchObject({
      code: EXIT_CODES.recoveryRequired,
      reason: "lifecycle_coordinator_manifest_arm",
    });
    await expect(adapter.commitAbsence(uninstall)).rejects.toMatchObject({
      reason: "lifecycle_coordinator_manifest_arm",
    });
  });

  it("reports compaction_pending only while the live manifest is the exact after inode", async () => {
    const home = await newHome("compaction");
    const plan = syntheticGitEnable(home.productHome, NONCE, 1n);
    const leaf = plan.participants.manifest;
    if (leaf === null || leaf.after.state !== "present") throw new Error("git_enable publishes a manifest");
    await nodeFs.writeFile(leaf.manifestPath, SYNTHETIC_MANIFEST_AFTER_BYTES, { mode: 0o600 });
    const live = await nodeFs.lstat(leaf.manifestPath, { bigint: true });
    const compacted: LifecycleExecutionPlanV1 = {
      ...plan,
      participants: {
        ...plan.participants,
        manifest: {
          ...leaf,
          after: {
            ...leaf.after,
            dev: parseUInt64Decimal(live.dev.toString(10)),
            ino: parseUInt64Decimal(live.ino.toString(10)),
          },
        },
      },
    };
    const adapter = createLifecycleManifestAdapter(home.lifecycle, manifestAdmissionFor(home.paths, []));

    expect(await adapter.observe(compacted)).toBe("compaction_pending");

    await nodeFs.chmod(leaf.manifestPath, 0o644);
    await expect(adapter.observe(compacted)).rejects.toMatchObject({
      code: EXIT_CODES.recoveryRequired,
      reason: "manifest_bytes_identity",
    });
  });
});

describe("the confined manifest admission (NEW-96)", () => {
  it("gives the mutation gate and uninstall one owner-path policy", async () => {
    const fixture = await createCommandFixture("adapters-admission");
    const { paths } = fixture.context;
    const refused: string[] = [];
    const uninstall = manifestAdmissionFor(paths, refused);
    const gate = gateManifestAdmission(fixture.context);
    const inside = parseCanonicalAbsolutePathText(join(paths.home, "templates", "file"));
    const inBrain = parseCanonicalAbsolutePathText(join(paths.brain, "note.md"));
    const outside = parseCanonicalAbsolutePathText("/developer-os-outside-authority/file");

    expect(gate.sourceRoot).toBe(uninstall.sourceRoot);
    expect(gate.backupRoot).toBe(uninstall.backupRoot);
    for (const admission of [gate, uninstall]) {
      expect(admission.admitOwnerPath("core", inside, { kind: "file" })).toBe(inside);
      expect(admission.admitOwnerPath("core", inBrain, { kind: "file" })).toBe(inBrain);
      expect(admission.admitOwnerPath("core", outside, { kind: "file" })).not.toBe(outside);
    }
    expect(refused).toStrictEqual([outside]);
  });
});
