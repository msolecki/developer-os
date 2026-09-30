import { SCHEDULED_JOB_IDS, type LowerHexSha256, type ScheduledJobIdV1 } from "@developer-os/core";
import {
  SupervisedProcessRunner,
  type SupervisedPhaseV1,
  type SupervisedProcessDependenciesV1,
  type SupervisedProcessEvidenceV1,
  type SupervisedSpawnRequestV1,
} from "@developer-os/security";
import { describe, expect, it } from "vitest";

import { LaunchdDistributionUnsupportedError, type LaunchdHostObserverV1 } from "./distribution.js";
import { hostWith } from "./distribution.test-fixtures.js";
import {
  LaunchdObserver,
  type LaunchdEmptyDirectoryObservationV1,
  type LaunchdLiveObservationV1,
  type LaunchdObservationDependenciesV1,
  type LaunchdObservationJobV1,
  type LaunchdObservedStateV1,
} from "./observe.js";
import { LAUNCHD_PREVIEW_OBSERVATION_TABLE } from "./process-table.js";
import { generatedLabel, launchdGuiDomain, launchdJob } from "./registry.js";
import { LaunchdInputError, type LaunchdGuiDomainV1 } from "./types.js";

const UID = 501;
const domain = launchdGuiDomain(UID as Parameters<typeof launchdGuiDomain>[0]);
const OLD = "1".repeat(64) as LowerHexSha256;
const NEW = "2".repeat(64) as LowerHexSha256;
const OUTPUT_HASH = "f".repeat(64) as LowerHexSha256;

type Outcome = Partial<SupervisedProcessEvidenceV1>;

/** Scripted launchctl: every target not named exits 113 (absent); the domain exits 0 unless scripted. */
class ScriptedRunner {
  readonly requests: SupervisedSpawnRequestV1[] = [];
  outputParserCalls = 0;
  remaining = 30000;
  phaseWallMs: number | null = null;

  constructor(readonly outcomes: Readonly<Record<string, Outcome>> = {}) {}

  beginPhase(id: string, wallMs: number): SupervisedPhaseV1 {
    this.phaseWallMs = wallMs;
    return { id, deadlineAtMs: wallMs, remainingMilliseconds: () => this.remaining };
  }

  run(request: SupervisedSpawnRequestV1, sink?: unknown): Promise<SupervisedProcessEvidenceV1> {
    this.requests.push(request);
    if (sink !== undefined) this.outputParserCalls += 1;
    const target = request.argv[1] ?? "";
    const outcome = this.outcomes[target] ?? { exitCode: target === domain ? 0 : 113 };
    return Promise.resolve({
      exitCode: 0,
      signal: null,
      stdoutBytes: 4096,
      stderrBytes: 0,
      stdoutSha256: OUTPUT_HASH,
      stderrSha256: OUTPUT_HASH,
      termination: "exited",
      groupReaped: true,
      ...outcome,
    });
  }
}

const emptyDirectory: LaunchdEmptyDirectoryObservationV1 = { kind: "directory", ownerUid: 0, mode: 493, dev: "16777232", ino: "2", entryCount: 0 };

function host(runner: LaunchdObservationDependenciesV1["runner"], overrides: Partial<LaunchdObservationDependenciesV1> = {}): LaunchdObservationDependenciesV1 {
  return {
    runner,
    effectiveUid: () => UID,
    consoleUserUid: () => Promise.resolve(UID),
    host: hostWith(),
    inspectEmptyDirectory: () => Promise.resolve({ ...emptyDirectory }),
    ...overrides,
  };
}

function target(label: string): string {
  return `${domain}/${label}`;
}

const doctor = {
  base: launchdJob("doctor").baseLabel,
  old: generatedLabel("doctor", OLD),
  new: generatedLabel("doctor", NEW),
};

const replaceDoctor: LaunchdObservationJobV1 = { job: "doctor", retained: doctor.old, planned: doctor.new };

function observed(state: LaunchdObservedStateV1): LaunchdLiveObservationV1 {
  return { kind: "observed", jobs: [{ job: "doctor", state }] };
}

const liveObservationFixtures: readonly {
  readonly name: string;
  readonly job: LaunchdObservationJobV1;
  readonly present: readonly string[];
  readonly expected: LaunchdLiveObservationV1;
}[] = [
  { name: "unloaded", job: replaceDoctor, present: [], expected: observed({ kind: "unloaded" }) },
  { name: "exact old generation", job: replaceDoctor, present: [doctor.old], expected: observed({ kind: "exact_old", label: doctor.old, generation: OLD }) },
  { name: "exact new generation", job: replaceDoctor, present: [doctor.new], expected: observed({ kind: "exact_new", label: doctor.new, generation: NEW }) },
  {
    name: "keep already loaded",
    job: { job: "doctor", retained: doctor.new, planned: doctor.new },
    present: [doctor.new],
    expected: observed({ kind: "exact_new", label: doctor.new, generation: NEW }),
  },
  { name: "install from nothing", job: { job: "doctor", retained: null, planned: doctor.new }, present: [], expected: observed({ kind: "unloaded" }) },
  { name: "remove from loaded", job: { job: "doctor", retained: doctor.old, planned: null }, present: [doctor.old], expected: observed({ kind: "exact_old", label: doctor.old, generation: OLD }) },
  { name: "unsuffixed base label", job: replaceDoctor, present: [doctor.base], expected: observed({ kind: "third_state", reason: "unsuffixed_collision" }) },
  { name: "base label beside a generation", job: replaceDoctor, present: [doctor.base, doctor.new], expected: observed({ kind: "third_state", reason: "unsuffixed_collision" }) },
  { name: "both generations", job: replaceDoctor, present: [doctor.old, doctor.new], expected: observed({ kind: "third_state", reason: "dual_generation" }) },
];

const unobservableFixtures: readonly { readonly name: string; readonly outcomes: Readonly<Record<string, Outcome>>; readonly reason: string }[] = [
  { name: "a failing domain probe", outcomes: { [domain]: { exitCode: 3 } }, reason: "exit" },
  { name: "domain probe exit 113", outcomes: { [domain]: { exitCode: 113 } }, reason: "exit" },
  { name: "a service exit other than 0 or 113", outcomes: { [target(doctor.new)]: { exitCode: 5 } }, reason: "exit" },
  { name: "a signalled probe", outcomes: { [target(doctor.old)]: { exitCode: null, signal: "SIGKILL" } }, reason: "exit" },
  { name: "stdout over 4 MiB", outcomes: { [target(doctor.base)]: { termination: "output_cap", exitCode: null, signal: "SIGKILL" } }, reason: "over_limit" },
  { name: "stderr over 1 MiB", outcomes: { [domain]: { termination: "output_cap", exitCode: null, signal: "SIGTERM" } }, reason: "over_limit" },
  { name: "the idle deadline", outcomes: { [target(doctor.old)]: { termination: "idle_deadline", exitCode: null, signal: "SIGTERM" } }, reason: "timeout" },
  { name: "the process wall deadline", outcomes: { [target(doctor.new)]: { termination: "wall_deadline", exitCode: null, signal: "SIGTERM" } }, reason: "timeout" },
  { name: "the shared observation deadline", outcomes: { [domain]: { termination: "phase_deadline", exitCode: null, signal: "SIGKILL" } }, reason: "timeout" },
];

describe("LaunchdObserver", () => {
  it("has live-state fixtures", () => {
    expect(liveObservationFixtures.length).toBeGreaterThan(0);
    expect(unobservableFixtures.length).toBeGreaterThan(0);
  });

  it.each(liveObservationFixtures)("classifies $name only from queried target and exit", async ({ job, present, expected }) => {
    const runner = new ScriptedRunner(Object.fromEntries(present.map((label) => [target(label), { exitCode: 0 }])));
    const result = await new LaunchdObserver(host(runner)).observe({ domain, jobs: [job] });
    expect(result).toEqual(expected);
    expect(runner.outputParserCalls).toBe(0);
    expect(JSON.stringify(result)).not.toContain(OUTPUT_HASH);
  });

  it.each(unobservableFixtures)("reports $name as unobservable", async ({ outcomes, reason }) => {
    const runner = new ScriptedRunner(outcomes);
    const result = await new LaunchdObserver(host(runner)).observe({ domain, jobs: [replaceDoctor] });
    expect(result).toEqual({ kind: "unobservable", reason });
  });

  it("stops probing at the first unobservable answer", async () => {
    const runner = new ScriptedRunner({ [domain]: { exitCode: 1 } });
    await new LaunchdObserver(host(runner)).observe({ domain, jobs: [replaceDoctor] });
    expect(runner.requests).toHaveLength(1);
  });

  it("probes the domain first, then each job's candidates in UTF-8 target order", async () => {
    const runner = new ScriptedRunner();
    await new LaunchdObserver(host(runner)).observe({ domain, jobs: [replaceDoctor] });
    expect(runner.requests.map((request) => request.argv)).toEqual([
      ["print", domain],
      ["print", target(doctor.base)],
      ["print", target(doctor.old)],
      ["print", target(doctor.new)],
    ]);
  });

  it("issues at most 19 probes for a complete six-job observation", async () => {
    const jobs = SCHEDULED_JOB_IDS.map((job: ScheduledJobIdV1) => ({ job, retained: generatedLabel(job, OLD), planned: generatedLabel(job, NEW) }));
    expect(jobs).toHaveLength(6);
    const runner = new ScriptedRunner();
    const result = await new LaunchdObserver(host(runner)).observe({ domain, jobs });
    expect(runner.requests).toHaveLength(19);
    expect(result).toEqual({ kind: "observed", jobs: SCHEDULED_JOB_IDS.map((job) => ({ job, state: { kind: "unloaded" } })) });
  });

  it("deduplicates a keep entry's candidates", async () => {
    const runner = new ScriptedRunner();
    await new LaunchdObserver(host(runner)).observe({ domain, jobs: [{ job: "doctor", retained: doctor.new, planned: doctor.new }] });
    expect(runner.requests).toHaveLength(3);
  });

  it("runs only the two print forms with the exact environment, cwd, caps, deadlines and grace", async () => {
    const runner = new ScriptedRunner();
    await new LaunchdObserver(host(runner)).observe({ domain, jobs: [replaceDoctor] });
    expect(runner.requests.length).toBeGreaterThan(0);
    expect(runner.phaseWallMs).toBe(30000);
    for (const request of runner.requests) {
      expect(request.executable).toBe("/bin/launchctl");
      expect(request.argv).toHaveLength(2);
      expect(request.argv[0]).toBe("print");
      expect(request.argv).not.toContain("bootstrap");
      expect(request.argv).not.toContain("bootout");
      expect(request.env).toEqual({
        HOME: "/private/var/empty",
        LANG: "C",
        LC_ALL: "C",
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        TMPDIR: "/private/var/empty",
      });
      expect(request.cwd).toBe("/private/var/empty");
      expect(request.stdin).toBe("ignore");
      expect(request.inheritedFds).toEqual([]);
      expect(request.stdoutCap).toBe(4194304);
      expect(request.stderrCap).toBe(1048576);
      expect(request.idleMs).toBe(30000);
      expect(request.wallMs).toBe(30000);
      expect(request.terminationGraceMs).toBe(100);
    }
  });

  it("shares one observation phase across every probe", async () => {
    const runner = new ScriptedRunner();
    await new LaunchdObserver(host(runner)).observe({ domain, jobs: [replaceDoctor] });
    const phases = new Set(runner.requests.map((request) => request.phase));
    expect(runner.requests.length).toBeGreaterThan(1);
    expect(phases.size).toBe(1);
  });

  it("reports a pass whose shared deadline has run out as truncated without spawning", async () => {
    const runner = new ScriptedRunner();
    runner.remaining = 0;
    const result = await new LaunchdObserver(host(runner)).observe({ domain, jobs: [replaceDoctor] });
    expect(result).toEqual({ kind: "unobservable", reason: "truncated" });
    expect(runner.requests).toHaveLength(0);
  });

  it("verifies the OS, launchctl and the empty directory before every process and the directory after it", async () => {
    const calls = { os: 0, executable: 0, directory: 0 };
    const admitted = hostWith();
    const counting: LaunchdHostObserverV1 = {
      operatingSystem: () => {
        calls.os += 1;
        return admitted.operatingSystem();
      },
      inspect: (path) => {
        if (path === "/bin/launchctl") calls.executable += 1;
        return admitted.inspect(path);
      },
    };
    const runner = new ScriptedRunner();
    await new LaunchdObserver(
      host(runner, {
        host: counting,
        inspectEmptyDirectory: () => {
          calls.directory += 1;
          return Promise.resolve({ ...emptyDirectory });
        },
      }),
    ).observe({ domain, jobs: [replaceDoctor] });
    const processes = runner.requests.length;
    expect(processes).toBe(4);
    expect(calls).toEqual({ os: processes, executable: processes, directory: 1 + 2 * processes });
  });

  it("never compares the macOS build", async () => {
    const runner = new ScriptedRunner();
    await expect(new LaunchdObserver(host(runner, { host: hostWith({ buildVersion: "25G84" }) })).observe({ domain, jobs: [replaceDoctor] })).resolves.toMatchObject({
      kind: "observed",
    });
  });

  it.each([
    { name: "macOS below the floor", overrides: { host: hostWith({ productVersion: "26.6.1" }) } },
    { name: "malformed macOS version", overrides: { host: hostWith({ productVersion: "26.x" }) } },
    { name: "user-owned launchctl", overrides: { host: hostWith({ paths: { "/bin/launchctl": { ownerUid: UID } } }) } },
    { name: "group-writable launchctl", overrides: { host: hostWith({ paths: { "/bin/launchctl": { mode: 0o775 } } }) } },
    { name: "symlinked launchctl", overrides: { host: hostWith({ paths: { "/bin/launchctl": { kind: "symlink" as const } } }) } },
    { name: "group-writable /bin", overrides: { host: hostWith({ paths: { "/bin": { mode: 0o775 } } }) } },
    { name: "empty directory owner", overrides: { inspectEmptyDirectory: () => Promise.resolve({ ...emptyDirectory, ownerUid: UID }) } },
    { name: "empty directory mode", overrides: { inspectEmptyDirectory: () => Promise.resolve({ ...emptyDirectory, mode: 0o777 }) } },
    { name: "empty directory symlink", overrides: { inspectEmptyDirectory: () => Promise.resolve({ ...emptyDirectory, kind: "symlink" as const }) } },
    { name: "empty directory entry", overrides: { inspectEmptyDirectory: () => Promise.resolve({ ...emptyDirectory, entryCount: 1 }) } },
  ])("refuses $name drift before any process", async ({ overrides }) => {
    const runner = new ScriptedRunner();
    await expect(new LaunchdObserver(host(runner, overrides)).observe({ domain, jobs: [replaceDoctor] })).rejects.toThrow(LaunchdDistributionUnsupportedError);
    expect(runner.requests).toHaveLength(0);
  });

  it("refuses launchctl drift between two probes of one pass", async () => {
    let inspections = 0;
    const [first, later] = [hostWith(), hostWith({ paths: { "/bin/launchctl": { size: 300001 } } })];
    const runner = new ScriptedRunner();
    const observer = new LaunchdObserver(
      host(runner, {
        host: {
          operatingSystem: () => first.operatingSystem(),
          inspect: (path) => {
            if (path === "/bin/launchctl") inspections += 1;
            return (inspections > 1 ? later : first).inspect(path);
          },
        },
      }),
    );
    await expect(observer.observe({ domain, jobs: [replaceDoctor] })).rejects.toThrow("unsupported_launchd_distribution");
    expect(runner.requests).toHaveLength(1);
  });

  it("refuses an empty directory replaced or written during a probe", async () => {
    let inspections = 0;
    const runner = new ScriptedRunner();
    const observer = new LaunchdObserver(
      host(runner, {
        inspectEmptyDirectory: () => {
          inspections += 1;
          return Promise.resolve({ ...emptyDirectory, ino: inspections > 2 ? "3" : emptyDirectory.ino });
        },
      }),
    );
    await expect(observer.observe({ domain, jobs: [replaceDoctor] })).rejects.toThrow(LaunchdDistributionUnsupportedError);
    expect(runner.requests).toHaveLength(1);
  });

  it.each(["system", "user/501", "login/501", "pid/1", "gui/502", "gui/0501", "gui/501/extra", "gui/"])("refuses the %s domain", async (text) => {
    const runner = new ScriptedRunner();
    await expect(new LaunchdObserver(host(runner)).observe({ domain: text as LaunchdGuiDomainV1, jobs: [replaceDoctor] })).rejects.toThrow(LaunchdInputError);
    expect(runner.requests).toHaveLength(0);
  });

  it("refuses an effective UID that is not the validated console user", async () => {
    const runner = new ScriptedRunner();
    const observer = new LaunchdObserver(host(runner, { consoleUserUid: () => Promise.resolve(UID + 1) }));
    await expect(observer.observe({ domain, jobs: [replaceDoctor] })).rejects.toThrow(LaunchdInputError);
    expect(runner.requests).toHaveLength(0);
  });

  it.each([
    { name: "more than six jobs", jobs: [...SCHEDULED_JOB_IDS, "doctor" as const].map((job) => ({ job, retained: null, planned: null })) },
    { name: "a duplicate job", jobs: [replaceDoctor, replaceDoctor] },
    { name: "a retained label of another job", jobs: [{ job: "doctor" as const, retained: generatedLabel("brain-lint", OLD), planned: null }] },
    { name: "a planned label of another job", jobs: [{ job: "doctor" as const, retained: null, planned: generatedLabel("git-sync", NEW) }] },
    { name: "an unknown job", jobs: [{ job: "import" as ScheduledJobIdV1, retained: null, planned: null }] },
  ])("refuses a request with $name", async ({ jobs }) => {
    const runner = new ScriptedRunner();
    await expect(new LaunchdObserver(host(runner)).observe({ domain, jobs })).rejects.toThrow(LaunchdInputError);
    expect(runner.requests).toHaveLength(0);
  });

  it("terminates a hung probe's whole process group after a 100-ms grace and reaps it", async () => {
    const signals: [number, string][] = [];
    const timers: number[] = [];
    let finish: (signal: string) => void = () => undefined;
    let releaseOutput: () => void = () => undefined;
    const outputClosed = new Promise<void>((resolve) => {
      releaseOutput = resolve;
    });
    const hung: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]: () => ({
        next: async (): Promise<IteratorResult<Uint8Array>> => {
          await outputClosed;
          return { done: true, value: undefined };
        },
      }),
    };
    let reaped = false;
    const dependencies: SupervisedProcessDependenciesV1 = {
      spawn: () => ({
        pid: 4242,
        stdout: hung,
        stderr: hung,
        closed: new Promise((resolve) => {
          finish = (signal) => {
            reaped = true;
            resolve({ exitCode: null, signal });
          };
        }),
        closeOutput: () => {
          releaseOutput();
        },
      }),
      killGroup: (pid, signal) => {
        signals.push([pid, signal]);
        if (signal === "SIGKILL") finish(signal);
      },
      now: () => 0,
      setTimer: (ms, fire) => {
        timers.push(ms);
        let live = true;
        setImmediate(() => {
          if (live) fire();
        });
        return () => {
          live = false;
        };
      },
    };
    const result = await new LaunchdObserver(host(new SupervisedProcessRunner(dependencies))).observe({ domain, jobs: [replaceDoctor] });
    expect(result).toEqual({ kind: "unobservable", reason: "timeout" });
    expect(signals).toEqual([
      [4242, "SIGTERM"],
      [4242, "SIGKILL"],
    ]);
    expect(timers).toContain(LAUNCHD_PREVIEW_OBSERVATION_TABLE.terminationGraceMs);
    expect(timers[0]).toBe(30000);
    expect(reaped).toBe(true);
  });
});
