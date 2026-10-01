/**
 * NEW-134 spec §3.3: the scheduled `brain-garden` handler. One isolated call to the pinned
 * vendor executable, whose reply is data: every proposal passes `validateGardenResponse` before
 * the ordinary `capture` path quarantines it for a person to review. Nothing here writes the vault.
 */
import { join } from "node:path";

import { parseSafeReasonCode } from "@developer-os/core";
import type { DeveloperOsConfigV1, HeldLifecycleStableLockV1 } from "@developer-os/core";
import {
  artifactPaths,
  BrainService,
  buildGardenPrompt,
  GARDEN_MAX_PROPOSALS,
  isUnsafeProposedNotePath,
  parseGardenResponse,
  redactAndNormalize,
  resolveBrainConfig,
  selectGardenTargets,
  validateGardenResponse,
} from "@developer-os/brain";
import { createRedactor } from "@developer-os/security";

import { readConfigFile } from "../../config-file.js";
import { loadOrCreateRedactionKey, runtimePathsFor } from "../../context.js";
import type { CliContext } from "../../context.js";
import { LifecycleMutationRefusal, withLifecycleMutation } from "../../lifecycle/mutation-gate.js";
import type { ScheduledHandlerResultV1 } from "../../lifecycle/runtime-records.js";
import { isTopicNotePath, runCapture } from "../capture.js";
import { hasFailingCheck, runScheduledDoctorReport } from "../doctor.js";
import { invokeAgentOnce } from "../ingest.js";
import { outputSchemaPath } from "../output-schemas.js";
import { dependenciesFor } from "../reindex.js";
import { listCaptureSummaries } from "../review.js";

export interface GardenRunDataV1 {
  readonly targets: { readonly gaps: number; readonly isolated: number };
  readonly accepted: readonly { readonly target: string; readonly captureId: string }[];
  readonly rejected: readonly { readonly target: string; readonly code: string }[];
  /** The gate that skipped the run, e.g. `review_queue_full`; `null` when it ran. */
  readonly skipped: string | null;
  /** The adapter's failure token on `agent_error` (never its detail); absent otherwise. */
  readonly agentReason?: string;
}

export const GARDEN_REVIEW_QUEUE_LIMIT = 20;
export const GARDEN_AGENT_TIMEOUT_MS = 120_000;

const EMPTY: GardenRunDataV1 = { targets: { gaps: 0, isolated: 0 }, accepted: [], rejected: [], skipped: null };

function result(
  outcome: ScheduledHandlerResultV1["outcome"],
  reasonCode: string,
  data: GardenRunDataV1 | { readonly message: string },
): ScheduledHandlerResultV1 {
  return { outcome, reasonCode: parseSafeReasonCode(reasonCode), data };
}

function skipped(reason: string): ScheduledHandlerResultV1 {
  return result("success", `skipped_${reason}`, { ...EMPTY, skipped: reason });
}

function isMissingEntry(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

async function exists(context: CliContext, path: string): Promise<boolean> {
  try {
    await context.fs.lstat(path);
    return true;
  } catch (error) {
    if (isMissingEntry(error)) return false;
    throw error;
  }
}

/**
 * The pinned executable, re-admitted exactly as `ingest` admits a discovered one — and never
 * searched for on `PATH` (spec §3.1). A Codex pin also needs the output schema `init` installs,
 * which a home installed before NEW-134 lacks.
 */
async function admitPinned(
  context: CliContext,
  config: DeveloperOsConfigV1,
): Promise<{ readonly name: "claude" | "codex"; readonly executable: string } | ScheduledHandlerResultV1> {
  const pinned = config.automation.brainGarden;
  if (pinned === undefined || !(await exists(context, pinned.executable))) {
    return result("handler_refused", "garden_executable_missing", {
      message: "no pinned gardener executable; run developer-os automation enable --schedule brain-garden=<schedule>",
    });
  }
  try {
    await context.platform.assertTrustedExecutable(pinned.executable);
  } catch {
    return result("handler_refused", "garden_executable_untrusted", {
      message: "the pinned gardener executable is no longer trusted; re-pin it with developer-os automation enable",
    });
  }
  if (pinned.agent === "codex" && !(await exists(context, outputSchemaPath(runtimePathsFor(context, config).home, "garden.proposals")))) {
    return result("handler_refused", "garden_schema_missing", {
      message: "the garden.proposals output schema is not installed; run developer-os init",
    });
  }
  return { name: pinned.agent, executable: pinned.executable };
}

async function garden(context: CliContext): Promise<ScheduledHandlerResultV1> {
  const config = await readConfigFile(context, context.paths.configFile);
  if (config === null) return result("handler_refused", "not_initialized", { message: "Developer OS is not initialized" });
  /**
   * Before the gates, deliberately: a pin that cannot run is a fact about the configuration,
   * reported as a refusal on every run rather than hidden behind whichever gate skips first.
   * It spawns nothing either way.
   */
  const vendor = await admitPinned(context, config);
  if ("outcome" in vendor) return vendor;

  const paths = runtimePathsFor(context, config);
  const brainConfig = resolveBrainConfig(config);
  if (!(await exists(context, join(paths.brain, artifactPaths(brainConfig).index)))) return skipped("index_missing");
  if (hasFailingCheck(await runScheduledDoctorReport(context))) return skipped("doctor_failed");
  const service = new BrainService(dependenciesFor(context, paths.brain, config));
  const lint = await service.lint();
  if (lint.errorCount > 0) return skipped("lint_errors");
  const pending = await listCaptureSummaries(context, "quarantined");
  if (pending.length >= GARDEN_REVIEW_QUEUE_LIMIT) return skipped("review_queue_full");

  const { notes } = (await service.reindex()).build.index;
  const pendingNotePaths = new Set(pending.flatMap((capture) => (capture.notePath === null ? [] : [capture.notePath])));
  const selected = selectGardenTargets({
    notes,
    findings: lint.findings,
    pendingNotePaths,
    pendingHubTags: new Set(pending.flatMap((capture) => capture.hubTags)),
  });
  if (selected.gaps.length === 0 && selected.isolated.length === 0) return skipped("nothing_to_do");

  /** A path with no entry reads `null`; one the guard refuses reads as occupied, never as free. */
  const readNote = async (path: string): Promise<string | null> => {
    const absolute = join(paths.brain, brainConfig.contentRoot, path);
    if (!(await exists(context, absolute))) return null;
    try {
      return await context.guards.readText(absolute);
    } catch {
      return "";
    }
  };
  const texts = new Map<string, string | null>();
  for (const path of [...selected.gaps.flatMap((gap) => gap.notePaths), ...selected.isolated]) texts.set(path, await readNote(path));
  const { prompt, targets } = buildGardenPrompt({ targets: selected, notes, readNote: (path) => texts.get(path) ?? "" });
  const counts = { gaps: targets.gaps.length, isolated: targets.isolated.length };

  const reply = await invokeAgentOnce(context, vendor, prompt, "garden.proposals", GARDEN_AGENT_TIMEOUT_MS);
  if (!reply.ok && reply.reason === "timeout") return result("handler_failed", "agent_timeout", { ...EMPTY, targets: counts });
  if (!reply.ok) {
    /** An unparseable reply is output the product cannot read, not a vendor complaint (spec §4). */
    const invalid = reply.failure.reason === "malformed-output";
    return result("handler_failed", invalid ? "agent_output_invalid" : "agent_error", {
      ...EMPTY,
      targets: counts,
      ...(invalid ? {} : { agentReason: reply.failure.reason }),
    });
  }

  /**
   * The capture path's own redactor — same key, same user patterns, default scope — and its
   * own normalization, so a proposal accepted here is quarantined byte for byte. `runCapture`
   * redacts nothing but the text; any change it would make counts as a finding.
   */
  const redact = createRedactor(loadOrCreateRedactionKey(paths.stateDir), { userPatterns: config.redaction?.patterns ?? [] });
  const redactionFindings = (text: string): number => {
    const { content, redaction } = redactAndNormalize(text, redact);
    return redaction.length + (content === text.replace(/\n$/u, "") ? 0 : 1);
  };
  /**
   * `validateGardenResponse` reads synchronously, so every file it may ask for is read here
   * first: the prompt's notes, and each of the first eight proposal targets that is a safe
   * topic path. Anything else reads as occupied, never as free — the validator rejects unsafe
   * and private targets before it would read them.
   */
  const files = new Map(texts);
  for (const proposal of parseGardenResponse(reply.payload)?.proposals.slice(0, GARDEN_MAX_PROPOSALS) ?? []) {
    const { target } = proposal;
    if (!files.has(target) && !isUnsafeProposedNotePath(target) && isTopicNotePath(target, brainConfig)) {
      files.set(target, await readNote(target));
    }
  }
  const validated = validateGardenResponse({
    response: reply.payload,
    targets,
    notes,
    config: brainConfig,
    readNote: (path) => (files.has(path) ? (files.get(path) ?? null) : ""),
    pendingNotePaths,
    findings: lint.findings,
    redactionFindings,
  });
  if ("invalid" in validated) return result("handler_failed", "agent_output_invalid", { ...EMPTY, targets: counts });

  const rejected: { target: string; code: string }[] = validated.rejected.map(({ target, code }) => ({ target, code }));
  const accepted: { target: string; captureId: string }[] = [];
  /** One capture at a time, each atomic: a crash leaves whole captures and this list names them. */
  for (const proposal of validated.accepted) {
    const captured = await runCapture(context, { text: proposal.note, note: proposal.target });
    if (captured.ok) accepted.push({ target: proposal.target, captureId: captured.data.captureId });
    else rejected.push({ target: proposal.target, code: "capture_refused" });
  }
  return result("success", "ok", { targets: counts, accepted, rejected, skipped: null });
}

/**
 * Under the global lock the scheduled runner already holds: the gate borrows it, so every
 * capture transaction reuses that descriptor and the lifecycle lock is never taken again.
 */
export async function runScheduledGarden(context: CliContext, held: HeldLifecycleStableLockV1): Promise<ScheduledHandlerResultV1> {
  const lifecycle = context.lifecycle;
  if (lifecycle === undefined) return result("handler_refused", "lifecycle_context_unavailable", { message: "no lifecycle context" });
  try {
    return await withLifecycleMutation(context, lifecycle, () => garden(context), undefined, { global: held });
  } catch (error) {
    if (!(error instanceof LifecycleMutationRefusal)) throw error;
    return result("handler_refused", error.reason, { message: error.message });
  }
}
