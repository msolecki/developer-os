import { EXIT_CODES, failure, parseStableSemver, success } from "@developer-os/core";
import type {
  CliResult,
  OwnerUpdatePreviewV1,
  SchemaMigrationPreviewV1,
  StableSemverV1,
  UpdateCapacityProjectionV1,
} from "@developer-os/core";

import { failureFrom, renderPath } from "../../context.js";
import type { CliContext } from "../../context.js";
import { applyUpdate, recoverUpdate } from "../../update/apply.js";
import { createCliUpdateContext } from "../../update/context.js";
import type { CliUpdateContext } from "../../update/context.js";
import { planRollback, planUpdate, prepareUpdate, UpdatePlanningRefusal } from "../../update/planning.js";
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

/**
 * `update --apply` heals any update residue first, previews with its scratch kept open, then
 * applies that same in-memory candidate. An automatic rollback is a failure: nothing changed.
 */
async function runApply(update: CliUpdateContext, version: StableSemverV1 | null): Promise<CliResult<UpdateCommandResultV1>> {
  await recoverUpdate(update);
  const prepared = await prepareUpdate(update, { version });
  if (prepared.apply === null) return success(prepared.result);
  const applied = await applyUpdate(update, prepared.apply);
  if (applied.outcome === "applied") return success(applied);
  return failure(EXIT_CODES.operationalFailure, {
    kind: "update_rolled_back_automatically",
    message: applied.cause,
    paths: [],
    recovery: `Developer OS ${applied.active.version} is still active; run \`developer-os update\` to preview again`,
  });
}

/**
 * `update rollback --apply` stays unavailable until Task 25; `update --apply` needs the injected
 * apply ports and refuses before any other port when they are absent.
 */
export async function runUpdate(context: CliContext, invocation: UpdateInvocationV1): Promise<CliResult<UpdateCommandResultV1>> {
  const unavailable = (): CliResult<never> => failure(EXIT_CODES.capabilityUnavailable, {
    kind: "update_apply_unavailable",
    message: "update_apply_unavailable",
    paths: [],
  });
  if (invocation.apply && invocation.kind === "rollback") return unavailable();
  const update = context.update ?? createCliUpdateContext(context);
  if (invocation.apply && update.apply === undefined) return unavailable();
  try {
    if (invocation.kind === "rollback") {
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
        `download  ${plan.download.archiveBytes} bytes, ${String(plan.download.entryCount)} bundle entries`,
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
