import { EXIT_CODES, loadConfig } from "@developer-os/core";
import type { DeveloperOsConfigV1 } from "@developer-os/core";

import type { CliContext } from "./context.js";

export function isMissingEntry(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

export class ConfigurationError extends Error {
  readonly code = EXIT_CODES.invalidInput;

  constructor() {
    super("the configuration file is not valid Developer OS configuration");
    this.name = "ConfigurationError";
  }
}

/**
 * Reads configuration through the protected-path policy rather than a bare
 * `readFile`. The policy canonicalizes first and opens the canonical path with
 * `O_NOFOLLOW` plus a `dev`/`ino` re-check, so what refuses a `config.toml`
 * symlinked at `~/.aws/credentials` is the protected-path denylist, not
 * `O_NOFOLLOW` — a symlink at an unprotected file is still followed and read.
 *
 * The parser's own message never escapes: `smol-toml` embeds three raw source
 * lines in `TomlError.message`, so propagating it would print the contents of
 * whatever file was read into `status`, `doctor`, and their JSON output.
 * Redaction is a heuristic and must not be the only thing standing there.
 */
export async function readConfigFile(
  context: CliContext,
  configFile: string,
): Promise<DeveloperOsConfigV1 | null> {
  /**
   * Absence is checked here rather than by catching: the guarded reader reports
   * a missing file as a security refusal, which is the right answer for a read
   * but the wrong one for "this machine has never been initialized".
   */
  try {
    await context.fs.lstat(configFile);
  } catch (error) {
    if (isMissingEntry(error)) return null;
    throw error;
  }

  const serialized = await context.guards.readText(configFile);

  let config: DeveloperOsConfigV1;
  try {
    config = loadConfig(serialized);
  } catch {
    throw new ConfigurationError();
  }
  context.bindRedactionPatterns?.(config.redaction?.patterns ?? []);
  return config;
}
