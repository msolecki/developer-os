import type { ScheduledJobIdV1 } from "@developer-os/core";
import type { SupervisedPhaseV1, SupervisedProcessRunner } from "@developer-os/security";

import {
  LaunchdDistributionUnsupportedError,
  admitLaunchdHost,
  recheckLaunchdHost,
  type LaunchctlIdentityV1,
  type LaunchdHostObserverV1,
} from "./distribution.js";
import { LAUNCHD_PREVIEW_OBSERVATION_TABLE } from "./process-table.js";
import { launchdJob, parseGeneratedLabel } from "./registry.js";
import {
  LaunchdInputError,
  type GeneratedLaunchdLabelV1,
  type LaunchdGenerationV1,
  type LaunchdGuiDomainV1,
  type LaunchdObservedLabelV1,
  type LaunchdObservedServiceTargetV1,
} from "./types.js";

export const LAUNCHD_SERVICE_ABSENT_EXIT = 113;

/** A guarded no-follow inspection of `/private/var/empty`; the row pins no device or inode, so only drift within one pass counts. */
export interface LaunchdEmptyDirectoryObservationV1 {
  readonly kind: "file" | "directory" | "symlink" | "other";
  readonly ownerUid: number;
  readonly mode: number;
  readonly dev: string;
  readonly ino: string;
  readonly entryCount: number;
}

export interface LaunchdObservationDependenciesV1 {
  readonly runner: Pick<SupervisedProcessRunner, "beginPhase" | "run">;
  effectiveUid(): number;
  /** The validated console user's UID, from the platform record, never from `HOME` or `USER`. */
  consoleUserUid(): Promise<number>;
  readonly host: LaunchdHostObserverV1;
  inspectEmptyDirectory(path: "/private/var/empty"): Promise<LaunchdEmptyDirectoryObservationV1>;
}

/**
 * One job's closed candidate set: the retained generation reconstructed from manifest-bound plist
 * bytes (or a journaled preimage) and the plan's postimage. The unsuffixed base label is always probed.
 */
export interface LaunchdObservationJobV1 {
  readonly job: ScheduledJobIdV1;
  readonly retained: GeneratedLaunchdLabelV1 | null;
  readonly planned: GeneratedLaunchdLabelV1 | null;
}

export interface LaunchdObservationRequestV1 {
  readonly domain: LaunchdGuiDomainV1;
  readonly jobs: readonly LaunchdObservationJobV1[];
}

export type LaunchdObservedStateV1 =
  | { readonly kind: "unloaded" }
  | { readonly kind: "exact_old"; readonly label: GeneratedLaunchdLabelV1; readonly generation: LaunchdGenerationV1 }
  | { readonly kind: "exact_new"; readonly label: GeneratedLaunchdLabelV1; readonly generation: LaunchdGenerationV1 }
  | { readonly kind: "third_state"; readonly reason: "unsuffixed_collision" | "dual_generation" };

export type LaunchdUnobservableReasonV1 = "truncated" | "over_limit" | "timeout" | "exit";

export type LaunchdLiveObservationV1 =
  | { readonly kind: "observed"; readonly jobs: readonly { readonly job: ScheduledJobIdV1; readonly state: LaunchdObservedStateV1 }[] }
  | { readonly kind: "unobservable"; readonly reason: LaunchdUnobservableReasonV1 };

/** One observation pass: the first probe's host admission and the empty directory's identity. */
type Pass = { launchctl: LaunchctlIdentityV1 | null; readonly baseline: LaunchdEmptyDirectoryObservationV1 };

type ProbeResultV1 ={ readonly kind: "exited"; readonly exitCode: number } | { readonly kind: "unobservable"; readonly reason: LaunchdUnobservableReasonV1 };

const encoder = new TextEncoder();
const table = LAUNCHD_PREVIEW_OBSERVATION_TABLE;
const [queryProfile] = table.profiles;

function refuse(message: string): never {
  throw new LaunchdInputError(message);
}

function byUtf8(left: string, right: string): number {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = (a[index] as number) - (b[index] as number);
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

function candidateLabel(job: ScheduledJobIdV1, label: GeneratedLaunchdLabelV1 | null, field: string): GeneratedLaunchdLabelV1 | null {
  if (label === null) return null;
  if (parseGeneratedLabel(label).job !== job) refuse(`${job}: ${field} label names another job`);
  return label;
}

function validateJobs(jobs: readonly LaunchdObservationJobV1[]): readonly LaunchdObservationJobV1[] {
  if (jobs.length > 4) refuse("launchd observation names more than four jobs");
  const seen = new Set<ScheduledJobIdV1>();
  return jobs.map((entry) => {
    const job = launchdJob(entry.job).id;
    if (seen.has(job)) refuse(`${job}: observed twice`);
    seen.add(job);
    return { job, retained: candidateLabel(job, entry.retained, "retained"), planned: candidateLabel(job, entry.planned, "planned") };
  });
}

function classify(entry: LaunchdObservationJobV1, present: ReadonlySet<LaunchdObservedLabelV1>): LaunchdObservedStateV1 {
  if (present.has(launchdJob(entry.job).baseLabel)) return { kind: "third_state", reason: "unsuffixed_collision" };
  const { retained, planned } = entry;
  const oldPresent = retained !== null && present.has(retained);
  const newPresent = planned !== null && present.has(planned);
  if (oldPresent && newPresent && retained !== planned) return { kind: "third_state", reason: "dual_generation" };
  if (newPresent) return { kind: "exact_new", label: planned, generation: parseGeneratedLabel(planned).generation };
  if (oldPresent) return { kind: "exact_old", label: retained, generation: parseGeneratedLabel(retained).generation };
  return { kind: "unloaded" };
}

/**
 * Spec §5.3's bounded read-only observation through the preview row: one `print <domain>` that must
 * exit 0, then `print <domain>/<candidate>` per closed candidate, where exit 0 is present and 113 is
 * absent. Output is byte-counted and discarded, never parsed, hashed into a result, logged or
 * persisted, because `launchctl print` may expose unrelated service environment. Every probe shares
 * one absolute 30,000-ms deadline. The first probe admits the host (spec §5.3 rules 1–3, D71); each
 * later one rechecks that admission, and the empty `HOME`/`TMPDIR` directory is re-verified before
 * every process and after it, so only drift within one pass counts.
 */
export class LaunchdObserver {
  readonly #dependencies: LaunchdObservationDependenciesV1;

  constructor(dependencies: LaunchdObservationDependenciesV1) {
    this.#dependencies = dependencies;
  }

  async observe(request: LaunchdObservationRequestV1): Promise<LaunchdLiveObservationV1> {
    const domain = await this.#admitDomain(request.domain);
    const jobs = validateJobs(request.jobs);
    const phase = this.#dependencies.runner.beginPhase("launchd-observation", table.observationDeadlineMs);
    const baseline = await this.#admitEmptyDirectory(null);
    const pass: Pass = { launchctl: null, baseline };

    const domainProbe = await this.#probe(domain, phase, pass);
    if (domainProbe.kind === "unobservable") return domainProbe;
    if (domainProbe.exitCode !== 0) return { kind: "unobservable", reason: "exit" };

    const observed: { job: ScheduledJobIdV1; state: LaunchdObservedStateV1 }[] = [];
    for (const entry of jobs) {
      const labels = [...new Set<LaunchdObservedLabelV1>([launchdJob(entry.job).baseLabel, ...[entry.retained, entry.planned].filter((label) => label !== null)])];
      const targets = labels.map((label) => {
        const target: LaunchdObservedServiceTargetV1 = `${domain}/${label}`;
        return { label, target };
      }).sort((left, right) => byUtf8(left.target, right.target));
      const present = new Set<LaunchdObservedLabelV1>();
      for (const { label, target } of targets) {
        const probe = await this.#probe(target, phase, pass);
        if (probe.kind === "unobservable") return probe;
        if (probe.exitCode === 0) present.add(label);
        else if (probe.exitCode !== LAUNCHD_SERVICE_ABSENT_EXIT) return { kind: "unobservable", reason: "exit" };
      }
      observed.push({ job: entry.job, state: classify(entry, present) });
    }
    return { kind: "observed", jobs: observed };
  }

  async #admitDomain(domain: LaunchdGuiDomainV1): Promise<LaunchdGuiDomainV1> {
    const match = /^gui\/(0|[1-9][0-9]{0,9})$/.exec(domain);
    if (match === null) refuse("launchd observation accepts only the gui/<uid> domain");
    const effectiveUid = this.#dependencies.effectiveUid();
    if (effectiveUid !== (await this.#dependencies.consoleUserUid())) refuse("effective uid is not the validated console user");
    if (Number(match[1]) !== effectiveUid) refuse("launchd domain names another uid");
    return domain;
  }

  async #admitHost(pass: Pass): Promise<void> {
    if (pass.launchctl === null) pass.launchctl = await admitLaunchdHost(this.#dependencies.host);
    else await recheckLaunchdHost(this.#dependencies.host, pass.launchctl);
  }

  async #admitEmptyDirectory(baseline: LaunchdEmptyDirectoryObservationV1 | null): Promise<LaunchdEmptyDirectoryObservationV1> {
    const expected = table.emptyDirectory;
    const directory = await this.#dependencies.inspectEmptyDirectory(expected.path);
    if (directory.kind !== "directory" || directory.ownerUid !== expected.ownerUid || directory.mode !== expected.mode) {
      throw new LaunchdDistributionUnsupportedError("empty directory identity");
    }
    if (directory.entryCount !== 0) throw new LaunchdDistributionUnsupportedError("empty directory has an entry");
    if (baseline !== null && (directory.dev !== baseline.dev || directory.ino !== baseline.ino)) {
      throw new LaunchdDistributionUnsupportedError("empty directory was replaced");
    }
    return directory;
  }

  async #probe(target: string, phase: SupervisedPhaseV1, pass: Pass): Promise<ProbeResultV1> {
    const { baseline } = pass;
    await this.#admitHost(pass);
    await this.#admitEmptyDirectory(baseline);
    if (phase.remainingMilliseconds() <= 0) return { kind: "unobservable", reason: "truncated" };
    const evidence = await this.#dependencies.runner.run({
      executable: table.executable.path,
      argv: ["print", target],
      env: { ...table.environment },
      cwd: table.emptyDirectory.path,
      stdin: "ignore",
      inheritedFds: [],
      stdoutCap: queryProfile.stdoutMaxBytes,
      stderrCap: queryProfile.stderrMaxBytes,
      idleMs: queryProfile.idleDeadlineMs,
      wallMs: queryProfile.wallDeadlineMs,
      terminationGraceMs: table.terminationGraceMs,
      phase,
    });
    await this.#admitEmptyDirectory(baseline);
    switch (evidence.termination) {
      case "exited":
        break;
      case "output_cap":
        return { kind: "unobservable", reason: "over_limit" };
      case "idle_deadline":
      case "wall_deadline":
      case "phase_deadline":
        return { kind: "unobservable", reason: "timeout" };
      default: {
        const unknown: never = evidence.termination;
        return refuse(`unknown termination ${String(unknown)}`);
      }
    }
    if (evidence.signal !== null || evidence.exitCode === null) return { kind: "unobservable", reason: "exit" };
    return { kind: "exited", exitCode: evidence.exitCode };
  }
}
