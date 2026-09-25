import { join } from "node:path";

import { CLAUDE_DENY_RULES } from "@developer-os/adapter-claude";
import type { ClaudeDenyRulesV1 } from "@developer-os/adapter-claude";
import { PROTECTED_PATH_RULES } from "@developer-os/security";

import type { CliContext } from "../context.js";
import type { DoctorCheck } from "./doctor.js";
import { readUntrustedText, UntrustedFileRefusal } from "./untrusted-file.js";

export const VENDOR_SETTINGS_MAX_BYTES = 1024 * 1024;

export interface VendorConfigDependencies {
  readonly observation: ClaudeDenyRulesV1 | null;
}

const ID = "vendor-config";
const CODEX_NOTE = "Codex is not examined: Developer OS never reads the Codex config file";
export const VENDOR_CONFIG_RECOVERY =
  "add these deny rules to your Claude user settings; Developer OS never writes that file";

function warn(message: string, paths: readonly string[], recovery?: string): DoctorCheck {
  return {
    id: ID,
    status: "warn",
    message: `${message}; ${CODEX_NOTE}`,
    paths,
    ...(recovery === undefined ? {} : { recovery }),
  };
}

function denyList(parsed: unknown): readonly string[] | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const permissions: unknown = (parsed as { permissions?: unknown }).permissions;
  if (typeof permissions !== "object" || permissions === null) return null;
  const deny: unknown = (permissions as { deny?: unknown }).deny;
  if (!Array.isArray(deny) || !deny.every((entry) => typeof entry === "string")) return null;
  return deny;
}

/**
 * Spec §8. Never throws, never returns "fail": `guarded()` would turn a throw
 * into `fail`, so this check is not registered through it. Messages are built
 * only from constants and rule ids, never from the file's content.
 */
export async function checkVendorConfig(
  context: CliContext,
  dependencies: VendorConfigDependencies = { observation: CLAUDE_DENY_RULES },
): Promise<DoctorCheck> {
  const { observation } = dependencies;
  if (observation === null) {
    return warn("the Claude deny-rule syntax has not been observed for this product; nothing was compared", []);
  }
  if (context.env.CLAUDE_CONFIG_DIR !== undefined && context.env.CLAUDE_CONFIG_DIR !== "") {
    return warn("CLAUDE_CONFIG_DIR is set and not followed; the settings Claude reads were not compared", []);
  }
  let path: string | null = null;
  try {
    path = join(await context.guards.canonicalize(context.userHome), ".claude", "settings.json");
    const paths = [path];
    let text: string;
    try {
      text = await readUntrustedText(context, path, VENDOR_SETTINGS_MAX_BYTES);
    } catch (error) {
      if (!(error instanceof UntrustedFileRefusal)) throw error;
      return warn(
        error.reason === "not_found"
          ? "the Claude user settings file is absent"
          : `the Claude user settings file was not read: ${error.message}`,
        paths,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // JSON.parse quotes the input in its message; it is discarded (spec §4.2).
      return warn("the Claude user settings file is not valid JSON", paths);
    }
    const deny = denyList(parsed);
    if (deny === null) {
      return warn("the Claude user settings permissions.deny is not an array of strings", paths);
    }
    const present = new Set(deny);
    const missing = PROTECTED_PATH_RULES.map((rule) => rule.id)
      .filter((id) => !observation.rules[id].every((rule) => present.has(rule)))
      .sort();
    if (missing.length > 0) {
      return warn(`missing Claude deny rules: ${missing.join(", ")}`, paths, VENDOR_CONFIG_RECOVERY);
    }
    return {
      id: ID,
      status: "pass",
      message: `every protected-path deny rule is present; ${CODEX_NOTE}`,
      paths,
    };
  } catch {
    return warn("the Claude user settings could not be read", path === null ? [] : [path]);
  }
}
