import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { LifecycleRecoveryRequiredError, parseCanonicalAbsolutePathText, resolveRuntimePaths } from "@developer-os/core";
import type { CanonicalAbsolutePathV1 } from "@developer-os/core";

/** `foundation.md` §12.5: `H`, `P` and `C`, resolved once per command. */
export interface VendorHomesV1 {
  readonly userHome: CanonicalAbsolutePathV1;
  readonly productHome: CanonicalAbsolutePathV1;
  readonly codexHome: CanonicalAbsolutePathV1;
}

const MAX_CODEX_HOME_RECORD_BYTES = 4096;

/** Where the Codex attach records `C`, in the same transaction as its rows. */
export const codexHomeRecordPath = (productHome: string): string => join(resolve(productHome), "codex", "codex-home");

/** FLOW-UNINST-3: the way out of a `codex_home_record_shape` refusal. */
export const codexHomeRecordRepair = (path: string): string =>
  `remove ${path}, which must be an owned regular file holding one absolute path and a newline, then run the command again`;

/** `CODEX_HOME` when absolute, else `H/.codex`. */
export function codexHomeFromEnv(env: Readonly<Record<string, string | undefined>>, userHome: string): CanonicalAbsolutePathV1 {
  const codexHome = env.CODEX_HOME;
  return (codexHome !== undefined && isAbsolute(codexHome) ? resolve(codexHome) : join(resolve(userHome), ".codex")) as CanonicalAbsolutePathV1;
}

/**
 * The recorded `C`, or `null` before any Codex attach. No-follow, owned by this user, bounded and
 * canonical, or it refuses: admission must never fall back to the environment past a bad record.
 */
export function readRecordedCodexHome(productHome: string): CanonicalAbsolutePathV1 | null {
  const path = codexHomeRecordPath(productHome);
  // FLOW-UNINST-3: typed, so doctor reports it as a check and uninstall names the repair.
  const refuse = (): never => {
    throw new LifecycleRecoveryRequiredError("codex_home_record_shape", [path]);
  };
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return refuse();
  }
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile() || stats.uid !== process.getuid?.() || stats.size > MAX_CODEX_HOME_RECORD_BYTES) refuse();
    const text = readFileSync(fd, "utf8");
    if (!text.endsWith("\n")) refuse();
    try {
      return parseCanonicalAbsolutePathText(text.slice(0, -1));
    } catch {
      return refuse();
    }
  } finally {
    closeSync(fd);
  }
}

/**
 * `C` is the value the Codex attach recorded, so a later command or a launchd job without
 * `CODEX_HOME` admits and unregisters the same home; before any attach it is `codexHomeFromEnv`.
 * `CLAUDE_CONFIG_DIR` is never followed.
 */
export function resolveVendorHomes(
  env: Readonly<Record<string, string | undefined>>,
  userHome: string,
  productHome: string,
): VendorHomesV1 {
  return {
    userHome: resolve(userHome) as CanonicalAbsolutePathV1,
    productHome: resolve(productHome) as CanonicalAbsolutePathV1,
    codexHome: readRecordedCodexHome(productHome) ?? codexHomeFromEnv(env, userHome),
  };
}

/**
 * CRITIC-2: the Codex homes whose `auth.json` `ProtectedPathPolicy` refuses besides `~/.codex`:
 * `CODEX_HOME` and the home a Codex attach recorded. Never throws, because a guard or `doctor` must
 * still run: an unreadable record (which every command that admits it refuses on its own) adds
 * nothing, and the other two homes stay protected.
 */
export function protectedCodexHomes(env: Readonly<Record<string, string | undefined>>, userHome: string): readonly string[] {
  const homes: string[] = [codexHomeFromEnv(env, userHome)];
  try {
    const productHome = env.DEVELOPER_OS_HOME;
    const recorded = readRecordedCodexHome(resolveRuntimePaths({ HOME: userHome, ...(productHome === undefined ? {} : { DEVELOPER_OS_HOME: productHome }) }).home);
    if (recorded !== null) homes.push(recorded);
  } catch {
    // See above: the record is refused where it is admitted.
  }
  return homes;
}

export const claudeInstructionPaths = (homes: VendorHomesV1) => {
  const claude = join(homes.userHome, ".claude");
  return {
    pluginRoot: join(claude, "skills", "developer-os"),
    rulesDir: join(claude, "rules"),
    outputStylesDir: join(claude, "output-styles"),
    instructionFile: join(claude, "CLAUDE.md"),
    importDir: join(homes.productHome, "claude", "instructions"),
  } as const;
};

/** The record `init` writes for the installed Codex plugin tree; it lives under the product home. */
export const codexRegistrationFile = (productHome: string): string => join(productHome, "codex", "registration.json");

export const codexInstructionPaths = (homes: VendorHomesV1) =>
  ({
    agentsDir: join(homes.codexHome, "agents"),
    instructionFile: join(homes.codexHome, "AGENTS.md"),
    pluginRoot: join(homes.productHome, "codex", "plugins", "developer-os"),
    registrationFile: codexRegistrationFile(homes.productHome),
  }) as const;
