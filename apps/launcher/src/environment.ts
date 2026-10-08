import { EXIT_CODES, parseCanonicalAbsolutePathText } from "@developer-os/core";
import { parseVendorSearchPath } from "@developer-os/platform-macos";

/**
 * The closed, sanitized environment the launcher hands the CLI process. Spec
 * 2 §3.1: "This path-context handoff is the sole exception to the empty
 * environment" — nothing here is read from, merged with, or inherited from
 * the launcher's own `process.env`.
 */
export interface LauncherEnvironmentV1 {
  readonly HOME: string;
  readonly DEVELOPER_OS_HOME: string;
  readonly DEVELOPER_OS_BRAIN?: string;
  /** The `PATH` the launcher received, for vendor discovery only (NEW-202). */
  readonly DEVELOPER_OS_VENDOR_SEARCH_PATH?: string;
}

export interface LauncherEnvironmentRequestV1 {
  /** The raw `HOME` candidate. Validated here; never resolved or opened. */
  readonly home: string;
  /**
   * The already-resolved, already-canonical product home (the same guarded
   * default/`DEVELOPER_OS_HOME` grammar the CLI itself uses). The launcher
   * does not compute a default here a second time; the caller resolves it
   * once and this function only re-checks its shape.
   */
  readonly productHome: string;
  /**
   * The raw `DEVELOPER_OS_BRAIN` override, or `null` when absent. Its
   * grammar is checked; it is never resolved, canonicalized, or opened —
   * "the launcher does not resolve or open the Brain" (Spec 2 §3.1).
   */
  readonly brainOverride: string | null;
  /**
   * The launcher's own `PATH`, or `null` when absent. Passed on as
   * `DEVELOPER_OS_VENDOR_SEARCH_PATH` when `parseVendorSearchPath` accepts it;
   * otherwise simply not passed — never a refusal (NEW-202).
   */
  readonly vendorSearchPath: string | null;
}

/** Missing/invalid `HOME` or an invalid Brain override: exit 2 before exec (Spec 2 §3.1). */
export class LauncherEnvironmentError extends Error {
  readonly code = EXIT_CODES.invalidInput;

  constructor(message: string) {
    super(message);
    this.name = "LauncherEnvironmentError";
  }
}

/** Spec 2 §3.1 requires a canonical `HOME`: the same grammar as the Brain override below. */
function assertAbsolute(value: string, label: string): void {
  try {
    parseCanonicalAbsolutePathText(value);
  } catch {
    throw new LauncherEnvironmentError(`${label} must be a non-empty canonical absolute path`);
  }
}

export function buildLauncherEnvironment(request: LauncherEnvironmentRequestV1): LauncherEnvironmentV1 {
  assertAbsolute(request.home, "HOME");
  assertAbsolute(request.productHome, "DEVELOPER_OS_HOME");

  const vendor = parseVendorSearchPath(request.vendorSearchPath ?? undefined);
  const base = {
    HOME: request.home,
    DEVELOPER_OS_HOME: request.productHome,
    ...(vendor === null ? {} : { DEVELOPER_OS_VENDOR_SEARCH_PATH: vendor }),
  };
  if (request.brainOverride === null) return base;

  let brain: string;
  try {
    brain = parseCanonicalAbsolutePathText(request.brainOverride);
  } catch {
    throw new LauncherEnvironmentError("DEVELOPER_OS_BRAIN must be a valid bounded absolute path");
  }

  return { ...base, DEVELOPER_OS_BRAIN: brain };
}
