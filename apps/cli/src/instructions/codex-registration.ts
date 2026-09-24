import { cwd } from "node:process";

import { MARKETPLACE_NAME, PLUGIN_NAME } from "@developer-os/adapter-codex";
import {
  decodeCanonicalJson,
  EXIT_CODES,
  hashCanonicalJson,
  parseCanonicalAbsolutePathText,
  parseLowerHexSha256,
} from "@developer-os/core";
import type { CanonicalAbsolutePathV1, LowerHexSha256 } from "@developer-os/core";
import { parseStructuredPayload, SecurityRefusalError } from "@developer-os/security";
import type { ProcessResult, ProcessRunner } from "@developer-os/security";
import { compareCodePoints } from "@developer-os/workflow-schema";

export interface CodexRegistrationRecordV1 {
  readonly treeHash: LowerHexSha256;
  readonly codexHome: CanonicalAbsolutePathV1;
}

export type CodexRegistrationStateV1 = "registered" | "unregistered" | "stale";

export const CODEX_CLI_ABSENT_WARNING = "codex registration not removed: codex CLI absent";

const PLUGIN_ID = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;
const RECORD_KEYS = ["codexHome", "treeHash"] as const;
const MAX_RECORD_BYTES = 8 * 1024;
const TIMEOUT_MS = 60_000;

export class CodexRegistrationFailedError extends Error {
  readonly code: typeof EXIT_CODES.operationalFailure = EXIT_CODES.operationalFailure;
  readonly reason = "codex_registration_failed" as const;
  readonly paths: readonly string[];

  constructor(step: string, codexHome: string, detail: string) {
    super(`codex registration failed at \`codex ${step}\`: ${detail}`);
    this.name = "CodexRegistrationFailedError";
    this.paths = [codexHome];
  }
}

export function validateCodexRegistrationRecord(bytes: Uint8Array): CodexRegistrationRecordV1 {
  const value = decodeCanonicalJson(bytes, MAX_RECORD_BYTES);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("invalid CodexRegistrationRecordV1: not an object");
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== RECORD_KEYS.length || keys.some((key, index) => key !== RECORD_KEYS[index])) {
    throw new Error("invalid CodexRegistrationRecordV1: key set");
  }
  const record = value as Record<string, unknown>;
  return {
    treeHash: parseLowerHexSha256(record.treeHash),
    codexHome: parseCanonicalAbsolutePathText(record.codexHome),
  };
}

export function codexPluginTreeHash(
  files: readonly { readonly path: string; readonly sha256: LowerHexSha256 }[],
): LowerHexSha256 {
  if (files.length === 0) throw new Error("codex plugin tree is empty");
  const entries = files
    .map(({ path, sha256 }) => ({ path, sha256: parseLowerHexSha256(sha256) }))
    .sort((left, right) => compareCodePoints(left.path, right.path));
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index]?.path === entries[index - 1]?.path) throw new Error("codex plugin tree has a duplicate path");
  }
  return hashCanonicalJson("developer-os:codex-plugin-tree:v1", entries);
}

interface CodexCall {
  readonly runner: ProcessRunner;
  readonly codexExecutable: string;
  readonly codexHome: string;
}

/**
 * Only a process failure becomes `codex_registration_failed`; a `SecurityRefusalError` from the
 * runner's policy propagates as the security refusal it is.
 */
async function run(call: CodexCall, args: readonly string[]): Promise<ProcessResult> {
  let result: ProcessResult;
  try {
    result = await call.runner.run({
      executable: call.codexExecutable,
      args,
      cwd: cwd(),
      stdin: "",
      timeoutMs: TIMEOUT_MS,
      env: { CODEX_HOME: call.codexHome },
    });
  } catch (error) {
    if (error instanceof SecurityRefusalError) throw error;
    throw new CodexRegistrationFailedError(args.join(" "), call.codexHome, "could not run");
  }
  if (result.timedOut) throw new CodexRegistrationFailedError(args.join(" "), call.codexHome, "timed out");
  if (result.exitCode !== 0) {
    throw new CodexRegistrationFailedError(args.join(" "), call.codexHome, `exit ${String(result.exitCode)}`);
  }
  return result;
}

interface InstalledPlugin {
  readonly enabled: unknown;
  readonly sourcePath: unknown;
}

/** Loose on vendor extras, strict on the three facts read (`codex-adapter.md` §4, §15). */
async function listInstalled(call: CodexCall): Promise<readonly InstalledPlugin[]> {
  const args = ["plugin", "list", "--json"];
  const parsed = parseStructuredPayload((await run(call, args)).stdout);
  const installed = parsed.ok && typeof parsed.payload === "object" && parsed.payload !== null
    ? (parsed.payload as { installed?: unknown }).installed
    : undefined;
  if (!Array.isArray(installed)) {
    throw new CodexRegistrationFailedError(args.join(" "), call.codexHome, "unreadable listing");
  }
  return installed.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { name, enabled, source } = entry as { name?: unknown; enabled?: unknown; source?: unknown };
    if (name !== PLUGIN_NAME) return [];
    const sourcePath = typeof source === "object" && source !== null ? (source as { path?: unknown }).path : undefined;
    return [{ enabled, sourcePath }];
  });
}

function registeredAt(installed: readonly InstalledPlugin[], pluginRoot: string): boolean {
  return installed.some((plugin) => plugin.enabled === true && plugin.sourcePath === pluginRoot);
}

/**
 * `plugin list --json` does not name marketplaces; the observed signal is this text listing,
 * one `<name>  <root>` line per marketplace or `No plugin marketplaces in scope.`
 * (`codex-adapter.md` §15). `marketplace add` over a registered marketplace was never observed,
 * so it is never run blind.
 */
async function marketplacePresent(call: CodexCall): Promise<boolean> {
  const { stdout } = await run(call, ["plugin", "marketplace", "list"]);
  return stdout.split("\n").some((line) => line.trim().split(/\s+/u)[0] === MARKETPLACE_NAME);
}

export async function inspectCodexRegistration(input: {
  readonly runner: ProcessRunner;
  readonly codexExecutable: string;
  readonly codexHome: string;
  readonly pluginRoot: string;
  readonly record: CodexRegistrationRecordV1 | null;
  readonly treeHash: LowerHexSha256;
}): Promise<CodexRegistrationStateV1> {
  if (!registeredAt(await listInstalled(input), input.pluginRoot)) return "unregistered";
  /** No row means no registration ever completed, even if `plugin add` landed (spec §6.4, first partial state). */
  if (input.record === null) return "unregistered";
  if (input.record.treeHash !== input.treeHash || input.record.codexHome !== input.codexHome) {
    return "stale";
  }
  return "registered";
}

/** Spec §6.4: `plugin add` always runs, because it is what refreshes Codex's cache copy. */
export async function registerCodexPlugin(input: {
  readonly runner: ProcessRunner;
  readonly codexExecutable: string;
  readonly codexHome: string;
  readonly marketplaceRoot: string;
  readonly pluginRoot: string;
}): Promise<void> {
  if (!(await marketplacePresent(input))) {
    await run(input, ["plugin", "marketplace", "add", input.marketplaceRoot]);
  }
  await run(input, ["plugin", "add", PLUGIN_ID, "--json"]);
  if (!registeredAt(await listInstalled(input), input.pluginRoot)) {
    throw new CodexRegistrationFailedError("plugin list --json", input.codexHome, "plugin not listed enabled at the plugin root");
  }
}

/** Runs before any file mutation; a present CLI that fails throws, so the caller mutates nothing. */
export async function unregisterCodexPlugin(input: {
  readonly runner: ProcessRunner;
  readonly codexExecutable: string | null;
  readonly codexHome: string;
}): Promise<{ readonly warning: string | null }> {
  if (input.codexExecutable === null) return { warning: CODEX_CLI_ABSENT_WARNING };
  const call: CodexCall = { runner: input.runner, codexExecutable: input.codexExecutable, codexHome: input.codexHome };
  if ((await listInstalled(call)).length > 0) {
    await run(call, ["plugin", "remove", PLUGIN_ID]);
  }
  if (await marketplacePresent(call)) {
    await run(call, ["plugin", "marketplace", "remove", MARKETPLACE_NAME]);
  }
  return { warning: null };
}
