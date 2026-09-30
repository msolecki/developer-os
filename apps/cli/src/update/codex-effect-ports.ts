import { Buffer } from "node:buffer";

import { parseSafeReasonCode, type CodexRegistrationProjectionV1, type OwnerExternalEffectProcessPolicyV1, type SafeReasonCodeV1 } from "@developer-os/core";
import { parseStructuredPayload, type SupervisedProcessRunner } from "@developer-os/security";

import type { OwnerEffectProcessRequestV1, OwnerEffectProcessResultV1, OwnerEffectTokenValuesV1 } from "./external-effect.js";
import { refuseParticipant } from "./state-participant.js";

const TERMINATION_GRACE_MILLISECONDS = 1_000;
const PLUGIN_LIST_ARGV = ["plugin", "list", "--json"] as const;

/**
 * The production `run`: one supervised child with exactly the resolved request's argv, two
 * environment entries, closed stdin, no inherited descriptor, and its byte/idle/wall bounds. Any
 * termination other than a clean exit reports `exitCode: null`, which the participant refuses.
 *
 * ponytail: the group is killed and reaped but a descendant is not sampled; `processCount: 1` is
 * enforced for the verifier only. Add `sampleNodePlannerProcess` here if a vendor CLI must not fork.
 */
export function supervisedOwnerEffectRun(runner: SupervisedProcessRunner): (request: OwnerEffectProcessRequestV1) => Promise<OwnerEffectProcessResultV1> {
  return async (request) => {
    const output = { stdout: [] as Uint8Array[], stderr: [] as Uint8Array[] };
    const evidence = await runner.run(
      {
        executable: request.executable,
        argv: request.argv,
        env: request.env,
        cwd: request.cwd,
        stdin: "ignore",
        inheritedFds: [],
        stdoutCap: request.stdoutCap,
        stderrCap: request.stderrCap,
        idleMs: request.idleMs,
        wallMs: request.wallMs,
        terminationGraceMs: TERMINATION_GRACE_MILLISECONDS,
        phase: runner.beginPhase("owner_external_effect", request.wallMs),
      },
      (chunk, stream) => {
        output[stream].push(chunk);
      },
    );
    const clean = evidence.termination === "exited" && evidence.signal === null;
    return { exitCode: clean ? evidence.exitCode : null, stdout: Buffer.concat(output.stdout), stderr: Buffer.concat(output.stderr) };
  };
}

export interface CodexRegistrationObserverDependenciesV1 {
  readonly policy: OwnerExternalEffectProcessPolicyV1;
  readonly tokens: OwnerEffectTokenValuesV1;
  readonly resolveExecutable: (identity: OwnerExternalEffectProcessPolicyV1["executableIdentity"]) => Promise<string>;
  readonly run: (request: OwnerEffectProcessRequestV1) => Promise<OwnerEffectProcessResultV1>;
  /** The Security redactor's finding check; any finding refuses before a byte is parsed. */
  readonly screen: (text: string) => boolean;
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : null;
}

/** A vendor version such as `1.2.0` as the safe token `v1_2_0`; anything else is `null`. */
export function codexVersionToken(value: unknown): SafeReasonCodeV1 | null {
  if (typeof value !== "string" || !/^[0-9A-Za-z.+-]{1,62}$/u.test(value)) return null;
  return parseSafeReasonCode(`v${value.toLowerCase().replace(/[^a-z0-9]/gu, "_")}`);
}

/**
 * Spec 2 §9.2's closed tokenized projection of `codex plugin list --json`. `source` is exact
 * string equality with the admitted managed plugin root; the vendor path itself never leaves here.
 * An unreadable listing is refused, never read as `absent`.
 */
export function projectCodexRegistration(stdout: string, policy: OwnerExternalEffectProcessPolicyV1, tokens: OwnerEffectTokenValuesV1): CodexRegistrationProjectionV1 {
  const parsed = parseStructuredPayload(stdout);
  const listing = parsed.ok ? record(parsed.payload) : null;
  const installed = listing?.installed;
  if (!Array.isArray(installed)) return refuseParticipant("update_effect_observation");
  const pluginName = tokens.pluginId.split("@")[0];
  const entries = installed.map(record).filter((entry) => entry !== null && (entry.pluginId === tokens.pluginId || entry.name === pluginName));
  if (entries.length > 1) return refuseParticipant("update_effect_observation");
  const entry = entries[0] ?? null;
  const pluginId = parseSafeReasonCode(pluginName?.replace(/[^a-z0-9]/gu, "_"));
  if (entry === null) return { pluginId, enabled: false, protocol: policy.providerProtocol, version: null, source: "absent" };
  const sourcePath = record(entry.source)?.path;
  return {
    pluginId,
    enabled: entry.enabled === true,
    protocol: policy.providerProtocol,
    version: codexVersionToken(entry.version),
    source: sourcePath === tokens.managedPluginRoot ? "managed_plugin_root" : "other",
  };
}

/**
 * The production `observe`: the same pinned executable, environment, cwd, and bounds as the plan's
 * refresh, listing instead of mutating. The output is secret-screened before it is parsed.
 */
export function codexRegistrationObserver(dependencies: CodexRegistrationObserverDependenciesV1): () => Promise<CodexRegistrationProjectionV1> {
  const { policy, tokens } = dependencies;
  return async () => {
    const executable = await dependencies.resolveExecutable(policy.executableIdentity);
    const result = await dependencies.run({
      executable,
      argv: PLUGIN_LIST_ARGV,
      env: { CODEX_HOME: tokens.managedVendorHome, TMPDIR: tokens.privateEffectTmp },
      cwd: tokens.managedPluginRoot,
      stdin: "ignore",
      stdoutCap: policy.stdoutBytes,
      stderrCap: policy.stderrBytes,
      idleMs: policy.idleMilliseconds,
      wallMs: policy.wallMilliseconds,
    });
    if (result.exitCode !== 0) return refuseParticipant("update_effect_observation");
    const text = new TextDecoder("utf-8", { fatal: false }).decode(result.stdout);
    if (dependencies.screen(text)) return refuseParticipant("update_effect_observation_secret");
    return projectCodexRegistration(text, policy, tokens);
  };
}
