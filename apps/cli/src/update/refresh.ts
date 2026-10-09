import { spawn } from "node:child_process";

import { EXIT_CODES, parseCanonicalAbsolutePathText } from "@developer-os/core";
import type { ExitCode } from "@developer-os/core";
import { parseVendorHomeVariables, parseVendorSearchPath, VENDOR_SEARCH_PATH_VARIABLE, VendorHomeVariableError } from "@developer-os/platform-macos";

import type { CliContext } from "../context.js";
import { readActiveReleaseTree } from "../instructions/active-release.js";
import { InstructionRefusal } from "../instructions/attach.js";
import { entrypointPath } from "./local-release.js";

/** C2: the refresh is plain `init`; on an installed home it renders from the active bundle. */
export const REFRESH_ARGV = ["init"] as const;
/** The child's stdout would break the parent's one `--json` line; its stderr is the diagnostic. */
export const REFRESH_STDIO = ["ignore", "ignore", "inherit"] as const;

export interface RefreshProcessV1 {
  readonly executable: string;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

/** The launcher's closed environment (Spec 2 §3.1, `apps/launcher/src/environment.ts`): never `PATH`, nothing inherited but the vendor search path (NEW-202) and the vendor homes (NEW-208). */
export function refreshEnvironment(context: CliContext): Record<string, string> {
  const raw = context.env.DEVELOPER_OS_BRAIN;
  const vendor = parseVendorSearchPath(context.env[VENDOR_SEARCH_PATH_VARIABLE]);
  return {
    HOME: context.userHome,
    DEVELOPER_OS_HOME: context.paths.home,
    ...(raw === undefined || raw === "" ? {} : { DEVELOPER_OS_BRAIN: brain(raw, context) }),
    ...(vendor === null ? {} : { [VENDOR_SEARCH_PATH_VARIABLE]: vendor }),
    ...vendorHomes(context),
  };
}

/** The launcher's rule (`parseVendorHomeVariables`, NEW-208): an invalid vendor home is refused, exit 2, never passed on. */
function vendorHomes(context: CliContext): Record<string, string> {
  try {
    return parseVendorHomeVariables(context.env);
  } catch (cause) {
    if (!(cause instanceof VendorHomeVariableError)) throw cause;
    throw new InstructionRefusal({ reason: "vendor_home_invalid", code: EXIT_CODES.invalidInput, paths: [context.paths.home], recovery: `unset ${cause.variable} or set a canonical absolute path`, cause });
  }
}

/** The launcher's rule (`buildLauncherEnvironment`): an invalid Brain override is refused, exit 2, never passed on. */
function brain(raw: string, context: CliContext): string {
  try {
    return parseCanonicalAbsolutePathText(raw);
  } catch (cause) {
    throw new InstructionRefusal({ reason: "brain_override_invalid", code: EXIT_CODES.invalidInput, paths: [context.paths.home], recovery: "unset DEVELOPER_OS_BRAIN or set a canonical absolute path", cause });
  }
}

function noTree(context: CliContext): never {
  throw new InstructionRefusal({ reason: "active_release_tree_invalid", code: EXIT_CODES.recoveryRequired, paths: [context.paths.stateDir], recovery: "developer-os doctor" });
}

/** The newly active runtime on the version-free entrypoint: a rollback has already retired the runtime this process came from. */
export async function refreshProcess(context: CliContext): Promise<RefreshProcessV1> {
  // `update` admits only package-channel homes, so a null tree here is a broken home.
  const tree = (await readActiveReleaseTree(context)) ?? noTree(context);
  // The launcher's rule (`admitRetainedRelease`): the root is derived, never taken from the record, and matches the host.
  if (tree.bundleRoot !== `${context.paths.home}/releases/${tree.version}/darwin-${tree.architecture}` || tree.architecture !== (await context.platform.inspect()).architecture) {
    throw new InstructionRefusal({ reason: "active_release_root_mismatch", code: EXIT_CODES.recoveryRequired, paths: [tree.bundleRoot], recovery: "developer-os doctor" });
  }
  const executable = `${tree.bundleRoot}/${tree.runtimeEntrypoint}`;
  // The runtime must be the manifest's bytes (size and SHA-256), or a swapped file would run as the release.
  // ponytail: verify-then-spawn by path; the bundle is the caller's own 0700 tree, so the window is the owner's.
  await tree.readFile(executable);
  return { executable, argv: [entrypointPath(context.paths.home), ...REFRESH_ARGV], env: refreshEnvironment(context) };
}

/** 0–6 are the product's own codes; a signal, `null`, or a shell's 126/127 is an operational failure. */
export function refreshExitCode(code: number | null): ExitCode {
  return code !== null && Number.isInteger(code) && code >= 0 && code <= 6 ? (code as ExitCode) : EXIT_CODES.operationalFailure;
}

/**
 * K8's bound on the refresh child: ten minutes. The child is a whole `init`, whose Codex
 * registration alone runs several `codex` steps bounded at 60 s each; a refresh past this is hung.
 */
export const REFRESH_TIMEOUT_MS = 600_000;

/** A child past `timeoutMs` is killed; its `close`, after the kill, maps the signal to exit 1. */
export function runRefreshProcess(request: RefreshProcessV1, timeoutMs: number = REFRESH_TIMEOUT_MS): Promise<ExitCode> {
  return new Promise((resolve) => {
    const child = spawn(request.executable, [...request.argv], { env: { ...request.env }, stdio: [...REFRESH_STDIO] });
    // ponytail: kills the child only, not grandchildren it spawned; a process group if one is ever seen to outlive it.
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.once("error", () => {
      clearTimeout(timer);
      resolve(EXIT_CODES.operationalFailure);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve(refreshExitCode(code));
    });
  });
}

/** `CliUpdateContext.refresh` in production. Never throws: the swap has happened and only an exit code is left to report. */
export async function refreshActiveRelease(context: CliContext): Promise<ExitCode> {
  try {
    return await runRefreshProcess(await refreshProcess(context));
  } catch (error) {
    return error instanceof InstructionRefusal ? error.code : EXIT_CODES.operationalFailure;
  }
}
