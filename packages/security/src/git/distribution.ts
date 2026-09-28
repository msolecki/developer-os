/**
 * Spec 1 §4.2 as amended 2026-09-28 (D71; NEW-113): Git runs from the platform's
 * standard fixed paths, admitted by ownership and mode (`posix_root_owned`), a version
 * floor and a capability probe. The measured bytes are per-invocation evidence held in
 * memory for one top-level invocation; nothing here names a macOS build, an Xcode
 * version or a binary hash, and nothing consults `PATH` or `xcrun`.
 */
import { SecurityRefusalError } from "../paths.js";
import {
  SystemExecutableRefusalError,
  admitPosixRootOwned,
  type AdmittedSystemExecutableV1,
  type SystemExecutableRowV1,
  type SystemPathInspectorV1,
} from "../system-executables.js";
import { GIT_DISTRIBUTION_POLICY_ID, parseBoundedTextLine, SUPPORTED_GIT_PROCESS_TABLE } from "./process-table.js";
import type { GitDistributionPolicyV2, GitVersionFloorV1 } from "./types.js";

const ARCHITECTURE = "arm64";
const MAX_PROBE_LINES = 32;

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const GIT_DISTRIBUTION_POLICY: GitDistributionPolicyV2 = deepFreeze({
  schemaVersion: 2,
  id: GIT_DISTRIBUTION_POLICY_ID,
  platform: "darwin",
  architecture: ARCHITECTURE,
  gitVersionFloor: { major: 2, minor: 54, patch: 0, vendorBuild: { prefix: "Apple Git-", minimum: 157 } },
  sshVersionFloor: { major: 10, minor: 3, portable: 1 },
  requiredBuildOptionLines: [`cpu: ${ARCHITECTURE}`, "default-hash: sha1", "default-ref-format: files", "shell-path: /bin/sh"],
  executables: [
    { id: "git_main", system: "git" },
    { id: "git_receive_pack", system: "git-receive-pack" },
    { id: "git_remote_https", system: null },
    { id: "system_ssh", system: "ssh" },
  ],
  processTable: SUPPORTED_GIT_PROCESS_TABLE,
});

/** One invocation's admitted files; `ssh` is non-null only when SSH is the selected transport. */
export interface AdmittedGitExecutablesV1 {
  readonly git: AdmittedSystemExecutableV1;
  readonly receivePack: AdmittedSystemExecutableV1;
  readonly ssh: AdmittedSystemExecutableV1 | null;
}

export interface AdmittedGitDistributionV1 extends AdmittedGitExecutablesV1 {
  readonly gitVersionLine: string;
}

function unsupported(): never {
  throw new SecurityRefusalError("unsupported_git_distribution");
}

function rowFor(rows: readonly SystemExecutableRowV1[], policy: GitDistributionPolicyV2, id: SystemExecutableRowV1["id"]): SystemExecutableRowV1 {
  return rows.find((row) => row.platform === policy.platform && row.id === id) ?? unsupported();
}

/**
 * Admits the fixed paths the local transport runs. HTTPS has no `git_remote_https` row
 * and SSH stays refused (D59 Q4-A) until their traces are recorded. Any table refusal,
 * and any failure to observe a path, is `unsupported_git_distribution`.
 */
export async function admitGitExecutables(
  rows: readonly SystemExecutableRowV1[],
  inspect: SystemPathInspectorV1,
  architecture: string,
  transport: "local" | "https" | "ssh",
  policy: GitDistributionPolicyV2 = GIT_DISTRIBUTION_POLICY,
): Promise<AdmittedGitExecutablesV1> {
  if (transport !== "local" || architecture !== policy.architecture) unsupported();
  try {
    const git = await admitPosixRootOwned(rowFor(rows, policy, "git"), inspect);
    const receivePack = await admitPosixRootOwned(rowFor(rows, policy, "git-receive-pack"), inspect);
    return { git, receivePack, ssh: null };
  } catch (error) {
    const detail = error instanceof SystemExecutableRefusalError ? error.detail : undefined;
    throw new SecurityRefusalError("unsupported_git_distribution", { detail, cause: error });
  }
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const DECIMAL = "(0|[1-9][0-9]*)";

/** Canonical decimals only; the vendor group is required exactly when the row names a prefix. */
export function parseGitVersionLine(
  line: string,
  vendorBuildPrefix: string | null,
): { major: number; minor: number; patch: number; vendorBuild: number | null } | null {
  const suffix = vendorBuildPrefix === null ? "" : ` \\(${escapeRegExp(vendorBuildPrefix)}${DECIMAL}\\)`;
  const match = new RegExp(`^git version ${DECIMAL}\\.${DECIMAL}\\.${DECIMAL}${suffix}$`, "u").exec(line);
  if (match === null) return null;
  const numbers = match.slice(1).map(Number);
  if (!numbers.every(Number.isSafeInteger)) return null;
  const [major, minor, patch, vendorBuild] = numbers as [number, number, number, number | undefined];
  return { major, minor, patch, vendorBuild: vendorBuild ?? null };
}

function meetsFloor(line: string, floor: GitVersionFloorV1): boolean {
  const version = parseGitVersionLine(line, floor.vendorBuild?.prefix ?? null);
  if (version === null) return false;
  const observed = [version.major, version.minor, version.patch];
  const minimum = [floor.major, floor.minor, floor.patch];
  const index = observed.findIndex((part, position) => part !== minimum[position]);
  if (index >= 0 && (observed[index] as number) < (minimum[index] as number)) return false;
  return floor.vendorBuild === null || (version.vendorBuild !== null && version.vendorBuild >= floor.vendorBuild.minimum);
}

/**
 * Judges the `direct_distribution_probe` output (`git --version --build-options`, run
 * through the shim): line 0 meets the floor, and each required build-option line is
 * present exactly once. Every other line is ignored, so a library bump still admits.
 */
export function admitGitCapability(
  admitted: AdmittedGitExecutablesV1,
  probeStdout: string,
  probeExitCode: number,
  policy: GitDistributionPolicyV2 = GIT_DISTRIBUTION_POLICY,
): AdmittedGitDistributionV1 {
  if (probeExitCode !== 0) unsupported();
  const lines = probeStdout.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0 || lines.length > MAX_PROBE_LINES) unsupported();
  try {
    for (const line of lines) parseBoundedTextLine(line);
  } catch {
    return unsupported();
  }
  const [versionLine, ...options] = lines as [string, ...string[]];
  if (!meetsFloor(versionLine, policy.gitVersionFloor)) unsupported();
  for (const required of policy.requiredBuildOptionLines) {
    if (options.filter((line) => line === required).length !== 1) unsupported();
  }
  return { ...admitted, gitVersionLine: versionLine };
}
