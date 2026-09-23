import { encodeCanonicalJson, type CanonicalJsonValue } from "../lifecycle/canonical-json.js";
import type { ArtifactOwner } from "../manifest/types.js";
import { admitOwnerRelativePath, parseCanonicalAbsolutePathText, parseVaultRelativePathText, type CanonicalAbsolutePathV1, type CanonicalPathEvidenceV1, type OwnerRelativePathV1 } from "./paths.js";
import type {
  OwnerExternalEffectDraftV1,
  OwnerUpdateDraftV1,
  PlannerArtifactInputV1,
  PlannerChangePlanOperationV1,
  PlannerContentRefV1,
  PlannerManifestArtifactV1,
  PlannerManifestSnapshotV1,
  PlannerPathTokenV1,
  UpdatePlannerRequestV1,
} from "./planner.js";
import { compareUtf8, parseBundleRelativePath } from "./release.js";
import { parseLowerHexSha256 } from "./scalars.js";

/** Spec 2 §8.3: the closed owner enum, in the canonical order every registry and plan list follows. */
export const OWNER_UPDATE_ORDER: readonly ArtifactOwner[] = Object.freeze(["core", "claude", "codex", "macos"]);

/** Spec 2 §8.2: a changed file travels as one blob, so no create or replace may exceed one blob. */
export const MAX_OWNER_CHANGED_FILE_BYTES = 16_777_216;

export type OwnerTargetContentRefV1 = Extract<PlannerContentRefV1, { readonly kind: "target_bundle" }>;

/**
 * One file the target release ships for an owner: where it lands relative to that owner's
 * closed root, and the public signed bundle entry that supplies its bytes.
 */
export interface OwnerTargetEntryV1 {
  readonly path: OwnerRelativePathV1;
  readonly content: OwnerTargetContentRefV1;
}

/** Everything one provider sees: its own partition and target tree, never a root or another owner's rows. */
export interface OwnerUpdateProviderRequestV1 {
  readonly owner: ArtifactOwner;
  readonly manifest: PlannerManifestSnapshotV1;
  readonly artifacts: readonly PlannerArtifactInputV1[];
  readonly target: readonly OwnerTargetEntryV1[];
}

export interface OwnerUpdateProviderV1 {
  readonly owner: ArtifactOwner;
  readonly contentDependencies: (snapshot: PlannerManifestSnapshotV1) => readonly PlannerPathTokenV1[];
  readonly plan: (request: OwnerUpdateProviderRequestV1) => OwnerUpdateDraftV1;
}

declare const ownerUpdateRegistryV1: unique symbol;

/** Exactly one provider per closed owner, in owner order. Only `createOwnerUpdateRegistry` mints it. */
export type OwnerUpdateRegistryV1 = readonly OwnerUpdateProviderV1[] & { readonly [ownerUpdateRegistryV1]: true };

/** The planner request plus each installed owner's target tree, as the target bundle inventories it. */
export interface OwnerPlanningSnapshotV1 {
  readonly request: UpdatePlannerRequestV1;
  readonly targets: Readonly<Partial<Record<ArtifactOwner, readonly OwnerTargetEntryV1[]>>>;
}

/** The current executor's in-memory authority for one owner; it never crosses the wire. */
export interface OwnerRehydrationContextV1 {
  readonly ownerRoot: CanonicalAbsolutePathV1;
  readonly tokenPaths: ReadonlyMap<PlannerPathTokenV1, CanonicalAbsolutePathV1>;
  readonly evidence: CanonicalPathEvidenceV1;
}

function fail(label: string): never {
  throw new Error(`invalid ${label}`);
}

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

/**
 * Calls exactly one provider per installed owner, in owner order, and validates each draft.
 * A token may change only when its provider declared it a content dependency and the request
 * carries its bytes; at most one external effect exists across the whole update.
 */
export function planOwners(registry: OwnerUpdateRegistryV1, snapshot: OwnerPlanningSnapshotV1): readonly OwnerUpdateDraftV1[] {
  const { request } = snapshot;
  if (!same(installedOwnersOf(request.manifest), request.installedOwners)) fail("planOwners: installed owners differ from the manifest");
  const inputs = new Map(request.artifactInputs.map((input) => [input.token as string, input]));
  let effects = 0;
  const drafts = request.installedOwners.map((owner): OwnerUpdateDraftV1 => {
    const provider = providerFor(registry, owner);
    const dependencies = dependenciesOf(provider, request.manifest);
    const draft = validateOwnerDraft(
      provider.plan({ owner, manifest: request.manifest, artifacts: request.artifactInputs.filter((input) => input.owner === owner), target: snapshot.targets[owner] ?? [] }),
      request.manifest,
    );
    if (draft.owner !== owner) fail("planOwners: a provider answered for another owner");
    for (const operation of draft.proposedOperations) {
      if (operation.operation === "create" || operation.operation === "keep") continue;
      const input = inputs.get(operation.target.token);
      if (!dependencies.has(operation.target.token) || input?.observed.state !== "content" || input.observed.blob === null) {
        fail("planOwners: a changed artifact is not a declared content dependency with bytes");
      }
    }
    effects += draft.externalEffects.length;
    if (effects > 1) fail("planOwners: a second external effect");
    return draft;
  });
  return drafts;
}

/**
 * Spec 2 §8.3's first-party diff for owners that ship whole files: an installed content file
 * whose `source` names a target entry is kept on an equal hash and replaced otherwise, one the
 * target no longer ships is removed, and a new entry is created. Every other row is kept.
 */
export function planOwnedFileTree(request: OwnerUpdateProviderRequestV1): readonly PlannerChangePlanOperationV1[] {
  const target = new Map<string, OwnerTargetEntryV1>();
  let prior: string | undefined;
  for (const entry of request.target) {
    const path = parseVaultRelativePathText(entry.path);
    if (prior !== undefined && compareUtf8(prior, path) >= 0) fail("OwnerTargetEntryV1.path: not unique and sorted");
    prior = path;
    const key = folded(path);
    if (target.has(key)) fail("OwnerTargetEntryV1.path: folded duplicate");
    checkContent(entry.content, "OwnerTargetEntryV1.content");
    target.set(key, entry);
  }
  const manifest = new Map(request.manifest.artifacts.map((row) => [row.token as string, row]));
  const operations: PlannerChangePlanOperationV1[] = [];
  const matched = new Set<string>();
  for (const row of request.artifacts) {
    const key = folded(row.source);
    const entry = target.get(key);
    if (entry !== undefined) matched.add(key);
    if (!isChangeableOwnerArtifact(row)) {
      if (entry !== undefined) fail("OwnerTargetEntryV1.path: collides with a keep-only artifact");
      continue;
    }
    const expectedHash = manifest.get(row.token)?.currentHash ?? fail("OwnerUpdateProviderRequestV1: a changeable artifact pins no manifest hash");
    const targetRef = { kind: "installed" as const, token: row.token };
    if (entry === undefined) operations.push({ operation: "remove", target: targetRef, expectedHash });
    else if (entry.content.sha256 !== expectedHash) operations.push({ operation: "replace", target: targetRef, expectedHash, content: entry.content });
  }
  for (const entry of request.target) {
    if (matched.has(folded(entry.path))) continue;
    operations.push({ operation: "create", target: { kind: "owner_relative", owner: request.owner, path: entry.path }, content: entry.content });
  }
  return operations;
}

/**
 * After root-free validation, rehydrates one owner's creates under its closed root. Each must be
 * canonically contained, alias no installed or other created path, and sit only under ancestors
 * that are kept directories — never under an installed file or a removed row.
 */
export function rehydrateOwnerCreates(
  draft: OwnerUpdateDraftV1,
  snapshot: PlannerManifestSnapshotV1,
  context: OwnerRehydrationContextV1,
): readonly CanonicalAbsolutePathV1[] {
  const validated = validateOwnerDraft(draft, snapshot);
  const removed = new Set(validated.proposedOperations.flatMap((operation) => (operation.operation === "remove" ? [operation.target.token as string] : [])));
  const installed = new Map<string, PlannerManifestArtifactV1>();
  for (const row of snapshot.artifacts) {
    const path = context.tokenPaths.get(row.token);
    if (path === undefined) fail("rehydrateOwnerCreates: token has no current path");
    const key = folded(path);
    if (installed.has(key)) fail("rehydrateOwnerCreates: two tokens alias one path");
    installed.set(key, row);
  }
  const created = new Set<string>();
  return validated.proposedOperations.flatMap((operation): CanonicalAbsolutePathV1[] => {
    if (operation.operation !== "create") return [];
    const relative = admitOwnerRelativePath(operation.target.path, context.ownerRoot, context.evidence);
    const absolute = parseCanonicalAbsolutePathText(`${context.ownerRoot}/${relative}`);
    const key = folded(absolute);
    if (installed.has(key) || created.has(key)) fail("rehydrateOwnerCreates: create collides with an existing path");
    created.add(key);
    const components = relative.split("/");
    for (let depth = 1; depth < components.length; depth += 1) {
      const ancestor = installed.get(folded(`${context.ownerRoot}/${components.slice(0, depth).join("/")}`));
      if (ancestor === undefined) continue;
      if (ancestor.kind !== "directory" || removed.has(ancestor.token)) fail("rehydrateOwnerCreates: parent is not a kept directory");
    }
    return [absolute];
  });
}

/** For owners whose target adds no file change: every current artifact stays byte-identical. */
export function keepOwnerUpdateProvider(owner: ArtifactOwner): OwnerUpdateProviderV1 {
  return Object.freeze({
    owner,
    contentDependencies: () => [],
    plan: (request: OwnerUpdateProviderRequestV1): OwnerUpdateDraftV1 => {
      // Dropping a shipped file silently would leave the target release incomplete.
      if (request.target.length > 0) fail(`${owner} provider: the target ships files this owner cannot plan`);
      return { owner, currentArtifacts: request.artifacts.map((artifact) => artifact.token), proposedOperations: [], externalEffects: [] };
    },
  });
}
