import { createHash } from "node:crypto";
import { dirname } from "node:path";

import {
  encodeCanonicalJson,
  EXIT_CODES,
  parseCanonicalAbsolutePathText,
  parseLowerHexSha256,
  parseOwnerExternalEffectLiteral,
  parsePositiveUInt32,
  parseUInt64Decimal,
  type CanonicalAbsolutePathV1,
  type CanonicalJsonV1,
  type LowerHexSha256,
  type ManagedArtifactV2,
  type OwnerExternalEffectProcessPolicyV1,
  type StableSemverV1,
  type UtcTimestampV1,
  type VaultFreeRelativePathV1,
} from "@developer-os/core";
import type { SystemPathInspectorV1 } from "@developer-os/security";

import { codexPluginTreeHash, type CodexRegistrationStateV1 } from "../instructions/codex-registration.js";
import { codexInstructionPaths, type VendorHomesV1 } from "../instructions/vendor-homes.js";
import { UpdatePlanningRefusal } from "./planning.js";
import { refuseParticipant } from "./state-participant.js";

export const CODEX_REFRESH_PROVIDER_PROTOCOL = parsePositiveUInt32(1);

type PinnedIdentityV1 = OwnerExternalEffectProcessPolicyV1["executableIdentity"];

/** The `codex` install's discovery selected, pinned at its canonical real path (Spec 2 P6(b), D72 Q2-A). */
export interface CodexExecutableIdentityV1 {
  readonly canonicalPath: CanonicalAbsolutePathV1;
  readonly identity: PinnedIdentityV1;
}

export interface CodexExecutableFileSystemV1 {
  readonly realpath: (path: string) => Promise<string>;
  /** No-follow observation with a content hash for a regular file (`inspectSystemPath`'s contract). */
  readonly inspect: SystemPathInspectorV1;
  readonly effectiveUid: number;
}

function untrusted(path: string): never {
  throw new UpdatePlanningRefusal("update_codex_executable_untrusted", EXIT_CODES.securityRefusal, [path]);
}

/**
 * Resolves the selected `codex` through every link to its real path, which must be a regular
 * executable file owned by the user or root with no group/other write and no setuid, setgid or
 * sticky bit; every ancestor up to `/` must be a directory owned by the user or root with no
 * group/other write. The owner-owned single-link rule is withdrawn for this token: a Homebrew or
 * npm `codex` is a link into a package-manager tree.
 */
export async function resolveCodexExecutable(selected: CanonicalAbsolutePathV1, deps: CodexExecutableFileSystemV1): Promise<CodexExecutableIdentityV1> {
  const canonicalPath = parseCanonicalAbsolutePathText(await deps.realpath(selected));
  const owned = (uid: number): boolean => uid === deps.effectiveUid || uid === 0;
  for (let ancestor = dirname(canonicalPath); ; ancestor = dirname(ancestor)) {
    const entry = await deps.inspect(ancestor as CanonicalAbsolutePathV1);
    if (entry.kind !== "directory" || !owned(entry.ownerUid) || (entry.mode & 0o022) !== 0) untrusted(ancestor);
    if (ancestor === "/") break;
  }
  const target = await deps.inspect(canonicalPath);
  if (target.kind !== "file" || !owned(target.ownerUid) || (target.mode & 0o7022) !== 0 || (target.mode & 0o100) === 0 || target.sha256 === null) {
    return untrusted(canonicalPath);
  }
  return {
    canonicalPath,
    identity: { dev: parseUInt64Decimal(target.dev), ino: parseUInt64Decimal(target.ino), mode: target.mode, sha256: parseLowerHexSha256(target.sha256) },
  };
}

const sameIdentity = (left: PinnedIdentityV1, right: PinnedIdentityV1): boolean =>
  left.dev === right.dev && left.ino === right.ino && left.mode === right.mode && left.sha256 === right.sha256;

/**
 * The effect port's `resolveExecutable`: before every spawn it re-resolves the planned path under
 * the same rule and requires the same real path and the plan's pinned identity.
 */
export function codexExecutableResolver(executable: CodexExecutableIdentityV1, deps: CodexExecutableFileSystemV1): (identity: PinnedIdentityV1) => Promise<string> {
  return async (identity) => {
    let fresh: CodexExecutableIdentityV1;
    try {
      fresh = await resolveCodexExecutable(executable.canonicalPath, deps);
    } catch (error) {
      if (error instanceof UpdatePlanningRefusal) return refuseParticipant("update_effect_executable_changed", executable.canonicalPath);
      throw error;
    }
    if (fresh.canonicalPath !== executable.canonicalPath || !sameIdentity(fresh.identity, identity)) {
      return refuseParticipant("update_effect_executable_changed", executable.canonicalPath);
    }
    return fresh.canonicalPath;
  };
}

/** The one closed refresh: `codex plugin add <plugin_id> --json` under `CODEX_HOME` and `TMPDIR`. */
export function codexRefreshPolicy(executable: CodexExecutableIdentityV1): OwnerExternalEffectProcessPolicyV1 {
  const literal = (value: string) => ({ kind: "literal", value: parseOwnerExternalEffectLiteral(value) }) as const;
  return {
    kind: "codex_registration_refresh",
    providerProtocol: CODEX_REFRESH_PROVIDER_PROTOCOL,
    executable: "pinned_codex_cli",
    executableIdentity: executable.identity,
    argv: [literal("plugin"), literal("add"), { kind: "token", value: "plugin_id" }, literal("--json")],
    cwd: "managed_plugin_root",
    environment: [{ name: "CODEX_HOME", value: "managed_vendor_home" }, { name: "TMPDIR", value: "private_effect_tmp" }],
    stdin: "closed",
    network: false,
    model: false,
    stdoutBytes: 65_536,
    stderrBytes: 65_536,
    wallMilliseconds: 60_000,
    idleMilliseconds: 30_000,
    processCount: 1,
  };
}

export interface CodexRegistrationRowInputV1 {
  readonly homes: VendorHomesV1;
  readonly productVersion: StableSemverV1;
  readonly plannedAt: UtcTimestampV1;
  /** The Codex owner's concrete postimage rows. */
  readonly ownerPostimage: readonly ManagedArtifactV2[];
}

/**
 * Spec 2 P6(d): the registration record as a Codex `replace` row. The tree selection is install's
 * and doctor's (`instructions/apply.ts` `reconcileRegistration`), so the record they read after the
 * update is `registered`, not `stale`. No clock is read: the under-lock re-derivation is byte-equal.
 */
export function codexRegistrationRow(input: CodexRegistrationRowInputV1): { readonly artifact: ManagedArtifactV2; readonly bytes: CanonicalJsonV1 } {
  const { pluginRoot, registrationFile } = codexInstructionPaths(input.homes);
  const treeHash = codexPluginTreeHash(input.ownerPostimage.flatMap((artifact) =>
    artifact.path.startsWith(`${pluginRoot}/`) && artifact.kind !== "directory" && artifact.verification.mode === "content"
      ? [{ path: artifact.path.slice(pluginRoot.length + 1), sha256: artifact.verification.installedHash }]
      : []));
  const bytes = encodeCanonicalJson({ codexHome: input.homes.codexHome, treeHash });
  const path = parseCanonicalAbsolutePathText(registrationFile);
  const prior = input.ownerPostimage.find((artifact) => artifact.path === path);
  return {
    bytes,
    artifact: {
      owner: "codex",
      path,
      productVersion: input.productVersion,
      existedBefore: prior?.existedBefore ?? false,
      beforeHash: prior?.beforeHash ?? null,
      backupRelativePath: prior?.backupRelativePath ?? null,
      source: "generated/codex/registration.json" as VaultFreeRelativePathV1,
      mergeStrategy: "dedicated",
      verifiedAt: input.plannedAt,
      kind: "file",
      verification: { mode: "schema", schemaId: "codex-registration-v1", installedHash: createHash("sha256").update(bytes, "utf8").digest("hex") as LowerHexSha256 },
    },
  };
}

/** Spec 2 P6(c): an update refuses before allocation unless Codex is `registered`, as owner drift. */
export function requireCodexRegistered(state: CodexRegistrationStateV1): void {
  if (state !== "registered") throw new UpdatePlanningRefusal(`update_codex_registration_${state}`, EXIT_CODES.decisionRequired, [], "developer-os init");
}
