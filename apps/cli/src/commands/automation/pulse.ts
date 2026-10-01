/**
 * Spec §3.2's `brain-pulse`: no agent. It gathers read-only inputs, computes the verdict, rotates
 * eight report slots in one transaction under the global lock the runner already holds (the
 * gate borrows it, as `runScheduledBrain` does), and raises one notification on attention or
 * failure. A notification failure never changes the outcome.
 */
import { join } from "node:path";

import { BrainService, artifactPaths, resolveBrainConfig } from "@developer-os/brain";
import { parseCanonicalAbsolutePathText, parseSafeReasonCode } from "@developer-os/core";
import type { CanonicalAbsolutePathV1, HeldLifecycleStableLockV1, PlannedFileMutation } from "@developer-os/core";

import { runtimePathsFor } from "../../context.js";
import type { CliContext } from "../../context.js";
import { LifecycleMutationRefusal, withLifecycleMutation } from "../../lifecycle/mutation-gate.js";
import {
  MAX_AUTOMATION_LOG_BYTES,
  PULSE_REPORT_SLOTS,
  automationLogSlotPath,
  currentBytes,
  parseAutomationLogRecord,
  pulseReportSlotPath,
  writeMutation,
} from "../../lifecycle/runtime-records.js";
import type { ScheduledHandlerResultV1 } from "../../lifecycle/runtime-records.js";
import { readConfig } from "../brain.js";
import { dependenciesFor } from "../brain-dependencies.js";
import { runScheduledDoctorReport } from "../doctor.js";
import { listCaptureSummaries } from "../review.js";
import { computePulse, parsePulseHeader, renderPulseReport } from "./pulse-verdict.js";
import type { PulseInputV1, PulseVerdictV1 } from "./pulse-verdict.js";

const MAX_REPORT_BYTES = 65_536;
const UTF8 = new TextEncoder();

async function gardenLast(context: CliContext, productHome: CanonicalAbsolutePathV1): Promise<PulseInputV1["gardenLast"]> {
  const lifecycle = context.lifecycle;
  if (lifecycle === undefined) return [];
  const last: PulseInputV1["gardenLast"][number][] = [];
  for (const slot of [0, 1]) {
    let bytes: Uint8Array | null;
    try {
      bytes = await currentBytes(lifecycle.fs, automationLogSlotPath(productHome, "brain-garden", slot), lifecycle.effectiveUid, MAX_AUTOMATION_LOG_BYTES);
    } catch {
      bytes = null;
    }
    if (bytes === null || bytes.byteLength === 0) break;
    try {
      const { outcome, reasonCode } = parseAutomationLogRecord(bytes);
      last.push(
        outcome === "success" && reasonCode === "ok" ? "success"
        : outcome === "success" && reasonCode === "skipped_review_queue_full" ? "skipped_review_queue_full"
        : outcome === "handler_failed" ? "failed"
        : "other",
      );
    } catch {
      last.push("other");
    }
  }
  return last;
}

async function indexFacts(
  context: CliContext,
  vaultRoot: string,
  config: Parameters<typeof resolveBrainConfig>[0],
): Promise<{ notes: number; edges: number; generatedAt: string | null }> {
  const artifacts = artifactPaths(resolveBrainConfig(config));
  // Absent and unreadable differ: `readText` wraps its errors, so a plain `lstat` tells them apart.
  type Read = { readonly kind: "absent" | "unreadable" } | { readonly kind: "ok"; readonly doc: Record<string, unknown> };
  const read = async (relative: string): Promise<Read> => {
    const path = join(vaultRoot, relative);
    try {
      await context.fs.lstat(path);
    } catch (error) {
      return { kind: (error as { code?: unknown }).code === "ENOENT" ? "absent" : "unreadable" };
    }
    try {
      const value: unknown = JSON.parse(await context.guards.readText(path));
      return typeof value === "object" && value !== null ? { kind: "ok", doc: value as Record<string, unknown> } : { kind: "unreadable" };
    } catch {
      return { kind: "unreadable" };
    }
  };
  const index = await read(artifacts.index);
  const graph = await read(artifacts.graph);
  const count = (doc: Read, key: string): number => (doc.kind === "ok" && Array.isArray(doc.doc[key]) ? doc.doc[key].length : 0);
  const generated = index.kind === "ok" ? index.doc.generatedAt : undefined;
  return {
    notes: count(index, "notes"),
    edges: count(graph, "edges"),
    // an unparseable value reports `index_unreadable`; only an absent file reports `index_missing`
    generatedAt: typeof generated === "string" ? generated : index.kind === "absent" ? null : "unreadable",
  };
}

function notificationRequest(text: string, cwd: string) {
  const escaped = text.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return {
    executable: "/usr/bin/osascript",
    args: ["-e", `display notification "${escaped}" with title "Developer OS"`],
    cwd,
    stdin: "",
    timeoutMs: 10_000,
    env: {},
  } as const;
}

export async function runScheduledPulse(context: CliContext, held: HeldLifecycleStableLockV1): Promise<ScheduledHandlerResultV1> {
  const lifecycle = context.lifecycle;
  if (lifecycle === undefined) {
    return { outcome: "handler_refused", reasonCode: parseSafeReasonCode("lifecycle_context_unavailable"), data: null };
  }
  const config = await readConfig(context);
  const paths = runtimePathsFor(context, config);
  const productHome = parseCanonicalAbsolutePathText(paths.home);

  const doctor = await runScheduledDoctorReport(context);
  let lint: Awaited<ReturnType<BrainService["lint"]>> | null = null;
  try {
    lint = await new BrainService(dependenciesFor(context, paths.brain, config)).lint();
  } catch {
    lint = null; // a vault that cannot be linted is reported as one lint error, never as a crash
  }
  const findings = lint?.findings ?? [];
  const facts = await indexFacts(context, paths.brain, config);
  const input: PulseInputV1 = {
    now: context.now(),
    doctorFailing: doctor.checks.filter((check) => check.status === "fail").length,
    // Ruling 33: with no index yet, "never been built" drift is the missing index (reported as such), not a lint failure.
    lintErrors:
      lint === null
        ? 1
        : findings.filter((f) => f.severity === "error" && !(facts.generatedAt === null && f.class === "index-drift")).length,
    quarantined: await listCaptureSummaries(context, "quarantined"),
    accepted: await listCaptureSummaries(context, "accepted"),
    notes: facts.notes,
    edges: facts.edges,
    isolated: findings.filter((finding) => finding.class === "isolated").length,
    gaps: findings.filter((finding) => finding.class === "gap").length,
    indexGeneratedAt: facts.generatedAt,
    gardenLast: await gardenLast(context, productHome),
  };

  const slots: { path: string; bytes: Uint8Array | null }[] = [];
  for (let slot = 0; slot < PULSE_REPORT_SLOTS; slot += 1) {
    const path = pulseReportSlotPath(paths, slot);
    slots.push({ path, bytes: await currentBytes(lifecycle.fs, parseCanonicalAbsolutePathText(path), lifecycle.effectiveUid, MAX_REPORT_BYTES) });
  }
  const previous = parsePulseHeader(new TextDecoder().decode(slots[0]?.bytes ?? new Uint8Array()));
  const { header, reasons } = computePulse(input, previous);

  // Slot n+1 takes slot n's bytes for n = 6..0, slot 0 takes the report: one transaction, each write preconditioned on what was read.
  const mutations: PlannedFileMutation[] = [];
  for (let n = PULSE_REPORT_SLOTS - 2; n >= 0; n -= 1) {
    const source = slots[n]?.bytes ?? null;
    const target = slots[n + 1] as (typeof slots)[number];
    const content = source ?? new Uint8Array();
    if (source === null && target.bytes === null) continue;
    if (target.bytes !== null && Buffer.from(target.bytes).equals(content)) continue;
    mutations.push(writeMutation(target.path, target.bytes, content));
  }
  const first = slots[0] as (typeof slots)[number];
  mutations.push(writeMutation(first.path, first.bytes, UTF8.encode(renderPulseReport(header, reasons, input))));
  try {
    await withLifecycleMutation(
      context,
      lifecycle,
      () => context.executor.execute({ kind: "brain-pulse", mutations }),
      undefined,
      { global: held },
    );
  } catch (error) {
    if (error instanceof LifecycleMutationRefusal) {
      return { outcome: "handler_refused", reasonCode: parseSafeReasonCode("handler_refused"), data: { code: error.code, paths: error.paths } };
    }
    // e.g. a slot edited between the read and the write: the precondition fails and nothing is written.
    return {
      outcome: "handler_failed",
      reasonCode: parseSafeReasonCode("pulse_rotation_failed"),
      data: { message: error instanceof Error ? error.message : "the rotation failed" },
    };
  }

  let notified: boolean | null = null;
  const verdict: PulseVerdictV1 = header.verdict;
  if (verdict !== "healthy") {
    try {
      const result = await context.runner.run(notificationRequest(`${verdict} — ${first.path}`, paths.home));
      notified = result.exitCode === 0 && !result.timedOut;
    } catch {
      notified = false;
    }
  }
  return {
    outcome: "success",
    reasonCode: parseSafeReasonCode(`pulse_${verdict}`),
    data: { verdict, report: "state/pulse.0.md", notified },
  };
}
