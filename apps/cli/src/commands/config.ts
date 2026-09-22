/**
 * Spec 1 §2.2 and §3's `config` rows: the first product verb that mutates a V2 home through
 * the lifecycle mutation gate. `get` takes no lock and publishes the projection Task 5
 * derives; `set` runs its one Foundation transaction inside `withLifecycleMutation`, guarded
 * by the hash of the very bytes it read.
 */
import { join } from "node:path";

import {
  encodeCanonicalJson,
  hashBytes,
  loadConfig,
  parseConfigReadableKey,
  readConfigValue,
  serializeConfig,
  setConfigValue,
  success,
} from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  CanonicalJsonValue,
  CliResult,
  ConfigGetResultV1,
  ConfigSetResultV1,
  DeveloperOsConfigV1,
} from "@developer-os/core";

import { failureFrom } from "../context.js";
import type { CliContext } from "../context.js";
import { V2HomeAdmissionError } from "../lifecycle/admission.js";
import { LifecycleMutationRefusal, withLifecycleMutation, classifyMutationHome } from "../lifecycle/mutation-gate.js";
import type { CliLifecycleContext } from "../lifecycle/context.js";
import { ConfigurationError, readConfigFile } from "./doctor.js";

export type ConfigCommandRequestV1 =
  | { readonly operation: "get"; readonly key: string | null }
  | { readonly operation: "set"; readonly key: string; readonly value: string };

export type ConfigCommandResultV1 = ConfigGetResultV1 | ConfigSetResultV1;

const GLOBAL_LOCK_LEAF = ".lifecycle.lock";

const encoder = new TextEncoder();

/** One line: the canonical JSON of the result without its LF (the CLI's line writer adds it). */
export function renderConfigResult(result: ConfigCommandResultV1): readonly string[] {
  return [encodeCanonicalJson(result as unknown as CanonicalJsonValue).slice(0, -1)];
}

function refusalPathsOf(error: unknown): readonly string[] {
  return error instanceof V2HomeAdmissionError || error instanceof LifecycleMutationRefusal
    ? error.paths
    : [];
}

/**
 * A manifest-absent home that still carries the global lock may be a mutation in flight, so
 * the answer is only stable once that mutation has released it. The lock is taken with
 * `acquireExisting` and never created: `config` on a home with no installation must not
 * leave one behind.
 */
async function reclassifyUnderGlobalLock(
  context: CliContext,
  lifecycle: CliLifecycleContext | undefined,
): Promise<boolean> {
  if (lifecycle === undefined) return false;
  const lockPath = join(context.paths.stateDir, GLOBAL_LOCK_LEAF) as CanonicalAbsolutePathV1;
  const held = await lifecycle.locks.acquireExisting(lockPath);
  try {
    return (await classifyMutationHome(context, lifecycle)).kind === "v2";
  } finally {
    await held.release();
  }
}

async function admitV2Home(context: CliContext): Promise<CliLifecycleContext> {
  const lifecycle = context.lifecycle;
  const home = await classifyMutationHome(context, lifecycle);
  if (home.kind === "v1") {
    throw new V2HomeAdmissionError("manifest_v1_not_migratable", [context.paths.manifestFile]);
  }
  if (home.kind === "manifest_absent") {
    throw new V2HomeAdmissionError("manifest_absent", [context.paths.manifestFile]);
  }
  if (home.kind === "manifest_absent_with_global_lock" && !(await reclassifyUnderGlobalLock(context, lifecycle))) {
    throw new V2HomeAdmissionError("manifest_absent", [
      context.paths.manifestFile,
      join(context.paths.stateDir, GLOBAL_LOCK_LEAF),
    ]);
  }
  if (lifecycle === undefined) throw new Error("an admitted V2 home has no lifecycle context");
  return lifecycle;
}

/**
 * One read, through the protected-path policy, hashing the bytes it opened rather than a
 * re-encoding of the decoded text — the lossy round trip `CliGuards.readText` exposes its
 * reader to avoid. Two reads would be worse than lossy: the record would come from the first
 * and the precondition from the second, so a hand edit between them would be overwritten by
 * a transaction whose guard had already accepted it.
 */
export async function readConfigRecord(
  context: CliContext,
): Promise<{ readonly config: DeveloperOsConfigV1; readonly beforeHash: string }> {
  let beforeHash = "";
  const serialized = await context.guards.readText(context.paths.configFile, async (handle) => {
    const bytes = await handle.readFile();
    beforeHash = hashBytes(bytes);
    return bytes.toString("utf8");
  });

  let config: DeveloperOsConfigV1;
  try {
    config = loadConfig(serialized);
  } catch {
    throw new ConfigurationError();
  }
  return { config, beforeHash };
}

async function applyConfigValue(
  context: CliContext,
  lifecycle: CliLifecycleContext,
  key: string,
  value: string,
): Promise<ConfigSetResultV1> {
  return withLifecycleMutation(context, lifecycle, async () => {
    const { config, beforeHash } = await readConfigRecord(context);
    const mutation = setConfigValue(config, key, value);
    if (mutation.result.outcome === "updated") {
      await context.executor.execute({
        kind: "config-set",
        mutations: [
          {
            targetPath: context.paths.configFile,
            operation: "replace",
            content: encoder.encode(serializeConfig(mutation.config)),
            expectedBeforeHash: beforeHash,
          },
        ],
      });
    }
    return mutation.result;
  });
}

export async function runConfig(
  context: CliContext,
  request: ConfigCommandRequestV1,
): Promise<CliResult<ConfigCommandResultV1>> {
  try {
    const lifecycle = await admitV2Home(context);

    if (request.operation === "get") {
      const config = await readConfigFile(context, context.paths.configFile);
      if (config === null) throw new ConfigurationError();
      return success(
        readConfigValue(config, request.key === null ? null : parseConfigReadableKey(request.key)),
      );
    }

    return success(await applyConfigValue(context, lifecycle, request.key, request.value));
  } catch (error) {
    return failureFrom(
      context,
      error,
      refusalPathsOf(error),
      error instanceof LifecycleMutationRefusal ? error.recovery : undefined,
    );
  }
}
