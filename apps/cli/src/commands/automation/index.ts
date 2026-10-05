/**
 * The `automation` command's CLI entry: admits a V2 home, takes the global mutation lock for
 * every apply — so the service never acquires it a second time — and renders the result. It also
 * owns spec §5.3's hidden scheduled grammar, which `run` parses before any ordinary context exists.
 */
import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import {
  EXIT_CODES,
  SCHEDULED_JOB_IDS,
  failure,
  isOptionalScheduledJob,
  parseCanonicalAbsolutePathText,
  parseEffectiveUid,
  parseLowerHexSha256,
  parseSafeReasonCode,
  success,
} from "@developer-os/core";
import type { CanonicalAbsolutePathV1, CliResult, HeldLifecycleStableLockV1, ScheduledJobIdV1 } from "@developer-os/core";
import { launchdGuiDomain } from "@developer-os/platform-macos";

import { failureFrom, renderPath } from "../../context.js";
import type { CliContext } from "../../context.js";
import { admitInstalledV2Home, V2HomeAdmissionError } from "../../lifecycle/admission.js";
import type { CliLifecycleContext } from "../../lifecycle/context.js";
import { classifyMutationHome, gateManifestAdmission, LifecycleMutationRefusal } from "../../lifecycle/mutation-gate.js";
import { entrypointPath } from "../../update/local-release.js";
import { createProductionScheduledHandlers } from "./handlers.js";
import { AutomationRunner, createAutomationRunnerDependencies, ScheduledAuthenticationError } from "./runner.js";
import type { ScheduledRunOutcomeV1, ScheduledRunRequestV1 } from "./runner.js";
import { AutomationCommandRefusal, createAutomationService, verifiedAutomationExecutable } from "./service.js";
import type { AutomationCommandDataV1, AutomationCommandRequestV1, AutomationCommandResultV1, AutomationJobStatusV1 } from "./service.js";

export type { AutomationCommandDataV1, AutomationCommandRequestV1, AutomationCommandResultV1, AutomationService } from "./service.js";
export { createAutomationService } from "./service.js";

async function admitV2Home(context: CliContext): Promise<CliLifecycleContext> {
  const lifecycle = context.lifecycle;
  const home = await classifyMutationHome(context, lifecycle);
  if (home.kind === "v1") throw new V2HomeAdmissionError("manifest_v1_not_migratable", [context.paths.manifestFile]);
  if (home.kind !== "v2") throw new V2HomeAdmissionError("manifest_absent", [context.paths.manifestFile]);
  if (lifecycle === undefined) throw new Error("an admitted V2 home has no lifecycle context");
  return lifecycle;
}

async function withGlobalLock<T>(
  context: CliContext,
  lifecycle: CliLifecycleContext,
  work: (global: HeldLifecycleStableLockV1) => Promise<T>,
): Promise<T> {
  const held = await lifecycle.locks.acquireExisting(join(context.paths.stateDir, ".lifecycle.lock") as CanonicalAbsolutePathV1);
  try {
    return await work(held);
  } finally {
    await held.release();
  }
}

async function execute(context: CliContext, lifecycle: CliLifecycleContext, request: AutomationCommandRequestV1): Promise<AutomationCommandResultV1> {
  const service = createAutomationService(context, lifecycle);
  switch (request.subcommand) {
    case "status":
      return service.status();
    case "enable": {
      const gardenAgent = request.gardenAgent ?? null;
      const preview = await service.previewEnable(request.schedules, gardenAgent);
      if (!request.apply) return { exitCode: EXIT_CODES.success, data: { kind: "preview", command: "automation_enable", preview } };
      return withGlobalLock(context, lifecycle, (global) => service.applyEnable(preview, global, gardenAgent));
    }
    case "disable": {
      const preview = await service.previewDisable();
      if (!request.apply) return { exitCode: EXIT_CODES.success, data: { kind: "preview", command: "automation_disable", preview } };
      return withGlobalLock(context, lifecycle, (global) => service.applyDisable(preview, global));
    }
  }
}

function refusalOf(error: unknown): { readonly paths: readonly string[]; readonly recovery: string | undefined } {
  if (error instanceof AutomationCommandRefusal || error instanceof LifecycleMutationRefusal) {
    return { paths: error.paths, recovery: error.recovery };
  }
  return { paths: error instanceof V2HomeAdmissionError ? error.paths : [], recovery: undefined };
}

export async function runAutomation(context: CliContext, request: AutomationCommandRequestV1): Promise<CliResult<AutomationCommandDataV1>> {
  try {
    const result = await execute(context, await admitV2Home(context), request);
    if (result.exitCode === EXIT_CODES.success) return success(result.data);
    return failure(result.exitCode, { kind: "automation_failed", message: "the automation command did not complete", paths: [context.paths.home] });
  } catch (error) {
    const { paths, recovery } = refusalOf(error);
    return failureFrom(context, error, paths, recovery);
  }
}

/** NEW-134: a successful `brain-pulse` run's verdict is its `pulse_<verdict>` reason code, and its report is slot 0; any other record carries none. */
function verdictOf(job: AutomationJobStatusV1): string {
  if (job.job !== "brain-pulse" || job.lastRun === null || job.lastRun === "invalid" || job.lastRun.outcome !== "success") return "";
  const verdict = /^pulse_(healthy|attention|failure)$/u.exec(job.lastRun.reasonCode)?.[1];
  return verdict === undefined ? "" : ` verdict ${verdict} report state/pulse.0.md`;
}

export function renderAutomation(data: AutomationCommandDataV1): readonly string[] {
  switch (data.kind) {
    case "preview": {
      const { preview } = data;
      return [
        `Automation plan ${preview.executionOperation} (${preview.previewHash}):`,
        ...(preview.launchd?.entries ?? []).map((entry) => `  ${entry.operation.padEnd(8)} ${entry.job.padEnd(14)} ${renderPath(entry.plistPath)}`),
        ...preview.files.filter((change) => change.role !== "plist").map((change) => `  ${change.operation.padEnd(8)} ${renderPath(change.targetPath)}`),
        "Nothing was changed. Run the same command with --apply to apply this plan.",
      ];
    }
    case "applied":
      return [`Automation ${data.operation} applied (${data.transactionId}).`];
    case "status":
      return [
        `enabled        ${data.enabled ? "yes" : "no"}`,
        `activation     ${data.activation}`,
        `distribution   ${data.distribution}`,
        `lifecycle      ${data.closure}`,
        ...data.jobs.map((job) => {
          const last = job.lastRun === null ? "never" : job.lastRun === "invalid" ? "invalid" : `${job.lastRun.outcome} at ${job.lastRun.completedAt}${verdictOf(job)}`;
          // D83 (4): an optional job (or git-sync) with nothing installed is simply off, not "eligible absent"
          const state = job.installed === "absent" && (job.job === "git-sync" || isOptionalScheduledJob(job.job)) ? "off" : `${job.eligible ? "eligible" : "ineligible"} ${job.installed}`;
          return `${job.job.padEnd(14)} ${state} ${job.live ?? "-"} last run ${last}`;
        }),
      ];
  }
}

// ---------------------------------------------------------------------------------------------
// Hidden scheduled mode

export interface ScheduledInvocationV1 extends ScheduledRunRequestV1 {
  readonly productHome: CanonicalAbsolutePathV1;
}

/**
 * The exact `ProgramArguments` tail every generated plist carries —
 * `automation run <job> --scheduled --product-home <home> --generation <generation>` — at exactly
 * these positions and spellings; anything else is not a scheduled invocation.
 */
export function parseScheduledInvocation(argv: readonly string[]): ScheduledInvocationV1 | null {
  const [command, verb, job, scheduled, homeFlag, home, generationFlag, generation] = argv;
  if (
    argv.length !== 8 ||
    command !== "automation" ||
    verb !== "run" ||
    scheduled !== "--scheduled" ||
    homeFlag !== "--product-home" ||
    generationFlag !== "--generation"
  ) {
    return null;
  }
  const found = SCHEDULED_JOB_IDS.find((candidate) => candidate === job);
  if (found === undefined) return null;
  try {
    return {
      job: found,
      productHome: parseCanonicalAbsolutePathText(home),
      generation: parseLowerHexSha256(generation),
    };
  } catch {
    return null;
  }
}

/** The supplied product home, resolved without following its own leaf: an owned real directory under canonical parents. */
export async function admitScheduledProductHome(path: CanonicalAbsolutePathV1, effectiveUid: number): Promise<boolean> {
  const leaf = await lstat(path, { bigint: true }).catch(() => null);
  if (leaf === null || leaf.isSymbolicLink() || !leaf.isDirectory() || Number(leaf.uid) !== effectiveUid) return false;
  const parent = await realpath(dirname(path)).catch(() => null);
  return parent !== null && join(parent, basename(path)) === path;
}

/**
 * Stage 1 also proves the executable every plist names is the installed entrypoint, by its
 * manifest row and bytes — the installation's own record, never the invocation's argv.
 */
function scheduledRunner(context: CliContext, lifecycle: CliLifecycleContext): AutomationRunner {
  const productHome = parseCanonicalAbsolutePathText(context.paths.home);
  const dependencies = createAutomationRunnerDependencies(context, lifecycle, {
    userHome: parseCanonicalAbsolutePathText(context.userHome),
    domain: launchdGuiDomain(parseEffectiveUid(lifecycle.effectiveUid, lifecycle.effectiveUid)),
    executablePath: parseCanonicalAbsolutePathText(entrypointPath(productHome)),
  });
  return new AutomationRunner({
    ...dependencies,
    authenticate: async (request) => {
      const { manifest } = await admitInstalledV2Home({
        fs: lifecycle.fs,
        paths: context.paths,
        manifestAdmission: gateManifestAdmission(context),
        effectiveUid: lifecycle.effectiveUid,
      });
      try {
        await verifiedAutomationExecutable(lifecycle, productHome, manifest);
      } catch (error) {
        if (!(error instanceof AutomationCommandRefusal)) throw error;
        throw new ScheduledAuthenticationError("scheduled_executable_unverified");
      }
      await dependencies.authenticate(request);
    },
    handlers: createProductionScheduledHandlers(context, lifecycle),
  });
}

export async function runScheduledAutomation(context: CliContext, invocation: ScheduledInvocationV1): Promise<ScheduledRunOutcomeV1> {
  const lifecycle = context.lifecycle;
  if (lifecycle === undefined || context.paths.home !== invocation.productHome) {
    return { kind: "refused", code: EXIT_CODES.securityRefusal, reason: parseSafeReasonCode("scheduled_product_home_unadmitted") };
  }
  const job: ScheduledJobIdV1 = invocation.job;
  return scheduledRunner(context, lifecycle).run({ job, generation: invocation.generation });
}

export function scheduledExitCode(outcome: ScheduledRunOutcomeV1): number {
  return outcome.kind === "refused" ? outcome.code : EXIT_CODES.success;
}
