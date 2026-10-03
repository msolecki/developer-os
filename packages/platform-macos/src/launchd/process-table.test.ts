import type { CanonicalAbsolutePathV1, EffectiveUidV1, UInt64DecimalV1 } from "@developer-os/core";
import { describe, expect, it } from "vitest";

import { LaunchdDistributionUnsupportedError, admitLaunchdHost, recheckLaunchdHost } from "./distribution.js";
import { LAUNCHCTL_IDENTITY, hostWith } from "./distribution.test-fixtures.js";
import {
  LAUNCHD_PREVIEW_OBSERVATION_TABLE,
  SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE,
  deslotLaunchdProcessTable,
  expandLaunchdProcessTable,
  launchdObservationProcessTableHash,
  launchdProcessTableHash,
  launchdProcessTableTemplateHash,
  requireLaunchdMutationTable,
  type LaunchdProcessDirectoryIdentityV1,
} from "./process-table.js";
import { LaunchdInputError } from "./types.js";

const uid = 501 as EffectiveUidV1;
const root = "/Users/a b/.developer-os/staging/lifecycle/lc-0000000000000001/launchd-process" as CanonicalAbsolutePathV1;

function directory(path: string, ino: string): LaunchdProcessDirectoryIdentityV1 {
  return { path: path as CanonicalAbsolutePathV1, ownerUid: uid, mode: 448, dev: "16777232" as UInt64DecimalV1, ino: ino as UInt64DecimalV1 };
}

const STAGING = {
  root: directory(root, "100"),
  home: directory(`${root}/home`, "101"),
  tmp: directory(`${root}/tmp`, "102"),
};

const table = expandLaunchdProcessTable(STAGING, LAUNCHCTL_IDENTITY);

describe("launchctl distribution policy", () => {
  it("names the fixed path, the macOS floor and version-neutral table IDs, and no build or binary", () => {
    expect(LAUNCHD_PREVIEW_OBSERVATION_TABLE.id).toBe("launchctl-macos-preview-v2");
    expect(SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE.id).toBe("launchctl-macos-path-v1");
    expect(LAUNCHD_PREVIEW_OBSERVATION_TABLE.executable).toEqual({ path: "/bin/launchctl", ownerUid: 0 });
    expect(LAUNCHD_PREVIEW_OBSERVATION_TABLE.operatingSystem).toEqual({ productName: "macOS", minimumProductVersion: "26.6.2" });
    expect(LAUNCHD_PREVIEW_OBSERVATION_TABLE.emptyDirectory).toEqual({ path: "/private/var/empty", ownerUid: 0, mode: 493 });
    expect(SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE.launchctlIdentity).toEqual({ slot: "launchctl_identity" });
  });

  it("admits the fixture host as exactly LAUNCHCTL_IDENTITY", async () => {
    await expect(admitLaunchdHost(hostWith())).resolves.toEqual(LAUNCHCTL_IDENTITY);
  });
});

describe("launchctl admission", () => {
  it.each(["26.6.2", "26.7", "26.10.1", "27.0"])("admits macOS %s", async (productVersion) => {
    await expect(admitLaunchdHost(hostWith({ productVersion }))).resolves.toBeDefined();
  });
  it.each(["26.6.1", "26.6", "25.9.9", "27", "26.6.2.1", "026.6.2", "", "26.x"])("refuses macOS %s", async (productVersion) => {
    await expect(admitLaunchdHost(hostWith({ productVersion }))).rejects.toThrow("unsupported_launchd_distribution");
  });
  it("refuses another product name", async () => {
    await expect(admitLaunchdHost(hostWith({ productName: "Mac OS X" }))).rejects.toThrow(LaunchdDistributionUnsupportedError);
  });
  it("never compares the build", async () => {
    await expect(admitLaunchdHost(hostWith({ buildVersion: "26A1" }))).resolves.toBeDefined();
  });
  it.each([
    ["owner", { "/bin/launchctl": { ownerUid: 501 } }], ["group write", { "/bin/launchctl": { mode: 0o775 } }],
    ["setuid", { "/bin/launchctl": { mode: 0o4755 } }], ["symlink", { "/bin/launchctl": { kind: "symlink" as const } }],
    ["writable /bin", { "/bin": { mode: 0o775 } }], ["writable /", { "/": { mode: 0o757 } }],
  ])("refuses %s", async (_name, paths) => {
    await expect(admitLaunchdHost(hostWith({ paths }))).rejects.toThrow("unsupported_launchd_distribution");
  });
  it("keeps the table refusal as the cause", async () => {
    const refusal = admitLaunchdHost(hostWith({ paths: { "/bin/launchctl": { ownerUid: 501 } } }));
    await expect(refusal).rejects.toBeInstanceOf(LaunchdDistributionUnsupportedError);
    await expect(refusal).rejects.toHaveProperty("cause.name", "SystemExecutableRefusalError");
  });
  it.each(["dev", "ino", "size", "sha256"] as const)("recheck refuses a changed %s", async (field) => {
    const identity = await admitLaunchdHost(hostWith());
    const change = { [field]: field === "size" ? 1 : field === "sha256" ? "c".repeat(64) : "7" };
    await expect(recheckLaunchdHost(hostWith({ paths: { "/bin/launchctl": change } }), identity)).rejects.toThrow("unsupported_launchd_distribution");
  });
  it("recheck refuses a macOS update and passes an unchanged host", async () => {
    const identity = await admitLaunchdHost(hostWith());
    await expect(recheckLaunchdHost(hostWith({ productVersion: "26.7" }), identity)).rejects.toThrow(LaunchdDistributionUnsupportedError);
    await expect(recheckLaunchdHost(hostWith(), identity)).resolves.toBeUndefined();
  });
});

describe("launchd tables carry no host literal", () => {
  it("keeps template and observation hashes equal for two admitted identities", async () => {
    const one = expandLaunchdProcessTable(STAGING, await admitLaunchdHost(hostWith()));
    const two = expandLaunchdProcessTable(STAGING, await admitLaunchdHost(hostWith({ paths: { "/bin/launchctl": { sha256: "c".repeat(64), size: 400000 } } })));
    expect(launchdProcessTableTemplateHash(deslotLaunchdProcessTable(one))).toBe(launchdProcessTableTemplateHash(deslotLaunchdProcessTable(two)));
    expect(launchdProcessTableHash(one)).not.toBe(launchdProcessTableHash(two));
    expect(JSON.stringify(LAUNCHD_PREVIEW_OBSERVATION_TABLE)).not.toMatch(/25G83|363488|sha256|certif/u);
    expect("certification" in SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE).toBe(false);
  });
  it("admits a mutation table without certification", async () => {
    const admitted = expandLaunchdProcessTable(STAGING, await admitLaunchdHost(hostWith()));
    expect(() => { requireLaunchdMutationTable(admitted); }).not.toThrow();
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
      ["/bin/launchctl", "bootstrap", { slot: "launchd_gui_domain" }, { slot: "launchd_bootstrap_plist_path" }],
      ["/bin/launchctl", "print", { slot: "launchd_gui_domain" }],
      ["/bin/launchctl", "print", { slot: "launchd_observed_service_target" }],
    ]);
    expect(template.profiles[0]).toEqual({
      id: "mutation", stdinMaxBytes: 0, stdoutMaxBytes: 1048576, stderrMaxBytes: 1048576, wallDeadlineMs: 30000, idleDeadlineMs: 30000,
    });
    expect(JSON.stringify(template)).not.toContain("/dev/fd/3");
    expect(template.transitionDeadlineMs).toBe(30000);
    expect(template.terminationGraceMs).toBe(100);
  });

  it("expands the staging and launchctl slots and de-slots back to the exact template", () => {
    expect(table.staging).toEqual(STAGING);
    expect(table.launchctlIdentity).toEqual(LAUNCHCTL_IDENTITY);
    expect(table.environment).toEqual({
      HOME: `${root}/home`,
      LANG: "C",
      LC_ALL: "C",
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      TMPDIR: `${root}/tmp`,
    });
    expect(deslotLaunchdProcessTable(table)).toEqual(SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE);
    expect(launchdProcessTableTemplateHash(deslotLaunchdProcessTable(table))).toBe(launchdProcessTableTemplateHash());
  });

  it("separates the three table hash domains", () => {
    const hashes = new Set([launchdObservationProcessTableHash(), launchdProcessTableTemplateHash(), launchdProcessTableHash(table)]);
    expect(hashes.size).toBe(3);
    for (const hash of hashes) expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("binds the expanded table hash to the staging identities", () => {
    const moved = expandLaunchdProcessTable({ ...STAGING, tmp: directory(`${root}/tmp`, "103") }, LAUNCHCTL_IDENTITY);
    expect(launchdProcessTableHash(moved)).not.toBe(launchdProcessTableHash(table));
  });

  it.each([
    { name: "root outside staging/lifecycle", change: { root: directory("/tmp/launchd-process", "100") } },
    { name: "home not a child of root", change: { home: directory(`${root}/other`, "101") } },
    { name: "tmp not a child of root", change: { tmp: directory(`${root}/home/tmp`, "102") } },
    { name: "group-readable mode", change: { home: { ...directory(`${root}/home`, "101"), mode: 488 as number as 448 } } },
    { name: "another owner", change: { tmp: { ...directory(`${root}/tmp`, "102"), ownerUid: 502 as EffectiveUidV1 } } },
    { name: "home and tmp one directory", change: { tmp: directory(`${root}/tmp`, "101") } },
  ])("refuses a staging identity with $name", ({ change }) => {
    expect(() => expandLaunchdProcessTable({ ...STAGING, ...change }, LAUNCHCTL_IDENTITY)).toThrow(LaunchdInputError);
  });
});

describe("launchd mutation table", () => {
  it("refuses a table carrying a retired pinned table ID", () => {
    const retired = { ...table, id: "launchctl-macos-26.6.2-25G83-fd3-v1" as unknown as typeof table.id };
    expect(() => { requireLaunchdMutationTable(retired); }).toThrow("process table is not the compiled template");
    expect(() => { requireLaunchdMutationTable(retired); }).toThrow(LaunchdDistributionUnsupportedError);
  });

  it("refuses a table whose environment does not name its staging", () => {
    const drifted = { ...table, environment: { ...table.environment, HOME: root } };
    expect(() => { requireLaunchdMutationTable(drifted); }).toThrow(LaunchdInputError);
  });
});
