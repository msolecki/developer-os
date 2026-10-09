import { parseCanonicalAbsolutePathText } from "@developer-os/core";

/**
 * NEW-208 (Spec 2 §3.1 and K8, "Amended 2026-10-09"): the vendor-home variables the launcher's
 * closed CLI environment and the K8 refresh environment pass on. Both iterate this one list, so
 * they cannot drift apart. The CLI keeps its own rule for each: `CODEX_HOME` is honoured when
 * absolute (`resolveVendorHomes`), `CLAUDE_CONFIG_DIR` is never followed, only warned about.
 * `tests/repository/vendor-home-variables.test.ts` pins the readers of this module.
 */
export const VENDOR_HOME_VARIABLES = ["CODEX_HOME", "CLAUDE_CONFIG_DIR"] as const;

export type VendorHomeVariable = (typeof VENDOR_HOME_VARIABLES)[number];

/** A set vendor-home variable that is not a canonical absolute path; the caller refuses with exit 2. */
export class VendorHomeVariableError extends Error {
  constructor(
    readonly variable: VendorHomeVariable,
    options?: ErrorOptions,
  ) {
    super(`${variable} must be a non-empty canonical absolute path`, options);
    this.name = "VendorHomeVariableError";
  }
}

/**
 * The variables to pass on. Absent or empty is not passed, as the CLI reads an empty value as
 * unset. Any other value must pass the Brain override's grammar (canonical absolute, bounded,
 * no NUL) or this throws: dropping it would silently put Codex artifacts under `~/.codex`.
 */
export function parseVendorHomeVariables(
  env: Readonly<Partial<Record<VendorHomeVariable, string | undefined>>>,
): Partial<Record<VendorHomeVariable, string>> {
  const passed: Partial<Record<VendorHomeVariable, string>> = {};
  for (const variable of VENDOR_HOME_VARIABLES) {
    const raw = env[variable];
    if (raw === undefined || raw === "") continue;
    try {
      passed[variable] = parseCanonicalAbsolutePathText(raw);
    } catch (cause) {
      throw new VendorHomeVariableError(variable, { cause });
    }
  }
  return passed;
}
