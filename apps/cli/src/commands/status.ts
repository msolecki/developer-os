import { success } from "@developer-os/core";
import type { CliResult, DeveloperOsConfigV1 } from "@developer-os/core";
import type { AgentDiscovery } from "@developer-os/platform-macos";

import { failureFrom, runtimePathsFor } from "../context.js";
import type { CliContext } from "../context.js";
import {
  detectManagedDrift,
  discoverAgents,
  isDirectory,
  listIncompleteTransactions,
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

    let manifest = null;
    try {
      manifest = await context.manifests.readOptional();
    } catch (error) {
      warnings.push(
        context.guards.redactDiagnostic(
          error instanceof Error
            ? `installation manifest is unreadable: ${error.message}`
            : "installation manifest is unreadable",
        ),
      );
    }

    const drift =
      manifest === null ? [] : await detectManagedDrift(context, manifest);

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

    const incomplete = await listIncompleteTransactions(context);

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
