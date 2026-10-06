/**
 * NEW-134 spec §3.3: the scheduled `brain-garden` handler. One isolated call to the pinned
 * vendor executable, whose reply is data: every proposal passes `validateGardenResponse` before
 * the ordinary `capture` path quarantines it for a person to review. Nothing here writes the vault.
 */
import { createHash } from "node:crypto";
import { basename, join } from "node:path";

import { parseSafeReasonCode } from "@developer-os/core";
import type { DeveloperOsConfigV1, HeldLifecycleStableLockV1 } from "@developer-os/core";
import {
  artifactPaths,
  BrainService,
  buildGardenPrompt,
  duplicateTitleKey,
  GARDEN_MAX_PROPOSALS,
  isUnsafeProposedNotePath,
  parseGardenResponse,
  redactAndNormalize,
  resolveBrainConfig,
  selectGardenTargets,
  validateGardenResponse,
} from "@developer-os/brain";
import type { IndexedNote, LintFinding } from "@developer-os/brain";
import { createRedactor } from "@developer-os/security";

import { isMissingEntry, readConfigFile } from "../../config-file.js";
import { loadOrCreateRedactionKey, runtimePathsFor } from "../../context.js";
import type { CliContext } from "../../context.js";
import { LifecycleMutationRefusal, withLifecycleMutation } from "../../lifecycle/mutation-gate.js";
import type { ScheduledHandlerResultV1 } from "../../lifecycle/runtime-records.js";
import { isTopicNotePath, runCapture } from "../capture.js";
import { hasFailingCheck, runScheduledDoctorReport } from "../doctor.js";
import { invokeAgentOnce } from "../ingest.js";
import { dependenciesFor } from "../reindex.js";
import { listCaptureSummaries } from "../review.js";

export interface GardenRunDataV1 {
  readonly targets: { readonly gaps: number; readonly isolated: number };
  readonly accepted: readonly { readonly target: string; readonly captureId: string }[];
  readonly rejected: readonly { readonly target: string; readonly code: string }[];
  /** The gate that skipped the run, e.g. `review_queue_full`; `null` when it ran. */
  readonly skipped: string | null;
  /**
   * Spec §3.4: one `--dry-run` command per lint `duplicates` group, for the person to run; the
   * gardener never proposes a structural change itself.
   */
  readonly structural: readonly string[];
  /** The adapter's failure token on `agent_error` (never its detail); absent otherwise. */
  readonly agentReason?: string;
}

export const GARDEN_REVIEW_QUEUE_LIMIT = 20;
export const GARDEN_AGENT_TIMEOUT_MS = 120_000;

const EMPTY: GardenRunDataV1 = { targets: { gaps: 0, isolated: 0 }, accepted: [], rejected: [], skipped: null, structural: [] };

function result(
  outcome: ScheduledHandlerResultV1["outcome"],
  reasonCode: string,
  data: GardenRunDataV1 | { readonly message: string },
): ScheduledHandlerResultV1 {
  return { outcome, reasonCode: parseSafeReasonCode(reasonCode), data };
}

function skipped(reason: string, base: GardenRunDataV1 = EMPTY): ScheduledHandlerResultV1 {
  return result("success", `skipped_${reason}`, { ...base, skipped: reason });
}

/**
 * The manual `brain-garden` workflow's wording: notes a `duplicates` finding groups (same
 * folder and title, or same content) fold into the first by `brain refactor --merge`; a note
 * left alone in its group gets `brain retire`. Paths are content-relative and single-quoted; a
 * path holding a single quote is skipped, as the workflow says.
 */
function structuralCommands(findings: readonly LintFinding[], notes: readonly IndexedNote[], contentRoot: string): readonly string[] {
  const byPath = new Map(notes.map((note) => [note.path, note]));
  const groups = new Map<string, string[]>();
  for (const finding of findings) {
    const note = byPath.get(finding.path);
    if (finding.class !== "duplicates" || note === undefined) continue;
    const key = finding.key === "title" ? `title\0${duplicateTitleKey(note)}` : `content\0${note.contentHash}`;
    const path = note.path.slice(contentRoot.length + 1);
    if (path.includes("'")) continue;
    groups.set(key, [...(groups.get(key) ?? []), path]);
  }
  return [...groups.values()].flatMap((paths) => {
    const [target, ...sources] = [...new Set(paths)].sort();
    if (target === undefined) return [];
    return sources.length === 0
      ? [`developer-os brain retire '${target}' --dry-run`]
      : sources.map((source) => `developer-os brain refactor --merge '${source}' '${target}' --dry-run`);
  });
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
 * searched for on `PATH` (spec §3.1). Ruling 38: Claude only, whose basename must be `claude`;
 * a Codex pin is refused before anything is spawned, because Codex has no tool-free mode yet.
 */
async function admitPinned(
  context: CliContext,
  config: DeveloperOsConfigV1,
): Promise<{ readonly name: "claude"; readonly executable: string } | ScheduledHandlerResultV1> {
  const pinned = config.automation.brainGarden;
  if (pinned?.agent === "codex") {
    return result("handler_refused", "garden_agent_unsupported", {
      message: "the scheduled gardener runs Claude with no tools; Codex has no tool-free mode yet. Re-pin with developer-os automation enable --garden-agent claude",
    });
  }
  if (pinned === undefined || !(await exists(context, pinned.executable))) {
    return result("handler_refused", "garden_executable_missing", {
      message: "no pinned gardener executable; run developer-os automation enable --schedule brain-garden=<schedule>",
    });
  }
  try {
    if (basename(pinned.executable) !== "claude") throw new Error("not claude");
    await context.platform.assertTrustedExecutable(pinned.executable);
  } catch {
    return result("handler_refused", "garden_executable_untrusted", {
      message: "the pinned gardener executable is no longer trusted; re-pin it with developer-os automation enable",
    });
  }
  return { name: "claude", executable: pinned.executable };
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
  const { notes } = (await service.reindex()).build.index;
  const base: GardenRunDataV1 = { ...EMPTY, structural: structuralCommands(lint.findings, notes, brainConfig.contentRoot) };
  const pending = await listCaptureSummaries(context, "quarantined");
  if (pending.length >= GARDEN_REVIEW_QUEUE_LIMIT) return skipped("review_queue_full", base);

  const pendingNotePaths = new Set(pending.flatMap((capture) => (capture.notePath === null ? [] : [capture.notePath])));
  const selected = selectGardenTargets({
    notes,
    findings: lint.findings,
    pendingNotePaths,
    pendingHubTags: new Set(pending.flatMap((capture) => capture.hubTags)),
  });
  if (selected.gaps.length === 0 && selected.isolated.length === 0) return skipped("nothing_to_do", base);

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

  /** Re-admitted at the last moment: the prompt build can take long enough for a swap. */
  try {
    await context.platform.assertTrustedExecutable(vendor.executable);
  } catch {
    return result("handler_refused", "garden_executable_untrusted", {
      message: "the pinned gardener executable is no longer trusted; re-pin it with developer-os automation enable",
    });
  }
  const reply = await invokeAgentOnce(context, vendor, prompt, "garden.proposals", GARDEN_AGENT_TIMEOUT_MS);
  if (!reply.ok && reply.reason === "timeout") return result("handler_failed", "agent_timeout", { ...base, targets: counts });
  if (!reply.ok) {
    /** An unparseable reply is output the product cannot read, not a vendor complaint (spec §4). */
    const invalid = reply.failure.reason === "malformed-output";
    return result("handler_failed", invalid ? "agent_output_invalid" : "agent_error", {
      ...base,
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
    redactionFindings,
  });
  if ("invalid" in validated) return result("handler_failed", "agent_output_invalid", { ...base, targets: counts });

  const rejected: { target: string; code: string }[] = validated.rejected.map(({ target, code }) => ({ target, code }));
  const accepted: { target: string; captureId: string }[] = [];
  /**
   * One capture at a time, each atomic: a crash leaves whole captures and this list names them.
   * Ruling 36: each is bound to the bytes the validator checked (a hub to "absent"), so a note
   * edited during the agent call refuses `target_changed` instead of reverting the edit.
   */
  for (const proposal of validated.accepted) {
    const checked = files.get(proposal.target) ?? null;
    const captured = await runCapture(context, {
      text: proposal.note,
      note: proposal.target,
      expectedBeforeSha256: proposal.kind === "hub" || checked === null ? null : createHash("sha256").update(checked, "utf8").digest("hex"),
      source: { sourceAgent: vendor.name, sourceAgentVersion: "unknown" },
    });
    if (!captured.ok) {
      rejected.push({ target: proposal.target, code: captured.error.kind === "capture_target_changed" ? "target_changed" : "capture_refused" });
    } else if (captured.data.duplicate) {
      rejected.push({ target: proposal.target, code: "duplicate_capture" });
    } else {
      accepted.push({ target: proposal.target, captureId: captured.data.captureId });
    }
  }
  return result("success", "ok", { ...base, targets: counts, accepted, rejected });
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
