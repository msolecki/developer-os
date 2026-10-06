/**
 * The read-only V2 lifecycle survey `doctor` and `status` share (NEW-160, NEW-170). Both used to
 * read only `state/transactions`, so a home stopped mid-coordinator looked clean, or looked like a
 * Foundation transaction `repair` could resolve while the mutation gate refuses that repair. This
 * names every unfinished coordinator, the non-empty uninstall marker and the update executor
 * record, each with the command that resumes it. It takes no lock and writes nothing.
 */
import { join } from "node:path";

import { deriveUpdateExecutorRecordPath, parseCanonicalAbsolutePathText } from "@developer-os/core";

import { createBootstrapEvidenceInspectionRequest } from "../bootstrap/context.js";
import { inspectBootstrapEvidenceAdmission } from "../bootstrap/report.js";
import type { CliContext } from "../context.js";
import { coordinatorNonceOf, uninstallResidueFrom } from "./context.js";
import { uninstallingMarkerPath, uninstallingMarkerPresent } from "./runtime-records.js";

export const UNINSTALL_RECOVERY = "developer-os uninstall";
const UPDATE_RECOVERY = "developer-os update --apply";
const ROLLBACK_RECOVERY = "developer-os update rollback --apply";

export interface LifecycleResidueFindingV1 {
  readonly message: string;
  readonly path: string;
  /** Absent when no single command resumes it: a ledger the scan itself refuses. */
  readonly recovery?: string;
}

export interface LifecycleResidueSurveyV1 {
  readonly findings: readonly LifecycleResidueFindingV1[];
  /** Foundation journals a coordinator owns: its own recovery resolves them, never `repair`. */
  readonly ownedTransactionIds: ReadonlySet<string>;
}

const CLEAN: LifecycleResidueSurveyV1 = { findings: [], ownedTransactionIds: new Set() };

export async function surveyLifecycleResidue(context: CliContext): Promise<LifecycleResidueSurveyV1> {
  const lifecycle = context.lifecycle;
  if (lifecycle === undefined) return CLEAN;
  const productHome = parseCanonicalAbsolutePathText(context.paths.home);
  const findings: LifecycleResidueFindingV1[] = [];

  if (await uninstallingMarkerPresent(lifecycle.fs, productHome)) {
    findings.push({
      message: "an interrupted uninstall left its marker behind",
      path: uninstallingMarkerPath(productHome),
      recovery: UNINSTALL_RECOVERY,
    });
  }

  const nonce = await coordinatorNonceOf(lifecycle.fs, productHome);
  let ownedTransactionIds: ReadonlySet<string> = new Set();
  let updateRecovery = UPDATE_RECOVERY;
  if (nonce !== null) {
    const evidence = context.bootstrap?.state === "available"
      ? await context.bootstrap.inspectEvidence()
      : await inspectBootstrapEvidenceAdmission(createBootstrapEvidenceInspectionRequest({
          productHome: context.paths.home,
          stateDirectory: context.paths.stateDir,
          initialRoots: [context.paths.home, context.paths.stateDir, context.userHome],
        }));
    const { snapshot, observation } = await lifecycle.inspectClosureV2(
      { productHome, nonce },
      uninstallResidueFrom(evidence),
    );
    const journal = (id: string): string => join(lifecycle.roots.coordinatorJournals, `${id}.json`);
    for (const record of snapshot.coordinators) {
      const operation = record.plan.operation;
      findings.push({
        message: `${operation} coordinator ${record.id} is unfinished (${record.state})`,
        path: journal(record.id),
        ...(operation === "uninstall" ? { recovery: UNINSTALL_RECOVERY } : {}),
      });
    }
    for (const coordinator of observation.updateCoordinators) {
      const recovery = coordinator.operation === "update_rollback" ? ROLLBACK_RECOVERY : UPDATE_RECOVERY;
      if (observation.executorRecord?.coordinatorId === coordinator.id) updateRecovery = recovery;
      findings.push({
        message: `${coordinator.operation} coordinator ${coordinator.id} is unfinished (${coordinator.direction})`,
        path: journal(coordinator.id),
        recovery,
      });
    }
    for (const construction of observation.constructions) {
      findings.push({
        message: `update construction ${construction.coordinatorId} is unfinished`,
        path: journal(construction.coordinatorId),
        recovery: UPDATE_RECOVERY,
      });
    }
    for (const finding of snapshot.findings) {
      findings.push({ message: `the lifecycle ledger refuses ${finding.path}: ${finding.reason}`, path: finding.path });
    }
    if (observation.malformed) {
      findings.push({ message: "the lifecycle ledger holds malformed update residue", path: lifecycle.roots.coordinatorJournals });
    }
    const standalone = new Set<string>([
      ...snapshot.standaloneNonTerminalFoundation.map((entry) => entry.id),
      ...snapshot.standaloneTerminalFoundation.map((entry) => entry.transactionId),
    ]);
    ownedTransactionIds = new Set([...snapshot.foundation.journals.keys()].filter((id) => !standalone.has(id)));
  }

  /** Fresh `init` reserves the path as an empty file, which holds no record (Spec 2 §6.4). */
  const executorRecord = deriveUpdateExecutorRecordPath(productHome);
  const record = await lifecycle.fs.lstat(executorRecord);
  if (record !== null && !(record.kind === "regular_file" && record.size === "0")) {
    findings.push({ message: "an interrupted update left its executor record behind", path: executorRecord, recovery: updateRecovery });
  }

  return { findings, ownedTransactionIds };
}
