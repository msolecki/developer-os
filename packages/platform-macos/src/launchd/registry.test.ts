import {
  SCHEDULED_JOB_IDS,
  hashCanonicalJson,
  lifecycleConfigHash,
  type CanonicalAbsolutePathV1,
  type EffectiveUidV1,
  type GitSyncConfigV1,
  type LifecycleActivationRecordV1,
  type LowerHexSha256,
} from "@developer-os/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LAUNCHD_JOBS,
  eligibleLaunchdJobs,
  generatedLabel,
  gitSyncEligible,
  launchdGeneration,
  launchdGuiDomain,
  launchdJob,
  launchdLogPath,
  launchdPlistPath,
  launchdStatusPath,
  parseGeneratedLabel,
  parseScheduledProductHome,
  scheduledBaseArgv,
  scheduledArgvParts,
  scheduledProgramArguments,
} from "./registry.js";
import type { LaunchdGenerationProjectionV1 } from "./types.js";

const userHome = "/Users/fixture" as CanonicalAbsolutePathV1;
const productHome = parseScheduledProductHome("/Users/fixture/.developer-os");
const executable = "/usr/local/bin/developer-os" as CanonicalAbsolutePathV1;
const node = "/opt/homebrew/opt/node@24/bin/node" as CanonicalAbsolutePathV1;
const domain = launchdGuiDomain(501 as EffectiveUidV1);
const generation = "a".repeat(64) as LowerHexSha256;

function projection(overrides: Partial<LaunchdGenerationProjectionV1> = {}): LaunchdGenerationProjectionV1 {
  return {
    job: "brain-reindex",
    baseLabel: "com.developer-os.brain-reindex",
    domain,
    schedule: { cadence: "daily", hour: 2, minute: 0 },
    productHome,
    plistPath: launchdPlistPath(userHome, "brain-reindex"),
    executablePath: executable,
    baseArgv: scheduledBaseArgv("brain-reindex", productHome, executable, node),
    logPath: launchdLogPath(productHome, "brain-reindex"),
    statusPath: launchdStatusPath(productHome, "brain-reindex"),
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("closed job registry", () => {
  it("enumerates exactly the six jobs in canonical order", () => {
    expect(LAUNCHD_JOBS.map((job) => job.id)).toEqual(["brain-reindex", "brain-lint", "doctor", "git-sync", "brain-garden", "brain-pulse"]);
  });

  it("defines brain-garden as the only vendor-spawning job", () => {
    const spawning = SCHEDULED_JOB_IDS.filter((id) => launchdJob(id).maySpawnVendor);
    expect(spawning).toEqual(["brain-garden"]);
    expect(launchdJob("brain-pulse")).toMatchObject({ baseLabel: "com.developer-os.brain-pulse", requiresGitActivation: false, maySpawnVendor: false });
  });

  it("follows the core registry order and gates only git-sync on Git activation", () => {
    expect(SCHEDULED_JOB_IDS.length).toBeGreaterThan(0);
    expect(LAUNCHD_JOBS.map((job) => job.id)).toEqual([...SCHEDULED_JOB_IDS]);
    expect(LAUNCHD_JOBS.filter((job) => job.requiresGitActivation).map((job) => job.id)).toEqual(["git-sync"]);
    expect(Object.isFrozen(LAUNCHD_JOBS)).toBe(true);
  });

  it("maps every job to its exact base label and LaunchAgents path", () => {
    const rows = LAUNCHD_JOBS.map((job) => [job.id, job.baseLabel, launchdPlistPath(userHome, job.id)]);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows).toEqual([
      ["brain-reindex", "com.developer-os.brain-reindex", "/Users/fixture/Library/LaunchAgents/com.developer-os.brain-reindex.plist"],
      ["brain-lint", "com.developer-os.brain-lint", "/Users/fixture/Library/LaunchAgents/com.developer-os.brain-lint.plist"],
      ["doctor", "com.developer-os.doctor", "/Users/fixture/Library/LaunchAgents/com.developer-os.doctor.plist"],
      ["git-sync", "com.developer-os.git-sync", "/Users/fixture/Library/LaunchAgents/com.developer-os.git-sync.plist"],
      ["brain-garden", "com.developer-os.brain-garden", "/Users/fixture/Library/LaunchAgents/com.developer-os.brain-garden.plist"],
      ["brain-pulse", "com.developer-os.brain-pulse", "/Users/fixture/Library/LaunchAgents/com.developer-os.brain-pulse.plist"],
    ]);
  });

  it.each(["import", "ingest", "brain-index", "", "Doctor"])("refuses unknown job %j", (id) => {
    expect(() => launchdJob(id)).toThrow();
  });

  it("derives the current log slot and the status record inside the product home", () => {
    expect(launchdLogPath(productHome, "doctor")).toBe("/Users/fixture/.developer-os/logs/automation-doctor.0.json");
    expect(launchdStatusPath(productHome, "doctor")).toBe("/Users/fixture/.developer-os/state/automation-doctor.status.json");
  });

  it("encodes the effective uid as the one GUI domain", () => {
    expect(launchdGuiDomain(0 as EffectiveUidV1)).toBe("gui/0");
    expect(launchdGuiDomain(501 as EffectiveUidV1)).toBe("gui/501");
    expect(() => launchdGuiDomain(-1 as EffectiveUidV1)).toThrow();
    expect(() => launchdGuiDomain(1.5 as EffectiveUidV1)).toThrow();
  });
});

describe("scheduled argv", () => {
  it("builds exactly ten arguments: the absolute Node, the entrypoint, the guarded product home and the generation last (NEW-144)", () => {
    const argv = scheduledProgramArguments("git-sync", productHome, generation, executable, node);
    expect(argv).toEqual([
      "/opt/homebrew/opt/node@24/bin/node",
      "/usr/local/bin/developer-os",
      "automation",
      "run",
      "git-sync",
      "--scheduled",
      "--product-home",
      "/Users/fixture/.developer-os",
      "--generation",
      generation,
    ]);
    expect(argv).toHaveLength(10);
  });

  it("splits a current argv and a legacy pre-NEW-144 nine-argument argv into node, entrypoint and product home", () => {
    const current = scheduledProgramArguments("doctor", productHome, generation, executable, node);
    expect(scheduledArgvParts(current)).toEqual({ node, executable, productHome });
    const legacy = current.slice(1);
    expect(scheduledArgvParts(legacy)).toEqual({ node: null, executable, productHome });
    expect(() => scheduledArgvParts(current.slice(2))).toThrow();
  });

  it("refuses a relative Node", () => {
    expect(() => scheduledProgramArguments("doctor", productHome, generation, executable, "node" as CanonicalAbsolutePathV1)).toThrow();
  });

  it("keeps a custom product home with spaces and markup characters as one argument", () => {
    const home = parseScheduledProductHome("/Volumes/Data drive/a&b<c>\"d\"/dev os");
    const argv = scheduledProgramArguments("doctor", home, generation, executable, node);
    expect(argv[7]).toBe("/Volumes/Data drive/a&b<c>\"d\"/dev os");
    expect(argv).toHaveLength(10);
  });

  it.each([
    ["relative", "relative/home"],
    ["trailing slash", "/Users/fixture/"],
    ["dot component", "/Users/./fixture"],
    ["line feed", "/Users/fix\nture"],
    ["C1 control", "/Users/fix\u0085ture"],
    ["line separator", "/Users/fix\u2028ture"],
    ["non-character", "/Users/fix\uffffture"],
    ["lone surrogate", "/Users/fix\ud800ture"],
    ["over 4096 bytes", `/${"x".repeat(4096)}`],
    ["decomposed", "/Users/e\u0301"],
  ])("refuses a product home that is %s", (_label, value) => {
    expect(() => parseScheduledProductHome(value)).toThrow();
  });

  it("refuses a malformed generation", () => {
    expect(() => scheduledProgramArguments("doctor", productHome, "A".repeat(64) as LowerHexSha256, executable, node)).toThrow();
    expect(() => generatedLabel("doctor", "abc" as LowerHexSha256)).toThrow();
  });
});

describe("generation", () => {
  it("is the domain-separated digest of the exact projection", () => {
    const value = projection();
    const canonical = {
      job: value.job,
      baseLabel: value.baseLabel,
      domain: value.domain,
      schedule: { ...value.schedule },
      productHome: value.productHome,
      plistPath: value.plistPath,
      executablePath: value.executablePath,
      baseArgv: [...value.baseArgv],
      logPath: value.logPath,
      statusPath: value.statusPath,
    };
    expect(launchdGeneration(value)).toBe(hashCanonicalJson("developer-os:launchd-generation:v1", canonical));
    expect(launchdGeneration(value)).not.toBe(hashCanonicalJson("developer-os:launchd-generation:v2", canonical));
  });

  it("changes with the schedule and the product home", () => {
    const base = launchdGeneration(projection());
    expect(launchdGeneration(projection({ schedule: { cadence: "daily", hour: 2, minute: 1 } }))).not.toBe(base);
    const otherNode = "/usr/local/bin/node" as CanonicalAbsolutePathV1;
    expect(launchdGeneration(projection({ baseArgv: scheduledBaseArgv("brain-reindex", productHome, executable, otherNode) }))).not.toBe(base);
    const otherHome = parseScheduledProductHome("/Users/fixture/other");
    expect(
      launchdGeneration(
        projection({
          productHome: otherHome,
          baseArgv: scheduledBaseArgv("brain-reindex", otherHome, executable, node),
          logPath: launchdLogPath(otherHome, "brain-reindex"),
          statusPath: launchdStatusPath(otherHome, "brain-reindex"),
        }),
      ),
    ).not.toBe(base);
  });

  it.each([
    ["base label", { baseLabel: "com.developer-os.doctor" as const }],
    ["domain", { domain: "user/501" as LaunchdGenerationProjectionV1["domain"] }],
    ["schedule", { schedule: { cadence: "hourly" as const, minute: 60 } }],
    ["plist path", { plistPath: "/Users/fixture/Library/LaunchAgents/other.plist" as CanonicalAbsolutePathV1 }],
    ["base argv", { baseArgv: scheduledBaseArgv("doctor", productHome, executable, node) }],
    ["log path", { logPath: "/tmp/log.json" as CanonicalAbsolutePathV1 }],
    ["status path", { statusPath: "/tmp/status.json" as CanonicalAbsolutePathV1 }],
  ])("refuses a projection whose %s disagrees with the job", (_label, overrides) => {
    expect(() => launchdGeneration(projection(overrides))).toThrow();
  });

  it("appends the generation to the base label and parses it back", () => {
    const label = generatedLabel("git-sync", generation);
    expect(label).toBe(`com.developer-os.git-sync.g.${generation}`);
    expect(parseGeneratedLabel(label)).toEqual({ job: "git-sync", generation });
    expect(() => parseGeneratedLabel("com.developer-os.git-sync")).toThrow();
    expect(() => parseGeneratedLabel(`com.example.git-sync.g.${generation}`)).toThrow();
    expect(() => parseGeneratedLabel(`com.developer-os.import.g.${generation}`)).toThrow();
  });

  it("ignores ambient HOME and product-home overrides", () => {
    const before = [launchdGeneration(projection()), launchdPlistPath(userHome, "doctor"), launchdLogPath(productHome, "doctor")];
    vi.stubEnv("HOME", "/tmp/ambient-home");
    vi.stubEnv("DEVELOPER_OS_HOME", "/tmp/ambient-product");
    vi.stubEnv("DEVELOPER_OS_BRAIN", "/tmp/ambient-brain");
    expect([launchdGeneration(projection()), launchdPlistPath(userHome, "doctor"), launchdLogPath(productHome, "doctor")]).toEqual(before);
  });
});

describe("git-sync eligibility", () => {
  const git: GitSyncConfigV1 = {
    schemaVersion: 1,
    repositoryRoot: "/Users/fixture/notes" as CanonicalAbsolutePathV1,
    branch: "main" as GitSyncConfigV1["branch"],
    remote: {
      name: "developer-os",
      transport: "local",
      declaredUrl: "/Users/fixture/remote.git" as GitSyncConfigV1["remote"]["declaredUrl"],
      effectivePushUrl: "/Users/fixture/remote.git" as GitSyncConfigV1["remote"]["effectivePushUrl"],
    },
    scope: {
      brainPath: "/Users/fixture/notes" as CanonicalAbsolutePathV1,
      contentRoot: "content" as GitSyncConfigV1["scope"]["contentRoot"],
      topicFolders: [],
      topicAliases: {},
      indexesDir: "_indexes" as GitSyncConfigV1["scope"]["indexesDir"],
      fingerprint: "b".repeat(64) as LowerHexSha256,
    },
  };

  function activation(gitArm: LifecycleActivationRecordV1["git"]): LifecycleActivationRecordV1 {
    return { schemaVersion: 1, git: gitArm, automation: { state: "inactive" } };
  }

  it("requires the flag, the record and a matching active arm", () => {
    const active = activation({ state: "active", configHash: lifecycleConfigHash("git", git) });
    expect(gitSyncEligible({ enabled: true, lifecycle: git }, active)).toBe(true);
    expect(gitSyncEligible({ enabled: false, lifecycle: git }, active)).toBe(false);
    expect(gitSyncEligible({ enabled: true }, active)).toBe(false);
    expect(gitSyncEligible({ enabled: true, lifecycle: git }, activation({ state: "inactive" }))).toBe(false);
    expect(
      gitSyncEligible({ enabled: true, lifecycle: git }, activation({ state: "active", configHash: "c".repeat(64) as LowerHexSha256 })),
    ).toBe(false);
  });

  it("omits only git-sync without Git", () => {
    expect(eligibleLaunchdJobs(false).map((job) => job.id)).toEqual(["brain-reindex", "brain-lint", "doctor", "brain-garden", "brain-pulse"]);
    expect(eligibleLaunchdJobs(true).map((job) => job.id)).toEqual([...SCHEDULED_JOB_IDS]);
  });
});
