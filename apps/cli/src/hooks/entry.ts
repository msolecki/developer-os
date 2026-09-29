import { randomBytes } from "node:crypto";

import { resolveRuntimePaths } from "@developer-os/core";
import { assertSafeCommand, createRedactor, NodeProcessRunner } from "@developer-os/security";

import { pathEnvironmentFor, PRODUCT_VERSION } from "../context.js";
import type { CliIo } from "../io.js";
import { HOOK_FAIL_MODE, parseHookArgv } from "./argv.js";
import type { HookVendor, HookVerb } from "./argv.js";
import { recordHookFiring } from "./firing-records.js";
import { writeHookOutcome } from "./outcome.js";
import { decodeHookPayload, MAX_HOOK_PAYLOAD_BYTES } from "./payload.js";
import { HOOK_HANDLERS } from "./registry.js";
import type { HookContextFactory, HookRuntime } from "./registry.js";

export interface HookEnvironment {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly userHome: string | null;
  readonly processCwd: () => string;
  readonly nodeExecutable: string;
  /** Test seam; defaults to `recordHookFiring` under the resolved product home. */
  readonly recordFiring?: (vendor: HookVendor, verb: HookVerb) => Promise<void>;
}

async function recordFiring(environment: HookEnvironment, vendor: HookVendor, verb: HookVerb): Promise<void> {
  try {
    if (environment.recordFiring !== undefined) {
      await environment.recordFiring(vendor, verb);
      return;
    }
    if (environment.userHome === null) return;
    const paths = resolveRuntimePaths(pathEnvironmentFor({ userHome: environment.userHome, env: environment.env }));
    await recordHookFiring({
      productHome: paths.home,
      stateDirectory: paths.stateDir,
      userHome: environment.userHome,
      vendor,
      verb,
      now: new Date(),
      productVersion: PRODUCT_VERSION,
      effectiveUid: process.getuid?.() ?? -1,
    });
  } catch {
    // Any error is swallowed: the record is an observation, not part of the outcome.
  }
}

/**
 * Every failure here maps through the verb's fail mode (Q1-A) and never reaches
 * `usageFailure()` or `emit()`: the product's exit 2 is the vendor's block code.
 * Guards redact with an ephemeral key because they read no product-home state (G3).
 */
export async function runHookMode(
  argv: readonly string[],
  io: CliIo,
  createContext: HookContextFactory,
  environment: HookEnvironment | undefined,
): Promise<number> {
  const redact = createRedactor(randomBytes(32));
  const redactText = (text: string): string => redact(text).text;
  const parsed = parseHookArgv(argv);
  const failed = (mode: "closed" | "open", vendor: HookVendor, why: string): number =>
    writeHookOutcome(
      mode === "closed"
        ? { kind: "block", ruleId: "hook-failed-closed", detail: why }
        : { kind: "allow", note: why },
      vendor,
      io,
      redactText,
    );
  let fired: HookVerb | null = null;
  try {
    if (environment?.env.DEVELOPER_OS_HOOK_ACTIVE === "1") return 0;
    if (!parsed.ok) return failed(parsed.failMode, parsed.vendor, "hook argv refused");
    const mode = HOOK_FAIL_MODE[parsed.verb];
    if (environment === undefined) return failed(mode, parsed.vendor, "hook environment unavailable");
    const handler = Object.hasOwn(HOOK_HANDLERS, parsed.verb) ? HOOK_HANDLERS[parsed.verb] : undefined;
    if (handler === undefined) return failed(mode, parsed.vendor, `hook verb ${parsed.verb} is not installed`);
    const bytes = io.readStdinBytes === undefined ? null : await io.readStdinBytes(MAX_HOOK_PAYLOAD_BYTES);
    const decoded = decodeHookPayload(bytes, parsed.vendor, parsed.verb);
    if (!decoded.ok) return failed(mode, parsed.vendor, `hook payload refused: ${decoded.reason}`);
    const runtime: HookRuntime = {
      vendor: parsed.vendor,
      env: environment.env,
      userHome: environment.userHome,
      cwd: decoded.payload.cwd ?? environment.processCwd(),
      runner: new NodeProcessRunner({ assertCommand: assertSafeCommand, redact }),
      nodeExecutable: environment.nodeExecutable,
      redact: redactText,
      now: () => new Date(),
      io,
      createContext,
    };
    fired = parsed.verb;
    const outcome = await handler(decoded.payload, runtime);
    return writeHookOutcome(outcome, parsed.vendor, io, redactText);
  } catch {
    return failed(
      parsed.ok ? HOOK_FAIL_MODE[parsed.verb] : parsed.failMode,
      parsed.ok ? parsed.vendor : "claude",
      "hook failed internally",
    );
  } finally {
    // Not awaited, so the caller sets the exit code before the write settles (`hooks.md` §3.6: best effort
    // after the outcome). A slow write still delays the process exit; it no longer withholds the code.
    if (fired !== null && parsed.ok && environment !== undefined) void recordFiring(environment, parsed.vendor, fired);
  }
}
