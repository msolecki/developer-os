import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createNodeLifecycleGuardedFileSystem, encodeCanonicalJson, EXIT_CODES, LifecycleRecoveryRequiredError, parseCanonicalAbsolutePathText, parseLowerHexSha256, parseUInt64Decimal } from "@developer-os/core";
import type { LifecycleGuardedEntryV1, ManifestBytesStateV1, ManifestStatePlanV1, UpdateExpectedPayloadRefV1 } from "@developer-os/core";
import { createRedactor } from "@developer-os/security";
import { afterEach, describe, expect, it } from "vitest";

import { runDoctorReport } from "../commands/doctor.js";
import { removeCommandFixtures } from "../commands/testing.js";

import type { CliContext } from "../context.js";
import { codexPlanningInputs, constructionScreen, verifierSnapshot, manifestPayloadIdentities, matchesManifestFileIdentity, runCleanups } from "./apply-ports.js";
import { planRollback } from "./planning.js";
import { recoverUpdate } from "./apply.js";
import { applyRollback } from "./rollback-apply.js";
import { installUpdatableHome, SYNTHETIC_COORDINATOR_ID, tamperManifestBeforeVerifier, updateTo } from "./testing.js";

describe("the manifest anchor after a finalized swap (D54, K8)", () => {
  afterEach(removeCommandFixtures);

  /** `init` reads a finalized bootstrap as superseded only while the anchor names the manifest on disk. */
  function anchored(home: Awaited<ReturnType<typeof installUpdatableHome>>): { readonly anchor: string; readonly manifest: string } {
    const anchor = JSON.parse(readFileSync(join(home.fixture.paths.home, "state", "manifest-anchor.json"), "utf8")) as { manifestHash: string };
    return { anchor: anchor.manifestHash, manifest: createHash("sha256").update(readFileSync(home.fixture.paths.manifestFile)).digest("hex") };
  }

  it("re-anchors the manifest after update --apply and after update rollback --apply", async () => {
    const home = await installUpdatableHome("reanchor", "arm64");
    const installed = anchored(home);
    expect(installed.anchor).toBe(installed.manifest);

    await expect(updateTo(home.update(), "1.1.0")).resolves.toMatchObject({ outcome: "applied" });
    const updated = anchored(home);
    expect(updated.manifest).not.toBe(installed.manifest);
    expect(updated.anchor).toBe(updated.manifest);

    const update = home.update();
    await expect(applyRollback(update, await planRollback(update))).resolves.toMatchObject({ outcome: "rolled_back" });
    const rolledBack = anchored(home);
    expect(rolledBack.manifest).not.toBe(updated.manifest);
    expect(rolledBack.anchor).toBe(rolledBack.manifest);
  }, 900_000);
});

function payload(ordinal: number): UpdateExpectedPayloadRefV1 {
  return {
    kind: "update_expected",
    coordinatorId: SYNTHETIC_COORDINATOR_ID,
    ordinal,
    path: parseCanonicalAbsolutePathText(`/synthetic/staging/update/payloads/${String(ordinal)}.json`),
    hash: parseLowerHexSha256("a".repeat(64)),
    bytes: 10,
    mode: 0o600,
  };
}

function present(bytes: UpdateExpectedPayloadRefV1 | null, inline: string | null = null): ManifestBytesStateV1 {
  return {
    state: "present",
    hash: parseLowerHexSha256("a".repeat(64)),
    bytes: bytes as never,
    ownerUid: 501,
    mode: 0o600,
    nlink: 1,
    size: parseUInt64Decimal("10"),
    dev: inline === null ? null : parseUInt64Decimal(inline),
    ino: inline === null ? null : parseUInt64Decimal(inline),
  };
}

function plan(before: ManifestBytesStateV1, after: ManifestBytesStateV1): ManifestStatePlanV1 {
  return { before, after } as unknown as ManifestStatePlanV1;
}

describe("manifestPayloadIdentities (construction_evidence, D72 P2)", () => {
  const transitional = plan(present(null, "7"), present(payload(3)));
  const terminal = plan(present(payload(3)), present(payload(4)));

  it("resolves every update_expected manifest payload to its construction evidence inode, never dev = ino = 0", async () => {
    const asked: number[] = [];
    const identity = await manifestPayloadIdentities([transitional, terminal], (ref) => {
      asked.push(ref.ordinal);
      return Promise.resolve({ dev: parseUInt64Decimal(`1${String(ref.ordinal)}`), ino: parseUInt64Decimal(`2${String(ref.ordinal)}`) });
    });

    expect(identity(payload(3))).toStrictEqual({ dev: "13", ino: "23" });
    expect(identity(payload(4))).toStrictEqual({ dev: "14", ino: "24" });
    expect(asked).toStrictEqual([3, 4]);
  });

  it("refuses a payload no manifest plan names as recovery-required", async () => {
    const identity = await manifestPayloadIdentities([transitional, terminal], () => Promise.resolve({ dev: parseUInt64Decimal("1"), ino: parseUInt64Decimal("2") }));

    expect(() => identity(payload(9))).toThrow(LifecycleRecoveryRequiredError);
  });
});

describe("runCleanups (NEW-110 re-review)", () => {
  it("runs every cleanup in order and resolves even when one of them rejects", async () => {
    const ran: string[] = [];

    await expect(runCleanups([
      () => {
        ran.push("first");
        return Promise.reject(Object.assign(new Error("synthetic rm failure"), { code: "EBUSY" }));
      },
      () => {
        ran.push("second");
        return Promise.resolve();
      },
    ])).resolves.toBeUndefined();

    expect(ran).toStrictEqual(["first", "second"]);
  });
});

describe("matchesManifestFileIdentity", () => {
  const expected: Parameters<typeof matchesManifestFileIdentity>[1] = {
    hash: parseLowerHexSha256("a".repeat(64)),
    ownerUid: 501,
    mode: 0o600,
    nlink: 1,
    size: parseUInt64Decimal("10"),
    dev: parseUInt64Decimal("3"),
    ino: parseUInt64Decimal("4"),
  };
  const entry: LifecycleGuardedEntryV1 = {
    path: parseCanonicalAbsolutePathText("/synthetic/user/.developer-os/installation-manifest.json"),
    kind: "regular_file",
    ownerUid: 501,
    mode: 0o600,
    nlink: 1,
    size: parseUInt64Decimal("10"),
    dev: parseUInt64Decimal("3"),
    ino: parseUInt64Decimal("4"),
  };

  it("admits the exact ManifestFileIdentityV1 tuple", () => {
    expect(matchesManifestFileIdentity(entry, expected)).toBe(true);
  });

  it.each([
    ["another owner", { ownerUid: 502 }],
    ["a widened mode", { mode: 0o644 }],
    ["a second link", { nlink: 2 }],
    ["another size", { size: parseUInt64Decimal("11") }],
    ["another device", { dev: parseUInt64Decimal("5") }],
    ["another inode", { ino: parseUInt64Decimal("6") }],
    ["a directory", { kind: "directory" as const }],
  ])("refuses %s", (_label, change) => {
    expect(matchesManifestFileIdentity({ ...entry, ...change }, expected)).toBe(false);
  });

  it("refuses an absent entry", () => {
    expect(matchesManifestFileIdentity(null, expected)).toBe(false);
  });
});

describe("constructionScreen (W2-PORTS-1)", () => {
  const encoder = new TextEncoder();

  it("refuses without a redaction key instead of silently disabling itself", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "developer-os-screen-"));
    const context = { paths: { stateDir, configFile: join(stateDir, "config.json") } } as unknown as CliContext;
    await expect(constructionScreen(context)).rejects.toMatchObject({ reason: "update_redaction_key_absent", code: EXIT_CODES.recoveryRequired });
  });

  it("refuses staged bytes that match a user pattern", async () => {
    const context = { paths: { stateDir: "/unused", configFile: "/unused" } } as unknown as CliContext;
    const screen = await constructionScreen(context, () => Promise.resolve(createRedactor(new Uint8Array(32).fill(7), { userPatterns: ["Acme Corp"] })));
    expect(() => { screen(encoder.encode("note about Acme Corp\n"), "text"); }).toThrow(expect.objectContaining({ reason: "update_construction_secret", code: EXIT_CODES.securityRefusal }) as Error);
    expect(() => { screen(encoder.encode("plain note\n"), "text"); }).not.toThrow();
  });
});

describe("codexPlanningInputs (W2-PORTS-7)", () => {
  const uid = process.getuid?.() ?? -1;
  const lifecycle = {
    effectiveUid: uid,
    fs: createNodeLifecycleGuardedFileSystem({ effectiveUid: uid, renameNoReplace: () => Promise.reject(new Error("unused")) }),
  };
  const manifestValue = { schemaVersion: 2 };
  const record = encodeCanonicalJson({ codexHome: "/synthetic/codex", treeHash: "a".repeat(64) });

  function home(): { readonly root: string; readonly manifest: string; readonly registration: string } {
    const root = mkdtempSync(join(tmpdir(), "developer-os-codex-inputs-"));
    const manifest = join(root, "manifest.json");
    writeFileSync(manifest, encodeCanonicalJson(manifestValue), { mode: 0o600 });
    return { root, manifest, registration: join(root, "registration.json") };
  }

  const admit = (value: unknown): never => value as never;
  const path = (text: string): ReturnType<typeof parseCanonicalAbsolutePathText> => parseCanonicalAbsolutePathText(text);

  it("admits the manifest through the validator and reads a regular registration record", async () => {
    const value = home();
    writeFileSync(value.registration, record, { mode: 0o600 });
    const admitted: unknown[] = [];
    const inputs = await codexPlanningInputs(lifecycle, path(value.manifest), path(value.registration), (manifest) => {
      admitted.push(manifest);
      return manifest as never;
    });
    expect(admitted).toEqual([manifestValue]);
    expect(inputs.record).toEqual({ codexHome: "/synthetic/codex", treeHash: "a".repeat(64) });
  });

  it("refuses a symlinked manifest instead of following it", async () => {
    const value = home();
    const linked = join(value.root, "linked.json");
    symlinkSync(value.manifest, linked);
    await expect(codexPlanningInputs(lifecycle, path(linked), path(value.registration), admit)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
  });

  it("treats a symlinked or oversized registration record as unregistered, never following it", async () => {
    const value = home();
    const target = join(value.root, "elsewhere.json");
    writeFileSync(target, record, { mode: 0o600 });
    symlinkSync(target, value.registration);
    expect((await codexPlanningInputs(lifecycle, path(value.manifest), path(value.registration), admit)).record).toBeNull();

    const oversized = home();
    writeFileSync(oversized.registration, `${" ".repeat(9000)}${record}`, { mode: 0o600 });
    expect((await codexPlanningInputs(lifecycle, path(oversized.manifest), path(oversized.registration), admit)).record).toBeNull();
  });
});

describe("verifierSnapshot (NEW-118 (4))", () => {
  const uid = process.getuid?.() ?? 0;
  const lifecycle = {
    effectiveUid: uid,
    fs: createNodeLifecycleGuardedFileSystem({ effectiveUid: uid, renameNoReplace: () => Promise.reject(new Error("unused")) }),
  };
  const ref = (id: string) => ({ id, kind: "owner_update", path: `/synthetic/${id}.json` }) as never;
  const manifestAt = (size: number): string => {
    const file = join(mkdtempSync(join(tmpdir(), "developer-os-verifier-snapshot-")), "manifest.json");
    writeFileSync(file, "{}\n", { mode: 0o600 });
    truncateSync(file, size);
    return file;
  };

  it("refuses a manifest beyond the manifest maximum before encoding it", async () => {
    await expect(verifierSnapshot(lifecycle, parseCanonicalAbsolutePathText(manifestAt(67_108_865)), { owners: [], migrations: [] }, () => null)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
  });

  it("encodes a manifest at the maximum", async () => {
    const snapshot = await verifierSnapshot(lifecycle, parseCanonicalAbsolutePathText(manifestAt(10)), { owners: [], migrations: [] }, () => null) as { manifest: string };
    expect(Buffer.from(snapshot.manifest, "base64").byteLength).toBe(10);
  });

  it.each([
    ["an owner plan", { owners: [ref("owner")], migrations: [] }],
    ["a migration plan", { owners: [], migrations: [ref("migration")] }],
  ])("refuses a missing %s instead of dropping it", async (_name, execution) => {
    await expect(verifierSnapshot(lifecycle, parseCanonicalAbsolutePathText(manifestAt(10)), execution, () => null)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
  });

  it("refuses a missing owner effect plan", async () => {
    const owner = { id: "owner", externalEffects: [ref("effect")] };
    await expect(verifierSnapshot(lifecycle, parseCanonicalAbsolutePathText(manifestAt(10)), { owners: [ref("owner")], migrations: [] }, (r) => (r.id === "owner" ? owner : null))).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
  });
});

describe("the target verifier snapshot (NEW-118 (4))", () => {
  afterEach(removeCommandFixtures);

  it("compensates when the installed manifest differs from the verified transitional manifest (NEW-118 (4))", async () => {
    const home = await installUpdatableHome("verifier-snapshot", "arm64");
    const tampered = tamperManifestBeforeVerifier(home.fixture.context);
    // The rejected verifier starts the compensation, which cannot restore a manifest it did not publish: recovery-required, never a clean applied update.
    await expect(updateTo(home.update(tampered), "1.1.0")).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });
    const journals = join(home.fixture.paths.stateDir, "lifecycle-journals");
    const causes = readdirSync(journals).filter((name) => /^lc_[0-9a-f]{64}_\d+\.json$/.test(name)).map((name) => (JSON.parse(readFileSync(join(journals, name), "utf8")) as { readonly compensationCause: string | null }).compensationCause);
    expect(causes).toEqual(["update_verifier_rejected"]);
  }, 900_000);
});

describe("a compensated update's structures (NEW-118 (1), (2))", () => {
  afterEach(removeCommandFixtures);

  it("a compensated update removes the release directory it created and restores the empty reservation (NEW-118 (1), (2))", async () => {
    const home = await installUpdatableHome("compensated-structures", "arm64", { rejectingVersions: ["1.1.0"] });
    await expect(updateTo(home.update(), "1.1.0")).resolves.toMatchObject({ outcome: "rolled_back_automatically", cause: "update_verifier_rejected" });
    expect(await nodeFs.lstat(join(home.fixture.paths.home, "releases", "1.1.0")).then(() => true, () => false)).toBe(false);
    const reservation = await nodeFs.lstat(join(home.fixture.paths.stateDir, "update-rollback.json"));
    expect([reservation.size, reservation.mode & 0o777]).toEqual([0, 0o600]);
  }, 900_000);
});

type FixtureFs = NonNullable<CliContext["lifecycle"]>["fs"];
type Mutation = "writeExclusive" | "mkdirExclusive" | "renameOver" | "renameNoReplace" | "unlinkExact" | "rmdirExactEmpty";
const MUTATIONS: readonly Mutation[] = ["writeExclusive", "mkdirExclusive", "renameOver", "renameNoReplace", "unlinkExact", "rmdirExactEmpty"];

function pathsOf(args: readonly unknown[]): readonly string[] {
  return args.map((arg) => (typeof arg === "string" ? arg : (arg as { readonly path?: string } | null)?.path ?? ""));
}

/**
 * The same context whose guarded filesystem lets `around` intercept every durable mutation: it
 * returns the real call's result, or throws instead of (or after) running it.
 */
function intercepted(context: CliContext, around: (name: Mutation, paths: readonly string[], real: () => Promise<unknown>) => Promise<unknown>): CliContext {
  const lifecycle = context.lifecycle;
  if (lifecycle === undefined) throw new Error("the fixture has no lifecycle ports");
  const fs: Record<string, unknown> = { ...lifecycle.fs };
  for (const name of MUTATIONS) {
    const real = lifecycle.fs[name].bind(lifecycle.fs) as (...args: readonly unknown[]) => Promise<unknown>;
    fs[name] = (...args: readonly unknown[]): Promise<unknown> => around(name, pathsOf(args), () => real(...args));
  }
  return { ...context, lifecycle: { ...lifecycle, fs: fs as unknown as FixtureFs } };
}

/** A plain (non-recovery) error refusing the first mutation `marks` selects, as the real renameatx runner refused step 0 (NEW-241). */
function failFirst(context: CliContext, marks: (name: Mutation, path: string) => boolean): CliContext {
  let failed = false;
  return intercepted(context, (name, paths, real) => {
    if (!failed && marks(name, paths[0] ?? "")) {
      failed = true;
      return Promise.reject(new Error("synthetic step refusal"));
    }
    return real();
  });
}

/**
 * The first durable mutation of each compensable outer step before the verifier, in the one-owner
 * fixture's step order. The manifest steps (3, 4) are absent: the manifest participant turns any
 * failure into a third state (exit 6, resumed forward), so they never start compensation.
 */
const STEP_MARKS: readonly (readonly [string, (name: Mutation, path: string) => boolean])[] = [
  ["0 bundle", (name, path) => name === "mkdirExclusive" && path.endsWith("/update/journals/bundle_publication")],
  ["1 owner_files", (name, path) => name === "mkdirExclusive" && path.endsWith("/update/journals/owner_update")],
  ["2 rollback_payload", (name, path) => name === "mkdirExclusive" && path.endsWith("/update/journals/rollback_payload_state")],
  ["5 trust", (name, path) => name === "mkdirExclusive" && path.endsWith("/update/journals/release_trust_state")],
  ["6 rollback_record", (name, path) => name === "mkdirExclusive" && path.endsWith("/update/journals/rollback_record_state")],
  ["7 active", (name, path) => name === "mkdirExclusive" && path.endsWith("/update/journals/active_release_state")],
];

/** The home is back on 1.0.0 with a clear closure, no staging left and no failing doctor check. */
async function expectCleanlyRolledBack(home: Awaited<ReturnType<typeof installUpdatableHome>>): Promise<void> {
  const update = home.update();
  const ports = update.apply;
  if (ports === undefined) throw new Error("the on-disk context binds the apply ports");
  expect((await ports.withGlobalLock(() => ports.closure())).kind).toBe("clear");
  expect(await nodeFs.readdir(join(home.fixture.paths.home, "staging", "lifecycle")).catch(() => [])).toEqual([]);
  expect((await update.readHome()).active.version).toBe("1.0.0");
  expect((await runDoctorReport(home.fixture.context)).checks.filter((check) => check.status === "fail")).toEqual([]);
}

describe("a step that fails before the verifier compensates and compacts cleanly (NEW-241)", () => {
  afterEach(removeCommandFixtures);

  it.each(STEP_MARKS)("fails at step %s, rolls back automatically and leaves no unremovable payload", async (_step, marks) => {
    const home = await installUpdatableHome("step-failure", "arm64");
    await expect(updateTo(home.update(failFirst(home.fixture.context, marks)), "1.1.0")).resolves.toMatchObject({ outcome: "rolled_back_automatically" });
    await expectCleanlyRolledBack(home);
  }, 900_000);
});

class StuckHomeDeath extends Error {}

/**
 * The VM evidence's shape (NEW-241), built over real ports: step 0 refused, the state participants'
 * compaction left their unconsumed payloads (the pre-fix behavior), and the process died once the
 * construction cursor reached the first of them, so the outer journal sits at `coordinator_staging`.
 * Returns that present payload row's path.
 */
async function stuckOnLeftoverPayload(home: Awaited<ReturnType<typeof installUpdatableHome>>): Promise<string> {
  const fail = failFirst(home.fixture.context, (name, path) => name === "mkdirExclusive" && path.endsWith("/update/journals/bundle_publication"));
  const stuck = { row: "" };
  const dying = intercepted(fail, async (name, paths, real) => {
    if (stuck.row !== "") throw new StuckHomeDeath();
    if (name === "unlinkExact" && paths[0]?.includes("/update/payloads/state/") === true) return undefined;
    const result = await real();
    const journalPath = paths[1] ?? "";
    if (name === "renameOver" && journalPath.endsWith("/update-construction.journal.json")) {
      const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { readonly phase: string; readonly compactionNext: number | null };
      const plan = JSON.parse(readFileSync(journalPath.replace(/journal\.json$/u, "plan.json"), "utf8")) as { readonly files: readonly { readonly path: string }[] };
      const cursor = journal.compactionNext ?? -1;
      const row = plan.files[plan.files.length - 1 - cursor / 2];
      if (journal.phase === "compacting" && cursor % 2 === 0 && row?.path.includes("/update/payloads/state/") === true) {
        stuck.row = row.path;
        throw new StuckHomeDeath();
      }
    }
    return result;
  });
  await expect(updateTo(home.update(dying), "1.1.0")).rejects.toBeInstanceOf(StuckHomeDeath);
  if (stuck.row === "") throw new Error("the construction compaction never reached a state payload row");
  expect(await nodeFs.lstat(stuck.row).then(() => true, () => false)).toBe(true);
  return stuck.row;
}

describe("a home stuck on leftover state payloads at construction compaction (NEW-241)", () => {
  afterEach(removeCommandFixtures);

  it("recovers through construction compaction without manual edits", async () => {
    const home = await installUpdatableHome("stuck-payloads", "arm64");
    const stuckRow = await stuckOnLeftoverPayload(home);

    await recoverUpdate(home.update());

    expect(await nodeFs.lstat(stuckRow).then(() => true, () => false)).toBe(false);
    await expectCleanlyRolledBack(home);
  }, 900_000);

  it("refuses a leftover payload whose bytes changed on the same inode, then recovers once they are restored", async () => {
    const home = await installUpdatableHome("stuck-payloads-changed", "arm64");
    const stuckRow = await stuckOnLeftoverPayload(home);
    const original = readFileSync(stuckRow);
    writeFileSync(stuckRow, "{\"tampered\":true}\n");

    await expect(recoverUpdate(home.update())).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });
    expect(await nodeFs.lstat(stuckRow).then(() => true, () => false)).toBe(true);

    writeFileSync(stuckRow, original);
    await recoverUpdate(home.update());
    await expectCleanlyRolledBack(home);
  }, 900_000);
});
