import {
  hashBytes,
  type AutomationConfigV1,
  type CanonicalAbsolutePathV1,
  type EffectiveUidV1,
  type LowerHexSha256,
  type ScheduledJobIdV1,
} from "@developer-os/core";
import { describe, expect, it } from "vitest";

import {
  MAX_LAUNCHD_PLIST_BYTES,
  boundedCanonicalPlistXml,
  buildLaunchdPlanPreview,
  encodeLaunchdPlist,
  launchdPlistDictionary,
  launchdPriorStateFingerprint,
} from "./plist.js";
import {
  generatedLabel,
  launchdGeneration,
  launchdGuiDomain,
  launchdLogPath,
  launchdPlistPath,
  launchdStatusPath,
  parseScheduledProductHome,
  scheduledBaseArgv,
} from "./registry.js";
import type {
  LaunchdGenerationProjectionV1,
  LaunchdPlistDictionaryV1,
  LaunchdPreviewRequestV1,
  LaunchdPriorJobStateV1,
} from "./types.js";

const encoder = new TextEncoder();
const userHome = "/Users/a b" as CanonicalAbsolutePathV1;
const executable = "/usr/local/bin/developer-os" as CanonicalAbsolutePathV1;
const domain = launchdGuiDomain(501 as EffectiveUidV1);
const hostileHome = "/Users/a b/&<\"é>/.developer-os";
const observationHash = "1".repeat(64) as LowerHexSha256;
const templateHash = "2".repeat(64) as LowerHexSha256;

function projectionFor(home: string, job: ScheduledJobIdV1 = "brain-reindex"): LaunchdGenerationProjectionV1 {
  const productHome = parseScheduledProductHome(home);
  return {
    job,
    baseLabel: `com.developer-os.${job}`,
    domain,
    schedule: { cadence: "daily", hour: 2, minute: 0 },
    productHome,
    plistPath: launchdPlistPath(userHome, job),
    executablePath: executable,
    baseArgv: scheduledBaseArgv(job, productHome, executable),
    logPath: launchdLogPath(productHome, job),
    statusPath: launchdStatusPath(productHome, job),
  };
}

function plistFor(home: string): LaunchdPlistDictionaryV1 {
  const projection = projectionFor(home);
  return launchdPlistDictionary(projection, launchdGeneration(projection));
}

const hostileGeneration = launchdGeneration(projectionFor(hostileHome));
const escapedHome = "/Users/a b/&amp;&lt;\"é&gt;/.developer-os";

const expectedPlistXml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
  '<plist version="1.0">',
  "  <dict>",
  "    <key>Label</key>",
  `    <string>com.developer-os.brain-reindex.g.${hostileGeneration}</string>`,
  "    <key>ProgramArguments</key>",
  "    <array>",
  "      <string>/usr/local/bin/developer-os</string>",
  "      <string>automation</string>",
  "      <string>run</string>",
  "      <string>brain-reindex</string>",
  "      <string>--scheduled</string>",
  "      <string>--product-home</string>",
  `      <string>${escapedHome}</string>`,
  "      <string>--generation</string>",
  `      <string>${hostileGeneration}</string>`,
  "    </array>",
  "    <key>StartCalendarInterval</key>",
  "    <dict>",
  "      <key>Hour</key>",
  "      <integer>2</integer>",
  "      <key>Minute</key>",
  "      <integer>0</integer>",
  "    </dict>",
  "    <key>StandardOutPath</key>",
  "    <string>/dev/null</string>",
  "    <key>StandardErrorPath</key>",
  "    <string>/dev/null</string>",
  "  </dict>",
  "</plist>",
  "",
].join("\n");

describe("encodeLaunchdPlist", () => {
  it("serializes the exact five-key plist with one LF and escapes a hostile home", () => {
    const xml = encodeLaunchdPlist(plistFor("/Users/a b/&<\"é>/.developer-os"));
    expect(xml).toBe(expectedPlistXml);
    expect(xml.endsWith("</plist>\n")).toBe(true);
    expect(encodeLaunchdPlist(plistFor("/Users/a b/&<\"é>/.developer-os"))).toBe(xml);
  });

  it("emits the five root keys in schema order and nothing else", () => {
    const xml = encodeLaunchdPlist(plistFor("/Users/a b/.developer-os"));
    const rootKeys = [...xml.matchAll(/^ {4}<key>([A-Za-z]+)<\/key>$/gm)].map((match) => match[1]);
    expect(rootKeys.length).toBeGreaterThan(0);
    expect(rootKeys).toEqual(["Label", "ProgramArguments", "StartCalendarInterval", "StandardOutPath", "StandardErrorPath"]);
    expect(xml).not.toMatch(/\r|\t|<!\[CDATA\[|&#|<!--|\/>|^\uFEFF/);
    expect(xml.match(/<string>\/dev\/null<\/string>/g)).toHaveLength(2);
    expect(xml.match(/^ {6}<string>/gm)).toHaveLength(9);
  });

  it("emits hourly and weekly calendar dictionaries in their fixed key order", () => {
    const hourly = plistFor("/Users/a b/.developer-os");
    const hourlyXml = encodeLaunchdPlist({ ...hourly, StartCalendarInterval: { Minute: 15 } });
    expect(hourlyXml).toContain("    <dict>\n      <key>Minute</key>\n      <integer>15</integer>\n    </dict>\n");
    const weeklyXml = encodeLaunchdPlist({ ...hourly, StartCalendarInterval: { Weekday: 0, Hour: 23, Minute: 59 } });
    expect(weeklyXml).toContain(
      "      <key>Weekday</key>\n      <integer>0</integer>\n      <key>Hour</key>\n      <integer>23</integer>\n      <key>Minute</key>\n      <integer>59</integer>\n",
    );
  });

  it("uses the literal null sink for both output paths and refuses anything else", () => {
    const value = plistFor("/Users/a b/.developer-os");
    expect(value.StandardOutPath).toBe("/dev/null");
    expect(value.StandardErrorPath).toBe("/dev/null");
    expect(() => encodeLaunchdPlist({ ...value, StandardOutPath: "/tmp/out.log" as "/dev/null" })).toThrow();
    expect(() => encodeLaunchdPlist({ ...value, StandardErrorPath: "/dev/stderr" as "/dev/null" })).toThrow();
  });

  it.each(["RunAtLoad", "KeepAlive", "StartInterval", "EnvironmentVariables", "WorkingDirectory", "UserName"])(
    "refuses the extra key %s",
    (key) => {
      const value = { ...plistFor("/Users/a b/.developer-os"), [key]: true };
      expect(() => encodeLaunchdPlist(value)).toThrow();
    },
  );

  it("refuses argv or calendar values outside the bound grammar", () => {
    const value = plistFor("/Users/a b/.developer-os");
    const argv = [...value.ProgramArguments];
    expect(() => encodeLaunchdPlist({ ...value, ProgramArguments: argv.slice(0, 8) as unknown as typeof value.ProgramArguments })).toThrow();
    const otherGeneration = [...argv.slice(0, 8), "f".repeat(64)] as unknown as typeof value.ProgramArguments;
    expect(() => encodeLaunchdPlist({ ...value, ProgramArguments: otherGeneration })).toThrow();
    const otherJob = [...argv.slice(0, 3), "doctor", ...argv.slice(4)] as unknown as typeof value.ProgramArguments;
    expect(() => encodeLaunchdPlist({ ...value, ProgramArguments: otherJob })).toThrow();
    expect(() => encodeLaunchdPlist({ ...value, Label: "com.developer-os.brain-reindex" as typeof value.Label })).toThrow();
    expect(() => encodeLaunchdPlist({ ...value, StartCalendarInterval: { Minute: 60 } })).toThrow();
    expect(() => encodeLaunchdPlist({ ...value, StartCalendarInterval: { Weekday: 7, Hour: 0, Minute: 0 } })).toThrow();
    expect(() =>
      encodeLaunchdPlist({ ...value, StartCalendarInterval: { Hour: 1, Minute: 0, Day: 1 } as unknown as typeof value.StartCalendarInterval }),
    ).toThrow();
  });
});

describe("boundedCanonicalPlistXml", () => {
  it("admits exactly 1 MiB and refuses one byte more", () => {
    expect(boundedCanonicalPlistXml(`${"x".repeat(MAX_LAUNCHD_PLIST_BYTES - 1)}\n`)).toHaveLength(MAX_LAUNCHD_PLIST_BYTES);
    expect(() => boundedCanonicalPlistXml(`${"x".repeat(MAX_LAUNCHD_PLIST_BYTES)}\n`)).toThrow();
    expect(() => boundedCanonicalPlistXml(`${"é".repeat(MAX_LAUNCHD_PLIST_BYTES / 2)}\n`)).toThrow();
  });

  it.each([
    ["empty", ""],
    ["missing trailing LF", "<plist/>"],
    ["two trailing LFs", "<plist/>\n\n"],
    ["NUL", "<plist>\0</plist>\n"],
  ])("refuses %s", (_label, value) => {
    expect(() => boundedCanonicalPlistXml(value)).toThrow();
  });
});

function unloaded(): LaunchdPriorJobStateV1 {
  return { beforeFileHash: null, beforeGeneration: null, beforeLiveState: { state: "unloaded" } };
}

const productHome = parseScheduledProductHome("/Users/a b/.developer-os");

const threeJobs: AutomationConfigV1 = {
  schemaVersion: 1,
  schedules: [
    { job: "brain-reindex", schedule: { cadence: "daily", hour: 2, minute: 0 } },
    { job: "brain-lint", schedule: { cadence: "daily", hour: 2, minute: 30 } },
    { job: "doctor", schedule: { cadence: "weekly", day: "mon", hour: 3, minute: 0 } },
  ],
};

function request(overrides: Partial<LaunchdPreviewRequestV1> = {}): LaunchdPreviewRequestV1 {
  return {
    observationProcessTableHash: observationHash,
    mutationProcessTableTemplateHash: templateHash,
    domain,
    userHome,
    productHome,
    executablePath: executable,
    automation: threeJobs,
    prior: { "brain-reindex": unloaded(), "brain-lint": unloaded(), doctor: unloaded(), "git-sync": unloaded() },
    ...overrides,
  };
}

describe("buildLaunchdPlanPreview", () => {
  it("installs every targeted job from an absent plist, in registry order", () => {
    const preview = buildLaunchdPlanPreview(request());
    expect(preview.entries.length).toBeGreaterThan(0);
    expect(preview.schemaVersion).toBe(1);
    expect(preview.observationProcessTableHash).toBe(observationHash);
    expect(preview.mutationProcessTableTemplateHash).toBe(templateHash);
    expect(preview.entries.map((entry) => [entry.operation, entry.job])).toEqual([
      ["install", "brain-reindex"],
      ["install", "brain-lint"],
      ["install", "doctor"],
    ]);
    for (const entry of preview.entries) {
      expect(entry.generation).not.toBeNull();
      expect(entry.generatedLabel).toBe(`${entry.baseLabel}.g.${String(entry.generation)}`);
      expect(entry.generation).toBe(launchdGeneration(entry.generationProjection as LaunchdGenerationProjectionV1));
      expect(entry.plistBytes).toContain(`<string>${String(entry.generatedLabel)}</string>`);
      expect(entry.baseArgv).toEqual([executable, "automation", "run", entry.job, "--scheduled", "--product-home", productHome]);
      expect(entry.plistPath).toBe(`/Users/a b/Library/LaunchAgents/${entry.baseLabel}.plist`);
      expect(entry.priorStateFingerprint).toBe(
        launchdPriorStateFingerprint({
          job: entry.job,
          domain,
          plistPath: entry.plistPath,
          beforeFileHash: null,
          beforeLiveState: { state: "unloaded" },
        }),
      );
    }
  });

  it("renders byte-identical plists across two previews of a hostile home", () => {
    const home = parseScheduledProductHome(hostileHome);
    const first = buildLaunchdPlanPreview(request({ productHome: home }));
    const second = buildLaunchdPlanPreview(request({ productHome: home }));
    expect(first.entries.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
    expect(first.entries.map((entry) => entry.plistBytes)).toEqual(second.entries.map((entry) => entry.plistBytes));
    expect(first.entries[0]?.plistBytes).toBe(expectedPlistXml);
  });

  it("keeps a retained plist at the same generation and replaces one at another", () => {
    const installed = buildLaunchdPlanPreview(request()).entries;
    const reindex = installed[0];
    if (reindex?.generation == null || reindex.plistBytes === null) throw new Error("fixture");
    const keepPrior: LaunchdPriorJobStateV1 = {
      beforeFileHash: hashBytes(encoder.encode(reindex.plistBytes)) as LowerHexSha256,
      beforeGeneration: reindex.generation,
      beforeLiveState: { state: "loaded", label: generatedLabel("brain-reindex", reindex.generation), generation: reindex.generation },
    };
    const oldGeneration = "e".repeat(64) as LowerHexSha256;
    const replacePrior: LaunchdPriorJobStateV1 = {
      beforeFileHash: "d".repeat(64) as LowerHexSha256,
      beforeGeneration: oldGeneration,
      beforeLiveState: { state: "loaded", label: generatedLabel("brain-lint", oldGeneration), generation: oldGeneration },
    };
    const preview = buildLaunchdPlanPreview(
      request({ prior: { "brain-reindex": keepPrior, "brain-lint": replacePrior, doctor: unloaded(), "git-sync": unloaded() } }),
    );
    expect(preview.entries.map((entry) => entry.operation)).toEqual(["keep", "replace", "install"]);
    expect(preview.entries[0]?.plistBytes).toBe(reindex.plistBytes);
    expect(preview.entries[1]?.beforeLiveState).toEqual(replacePrior.beforeLiveState);
  });

  it("removes every retained job when automation is disabled, with all five postimage fields null", () => {
    const retained = "c".repeat(64) as LowerHexSha256;
    const preview = buildLaunchdPlanPreview(
      request({
        automation: null,
        prior: {
          "brain-reindex": { beforeFileHash: "d".repeat(64) as LowerHexSha256, beforeGeneration: retained, beforeLiveState: { state: "unloaded" } },
          "brain-lint": unloaded(),
          doctor: unloaded(),
          "git-sync": {
            beforeFileHash: "d".repeat(64) as LowerHexSha256,
            beforeGeneration: retained,
            beforeLiveState: { state: "loaded", label: generatedLabel("git-sync", retained), generation: retained },
          },
        },
      }),
    );
    expect(preview.entries.map((entry) => [entry.operation, entry.job])).toEqual([
      ["remove", "brain-reindex"],
      ["remove", "git-sync"],
    ]);
    for (const entry of preview.entries) {
      expect([entry.schedule, entry.plistBytes, entry.generationProjection, entry.generation, entry.generatedLabel]).toEqual([
        null,
        null,
        null,
        null,
        null,
      ]);
    }
  });

  it("refuses a keep whose retained bytes drifted", () => {
    const reindex = buildLaunchdPlanPreview(request()).entries[0];
    if (reindex?.generation == null) throw new Error("fixture");
    const drifted: LaunchdPriorJobStateV1 = {
      beforeFileHash: "d".repeat(64) as LowerHexSha256,
      beforeGeneration: reindex.generation,
      beforeLiveState: { state: "unloaded" },
    };
    expect(() =>
      buildLaunchdPlanPreview(request({ prior: { "brain-reindex": drifted, "brain-lint": unloaded(), doctor: unloaded(), "git-sync": unloaded() } })),
    ).toThrow();
  });

  it.each<[string, LaunchdPriorJobStateV1]>([
    ["a loaded label without a retained plist", { beforeFileHash: null, beforeGeneration: null, beforeLiveState: { state: "loaded", label: generatedLabel("brain-reindex", "e".repeat(64) as LowerHexSha256), generation: "e".repeat(64) as LowerHexSha256 } }],
    ["a loaded generation that is not the retained one", { beforeFileHash: "d".repeat(64) as LowerHexSha256, beforeGeneration: "c".repeat(64) as LowerHexSha256, beforeLiveState: { state: "loaded", label: generatedLabel("brain-reindex", "e".repeat(64) as LowerHexSha256), generation: "e".repeat(64) as LowerHexSha256 } }],
    ["a loaded label of another job", { beforeFileHash: "d".repeat(64) as LowerHexSha256, beforeGeneration: "e".repeat(64) as LowerHexSha256, beforeLiveState: { state: "loaded", label: generatedLabel("doctor", "e".repeat(64) as LowerHexSha256), generation: "e".repeat(64) as LowerHexSha256 } }],
    ["a file hash without a generation", { beforeFileHash: "d".repeat(64) as LowerHexSha256, beforeGeneration: null, beforeLiveState: { state: "unloaded" } }],
  ])("refuses %s", (_label, prior) => {
    expect(() =>
      buildLaunchdPlanPreview(request({ prior: { "brain-reindex": prior, "brain-lint": unloaded(), doctor: unloaded(), "git-sync": unloaded() } })),
    ).toThrow();
  });

  it("refuses unordered schedules, a missing prior job and a non-GUI domain", () => {
    const reversed: AutomationConfigV1 = { schemaVersion: 1, schedules: [...threeJobs.schedules].reverse() };
    expect(() => buildLaunchdPlanPreview(request({ automation: reversed }))).toThrow();
    const threePriors = { "brain-reindex": unloaded(), "brain-lint": unloaded(), doctor: unloaded() };
    expect(() => buildLaunchdPlanPreview(request({ prior: threePriors as unknown as LaunchdPreviewRequestV1["prior"] }))).toThrow();
    expect(() => buildLaunchdPlanPreview(request({ domain: "system" as LaunchdPreviewRequestV1["domain"] }))).toThrow();
  });
});
