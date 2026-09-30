import {
  encodeCanonicalJson,
  ManifestStateParticipantError,
  type CanonicalAbsolutePathV1,
  type InstallationManifestV2,
  type LowerHexSha256,
  type ManagedArtifactV2,
  type ManifestStateParticipant,
  type ManifestStatePlanV1,
  type UpdateLifecycleCoordinatorStepV1,
  type UpdateParticipantObservationV1,
} from "@developer-os/core";

import type { UpdateStepHandlersV1 } from "./coordinator.js";
import { refuseParticipant } from "./state-participant.js";

type ManifestStepV1 = Extract<UpdateLifecycleCoordinatorStepV1, { readonly kind: "manifest" }>;
type ManifestFileIdentityV1 = Parameters<ManifestStateParticipant["dependencies"]["guardedUnlinkExact"]>[1];

export type ManifestStepParticipantV1 = Pick<ManifestStateParticipant, "observe" | "preserveBefore" | "publishAfter" | "compensate" | "compact">;

export interface ManifestStepHandlerDependenciesV1 {
  /** A participant admitted with `lifecycleIdentity: "construction_evidence"` (D72 P2). */
  readonly participant: (plan: ManifestStatePlanV1) => ManifestStepParticipantV1;
  /** Reads the V2 manifest at `path`; refuses unless its bytes hash to `hash`. */
  readonly readManifest: (path: CanonicalAbsolutePathV1, hash: LowerHexSha256) => Promise<InstallationManifestV2>;
  /**
   * Unlinks the exact file and syncs its parent; absence is a no-op so a resumed finalize is
   * idempotent, and any other file is exit 6. The transitional tombstone needs this port because
   * `compact(transitional)` refuses once the live manifest holds the terminal bytes.
   */
  readonly removeTombstone: (path: CanonicalAbsolutePathV1, expected: ManifestFileIdentityV1) => Promise<void>;
}

export interface ManifestStepPlansV1 {
  readonly transitional: ManifestStatePlanV1;
  readonly terminal: ManifestStatePlanV1;
}

const APPLIED: UpdateParticipantObservationV1 = { state: "applied" };
const COMPENSATED: UpdateParticipantObservationV1 = { state: "compensated" };

function rowKey(row: ManagedArtifactV2): string {
  return encodeCanonicalJson(row as never);
}

/** D72 P3: the terminal set is the transitional set minus exactly the retired partition. */
export function deriveTerminalManifest(transitional: InstallationManifestV2, retired: readonly ManagedArtifactV2[]): InstallationManifestV2 {
  const keys = new Set(retired.map(rowKey));
  const artifacts = transitional.artifacts.filter((row) => !keys.has(rowKey(row)));
  if (keys.size !== retired.length || transitional.artifacts.length - artifacts.length !== retired.length) {
    refuseParticipant("update_manifest_retired_partition");
  }
  return { ...transitional, artifacts };
}

/** A participant refusal is a third state, so it must never start compensation (exit 6). */
async function guarded<T>(path: CanonicalAbsolutePathV1, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ManifestStateParticipantError) refuseParticipant("update_manifest_state", path);
    throw error;
  }
}

async function requireTerminalDerivation(plans: ManifestStepPlansV1, retired: readonly ManagedArtifactV2[], deps: ManifestStepHandlerDependenciesV1, transitionalAt: CanonicalAbsolutePathV1): Promise<void> {
  const { transitional, terminal } = plans;
  if (
    transitional.after.state !== "present" || transitional.after.bytes === null ||
    terminal.before.state !== "present" || terminal.before.bytes?.path !== transitional.after.bytes.path ||
    terminal.before.hash !== transitional.after.hash ||
    terminal.after.state !== "present" || terminal.after.bytes === null
  ) {
    refuseParticipant("update_manifest_terminal_chain", terminal.manifestPath);
  }
  const expected = deriveTerminalManifest(await deps.readManifest(transitionalAt, transitional.after.hash), retired);
  const actual = await deps.readManifest(terminal.after.bytes.path, terminal.after.hash);
  if (encodeCanonicalJson(expected as never) !== encodeCanonicalJson(actual as never)) {
    refuseParticipant("update_manifest_terminal_difference", terminal.after.bytes.path);
  }
}

function presentIdentity(state: ManifestStatePlanV1["before"], path: CanonicalAbsolutePathV1): ManifestFileIdentityV1 {
  if (state.state !== "present" || state.dev === null || state.ino === null) return refuseParticipant("update_manifest_tombstone_identity", path);
  const { hash, ownerUid, mode, nlink, size, dev, ino } = state;
  return { hash, ownerUid, mode, nlink, size, dev, ino };
}

/**
 * D72 P3's binding of the four `manifest/*` steps: `preserve_before` and `publish_transitional`
 * drive the transitional plan; `publish_terminal` checks the terminal derivation before any
 * terminal mutation, then preserves the transitional manifest and publishes the terminal one;
 * `finalize_tombstones` compacts the terminal tombstone, then the transitional one.
 */
export function manifestStepHandlers(plans: ManifestStepPlansV1, retired: readonly ManagedArtifactV2[], deps: ManifestStepHandlerDependenciesV1): Pick<UpdateStepHandlersV1, "manifest"> {
  const { transitional, terminal } = plans;
  const { participant } = deps;
  const at = transitional.manifestPath;

  const publishTerminal = async (): Promise<UpdateParticipantObservationV1> => {
    const observed = (await participant(terminal).observe(terminal)).state;
    if (observed !== "applied") {
      await requireTerminalDerivation(plans, retired, deps, observed === "before" ? terminal.manifestPath : terminal.tombstonePath);
      await participant(terminal).preserveBefore(terminal);
    }
    await participant(terminal).publishAfter(terminal);
    return APPLIED;
  };

  const finalizeTombstones = async (): Promise<UpdateParticipantObservationV1> => {
    await participant(terminal).compact(terminal);
    if (transitional.before.state === "present") {
      await deps.removeTombstone(transitional.tombstonePath, presentIdentity(transitional.before, transitional.tombstonePath));
    }
    return APPLIED;
  };

  const observeOn = async (plan: ManifestStatePlanV1, reached: readonly string[]): Promise<UpdateParticipantObservationV1> => {
    const { state } = await participant(plan).observe(plan);
    return reached.includes(state) ? APPLIED : { state: "before" };
  };

  return {
    manifest: {
      apply: (step: ManifestStepV1) => guarded(at, async () => {
        switch (step.transition) {
          case "preserve_before":
            await participant(transitional).preserveBefore(transitional);
            return APPLIED;
          case "publish_transitional":
            await participant(transitional).publishAfter(transitional);
            return APPLIED;
          case "publish_terminal":
            return publishTerminal();
          case "finalize_tombstones":
            return finalizeTombstones();
        }
      }),
      observe: (step: ManifestStepV1) => guarded(at, () => {
        switch (step.transition) {
          case "preserve_before":
            return observeOn(transitional, ["preimage_preserved", "applied"]);
          case "publish_transitional":
            return observeOn(transitional, ["applied"]);
          case "publish_terminal":
            return observeOn(terminal, ["applied"]);
          case "finalize_tombstones":
            // The participant cannot classify a compacted inventory; a resumed finalize reapplies.
            return refuseParticipant("update_manifest_observe_finalize", at);
        }
      }),
      compensate: (step: ManifestStepV1) => guarded(at, async () => {
        if (step.transition !== "preserve_before" && step.transition !== "publish_transitional") {
          return refuseParticipant("update_manifest_forward_only", at);
        }
        await participant(transitional).compensate(transitional);
        return COMPENSATED;
      }),
    },
  };
}
