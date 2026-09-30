import { createHash } from "node:crypto";

import {
  codexRegistrationProjectionHash,
  ownerExternalEffectEvidenceHash,
  ownerExternalEffectEvidencePath,
  ownerExternalEffectProcessPolicyHash,
  updateParticipantDocumentHash,
  validateOwnerExternalEffectEvidence,
  validateOwnerExternalEffectJournal,
  type CanonicalAbsolutePathV1,
  type CodexRegistrationProjectionV1,
  type ImmutableUpdatePlanRefV1,
  type LowerHexSha256,
  type OwnerExternalEffectEvidenceV1,
  type OwnerExternalEffectJournalV1,
  type OwnerExternalEffectPlanV1,
  type OwnerExternalEffectProcessPolicyV1,
  type UpdateInitialJournalRefV1,
  type UpdateParticipantObservationV1,
} from "@developer-os/core";

import { participantPlanFileHash, participantTimestamp, refuseParticipant, type UpdateParticipantJournalStore } from "./state-participant.js";

/** The concrete child the closed policy resolves to; Security's supervised runner executes it. */
export interface OwnerEffectProcessRequestV1 {
  readonly executable: string;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<"CODEX_HOME" | "TMPDIR", string>>;
  readonly cwd: string;
  readonly stdin: "ignore";
  readonly stdoutCap: number;
  readonly stderrCap: number;
  readonly idleMs: number;
  readonly wallMs: number;
}

export interface OwnerEffectProcessResultV1 {
  readonly exitCode: number | null;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
}

/** Plan-bound concrete values behind the policy's tokens; none ever enters persisted state. */
export interface OwnerEffectTokenValuesV1 {
  readonly managedPluginRoot: string;
  readonly pluginId: string;
  readonly privateEffectTmp: string;
  readonly managedVendorHome: string;
}

export interface OwnerExternalEffectDependenciesV1 {
  readonly journals: UpdateParticipantJournalStore;
  readonly stagingRoot: CanonicalAbsolutePathV1;
  readonly tokens: OwnerEffectTokenValuesV1;
  /** Guarded local observation, already secret-screened and tokenized by the Codex provider. */
  readonly observe: () => Promise<CodexRegistrationProjectionV1>;
  /** The installed provider's closed registry: reopens `pinned_codex_cli` and proves its identity. */
  readonly resolveExecutable: (identity: OwnerExternalEffectProcessPolicyV1["executableIdentity"]) => Promise<string>;
  readonly run: (request: OwnerEffectProcessRequestV1) => Promise<OwnerEffectProcessResultV1>;
  /** The Security redactor; runs before any vendor byte is hashed. */
  readonly redact: (text: string) => string;
  readonly now: () => Date;
}

export interface OwnerExternalEffectStepV1 {
  readonly plan: OwnerExternalEffectPlanV1;
  readonly planRef: ImmutableUpdatePlanRefV1<"owner_external_effect">;
  readonly journal: UpdateInitialJournalRefV1;
}

type Direction = OwnerExternalEffectJournalV1["direction"];

function redactedHash(bytes: Uint8Array, redact: (text: string) => string): LowerHexSha256 {
  const text = redact(new TextDecoder("utf-8").decode(bytes));
  return createHash("sha256").update(text, "utf8").digest("hex") as LowerHexSha256;
}

/** Resolves the closed policy to one concrete child; unknown tokens are unrepresentable by the codec. */
export function resolveOwnerEffectProcess(policy: OwnerExternalEffectProcessPolicyV1, executable: string, tokens: OwnerEffectTokenValuesV1): OwnerEffectProcessRequestV1 {
  const token = { managed_plugin_root: tokens.managedPluginRoot, plugin_id: tokens.pluginId, private_effect_tmp: tokens.privateEffectTmp } as const;
  return {
    executable,
    argv: policy.argv.map((arg) => (arg.kind === "literal" ? arg.value : token[arg.value])),
    env: { CODEX_HOME: tokens.managedVendorHome, TMPDIR: tokens.privateEffectTmp },
    cwd: tokens.managedPluginRoot,
    stdin: "ignore",
    stdoutCap: policy.stdoutBytes,
    stderrCap: policy.stderrBytes,
    idleMs: policy.idleMilliseconds,
    wallMs: policy.wallMilliseconds,
  };
}

/**
 * Spec 2 §8.3/§9.2's Codex registration refresh. Intent is synced before the pinned process runs,
 * evidence is synced before the cursor advances, and an intent without evidence re-observes the
 * guarded registration before choosing to resume, adopt, or refuse. Compensation reruns the same
 * closed refresh over the restored files and requires the expected projection back.
 */
export class OwnerExternalEffectParticipant {
  readonly #dependencies: OwnerExternalEffectDependenciesV1;

  constructor(dependencies: OwnerExternalEffectDependenciesV1) {
    this.#dependencies = dependencies;
  }

  async apply(step: OwnerExternalEffectStepV1): Promise<UpdateParticipantObservationV1> {
    let journal = await this.openJournal(step);
    if (journal.phase === "forward_observed" || journal.phase === "finalized") return { state: "applied" };
    if (journal.phase === "planned") journal = await this.persist(step, { ...journal, phase: "forward_intent" });
    if (journal.phase !== "forward_intent") return refuseParticipant("update_effect_journal_direction", step.journal.finalPath);
    const evidence = await this.execute(step, "forward");
    await this.persist(step, { ...journal, phase: "forward_observed", nextTransition: 1, evidenceHash: evidence });
    return { state: "applied" };
  }

  async compensate(step: OwnerExternalEffectStepV1): Promise<UpdateParticipantObservationV1> {
    if (await this.#dependencies.journals.unreached(step.journal)) return { state: "before" };
    let journal = await this.openJournal(step);
    if (journal.phase === "rolled_back") return { state: "compensated" };
    if (journal.phase === "finalized") return refuseParticipant("update_effect_compensation_after_terminal", step.journal.finalPath);
    if (journal.phase === "planned") {
      await this.persist(step, { ...journal, phase: "rolled_back", direction: "compensating" });
      return { state: "compensated" };
    }
    if (journal.phase === "forward_intent" || journal.phase === "forward_observed") {
      journal = await this.persist(step, { ...journal, phase: "compensation_intent", direction: "compensating" });
    }
    if (journal.phase === "compensation_intent") {
      const observed = await this.observeHash();
      if (journal.nextTransition === 0 && observed === step.plan.expectedStateHash) {
        await this.persist(step, { ...journal, phase: "rolled_back", evidenceHash: null });
        return { state: "compensated" };
      }
      const evidence = await this.execute(step, "compensating");
      journal = await this.persist(step, { ...journal, phase: "compensation_observed", nextTransition: 2, evidenceHash: evidence });
    }
    await this.persist(step, { ...journal, phase: "rolled_back" });
    return { state: "compensated" };
  }

  /** Terminal: after the point of no return the observed forward effect becomes `finalized`. */
  async finalize(step: OwnerExternalEffectStepV1): Promise<void> {
    const journal = await this.openJournal(step);
    if (journal.phase === "finalized") return;
    if (journal.phase !== "forward_observed") refuseParticipant("update_effect_finalize_before_observed", step.journal.finalPath);
    await this.persist(step, { ...journal, phase: "finalized" });
  }

  /** The outer compaction entry: evidence, journal, then the immutable plan last. */
  async compact(step: OwnerExternalEffectStepV1): Promise<void> {
    const { journals, stagingRoot } = this.#dependencies;
    if (await journals.exists(step.journal.finalPath)) {
      const journal = await this.openJournal(step);
      if (journal.phase !== "finalized" && journal.phase !== "rolled_back") refuseParticipant("update_effect_compaction_not_terminal", step.journal.finalPath);
      for (const direction of ["compensating", "forward"] as const) await journals.remove(ownerExternalEffectEvidencePath(stagingRoot, step.plan.id, direction));
      await journals.remove(step.journal.finalPath);
    }
    await journals.remove(step.planRef.path, participantPlanFileHash(step.planRef, step.plan));
  }

  private async openJournal(step: OwnerExternalEffectStepV1): Promise<OwnerExternalEffectJournalV1> {
    const { plan, planRef, journal } = step;
    if (planRef.hash !== updateParticipantDocumentHash("owner_external_effect", plan) || journal.kind !== "owner_external_effect" || journal.id !== plan.id || journal.planHash !== planRef.hash) refuseParticipant("update_effect_binding", journal.finalPath);
    if (plan.processPolicyHash !== ownerExternalEffectProcessPolicyHash(plan.processPolicy)) refuseParticipant("update_effect_policy", journal.finalPath);
    return validateOwnerExternalEffectJournal(await this.#dependencies.journals.open(journal), plan);
  }

  private async persist(step: OwnerExternalEffectStepV1, journal: OwnerExternalEffectJournalV1): Promise<OwnerExternalEffectJournalV1> {
    const next = { ...journal, updatedAt: participantTimestamp(this.#dependencies.now, journal.updatedAt) };
    await this.#dependencies.journals.rewrite(step.journal.finalPath, next);
    return next;
  }

  private async observeHash(): Promise<LowerHexSha256> {
    const projection = await this.#dependencies.observe();
    if (projection.source === "other") refuseParticipant("update_effect_foreign_registration");
    return codexRegistrationProjectionHash(projection);
  }

  /**
   * One intent-to-evidence transition. An existing evidence file for this direction is the durable
   * proof of a completed run and is adopted; otherwise the pre-state must be the cursor's start.
   */
  private async execute(step: OwnerExternalEffectStepV1, direction: Direction): Promise<LowerHexSha256> {
    const { plan } = step;
    const deps = this.#dependencies;
    const [from, to] = direction === "forward" ? [plan.expectedStateHash, plan.proposedStateHash] : [plan.proposedStateHash, plan.expectedStateHash];
    const evidencePath = ownerExternalEffectEvidencePath(deps.stagingRoot, plan.id, direction);
    if (await deps.journals.exists(evidencePath)) {
      const adopted = validateOwnerExternalEffectEvidence(await deps.journals.readAt(evidencePath), plan, direction, to);
      if ((await this.observeHash()) !== to) refuseParticipant("update_effect_postimage", evidencePath);
      return ownerExternalEffectEvidenceHash(adopted);
    }
    const before = await this.observeHash();
    if (before !== from && before !== to) refuseParticipant("update_effect_third_state", evidencePath);
    const executable = await deps.resolveExecutable(plan.processPolicy.executableIdentity);
    const result = await deps.run(resolveOwnerEffectProcess(plan.processPolicy, executable, deps.tokens));
    if (result.exitCode !== 0 || result.stdout.byteLength > plan.processPolicy.stdoutBytes || result.stderr.byteLength > plan.processPolicy.stderrBytes) refuseParticipant("update_effect_process_failed", evidencePath);
    const after = await this.observeHash();
    if (after !== to) refuseParticipant("update_effect_postimage", evidencePath);
    const evidence: OwnerExternalEffectEvidenceV1 = {
      schemaVersion: 1,
      id: plan.id,
      coordinatorId: plan.coordinatorId,
      planHash: updateParticipantDocumentHash("owner_external_effect", plan),
      direction,
      observedStateHash: after,
      processPolicyHash: plan.processPolicyHash,
      exitCode: 0,
      redactedStdoutHash: redactedHash(result.stdout, deps.redact),
      redactedStderrHash: redactedHash(result.stderr, deps.redact),
      completedAt: participantTimestamp(deps.now, validateOwnerExternalEffectJournal(await deps.journals.readAt(step.journal.finalPath), plan).updatedAt),
    };
    validateOwnerExternalEffectEvidence(evidence, plan, direction, to);
    await deps.journals.writeEvidence(evidencePath, evidence, plan.maximumEvidenceBytes);
    return ownerExternalEffectEvidenceHash(evidence);
  }
}
