import { createHash } from "node:crypto";

import { migrationPostimagesHash, ownerPostimagesHash } from "./postimages.js";
import type { ImmutableUpdatePlanRefV1 } from "./construction.js";
import type { SchemaMigrationPlanV1 } from "./migrations.js";
import type { OwnerPostimageRowInputV1 } from "./postimages.js";
import type { LowerHexSha256 } from "./scalars.js";

export interface TargetSnapshotV1 {
  readonly manifest: Uint8Array;
  readonly owners: readonly OwnerPostimageRowInputV1[];
  readonly migrations: readonly { readonly ref: ImmutableUpdatePlanRefV1<"schema_migration">; readonly plan: SchemaMigrationPlanV1 }[];
}

/**
 * The release's target verifier (NEW-118 (4)): the three digests recomputed from the bounded
 * read-only snapshot the CLI took of the home, never echoed from the plan's own labels. A ref that
 * is not its plan throws inside the postimage hashes.
 */
export function verifyTargetSnapshot(input: TargetSnapshotV1): { readonly manifestHash: LowerHexSha256; readonly ownerPostimagesHash: LowerHexSha256; readonly migrationPostimagesHash: LowerHexSha256 } {
  return {
    manifestHash: createHash("sha256").update(input.manifest).digest("hex") as LowerHexSha256,
    ownerPostimagesHash: ownerPostimagesHash(input.owners),
    migrationPostimagesHash: migrationPostimagesHash(input.migrations),
  };
}
