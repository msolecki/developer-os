import {
  hashCanonicalJson,
  parseCanonicalAbsolutePathText,
  type CanonicalAbsolutePathV1,
  type CanonicalJsonValue,
  type EffectiveUidV1,
  type LowerHexSha256,
  type UInt64DecimalV1,
} from "@developer-os/core";

import {
  LAUNCHD_DISTRIBUTION_POLICY,
  LaunchdDistributionUnsupportedError,
  type LaunchctlIdentityV1,
  type LaunchdEmptyDirectoryIdentityV1,
  type LaunchdExecutablePolicyV1,
  type LaunchdOperatingSystemPolicyV1,
} from "./distribution.js";
import { LaunchdInputError } from "./types.js";

export const LAUNCHD_PROCESS_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

export type LaunchdProcessEnvironmentV1 = {
  readonly HOME: CanonicalAbsolutePathV1;
  readonly LANG: "C";
  readonly LC_ALL: "C";
  readonly PATH: typeof LAUNCHD_PROCESS_PATH;
  readonly TMPDIR: CanonicalAbsolutePathV1;
};

export type LaunchdProcessDirectoryIdentityV1 = {
  readonly path: CanonicalAbsolutePathV1;
  readonly ownerUid: EffectiveUidV1;
  readonly mode: 448;
  readonly dev: UInt64DecimalV1;
  readonly ino: UInt64DecimalV1;
};

export type LaunchdQueryIoProfileV1 = {
  readonly id: "query";
  readonly stdinMaxBytes: 0;
  readonly stdoutMaxBytes: 4194304;
  readonly stderrMaxBytes: 1048576;
  readonly wallDeadlineMs: 30000;
  readonly idleDeadlineMs: 30000;
};

export type LaunchdMutationIoProfileV1 = {
  readonly id: "mutation";
  readonly stdinMaxBytes: 0;
  readonly stdoutMaxBytes: 1048576;
  readonly stderrMaxBytes: 1048576;
  readonly wallDeadlineMs: 30000;
  readonly idleDeadlineMs: 30000;
};

export type LaunchdProcessIoProfileV1 = LaunchdQueryIoProfileV1 | LaunchdMutationIoProfileV1;

/**
 * The argv slots a table can carry: the domain and targets are fixed per call from the
 * validated console user and the plan-bound labels, never from caller text.
 */
export type LaunchdArgvSlotV1 =
  | { readonly slot: "launchd_gui_domain" }
  | { readonly slot: "launchd_observed_service_target" }
  | { readonly slot: "launchd_generated_service_target" };

export type LaunchdProbeDomainArgvV1 = {
  readonly id: "probe_domain";
  readonly profileId: "query";
  readonly argv: readonly ["/bin/launchctl", "print", { readonly slot: "launchd_gui_domain" }];
};

export type LaunchdProbeServiceArgvV1 = {
  readonly id: "probe_service";
  readonly profileId: "query";
  readonly argv: readonly ["/bin/launchctl", "print", { readonly slot: "launchd_observed_service_target" }];
};

export type LaunchdBootstrapArgvV1 = {
  readonly id: "bootstrap";
  readonly profileId: "mutation";
  readonly argv: readonly ["/bin/launchctl", "bootstrap", { readonly slot: "launchd_gui_domain" }, "/dev/fd/3"];
};

export type LaunchdBootoutArgvV1 = {
  readonly id: "bootout";
  readonly profileId: "mutation";
  readonly argv: readonly ["/bin/launchctl", "bootout", { readonly slot: "launchd_generated_service_target" }];
};

export type LaunchdProcessArgvV1 =
  | LaunchdProbeDomainArgvV1
  | LaunchdProbeServiceArgvV1
  | LaunchdBootstrapArgvV1
  | LaunchdBootoutArgvV1;

export type LaunchdPreviewObservationProcessTableV1 = {
  readonly schemaVersion: 1;
  readonly id: "launchctl-macos-preview-v2";
  readonly operatingSystem: LaunchdOperatingSystemPolicyV1;
  readonly executable: LaunchdExecutablePolicyV1;
  readonly emptyDirectory: LaunchdEmptyDirectoryIdentityV1;
  readonly environment: {
    readonly HOME: "/private/var/empty";
    readonly LANG: "C";
    readonly LC_ALL: "C";
    readonly PATH: typeof LAUNCHD_PROCESS_PATH;
    readonly TMPDIR: "/private/var/empty";
  };
  readonly profiles: readonly [LaunchdQueryIoProfileV1];
  readonly argvAlternatives: readonly [LaunchdProbeDomainArgvV1, LaunchdProbeServiceArgvV1];
  readonly observationDeadlineMs: 30000;
  readonly terminationGraceMs: 100;
};

type LaunchdProcessTableArgvV1 = readonly [
  LaunchdBootoutArgvV1,
  LaunchdBootstrapArgvV1,
  LaunchdProbeDomainArgvV1,
  LaunchdProbeServiceArgvV1,
];

export type SupportedLaunchdProcessTableV1 = {
  readonly schemaVersion: 1;
  readonly id: "launchctl-macos-fd3-v2";
  readonly operatingSystem: LaunchdOperatingSystemPolicyV1;
  readonly executable: LaunchdExecutablePolicyV1;
  /** Spec §5.3 rule 4 (D71): the admitted launchctl this table binds, rechecked before every process. */
  readonly launchctlIdentity: LaunchctlIdentityV1;
  readonly staging: {
    readonly root: LaunchdProcessDirectoryIdentityV1;
    readonly home: LaunchdProcessDirectoryIdentityV1;
    readonly tmp: LaunchdProcessDirectoryIdentityV1;
  };
  readonly bootstrapPlistFd: 3;
  readonly environment: LaunchdProcessEnvironmentV1;
  readonly profiles: readonly [LaunchdMutationIoProfileV1, LaunchdQueryIoProfileV1];
  readonly argvAlternatives: LaunchdProcessTableArgvV1;
  readonly observationDeadlineMs: 30000;
  readonly transitionDeadlineMs: 30000;
  readonly terminationGraceMs: 100;
};

export type LaunchdProcessDirectorySlotV1 =
  | { readonly slot: "launchd_process_root" }
  | { readonly slot: "launchd_process_home" }
  | { readonly slot: "launchd_process_tmp" };

export type SupportedLaunchdProcessTableTemplateV1 = {
  readonly schemaVersion: 1;
  readonly id: SupportedLaunchdProcessTableV1["id"];
  readonly operatingSystem: LaunchdOperatingSystemPolicyV1;
  readonly executable: LaunchdExecutablePolicyV1;
  readonly launchctlIdentity: { readonly slot: "launchctl_identity" };
  readonly staging: {
    readonly root: { readonly slot: "launchd_process_root" };
    readonly home: { readonly slot: "launchd_process_home" };
    readonly tmp: { readonly slot: "launchd_process_tmp" };
  };
  readonly bootstrapPlistFd: 3;
  readonly environment: {
    readonly HOME: { readonly slot: "launchd_process_home" };
    readonly LANG: "C";
    readonly LC_ALL: "C";
    readonly PATH: typeof LAUNCHD_PROCESS_PATH;
    readonly TMPDIR: { readonly slot: "launchd_process_tmp" };
  };
  readonly profiles: SupportedLaunchdProcessTableV1["profiles"];
  readonly argvAlternatives: LaunchdProcessTableArgvV1;
  readonly observationDeadlineMs: 30000;
  readonly transitionDeadlineMs: 30000;
  readonly terminationGraceMs: 100;
};

const QUERY_PROFILE: LaunchdQueryIoProfileV1 = Object.freeze({
  id: "query",
  stdinMaxBytes: 0,
  stdoutMaxBytes: 4194304,
  stderrMaxBytes: 1048576,
  wallDeadlineMs: 30000,
  idleDeadlineMs: 30000,
});

const MUTATION_PROFILE: LaunchdMutationIoProfileV1 = Object.freeze({
  id: "mutation",
  stdinMaxBytes: 0,
  stdoutMaxBytes: 1048576,
  stderrMaxBytes: 1048576,
  wallDeadlineMs: 30000,
  idleDeadlineMs: 30000,
});

const PROBE_DOMAIN: LaunchdProbeDomainArgvV1 = Object.freeze({
  id: "probe_domain",
  profileId: "query",
  argv: Object.freeze(["/bin/launchctl", "print", Object.freeze({ slot: "launchd_gui_domain" })] as const),
});

const PROBE_SERVICE: LaunchdProbeServiceArgvV1 = Object.freeze({
  id: "probe_service",
  profileId: "query",
  argv: Object.freeze(["/bin/launchctl", "print", Object.freeze({ slot: "launchd_observed_service_target" })] as const),
});

const BOOTSTRAP: LaunchdBootstrapArgvV1 = Object.freeze({
  id: "bootstrap",
  profileId: "mutation",
  argv: Object.freeze(["/bin/launchctl", "bootstrap", Object.freeze({ slot: "launchd_gui_domain" }), "/dev/fd/3"] as const),
});

const BOOTOUT: LaunchdBootoutArgvV1 = Object.freeze({
  id: "bootout",
  profileId: "mutation",
  argv: Object.freeze(["/bin/launchctl", "bootout", Object.freeze({ slot: "launchd_generated_service_target" })] as const),
});

const row = LAUNCHD_DISTRIBUTION_POLICY;

export const LAUNCHD_PREVIEW_OBSERVATION_TABLE: LaunchdPreviewObservationProcessTableV1 = Object.freeze({
  schemaVersion: 1,
  id: row.previewTableId,
  operatingSystem: row.operatingSystem,
  executable: row.executable,
  emptyDirectory: row.emptyDirectory,
  environment: Object.freeze({
    HOME: row.emptyDirectory.path,
    LANG: "C",
    LC_ALL: "C",
    PATH: LAUNCHD_PROCESS_PATH,
    TMPDIR: row.emptyDirectory.path,
  }),
  profiles: Object.freeze([QUERY_PROFILE] as const),
  argvAlternatives: Object.freeze([PROBE_DOMAIN, PROBE_SERVICE] as const),
  observationDeadlineMs: 30000,
  terminationGraceMs: 100,
});

export const SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE: SupportedLaunchdProcessTableTemplateV1 = Object.freeze({
  schemaVersion: 1,
  id: row.mutationTableId,
  operatingSystem: row.operatingSystem,
  executable: row.executable,
  launchctlIdentity: Object.freeze({ slot: "launchctl_identity" }),
  staging: Object.freeze({
    root: Object.freeze({ slot: "launchd_process_root" }),
    home: Object.freeze({ slot: "launchd_process_home" }),
    tmp: Object.freeze({ slot: "launchd_process_tmp" }),
  }),
  bootstrapPlistFd: 3,
  environment: Object.freeze({
    HOME: Object.freeze({ slot: "launchd_process_home" }),
    LANG: "C",
    LC_ALL: "C",
    PATH: LAUNCHD_PROCESS_PATH,
    TMPDIR: Object.freeze({ slot: "launchd_process_tmp" }),
  }),
  profiles: Object.freeze([MUTATION_PROFILE, QUERY_PROFILE] as const),
  argvAlternatives: Object.freeze([BOOTOUT, BOOTSTRAP, PROBE_DOMAIN, PROBE_SERVICE] as const),
  observationDeadlineMs: 30000,
  transitionDeadlineMs: 30000,
  terminationGraceMs: 100,
});

/** SHA-256 over `developer-os:launchd-preview-observation-table:v1\0` plus the table's canonical JSON. */
export function launchdObservationProcessTableHash(
  table: LaunchdPreviewObservationProcessTableV1 = LAUNCHD_PREVIEW_OBSERVATION_TABLE,
): LowerHexSha256 {
  return hashCanonicalJson("developer-os:launchd-preview-observation-table:v1", table);
}

/** SHA-256 over `developer-os:launchd-process-table-template:v1\0` plus the template's canonical JSON. */
export function launchdProcessTableTemplateHash(
  template: SupportedLaunchdProcessTableTemplateV1 = SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE,
): LowerHexSha256 {
  return hashCanonicalJson("developer-os:launchd-process-table-template:v1", template);
}

/** SHA-256 over `developer-os:launchd-process-table:v1\0` plus the expanded table's canonical JSON. */
export function launchdProcessTableHash(table: SupportedLaunchdProcessTableV1): LowerHexSha256 {
  // `AdmittedSystemExecutableV1` is an interface, which carries no index signature for the JSON type.
  return hashCanonicalJson("developer-os:launchd-process-table:v1", table as unknown as CanonicalJsonValue);
}

/** SHA-256 over `developer-os:launchctl-identity:v1\0` plus the identity's canonical JSON. */
export function launchctlIdentityHash(identity: LaunchctlIdentityV1): LowerHexSha256 {
  return hashCanonicalJson("developer-os:launchctl-identity:v1", identity as unknown as CanonicalJsonValue);
}

function refuse(message: string): never {
  throw new LaunchdInputError(message);
}

function stagingIdentity(
  identity: LaunchdProcessDirectoryIdentityV1,
  path: string,
  ownerUid: EffectiveUidV1,
  label: string,
): LaunchdProcessDirectoryIdentityV1 {
  if (identity.path !== parseCanonicalAbsolutePathText(path)) refuse(`${label}: path`);
  if (identity.ownerUid !== ownerUid) refuse(`${label}: owner`);
  if ((identity.mode as number) !== 448) refuse(`${label}: mode`);
  if (!/^(0|[1-9][0-9]*)$/.test(identity.dev) || !/^(0|[1-9][0-9]*)$/.test(identity.ino)) refuse(`${label}: identity`);
  return Object.freeze({ ...identity });
}

/**
 * Fills the template's three staging slots with the guarded identities of
 * `<product home>/staging/lifecycle/<coordinator-id>/launchd-process` and its `home`/`tmp` children,
 * and its `launchctl_identity` slot with what apply's fresh `admitLaunchdHost` returned.
 */
export function expandLaunchdProcessTable(
  staging: {
    readonly root: LaunchdProcessDirectoryIdentityV1;
    readonly home: LaunchdProcessDirectoryIdentityV1;
    readonly tmp: LaunchdProcessDirectoryIdentityV1;
  },
  launchctl: LaunchctlIdentityV1,
  template: SupportedLaunchdProcessTableTemplateV1 = SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE,
): SupportedLaunchdProcessTableV1 {
  const ownerUid = staging.root.ownerUid;
  if (!/^\/.+\/staging\/lifecycle\/[^/]+\/launchd-process$/.test(staging.root.path)) refuse("launchd process root: path");
  const root = stagingIdentity(staging.root, staging.root.path, ownerUid, "launchd process root");
  const home = stagingIdentity(staging.home, `${root.path}/home`, ownerUid, "launchd process home");
  const tmp = stagingIdentity(staging.tmp, `${root.path}/tmp`, ownerUid, "launchd process tmp");
  if (home.dev === tmp.dev && home.ino === tmp.ino) refuse("launchd process home and tmp are one directory");
  return Object.freeze({
    schemaVersion: template.schemaVersion,
    id: template.id,
    operatingSystem: template.operatingSystem,
    executable: template.executable,
    launchctlIdentity: launchctl,
    staging: Object.freeze({ root, home, tmp }),
    bootstrapPlistFd: template.bootstrapPlistFd,
    environment: Object.freeze({ HOME: home.path, LANG: "C", LC_ALL: "C", PATH: LAUNCHD_PROCESS_PATH, TMPDIR: tmp.path }),
    profiles: template.profiles,
    argvAlternatives: template.argvAlternatives,
    observationDeadlineMs: template.observationDeadlineMs,
    transitionDeadlineMs: template.transitionDeadlineMs,
    terminationGraceMs: template.terminationGraceMs,
  });
}

/** The exact inverse of `expandLaunchdProcessTable`: what apply re-derives before it admits a table hash. */
export function deslotLaunchdProcessTable(table: SupportedLaunchdProcessTableV1): SupportedLaunchdProcessTableTemplateV1 {
  if (table.environment.HOME !== table.staging.home.path || table.environment.TMPDIR !== table.staging.tmp.path) {
    refuse("launchd process environment does not name its staging directories");
  }
  return {
    schemaVersion: table.schemaVersion,
    id: table.id,
    operatingSystem: table.operatingSystem,
    executable: table.executable,
    launchctlIdentity: { slot: "launchctl_identity" },
    staging: { root: { slot: "launchd_process_root" }, home: { slot: "launchd_process_home" }, tmp: { slot: "launchd_process_tmp" } },
    bootstrapPlistFd: table.bootstrapPlistFd,
    environment: {
      HOME: { slot: "launchd_process_home" },
      LANG: table.environment.LANG,
      LC_ALL: table.environment.LC_ALL,
      PATH: table.environment.PATH,
      TMPDIR: { slot: "launchd_process_tmp" },
    },
    profiles: table.profiles,
    argvAlternatives: table.argvAlternatives,
    observationDeadlineMs: table.observationDeadlineMs,
    transitionDeadlineMs: table.transitionDeadlineMs,
    terminationGraceMs: table.terminationGraceMs,
  };
}

/**
 * Spec §5.3 (amended 2026-09-28, D71): a mutation table must de-slot to the compiled template.
 * The host is admitted by `admitLaunchdHost` and rechecked before every process, not here.
 */
export function requireLaunchdMutationTable(
  table: SupportedLaunchdProcessTableV1,
  template: SupportedLaunchdProcessTableTemplateV1 = SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE,
): void {
  if (launchdProcessTableTemplateHash(deslotLaunchdProcessTable(table)) !== launchdProcessTableTemplateHash(template)) {
    throw new LaunchdDistributionUnsupportedError("process table is not the compiled template");
  }
}
