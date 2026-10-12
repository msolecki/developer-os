import { encodeCanonicalJson, type CanonicalJsonValue } from "../lifecycle/canonical-json.js";
import type { ArtifactOwner } from "../manifest/types.js";
import { parseVaultRelativePathText, type OwnerRelativePathV1 } from "./paths.js";
import type {
  OwnerExternalEffectDraftV1,
  OwnerUpdateDraftV1,
  PlannerChangePlanOperationV1,
  PlannerContentRefV1,
  PlannerManifestArtifactV1,
  PlannerManifestSnapshotV1,
  PlannerPathTokenV1,
} from "./planner.js";
import { parseBundleRelativePath } from "./release.js";
import { fail, parseLowerHexSha256 } from "./scalars.js";

/** Spec 2 §8.3: the closed owner enum, in the canonical order every registry and plan list follows. */
export const OWNER_UPDATE_ORDER: readonly ArtifactOwner[] = Object.freeze(["core", "claude", "codex", "macos"]);

/** Spec 2 §8.2: a changed file travels as one blob, so no create or replace may exceed one blob. */
export const MAX_OWNER_CHANGED_FILE_BYTES = 16_777_216;

export interface OwnerUpdateProviderV1 {
  readonly owner: ArtifactOwner;
  readonly contentDependencies: (snapshot: PlannerManifestSnapshotV1) => readonly PlannerPathTokenV1[];
}

declare const ownerUpdateRegistryV1: unique symbol;

/** Exactly one provider per closed owner, in owner order. Only `createOwnerUpdateRegistry` mints it. */
export type OwnerUpdateRegistryV1 = readonly OwnerUpdateProviderV1[] & { readonly [ownerUpdateRegistryV1]: true };

function same(left: unknown, right: unknown): boolean {
  return encodeCanonicalJson(left as CanonicalJsonValue) === encodeCanonicalJson(right as CanonicalJsonValue);
}

function folded(path: string): string {
  return path.normalize("NFC").toLowerCase();
}

function partitionOf(snapshot: PlannerManifestSnapshotV1, owner: ArtifactOwner): readonly PlannerManifestArtifactV1[] {
  return snapshot.artifacts.filter((row) => row.owner === owner);
}

function installedOwnersOf(snapshot: PlannerManifestSnapshotV1): readonly ArtifactOwner[] {
  const owners = new Set(snapshot.artifacts.map((row) => row.owner));
  return OWNER_UPDATE_ORDER.filter((owner) => owners.has(owner));
}

/** Only a whole regular file a hash pins may change; directories, symlinks, ephemeral and block rows are keep-only. */
export function isChangeableOwnerArtifact(row: Pick<PlannerManifestArtifactV1, "kind" | "verification">): boolean {
  return row.kind === "file" && (row.verification.mode === "content" || row.verification.mode === "schema");
}

function checkContent(content: PlannerContentRefV1, label: string): void {
  if (content.kind === "target_bundle") {
    parseBundleRelativePath(content.path);
    parseLowerHexSha256(content.sha256);
    if (!Number.isSafeInteger(content.bytes) || content.bytes < 0 || content.bytes > MAX_OWNER_CHANGED_FILE_BYTES) fail(`${label}: changed file exceeds 16 MiB`);
    return;
  }
  // Provider output is target code: the literal tags are rechecked, not trusted from the type.
  const tags: { readonly kind: string; readonly stream: string } = { kind: content.kind, stream: content.blob.stream };
  if (tags.kind !== "output_blob" || tags.stream !== "output") fail(`${label}.kind`);
  if (!Number.isSafeInteger(content.blob.bytes) || content.blob.bytes < 0 || content.blob.bytes > MAX_OWNER_CHANGED_FILE_BYTES) fail(`${label}: changed file exceeds 16 MiB`);
}

function checkEffect(effect: OwnerExternalEffectDraftV1, draft: OwnerUpdateDraftV1): void {
  const label = "OwnerExternalEffectDraftV1";
  const tags: { readonly kind: string; readonly owner: string } = effect;
  if (tags.kind !== "codex_registration_refresh" || tags.owner !== "codex" || draft.owner !== "codex") fail(`${label}: not the closed Codex refresh`);
  if (!same(effect.artifactTokens, draft.currentArtifacts)) fail(`${label}.artifactTokens: not the exact Codex partition`);
}

/**
 * Spec 2 §8.3, root-free: the draft names this owner's complete partition, touches each
 * installed token at most once with the manifest's expected hash, changes only regular
 * files, creates only unique owner-relative paths, and requests at most the one Codex effect.
 */
export function validateOwnerDraft(draft: OwnerUpdateDraftV1, snapshot: PlannerManifestSnapshotV1): OwnerUpdateDraftV1 {
  const label = "OwnerUpdateDraftV1";
  if (!OWNER_UPDATE_ORDER.includes(draft.owner)) fail(`${label}.owner`);
  const partition = partitionOf(snapshot, draft.owner);
  if (partition.length === 0) fail(`${label}.owner: not installed`);
  if (!same(draft.currentArtifacts, partition.map((row) => row.token))) fail(`${label}.currentArtifacts: not the owner's complete partition`);
  const rows = new Map(partition.map((row) => [row.token as string, row]));
  const sources = new Set(partition.map((row) => folded(row.source)));

  const touched = new Set<string>();
  const created = new Set<string>();
  let changes = 0;
  const operations = draft.proposedOperations.map((operation): PlannerChangePlanOperationV1 => {
    const opLabel = "PlannerChangePlanOperationV1";
    if (operation.operation === "create") {
      const createKind: string = operation.target.kind;
      if (createKind !== "owner_relative" || operation.target.owner !== draft.owner) fail(`${opLabel}.target: create names another owner or an installed token`);
      const path = parseVaultRelativePathText(operation.target.path) as string as OwnerRelativePathV1;
      const key = folded(path);
      if (created.has(key)) fail(`${opLabel}.target: duplicate create`);
      // An installed source is replaced through its token; a create over it would hide the owned row.
      if (sources.has(key)) fail(`${opLabel}.target: create collides with an installed artifact`);
      created.add(key);
      checkContent(operation.content, `${opLabel}.content`);
      changes += 1;
      return operation;
    }
    const targetKind: string = operation.target.kind;
    if (targetKind !== "installed") fail(`${opLabel}.target: only a create may name an owner-relative path`);
    const row = rows.get(operation.target.token);
    if (row === undefined) fail(`${opLabel}.target: outside the owner's partition`);
    if (touched.has(row.token)) fail(`${opLabel}.target: repeated token`);
    touched.add(row.token);
    if (operation.expectedHash !== row.currentHash) fail(`${opLabel}.expectedHash: differs from the manifest`);
    if (operation.operation === "keep") return operation;
    const name: string = operation.operation;
    if (name !== "remove" && name !== "replace") fail(`${opLabel}.operation`);
    if (!isChangeableOwnerArtifact(row)) fail(`${opLabel}: a directory, symlink, ephemeral, or block artifact is keep-only`);
    if (operation.operation === "replace") checkContent(operation.content, `${opLabel}.content`);
    changes += 1;
    return operation;
  });

  if (draft.externalEffects.length > 1) fail(`${label}.externalEffects: a second external effect`);
  for (const effect of draft.externalEffects) checkEffect(effect, draft);
  if (draft.externalEffects.length > 0 && changes === 0) fail(`${label}.externalEffects: an effect without a file change`);
  const result: OwnerUpdateDraftV1 = { owner: draft.owner, currentArtifacts: draft.currentArtifacts, proposedOperations: operations, externalEffects: draft.externalEffects };
  if (!same(result, draft)) fail(`${label}: not exact`);
  return result;
}

/** Spec 2 §8.3's closed registry: exactly one provider for every owner, nothing else. */
export function createOwnerUpdateRegistry(providers: readonly OwnerUpdateProviderV1[]): OwnerUpdateRegistryV1 {
  const byOwner = new Map<ArtifactOwner, OwnerUpdateProviderV1>();
  for (const provider of providers) {
    if (!OWNER_UPDATE_ORDER.includes(provider.owner)) fail("OwnerUpdateRegistryV1: unknown owner");
    if (byOwner.has(provider.owner)) fail(`OwnerUpdateRegistryV1: duplicate provider for ${provider.owner}`);
    byOwner.set(provider.owner, provider);
  }
  const ordered = OWNER_UPDATE_ORDER.map((owner) => byOwner.get(owner) ?? fail(`OwnerUpdateRegistryV1: missing provider for ${owner}`));
  return Object.freeze(ordered) as unknown as OwnerUpdateRegistryV1;
}

function providerFor(registry: OwnerUpdateRegistryV1, owner: ArtifactOwner): OwnerUpdateProviderV1 {
  const matches = registry.filter((provider) => provider.owner === owner);
  if (matches.length !== 1) fail(`OwnerUpdateRegistryV1: not exactly one provider for ${owner}`);
  return matches[0] as OwnerUpdateProviderV1;
}

function dependenciesOf(provider: OwnerUpdateProviderV1, snapshot: PlannerManifestSnapshotV1): ReadonlySet<string> {
  const rows = new Map(partitionOf(snapshot, provider.owner).map((row) => [row.token as string, row]));
  const declared = provider.contentDependencies(snapshot);
  const tokens = new Set<string>();
  for (const token of declared) {
    const row = rows.get(token);
    if (row === undefined) fail(`${provider.owner} content dependency: outside the owner's partition`);
    if (!isChangeableOwnerArtifact(row)) fail(`${provider.owner} content dependency: not a regular content file`);
    if (tokens.has(token)) fail(`${provider.owner} content dependency: repeated token`);
    tokens.add(token);
  }
  return tokens;
}

/**
 * The tokens whose bytes the executor sends as input blobs: every installed owner's declared
 * dependencies, in token order. An absent owner's provider is never consulted.
 */
export function ownerContentDependencies(registry: OwnerUpdateRegistryV1, snapshot: PlannerManifestSnapshotV1): readonly PlannerPathTokenV1[] {
  const tokens = new Set<string>();
  for (const owner of installedOwnersOf(snapshot)) for (const token of dependenciesOf(providerFor(registry, owner), snapshot)) tokens.add(token);
  return snapshot.artifacts.map((row) => row.token).filter((token) => tokens.has(token));
}

/** For owners that declare no content dependency. */
export function keepOwnerUpdateProvider(owner: ArtifactOwner): OwnerUpdateProviderV1 {
  return Object.freeze({ owner, contentDependencies: () => [] });
}
