import { createHash } from "node:crypto";

import { encodeCanonicalJson, hashCanonicalJsonNoLf } from "../lifecycle/canonical-json.js";
import type { CanonicalJsonValue } from "../lifecycle/canonical-json.js";
import type { ImmutableUpdatePlanRefV1, UpdateLeafPlanKindV1 } from "./construction.js";
import type { SchemaMigrationPlanV1 } from "./migrations.js";
import { OWNER_UPDATE_ORDER } from "./owner.js";
import type { OwnerExternalEffectPlanV1, OwnerUpdatePlanV1 } from "./participants.js";
import { fail } from "./scalars.js";
import type { LowerHexSha256 } from "./scalars.js";

// The pure postimage digests of Spec 2 §9.2, apart from `participants.ts` (whose migration and
// journal imports reach the filesystem) so the release verifier's graph stays capability-free.

function canonical(value: unknown): string {
  return encodeCanonicalJson(value as CanonicalJsonValue);
}

function same(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}

/** Spec 2 §9.2: `developer-os/update-leaf/<kind>/v1\0` plus the canonical JSON-plus-LF bytes. */
export function updateLeafPlanHash(kind: UpdateLeafPlanKindV1, bytes: Uint8Array): LowerHexSha256 {
  return createHash("sha256").update(`developer-os/update-leaf/${kind}/v1\0`, "ascii").update(bytes).digest("hex") as LowerHexSha256;
}

/** An immutable plan's persisted bytes: canonical JSON plus one LF. */
export function updateParticipantDocumentBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonical(value));
}

/** The immutable plan ref hash (D72 P7(a)): §9.2's `developer-os/update-leaf/<kind>/v1\0` domain over the exact persisted bytes. */
export function updateParticipantDocumentHash(kind: UpdateLeafPlanKindV1, value: unknown): LowerHexSha256 {
  return updateLeafPlanHash(kind, updateParticipantDocumentBytes(value));
}

export interface OwnerPostimageRowInputV1 {
  readonly ref: ImmutableUpdatePlanRefV1<"owner_update">;
  readonly plan: OwnerUpdatePlanV1;
  readonly effects: readonly { readonly ref: ImmutableUpdatePlanRefV1<"owner_external_effect">; readonly plan: OwnerExternalEffectPlanV1 }[];
}

/**
 * Spec 2 §9.2: `developer-os/update-owner-postimages/v1\0` over owner rows in canonical owner order;
 * each row is the owner-plan ref, every `{ targetPath, after }`, and each effect ref with its
 * proposed state hash. Recomputed from reopened plans, never trusted as a label.
 */
export function ownerPostimagesHash(rows: readonly OwnerPostimageRowInputV1[]): LowerHexSha256 {
  const owners = rows.map((row) => row.plan.owner);
  if (!same(owners, OWNER_UPDATE_ORDER.filter((owner) => owners.includes(owner)))) fail("ownerPostimagesHash: rows not in canonical owner order");
  return hashCanonicalJsonNoLf(
    "developer-os/update-owner-postimages/v1",
    rows.map((row) => {
      if (row.ref.hash !== updateParticipantDocumentHash("owner_update", row.plan) || row.ref.id !== row.plan.id) fail("ownerPostimagesHash: a ref that is not its plan");
      if (!same(row.effects.map((effect) => effect.ref), row.plan.externalEffects)) fail("ownerPostimagesHash: effects are not the owner plan's refs");
      return {
        ref: row.ref,
        operations: row.plan.operations.map((operation) => ({ targetPath: operation.targetPath, after: operation.afterArtifact ?? { state: "absent" } })),
        effects: row.effects.map((effect) => {
          if (effect.ref.hash !== updateParticipantDocumentHash("owner_external_effect", effect.plan)) fail("ownerPostimagesHash: an effect ref that is not its plan");
          return { ref: effect.ref, proposedStateHash: effect.plan.proposedStateHash };
        }),
      };
    }),
  );
}

/**
 * Spec 2 §9.2: `developer-os/update-migration-postimages/v1\0` over migration rows in execution
 * order; the empty migration set hashes the canonical empty array.
 */
export function migrationPostimagesHash(rows: readonly { readonly ref: ImmutableUpdatePlanRefV1<"schema_migration">; readonly plan: SchemaMigrationPlanV1 }[]): LowerHexSha256 {
  return hashCanonicalJsonNoLf(
    "developer-os/update-migration-postimages/v1",
    rows.map(({ ref, plan }) => {
      if (ref.id !== plan.id || ref.hash !== updateParticipantDocumentHash("schema_migration", plan)) fail("migrationPostimagesHash: a ref that is not its plan");
      return { ref, id: plan.id, domain: plan.domain, fromVersion: plan.fromVersion, toVersion: plan.toVersion, mutations: plan.mutations.map((mutation) => ({ path: mutation.path, afterHash: mutation.afterHash })) };
    }),
  );
}

