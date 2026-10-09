/**
 * One real V2 home with both opt-in surfaces reachable and neither able to leave the fixture:
 * a scripted `GitRuntimeV1` (the pinned Xcode Git never runs, Q5), a local bare remote, and an
 * injected launchd domain (the real `launchctl` never runs). Every lifecycle participant —
 * Foundation, manifest, both Git effects, both launchd effects — is the shipped one.
 */
import * as nodeFs from "node:fs/promises";
import { basename, join } from "node:path";

import {
  parseCanonicalAbsolutePathText,
  parseEffectiveUid,
  parseUtcTimestamp,
} from "@developer-os/core";
import type {
  HeldLifecycleStableLockV1,
  LifecycleCoordinatorStore,
  ScheduledJobIdV1,
} from "@developer-os/core";
import {
  LaunchdDistributionUnsupportedError,
  launchdGuiDomain,
  parseCanonicalLaunchdPlist,
  parseGeneratedLabel,
} from "@developer-os/platform-macos";
import { createProductionScheduledHandlers } from "@developer-os/cli/dist/commands/automation/handlers.js";
import { AutomationRunner, createAutomationRunnerDependencies } from "@developer-os/cli/dist/commands/automation/runner.js";
import type { ScheduledRunOutcomeV1 } from "@developer-os/cli/dist/commands/automation/runner.js";
import { runBrain } from "@developer-os/cli/dist/commands/brain.js";
import { createBareRemote, scriptedEffectPorts, scriptedGitRuntime } from "@developer-os/cli/dist/commands/git/testing.js";
import type { ScriptedGitRuntimeV1 } from "@developer-os/cli/dist/commands/git/testing.js";
import { runInit } from "@developer-os/cli/dist/commands/init.js";
import { createCommandFixture, createLowEntropyFixtureRoot } from "@developer-os/cli/dist/commands/testing.js";
import type { CommandFixture } from "@developer-os/cli/dist/commands/testing.js";
import type { CliContext } from "@developer-os/cli/dist/context.js";
import type { LifecycleEffectPortsV1 } from "@developer-os/cli/dist/lifecycle/adapters.js";
import type { LifecycleExecutionPlanV1 } from "@developer-os/cli/dist/lifecycle/codecs.js";
import type { CliLifecycleContext } from "@developer-os/cli/dist/lifecycle/context.js";
import { scriptedLaunchd } from "@developer-os/cli/dist/lifecycle/testing.js";
import type { ScriptedLaunchdV1 } from "@developer-os/cli/dist/lifecycle/testing.js";
import { entrypointPath } from "@developer-os/cli/dist/update/local-release.js";

export const OPT_IN_UID = process.getuid?.() ?? 0;
export const BASE_SCHEDULES = ["brain-reindex=daily@02:00", "brain-lint=daily@02:30", "doctor=weekly@mon,03:00"] as const;
const CLOCK = parseUtcTimestamp("2026-09-23T00:00:00.000Z");
const GIT_JOURNAL_TEMP = /^\.ge_[0-9a-f]{64}_[0-9]+\.[0-9a-f-]+\.json\.tmp$/u;

/** A process death at a chosen boundary: the coordinator does not catch it, so the ledger stays open. */
export class SyntheticDeath extends Error {
  constructor(boundary: string) {
    super(`synthetic death at ${boundary}`);
    this.name = "SyntheticDeath";
  }
}

/** Switches a case flips and restores; each fires on every matching call while it is on. */
export interface OptInFaultsV1 {
  /** The destination Git effect refuses its first journal write, so a push stays `push_pending`. */
  readonly rejectDestination: { on: boolean };
  /** The launchd observation row no longer matches the host (an OS update after enable). */
  launchdDrift: boolean;
  /** The first Git effect journal write of the next coordinator dies. */
  gitJournalDeath: boolean;
  /** The next `launchctl bootstrap` dies before the job is loaded. */
  bootstrapDeath: boolean;
  /** The next `launchctl bootout` dies before the job is unloaded. */
  bootoutDeath: boolean;
  /** The next coordinator dies right after its plan is published, before its first step. */
  deathAfterPublish: boolean;
  /**
   * Set when a `launchctl` death fires. A rejected step before the point of no return is a
   * failure the coordinator compensates in-process; a dead process compensates nothing, so the
   * coordinator's next journal rewrite dies too and the ledger stays open.
   */
  processDead: boolean;
}

export interface OptInHomeV1 extends CommandFixture {
  /** The fixture context with the recording lifecycle, so every command publishes into `plans`. */
  readonly context: CliContext;
  readonly lifecycle: CliLifecycleContext;
  readonly remote: string;
  readonly gitDirectory: string;
  readonly plans: LifecycleExecutionPlanV1[];
  readonly runtime: ScriptedGitRuntimeV1;
  readonly launchd: ScriptedLaunchdV1;
  readonly faults: OptInFaultsV1;
}

function composePorts(
  runtime: ScriptedGitRuntimeV1,
  launchd: ScriptedLaunchdV1,
  faults: OptInFaultsV1,
): (context: CliLifecycleContext) => LifecycleEffectPortsV1 {
  const scripted = scriptedEffectPorts(runtime, faults.rejectDestination);
  return (context) => {
    const ports = scripted(context);
    const writeExclusive: typeof ports.git.fs.writeExclusive = (path, bytes) => {
      if (faults.gitJournalDeath && GIT_JOURNAL_TEMP.test(basename(path))) {
        faults.gitJournalDeath = false;
        return Promise.reject(new SyntheticDeath("git effect journal"));
      }
      return ports.git.fs.writeExclusive(path, bytes);
    };
    const base = launchd.ports;
    return {
      ...ports,
      git: { ...ports.git, fs: { ...ports.git.fs, writeExclusive } },
      launchd: {
        ...base,
        observer: {
          observe: (request) =>
            faults.launchdDrift
              ? Promise.reject(new LaunchdDistributionUnsupportedError("operating system build 25G84 is not the pinned row"))
              : base.observer.observe(request),
        },
        launchctl: {
          ...base.launchctl,
          bootout: (...args: Parameters<typeof base.launchctl.bootout>) => {
            if (!faults.bootoutDeath) return base.launchctl.bootout(...args);
            faults.bootoutDeath = false;
            faults.processDead = true;
            return Promise.reject(new SyntheticDeath("launchctl bootout"));
          },
        },
        bootstrapper: {
          ...base.bootstrapper,
          bootstrap: (...args: Parameters<typeof base.bootstrapper.bootstrap>) => {
            if (!faults.bootstrapDeath) return base.bootstrapper.bootstrap(...args);
            faults.bootstrapDeath = false;
            faults.processDead = true;
            return Promise.reject(new SyntheticDeath("launchctl bootstrap"));
          },
        },
      },
    };
  };
}

function recordingStore(
  store: LifecycleCoordinatorStore<LifecycleExecutionPlanV1>,
  plans: LifecycleExecutionPlanV1[],
  faults: OptInFaultsV1,
): LifecycleCoordinatorStore<LifecycleExecutionPlanV1> {
  return new Proxy(store, {
    get(target, property): unknown {
      if (property === "publish") {
        return async (plan: LifecycleExecutionPlanV1, global: HeldLifecycleStableLockV1) => {
          plans.push(plan);
          const published = await target.publish(plan, global);
          if (faults.deathAfterPublish) {
            faults.deathAfterPublish = false;
            throw new SyntheticDeath(`published ${plan.operation}`);
          }
          return published;
        };
      }
      if (property === "rewriteJournal" && faults.processDead) {
        return () => {
          faults.processDead = false;
          return Promise.reject(new SyntheticDeath("coordinator journal rewrite after a launchctl death"));
        };
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? (value as () => unknown).bind(target) : value;
    },
  });
}

export async function createOptInHome(name: string): Promise<OptInHomeV1> {
  const runtime = scriptedGitRuntime();
  const launchd = scriptedLaunchd({ clock: () => CLOCK });
  const faults: OptInFaultsV1 = {
    rejectDestination: { on: false },
    launchdDrift: false,
    gitJournalDeath: false,
    bootstrapDeath: false,
    bootoutDeath: false,
    deathAfterPublish: false,
    processDead: false,
  };
  const fixture = await createCommandFixture(name, {
    root: await createLowEntropyFixtureRoot(name),
    bootstrapAvailable: true,
    effectPorts: composePorts(runtime, launchd, faults),
  });
  await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
  const initialized = await runInit(fixture.context, { dryRun: false, assumeYes: true });
  if (!initialized.ok) throw new Error(`fixture init failed: ${JSON.stringify(initialized)}`);
  // The Brain predates init, so no template was written; a reindex, the cheapest gated mutation, needs a content root.
  await nodeFs.mkdir(join(fixture.paths.brain, "content"), { mode: 0o700 });
  await nodeFs.mkdir(join(fixture.userHome, "Library", "LaunchAgents"), { recursive: true, mode: 0o700 });
  const base = fixture.context.lifecycle;
  if (base === undefined) throw new Error("the fixture composed no lifecycle context");
  // Spec 2 D84 K5 (NEW-163 option B): `init` itself wrote the one release-independent entrypoint
  // through the mutation gate; the scheduled runs below name it as their executable.
  const manifest = JSON.parse(await nodeFs.readFile(fixture.paths.manifestFile, "utf8")) as {
    readonly artifacts: readonly { readonly path: string; readonly source: string }[];
  };
  const entrypoints = manifest.artifacts.filter((row) => row.source === "generated/entrypoint");
  if (entrypoints.length !== 1 || entrypoints[0]?.path !== entrypointPath(fixture.paths.home)) {
    throw new Error(`fixture init left no single entrypoint row: ${JSON.stringify(entrypoints)}`);
  }
  if (!(await nodeFs.lstat(entrypointPath(fixture.paths.home))).isFile()) throw new Error("fixture init wrote no entrypoint");
  const plans: LifecycleExecutionPlanV1[] = [];
  const lifecycle: CliLifecycleContext = { ...base, store: (key) => recordingStore(base.store(key), plans, faults) };
  const remote = await createBareRemote(join(fixture.root, "remote.git"));
  return {
    ...fixture,
    context: { ...fixture.context, lifecycle },
    lifecycle,
    remote,
    gitDirectory: join(fixture.paths.brain, ".git"),
    plans,
    runtime,
    launchd,
    faults,
  };
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

/** A new scoped Brain note, reindexed so the next sync has something to commit. */
export async function writeNote(home: OptInHomeV1, name: string): Promise<void> {
  const directory = join(home.paths.brain, "content", "DEV");
  await nodeFs.mkdir(directory, { recursive: true, mode: 0o700 });
  await nodeFs.writeFile(join(directory, `${name}.md`), note(name), { mode: 0o600 });
  const reindex = await runBrain(home.context, { subcommand: "reindex", query: null, limit: null, dryRun: false });
  if (!reindex.ok) throw new Error(`reindex failed: ${JSON.stringify(reindex)}`);
}

/** The synthetic committer a real repository would carry; `git sync` never invents one. */
export async function configureCommitter(home: OptInHomeV1): Promise<void> {
  await nodeFs.appendFile(join(home.gitDirectory, "config"), "[user]\n\tname = Synthetic Tester\n\temail = tester@example.invalid\n");
}

export function plistPath(home: OptInHomeV1, job: ScheduledJobIdV1): string {
  return join(home.userHome, "Library", "LaunchAgents", `com.developer-os.${job}.plist`);
}

export async function readOrNull(path: string): Promise<string | null> {
  return nodeFs.readFile(path, "utf8").catch(() => null);
}

/** Entry counts of the journal roots a lifecycle run can grow. */
export async function journalRootSizes(home: OptInHomeV1): Promise<Readonly<Record<string, number>>> {
  const sizes: Record<string, number> = {};
  for (const root of ["lifecycle-journals", "git-effect-journals", "launchd-effect-journals", "transactions"]) {
    sizes[root] = (await nodeFs.readdir(join(home.paths.stateDir, root)).catch(() => [] as string[])).length;
  }
  return sizes;
}

/**
 * What launchd would start for `job`: the hidden scheduled grammar's runner with the production
 * handlers, authenticated against the installed plist's own generation.
 */
export async function runScheduledJob(home: OptInHomeV1, job: ScheduledJobIdV1): Promise<ScheduledRunOutcomeV1> {
  const label = home.launchd.loaded.get(job);
  const bytes = await nodeFs.readFile(plistPath(home, job));
  const installed = label ?? parseCanonicalLaunchdPlist(bytes).Label;
  const dependencies = createAutomationRunnerDependencies(home.context, home.lifecycle, {
    userHome: parseCanonicalAbsolutePathText(home.userHome),
    domain: launchdGuiDomain(parseEffectiveUid(OPT_IN_UID, OPT_IN_UID)),
    executablePath: parseCanonicalAbsolutePathText(entrypointPath(home.paths.home)),
  });
  const runner = new AutomationRunner({ ...dependencies, handlers: createProductionScheduledHandlers(home.context, home.lifecycle) });
  return runner.run({ job, generation: parseGeneratedLabel(installed).generation });
}
