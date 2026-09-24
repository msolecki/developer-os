import { EXIT_CODES } from "../result.js";

export const HOOK_GUARD_KINDS = ["command", "path", "commit", "stop", "format", "prompt", "edit"] as const;
export const HOOK_VENDORS = ["claude", "codex"] as const;
export type HookGuardKind = (typeof HOOK_GUARD_KINDS)[number];
export type HookVendor = (typeof HOOK_VENDORS)[number];
export type HookVerb = HookGuardKind | "inject";

export function hookCommandTail(verb: HookVerb, vendor: HookVendor): readonly string[] {
  return verb === "inject"
    ? ["brain", "status", "--inject", "--vendor", vendor]
    : ["guard", verb, "--vendor", vendor];
}

export class HookExecutablePathError extends Error {
  readonly code = EXIT_CODES.invalidInput;
  constructor(message: string) {
    super(message);
    this.name = "HookExecutablePathError";
  }
}

/**
 * Vendors run the command string through a shell, so an unsafe path is refused rather than quoted.
 * `@` is inert in sh, bash and zsh without a following `(`, which the charset excludes; it admits a
 * versioned cellar formula such as `/opt/homebrew/Cellar/node@24/...`.
 */
const SAFE = /^\/[A-Za-z0-9._+@/-]+$/u;
const VERSION_SEGMENT = /^\d+\.\d+\.\d+/u;
const HASH_SEGMENT = /^[0-9a-f]{16,}$/u;

/** The command names Node explicitly (G1 as resolved), so the entrypoint's `env node` shebang never runs. */
export interface HookCommandExecutable {
  readonly node: string;
  readonly entrypoint: string;
}

function assertShellSafeAbsolutePath(path: string, label: string): readonly string[] {
  if (!SAFE.test(path)) throw new HookExecutablePathError(`${label} must be absolute and shell-safe`);
  const segments = path.slice(1).split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) {
    throw new HookExecutablePathError(`${label} must be normalized`);
  }
  return segments;
}

/** No version-or-hash rule: a package-manager cellar Node path names its version. */
export function assertHookNodePath(path: string): void {
  assertShellSafeAbsolutePath(path, "hook node path");
}

export function assertHookExecutablePath(path: string): void {
  const segments = assertShellSafeAbsolutePath(path, "hook executable path");
  if (segments.some((s) => VERSION_SEGMENT.test(s) || HASH_SEGMENT.test(s))) {
    throw new HookExecutablePathError("hook executable path must not name a version or a hash");
  }
}

export function renderHookCommand(executable: HookCommandExecutable, verb: HookVerb, vendor: HookVendor): string {
  assertHookNodePath(executable.node);
  assertHookExecutablePath(executable.entrypoint);
  return [executable.node, executable.entrypoint, ...hookCommandTail(verb, vendor)].join(" ");
}
