/**
 * Spec 1 §2.2 and §3's `config` rows: the first product verb that mutates a V2 home through
 * the lifecycle mutation gate. `get` takes no lock and publishes the projection Task 5
 * derives; `set` runs its one Foundation transaction inside `withLifecycleMutation`, guarded
 * by the hash of the very bytes it read.
 */

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
  CanonicalJsonValue,
  CliResult,
  ConfigGetResultV1,
  ConfigSetResultV1,
  DeveloperOsConfigV1,
} from "@developer-os/core";

import { failureFrom } from "../context.js";
import type { CliContext } from "../context.js";
import { V2HomeAdmissionError } from "../lifecycle/admission.js";
import { admitV2Home } from "../lifecycle/command-home.js";
import { LifecycleMutationRefusal, withLifecycleMutation } from "../lifecycle/mutation-gate.js";
import type { CliLifecycleContext } from "../lifecycle/context.js";
import { ConfigurationError, readConfigFile } from "../config-file.js";

export type ConfigCommandRequestV1 =
  | { readonly operation: "get"; readonly key: string | null }
  | { readonly operation: "set"; readonly key: string; readonly value: string };

export type ConfigCommandResultV1 = ConfigGetResultV1 | ConfigSetResultV1;

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
