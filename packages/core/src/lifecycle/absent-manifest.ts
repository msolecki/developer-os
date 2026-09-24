/**
 * Spec 1 §6's absent-manifest inventory (amended 2026-09-17, A2/A3/A12/A13).
 * One bounded no-follow walk from the product home's parent-guarded entry
 * decides whether the home is one of four closed shapes, and nothing else:
 * deleting the non-manifest redaction key is only safe when the complete tree
 * proves no other product artifact remains. Everything the walk admits beside
 * a shape — the exact bootstrap leaf, inert retained bootstrap evidence with
 * the directories that exist only to hold it, and §2.1's bookkeeping set — is
 * projected away and left in place; every other entry preserves the tree and
 * is recovery-required.
 *
 * The module reads no file content, hashes no key byte, spawns nothing and
 * mutates nothing: it takes the guarded port, the effective uid, two paths and
 * the evidence, and returns what it saw.
 */
import { SCHEDULED_JOB_IDS } from "../config/lifecycle.js";
import { HOOK_FIRING_RECORDS_RELATIVE_PATH, inspectHookFiringRecordsShape } from "../hooks/firing-records.js";
import {
  CODEX_INGEST_AUTH_LINK,
  CODEX_INGEST_HOME_RELATIVE_PATH,
  inspectCodexIngestHomeShape,
} from "./codex-ingest-home.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import type { LowerHexSha256, UInt64DecimalV1 } from "../update/scalars.js";
import {
  inspectLifecycleBookkeepingShape,
  lifecycleBookkeepingPaths,
  type LifecycleBookkeepingObservationV1,
  type LifecycleBookkeepingResidueV1,
} from "./bookkeeping.js";
import { hashCanonicalJson } from "./canonical-json.js";
import {
  LifecycleRecoveryRequiredError,
  lifecycleParentPath,
  refuseLifecycleRecovery,
  type LifecycleGuardedEntryV1,
  type LifecycleGuardedFileSystemV1,
  type LifecycleGuardedKindV1,
} from "./guarded-fs.js";

export type AbsentManifestShapeV1 =
  | "product_home_absent"
  | "product_home_empty"
  | "state_empty"
  | "state_key_only";

export interface AbsentManifestEvidenceV1 extends LifecycleBookkeepingResidueV1 {
  /** Every persisted bootstrap lock identity of every retained envelope. */
  readonly bootstrapIdentities: readonly {
    readonly dev: UInt64DecimalV1;
    readonly ino: UInt64DecimalV1;
  }[];
  /** Spec 2 §6.4: any active or ambiguous residue. */
  readonly activeOrAmbiguous: boolean;
}

export interface AbsentManifestInspectionV1 {
  readonly shape: AbsentManifestShapeV1;
  readonly key: LifecycleGuardedEntryV1 | null;
  readonly bootstrapLeaf: LifecycleGuardedEntryV1 | null;
  readonly walkFingerprint: LowerHexSha256;
  readonly visitedEntries: number;
}

export const ABSENT_MANIFEST_WALK_BOUNDS: {
  readonly entries: 1_000_000;
  readonly components: 128;
  readonly pathBytes: 4096;
} = { entries: 1_000_000, components: 128, pathBytes: 4096 };

export interface AbsentManifestDependenciesV1 {
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly effectiveUid: number;
  readonly productHome: CanonicalAbsolutePathV1;
  readonly userHome: CanonicalAbsolutePathV1;
  readonly evidence: AbsentManifestEvidenceV1;
}

/**
 * A12 spec §3.2 (Spec 1 §6 amendment): the user's instruction overrides are
 * user data, never residue. The subtree is still walked with the same bounds
 * and entry rules; only its classification changes.
 */
export const USER_DATA_HOME_ENTRIES: readonly ["instructions"] = ["instructions"];

const WALK_DOMAIN = "developer-os:absent-manifest-walk:v1";
const STATE_RELATIVE_PATH = "state";
const KEY_RELATIVE_PATH = "state/redaction.key";
const BOOTSTRAP_LEAF_RELATIVE_PATH = "state/.lifecycle-bootstrap.lock";
const KEY_MINIMUM_BYTES = 32n;
const KEY_MAXIMUM_BYTES = 1_048_576n;

/** Node renders every byte of a name that is not valid UTF-8 as U+FFFD, and an unpaired surrogate survives as itself. */
const UNSAFE_NAME = /[/\\�\uD800-\uDFFF]/u;

type WalkRowV1 = readonly [
  string,
  LifecycleGuardedKindV1,
  number,
  number,
  number,
  UInt64DecimalV1,
  UInt64DecimalV1,
  UInt64DecimalV1,
];

interface WalkV1 {
  readonly rows: WalkRowV1[];
  readonly tree: Map<string, LifecycleGuardedEntryV1>;
}

function componentsOf(path: string): number {
  return path.slice(1).split("/").length;
}

function rowOf(productHome: string, entry: LifecycleGuardedEntryV1): WalkRowV1 {
  return [
    entry.path.slice(productHome.length + 1),
    entry.kind,
    entry.ownerUid,
    entry.mode,
    entry.nlink,
    entry.size,
    entry.dev,
    entry.ino,
  ];
}

/**
 * Unsigned UTF-8 byte order is code-point order. JavaScript's `<` compares
 * UTF-16 code units, which sorts a supplementary-plane name before U+E000..U+FFFF.
 */
function compareCodePoints(first: string, second: string): number {
  let here = 0;
  let there = 0;
  while (here < first.length && there < second.length) {
    const leading = first.codePointAt(here);
    const trailing = second.codePointAt(there);
    if (leading === undefined || trailing === undefined) break;
    if (leading !== trailing) return leading - trailing;
    here += leading > 0xffff ? 2 : 1;
    there += trailing > 0xffff ? 2 : 1;
  }
  return first.length - here - (second.length - there);
}

function walkFingerprintOf(rows: readonly WalkRowV1[]): LowerHexSha256 {
  return hashCanonicalJson(
    WALK_DOMAIN,
    [...rows].sort((left, right) => compareCodePoints(left[0], right[0])),
  );
}

async function readDirectoryNames(
  fs: LifecycleGuardedFileSystemV1,
  directory: LifecycleGuardedEntryV1,
): Promise<ReadonlySet<string>> {
  const names = new Set<string>();
  let yielded = 0;
  for await (const name of fs.names(directory)) {
    yielded += 1;
    if (
      name.length === 0 ||
      name === "." ||
      name === ".." ||
      name.includes("\u0000") ||
      UNSAFE_NAME.test(name)
    ) {
      refuseLifecycleRecovery("absent_manifest_name", `${directory.path}/${name}`);
    }
    names.add(name);
  }
  if (names.size !== yielded) refuseLifecycleRecovery("absent_manifest_name", directory.path);
  return names;
}

async function readDirectoryTwice(
  fs: LifecycleGuardedFileSystemV1,
  directory: LifecycleGuardedEntryV1,
): Promise<ReadonlySet<string>> {
  const first = await readDirectoryNames(fs, directory);
  const second = await readDirectoryNames(fs, directory);
  if (first.size !== second.size) {
    refuseLifecycleRecovery("absent_manifest_walk_race", directory.path);
  }
  for (const name of first) {
    if (!second.has(name)) {
      refuseLifecycleRecovery("absent_manifest_walk_race", `${directory.path}/${name}`);
    }
  }
  return first;
}

function childPathOf(
  directory: CanonicalAbsolutePathV1,
  name: string,
  components: number,
): CanonicalAbsolutePathV1 {
  const text = `${directory}/${name}`;
  if (components > ABSENT_MANIFEST_WALK_BOUNDS.components) {
    refuseLifecycleRecovery("absent_manifest_bound", text);
  }
  if (Buffer.byteLength(text, "utf8") > ABSENT_MANIFEST_WALK_BOUNDS.pathBytes) {
    refuseLifecycleRecovery("absent_manifest_bound", text);
  }
  try {
    return parseCanonicalAbsolutePathText(text);
  } catch {
    return refuseLifecycleRecovery("absent_manifest_name", text);
  }
}

function admitWalkEntry(dependencies: AbsentManifestDependenciesV1, entry: LifecycleGuardedEntryV1): void {
  const { effectiveUid, productHome } = dependencies;
  /** D52: the one symlink a product home holds; its shape is judged with `state/codex-ingest-home`. */
  const codexAuthLink = `${productHome}/${CODEX_INGEST_HOME_RELATIVE_PATH}/${CODEX_INGEST_AUTH_LINK}`;
  if (entry.kind === "symlink" && entry.path === codexAuthLink) {
    if (entry.ownerUid !== effectiveUid) refuseLifecycleRecovery("absent_manifest_owner", entry.path);
    return;
  }
  if (entry.kind !== "regular_file" && entry.kind !== "directory") {
    refuseLifecycleRecovery("absent_manifest_kind", entry.path);
  }
  if (entry.ownerUid !== effectiveUid) {
    refuseLifecycleRecovery("absent_manifest_owner", entry.path);
  }
  if (entry.kind === "regular_file" && entry.nlink !== 1) {
    refuseLifecycleRecovery("absent_manifest_link", entry.path);
  }
}

/**
 * Every visited entry is classified on its own path. A subtree below a retained
 * directory is not muted: §6's inventory is exhaustive "rather than a checklist
 * of selected known paths", and the producer names every descendant it retains,
 * so an unnamed entry beside retained evidence is exactly the residue this
 * refuses on.
 */
async function walkDirectory(
  dependencies: AbsentManifestDependenciesV1,
  walk: WalkV1,
  directory: LifecycleGuardedEntryV1,
  components: number,
): Promise<void> {
  const names = await readDirectoryTwice(dependencies.fs, directory);
  for (const name of names) {
    const path = childPathOf(directory.path, name, components + 1);
    const entry = await dependencies.fs.lstat(path);
    if (entry === null) refuseLifecycleRecovery("absent_manifest_walk_race", path);
    admitWalkEntry(dependencies, entry);
    if (walk.rows.length >= ABSENT_MANIFEST_WALK_BOUNDS.entries) {
      refuseLifecycleRecovery("absent_manifest_bound", path);
    }
    walk.rows.push(rowOf(dependencies.productHome, entry));
    walk.tree.set(path, entry);
    if (entry.kind === "directory") {
      await walkDirectory(dependencies, walk, entry, components + 1);
    }
  }
}

function observationOf(
  entry: LifecycleGuardedEntryV1 | undefined,
  childNames: readonly string[],
): LifecycleBookkeepingObservationV1 {
  if (entry === undefined) return { kind: "other" };
  if (entry.kind === "directory") {
    return { kind: "directory", ownerUid: entry.ownerUid, mode: entry.mode, childNames };
  }
  if (entry.kind === "regular_file") {
    return {
      kind: "regular_file",
      ownerUid: entry.ownerUid,
      mode: entry.mode,
      nlink: entry.nlink,
      size: BigInt(entry.size),
    };
  }
  return { kind: "other" };
}

function resolveBootstrapLeaf(
  dependencies: AbsentManifestDependenciesV1,
  tree: ReadonlyMap<string, LifecycleGuardedEntryV1>,
): LifecycleGuardedEntryV1 | null {
  const entry = tree.get(`${dependencies.productHome}/${BOOTSTRAP_LEAF_RELATIVE_PATH}`);
  if (entry === undefined) return null;
  if (entry.kind !== "regular_file" || entry.mode !== 0o600 || entry.nlink !== 1) return null;
  if (BigInt(entry.size) !== 0n) return null;
  const attributed = dependencies.evidence.bootstrapIdentities.some(
    (identity) => identity.dev === entry.dev && identity.ino === entry.ino,
  );
  if (attributed) refuseLifecycleRecovery("absent_manifest_bootstrap_identity", entry.path);
  return entry;
}

/**
 * Indexed once, not searched per directory. A home is bounded only by the
 * million-entry cap, so scanning the retained set or the tree inside the
 * per-directory loop makes a doomed home take minutes to refuse — the cost
 * `excludedRoots` already paid for carrying every retained path
 * (`apps/cli/src/commands/uninstall.test.ts`).
 */
function childIndexOf(
  tree: ReadonlyMap<string, LifecycleGuardedEntryV1>,
): ReadonlyMap<string, string[]> {
  const index = new Map<string, string[]>();
  for (const path of tree.keys()) {
    const parent = path.slice(0, path.lastIndexOf("/"));
    const siblings = index.get(parent);
    if (siblings === undefined) index.set(parent, [path]);
    else siblings.push(path);
  }
  return index;
}

function retainedAncestorsOf(retainedPaths: ReadonlySet<string>): ReadonlySet<string> {
  const ancestors = new Set<string>();
  for (const retained of retainedPaths) {
    let boundary = retained.lastIndexOf("/");
    while (boundary > 0) {
      const ancestor = retained.slice(0, boundary);
      if (ancestors.has(ancestor)) break;
      ancestors.add(ancestor);
      boundary = ancestor.lastIndexOf("/");
    }
  }
  return ancestors;
}

/**
 * Stops where the bookkeeping shape stopped: `bookkeeping.ts` admits a retained
 * child without descending into it, so descending here would project entries it
 * never inspected. Rule 2 has already projected every descendant the evidence
 * names; an unnamed one below a retained directory is residue.
 */
function projectSubtree(
  childIndex: ReadonlyMap<string, string[]>,
  root: string,
  retainedPaths: ReadonlySet<string>,
  projected: Set<string>,
): void {
  const pending = [root];
  while (pending.length > 0) {
    const path = pending.pop();
    if (path === undefined) continue;
    projected.add(path);
    if (retainedPaths.has(path)) continue;
    for (const child of childIndex.get(path) ?? []) pending.push(child);
  }
}

interface ProjectionV1 {
  readonly tree: ReadonlyMap<string, LifecycleGuardedEntryV1>;
  readonly childIndex: ReadonlyMap<string, string[]>;
  readonly retainedAncestors: ReadonlySet<string>;
  readonly stateDirectory: string;
  readonly projected: Set<string>;
}

/**
 * Post-order, so a directory that exists only to hold retained evidence
 * projects after the directories it holds. An empty one never does: `state`
 * apart, §6 refuses an unrecognized empty directory, and stale evidence naming
 * a child that is already gone must not turn one into residue-free.
 */
function projectRetainedAncestors(projection: ProjectionV1, directory: string): void {
  const children = projection.childIndex.get(directory) ?? [];
  for (const child of children) {
    if (projection.tree.get(child)?.kind === "directory") {
      projectRetainedAncestors(projection, child);
    }
  }
  if (directory === projection.stateDirectory || projection.projected.has(directory)) return;
  if (!projection.retainedAncestors.has(directory) || children.length === 0) return;
  if (children.every((child) => projection.projected.has(child))) {
    projection.projected.add(directory);
  }
}

/** `state` holds the shapes apart, so no rule here projects it away. */
function projectionOf(
  dependencies: AbsentManifestDependenciesV1,
  tree: ReadonlyMap<string, LifecycleGuardedEntryV1>,
  bootstrapLeaf: LifecycleGuardedEntryV1 | null,
): ReadonlySet<string> {
  const { evidence, productHome } = dependencies;
  const stateDirectory = `${productHome}/${STATE_RELATIVE_PATH}`;
  const childIndex = childIndexOf(tree);
  const childNamesOf = (path: string): readonly string[] =>
    (childIndex.get(path) ?? []).map((child) => child.slice(path.length + 1));
  const projected = new Set<string>();
  if (bootstrapLeaf !== null) projected.add(bootstrapLeaf.path);
  for (const path of tree.keys()) {
    if (path !== stateDirectory && evidence.retainedPaths.has(path)) projected.add(path);
  }
  for (const path of lifecycleBookkeepingPaths(productHome)) {
    if (!tree.has(path)) continue;
    const result = inspectLifecycleBookkeepingShape(
      productHome,
      path,
      (candidate) => observationOf(tree.get(candidate), childNamesOf(candidate)),
      dependencies.effectiveUid,
      evidence,
    );
    if (!result.admitted) {
      refuseLifecycleRecovery("absent_manifest_bookkeeping", result.offendingPath);
    }
    projectSubtree(childIndex, path, evidence.retainedPaths, projected);
  }
  const hooks = `${productHome}/${HOOK_FIRING_RECORDS_RELATIVE_PATH}`;
  if (tree.has(hooks)) {
    const result = inspectHookFiringRecordsShape(
      observationOf(tree.get(hooks), childNamesOf(hooks)),
      (name) => observationOf(tree.get(`${hooks}/${name}`), childNamesOf(`${hooks}/${name}`)),
      dependencies.effectiveUid,
    );
    if (!result.admitted) {
      refuseLifecycleRecovery(
        "hook_records_shape",
        result.offendingName === null ? hooks : `${hooks}/${result.offendingName}`,
      );
    }
    projectSubtree(childIndex, hooks, new Set(), projected);
  }
  /** D52: a present `state/codex-ingest-home` is admitted by shape, like `state/hooks`. */
  const codexIngestHome = `${productHome}/${CODEX_INGEST_HOME_RELATIVE_PATH}`;
  if (tree.has(codexIngestHome)) {
    const result = inspectCodexIngestHomeShape(
      tree.get(codexIngestHome) ?? null,
      childNamesOf(codexIngestHome),
      (name) => tree.get(`${codexIngestHome}/${name}`) ?? null,
      dependencies.effectiveUid,
    );
    if (!result.admitted) {
      refuseLifecycleRecovery(
        "codex_ingest_home_shape",
        result.offendingName === null ? codexIngestHome : `${codexIngestHome}/${result.offendingName}`,
      );
    }
    projectSubtree(childIndex, codexIngestHome, new Set(), projected);
  }
  for (const name of USER_DATA_HOME_ENTRIES) {
    const path = `${productHome}/${name}`;
    const entry = tree.get(path);
    if (entry === undefined) continue;
    if (entry.kind !== "directory") refuseLifecycleRecovery("absent_manifest_user_data", path);
    projectSubtree(childIndex, path, new Set(), projected);
  }
  const projection: ProjectionV1 = {
    tree,
    childIndex,
    retainedAncestors: retainedAncestorsOf(evidence.retainedPaths),
    stateDirectory,
    projected,
  };
  for (const child of childIndex.get(productHome) ?? []) {
    if (tree.get(child)?.kind === "directory") projectRetainedAncestors(projection, child);
  }
  return projected;
}

function admitKey(entry: LifecycleGuardedEntryV1): LifecycleGuardedEntryV1 {
  if (entry.kind !== "regular_file" || entry.mode !== 0o600) {
    refuseLifecycleRecovery("absent_manifest_key", entry.path);
  }
  const size = BigInt(entry.size);
  if (size < KEY_MINIMUM_BYTES || size > KEY_MAXIMUM_BYTES) {
    refuseLifecycleRecovery("absent_manifest_key", entry.path);
  }
  return entry;
}

function classifyRemainder(
  dependencies: AbsentManifestDependenciesV1,
  tree: ReadonlyMap<string, LifecycleGuardedEntryV1>,
  projected: ReadonlySet<string>,
): { readonly shape: AbsentManifestShapeV1; readonly key: LifecycleGuardedEntryV1 | null } {
  const { productHome } = dependencies;
  const remainder = [...tree.keys()]
    .filter((path) => !projected.has(path))
    .sort(compareCodePoints);
  if (remainder.length === 0) return { shape: "product_home_empty", key: null };
  const stateDirectory = `${productHome}/${STATE_RELATIVE_PATH}`;
  const state = tree.get(stateDirectory);
  if (
    remainder[0] !== stateDirectory ||
    state === undefined ||
    state.kind !== "directory" ||
    state.mode !== 0o700
  ) {
    /** A whole product home can be unprojected, and spreading that many arguments is a `RangeError`, not a refusal. */
    throw new LifecycleRecoveryRequiredError("absent_manifest_residue", remainder);
  }
  if (remainder.length === 1) return { shape: "state_empty", key: null };
  const keyPath = `${productHome}/${KEY_RELATIVE_PATH}`;
  const key = tree.get(keyPath);
  if (remainder.length !== 2 || remainder[1] !== keyPath || key === undefined) {
    throw new LifecycleRecoveryRequiredError("absent_manifest_residue", remainder);
  }
  return { shape: "state_key_only", key: admitKey(key) };
}

export async function inspectAbsentManifestProductHome(
  dependencies: AbsentManifestDependenciesV1,
): Promise<AbsentManifestInspectionV1> {
  const { fs, effectiveUid, productHome, userHome, evidence } = dependencies;
  if (evidence.activeOrAmbiguous) {
    refuseLifecycleRecovery("absent_manifest_active_residue", productHome);
  }
  for (const job of SCHEDULED_JOB_IDS) {
    const text = `${userHome}/Library/LaunchAgents/com.developer-os.${job}.plist`;
    let plist: CanonicalAbsolutePathV1;
    try {
      plist = parseCanonicalAbsolutePathText(text);
    } catch {
      /** A home that cannot spell the plist path is a home whose plists cannot be proven absent. */
      return refuseLifecycleRecovery("absent_manifest_external_plist", text);
    }
    if ((await fs.lstat(plist)) !== null) {
      refuseLifecycleRecovery("absent_manifest_external_plist", plist);
    }
  }
  const parentPath = lifecycleParentPath(productHome);
  const parent = await fs.lstat(parentPath);
  if (parent === null || parent.kind !== "directory" || parent.ownerUid !== effectiveUid) {
    refuseLifecycleRecovery("absent_manifest_parent", parentPath);
  }
  const home = await fs.lstat(productHome);
  if (home === null) {
    return {
      shape: "product_home_absent",
      key: null,
      bootstrapLeaf: null,
      walkFingerprint: walkFingerprintOf([]),
      visitedEntries: 0,
    };
  }
  if (home.kind !== "directory" || home.ownerUid !== effectiveUid || home.mode !== 0o700) {
    refuseLifecycleRecovery("absent_manifest_home", productHome);
  }
  const walk: WalkV1 = { rows: [], tree: new Map() };
  await walkDirectory(dependencies, walk, home, componentsOf(productHome));
  const bootstrapLeaf = resolveBootstrapLeaf(dependencies, walk.tree);
  const projected = projectionOf(dependencies, walk.tree, bootstrapLeaf);
  const { shape, key } = classifyRemainder(dependencies, walk.tree, projected);
  return {
    shape,
    key,
    bootstrapLeaf,
    walkFingerprint: walkFingerprintOf(walk.rows),
    visitedEntries: walk.rows.length,
  };
}
