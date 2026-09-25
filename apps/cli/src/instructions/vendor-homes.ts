import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { parseCanonicalAbsolutePathText } from "@developer-os/core";
import type { CanonicalAbsolutePathV1 } from "@developer-os/core";

/** Spec §2.2: `H`, `P` and `C`, resolved once per command. */
export interface VendorHomesV1 {
  readonly userHome: CanonicalAbsolutePathV1;
  readonly productHome: CanonicalAbsolutePathV1;
  readonly codexHome: CanonicalAbsolutePathV1;
}

const MAX_CODEX_HOME_RECORD_BYTES = 4096;

/** Where the Codex attach records `C`, in the same transaction as its rows. */
export const codexHomeRecordPath = (productHome: string): string => join(resolve(productHome), "codex", "codex-home");

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
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`the recorded Codex home ${path} is unreadable`, { cause: error });
  }
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile() || stats.uid !== process.getuid?.() || stats.size > MAX_CODEX_HOME_RECORD_BYTES) {
      throw new Error(`the recorded Codex home ${path} is not an owned regular file`);
    }
    const text = readFileSync(fd, "utf8");
    if (!text.endsWith("\n")) throw new Error(`the recorded Codex home ${path} is malformed`);
    return parseCanonicalAbsolutePathText(text.slice(0, -1));
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

export const codexInstructionPaths = (homes: VendorHomesV1) =>
  ({
    agentsDir: join(homes.codexHome, "agents"),
    instructionFile: join(homes.codexHome, "AGENTS.md"),
    pluginRoot: join(homes.productHome, "codex", "plugins", "developer-os"),
    registrationFile: join(homes.productHome, "codex", "registration.json"),
  }) as const;
