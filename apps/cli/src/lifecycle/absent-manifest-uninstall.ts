/**
 * Spec 1 §6's absent-manifest uninstall, amended by A3 and D22: no coordinator envelope, no
 * allocated ID and no journal. `key_absent` proves the home holds nothing of ours with two
 * identical read-only walks and creates nothing at all; `key_present` deletes the one orphaned
 * secret under the transient bootstrap leaf, by rechecked identity, and leaves the leaf and the
 * whole bookkeeping set (A12) in place. Anything else in the home is residue: D27 refuses it
 * with D20's archive guidance rather than deleting a key beside evidence nobody has read.
 */
import {
  CODEX_INGEST_HOME_REPAIR,
  EXIT_CODES,
  LifecycleRecoveryRequiredError,
  inspectAbsentManifestProductHome,
  parseCanonicalAbsolutePathText,
} from "@developer-os/core";
import type { AbsentManifestEvidenceV1, CanonicalAbsolutePathV1 } from "@developer-os/core";

import { preservedRetentionRoots } from "../bootstrap/report.js";
import type { BootstrapEvidenceAdmissionV1 } from "../bootstrap/report.js";
import type { CliContext } from "../context.js";
import { UninstallRefusal } from "../commands/uninstall.js";
import type { UninstallOptions, UninstallResultV1 } from "../commands/uninstall.js";
import { residueFrom } from "./context.js";
import type { CliLifecycleContext } from "./context.js";
import {
  codexIngestHomePath,
  hookFiringRecordsPath,
  removeCodexIngestHome,
  removeHookFiringRecords,
} from "./uninstall.js";
import {
  observeSecretOpaqueKey,
  redactionKeySourcePath,
  unlinkSecretOpaqueKey,
} from "./redaction-key.js";

export type AbsentManifestUninstallArmV1 = "key_absent" | "key_present";

/** D20: the one way out of Foundation residue no absent-manifest arm may remove for the user. */
export const ABSENT_MANIFEST_ARCHIVE_RECOVERY =
  "developer-os uninstall, then archive the product home manually, then developer-os init";

const BOOTSTRAP_LEAF = ".lifecycle-bootstrap.lock";
const LEAF_MODE = 0o600;

type AbsentManifestInspectionRequestV1 = Parameters<typeof inspectAbsentManifestProductHome>[0];

export interface AbsentManifestUninstallRequestV1 {
  readonly context: CliContext;
  readonly lifecycle: CliLifecycleContext;
  readonly options: UninstallOptions;
  readonly evidence: BootstrapEvidenceAdmissionV1;
}

function absentManifestEvidenceOf(
  evidence: BootstrapEvidenceAdmissionV1,
): AbsentManifestEvidenceV1 {
  return {
    ...residueFrom(evidence),
    bootstrapIdentities: evidence.retainedEnvelopes.map(
      (envelope) => envelope.plan.bootstrapIdentity,
    ),
    activeOrAmbiguous: evidence.active !== null,
  };
}

function resultOf(
  arm: AbsentManifestUninstallArmV1,
  removed: readonly string[],
  evidence: BootstrapEvidenceAdmissionV1,
): UninstallResultV1 & { readonly arm: AbsentManifestUninstallArmV1 } {
  return {
    schemaVersion: 1,
    arm,
    removed,
    restored: [],
    preserved: preservedRetentionRoots(evidence),
    retainedBootstrapEvidence: evidence.report.ids,
    transactionId: null,
  };
}

/**
 * The leaf is the one path §6 lets an absent-manifest run create, and create-or-open is legal
 * only for it: it linearises this run against a concurrent `init` before either inspects the
 * home a second time. It is never unlinked, so a crash leaves a zero-byte lock the next run
 * reopens and the next `init` admits by shape.
 */
async function withBootstrapLeaf<T>(
  lifecycle: CliLifecycleContext,
  stateDirectory: CanonicalAbsolutePathV1,
  body: () => Promise<T>,
): Promise<T> {
  const leafPath = parseCanonicalAbsolutePathText(`${stateDirectory}/${BOOTSTRAP_LEAF}`);
  const handle = await lifecycle.transactionLocks.acquire(leafPath);
  try {
    const leaf = await lifecycle.fs.lstat(leafPath);
    if (
      leaf === null ||
      leaf.kind !== "regular_file" ||
      leaf.ownerUid !== lifecycle.effectiveUid ||
      leaf.mode !== LEAF_MODE ||
      leaf.nlink !== 1 ||
      BigInt(leaf.size) !== 0n
    ) {
      throw new LifecycleRecoveryRequiredError("absent_manifest_bootstrap_leaf", [leafPath]);
    }
    return await body();
  } finally {
    await handle.release();
  }
}

async function deleteOrphanedKey(
  lifecycle: CliLifecycleContext,
  dependencies: AbsentManifestInspectionRequestV1,
  stateDirectory: CanonicalAbsolutePathV1,
  keyPath: CanonicalAbsolutePathV1,
): Promise<void> {
  const locked = await inspectAbsentManifestProductHome(dependencies);
  if (locked.shape !== "state_key_only" || locked.bootstrapLeaf === null) {
    throw new LifecycleRecoveryRequiredError("absent_manifest_residue", [
      dependencies.productHome,
    ]);
  }
  const observed = await observeSecretOpaqueKey(keyPath, lifecycle.effectiveUid);
  if (observed.state !== "present") {
    throw new LifecycleRecoveryRequiredError("redaction_key_vanished", [keyPath]);
  }
  await unlinkSecretOpaqueKey(keyPath, observed);
  const state = await lifecycle.fs.lstat(stateDirectory);
  if (state !== null) await lifecycle.fs.syncDirectory(state);
  if ((await lifecycle.fs.lstat(keyPath)) !== null) {
    throw new LifecycleRecoveryRequiredError("redaction_key_retained", [keyPath]);
  }
}

export async function runAbsentManifestUninstall(
  input: AbsentManifestUninstallRequestV1,
): Promise<UninstallResultV1 & { readonly arm: AbsentManifestUninstallArmV1 }> {
  const { context, lifecycle, options, evidence } = input;
  try {
    const productHome = parseCanonicalAbsolutePathText(context.paths.home);
    const stateDirectory = parseCanonicalAbsolutePathText(context.paths.stateDir);
    const dependencies: AbsentManifestInspectionRequestV1 = {
      fs: lifecycle.fs,
      effectiveUid: lifecycle.effectiveUid,
      productHome,
      userHome: parseCanonicalAbsolutePathText(context.userHome),
      evidence: absentManifestEvidenceOf(evidence),
    };

    const hooks = hookFiringRecordsPath(productHome);
    const codexIngestHome = codexIngestHomePath(productHome);
    /** Spec 1 §6 (amended 2026-09-22): the admitted `state/hooks` goes last, in either arm; D52's `state/codex-ingest-home` with it. */
    const removeHooks = async (): Promise<readonly string[]> => {
      if (options.dryRun) {
        return [
          ...((await lifecycle.fs.lstat(hooks)) === null ? [] : [hooks]),
          ...((await lifecycle.fs.lstat(codexIngestHome)) === null ? [] : [codexIngestHome]),
        ];
      }
      return [
        ...((await removeHookFiringRecords(lifecycle.fs, productHome, lifecycle.effectiveUid)) ? [hooks] : []),
        ...((await removeCodexIngestHome(lifecycle.fs, productHome, lifecycle.effectiveUid)) ? [codexIngestHome] : []),
      ];
    };

    const first = await inspectAbsentManifestProductHome(dependencies);
    if (first.shape !== "state_key_only") {
      const second = await inspectAbsentManifestProductHome(dependencies);
      if (second.walkFingerprint !== first.walkFingerprint) {
        throw new LifecycleRecoveryRequiredError("absent_manifest_walk_race", [productHome]);
      }
      return resultOf("key_absent", await removeHooks(), evidence);
    }

    const keyPath = redactionKeySourcePath(stateDirectory);
    if (options.dryRun) return resultOf("key_present", [keyPath, ...(await removeHooks())], evidence);
    const removedHooks = await withBootstrapLeaf(lifecycle, stateDirectory, async () => {
      await deleteOrphanedKey(lifecycle, dependencies, stateDirectory, keyPath);
      return removeHooks();
    });
    return resultOf("key_present", [keyPath, ...removedHooks], evidence);
  } catch (error) {
    if (error instanceof LifecycleRecoveryRequiredError) {
      throw new UninstallRefusal(
        EXIT_CODES.recoveryRequired,
        error.message,
        error.paths,
        error.reason === "codex_ingest_home_shape" ? CODEX_INGEST_HOME_REPAIR : ABSENT_MANIFEST_ARCHIVE_RECOVERY,
      );
    }
    throw error;
  }
}
