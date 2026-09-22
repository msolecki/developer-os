import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SCHEDULED_JOB_IDS } from "../config/lifecycle.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import { parseUInt64Decimal } from "../update/scalars.js";
import {
  ABSENT_MANIFEST_WALK_BOUNDS,
  inspectAbsentManifestProductHome,
  USER_DATA_HOME_ENTRIES,
  type AbsentManifestEvidenceV1,
  type AbsentManifestInspectionV1,
  type AbsentManifestShapeV1,
} from "./absent-manifest.js";
import { LIFECYCLE_BOOKKEEPING_RELATIVE_PATHS } from "./bookkeeping.js";
import { hashCanonicalJson, type CanonicalJsonValue } from "./canonical-json.js";
import {
  LifecycleRecoveryRequiredError,
  createNodeLifecycleGuardedFileSystem,
  type LifecycleGuardedEntryV1,
  type LifecycleGuardedFileSystemV1,
  type LifecycleGuardedKindV1,
} from "./guarded-fs.js";
import {
  createInMemoryLifecycleGuardedFileSystem,
  createLinkUnlinkRenameNoReplace,
} from "./testing.js";

const UID = process.getuid?.() ?? 0;
const PARENT = "/synthetic";
const HOME = "/synthetic/product";
const USER_HOME = "/synthetic/user";
const STATE = `${HOME}/state`;
const KEY = `${STATE}/redaction.key`;
const BOOTSTRAP_LEAF = `${STATE}/.lifecycle-bootstrap.lock`;
const RETAINED_ID = "bp_123e4567-e89b-42d3-a456-426614174000";
const PARTICIPANT = "tx_fi_123e4567-e89b-42d3-a456-426614174000_0000000000_f";
const WALK_DOMAIN = "developer-os:absent-manifest-walk:v1";
const SYNTHETIC_DEVICE = "16777234";
const homes: string[] = [];

afterEach(async () => {
  for (const home of homes.splice(0)) {
    await nodeFs.rm(home, { recursive: true, force: true });
  }
});

function retained(parent: string, ordinal: string): string {
  return `${parent}/.developer-os-retained.${RETAINED_ID}.${ordinal}.tombstone`;
}

function componentCount(path: string): number {
  return path.slice(1).split("/").length;
}

interface PlantV1 {
  readonly kind: LifecycleGuardedKindV1;
  readonly ownerUid: number;
  readonly mode: number;
  readonly nlink: number;
  readonly size: number;
}

function file(overrides: Partial<PlantV1> = {}): PlantV1 {
  return { kind: "regular_file", ownerUid: UID, mode: 0o600, nlink: 1, size: 0, ...overrides };
}

function directory(overrides: Partial<PlantV1> = {}): PlantV1 {
  return { kind: "directory", ownerUid: UID, mode: 0o700, nlink: 2, size: 0, ...overrides };
}

type DependenciesV1 = Parameters<typeof inspectAbsentManifestProductHome>[0];

interface RecordingPortV1 extends LifecycleGuardedFileSystemV1 {
  readonly readsOfContent: readonly string[];
  readonly mutations: readonly string[];
}

/** A path the walk must refuse before it could ever become a `CanonicalAbsolutePathV1`. */
function unparsedPath(text: string): CanonicalAbsolutePathV1 {
  return text as CanonicalAbsolutePathV1;
}

function recordingPort(
  lstat: (path: string) => LifecycleGuardedEntryV1 | null,
  names: (directory: LifecycleGuardedEntryV1) => AsyncGenerator<string>,
): RecordingPortV1 {
  const readsOfContent: string[] = [];
  const mutations: string[] = [];
  const mutation = (method: string): never => {
    mutations.push(method);
    throw new Error(`the absent-manifest inspection mutates nothing: ${method}`);
  };
  const content = (method: string, entry: LifecycleGuardedEntryV1): never => {
    readsOfContent.push(`${method} ${entry.path}`);
    throw new Error(`the absent-manifest inspection reads no content: ${entry.path}`);
  };
  return {
    readsOfContent,
    mutations,
    lstat: (path) => Promise.resolve(lstat(path)),
    names,
    readRegular: (entry) => content("readRegular", entry),
    hashRegular: (entry) => content("hashRegular", entry),
    writeExclusive: () => mutation("writeExclusive"),
    mkdirExclusive: () => mutation("mkdirExclusive"),
    renameOver: () => mutation("renameOver"),
    renameNoReplace: () => mutation("renameNoReplace"),
    unlinkExact: () => mutation("unlinkExact"),
    rmdirExactEmpty: () => mutation("rmdirExactEmpty"),
    syncDirectory: () => mutation("syncDirectory"),
  };
}

interface SyntheticHomeV1 {
  readonly fs: RecordingPortV1;
  readonly dependencies: DependenciesV1;
  readonly plants: ReadonlyMap<string, PlantV1>;
  readonly entryOf: (path: string) => LifecycleGuardedEntryV1;
}

function syntheticHome(options: {
  readonly plants: ReadonlyMap<string, PlantV1>;
  readonly evidence: AbsentManifestEvidenceV1;
  readonly reads?: ReadonlyMap<string, readonly (readonly string[])[]>;
  readonly productHome?: string;
}): SyntheticHomeV1 {
  const inos = new Map([...options.plants.keys()].map((path, index) => [path, String(index + 2)]));
  const entryOf = (path: string): LifecycleGuardedEntryV1 => {
    const plant = options.plants.get(path);
    if (plant === undefined) throw new Error(`the fixture planted nothing at ${path}`);
    return {
      path: unparsedPath(path),
      kind: plant.kind,
      ownerUid: plant.ownerUid,
      mode: plant.mode,
      nlink: plant.nlink,
      size: parseUInt64Decimal(String(plant.size)),
      dev: parseUInt64Decimal(SYNTHETIC_DEVICE),
      ino: parseUInt64Decimal(inos.get(path) ?? "0"),
    };
  };
  /** Indexed once: a per-read scan of every plant made a fifty-thousand-entry home the fixture's cost, not the walk's. */
  const index = new Map<string, string[]>();
  for (const path of options.plants.keys()) {
    const parent = path.slice(0, path.lastIndexOf("/"));
    const siblings = index.get(parent);
    if (siblings === undefined) index.set(parent, [path.slice(parent.length + 1)]);
    else siblings.push(path.slice(parent.length + 1));
  }
  const childNames = (path: string): readonly string[] => index.get(path) ?? [];
  const counts = new Map<string, number>();
  const fs = recordingPort(
    (path) => (options.plants.has(path) ? entryOf(path) : null),
    async function* stream(from) {
      const count = counts.get(from.path) ?? 0;
      counts.set(from.path, count + 1);
      const scripted = options.reads?.get(from.path)?.[count];
      for (const name of scripted ?? childNames(from.path)) yield await Promise.resolve(name);
    },
  );
  return {
    fs,
    entryOf,
    plants: options.plants,
    dependencies: {
      fs,
      effectiveUid: UID,
      productHome: unparsedPath(options.productHome ?? HOME),
      userHome: parseCanonicalAbsolutePathText(USER_HOME),
      evidence: options.evidence,
    },
  };
}

function evidenceOf(overrides: Partial<AbsentManifestEvidenceV1> = {}): AbsentManifestEvidenceV1 {
  return {
    retainedPaths: new Set(),
    bootstrapParticipantIds: new Set(),
    bootstrapIdentities: [],
    activeOrAmbiguous: false,
    ...overrides,
  };
}

const RETAINED_PATHS = [
  retained(HOME, "0000000000"),
  retained(`${HOME}/logs`, "0000000001"),
  retained(STATE, "0000000002"),
  `${retained(STATE, "0000000002")}/payload.json`,
  retained(`${HOME}/staging/transactions/${PARTICIPANT}`, "0000000003"),
] as const;

/**
 * The projections §6 admits beside each shape. The bootstrap leaf and the six
 * `state` bookkeeping paths exist only where `state` does, so the two shapes
 * without it carry only the projections their own shape can hold.
 */
function projectedPlants(shape: AbsentManifestShapeV1): ReadonlyMap<string, PlantV1> {
  const plants = new Map<string, PlantV1>();
  const withState = shape === "state_empty" || shape === "state_key_only";
  for (const relative of LIFECYCLE_BOOKKEEPING_RELATIVE_PATHS) {
    if (!withState && relative.startsWith("state")) continue;
    plants.set(`${HOME}/${relative}`, relative.endsWith(".lock") ? file() : directory());
  }
  plants.set(`${HOME}/staging/transactions/${PARTICIPANT}`, directory());
  plants.set(retained(`${HOME}/staging/transactions/${PARTICIPANT}`, "0000000003"), file({ size: 12 }));
  plants.set(retained(HOME, "0000000000"), file({ size: 9 }));
  plants.set(`${HOME}/logs`, directory());
  plants.set(retained(`${HOME}/logs`, "0000000001"), file({ size: 4 }));
  if (withState) {
    plants.set(`${STATE}/transactions/.${PARTICIPANT}.lock`, file());
    plants.set(BOOTSTRAP_LEAF, file());
    plants.set(retained(STATE, "0000000002"), directory());
    plants.set(`${retained(STATE, "0000000002")}/payload.json`, file({ size: 31 }));
  }
  return plants;
}

function shapePlants(
  shape: AbsentManifestShapeV1,
  extra: ReadonlyMap<string, PlantV1> = new Map(),
): Map<string, PlantV1> {
  const plants = new Map<string, PlantV1>([[PARENT, directory({ mode: 0o755 })]]);
  if (shape !== "product_home_absent") plants.set(HOME, directory());
  if (shape === "state_empty" || shape === "state_key_only") plants.set(STATE, directory());
  if (shape === "state_key_only") plants.set(KEY, file({ size: 64 }));
  for (const [path, plant] of extra) plants.set(path, plant);
  return plants;
}

function memoryHome(
  shape: AbsentManifestShapeV1,
  options: {
    readonly projections?: boolean;
    readonly extra?: ReadonlyMap<string, PlantV1>;
    readonly evidence?: Partial<AbsentManifestEvidenceV1>;
    readonly reads?: ReadonlyMap<string, readonly (readonly string[])[]>;
  } = {},
): SyntheticHomeV1 {
  const projections = (options.projections ?? false) && shape !== "product_home_absent";
  const plants = shapePlants(shape, options.extra);
  if (projections) {
    for (const [path, plant] of projectedPlants(shape)) plants.set(path, plant);
  }
  return syntheticHome({
    plants,
    evidence: evidenceOf({
      ...(projections
        ? { retainedPaths: new Set(RETAINED_PATHS), bootstrapParticipantIds: new Set([PARTICIPANT]) }
        : {}),
      ...options.evidence,
    }),
    ...(options.reads === undefined ? {} : { reads: options.reads }),
  });
}

function plantedUnderHome(home: SyntheticHomeV1): number {
  return [...home.plants.keys()].filter((path) => path.startsWith(`${HOME}/`)).length;
}

async function refusal(home: SyntheticHomeV1): Promise<LifecycleRecoveryRequiredError> {
  try {
    await inspectAbsentManifestProductHome(home.dependencies);
  } catch (error) {
    if (error instanceof LifecycleRecoveryRequiredError) return error;
    throw error;
  }
  throw new Error("the inspection admitted a home it must refuse");
}

describe("the four admitted absent-manifest shapes", () => {
  it.each([
    "product_home_absent",
    "product_home_empty",
    "state_empty",
    "state_key_only",
  ] as const)(
    "admits %s with the bootstrap leaf, inert evidence and the bookkeeping set projected away",
    async (shape) => {
      const home = memoryHome(shape, { projections: true });

      const inspection = await inspectAbsentManifestProductHome(home.dependencies);

      expect(inspection.shape).toBe(shape);
      expect(home.fs.readsOfContent).toStrictEqual([]);
      expect(home.fs.mutations).toStrictEqual([]);
      expect(inspection.visitedEntries).toBe(plantedUnderHome(home));
      expect(inspection.walkFingerprint).toMatch(/^[0-9a-f]{64}$/u);
      expect(inspection.key).toStrictEqual(shape === "state_key_only" ? home.entryOf(KEY) : null);
      expect(inspection.bootstrapLeaf).toStrictEqual(
        shape === "state_empty" || shape === "state_key_only" ? home.entryOf(BOOTSTRAP_LEAF) : null,
      );
    },
  );

  it("plants every path of the non-empty closed bookkeeping set", () => {
    const home = memoryHome("state_key_only", { projections: true });

    expect(LIFECYCLE_BOOKKEEPING_RELATIVE_PATHS.length).toBeGreaterThan(0);
    for (const relative of LIFECYCLE_BOOKKEEPING_RELATIVE_PATHS) {
      expect(home.plants.has(`${HOME}/${relative}`)).toBe(true);
    }
  });

  it("admits the global lock a rolled-back first init leaves beside an empty state", async () => {
    const home = memoryHome("state_empty", {
      extra: new Map([[`${STATE}/.lifecycle.lock`, file()]]),
    });

    const inspection = await inspectAbsentManifestProductHome(home.dependencies);

    expect(inspection.shape).toBe("state_empty");
    expect(inspection.visitedEntries).toBe(2);
    expect(home.fs.mutations).toStrictEqual([]);
  });

  it("projects away a directory that exists only to hold retained evidence", async () => {
    const home = memoryHome("state_empty", {
      extra: new Map([
        [`${HOME}/logs`, directory()],
        [retained(`${HOME}/logs`, "0000000001"), file({ size: 4 })],
      ]),
      evidence: { retainedPaths: new Set([retained(`${HOME}/logs`, "0000000001")]) },
    });

    const inspection = await inspectAbsentManifestProductHome(home.dependencies);

    expect(inspection.shape).toBe("state_empty");
    expect(inspection.visitedEntries).toBe(3);
  });

  it("refuses an entry beside retained evidence that the evidence never named", async () => {
    const tombstone = retained(STATE, "0000000002");
    const intruder = `${tombstone}/intruder.json`;
    const home = memoryHome("state_empty", {
      extra: new Map([
        [tombstone, directory()],
        [intruder, file({ size: 64 })],
      ]),
      evidence: { retainedPaths: new Set([tombstone]) },
    });

    const error = await refusal(home);

    expect(error.paths).toContain(intruder);
    expect(home.fs.mutations).toStrictEqual([]);
  });

  /** `bookkeeping.ts` admits a retained child *without descending*, so the projection may not descend either. */
  it("refuses an entry inside retained evidence a bookkeeping root admitted", async () => {
    const tombstone = retained(`${HOME}/staging/lifecycle`, "0000000004");
    const intruder = `${tombstone}/intruder.json`;
    const home = memoryHome("state_empty", {
      extra: new Map([
        [`${HOME}/staging`, directory()],
        [`${HOME}/staging/lifecycle`, directory()],
        [tombstone, directory()],
        [intruder, file({ size: 64 })],
      ]),
      evidence: { retainedPaths: new Set([tombstone]) },
    });

    const error = await refusal(home);

    expect(error.paths).toContain(intruder);
    expect(home.fs.mutations).toStrictEqual([]);
  });

  it("classifies state's children even when the evidence names state and the home", async () => {
    const intruder = `${STATE}/uninstalling.json`;
    const home = memoryHome("state_key_only", {
      extra: new Map([[intruder, file({ size: 64 })]]),
      evidence: { retainedPaths: new Set([HOME, STATE]) },
    });

    expect((await refusal(home)).paths).toContain(intruder);
  });

  it("never projects the state directory away, whatever the evidence names", async () => {
    const home = memoryHome("state_key_only", {
      evidence: { retainedPaths: new Set([HOME, STATE]) },
    });

    const inspection = await inspectAbsentManifestProductHome(home.dependencies);

    expect(inspection.shape).toBe("state_key_only");
    expect(inspection.key).toStrictEqual(home.entryOf(KEY));
  });

  it("refuses an empty directory a stale retained path still names", async () => {
    const home = memoryHome("state_empty", {
      extra: new Map([[`${HOME}/logs`, directory()]]),
      evidence: { retainedPaths: new Set([retained(`${HOME}/logs`, "0000000001")]) },
    });

    expect((await refusal(home)).paths).toContain(`${HOME}/logs`);
  });

  it("refuses a leaf whose identity a retained envelope persisted", async () => {
    const leaf = memoryHome("state_empty", {
      extra: new Map([[BOOTSTRAP_LEAF, file()]]),
    }).entryOf(BOOTSTRAP_LEAF);
    const home = memoryHome("state_empty", {
      extra: new Map([[BOOTSTRAP_LEAF, file()]]),
      evidence: { bootstrapIdentities: [{ dev: leaf.dev, ino: leaf.ino }] },
    });

    await expect(inspectAbsentManifestProductHome(home.dependencies)).rejects.toBeInstanceOf(
      LifecycleRecoveryRequiredError,
    );
    expect((await refusal(home)).paths).toStrictEqual([BOOTSTRAP_LEAF]);
    expect(home.fs.mutations).toStrictEqual([]);
  });

  it("refuses active or ambiguous retained residue before it reads anything", async () => {
    const home = memoryHome("state_key_only", {
      projections: true,
      evidence: { activeOrAmbiguous: true },
    });

    expect((await refusal(home)).reason).toBe("absent_manifest_active_residue");
    expect(home.fs.readsOfContent).toStrictEqual([]);
  });
});

describe("the closed external plist paths", () => {
  it.each(SCHEDULED_JOB_IDS)("refuses when the %s plist is present", async (job) => {
    const plist = `${USER_HOME}/Library/LaunchAgents/com.developer-os.${job}.plist`;
    const home = syntheticHome({
      plants: shapePlants("state_key_only", new Map([[plist, file({ size: 128 })]])),
      evidence: evidenceOf(),
    });

    const error = await refusal(home);

    expect(error.reason).toBe("absent_manifest_external_plist");
    expect(error.paths).toStrictEqual([plist]);
  });

  it("admits a key-only home when all four plists are absent", async () => {
    const home = memoryHome("state_key_only");

    expect(SCHEDULED_JOB_IDS.length).toBe(4);
    expect((await inspectAbsentManifestProductHome(home.dependencies)).shape).toBe("state_key_only");
  });
});

describe("every other known or unknown entry", () => {
  const unknown = [
    [`${HOME}/config.toml`, file({ size: 40 })],
    [`${STATE}/lifecycle-activation.json`, file({ size: 64 })],
    [`${STATE}/git-sync.json`, file({ size: 64 })],
    [`${STATE}/uninstalling.json`, file({ size: 64 })],
    [`${STATE}/automation-doctor.status.json`, file({ size: 64 })],
    [`${HOME}/logs/automation-doctor.0.json`, file({ size: 64 })],
    [`${STATE}/.automation-doctor.lock`, file()],
    [`${HOME}/installation-manifest.json`, file({ size: 512 })],
    [`${HOME}/.installation-manifest.mf_${RETAINED_ID}.json.tombstone`, file({ size: 512 })],
    [`${STATE}/lifecycle-install-nonce`, file({ size: 65 })],
    [`${STATE}/lifecycle-id-allocator.json`, file({ size: 96 })],
    [`${STATE}/transactions/tx_123e4567-e89b-42d3-a456-426614174000.json`, file({ size: 300 })],
    [`${HOME}/unrecognized`, directory()],
    [`${HOME}/logs`, directory()],
  ] as const;

  it("enumerates the known and unknown residue §6 names", () => {
    expect(unknown.length).toBeGreaterThan(0);
  });

  it.each(unknown)("refuses %s and names its path", async (path, plant) => {
    const extra = new Map<string, PlantV1>([[path, plant]]);
    if (path.startsWith(`${HOME}/logs/`)) extra.set(`${HOME}/logs`, directory());
    if (path.startsWith(`${STATE}/transactions/`)) extra.set(`${STATE}/transactions`, directory());
    const home = memoryHome("state_key_only", { extra });

    const error = await refusal(home);

    expect(error.paths).toContain(path);
    expect(home.fs.readsOfContent).toStrictEqual([]);
    expect(home.fs.mutations).toStrictEqual([]);
  });

  it("names the bookkeeping child whose shape the closed set refuses", async () => {
    const legacy = `${STATE}/transactions/tx_123e4567-e89b-42d3-a456-426614174000.json`;
    const home = memoryHome("state_empty", {
      projections: true,
      extra: new Map([[legacy, file({ size: 300 })]]),
    });

    expect((await refusal(home)).paths).toStrictEqual([legacy]);
  });
});

describe("the product home's instructions directory (A12 spec §3.2)", () => {
  const INSTRUCTIONS = `${HOME}/instructions`;
  const overrides = (): Map<string, PlantV1> =>
    new Map<string, PlantV1>([
      [INSTRUCTIONS, directory({ mode: 0o755 })],
      [`${INSTRUCTIONS}/claude`, directory({ mode: 0o755 })],
      [`${INSTRUCTIONS}/claude/rules`, directory({ mode: 0o755 })],
      [`${INSTRUCTIONS}/claude/rules/x.md`, file({ mode: 0o644, size: 12 })],
    ]);

  it("names exactly one user-data entry", () => {
    expect(USER_DATA_HOME_ENTRIES).toStrictEqual(["instructions"]);
  });

  it.each(["product_home_empty", "state_empty", "state_key_only"] as const)(
    "classifies the override tree as user data, not residue, beside %s",
    async (shape) => {
      const home = memoryHome(shape, { projections: true, extra: overrides() });

      const inspection = await inspectAbsentManifestProductHome(home.dependencies);

      expect(inspection.shape).toBe(shape);
      expect(inspection.visitedEntries).toBe(plantedUnderHome(home));
      expect(home.fs.readsOfContent).toStrictEqual([]);
      expect(home.fs.mutations).toStrictEqual([]);
    },
  );

  it("still walks the subtree: its entries change the walk fingerprint", async () => {
    const bare = await inspectAbsentManifestProductHome(memoryHome("state_empty").dependencies);
    const withOverrides = await inspectAbsentManifestProductHome(
      memoryHome("state_empty", { extra: overrides() }).dependencies,
    );

    expect(withOverrides.visitedEntries).toBe(bare.visitedEntries + overrides().size);
    expect(withOverrides.walkFingerprint).not.toBe(bare.walkFingerprint);
  });

  it.each([
    ["a symlink", `${INSTRUCTIONS}/claude/rules/link.md`, directory({ kind: "symlink", mode: 0o777 })],
    ["a hard-linked file", `${INSTRUCTIONS}/claude/rules/twin.md`, file({ nlink: 2 })],
    ["a foreign-owned file", `${INSTRUCTIONS}/claude/rules/foreign.md`, file({ ownerUid: UID + 1 })],
  ] as const)("still refuses %s inside it", async (_label, offending, plant) => {
    const extra = overrides();
    extra.set(offending, plant);
    const home = memoryHome("state_empty", { extra });

    const error = await refusal(home);

    expect(error.paths).toStrictEqual([offending]);
    expect(home.fs.mutations).toStrictEqual([]);
  });

  it("still applies the walk's component bound inside it", async () => {
    const extra = overrides();
    let path = INSTRUCTIONS;
    while (componentCount(path) <= ABSENT_MANIFEST_WALK_BOUNDS.components) {
      path = `${path}/d`;
      extra.set(path, directory());
    }
    const home = memoryHome("state_empty", { extra });

    expect((await refusal(home)).reason).toBe("absent_manifest_bound");
  });

  it("refuses an instructions entry that is a file, not a directory", async () => {
    const home = memoryHome("state_empty", {
      extra: new Map([[INSTRUCTIONS, file({ size: 3 })]]),
    });

    const error = await refusal(home);

    expect(error.paths).toStrictEqual([INSTRUCTIONS]);
    expect(home.fs.mutations).toStrictEqual([]);
  });

  it("admits no other name as user data", async () => {
    const home = memoryHome("state_empty", {
      extra: new Map([[`${HOME}/instructions-old`, directory()]]),
    });

    expect((await refusal(home)).paths).toContain(`${HOME}/instructions-old`);
  });
});

describe("the walk's identity and name rules", () => {
  it.each([
    ["a symlink", `${STATE}/link`, directory({ kind: "symlink", mode: 0o777 })],
    ["a hard-linked regular file", `${STATE}/twin`, file({ nlink: 2 })],
    ["a FIFO", `${STATE}/pipe`, file({ kind: "other" })],
    ["a foreign-owned directory", `${STATE}/foreign`, directory({ ownerUid: UID + 1 })],
  ] as const)("refuses %s before any content read", async (_label, offending, plant) => {
    const home = memoryHome("state_empty", { extra: new Map([[offending, plant]]) });

    const error = await refusal(home);

    expect(error.paths).toStrictEqual([offending]);
    expect(home.fs.readsOfContent).toStrictEqual([]);
    expect(home.fs.mutations).toStrictEqual([]);
  });

  /** Node renders each byte of an invalid UTF-8 directory name as U+FFFD. */
  it("refuses a name Node decoded from invalid UTF-8 bytes", async () => {
    const home = memoryHome("state_empty", {
      extra: new Map([[`${STATE}/na�me`, file()]]),
    });

    const error = await refusal(home);

    expect(error.reason).toBe("absent_manifest_name");
    expect(home.fs.readsOfContent).toStrictEqual([]);
  });

  it("refuses a name repeated inside one directory read", async () => {
    const home = memoryHome("state_empty", {
      extra: new Map([[`${STATE}/twice`, file()]]),
      reads: new Map([[STATE, [["twice", "twice"]]]]),
    });

    expect((await refusal(home)).reason).toBe("absent_manifest_name");
  });

  it.each([
    ["appearing", [["kept"], ["kept", "appeared"]]],
    ["disappearing", [["kept"], []]],
  ] as const)("refuses an entry %s between the two directory reads", async (_label, reads) => {
    const home = memoryHome("state_empty", {
      extra: new Map([[`${STATE}/kept`, file()]]),
      reads: new Map([[STATE, reads]]),
    });

    const error = await refusal(home);

    expect(error.reason).toBe("absent_manifest_walk_race");
    expect(home.fs.readsOfContent).toStrictEqual([]);
    expect(home.fs.mutations).toStrictEqual([]);
  });

  it("refuses a product home that is not an owner-only directory", async () => {
    const home = syntheticHome({
      plants: new Map([
        [PARENT, directory({ mode: 0o755 })],
        [HOME, directory({ mode: 0o750 })],
      ]),
      evidence: evidenceOf(),
    });

    expect((await refusal(home)).paths).toStrictEqual([HOME]);
  });

  it("refuses a product-home parent the effective user does not own", async () => {
    const home = syntheticHome({
      plants: new Map([
        [PARENT, directory({ mode: 0o755, ownerUid: UID + 1 })],
        [HOME, directory()],
      ]),
      evidence: evidenceOf(),
    });

    expect((await refusal(home)).paths).toStrictEqual([PARENT]);
  });
});

describe("the redaction key", () => {
  it("records the key by lstat alone", async () => {
    const home = memoryHome("state_key_only");

    const inspection = await inspectAbsentManifestProductHome(home.dependencies);

    expect(inspection.key).toStrictEqual(home.entryOf(KEY));
    expect(home.fs.readsOfContent).toStrictEqual([]);
    expect(home.fs.mutations).toStrictEqual([]);
  });

  it.each([
    ["a symlink", file({ kind: "symlink", size: 64 })],
    ["a directory", directory()],
    ["an nlink 2 file", file({ nlink: 2, size: 64 })],
    ["a group-readable file", file({ mode: 0o640, size: 64 })],
    ["a file below 32 bytes", file({ size: 31 })],
    ["a file above 1 MiB", file({ size: 1_048_577 })],
  ] as const)("refuses a key that is %s", async (_label, plant) => {
    const home = syntheticHome({
      plants: shapePlants("state_empty", new Map([[KEY, plant]])),
      evidence: evidenceOf(),
    });

    const error = await refusal(home);

    expect(error.paths).toStrictEqual([KEY]);
    expect(home.fs.readsOfContent).toStrictEqual([]);
  });
});

describe("the walk fingerprint", () => {
  function tupleOf(entry: LifecycleGuardedEntryV1): CanonicalJsonValue {
    return [
      entry.path.slice(HOME.length + 1),
      entry.kind,
      entry.ownerUid,
      entry.mode,
      entry.nlink,
      entry.size,
      entry.dev,
      entry.ino,
    ];
  }

  it("is equal for two walks of an unchanged home", async () => {
    const home = memoryHome("state_key_only", { projections: true });

    const first = await inspectAbsentManifestProductHome(home.dependencies);
    const second = await inspectAbsentManifestProductHome(home.dependencies);

    expect(first.visitedEntries).toBeGreaterThan(0);
    expect(second.walkFingerprint).toBe(first.walkFingerprint);
  });

  /**
   * Unsigned UTF-8 byte order is code-point order; JavaScript's `<` compares
   * UTF-16 code units, which puts a supplementary-plane name before U+FFEE.
   */
  it("sorts its entries by unsigned UTF-8 path bytes", async () => {
    const tombstone = retained(STATE, "0000000002");
    const supplementary = `${tombstone}/\u{1F600}`;
    const basic = `${tombstone}/￮`;
    const home = memoryHome("state_empty", {
      extra: new Map([
        [tombstone, directory()],
        [supplementary, file({ size: 1 })],
        [basic, file({ size: 2 })],
      ]),
      evidence: { retainedPaths: new Set([tombstone, supplementary, basic]) },
    });

    const inspection = await inspectAbsentManifestProductHome(home.dependencies);

    const utf8 = [STATE, tombstone, basic, supplementary].map((path) => tupleOf(home.entryOf(path)));
    const utf16 = [STATE, tombstone, supplementary, basic].map((path) => tupleOf(home.entryOf(path)));
    expect(inspection.visitedEntries).toBe(4);
    expect(inspection.walkFingerprint).toBe(hashCanonicalJson(WALK_DOMAIN, utf8));
    expect(inspection.walkFingerprint).not.toBe(hashCanonicalJson(WALK_DOMAIN, utf16));
  });

  it("covers a home with no entries at all", async () => {
    const home = memoryHome("product_home_absent");

    const inspection = await inspectAbsentManifestProductHome(home.dependencies);

    expect(inspection.visitedEntries).toBe(0);
    expect(inspection.walkFingerprint).toBe(hashCanonicalJson(WALK_DOMAIN, []));
  });
});

describe("the read-only dependency surface", () => {
  it("takes no process, clock or runner seam", async () => {
    const home = memoryHome("state_key_only", { projections: true });

    await inspectAbsentManifestProductHome(home.dependencies);

    expect(Object.keys(home.dependencies).sort()).toStrictEqual([
      "effectiveUid",
      "evidence",
      "fs",
      "productHome",
      "userHome",
    ]);
    expect(home.fs.mutations).toStrictEqual([]);
    expect(home.fs.readsOfContent).toStrictEqual([]);
  });
});

describe("the counting seam (A8)", () => {
  const encoder = new TextEncoder();

  function nodePort(): LifecycleGuardedFileSystemV1 {
    return createNodeLifecycleGuardedFileSystem({
      renameNoReplace: createLinkUnlinkRenameNoReplace().publish,
      effectiveUid: UID,
    });
  }

  async function buildSmallHome(
    fs: LifecycleGuardedFileSystemV1,
    productHome: CanonicalAbsolutePathV1,
  ): Promise<void> {
    const at = (relative: string): CanonicalAbsolutePathV1 =>
      parseCanonicalAbsolutePathText(`${productHome}/${relative}`);
    await fs.mkdirExclusive(productHome);
    await fs.mkdirExclusive(at("state"));
    for (const relative of LIFECYCLE_BOOKKEEPING_RELATIVE_PATHS) {
      if (relative.endsWith(".lock")) continue;
      await fs.mkdirExclusive(at(relative));
    }
    await fs.writeExclusive(at("state/.lifecycle.lock"), new Uint8Array(0));
    await fs.writeExclusive(at("state/.lifecycle-bootstrap.lock"), new Uint8Array(0));
    await fs.writeExclusive(at("state/redaction.key"), new Uint8Array(32));
    await fs.writeExclusive(
      at(`.developer-os-retained.${RETAINED_ID}.0000000000.tombstone`),
      encoder.encode("retained"),
    );
  }

  function entryShape(
    entry: LifecycleGuardedEntryV1 | null,
  ): Readonly<Record<string, unknown>> | null {
    if (entry === null) return null;
    const common = { path: entry.path, kind: entry.kind, ownerUid: entry.ownerUid, mode: entry.mode };
    return entry.kind === "directory" ? common : { ...common, nlink: entry.nlink, size: entry.size };
  }

  function agreement(inspection: AbsentManifestInspectionV1): Readonly<Record<string, unknown>> {
    return {
      shape: inspection.shape,
      visitedEntries: inspection.visitedEntries,
      key: entryShape(inspection.key),
      bootstrapLeaf: entryShape(inspection.bootstrapLeaf),
    };
  }

  it("agrees with the in-memory port on a small physical home", async () => {
    const created = await nodeFs.mkdtemp(join(tmpdir(), "developer-os-absent-manifest-"));
    homes.push(created);
    await nodeFs.chmod(created, 0o700);
    const parent = parseCanonicalAbsolutePathText(created);
    const productHome = parseCanonicalAbsolutePathText(`${created}/.developer-os`);
    const memory = createInMemoryLifecycleGuardedFileSystem({ effectiveUid: UID, root: parent });

    await buildSmallHome(nodePort(), productHome);
    await buildSmallHome(memory, productHome);

    const shared = {
      effectiveUid: UID,
      productHome,
      userHome: parent,
      evidence: evidenceOf({
        retainedPaths: new Set([
          `${productHome}/.developer-os-retained.${RETAINED_ID}.0000000000.tombstone`,
        ]),
      }),
    };
    const physical = await inspectAbsentManifestProductHome({ ...shared, fs: nodePort() });
    const counted = await inspectAbsentManifestProductHome({ ...shared, fs: memory });

    expect(physical.shape).toBe("state_key_only");
    expect(physical.visitedEntries).toBeGreaterThan(0);
    expect(physical.bootstrapLeaf).not.toBeNull();
    expect(agreement(counted)).toStrictEqual(agreement(physical));
    expect(counted.walkFingerprint).toMatch(/^[0-9a-f]{64}$/u);
  });

  function boundHome(dimension: "components" | "pathBytes", value: number): SyntheticHomeV1 {
    const home = "/s/h";
    const tombstone = `${home}/state/.t`;
    const plants = new Map<string, PlantV1>([
      ["/s", directory({ mode: 0o755 })],
      [home, directory()],
      [`${home}/state`, directory()],
      [tombstone, directory()],
    ]);
    const retainedPaths = new Set([tombstone]);
    const plant = (path: string, planted: PlantV1): void => {
      plants.set(path, planted);
      retainedPaths.add(path);
    };
    let current = tombstone;
    if (dimension === "components") {
      while (componentCount(current) < value) {
        current = `${current}/a`;
        plant(current, directory());
      }
    } else {
      while (value - current.length > 201) {
        current = `${current}/${"a".repeat(200)}`;
        plant(current, directory());
      }
      current = `${current}/${"a".repeat(value - current.length - 1)}`;
      plant(current, file());
    }
    return syntheticHome({
      plants,
      productHome: home,
      evidence: evidenceOf({ retainedPaths }),
    });
  }

  function entriesHome(total: number): SyntheticHomeV1 {
    const home = "/s/h";
    const state = `${home}/state`;
    const tombstone = `${state}/.t`;
    const leaves = total - 2;
    const nameOf = (ordinal: number): string => `leaf-${String(ordinal)}`;
    /**
     * §6 projects retained evidence path by path, so the admitted bound's own
     * leaves each have to be named. The over-limit case refuses on the entry
     * counter during the walk, which reads no evidence, so naming a million
     * leaves there would cost 118 MB to never be consulted.
     */
    const retainedPaths = new Set([tombstone]);
    if (total <= ABSENT_MANIFEST_WALK_BOUNDS.entries) {
      for (let ordinal = 0; ordinal < leaves; ordinal += 1) {
        retainedPaths.add(`${tombstone}/${nameOf(ordinal)}`);
      }
    }
    const ordinalOf = (path: string): number | null => {
      if (!path.startsWith(`${tombstone}/`)) return null;
      const name = path.slice(tombstone.length + 1);
      const ordinal = Number(name.slice("leaf-".length));
      return Number.isSafeInteger(ordinal) && ordinal >= 0 && ordinal < leaves && nameOf(ordinal) === name
        ? ordinal
        : null;
    };
    const entry = (
      path: string,
      kind: LifecycleGuardedKindV1,
      ino: number,
      mode: number,
    ): LifecycleGuardedEntryV1 => ({
      path: unparsedPath(path),
      kind,
      ownerUid: UID,
      mode,
      nlink: kind === "directory" ? 2 : 1,
      size: parseUInt64Decimal("0"),
      dev: parseUInt64Decimal(SYNTHETIC_DEVICE),
      ino: parseUInt64Decimal(String(ino)),
    });
    const fixed = new Map<string, LifecycleGuardedEntryV1>([
      ["/s", entry("/s", "directory", 2, 0o755)],
      [home, entry(home, "directory", 3, 0o700)],
      [state, entry(state, "directory", 4, 0o700)],
      [tombstone, entry(tombstone, "directory", 5, 0o700)],
    ]);
    const fs = recordingPort(
      (path) => {
        const found = fixed.get(path);
        if (found !== undefined) return found;
        const ordinal = ordinalOf(path);
        return ordinal === null ? null : entry(path, "regular_file", ordinal + 8, 0o600);
      },
      async function* stream(from) {
        if (from.path === home) yield await Promise.resolve("state");
        else if (from.path === state) yield await Promise.resolve(".t");
        else if (from.path === tombstone) {
          for (let ordinal = 0; ordinal < leaves; ordinal += 1) {
            yield await Promise.resolve(nameOf(ordinal));
          }
        }
      },
    );
    return {
      fs,
      plants: new Map(),
      entryOf: (path) => {
        const found = fixed.get(path);
        if (found === undefined) throw new Error(`the fixture planted nothing at ${path}`);
        return found;
      },
      dependencies: {
        fs,
        effectiveUid: UID,
        productHome: unparsedPath(home),
        userHome: parseCanonicalAbsolutePathText(USER_HOME),
        evidence: evidenceOf({ retainedPaths }),
      },
    };
  }

  /**
   * `excludedRoots` once carried every retained path, which made each
   * removability check pay for the size of the retained tree
   * (`apps/cli/src/commands/uninstall.test.ts`). The same shape refused here in
   * minutes rather than seconds before the projection was indexed.
   */
  it("refuses a large unprojected home in bounded time", async () => {
    const directories = 50_000;
    const stale = 5_000;
    const extra = new Map<string, PlantV1>();
    const retainedPaths = new Set<string>();
    for (let ordinal = 0; ordinal < directories; ordinal += 1) {
      extra.set(`${HOME}/d-${String(ordinal)}`, directory());
    }
    for (let ordinal = 0; ordinal < stale; ordinal += 1) {
      retainedPaths.add(`${HOME}/absent-${String(ordinal)}/leaf.tombstone`);
    }
    const home = memoryHome("state_empty", { extra, evidence: { retainedPaths } });

    const started = Date.now();
    const error = await refusal(home);

    expect(retainedPaths.size).toBe(stale);
    expect(error.paths.length).toBe(directories + 1);
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 120_000);

  it("publishes the walk bounds the spec fixes", () => {
    expect(ABSENT_MANIFEST_WALK_BOUNDS).toStrictEqual({
      entries: 1_000_000,
      components: 128,
      pathBytes: 4096,
    });
  });

  it.each([
    ["components", 128, "admitted"],
    ["components", 129, "refused"],
    ["pathBytes", 4096, "admitted"],
    ["pathBytes", 4097, "refused"],
  ] as const)(
    "walks the %s bound at %i through the production path (A8)",
    async (dimension, value, outcome) => {
      const home = boundHome(dimension, value);

      const run = inspectAbsentManifestProductHome(home.dependencies);

      if (outcome === "admitted") {
        const inspection = await run;
        expect(inspection.shape).toBe("state_empty");
        expect(inspection.visitedEntries).toBe(dimension === "components" ? 126 : 23);
      } else {
        await expect(run).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
      }
      expect(home.fs.mutations).toStrictEqual([]);
    },
  );

  it.each([
    [1_000_000, "admitted"],
    [1_000_001, "refused"],
  ] as const)(
    "walks the entries bound at %i through the production path (A8)",
    async (value, outcome) => {
      const home = entriesHome(value);

      const run = inspectAbsentManifestProductHome(home.dependencies);

      if (outcome === "admitted") {
        const inspection = await run;
        expect(inspection.shape).toBe("state_empty");
        expect(inspection.visitedEntries).toBe(1_000_000);
      } else {
        await expect(run).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
      }
      expect(home.fs.mutations).toStrictEqual([]);
      expect(home.fs.readsOfContent).toStrictEqual([]);
    },
    600_000,
  );
});
