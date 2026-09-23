import type { CanonicalAbsolutePathV1, EffectiveUidV1, LowerHexSha256, UInt64DecimalV1, UtcTimestampV1 } from "@developer-os/core";
import { describe, expect, it } from "vitest";

import {
  LaunchdDistributionUnsupportedError,
  SUPPORTED_LAUNCHD_DISTRIBUTION,
  admitLaunchdDistribution,
  type ObservedLaunchdDistributionV1,
} from "./distribution.js";
import {
  LAUNCHD_PREVIEW_OBSERVATION_TABLE,
  SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE,
  deslotLaunchdProcessTable,
  expandLaunchdProcessTable,
  launchdObservationProcessTableHash,
  launchdProcessTableHash,
  launchdProcessTableTemplateHash,
  requireLaunchdMutationCertified,
  type LaunchdProcessDirectoryIdentityV1,
  type SupportedLaunchdProcessTableTemplateV1,
} from "./process-table.js";
import { LaunchdInputError } from "./types.js";

const uid = 501 as EffectiveUidV1;
const root = "/Users/a b/.developer-os/staging/lifecycle/lc-0000000000000001/launchd-process" as CanonicalAbsolutePathV1;

function directory(path: string, ino: string): LaunchdProcessDirectoryIdentityV1 {
  return { path: path as CanonicalAbsolutePathV1, ownerUid: uid, mode: 448, dev: "16777232" as UInt64DecimalV1, ino: ino as UInt64DecimalV1 };
}

const staging = {
  root: directory(root, "100"),
  home: directory(`${root}/home`, "101"),
  tmp: directory(`${root}/tmp`, "102"),
};

const uncertifiedTable = expandLaunchdProcessTable(staging);

const certifiedTemplate: SupportedLaunchdProcessTableTemplateV1 = {
  ...SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE,
  certification: {
    certifiedAt: "2026-09-24T10:00:00.000Z" as UtcTimestampV1,
    fixtureTranscriptSha256: "a".repeat(64) as LowerHexSha256,
  },
};

function observedRow(): ObservedLaunchdDistributionV1 {
  return {
    operatingSystem: { ...SUPPORTED_LAUNCHD_DISTRIBUTION.operatingSystem },
    executable: { ...SUPPORTED_LAUNCHD_DISTRIBUTION.executable, kind: "file" },
  };
}

type Drift = { readonly name: string; readonly mutate: (row: ObservedLaunchdDistributionV1) => ObservedLaunchdDistributionV1 };

const drifts: readonly Drift[] = [
  { name: "product name", mutate: (row) => ({ ...row, operatingSystem: { ...row.operatingSystem, productName: "Mac OS X" } }) },
  { name: "product version", mutate: (row) => ({ ...row, operatingSystem: { ...row.operatingSystem, productVersion: "26.6.3" } }) },
  { name: "build", mutate: (row) => ({ ...row, operatingSystem: { ...row.operatingSystem, buildVersion: "25G84" } }) },
  { name: "path", mutate: (row) => ({ ...row, executable: { ...row.executable, path: "/usr/bin/launchctl" } }) },
  { name: "symlink", mutate: (row) => ({ ...row, executable: { ...row.executable, kind: "symlink" } }) },
  { name: "owner", mutate: (row) => ({ ...row, executable: { ...row.executable, ownerUid: 501 } }) },
  { name: "mode", mutate: (row) => ({ ...row, executable: { ...row.executable, mode: 0o775 } }) },
  { name: "size", mutate: (row) => ({ ...row, executable: { ...row.executable, size: row.executable.size + 1 } }) },
  { name: "same version, different binary", mutate: (row) => ({ ...row, executable: { ...row.executable, sha256: "0".repeat(64) } }) },
];

describe("launchctl distribution row", () => {
  it("pins the measured launchctl row", () => {
    expect(LAUNCHD_PREVIEW_OBSERVATION_TABLE.id).toBe("launchctl-macos-26.6.2-25G83-preview-v1");
    expect(LAUNCHD_PREVIEW_OBSERVATION_TABLE.executable).toEqual({
      path: "/bin/launchctl", ownerUid: 0, mode: 493, size: 363488,
      sha256: "b4dbf509754d8e1117f7851baa93ede75bc75218c48d6ddf19fbb1505d261be7",
    });
    expect(SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE.id).toBe("launchctl-macos-26.6.2-25G83-fd3-v1");
    expect(LAUNCHD_PREVIEW_OBSERVATION_TABLE.operatingSystem).toEqual({ productName: "macOS", productVersion: "26.6.2", buildVersion: "25G83" });
    expect(LAUNCHD_PREVIEW_OBSERVATION_TABLE.emptyDirectory).toEqual({ path: "/private/var/empty", ownerUid: 0, mode: 493 });
  });

  it("is uncertified until the disposable-host certification fills the row", () => {
    expect(SUPPORTED_LAUNCHD_DISTRIBUTION.certification).toBeNull();
    expect(SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE.certification).toBeNull();
    expect("certification" in LAUNCHD_PREVIEW_OBSERVATION_TABLE).toBe(false);
  });

  it("admits the exact measured host", () => {
    expect(() => { admitLaunchdDistribution(observedRow()); }).not.toThrow();
  });

  it("has drift cases", () => {
    expect(drifts.length).toBeGreaterThan(0);
  });

  it.each(drifts)("refuses $name drift as unsupported_launchd_distribution", ({ mutate }) => {
    expect(() => { admitLaunchdDistribution(mutate(observedRow())); }).toThrow(LaunchdDistributionUnsupportedError);
    expect(() => { admitLaunchdDistribution(mutate(observedRow())); }).toThrow("unsupported_launchd_distribution");
  });
});

describe("launchctl process tables", () => {
  it("uses the preview row's exact empty-directory environment and query profile only", () => {
    expect(LAUNCHD_PREVIEW_OBSERVATION_TABLE.environment).toEqual({
      HOME: "/private/var/empty",
      LANG: "C",
      LC_ALL: "C",
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      TMPDIR: "/private/var/empty",
    });
    expect(LAUNCHD_PREVIEW_OBSERVATION_TABLE.profiles).toEqual([
      { id: "query", stdinMaxBytes: 0, stdoutMaxBytes: 4194304, stderrMaxBytes: 1048576, wallDeadlineMs: 30000, idleDeadlineMs: 30000 },
    ]);
    expect(LAUNCHD_PREVIEW_OBSERVATION_TABLE.observationDeadlineMs).toBe(30000);
    expect(LAUNCHD_PREVIEW_OBSERVATION_TABLE.terminationGraceMs).toBe(100);
  });

  it("admits zero mutation argv during preview", () => {
    const alternatives = LAUNCHD_PREVIEW_OBSERVATION_TABLE.argvAlternatives;
    expect(alternatives.length).toBeGreaterThan(0);
    expect(alternatives.map((alternative) => alternative.id)).toEqual(["probe_domain", "probe_service"]);
    for (const alternative of alternatives) {
      expect(alternative.profileId).toBe("query");
      expect(alternative.argv.slice(0, 2)).toEqual(["/bin/launchctl", "print"]);
    }
  });

  it("keeps the mutation template's profiles and argv exact, unique and ID-sorted", () => {
    const template = SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE;
    expect(template.profiles.map((profile) => profile.id)).toEqual(["mutation", "query"]);
    expect(template.argvAlternatives.map((alternative) => alternative.id)).toEqual(["bootout", "bootstrap", "probe_domain", "probe_service"]);
    expect(template.argvAlternatives.map((alternative) => alternative.argv)).toEqual([
      ["/bin/launchctl", "bootout", { slot: "launchd_generated_service_target" }],
      ["/bin/launchctl", "bootstrap", { slot: "launchd_gui_domain" }, "/dev/fd/3"],
      ["/bin/launchctl", "print", { slot: "launchd_gui_domain" }],
      ["/bin/launchctl", "print", { slot: "launchd_observed_service_target" }],
    ]);
    expect(template.profiles[0]).toEqual({
      id: "mutation", stdinMaxBytes: 0, stdoutMaxBytes: 1048576, stderrMaxBytes: 1048576, wallDeadlineMs: 30000, idleDeadlineMs: 30000,
    });
    expect(template.bootstrapPlistFd).toBe(3);
    expect(template.transitionDeadlineMs).toBe(30000);
    expect(template.terminationGraceMs).toBe(100);
  });

  it("expands the staging slots into HOME and TMPDIR and de-slots back to the exact template", () => {
    expect(uncertifiedTable.staging).toEqual(staging);
    expect(uncertifiedTable.environment).toEqual({
      HOME: `${root}/home`,
      LANG: "C",
      LC_ALL: "C",
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      TMPDIR: `${root}/tmp`,
    });
    expect(deslotLaunchdProcessTable(uncertifiedTable)).toEqual(SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE);
    expect(launchdProcessTableTemplateHash(deslotLaunchdProcessTable(uncertifiedTable))).toBe(launchdProcessTableTemplateHash());
  });

  it("separates the three table hash domains", () => {
    const hashes = new Set([launchdObservationProcessTableHash(), launchdProcessTableTemplateHash(), launchdProcessTableHash(uncertifiedTable)]);
    expect(hashes.size).toBe(3);
    for (const hash of hashes) expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("binds the expanded table hash to the staging identities", () => {
    const moved = expandLaunchdProcessTable({ ...staging, tmp: directory(`${root}/tmp`, "103") });
    expect(launchdProcessTableHash(moved)).not.toBe(launchdProcessTableHash(uncertifiedTable));
  });

  it.each([
    { name: "root outside staging/lifecycle", change: { root: directory("/tmp/launchd-process", "100") } },
    { name: "home not a child of root", change: { home: directory(`${root}/other`, "101") } },
    { name: "tmp not a child of root", change: { tmp: directory(`${root}/home/tmp`, "102") } },
    { name: "group-readable mode", change: { home: { ...directory(`${root}/home`, "101"), mode: 488 as number as 448 } } },
    { name: "another owner", change: { tmp: { ...directory(`${root}/tmp`, "102"), ownerUid: 502 as EffectiveUidV1 } } },
    { name: "home and tmp one directory", change: { tmp: directory(`${root}/tmp`, "101") } },
  ])("refuses a staging identity with $name", ({ change }) => {
    expect(() => expandLaunchdProcessTable({ ...staging, ...change })).toThrow(LaunchdInputError);
  });
});

describe("launchd mutation certification", () => {
  it("refuses mutation while the row is uncertified", () => {
    expect(() => { requireLaunchdMutationCertified(uncertifiedTable); }).toThrow("unsupported_launchd_distribution");
    expect(() => { requireLaunchdMutationCertified(uncertifiedTable); }).toThrow(LaunchdDistributionUnsupportedError);
  });

  it("admits a certified table that de-slots to its certified template", () => {
    const certified = expandLaunchdProcessTable(staging, certifiedTemplate);
    expect(() => { requireLaunchdMutationCertified(certified, certifiedTemplate); }).not.toThrow();
  });

  it("refuses a certified table against the uncertified production template", () => {
    const certified = expandLaunchdProcessTable(staging, certifiedTemplate);
    expect(() => { requireLaunchdMutationCertified(certified); }).toThrow("process table is not the pinned row");
  });

  it("refuses malformed certification evidence", () => {
    const malformed: SupportedLaunchdProcessTableTemplateV1 = {
      ...certifiedTemplate,
      certification: { certifiedAt: "2026-09-24" as UtcTimestampV1, fixtureTranscriptSha256: "a".repeat(64) as LowerHexSha256 },
    };
    expect(() => { requireLaunchdMutationCertified(expandLaunchdProcessTable(staging, malformed), malformed); }).toThrow(LaunchdDistributionUnsupportedError);
  });

  it("refuses a table for another row", () => {
    const other = { ...expandLaunchdProcessTable(staging, certifiedTemplate), id: "launchctl-macos-26.7-25H1-fd3-v1" as const };
    expect(() => { requireLaunchdMutationCertified(other, certifiedTemplate); }).toThrow("process table is not the pinned row");
  });

  it("refuses a table whose environment does not name its staging", () => {
    const drifted = { ...expandLaunchdProcessTable(staging, certifiedTemplate), environment: { ...uncertifiedTable.environment, HOME: root } };
    expect(() => { requireLaunchdMutationCertified(drifted, certifiedTemplate); }).toThrow(LaunchdInputError);
  });
});
