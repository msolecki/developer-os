import { spawn } from "node:child_process";

import { EXIT_CODES, parseCanonicalAbsolutePathText } from "@developer-os/core";
import type { ExitCode } from "@developer-os/core";

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

/** The launcher's closed environment (Spec 2 §3.1, `apps/launcher/src/environment.ts`): never `PATH`, nothing inherited. */
export function refreshEnvironment(context: CliContext): Record<string, string> {
  const raw = context.env.DEVELOPER_OS_BRAIN;
  return {
    HOME: context.userHome,
    DEVELOPER_OS_HOME: context.paths.home,
    ...(raw === undefined || raw === "" ? {} : { DEVELOPER_OS_BRAIN: brain(raw, context) }),
  };
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
  return { executable: `${tree.bundleRoot}/${tree.runtimeEntrypoint}`, argv: [entrypointPath(context.paths.home), ...REFRESH_ARGV], env: refreshEnvironment(context) };
}

/** 0–6 are the product's own codes; a signal, `null`, or a shell's 126/127 is an operational failure. */
export function refreshExitCode(code: number | null): ExitCode {
  return code !== null && Number.isInteger(code) && code >= 0 && code <= 6 ? (code as ExitCode) : EXIT_CODES.operationalFailure;
}

export function runRefreshProcess(request: RefreshProcessV1): Promise<ExitCode> {
  return new Promise((resolve) => {
    const child = spawn(request.executable, [...request.argv], { env: { ...request.env }, stdio: [...REFRESH_STDIO] });
    child.once("error", () => {
      resolve(EXIT_CODES.operationalFailure);
    });
    child.once("close", (code) => {
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
// ponytail: no timeout on the child, as the launcher sets none; add one if a hung refresh is ever observed.
