import type {
  BrainConfigV1,
  PlannedSchemaMigrationsV1,
  PositiveUInt32V1,
  SchemaMigrationProviderV1,
  SchemaMigrationSubjectV1,
  UpdatePlannerRequestV1,
} from "@developer-os/core";
import { planSchemaMigrations } from "@developer-os/core/planner-protocol";

/**
 * Discovery's `PRIVATE_FOLDERS`, restated because importing discovery would pull Security's
 * filesystem canonicalization into the target planner's capability-absence graph. A test pins
 * the two lists equal.
 */
export const BRAIN_MIGRATION_PRIVATE_FOLDERS: readonly string[] = Object.freeze(["_raw", "_outputs", "_graveyard", "templates"]);

/**
 * Deliberately empty, like `BRAIN_MIGRATIONS`: no Brain schema step exists yet. A target release
 * that needs one ships it here, in chain order.
 */
export const BRAIN_UPDATE_MIGRATIONS: readonly SchemaMigrationProviderV1[] = Object.freeze([]);

/**
 * Deny by default, as discovery walks: `<contentRoot>/<topic folder or alias>/…/<name>.md`, no
 * dot-prefixed segment at any depth, and no index or private folder as a directory.
 */
export function isBrainMigrationPath(path: string, config: BrainConfigV1): boolean {
  const segments = path.split("/");
  const name = segments[segments.length - 1];
  const topic = segments[1];
  if (segments.length < 3 || name === undefined || topic === undefined || !name.endsWith(".md")) return false;
  if (segments[0] !== config.contentRoot.normalize("NFC")) return false;
  const aliased = Object.hasOwn(config.topicAliases, topic) ? config.topicAliases[topic] : topic;
  if (aliased === undefined || !config.topicFolders.includes(aliased)) return false;
  if (segments.some((segment) => segment.startsWith("."))) return false;
  return !segments.slice(1, -1).some((segment) => segment === config.indexesDir || BRAIN_MIGRATION_PRIVATE_FOLDERS.includes(segment));
}

/**
 * The admitted snapshot entries a Brain provider may see, as token-free vault-relative subjects.
 * No configured Brain means no subjects.
 */
export function brainMigrationSubjects(
  request: Pick<UpdatePlannerRequestV1, "config" | "brain">,
  inputBlobs: readonly Uint8Array[],
): readonly SchemaMigrationSubjectV1[] {
  const config = request.config.brain;
  if (config === null) return [];
  return request.brain.entries
    .filter((entry) => isBrainMigrationPath(entry.path, config))
    .map((entry): SchemaMigrationSubjectV1 => {
      const content = inputBlobs[entry.blob.ordinal];
      if (content?.byteLength !== entry.bytes) throw new Error("invalid PlannerBrainEntryV1: its input blob is absent or differs");
      return { path: { domain: "brain", path: entry.path }, content };
    });
}

export interface BrainMigrationPlanningRequestV1 {
  readonly request: Pick<UpdatePlannerRequestV1, "config" | "brain">;
  readonly inputBlobs: readonly Uint8Array[];
  readonly targetVersion: PositiveUInt32V1;
  readonly firstOutputOrdinal: number;
  readonly providers?: readonly SchemaMigrationProviderV1[];
}

/**
 * Plans the Brain chain from the snapshot's folder-policy version to `targetVersion`. Pure and
 * root-free: it returns drafts and output blobs, and an absent step refuses as incompatible.
 */
export function planBrainSchemaMigrations(input: BrainMigrationPlanningRequestV1): PlannedSchemaMigrationsV1 {
  const current = input.request.brain.folderPolicyVersion;
  if (input.request.config.brain === null) return { drafts: [], outputBlobs: [] };
  return planSchemaMigrations({
    registry: { productState: [], brain: input.providers ?? BRAIN_UPDATE_MIGRATIONS },
    // Product state has no steps here; an equal range selects the empty chain.
    versions: { product_state: { from: current, to: current }, brain: { from: current, to: input.targetVersion } },
    subjects: { product_state: [], brain: brainMigrationSubjects(input.request, input.inputBlobs) },
    firstOutputOrdinal: input.firstOutputOrdinal,
  });
}
