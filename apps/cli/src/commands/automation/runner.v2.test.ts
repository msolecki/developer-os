import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  EXIT_CODES,
  parseCanonicalAbsolutePathText,
  parseEffectiveUid,
  parseLowerHexSha256,
  parseSafeReasonCode,
  parseUInt64Decimal,
} from "@developer-os/core";
import type { CanonicalAbsolutePathV1, HeldLifecycleStableLockV1 } from "@developer-os/core";
import { launchdGuiDomain } from "@developer-os/platform-macos";

import type { CliLifecycleContext } from "../../lifecycle/context.js";
import { withLifecycleMutation } from "../../lifecycle/mutation-gate.js";
import {
  automationRunnerLeasePath,
  automationStatusPath,
  parseAutomationStatusRecord,
} from "../../lifecycle/runtime-records.js";
import { runScheduledBrain } from "../brain.js";
import { runConfig } from "../config.js";
import { runInit } from "../init.js";
import {
  createCommandFixture,
  inventoryDigest,
  REAL_FILESYSTEM_TIMEOUT_MS,
  removeCommandFixtures,
} from "../testing.js";
import type { CommandFixture } from "../testing.js";
import { AutomationRunner, createAutomationRunnerDependencies } from "./runner.js";

const ACCEPTED = { dryRun: false, assumeYes: true } as const;
const UID = process.getuid?.() ?? 0;
const GENERATION = parseLowerHexSha256("b".repeat(64));

afterAll(removeCommandFixtures);

let sharedHome: Promise<CommandFixture> | null = null;

/** One real fresh V2 `init` per file; every case restores what it holds before it returns. */
function sharedV2Home(): Promise<CommandFixture> {
  sharedHome ??= (async () => {
    const fixture = await createCommandFixture("runner-shared", { bootstrapAvailable: true });
    // No pre-created brain: fresh init seeds the template vault the scheduled brain jobs walk.
    const result = await runInit(fixture.context, ACCEPTED);
    if (!result.ok) throw new Error(`fixture init failed: ${JSON.stringify(result)}`);
    return fixture;
  })();
  return sharedHome;
}

function lifecycleOf(fixture: CommandFixture): CliLifecycleContext {
  const lifecycle = fixture.context.lifecycle;
  if (lifecycle === undefined) throw new Error("the fixture composed no lifecycle context");
  return lifecycle;
}

function globalLockPath(fixture: CommandFixture): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(join(fixture.paths.stateDir, ".lifecycle.lock"));
}

function probePlan(fixture: CommandFixture, name: string) {
  return {
    kind: "capture",
    mutations: [
      {
        targetPath: join(fixture.paths.home, `${name}.probe.json`),
        operation: "create" as const,
        content: new TextEncoder().encode(`{"probe":"${name}"}\n`),
      },
    ],
  };
}

/** The runner's own held descriptor, with every release it would suffer counted. */
async function heldGlobal(fixture: CommandFixture): Promise<{
  readonly held: HeldLifecycleStableLockV1;
  readonly borrowed: HeldLifecycleStableLockV1;
  readonly releases: string[];
}> {
  const held = await lifecycleOf(fixture).locks.acquireExisting(globalLockPath(fixture));
  const releases: string[] = [];
  const borrowed: HeldLifecycleStableLockV1 = {
    path: held.path,
    dev: held.dev,
    ino: held.ino,
    release: () => {
      releases.push(held.path);
      return Promise.resolve();
    },
  };
  return { held, borrowed, releases };
}

describe("a scheduled handler under the runner's held global lock (Review Focus 1)", () => {
  it("lets a handler mutate under the runner's held global lock without self-refusal", async () => {
    const home = await sharedV2Home();
    const { held, borrowed, releases } = await heldGlobal(home);
    try {
      const result = await withLifecycleMutation(
        home.context,
        lifecycleOf(home),
        async () => {
          await home.context.executor.execute(probePlan(home, "held-global"));
          return "ok";
        },
        undefined,
        { global: borrowed },
      );
      expect(result).toBe("ok");
      expect(releases).toEqual([]);
      expect(await nodeFs.readFile(join(home.paths.home, "held-global.probe.json"), "utf8")).toBe('{"probe":"held-global"}\n');
    } finally {
      await held.release();
    }
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses a held lock whose dev/ino differ, and writes nothing", async () => {
    const home = await sharedV2Home();
    const { held, borrowed, releases } = await heldGlobal(home);
    try {
      const before = await inventoryDigest(home.paths.home);
      await expect(
        withLifecycleMutation(
          home.context,
          lifecycleOf(home),
          () => home.context.executor.execute(probePlan(home, "foreign-identity")),
          undefined,
          { global: { ...borrowed, ino: parseUInt64Decimal("1") } },
        ),
      ).rejects.toMatchObject({ reason: "lifecycle_lock_identity", code: EXIT_CODES.recoveryRequired });
      expect(releases).toEqual([]);
      expect(await inventoryDigest(home.paths.home)).toStrictEqual(before);
    } finally {
      await held.release();
    }
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it.each(["brain-reindex", "brain-lint"] as const)("runs the scheduled %s handler under the held lock", async (job) => {
    const home = await sharedV2Home();
    const { held, borrowed, releases } = await heldGlobal(home);
    try {
      expect(await runScheduledBrain(home.context, job, borrowed)).toMatchObject({ outcome: "success", reasonCode: "ok" });
      expect(releases).toEqual([]);
    } finally {
      await held.release();
    }
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});

describe("interactive contention with a scheduled run (Review Focus 3)", () => {
  it("refuses an interactive mutation with exit 6 while a scheduled job holds the global lock", async () => {
    const home = await sharedV2Home();
    const lifecycle = lifecycleOf(home);
    const production = createAutomationRunnerDependencies(home.context, lifecycle, {
      userHome: parseCanonicalAbsolutePathText(home.userHome),
      domain: launchdGuiDomain(parseEffectiveUid(UID, UID)),
      executablePath: parseCanonicalAbsolutePathText(join(home.paths.home, "bin", "developer-os.mjs")),
    });
    let started: () => void = () => undefined;
    const handlerStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let proceed: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    const runner = new AutomationRunner({
      ...production,
      // Stage 1 needs an installed plist, which only `automation enable` (Task 17) creates.
      authenticate: () => Promise.resolve(),
      inspect: async (job) => ({ ...(await production.inspect(job)), eligibility: "active" }),
      handlers: {
        run: async (job, global) => {
          started();
          await released;
          if (job !== "brain-lint") throw new Error("unexpected job");
          return runScheduledBrain(home.context, job, global);
        },
      },
    });
    const configBefore = await nodeFs.readFile(home.paths.configFile);

    const running = runner.run({ job: "brain-lint", generation: GENERATION });
    await handlerStarted;
    const interactive = await runConfig(home.context, {
      operation: "set",
      key: "brain.staleness.reviewAfterDays",
      value: "30",
    });
    proceed();

    expect(interactive).toMatchObject({
      ok: false,
      code: EXIT_CODES.recoveryRequired,
      error: { kind: "lifecycle_lock_busy" },
    });
    expect(await nodeFs.readFile(home.paths.configFile)).toStrictEqual(configBefore);
    expect(await running).toStrictEqual({ kind: "recorded", outcome: "success" });
    const status = parseAutomationStatusRecord(
      await nodeFs.readFile(automationStatusPath(parseCanonicalAbsolutePathText(home.paths.home), "brain-lint")),
    );
    expect(status).toMatchObject({ job: "brain-lint", outcome: "success", reasonCode: "ok" });
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});

describe("runtime records through the real gate", () => {
  it("compacts every status write's terminal journal so thousands of runs stay bounded", async () => {
    const home = await sharedV2Home();
    const lifecycle = lifecycleOf(home);
    const productHome = parseCanonicalAbsolutePathText(home.paths.home);
    const production = createAutomationRunnerDependencies(home.context, lifecycle, {
      userHome: parseCanonicalAbsolutePathText(home.userHome),
      domain: launchdGuiDomain(parseEffectiveUid(UID, UID)),
      executablePath: parseCanonicalAbsolutePathText(join(home.paths.home, "bin", "developer-os.mjs")),
    });
    const lease = await lifecycle.locks.acquireExisting(automationRunnerLeasePath(productHome, "doctor"));
    const { held, borrowed } = await heldGlobal(home);
    try {
      const records = production.records(borrowed);
      // ponytail: 200, not 2000 — the gate costs ~640 ms per write (NEW-53), and the journal count is flat from write 20 on.
      for (let run = 0; run < 200; run += 1) {
        await records.writeStatus(
          {
            schemaVersion: 1,
            job: "doctor",
            outcome: "automation_disabled",
            reasonCode: parseSafeReasonCode("automation_disabled"),
            startedAt: null,
            completedAt: lifecycle.clock(),
          },
          { job: "doctor", lock: lease },
        );
      }
      const journals = (await nodeFs.readdir(join(home.paths.stateDir, "transactions"))).filter((name) =>
        name.endsWith(".json"),
      );
      expect(journals.length).toBeGreaterThan(0);
      expect(journals.length).toBeLessThanOrEqual(2);
      expect(
        parseAutomationStatusRecord(await nodeFs.readFile(automationStatusPath(productHome, "doctor"))),
      ).toMatchObject({ outcome: "automation_disabled" });
    } finally {
      await held.release();
      await lease.release();
    }
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});
