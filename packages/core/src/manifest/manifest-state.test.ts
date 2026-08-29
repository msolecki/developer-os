import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { encodeCanonicalJson } from "../lifecycle/canonical-json.js";
import { EXIT_CODES } from "../result.js";
import {
  admitCanonicalAbsolutePath,
  deriveBootstrapPayloadPath,
  deriveManifestPayloadPath,
  type CanonicalAbsolutePathV1,
} from "../update/paths.js";
import type { LowerHexSha256 } from "../update/scalars.js";
import {
  ManifestStateParticipant,
  validateManifestStatePlan,
  type BootstrapExpectedPayloadRefV1,
  type ManifestExternalEffectRefV1,
  type ManifestFileIdentityV1,
  type ManifestParticipantIdV1,
  type ManifestStateParticipantDependencies,
  type ManifestStatePlanAdmissionContextV1,
  type ManifestStatePlanV1,
  type UpdateExpectedPayloadRefV1,
} from "./manifest-state.js";
import type { ManifestAdmissionContextV1 } from "./types.js";

const encoder = new TextEncoder();
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const UID = 501;
const DEVICE = 17;
const PRODUCT_HOME = "/synthetic/product";
const MANIFEST_PATH = `${PRODUCT_HOME}/state/installation-manifest.json`;
const MANIFEST_PARENT = dirname(MANIFEST_PATH);
const LIFECYCLE_ID = `lc_${"b".repeat(61)}`;
const LIFECYCLE_PARTICIPANT_ID = `mf_${"c".repeat(61)}`;
const FRESH_ID = "fi_11111111-1111-4111-8111-111111111111";
const MIGRATION_ID = "mm_22222222-2222-4222-8222-222222222222";
const FRESH_PARTICIPANT_ID = `mf_${FRESH_ID}`;
const MIGRATION_PARTICIPANT_ID = `mf_${MIGRATION_ID}`;
const HEX_A = "a".repeat(64) as LowerHexSha256;
const HEX_B = "b".repeat(64) as LowerHexSha256;

const BEFORE_BYTES = encoder.encode(
  '{"schemaVersion":1,"productVersion":"1.0.0","installedAt":"2026-08-29T00:00:00.000Z","artifacts":[]}\n',
);
const AFTER_BYTES = encoder.encode(
  encodeCanonicalJson({
    schemaVersion: 2,
    productVersion: "1.0.1",
    installedAt: "2026-08-30T00:00:00.000Z",
    artifacts: [
      {
        owner: "core",
        path: "/synthetic/managed.json",
        kind: "file",
        productVersion: "1.0.1",
        existedBefore: false,
        beforeHash: null,
        backupRelativePath: null,
        source: "template.json",
        mergeStrategy: "dedicated",
        verifiedAt: "2026-08-30T00:00:00.000Z",
        verification: { mode: "ephemeral" },
      },
    ],
  }),
);

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function foundationHash(ids: readonly string[]): string {
  return createHash("sha256")
    .update("developer-os/manifest-foundation-bindings/v1\0")
    .update(JSON.stringify(ids))
    .digest("hex");
}

interface MemoryEntry {
  readonly kind: "file" | "directory";
  readonly dev: number;
  readonly ino: number;
  readonly uid: number;
  readonly mode: number;
  readonly nlink: number;
  readonly bytes: Uint8Array;
}

interface Fault {
  readonly event: string;
  readonly occurrence: number;
}

class SimulatedDeath extends Error {}

class MemoryFileSystem {
  readonly entries = new Map<string, MemoryEntry>();
  readonly events: string[] = [];
  private readonly occurrences = new Map<string, number>();
  private readonly awaitingReopen = new Set<string>();
  private fault: Fault | null = null;
  private nextIno = 1_000;

  constructor() {
    this.addDirectory(MANIFEST_PARENT);
  }

  addDirectory(path: string, dev = DEVICE): void {
    this.entries.set(path, {
      kind: "directory",
      dev,
      ino: this.nextIno++,
      uid: UID,
      mode: 0o700,
      nlink: 1,
      bytes: new Uint8Array(),
    });
  }

  addFile(
    path: string,
    bytes: Uint8Array,
    ino: number,
    options: Partial<Omit<MemoryEntry, "kind" | "bytes" | "ino">> = {},
  ): void {
    this.entries.set(path, {
      kind: "file",
      dev: options.dev ?? DEVICE,
      ino,
      uid: options.uid ?? UID,
      mode: options.mode ?? 0o600,
      nlink: options.nlink ?? 1,
      bytes: Uint8Array.from(bytes),
    });
  }

  remove(path: string): void {
    this.entries.delete(path);
  }

  moveUnchecked(source: string, destination: string): void {
    const entry = this.entries.get(source);
    if (entry === undefined || this.entries.has(destination)) throw new Error("invalid unchecked move fixture state");
    this.entries.delete(source);
    this.entries.set(destination, entry);
  }

  cloneFile(source: string, destination: string, ino = this.nextIno++): void {
    const entry = this.entries.get(source);
    if (entry?.kind !== "file") throw new Error("missing clone source");
    this.addFile(destination, entry.bytes, ino, entry);
  }

  armDeath(event: string, occurrence = 1): void {
    this.fault = { event, occurrence };
  }

  clearFaultAndEvents(): void {
    this.fault = null;
    this.events.length = 0;
    this.occurrences.clear();
    this.awaitingReopen.clear();
  }

  recordExternal(event: string): void {
    this.record(event);
  }

  snapshot(paths: readonly string[]): Record<string, unknown> {
    return Object.fromEntries(
      paths.map((path) => {
        const entry = this.entries.get(path);
        return [
          path,
          entry === undefined
            ? null
            : {
                kind: entry.kind,
                dev: entry.dev,
                ino: entry.ino,
                uid: entry.uid,
                mode: entry.mode,
                nlink: entry.nlink,
                bytes: Buffer.from(entry.bytes).toString("hex"),
              },
        ];
      }),
    );
  }

  lstat(path: string): Promise<Stats> {
    const entry = this.entries.get(path);
    if (entry === undefined) return Promise.reject(missingError());
    return Promise.resolve(memoryStats(entry));
  }

  open(path: string): Promise<FileHandle> {
    const entry = this.entries.get(path);
    if (entry === undefined) return Promise.reject(missingError());
    if (entry.kind === "file") return Promise.resolve(this.fileHandle(path, entry));

    const reopened = this.awaitingReopen.has(path);
    this.record(`${reopened ? "before:reopen" : "before:barrier"}:${path}`);
    return Promise.resolve(this.directoryHandle(path, entry, reopened));
  }

  guardedMoveNoReplace(
    source: CanonicalAbsolutePathV1,
    destination: CanonicalAbsolutePathV1,
    expected: ManifestFileIdentityV1,
  ): Promise<void> {
    const transition = this.moveName(source, destination);
    this.record(`before:move:${transition}`);
    const sourceEntry = this.entries.get(source);
    if (sourceEntry?.kind !== "file" || !matchesIdentity(sourceEntry, expected) || this.entries.has(destination)) {
      throw new Error("atomic move authority refused");
    }
    this.entries.delete(source);
    this.entries.set(destination, sourceEntry);
    this.record(`after:move:${transition}`);
    return Promise.resolve();
  }

  guardedUnlinkExact(path: CanonicalAbsolutePathV1, expected: ManifestFileIdentityV1): Promise<void> {
    this.record("before:unlink:tombstone");
    const entry = this.entries.get(path);
    if (entry?.kind !== "file" || !matchesIdentity(entry, expected)) throw new Error("atomic unlink authority refused");
    this.entries.delete(path);
    this.record("after:unlink:tombstone");
    return Promise.resolve();
  }

  private record(event: string): void {
    this.events.push(event);
    const occurrence = (this.occurrences.get(event) ?? 0) + 1;
    this.occurrences.set(event, occurrence);
    if (this.fault?.event === event && this.fault.occurrence === occurrence) throw new SimulatedDeath(event);
  }

  private moveName(source: string, destination: string): string {
    if (source === MANIFEST_PATH && destination.includes(".tombstone")) return "preserve-preimage";
    if (source.endsWith("after.json") || source.endsWith(".payload")) return "publish-postimage";
    if (source === MANIFEST_PATH && (destination.endsWith("after.json") || destination.endsWith(".payload"))) {
      return "preserve-postimage";
    }
    if (source.includes(".tombstone") && destination === MANIFEST_PATH) return "restore-preimage";
    return "unknown";
  }

  private fileHandle(path: string, entry: MemoryEntry): FileHandle {
    return {
      stat: () => Promise.resolve(memoryStats(entry)),
      read: (buffer: Uint8Array, offset: number, length: number, position: number) => {
        const available = Math.max(0, Math.min(length, entry.bytes.byteLength - position));
        buffer.set(entry.bytes.subarray(position, position + available), offset);
        return Promise.resolve({ bytesRead: available, buffer });
      },
      close: () => {
        this.record(`file-close:${path}`);
        return Promise.resolve();
      },
    } as unknown as FileHandle;
  }

  private directoryHandle(path: string, entry: MemoryEntry, reopened: boolean): FileHandle {
    return {
      stat: () => Promise.resolve(memoryStats(entry)),
      sync: () => {
        this.record(`sync:${path}`);
        this.awaitingReopen.add(path);
        return Promise.resolve();
      },
      close: () => {
        if (reopened) {
          this.awaitingReopen.delete(path);
          this.record(`after:barrier:${path}`);
        }
        return Promise.resolve();
      },
    } as unknown as FileHandle;
  }
}

function missingError(): Error & { code: string } {
  return Object.assign(new Error("missing"), { code: "ENOENT" });
}

function memoryStats(entry: MemoryEntry): Stats {
  return {
    dev: entry.dev,
    ino: entry.ino,
    uid: entry.uid,
    mode: entry.mode,
    nlink: entry.nlink,
    size: entry.bytes.byteLength,
    isFile: () => entry.kind === "file",
    isDirectory: () => entry.kind === "directory",
    isSymbolicLink: () => false,
  } as unknown as Stats;
}

function matchesIdentity(entry: MemoryEntry, expected: ManifestFileIdentityV1): boolean {
  return (
    hash(entry.bytes) === expected.hash &&
    entry.uid === expected.ownerUid &&
    entry.mode === expected.mode &&
    entry.nlink === expected.nlink &&
    String(entry.bytes.byteLength) === expected.size &&
    String(entry.dev) === expected.dev &&
    String(entry.ino) === expected.ino
  );
}

type EnvelopeKind = "fresh_v2_init" | "v1_migration" | "lifecycle";
type Presence = "absent" | "present";

interface RawPayloadRef {
  readonly kind: string;
  readonly coordinatorId?: string;
  readonly bootstrapId?: string;
  readonly ordinal: number;
  readonly path: string;
  readonly hash: string;
  readonly bytes: number;
  readonly mode: number;
}

interface RawPresentState {
  readonly state: "present";
  readonly hash: string;
  readonly bytes: RawPayloadRef | null;
  readonly ownerUid: number;
  readonly mode: number;
  readonly nlink: number;
  readonly size: string;
  readonly dev: string | null;
  readonly ino: string | null;
}

type RawBytesState = RawPresentState | { readonly state: "absent" };

interface RawPlan {
  readonly schemaVersion: number;
  readonly participantId: string;
  readonly envelope: { readonly kind: EnvelopeKind; readonly id: string };
  readonly bindings: {
    readonly foundationTransactions: { readonly count: number; readonly orderedIdsHash: string };
    readonly externalEffects: readonly unknown[];
  };
  readonly manifestPath: string;
  readonly tombstonePath: string;
  readonly before: RawBytesState;
  readonly after: RawBytesState;
  readonly maximumPlanBytes: number;
  readonly maximumJournalBytes: number;
}

interface FixtureOptions {
  readonly envelope?: EnvelopeKind;
  readonly before?: Presence;
  readonly after?: Presence;
  readonly ordinal?: number;
  readonly foundationIds?: readonly string[];
  readonly effects?: readonly ManifestExternalEffectRefV1[];
}

interface Fixture {
  readonly fs: MemoryFileSystem;
  readonly plan: RawPlan;
  readonly context: ManifestStatePlanAdmissionContextV1;
  readonly participant: ManifestStateParticipant;
  readonly participantId: string;
  readonly payloadPath: string;
  readonly tombstonePath: string;
  readonly paths: readonly string[];
  admit(): ManifestStatePlanV1;
  recreate(context?: ManifestStatePlanAdmissionContextV1): ManifestStateParticipant;
}

function createFixture(options: FixtureOptions = {}): Fixture {
  const envelopeKind = options.envelope ?? "lifecycle";
  const beforePresence = options.before ?? "present";
  const afterPresence = options.after ?? "present";
  const ordinal = options.ordinal ?? 0;
  const foundationIds = options.foundationIds ?? [];
  const effects = options.effects ?? [];
  const outerId = envelopeKind === "fresh_v2_init" ? FRESH_ID : envelopeKind === "v1_migration" ? MIGRATION_ID : LIFECYCLE_ID;
  const participantId = envelopeKind === "fresh_v2_init"
    ? FRESH_PARTICIPANT_ID
    : envelopeKind === "v1_migration"
      ? MIGRATION_PARTICIPANT_ID
      : LIFECYCLE_PARTICIPANT_ID;
  const evidence = {
    reopenCanonicalAbsolutePath: (path: string) => path,
    containsCanonicalPath: (root: string, candidate: string) => candidate === root || candidate.startsWith(`${root}/`),
    hasFoldedAlias: () => false,
  };
  const productHome = admitCanonicalAbsolutePath(PRODUCT_HOME, evidence);
  const manifestPath = admitCanonicalAbsolutePath(MANIFEST_PATH, evidence);
  const payloadPath = envelopeKind === "lifecycle"
    ? deriveManifestPayloadPath(productHome, outerId as never, participantId as never)
    : deriveBootstrapPayloadPath(productHome, envelopeKind === "fresh_v2_init" ? "fresh_v2_init" : "v1_to_v2", outerId as never, ordinal);
  const tombstonePath = join(MANIFEST_PARENT, `.installation-manifest.${participantId}.json.tombstone`);
  const fs = new MemoryFileSystem();
  if (dirname(payloadPath) !== MANIFEST_PARENT) fs.addDirectory(dirname(payloadPath));
  if (beforePresence === "present") fs.addFile(MANIFEST_PATH, BEFORE_BYTES, 101);
  if (afterPresence === "present") fs.addFile(payloadPath, AFTER_BYTES, 202);

  const envelope = { kind: envelopeKind, id: outerId };
  const before = beforePresence === "present"
    ? presentState(BEFORE_BYTES, 101, null)
    : { state: "absent" as const };
  const payloadRef = envelopeKind === "lifecycle"
    ? {
        kind: "update_expected" as const,
        coordinatorId: outerId,
        ordinal,
        path: payloadPath,
        hash: hash(AFTER_BYTES),
        bytes: AFTER_BYTES.byteLength,
        mode: 0o600 as const,
      }
    : {
        kind: "bootstrap_expected" as const,
        bootstrapId: outerId,
        ordinal,
        path: payloadPath,
        hash: hash(AFTER_BYTES),
        bytes: AFTER_BYTES.byteLength,
        mode: 0o600 as const,
      };
  const after = afterPresence === "present"
    ? presentState(AFTER_BYTES, envelopeKind === "lifecycle" ? 202 : null, payloadRef)
    : { state: "absent" as const };
  const plan: RawPlan = {
    schemaVersion: 1,
    participantId,
    envelope,
    bindings: {
      foundationTransactions: {
        count: foundationIds.length,
        orderedIdsHash: foundationHash(foundationIds),
      },
      externalEffects: effects,
    },
    manifestPath,
    tombstonePath,
    before,
    after,
    maximumPlanBytes: 16_777_216,
    maximumJournalBytes: 1_048_576,
  };
  const context: ManifestStatePlanAdmissionContextV1 = {
    evidence,
    productHome,
    manifestPath,
    foundationTransactionIds: foundationIds,
    externalEffects: effects,
    admitParticipant: (candidateEnvelope, candidateId) => {
      if (
        candidateEnvelope.kind !== envelopeKind ||
        candidateEnvelope.id !== outerId ||
        candidateId !== participantId
      ) {
        throw new Error("participant pair was not admitted");
      }
      return participantId as ManifestParticipantIdV1;
    },
    admitExternalEffect: (value) => {
      const admitted = effects.find((effect) => effect.kind === value.kind && effect.id === value.id);
      if (admitted === undefined) throw new Error("effect ID was not admitted");
      return admitted.id;
    },
    bootstrapPayloadIdentity: (value: BootstrapExpectedPayloadRefV1) => {
      if (value.path !== payloadPath || value.bootstrapId !== outerId) throw new Error("bootstrap payload was not admitted");
      return { dev: String(DEVICE) as never, ino: "202" as never };
    },
    updatePayloadIdentity: (value: UpdateExpectedPayloadRefV1) => {
      if (value.path !== payloadPath || value.coordinatorId !== outerId) throw new Error("update payload was not admitted");
      return { dev: String(DEVICE) as never, ino: "202" as never };
    },
  };
  const manifestAdmission: ManifestAdmissionContextV1 = {
    evidence,
    sourceRoot: admitCanonicalAbsolutePath("/synthetic/source", evidence),
    backupRoot: admitCanonicalAbsolutePath("/synthetic/backup", evidence),
    admitOwnerPath: (_owner, path) => path,
  };
  const dependencies = {
    fs,
    guardedMoveNoReplace: fs.guardedMoveNoReplace.bind(fs),
    guardedUnlinkExact: fs.guardedUnlinkExact.bind(fs),
    admission: context,
    uid: UID,
    manifestAdmission,
  } as unknown as ManifestStateParticipantDependencies;
  const recreate = (candidateContext = context) => new ManifestStateParticipant({ ...dependencies, admission: candidateContext });
  const fixture: Fixture = {
    fs,
    plan,
    context,
    participant: recreate(),
    participantId,
    payloadPath,
    tombstonePath,
    paths: [MANIFEST_PATH, tombstonePath, payloadPath],
    admit: () => validateManifestStatePlan(plan, context),
    recreate,
  };
  return fixture;
}

function presentState(bytes: Uint8Array, ino: number | null, payload: RawPayloadRef | null): RawPresentState {
  return {
    state: "present",
    hash: hash(bytes),
    bytes: payload,
    ownerUid: UID,
    mode: 0o600,
    nlink: 1,
    size: String(bytes.byteLength),
    dev: ino === null ? null : String(DEVICE),
    ino: ino === null ? null : String(ino),
  };
}

function rawPresentAfter(fixture: Fixture): RawPresentState {
  if (fixture.plan.after.state !== "present") throw new Error("fixture requires a present after state");
  return fixture.plan.after;
}

function admissionRefuses(value: unknown, context: ManifestStatePlanAdmissionContextV1): void {
  try {
    validateManifestStatePlan(value, context);
  } catch (error) {
    expect(error).toMatchObject({ code: EXIT_CODES.recoveryRequired });
    return;
  }
  throw new Error("plan unexpectedly admitted");
}

async function refusesAndPreserves(fixture: Fixture, action: () => Promise<unknown>): Promise<void> {
  const before = fixture.fs.snapshot(fixture.paths);
  await expect(action()).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });
  expect(fixture.fs.snapshot(fixture.paths)).toEqual(before);
}

function expectBeforeInventory(fixture: Fixture, before: Presence, after: Presence): void {
  const snapshot = fixture.fs.snapshot(fixture.paths);
  const manifest = snapshot[MANIFEST_PATH] as { ino: number } | null;
  const tombstone = snapshot[fixture.tombstonePath] as { ino: number } | null;
  const payload = snapshot[fixture.payloadPath] as { ino: number } | null;
  expect(manifest?.ino ?? null).toBe(before === "present" ? 101 : null);
  expect(tombstone).toBeNull();
  expect(payload?.ino ?? null).toBe(after === "present" ? 202 : null);
}

function expectAppliedInventory(fixture: Fixture, before: Presence, after: Presence): void {
  const snapshot = fixture.fs.snapshot(fixture.paths);
  const manifest = snapshot[MANIFEST_PATH] as { ino: number } | null;
  const tombstone = snapshot[fixture.tombstonePath] as { ino: number } | null;
  const payload = snapshot[fixture.payloadPath] as { ino: number } | null;
  expect(manifest?.ino ?? null).toBe(after === "present" ? 202 : null);
  expect(tombstone?.ino ?? null).toBe(before === "present" ? 101 : null);
  expect(payload).toBeNull();
}

describe("ManifestStatePlanV1 boundary tables", () => {
  it.each([
    { name: "present state exactly 64 MiB", size: MAX_MANIFEST_BYTES, accepted: true },
    { name: "present state first byte over 64 MiB", size: MAX_MANIFEST_BYTES + 1, accepted: false },
  ])("admits the plan-only $name boundary", ({ size, accepted }) => {
    const fixture = createFixture();
    const plan = { ...fixture.plan, before: { ...fixture.plan.before, size: String(size) } };
    if (accepted) expect(validateManifestStatePlan(plan, fixture.context).before).toMatchObject({ size: String(size) });
    else admissionRefuses(plan, fixture.context);
  });

  it.each([
    { name: "payload ref exactly 64 MiB", bytes: MAX_MANIFEST_BYTES, accepted: true },
    { name: "payload ref first byte over 64 MiB", bytes: MAX_MANIFEST_BYTES + 1, accepted: false },
  ])("admits the plan-only $name boundary", ({ bytes, accepted }) => {
    const fixture = createFixture();
    const after = rawPresentAfter(fixture);
    const plan = {
      ...fixture.plan,
      after: {
        ...after,
        size: String(MAX_MANIFEST_BYTES),
        bytes: { ...after.bytes, bytes },
      },
    };
    if (accepted) expect(validateManifestStatePlan(plan, fixture.context).after).toMatchObject({ size: String(MAX_MANIFEST_BYTES) });
    else admissionRefuses(plan, fixture.context);
  });
});

describe("participant envelope admission table", () => {
  it.each(["fresh_v2_init", "v1_migration", "lifecycle"] as const)("retains the exact legal %s envelope", (envelope) => {
    const fixture = createFixture({ envelope });
    expect(fixture.admit().envelope).toEqual(fixture.plan.envelope);
  });

  it.each([
    { name: "missing envelope ID", change: (fixture: Fixture) => ({ kind: fixture.plan.envelope.kind }) },
    { name: "extra envelope key", change: (fixture: Fixture) => ({ ...fixture.plan.envelope, extra: true }) },
    { name: "unknown envelope arm", change: (fixture: Fixture) => ({ kind: "rollback", id: fixture.plan.envelope.id }) },
    { name: "wrong outer ID", change: (fixture: Fixture) => ({ ...fixture.plan.envelope, id: "lc_wrong" }) },
  ])("refuses $name", ({ change }) => {
    const fixture = createFixture();
    admissionRefuses({ ...fixture.plan, envelope: change(fixture) }, fixture.context);
  });

  it("refuses a participant/tombstone substitution even when those two attacker fields match", () => {
    const fixture = createFixture();
    const substituted = "mf_attacker";
    const plan = {
      ...fixture.plan,
      participantId: substituted,
      tombstonePath: join(MANIFEST_PARENT, `.installation-manifest.${substituted}.json.tombstone`),
    };
    admissionRefuses(plan, fixture.context);
  });

  it("refuses an admission callback that substitutes its returned participant ID", () => {
    const fixture = createFixture();
    const context = {
      ...fixture.context,
      admitParticipant: () => "mf_substituted" as ManifestParticipantIdV1,
    };
    admissionRefuses(fixture.plan, context);
  });
});

describe("Foundation binding table", () => {
  it.each([
    { name: "zero", ids: [] },
    { name: "one", ids: ["tx_one"] },
    { name: "ordered nonempty", ids: ["tx_one", "tx_two"] },
  ])("admits the exact $name Foundation partition", ({ ids }) => {
    expect(createFixture({ foundationIds: ids }).admit().bindings.foundationTransactions.count).toBe(ids.length);
  });

  it("refuses duplicate enclosing Foundation IDs", () => {
    const fixture = createFixture({ foundationIds: ["tx_same", "tx_same"] });
    admissionRefuses(fixture.plan, fixture.context);
  });

  it.each([
    {
      name: "reordered hash",
      mutate: () => ({ count: 2, orderedIdsHash: foundationHash(["tx_two", "tx_one"]) }),
    },
    {
      name: "wrong count",
      mutate: (fixture: Fixture) => ({ ...fixture.plan.bindings.foundationTransactions, count: 1 }),
    },
    { name: "wrong hash", mutate: () => ({ count: 2, orderedIdsHash: HEX_A }) },
  ])("refuses a $name", ({ mutate }) => {
    const fixture = createFixture({ foundationIds: ["tx_one", "tx_two"] });
    const plan = {
      ...fixture.plan,
      bindings: { ...fixture.plan.bindings, foundationTransactions: mutate(fixture) },
    };
    admissionRefuses(plan, fixture.context);
  });
});

describe("external-effect partition table", () => {
  const effects = [
    { kind: "codex_registration", id: "oe_codex", planHash: HEX_A },
    { kind: "git", id: "git_effect", planHash: HEX_A },
    { kind: "launchd", id: "launchd_effect", planHash: HEX_A },
  ] as const;

  it("admits an exact zero-effect lifecycle partition", () => {
    expect(createFixture().admit().bindings.externalEffects).toEqual([]);
  });

  it.each(effects)("admits one exact $kind effect", (effect) => {
    const fixture = createFixture({ effects: [effect] });
    expect(fixture.admit().bindings.externalEffects).toEqual([effect]);
  });

  it("refuses the first effect over the normative [0..1] bound", () => {
    const fixture = createFixture({ effects: effects.slice(0, 2) });
    admissionRefuses(fixture.plan, fixture.context);
  });

  it("requires bootstrap external effects to be empty", () => {
    const fixture = createFixture({ envelope: "fresh_v2_init", effects: [effects[0]] });
    admissionRefuses(fixture.plan, fixture.context);
  });

  it.each([
    { name: "missing ref key", value: { kind: "git", id: "git_effect" } },
    { name: "extra ref key", value: { kind: "git", id: "git_effect", planHash: HEX_A, extra: true } },
    { name: "wrong kind", value: { kind: "network", id: "git_effect", planHash: HEX_A } },
    { name: "wrong hash", value: { kind: "git", id: "git_effect", planHash: "not-a-hash" } },
  ])("refuses a $name", ({ value }) => {
    const fixture = createFixture({ effects: [effects[1]] });
    const plan = { ...fixture.plan, bindings: { ...fixture.plan.bindings, externalEffects: [value] } };
    admissionRefuses(plan, fixture.context);
  });

  it("refuses an effect admission callback that substitutes the admitted ID", () => {
    const fixture = createFixture({ effects: [effects[1]] });
    const context = { ...fixture.context, admitExternalEffect: () => "git_substituted" };
    admissionRefuses(fixture.plan, context);
  });

  it.each([
    { name: "missing", plan: [] },
    { name: "extra", plan: [effects[0], effects[1]] },
    { name: "wrong", plan: [{ ...effects[1], planHash: HEX_B }] },
  ])("refuses a $name plan ref against the exact enclosing context", ({ plan }) => {
    const fixture = createFixture({ effects: [effects[1]] });
    admissionRefuses({ ...fixture.plan, bindings: { ...fixture.plan.bindings, externalEffects: plan } }, fixture.context);
  });
});

describe("payload ordinal and binding tables", () => {
  it.each([
    { envelope: "lifecycle", ordinal: 0, accepted: true },
    { envelope: "lifecycle", ordinal: 1_099_999, accepted: true },
    { envelope: "lifecycle", ordinal: 1_100_000, accepted: false },
    { envelope: "fresh_v2_init", ordinal: 0, accepted: true },
    { envelope: "fresh_v2_init", ordinal: 999_999, accepted: true },
    { envelope: "fresh_v2_init", ordinal: 1_000_000, accepted: false },
    { envelope: "v1_migration", ordinal: 0, accepted: true },
    { envelope: "v1_migration", ordinal: 999_999, accepted: true },
    { envelope: "v1_migration", ordinal: 1_000_000, accepted: false },
  ] as const)("checks $envelope ordinal $ordinal", ({ envelope, ordinal, accepted }) => {
    if (!accepted) {
      const fixture = createFixture({ envelope });
      const after = rawPresentAfter(fixture);
      const plan = { ...fixture.plan, after: { ...after, bytes: { ...after.bytes, ordinal } } };
      admissionRefuses(plan, fixture.context);
      return;
    }
    expect(createFixture({ envelope, ordinal }).admit().after).toMatchObject({ state: "present" });
  });

  it.each([
    { name: "wrong payload arm", patch: { kind: "bootstrap_expected" } },
    { name: "wrong coordinator ID", patch: { coordinatorId: "lc_wrong" } },
    { name: "wrong derived path", patch: { path: "/synthetic/wrong/after.json" } },
    { name: "wrong hash equality", patch: { hash: HEX_A } },
    { name: "wrong length equality", patch: { bytes: AFTER_BYTES.byteLength + 1 } },
    { name: "wrong mode equality", patch: { mode: 0o700 } },
  ])("refuses $name", ({ patch }) => {
    const fixture = createFixture();
    const after = rawPresentAfter(fixture);
    const plan = { ...fixture.plan, after: { ...after, bytes: { ...after.bytes, ...patch } } };
    admissionRefuses(plan, fixture.context);
  });

  it("requires a lifecycle absent-after derived payload slot to be absent", async () => {
    const fixture = createFixture({ before: "absent", after: "absent" });
    fixture.fs.addFile(fixture.payloadPath, AFTER_BYTES, 202);
    await refusesAndPreserves(fixture, () => fixture.participant.apply(fixture.admit()));
  });

  it.each(["fresh_v2_init", "v1_migration"] as const)("rejects a %s absent-after plan", (envelope) => {
    const fixture = createFixture({ envelope, after: "absent" });
    admissionRefuses(fixture.plan, fixture.context);
  });
});

const executionRows = [
  { name: "update absent-before/absent-after", envelope: "lifecycle", before: "absent", after: "absent" },
  { name: "update absent-before/present-after", envelope: "lifecycle", before: "absent", after: "present" },
  { name: "update present-before/absent-after", envelope: "lifecycle", before: "present", after: "absent" },
  { name: "update present-before/present-after", envelope: "lifecycle", before: "present", after: "present" },
  { name: "fresh bootstrap absent-before/present-after", envelope: "fresh_v2_init", before: "absent", after: "present" },
  { name: "fresh bootstrap present-before/present-after", envelope: "fresh_v2_init", before: "present", after: "present" },
  { name: "migration bootstrap absent-before/present-after", envelope: "v1_migration", before: "absent", after: "present" },
  { name: "migration bootstrap present-before/present-after", envelope: "v1_migration", before: "present", after: "present" },
] as const;

describe("complete apply/compensate/compact execution table", () => {
  it.each(executionRows)("applies $name", async ({ envelope, before, after }) => {
    const fixture = createFixture({ envelope, before, after });
    await expect(fixture.participant.apply(fixture.admit())).resolves.toEqual({ state: "applied" });
    expectAppliedInventory(fixture, before, after);
  });

  it.each(executionRows)("compensates $name", async ({ envelope, before, after }) => {
    const fixture = createFixture({ envelope, before, after });
    const plan = fixture.admit();
    await fixture.participant.apply(plan);
    fixture.fs.clearFaultAndEvents();
    await expect(fixture.participant.compensate(plan)).resolves.toEqual({ state: "compensated" });
    expectBeforeInventory(fixture, before, after);
  });

  it.each(executionRows)("compacts $name without touching the applied manifest", async ({ envelope, before, after }) => {
    const fixture = createFixture({ envelope, before, after });
    const plan = fixture.admit();
    await fixture.participant.apply(plan);
    const appliedManifest = fixture.fs.snapshot([MANIFEST_PATH]);
    fixture.fs.clearFaultAndEvents();
    await expect(fixture.participant.compact(plan)).resolves.toBeUndefined();
    expect(fixture.fs.snapshot([MANIFEST_PATH])).toEqual(appliedManifest);
    expect(fixture.fs.snapshot([fixture.tombstonePath])[fixture.tombstonePath]).toBeNull();
  });
});

describe("closed manifest/tombstone/payload inventory table", () => {
  it.each([
    { name: "missing payload", arrange: (fixture: Fixture) => { fixture.fs.remove(fixture.payloadPath); } },
    { name: "changed payload inode", arrange: (fixture: Fixture) => { fixture.fs.addFile(fixture.payloadPath, AFTER_BYTES, 909); } },
    { name: "changed manifest inode", arrange: (fixture: Fixture) => { fixture.fs.addFile(MANIFEST_PATH, BEFORE_BYTES, 909); } },
    { name: "destination collision", arrange: (fixture: Fixture) => { fixture.fs.addFile(fixture.tombstonePath, encoder.encode("third"), 909); } },
    { name: "unlisted two-preimage copy state", arrange: (fixture: Fixture) => { fixture.fs.cloneFile(MANIFEST_PATH, fixture.tombstonePath, 909); } },
  ])("refuses and preserves $name", async ({ arrange }) => {
    const fixture = createFixture();
    arrange(fixture);
    await refusesAndPreserves(fixture, () => fixture.participant.apply(fixture.admit()));
  });

  it("refuses and preserves a two-copy postimage", async () => {
    const fixture = createFixture();
    const plan = fixture.admit();
    await fixture.participant.apply(plan);
    fixture.fs.cloneFile(MANIFEST_PATH, fixture.payloadPath, 909);
    await refusesAndPreserves(fixture, () => fixture.participant.observe(plan));
  });

  it("refuses an atomic move source swap and preserves the swapped inode", async () => {
    const fixture = createFixture();
    fixture.fs.addFile(MANIFEST_PATH, encoder.encode("third-state"), 909);
    await refusesAndPreserves(fixture, () => fixture.participant.apply(fixture.admit()));
  });

  it("refuses an atomic unlink source swap and preserves the swapped tombstone inode", async () => {
    const fixture = createFixture();
    const plan = fixture.admit();
    await fixture.participant.apply(plan);
    fixture.fs.addFile(fixture.tombstonePath, encoder.encode("third-tombstone"), 909);
    await refusesAndPreserves(fixture, () => fixture.participant.compact(plan));
  });

  it("refuses a wrong-device tombstone and preserves all evidence", async () => {
    const fixture = createFixture();
    fixture.fs.moveUnchecked(MANIFEST_PATH, fixture.tombstonePath);
    fixture.fs.addFile(fixture.tombstonePath, BEFORE_BYTES, 101, { dev: DEVICE + 1 });
    await refusesAndPreserves(fixture, () => fixture.participant.compensate(fixture.admit()));
  });

  it("requires the exact derived sibling tombstone name", () => {
    const fixture = createFixture();
    admissionRefuses({ ...fixture.plan, tombstonePath: `${MANIFEST_PARENT}/wrong.tombstone` }, fixture.context);
  });

  it("normalizes a guarded file-close failure and preserves every inode and byte", async () => {
    const fixture = createFixture();
    fixture.fs.armDeath(`file-close:${MANIFEST_PATH}`);
    await refusesAndPreserves(fixture, () => fixture.participant.observe(fixture.admit()));
  });
});

interface DeathRow {
  readonly name: string;
  readonly event: string;
  readonly occurrence?: number;
}

const payloadParent = dirname(
  deriveManifestPayloadPath(PRODUCT_HOME as never, LIFECYCLE_ID as never, LIFECYCLE_PARTICIPANT_ID as never),
);

const applyDeathRows: readonly DeathRow[] = [
  { name: "before preserve-preimage mutation", event: "before:move:preserve-preimage" },
  { name: "after preserve-preimage mutation", event: "after:move:preserve-preimage" },
  { name: "before preserve-preimage parent barrier", event: `before:barrier:${MANIFEST_PARENT}` },
  { name: "during preserve-preimage parent sync", event: `sync:${MANIFEST_PARENT}` },
  { name: "before preserve-preimage parent reopen", event: `before:reopen:${MANIFEST_PARENT}` },
  { name: "after preserve-preimage parent barrier", event: `after:barrier:${MANIFEST_PARENT}` },
  { name: "before publish-postimage mutation", event: "before:move:publish-postimage" },
  { name: "after publish-postimage mutation", event: "after:move:publish-postimage" },
  { name: "before publish source-parent barrier", event: `before:barrier:${payloadParent}` },
  { name: "during publish source-parent sync", event: `sync:${payloadParent}` },
  { name: "before publish source-parent reopen", event: `before:reopen:${payloadParent}` },
  { name: "after publish source-parent barrier", event: `after:barrier:${payloadParent}` },
  { name: "before publish destination-parent barrier", event: `before:barrier:${MANIFEST_PARENT}`, occurrence: 2 },
  { name: "during publish destination-parent sync", event: `sync:${MANIFEST_PARENT}`, occurrence: 2 },
  { name: "before publish destination-parent reopen", event: `before:reopen:${MANIFEST_PARENT}`, occurrence: 2 },
  { name: "after publish destination-parent barrier", event: `after:barrier:${MANIFEST_PARENT}`, occurrence: 2 },
];

describe("apply mutation and durability death table", () => {
  it.each(applyDeathRows)("recovers death $name", async ({ event, occurrence }) => {
    const fixture = createFixture();
    const plan = fixture.admit();
    fixture.fs.armDeath(event, occurrence);
    await expect(fixture.participant.apply(plan)).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });
    fixture.fs.clearFaultAndEvents();
    await expect(fixture.recreate().apply(plan)).resolves.toEqual({ state: "applied" });
    expectAppliedInventory(fixture, "present", "present");
  });
});

const compensateAppliedDeathRows: readonly DeathRow[] = [
  { name: "before adopted publish source barrier", event: `before:barrier:${payloadParent}` },
  { name: "after adopted publish source barrier", event: `after:barrier:${payloadParent}` },
  { name: "before adopted publish destination barrier", event: `before:barrier:${MANIFEST_PARENT}` },
  { name: "after adopted publish destination barrier", event: `after:barrier:${MANIFEST_PARENT}` },
  { name: "before preserve-postimage mutation", event: "before:move:preserve-postimage" },
  { name: "after preserve-postimage mutation", event: "after:move:preserve-postimage" },
  { name: "before preserve-postimage source barrier", event: `before:barrier:${MANIFEST_PARENT}`, occurrence: 2 },
  { name: "during preserve-postimage source sync", event: `sync:${MANIFEST_PARENT}`, occurrence: 2 },
  { name: "before preserve-postimage source reopen", event: `before:reopen:${MANIFEST_PARENT}`, occurrence: 2 },
  { name: "after preserve-postimage source barrier", event: `after:barrier:${MANIFEST_PARENT}`, occurrence: 2 },
  { name: "before preserve-postimage destination barrier", event: `before:barrier:${payloadParent}`, occurrence: 2 },
  { name: "after preserve-postimage destination barrier", event: `after:barrier:${payloadParent}`, occurrence: 2 },
  { name: "before restore-preimage mutation", event: "before:move:restore-preimage" },
  { name: "after restore-preimage mutation", event: "after:move:restore-preimage" },
  { name: "before restore-preimage parent barrier", event: `before:barrier:${MANIFEST_PARENT}`, occurrence: 3 },
  { name: "during restore-preimage parent sync", event: `sync:${MANIFEST_PARENT}`, occurrence: 3 },
  { name: "before restore-preimage parent reopen", event: `before:reopen:${MANIFEST_PARENT}`, occurrence: 3 },
  { name: "after restore-preimage parent barrier", event: `after:barrier:${MANIFEST_PARENT}`, occurrence: 3 },
];

describe("compensate-from-applied mutation and durability death table", () => {
  it.each(compensateAppliedDeathRows)("recovers death $name", async ({ event, occurrence }) => {
    const fixture = createFixture();
    const plan = fixture.admit();
    await fixture.participant.apply(plan);
    fixture.fs.clearFaultAndEvents();
    fixture.fs.armDeath(event, occurrence);
    await expect(fixture.participant.compensate(plan)).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });
    fixture.fs.clearFaultAndEvents();
    await expect(fixture.recreate().compensate(plan)).resolves.toEqual({ state: "compensated" });
    expectBeforeInventory(fixture, "present", "present");
  });
});

const compensatePreimageDeathRows: readonly DeathRow[] = [
  { name: "before adopted preimage parent barrier", event: `before:barrier:${MANIFEST_PARENT}` },
  { name: "after adopted preimage parent barrier", event: `after:barrier:${MANIFEST_PARENT}` },
  { name: "before direct restore mutation", event: "before:move:restore-preimage" },
  { name: "after direct restore mutation", event: "after:move:restore-preimage" },
  { name: "before direct restore parent barrier", event: `before:barrier:${MANIFEST_PARENT}`, occurrence: 2 },
  { name: "after direct restore parent barrier", event: `after:barrier:${MANIFEST_PARENT}`, occurrence: 2 },
];

describe("compensate-from-preimage mutation and durability death table", () => {
  it.each(compensatePreimageDeathRows)("recovers death $name", async ({ event, occurrence }) => {
    const fixture = createFixture();
    const plan = fixture.admit();
    fixture.fs.moveUnchecked(MANIFEST_PATH, fixture.tombstonePath);
    fixture.fs.clearFaultAndEvents();
    fixture.fs.armDeath(event, occurrence);
    await expect(fixture.participant.compensate(plan)).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });
    fixture.fs.clearFaultAndEvents();
    await expect(fixture.recreate().compensate(plan)).resolves.toEqual({ state: "compensated" });
    expectBeforeInventory(fixture, "present", "present");
  });
});

const compactDeathRows: readonly DeathRow[] = [
  { name: "before adopted applied source barrier", event: `before:barrier:${payloadParent}` },
  { name: "after adopted applied source barrier", event: `after:barrier:${payloadParent}` },
  { name: "before adopted applied destination barrier", event: `before:barrier:${MANIFEST_PARENT}` },
  { name: "after adopted applied destination barrier", event: `after:barrier:${MANIFEST_PARENT}` },
  { name: "before exact tombstone unlink", event: "before:unlink:tombstone" },
  { name: "after exact tombstone unlink", event: "after:unlink:tombstone" },
  { name: "before unlink parent barrier", event: `before:barrier:${MANIFEST_PARENT}`, occurrence: 2 },
  { name: "during unlink parent sync", event: `sync:${MANIFEST_PARENT}`, occurrence: 2 },
  { name: "before unlink parent reopen", event: `before:reopen:${MANIFEST_PARENT}`, occurrence: 2 },
  { name: "after unlink parent barrier", event: `after:barrier:${MANIFEST_PARENT}`, occurrence: 2 },
];

describe("compact mutation and durability death table", () => {
  it.each(compactDeathRows)("recovers death $name", async ({ event, occurrence }) => {
    const fixture = createFixture();
    const plan = fixture.admit();
    await fixture.participant.apply(plan);
    const appliedManifest = fixture.fs.snapshot([MANIFEST_PATH]);
    fixture.fs.clearFaultAndEvents();
    fixture.fs.armDeath(event, occurrence);
    await expect(fixture.participant.compact(plan)).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });
    fixture.fs.clearFaultAndEvents();
    await expect(fixture.recreate().compact(plan)).resolves.toBeUndefined();
    expect(fixture.fs.snapshot([MANIFEST_PATH])).toEqual(appliedManifest);
    expect(fixture.fs.snapshot([fixture.tombstonePath])[fixture.tombstonePath]).toBeNull();
  });

  it("durability-adopts only the exact tombstone-unlink-before-cursor state", async () => {
    const fixture = createFixture();
    const plan = fixture.admit();
    await fixture.participant.apply(plan);
    fixture.fs.remove(fixture.tombstonePath);
    fixture.fs.clearFaultAndEvents();
    await expect(fixture.recreate().compact(plan)).resolves.toBeUndefined();
    expect(fixture.fs.events).toContain(`sync:${MANIFEST_PARENT}`);
    expect(fixture.fs.events).toContain(`after:barrier:${MANIFEST_PARENT}`);
  });

  it("refuses every other tombstone-missing state as compaction authority", async () => {
    const fixture = createFixture();
    await refusesAndPreserves(fixture, () => fixture.participant.compact(fixture.admit()));
  });

  it("orders tombstone durability before the enclosing immutable plan is removed", async () => {
    const fixture = createFixture();
    const plan = fixture.admit();
    await fixture.participant.apply(plan);
    fixture.fs.clearFaultAndEvents();
    await fixture.participant.compact(plan);
    fixture.fs.recordExternal("outer-plan-unlink");
    expect(fixture.fs.events.indexOf("after:unlink:tombstone")).toBeLessThan(fixture.fs.events.indexOf("outer-plan-unlink"));
    expect(fixture.fs.events.indexOf(`after:barrier:${MANIFEST_PARENT}`)).toBeLessThan(
      fixture.fs.events.indexOf("outer-plan-unlink"),
    );
  });
});

describe("outer-cursor direction and point-of-no-return table", () => {
  it("applies committed absence from the preimage physical state without guessing rollback", async () => {
    const fixture = createFixture({ before: "present", after: "absent" });
    const plan = fixture.admit();
    fixture.fs.moveUnchecked(MANIFEST_PATH, fixture.tombstonePath);
    await expect(fixture.participant.apply(plan)).resolves.toEqual({ state: "applied" });
    expectAppliedInventory(fixture, "present", "absent");
  });

  it("compensates the same preimage physical state when the outer cursor selects rollback", async () => {
    const fixture = createFixture({ before: "present", after: "absent" });
    const plan = fixture.admit();
    fixture.fs.moveUnchecked(MANIFEST_PATH, fixture.tombstonePath);
    await expect(fixture.participant.compensate(plan)).resolves.toEqual({ state: "compensated" });
    expectBeforeInventory(fixture, "present", "absent");
  });

  it("force-forwards an applied postimage when apply is selected", async () => {
    const fixture = createFixture();
    const plan = fixture.admit();
    await fixture.participant.apply(plan);
    await expect(fixture.recreate().apply(plan)).resolves.toEqual({ state: "applied" });
    expectAppliedInventory(fixture, "present", "present");
  });

  it("rolls an applied postimage back only when compensate is selected", async () => {
    const fixture = createFixture();
    const plan = fixture.admit();
    await fixture.participant.apply(plan);
    await expect(fixture.recreate().compensate(plan)).resolves.toEqual({ state: "compensated" });
    expectBeforeInventory(fixture, "present", "present");
  });
});
