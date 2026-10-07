import { EXIT_CODES, failure, parseStableSemver, success } from "@developer-os/core";
import type {
  CliResult,
  OwnerUpdatePreviewV1,
  SchemaMigrationPreviewV1,
  StableSemverV1,
  UpdateOperationV1,
  UpdateCapacityProjectionV1,
} from "@developer-os/core";

import { failureFrom, renderPath } from "../../context.js";
import type { CliContext } from "../../context.js";
import { applyUpdate, recoverUpdate } from "../../update/apply.js";
import { createCliUpdateContext } from "../../update/context.js";
import { applyRollback } from "../../update/rollback-apply.js";
import type { CliUpdateContext } from "../../update/context.js";
import { planRollback, planUpdate, prepareUpdate, releaseIdentityOf, UpdatePlanningRefusal } from "../../update/planning.js";
import type { UpdateCommandResultV1 } from "../../update/planning.js";

export type { UpdateCommandResultV1 } from "../../update/planning.js";

export type UpdateInvocationV1 =
  | { readonly kind: "update"; readonly version: StableSemverV1 | null; readonly apply: boolean; readonly json: boolean }
  | { readonly kind: "rollback"; readonly apply: boolean; readonly json: boolean };

/**
 * Spec 2 §7.1's whole grammar, decided before any context exists:
 *
 *     developer-os update [--version <stable-semver>] [--apply] [--json]
 *     developer-os update rollback [--apply] [--json]
 *
 * Hand-rolled because the global `--version` is a boolean that prints the product version, and
 * because every other spelling — `--version=`, a repeat, a prerelease, `--dry-run`, `--yes`,
 * `--channel`, `--url`, `--origin`, `--allow-downgrade`, a second positional — must refuse rather
 * than be tolerated. `null` is the usage refusal.
 */
export function parseUpdateArgv(argv: readonly string[]): UpdateInvocationV1 | null {
  if (argv[0] !== "update") return null;
  let rollback = false;
  let version: StableSemverV1 | null = null;
  let versionSeen = false;
  let apply = false;
  let json = false;
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index] as string;
    if (token === "rollback" && !rollback) {
      rollback = true;
    } else if (token === "--apply" && !apply) {
      apply = true;
    } else if (token === "--json" && !json) {
      json = true;
    } else if (token === "--version" && !versionSeen) {
      versionSeen = true;
      const value = argv[index + 1];
      if (value === undefined) return null;
      try {
        version = parseStableSemver(value);
      } catch {
        return null;
      }
      index += 1;
    } else {
      return null;
    }
  }
  if (rollback) return versionSeen ? null : { kind: "rollback", apply, json };
  return { kind: "update", version, apply, json };
}

/** Spec 2 §9.4 (D60): a compensated run exits with its cause's class; only a verifier rejection is a security refusal. */
function compensatedExitCode(cause: string): typeof EXIT_CODES.securityRefusal | typeof EXIT_CODES.operationalFailure {
  return cause === "update_verifier_rejected" ? EXIT_CODES.securityRefusal : EXIT_CODES.operationalFailure;
}

/**
 * Heals update residue the invoking operation recorded (another operation's refuses, NEW-162). A
 * resumed coordinator ends this invocation: a compensated one is its failure, reported with the
 * cause its journal persisted (P7(b)); a finalized one is its success. Nothing is planned again.
 */
async function resumed(update: CliUpdateContext, operation: UpdateOperationV1, kind: string, preview: string): Promise<CliResult<UpdateCommandResultV1> | null> {
  const recovered = await recoverUpdate(update, operation);
  if (recovered.kind !== "coordinator" && recovered.kind !== "envelope_suffix") return null;
  const home = await update.readHome();
  const active = releaseIdentityOf(home.active);
  // A suffix's journal is gone: a finalized apply left the record it bound; a finalized rollback consumed it.
  const finalized = recovered.kind === "coordinator"
    ? recovered.outcome.kind === "finalized"
    : operation === "update_apply" ? home.rollback?.executionBindingHash === recovered.executionBindingHash : home.rollback === null;
  if (finalized) {
    return success(operation === "update_apply"
      ? { schemaVersion: 1, outcome: "applied", active, rollbackAvailable: true }
      : { schemaVersion: 1, outcome: "rolled_back", active, rollbackAvailable: false });
  }
  // The suffix's journal, and with it the persisted cause, is already gone.
  const cause = recovered.kind === "coordinator" && recovered.outcome.kind === "rolled_back" ? recovered.outcome.cause : "update_coordinator_compensated";
  return failure(compensatedExitCode(cause), {
    kind,
    message: cause,
    paths: [],
    recovery: `Developer OS ${active.version} is still active; run \`${preview}\` to preview again`,
  });
}

/**
 * `update --apply` heals any update residue first, previews with its scratch kept open, then
 * applies that same in-memory candidate. An automatic rollback is a failure: nothing changed.
 */
async function runApply(update: CliUpdateContext, version: StableSemverV1 | null): Promise<CliResult<UpdateCommandResultV1>> {
  const recovered = await resumed(update, "update_apply", "update_rolled_back_automatically", "developer-os update");
  if (recovered !== null) return recovered;
  const prepared = await prepareUpdate(update, { version });
  if (prepared.apply === null) return success(prepared.result);
  const applied = await applyUpdate(update, prepared.apply);
  if (applied.outcome === "applied") return success(applied);
  return failure(compensatedExitCode(applied.cause), {
    kind: "update_rolled_back_automatically",
    message: applied.cause,
    paths: [],
    recovery: `Developer OS ${applied.active.version} is still active; run \`developer-os update\` to preview again`,
  });
}

/**
 * `update rollback --apply` heals any update residue, previews from retained local evidence, and
 * applies that preview. A compensated rollback is a failure: the rejected release stays active.
 */
async function runRollbackApply(update: CliUpdateContext): Promise<CliResult<UpdateCommandResultV1>> {
  const recovered = await resumed(update, "update_rollback", "update_rollback_compensated", "developer-os update rollback");
  if (recovered !== null) return recovered;
  const rolledBack = await applyRollback(update, await planRollback(update));
  if (rolledBack.outcome === "rolled_back") return success(rolledBack);
  return failure(compensatedExitCode(rolledBack.cause), {
    kind: "update_rollback_compensated",
    message: rolledBack.cause,
    paths: [],
    recovery: `Developer OS ${rolledBack.active.version} is still active; run \`developer-os update rollback\` to preview again`,
  });
}

/**
 * `--apply` needs the injected apply ports, and `update rollback --apply` also their rollback
 * derivation; either absent refuses before any other port is reached.
 */
export async function runUpdate(context: CliContext, invocation: UpdateInvocationV1): Promise<CliResult<UpdateCommandResultV1>> {
  const unavailable = (): CliResult<never> => failure(EXIT_CODES.capabilityUnavailable, {
    kind: "update_apply_unavailable",
    message: "update_apply_unavailable",
    paths: [],
  });
  const update = context.update ?? createCliUpdateContext(context);
  if (invocation.apply && update.apply === undefined) return unavailable();
  if (invocation.apply && invocation.kind === "rollback" && update.apply?.composeRollback === undefined) return unavailable();
  try {
    if (invocation.kind === "rollback") {
      if (invocation.apply) return await runRollbackApply(update);
      return success({ schemaVersion: 1, outcome: "rollback_preview", plan: await planRollback(update) });
    }
    if (invocation.apply) return await runApply(update, invocation.version);
    return success((await planUpdate(update, { version: invocation.version })).result);
  } catch (error) {
    if (error instanceof UpdatePlanningRefusal) return failureFrom(context, error, error.paths, error.recovery);
    return failureFrom(context, error);
  }
}

function renderOwner(owner: OwnerUpdatePreviewV1): readonly string[] {
  const { counts } = owner;
  return [
    `owner ${owner.owner}: create ${String(counts.create)}, replace ${String(counts.replace)}, remove ${String(counts.remove)}, unchanged ${String(counts.unchanged)}${counts.externalEffects === 1 ? ", refreshes the Codex plugin registration" : ""}`,
    ...owner.paths.create.map((path) => `  create   ${renderPath(path)}`),
    ...owner.paths.replace.map((path) => `  replace  ${renderPath(path)}`),
    ...owner.paths.remove.map((path) => `  remove   ${renderPath(path)}`),
  ];
}

function renderMigration(migration: SchemaMigrationPreviewV1): readonly string[] {
  return [
    `migration ${migration.id} (${migration.domain} ${String(migration.fromVersion)} -> ${String(migration.toVersion)})`,
    ...migration.affectedPaths.map((path) => `  ${renderPath(path)}`),
  ];
}

function renderCapacity(capacity: UpdateCapacityProjectionV1): string {
  return `capacity  needs ${capacity.requiredBytes} bytes and ${capacity.requiredEntries} entries; ${capacity.availableBytes} bytes and ${capacity.availableEntries} entries are free`;
}

/** The human view of the same typed result `--json` prints; paths are rendered, never raw. */
export function renderUpdate(result: UpdateCommandResultV1): readonly string[] {
  switch (result.outcome) {
    case "up_to_date":
      return [`Developer OS ${result.active.version} is up to date.`];
    case "preview": {
      const { plan } = result;
      return [
        `Update ${plan.current.version} -> ${plan.target.version} (preview: nothing was changed)`,
        `source    ${renderPath(plan.packageSource.kegPath)} (bundle manifest ${plan.packageSource.bundleManifestHash})`,
        ...plan.owners.flatMap(renderOwner),
        ...plan.migrations.flatMap(renderMigration),
        plan.retainedRollback === null
          ? "rollback  none retained"
          : `rollback  ${plan.retainedRollback.release.version} is retained until this update verifies`,
        renderCapacity(plan.capacity),
        `preview   ${plan.previewHash}`,
        "Run `developer-os update --apply` to install it.",
      ];
    }
    case "rollback_preview": {
      const { plan } = result;
      return [
        `Rollback ${plan.current.version} -> ${plan.target.version} (preview: nothing was changed)`,
        ...plan.owners.flatMap(renderOwner),
        ...plan.migrations.flatMap(renderMigration),
        `payload   ${String(plan.payload.entryCount)} retained entries, ${String(plan.payload.aggregateBytes)} bytes; consumed by the rollback`,
        `preview   ${plan.previewHash}`,
        "Run `developer-os update rollback --apply` to roll back.",
      ];
    }
    case "applied":
      return [`Developer OS ${result.active.version} is installed; \`developer-os update rollback\` can return to the previous release.`];
    case "rolled_back":
      return [`Developer OS rolled back to ${result.active.version}.`];
  }
}
