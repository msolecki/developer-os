/**
 * The one supported Git distribution row (NEW-84 re-pinning rule 1). Spec 1
 * §4.2 as amended 2026-09-23 (D59): measured read-only on 2026-09-23. No other
 * file restates a hash, size, build or version literal; re-pinning replaces
 * this row, its process table and every exact-set test in one change.
 */
import {
  encodeCanonicalJson,
  parseCanonicalAbsolutePathText,
  parseLowerHexSha256,
  type CanonicalAbsolutePathV1,
  type CanonicalJsonValue,
} from "@developer-os/core";

import { SecurityRefusalError } from "../paths.js";
import {
  parseBoundedLinkTarget,
  parseBoundedTextLine,
  SUPPORTED_GIT_DISTRIBUTION_ID,
  SUPPORTED_GIT_PROCESS_TABLE,
  validateSupportedGitProcessTable,
} from "./process-table.js";
import {
  GIT_EXEC_PATH_LINK_NAMES,
  GIT_EXECUTABLE_IDS,
  type ExecutableFileIdentityV1,
  type GitExecPathLinkV1,
  type ObservedGitDistributionV1,
  type SupportedGitDistributionV1,
  type SupportedGitExecutableV1,
} from "./types.js";

const DEVELOPER = "/Applications/Xcode.app/Contents/Developer";
const EXEC_PATH = `${DEVELOPER}/usr/libexec/git-core`;
const path = (text: string): CanonicalAbsolutePathV1 => parseCanonicalAbsolutePathText(text);
const sha256 = parseLowerHexSha256;

function fail(label: string): never {
  throw new Error(`invalid ${label}`);
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label);
  return value as Readonly<Record<string, unknown>>;
}

function exact(value: unknown, keys: readonly string[], label: string): Readonly<Record<string, unknown>> {
  const input = record(value, label);
  if (Object.keys(input).length !== keys.length || keys.some((key) => !Object.hasOwn(input, key))) {
    fail(`${label}: keys`);
  }
  return input;
}

function array(value: unknown, minimum: number, maximum: number, label: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) fail(`${label}: length`);
  return value as readonly unknown[];
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail(label);
  return value;
}

function assertSortedUnique(values: readonly string[], label: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (!((values[index - 1] as string) < (values[index] as string))) fail(`${label}: not sorted and unique`);
  }
}

function parseExecutableIdentity(value: unknown, label: string): ExecutableFileIdentityV1 {
  const input = exact(value, ["canonicalPath", "ownerUid", "mode", "size", "sha256"], label);
  if (input.ownerUid !== 0) fail(`${label}.ownerUid`);
  return {
    canonicalPath: parseCanonicalAbsolutePathText(input.canonicalPath),
    ownerUid: 0,
    mode: integer(input.mode, 0, 0o7777, `${label}.mode`),
    size: integer(input.size, 1, Number.MAX_SAFE_INTEGER, `${label}.size`),
    sha256: sha256(input.sha256),
  };
}

function parseExecutable(value: unknown, label: string): SupportedGitExecutableV1 {
  const input = exact(value, ["id", "invokedPath", "linkChain", "target", "versionLines"], label);
  const id = input.id;
  if (typeof id !== "string" || !(GIT_EXECUTABLE_IDS as readonly string[]).includes(id)) fail(`${label}.id`);
  const linkChain = array(input.linkChain, 0, 8, `${label}.linkChain`).map((link, index) => {
    const fields = exact(link, ["path", "target"], `${label}.linkChain[${String(index)}]`);
    return { path: parseCanonicalAbsolutePathText(fields.path), target: parseBoundedLinkTarget(fields.target) };
  });
  if (new Set(linkChain.map((link) => link.path)).size !== linkChain.length) fail(`${label}.linkChain: repeated path`);
  const versionLines = array(input.versionLines, 0, 32, `${label}.versionLines`).map(parseBoundedTextLine);
  if ((id === "git_remote_https") !== (versionLines.length === 0)) fail(`${label}.versionLines`);
  return {
    id: id as SupportedGitExecutableV1["id"],
    invokedPath: parseCanonicalAbsolutePathText(input.invokedPath),
    linkChain,
    target: parseExecutableIdentity(input.target, `${label}.target`),
    versionLines,
  };
}

/** A size-13 link is always `../../bin/git` and the one size-15 link is `git-remote-http`; nothing else is measured. */
const LINK_TARGET_BY_SIZE: Readonly<Record<13 | 15, string>> = { 13: "../../bin/git", 15: "git-remote-http" };

function parseExecPathLink(value: unknown, label: string): GitExecPathLinkV1 {
  const input = exact(value, ["name", "path", "ownerUid", "mode", "size", "target"], label);
  const name = input.name;
  if (typeof name !== "string" || !(GIT_EXEC_PATH_LINK_NAMES as readonly string[]).includes(name)) fail(`${label}.name`);
  if (input.ownerUid !== 0) fail(`${label}.ownerUid`);
  if (input.mode !== 493) fail(`${label}.mode`);
  if (input.size !== 13 && input.size !== 15) fail(`${label}.size`);
  const target = parseBoundedLinkTarget(input.target);
  if (target !== LINK_TARGET_BY_SIZE[input.size] || (input.size === 15) !== (name === "git-remote-https")) {
    fail(`${label}.target`);
  }
  return {
    name: name as GitExecPathLinkV1["name"],
    path: parseCanonicalAbsolutePathText(input.path),
    ownerUid: 0,
    mode: 493,
    size: input.size,
    target,
  };
}

function parseDistributionShape(value: unknown): SupportedGitDistributionV1 {
  const label = "SupportedGitDistributionV1";
  const input = exact(
    value,
    ["schemaVersion", "id", "xcode", "architecture", "buildOptionLines", "executables", "execPathLinks", "processTable"],
    label,
  );
  if (input.schemaVersion !== 1) fail(`${label}.schemaVersion`);
  if (input.id !== SUPPORTED_GIT_DISTRIBUTION_ID) fail(`${label}.id`);
  const xcode = exact(input.xcode, ["version", "build"], `${label}.xcode`);
  if (xcode.version !== "27.0" || xcode.build !== "27A266a") fail(`${label}.xcode`);
  if (input.architecture !== "arm64") fail(`${label}.architecture`);
  const executables = array(input.executables, 3, 3, `${label}.executables`).map((item, index) =>
    parseExecutable(item, `${label}.executables[${String(index)}]`),
  );
  assertSortedUnique(
    executables.map((executable) => executable.id),
    `${label}.executables`,
  );
  const execPathLinks = array(input.execPathLinks, 6, 6, `${label}.execPathLinks`).map((item, index) =>
    parseExecPathLink(item, `${label}.execPathLinks[${String(index)}]`),
  );
  assertSortedUnique(
    execPathLinks.map((link) => link.name),
    `${label}.execPathLinks`,
  );
  return {
    schemaVersion: 1,
    id: SUPPORTED_GIT_DISTRIBUTION_ID,
    xcode: { version: "27.0", build: "27A266a" },
    architecture: "arm64",
    buildOptionLines: array(input.buildOptionLines, 13, 13, `${label}.buildOptionLines`).map(parseBoundedTextLine),
    executables,
    execPathLinks,
    processTable: validateSupportedGitProcessTable(input.processTable),
  };
}

const execPathLink = (name: GitExecPathLinkV1["name"]): GitExecPathLinkV1 => {
  const size = name === "git-remote-https" ? 15 : 13;
  return { name, path: path(`${EXEC_PATH}/${name}`), ownerUid: 0, mode: 493, size, target: LINK_TARGET_BY_SIZE[size] };
};

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const SUPPORTED_GIT_DISTRIBUTION: SupportedGitDistributionV1 = deepFreeze(
  parseDistributionShape({
    schemaVersion: 1,
    id: SUPPORTED_GIT_DISTRIBUTION_ID,
    xcode: { version: "27.0", build: "27A266a" },
    architecture: "arm64",
    buildOptionLines: [
      "cpu: arm64",
      "no commit associated with this build",
      "sizeof-long: 8",
      "sizeof-size_t: 8",
      "shell-path: /bin/sh",
      "rust: disabled",
      "feature: fsmonitor--daemon",
      "libcurl: 8.7.1",
      "zlib: 1.2.12",
      "SHA-1: SHA1_DC",
      "SHA-256: SHA256_BLK",
      "default-ref-format: files",
      "default-hash: sha1",
    ],
    executables: [
      {
        id: "git_main",
        invokedPath: path(`${DEVELOPER}/usr/bin/git`),
        linkChain: [],
        target: {
          canonicalPath: path(`${DEVELOPER}/usr/bin/git`),
          ownerUid: 0,
          mode: 493,
          size: 3837392,
          sha256: sha256("9a1c8fc68dc75e1b3c0cd8e5ad9d13ac9bc92cb53c9578b3cff4beaf2e9b1e70"),
        },
        versionLines: ["git version 2.54.0 (Apple Git-157)"],
      },
      {
        id: "git_remote_https",
        invokedPath: path(`${EXEC_PATH}/git-remote-https`),
        linkChain: [{ path: path(`${EXEC_PATH}/git-remote-https`), target: "git-remote-http" }],
        target: {
          canonicalPath: path(`${EXEC_PATH}/git-remote-http`),
          ownerUid: 0,
          mode: 493,
          size: 2346832,
          sha256: sha256("1a68d873ea23502f44e63d8013ad2d1374a8f0161fe4a07ba8f708f686794124"),
        },
        versionLines: [],
      },
      {
        id: "system_ssh",
        invokedPath: path("/usr/bin/ssh"),
        linkChain: [],
        target: {
          canonicalPath: path("/usr/bin/ssh"),
          ownerUid: 0,
          mode: 493,
          size: 1584576,
          sha256: sha256("17542914a3fb55e7efeb35a90d594a21c84bf6a4cfe1fc8ddff5606dc2658fc3"),
        },
        versionLines: ["OpenSSH_10.3p1, LibreSSL 3.3.6"],
      },
    ],
    execPathLinks: GIT_EXEC_PATH_LINK_NAMES.map(execPathLink),
    processTable: SUPPORTED_GIT_PROCESS_TABLE,
  }),
);

const SUPPORTED_GIT_DISTRIBUTION_BYTES = encodeCanonicalJson(SUPPORTED_GIT_DISTRIBUTION as unknown as CanonicalJsonValue);

/** Exact-set identity, as for the process table: a well-formed row that is not the compiled row is unsupported. */
export function validateSupportedGitDistribution(value: unknown): SupportedGitDistributionV1 {
  const row = parseDistributionShape(value);
  if (encodeCanonicalJson(row as unknown as CanonicalJsonValue) !== SUPPORTED_GIT_DISTRIBUTION_BYTES) {
    fail("SupportedGitDistributionV1: not the compiled row");
  }
  return SUPPORTED_GIT_DISTRIBUTION;
}

/** The measurable half of a row: what planning compares an observation against. */
export function gitDistributionIdentity(row: SupportedGitDistributionV1): ObservedGitDistributionV1 {
  return {
    xcode: row.xcode,
    architecture: row.architecture,
    buildOptionLines: row.buildOptionLines,
    executables: row.executables,
    execPathLinks: row.execPathLinks,
  };
}

/**
 * Version text is never identity on its own: every measured field must equal
 * the row byte for byte. Any drift, malformed observation or unsupported row
 * refuses before a repository or network process exists.
 */
export function admitGitDistribution(observed: ObservedGitDistributionV1, row: SupportedGitDistributionV1): void {
  let admitted = false;
  try {
    const supported = validateSupportedGitDistribution(row);
    admitted =
      encodeCanonicalJson(observed as unknown as CanonicalJsonValue) ===
      encodeCanonicalJson(gitDistributionIdentity(supported) as unknown as CanonicalJsonValue);
  } catch {
    admitted = false;
  }
  if (!admitted) throw new SecurityRefusalError("unsupported_git_distribution");
}
