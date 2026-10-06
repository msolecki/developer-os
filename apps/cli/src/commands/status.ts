import { success } from "@developer-os/core";
import type { CliResult, DeveloperOsConfigV1, InstallationManifest } from "@developer-os/core";
import type { AgentDiscovery } from "@developer-os/platform-macos";

import { failureFrom, runtimePathsFor } from "../context.js";
import type { CliContext } from "../context.js";
import { resolveVendorHomes } from "../instructions/vendor-homes.js";
import { surveyLifecycleResidue } from "../lifecycle/survey.js";
import {
  discoverAgents,
  inspectManagedDrift,
  isDirectory,
  listIncompleteTransactions,
  manifestAdmission,
  readConfigFile,
} from "./doctor.js";

export interface StatusReportV1 {
  readonly schemaVersion: 1;
  readonly productHome: string;
  readonly brainPath: string;
  readonly installed: boolean;
  readonly productVersion: string | null;
  readonly configPresent: boolean;
  readonly brainPresent: boolean;
  readonly managedArtifacts: number;
  readonly driftCount: number;
  readonly incompleteTransactions: readonly string[];
  readonly agents: readonly AgentDiscovery[];
}

/**
 * Inspection only. Every branch here reads; nothing in this module writes, and
 * an unreadable component degrades to a warning rather than a mutation or a
 * crash — `status` is the command a confused machine is asked first.
 */
export async function runStatus(
  context: CliContext,
): Promise<CliResult<StatusReportV1>> {
  try {
    const warnings: string[] = [];

    let config: DeveloperOsConfigV1 | null = null;
    try {
      config = await readConfigFile(context, context.paths.configFile);
    } catch (error) {
      warnings.push(
        context.guards.redactDiagnostic(
          error instanceof Error
            ? `configuration is unreadable: ${error.message}`
            : "configuration is unreadable",
        ),
      );
    }

    const paths = runtimePathsFor(context, config ?? undefined);

    // A V2 manifest is refused without the admission `init` wrote it under; V1 ignores it.
    let manifest: InstallationManifest | null = null;
    try {
      manifest = await context.manifests.readOptional(
        manifestAdmission(paths, resolveVendorHomes(context.env, context.userHome, paths.home)),
      );
    } catch (error) {
      warnings.push(
        context.guards.redactDiagnostic(
          error instanceof Error
            ? `installation manifest is unreadable: ${error.message}`
            : "installation manifest is unreadable",
        ),
      );
    }

    // Like config and the manifest, an unreadable artifact degrades to a warning (W2-GAP-STATE-2).
    let drift: Awaited<ReturnType<typeof inspectManagedDrift>> = [];
    try {
      if (manifest !== null) drift = await inspectManagedDrift(context, manifest, paths);
    } catch (error) {
      warnings.push(
        context.guards.redactDiagnostic(
          error instanceof Error
            ? `managed drift could not be inspected: ${error.message}`
            : "managed drift could not be inspected",
        ),
      );
    }

    let agents: readonly AgentDiscovery[] = [];
    try {
      agents = await discoverAgents(context);
    } catch (error) {
      warnings.push(
        context.guards.redactDiagnostic(
          error instanceof Error
            ? `agent discovery failed: ${error.message}`
            : "agent discovery failed",
        ),
      );
    }

    let incomplete: Awaited<ReturnType<typeof listIncompleteTransactions>> = [];
    try {
      incomplete = await listIncompleteTransactions(context);
    } catch (error) {
      warnings.push(
        context.guards.redactDiagnostic(
          error instanceof Error
            ? `transaction journals are unreadable: ${error.message}`
            : "transaction journals are unreadable",
        ),
      );
    }

    /** NEW-170: V2 coordinator state lives outside `state/transactions`, so it is surveyed separately. */
    try {
      for (const finding of (await surveyLifecycleResidue(context)).findings) {
        const redact = context.guards.redactDiagnostic;
        const recovery = finding.recovery === undefined ? "" : `; recovery: ${finding.recovery}`;
        warnings.push(`${redact(finding.message)}: ${redact(finding.path, "path")}${recovery}`);
      }
    } catch (error) {
      warnings.push(
        context.guards.redactDiagnostic(
          error instanceof Error
            ? `the lifecycle ledger could not be surveyed: ${error.message}`
            : "the lifecycle ledger could not be surveyed",
        ),
      );
    }

    return success(
      {
        schemaVersion: 1,
        productHome: paths.home,
        brainPath: paths.brain,
        installed: manifest !== null,
        productVersion: manifest?.productVersion ?? null,
        configPresent: config !== null,
        brainPresent: (await isDirectory(context, paths.brain)) === true,
        managedArtifacts: manifest?.artifacts.length ?? 0,
        driftCount: drift.length,
        incompleteTransactions: incomplete.map((entry) => entry.id),
        agents,
      },
      warnings,
    );
  } catch (error) {
    return failureFrom(context, error);
  }
}
