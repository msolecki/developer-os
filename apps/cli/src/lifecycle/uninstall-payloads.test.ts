import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  LifecycleRecoveryRequiredError,
  MAXIMUM_BUNDLE_FILE_BYTES,
  createNodeLifecycleGuardedFileSystem,
  encodeCanonicalJson,
  formatAllocatedLifecycleId,
  parseCanonicalAbsolutePathText,
  parseLifecycleCoordinatorId,
  parseLowerHexSha256,
  parseUInt64Decimal,
} from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  LifecycleCodecContextV1,
  LifecycleGuardedFileSystemV1,
} from "@developer-os/core";

import { createRedactionKeyStatePlanCodec } from "./redaction-key.js";
import {
  MAX_MUTATION_BYTES,
  MAX_UNINSTALL_ARTIFACTS,
  deletePayloads,
  observePayloads,
  restorePayloads,
  stagePayloads,
  uninstallPayloadPath,
} from "./uninstall-payloads.js";
import type { UninstallPayloadV1 } from "./uninstall-payloads.js";

const UID = process.getuid?.() ?? 0;
const NONCE = parseLowerHexSha256("7a".repeat(32));
const COORDINATOR = parseLifecycleCoordinatorId(formatAllocatedLifecycleId("lc", NONCE, 1n), NONCE);
const LARGE = MAX_MUTATION_BYTES + 1_048_576;

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await nodeFs.rm(root, { recursive: true, force: true });
});

function path(text: string): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(text);
}

function guardedFs(): LifecycleGuardedFileSystemV1 {
  return createNodeLifecycleGuardedFileSystem({
    effectiveUid: UID,
    renameNoReplace: async ({ sourcePath, destinationPath }) => {
      await nodeFs.link(sourcePath, destinationPath);
      await nodeFs.unlink(sourcePath);
    },
  });
}

async function sha256Of(file: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk as Buffer);
  return digest.digest("hex");
}

interface Fixture {
  readonly home: CanonicalAbsolutePathV1;
  readonly staging: CanonicalAbsolutePathV1;
  readonly fs: LifecycleGuardedFileSystemV1;
}

async function fixture(): Promise<Fixture> {
  const root = await nodeFs.realpath(await nodeFs.mkdtemp(join(tmpdir(), "dos-payloads-")));
  roots.push(root);
  const home = path(`${root}/home`);
  const staging = path(`${home}/staging/lifecycle/${COORDINATOR}`);
  await nodeFs.mkdir(`${home}/bin`, { recursive: true, mode: 0o700 });
  await nodeFs.mkdir(staging, { recursive: true, mode: 0o700 });
  await nodeFs.chmod(home, 0o700);
  return { home, staging, fs: guardedFs() };
}

/** A sparse file: 17 MiB on paper, a few bytes on disk. */
async function plant(value: Fixture, ordinal: number, name: string, mode: 0o600 | 0o700 = 0o700): Promise<UninstallPayloadV1> {
  const source = `${value.home}/bin/${name}`;
  await nodeFs.writeFile(source, `payload ${name}\n`, { mode });
  await nodeFs.truncate(source, LARGE);
  await nodeFs.chmod(source, mode);
  const stats = await nodeFs.lstat(source, { bigint: true });
  return {
    sourcePath: path(source),
    payloadPath: uninstallPayloadPath(value.home, COORDINATOR, ordinal),
    mode,
    size: LARGE,
    dev: parseUInt64Decimal(stats.dev.toString(10)),
    ino: parseUInt64Decimal(stats.ino.toString(10)),
    sha256: parseLowerHexSha256(await sha256Of(source)),
  };
}

async function exists(file: string): Promise<boolean> {
  return nodeFs.lstat(file).then(
    () => true,
    () => false,
  );
}

async function identity(file: string): Promise<string> {
  const stats = await nodeFs.lstat(file, { bigint: true });
  return `${stats.dev.toString(10)}:${stats.ino.toString(10)}`;
}

async function refusal(promise: Promise<unknown>): Promise<LifecycleRecoveryRequiredError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(LifecycleRecoveryRequiredError);
  expect((error as LifecycleRecoveryRequiredError).code).toBe(6);
  return error as LifecycleRecoveryRequiredError;
}

/** Re-creates the payload under the same name with a new inode. */
async function swapInode(file: string): Promise<void> {
  await nodeFs.copyFile(file, `${file}.swap`);
  await nodeFs.unlink(file);
  await nodeFs.rename(`${file}.swap`, file);
}

describe("the K plan codec v2", () => {
  const HOME = path("/product");
  const CONTEXT: LifecycleCodecContextV1 = { productHome: HOME, nonce: NONCE };
  const codec = createRedactionKeyStatePlanCodec(CONTEXT);
  const v1 = {
    schemaVersion: 1,
    coordinatorId: COORDINATOR,
    sourcePath: "/product/state/redaction.key",
    tombstonePath: `/product/state/.redaction.key.${COORDINATOR}.tombstone`,
    before: { state: "absent" },
  };
  const payload = {
    sourcePath: "/product/releases/r1/bin/node",
    payloadPath: `/product/staging/lifecycle/${COORDINATOR}/payloads/0`,
    mode: 448,
    size: LARGE,
    dev: "16777220",
    ino: "1152921500312571551",
    sha256: "ab".repeat(32),
  };
  const v2 = { ...v1, schemaVersion: 2, payloads: [payload] };

  it("decodes v1 as no payloads and re-encodes it byte-identically", () => {
    const decoded = codec.validate(v1);
    expect(decoded.payloads).toStrictEqual([]);
    const text = codec.encode(decoded);
    expect(text).toBe(encodeCanonicalJson(v1));
    expect(codec.encode(codec.validate(JSON.parse(text)))).toBe(text);
  });

  it("round-trips v2", () => {
    const decoded = codec.validate(v2);
    expect(decoded).toStrictEqual(v2);
    expect(codec.validate(JSON.parse(codec.encode(decoded)))).toStrictEqual(v2);
    expect(codec.validate({ ...v1, schemaVersion: 2, payloads: [] }).payloads).toStrictEqual([]);
  });

  it("refuses a v1 plan carrying payloads and a v2 plan without them", () => {
    expect(codec.validate({ ...v1, payloads: [] })).toStrictEqual(codec.validate(v1));
    expect(() => codec.validate({ ...v1, payloads: [payload] })).toThrow(/v1 payloads/u);
    expect(() => codec.validate({ ...v1, schemaVersion: 2 })).toThrow(/keys/u);
  });

  it.each([
    ["a payloadPath not derived from the ordinal", { payloadPath: `/product/staging/lifecycle/${COORDINATOR}/payloads/1` }, /payloadPath/u],
    ["a source outside the home", { sourcePath: "/elsewhere/node" }, /sourcePath/u],
    ["a source under staging/", { sourcePath: "/product/staging/node" }, /sourcePath/u],
    ["a source under state/", { sourcePath: "/product/state/node" }, /sourcePath/u],
    ["a source under Staging/ (case-folded)", { sourcePath: "/product/Staging/node" }, /sourcePath/u],
    ["a source under STATE/ (case-folded)", { sourcePath: "/product/STATE/node" }, /sourcePath/u],
    ["a size of exactly 16 MiB", { size: MAX_MUTATION_BYTES }, /size/u],
    ["a size above the bundle bound", { size: MAXIMUM_BUNDLE_FILE_BYTES + 1 }, /size/u],
    ["a mode other than 0600/0700", { mode: 420 }, /mode/u],
  ])("refuses %s", (_name, patch, pattern) => {
    expect(() => codec.validate({ ...v2, payloads: [{ ...payload, ...patch }] })).toThrow(pattern);
  });

  it("admits the bounds' edges and refuses a duplicate source and an oversize list", () => {
    for (const size of [MAX_MUTATION_BYTES + 1, MAXIMUM_BUNDLE_FILE_BYTES]) {
      expect(codec.validate({ ...v2, payloads: [{ ...payload, size }] }).payloads[0]?.size).toBe(size);
    }
    expect(() =>
      codec.validate({
        ...v2,
        payloads: [payload, { ...payload, payloadPath: `/product/staging/lifecycle/${COORDINATOR}/payloads/1` }],
      }),
    ).toThrow(/duplicate/u);
    expect(() =>
      codec.validate({
        ...v2,
        payloads: [
          payload,
          {
            ...payload,
            sourcePath: payload.sourcePath.toUpperCase().replace("/PRODUCT/", "/product/"),
            payloadPath: `/product/staging/lifecycle/${COORDINATOR}/payloads/1`,
          },
        ],
      }),
    ).toThrow(/duplicate/u);
    const many = Array.from({ length: MAX_UNINSTALL_ARTIFACTS + 1 }, (_, ordinal) => ({
      ...payload,
      sourcePath: `/product/bin/${String(ordinal)}`,
      payloadPath: `/product/staging/lifecycle/${COORDINATOR}/payloads/${String(ordinal)}`,
    }));
    expect(() => codec.validate({ ...v2, payloads: many })).toThrow(/UninstallPayloadV1\[\]$/u);
  });
});

describe("the payload move", () => {
  it("stages then restores the same inode byte-identically", async () => {
    const value = await fixture();
    const payload = await plant(value, 0, "node");
    const before = await identity(payload.sourcePath);
    expect(await observePayloads(value.fs, UID, [payload])).toBe("before");

    await stagePayloads(value.fs, UID, value.staging, [payload]);
    expect(await exists(payload.sourcePath)).toBe(false);
    expect((await nodeFs.lstat(`${value.staging}/payloads`)).mode & 0o777).toBe(0o700);
    expect(await observePayloads(value.fs, UID, [payload])).toBe("staged");

    await restorePayloads(value.fs, UID, [payload]);
    expect(await exists(payload.payloadPath)).toBe(false);
    expect(await identity(payload.sourcePath)).toBe(before);
    expect(await sha256Of(payload.sourcePath)).toBe(payload.sha256);
    expect((await nodeFs.lstat(payload.sourcePath)).mode & 0o777).toBe(0o700);
    expect(await observePayloads(value.fs, UID, [payload])).toBe("before");
  });

  it("stages then deletes, leaving neither path", async () => {
    const value = await fixture();
    const payload = await plant(value, 0, "node", 0o600);
    const reached: string[] = [];
    await stagePayloads(value.fs, UID, value.staging, [payload], (b) => {
      reached.push(`${b.kind}:${String(b.ordinal)}`);
    });
    await deletePayloads(value.fs, UID, [payload], (b) => {
      reached.push(`${b.kind}:${String(b.ordinal)}`);
    });
    expect(reached).toStrictEqual(["payload_staged:0", "payload_deleted:0"]);
    expect(await exists(payload.sourcePath)).toBe(false);
    expect(await exists(payload.payloadPath)).toBe(false);
    expect(await observePayloads(value.fs, UID, [payload])).toBe("deleted");
    await deletePayloads(value.fs, UID, [payload]);
  });

  it("does nothing for an empty list", async () => {
    const value = await fixture();
    await stagePayloads(value.fs, UID, value.staging, []);
    expect(await exists(`${value.staging}/payloads`)).toBe(false);
    expect(await observePayloads(value.fs, UID, [])).toBe("deleted");
  });
});

describe("observePayloads", () => {
  it("aggregates before+staged to before and staged+deleted to staged", async () => {
    const value = await fixture();
    const first = await plant(value, 0, "a");
    const second = await plant(value, 1, "b");
    await stagePayloads(value.fs, UID, value.staging, [first]);
    expect(await observePayloads(value.fs, UID, [first, second])).toBe("before");
    await stagePayloads(value.fs, UID, value.staging, [first, second]);
    expect(await observePayloads(value.fs, UID, [first, second])).toBe("staged");
    await deletePayloads(value.fs, UID, [first]);
    expect(await observePayloads(value.fs, UID, [first, second])).toBe("staged");
  });

  it("refuses before beside deleted, preserving everything", async () => {
    const value = await fixture();
    const first = await plant(value, 0, "a");
    const second = await plant(value, 1, "b");
    await stagePayloads(value.fs, UID, value.staging, [first]);
    await deletePayloads(value.fs, UID, [first]);
    const error = await refusal(observePayloads(value.fs, UID, [first, second]));
    expect(error.reason).toBe("uninstall_payload_state");
    expect(await exists(second.sourcePath)).toBe(true);
  });

  it("refuses an entry present under both names", async () => {
    const value = await fixture();
    const payload = await plant(value, 0, "a");
    await stagePayloads(value.fs, UID, value.staging, [payload]);
    await nodeFs.copyFile(payload.payloadPath, payload.sourcePath);
    expect((await refusal(observePayloads(value.fs, UID, [payload]))).reason).toBe("uninstall_payload_state");
    expect(await exists(payload.payloadPath)).toBe(true);
    expect(await exists(payload.sourcePath)).toBe(true);
  });

  it("refuses a wrong identity at either name", async () => {
    const value = await fixture();
    const payload = await plant(value, 0, "a");
    await nodeFs.chmod(payload.sourcePath, 0o600);
    expect((await refusal(observePayloads(value.fs, UID, [payload]))).reason).toBe("uninstall_payload_state");
    await nodeFs.chmod(payload.sourcePath, 0o700);
    await stagePayloads(value.fs, UID, value.staging, [payload]);
    await swapInode(payload.payloadPath);
    expect((await refusal(observePayloads(value.fs, UID, [payload]))).reason).toBe("uninstall_payload_state");
  });
});

describe("refused and preserved", () => {
  async function refusedStage(value: Fixture, payload: UninstallPayloadV1, uid = UID): Promise<void> {
    await refusal(stagePayloads(value.fs, uid, value.staging, [payload]));
    expect(await exists(payload.sourcePath)).toBe(true);
    expect(await exists(payload.payloadPath)).toBe(false);
  }

  it("a symlink source", async () => {
    const value = await fixture();
    const payload = await plant(value, 0, "a");
    await nodeFs.rename(payload.sourcePath, `${value.home}/bin/target`);
    await nodeFs.symlink(`${value.home}/bin/target`, payload.sourcePath);
    await refusedStage(value, payload);
    expect((await nodeFs.lstat(payload.sourcePath)).isSymbolicLink()).toBe(true);
  });

  it("a wrong owner or mode", async () => {
    const value = await fixture();
    const payload = await plant(value, 0, "a");
    await refusedStage(value, payload, UID + 1);
    await nodeFs.chmod(payload.sourcePath, 0o644);
    await refusedStage(value, payload);
  });

  it("a second hard link", async () => {
    const value = await fixture();
    const payload = await plant(value, 0, "a");
    await nodeFs.link(payload.sourcePath, `${value.home}/bin/alias`);
    await refusedStage(value, payload);
  });

  it("a same-size content edit", async () => {
    const value = await fixture();
    const payload = await plant(value, 0, "a");
    const handle = await nodeFs.open(payload.sourcePath, "r+");
    await handle.write("X", 0);
    await handle.close();
    const error = await refusal(stagePayloads(value.fs, UID, value.staging, [payload]));
    expect(error.reason).toBe("uninstall_payload_hash");
    expect(await exists(payload.sourcePath)).toBe(true);
    expect(await exists(payload.payloadPath)).toBe(false);
  });

  it.each(["restore", "delete"] as const)("an inode swapped at the payload path before %s", async (transition) => {
    const value = await fixture();
    const payload = await plant(value, 0, "a");
    await stagePayloads(value.fs, UID, value.staging, [payload]);
    await swapInode(payload.payloadPath);
    const run = transition === "restore" ? restorePayloads(value.fs, UID, [payload]) : deletePayloads(value.fs, UID, [payload]);
    expect((await refusal(run)).reason).toBe("uninstall_payload_identity");
    expect(await exists(payload.payloadPath)).toBe(true);
    expect(await exists(payload.sourcePath)).toBe(false);
  });

  it("a source whose parent is not 0700", async () => {
    const value = await fixture();
    const payload = await plant(value, 0, "a");
    await nodeFs.chmod(`${value.home}/bin`, 0o755);
    await refusedStage(value, payload);
    expect(await identity(payload.sourcePath)).toBe(`${payload.dev}:${payload.ino}`);
  });

  it("delete of an entry still at before", async () => {
    const value = await fixture();
    const payload = await plant(value, 0, "a");
    expect((await refusal(deletePayloads(value.fs, UID, [payload]))).reason).toBe("uninstall_payload_identity");
    expect(await identity(payload.sourcePath)).toBe(`${payload.dev}:${payload.ino}`);
  });

  it("restore over a source that came back with a new inode while staged", async () => {
    const value = await fixture();
    const payload = await plant(value, 0, "a");
    await stagePayloads(value.fs, UID, value.staging, [payload]);
    await nodeFs.copyFile(payload.payloadPath, payload.sourcePath);
    await nodeFs.chmod(payload.sourcePath, 0o700);
    const intruder = await identity(payload.sourcePath);
    expect((await refusal(restorePayloads(value.fs, UID, [payload]))).reason).toBe("uninstall_payload_identity");
    expect(await identity(payload.sourcePath)).toBe(intruder);
    expect(await identity(payload.payloadPath)).toBe(`${payload.dev}:${payload.ino}`);
  });

  it("restore of a staged payload that vanished, leaving the other entries in place", async () => {
    const value = await fixture();
    const first = await plant(value, 0, "a");
    const second = await plant(value, 1, "b");
    const payloads = [first, second];
    await stagePayloads(value.fs, UID, value.staging, payloads);
    await nodeFs.unlink(second.payloadPath);
    expect((await refusal(restorePayloads(value.fs, UID, payloads))).reason).toBe("uninstall_payload_identity");
    expect(await identity(first.payloadPath)).toBe(`${first.dev}:${first.ino}`);
    expect(await exists(first.sourcePath)).toBe(false);
  });

  it("a payloads directory that is not owner-held 0700", async () => {
    const value = await fixture();
    const payload = await plant(value, 0, "a");
    await nodeFs.mkdir(`${value.staging}/payloads`, { mode: 0o755 });
    await nodeFs.chmod(`${value.staging}/payloads`, 0o755);
    expect((await refusal(stagePayloads(value.fs, UID, value.staging, [payload]))).reason).toBe("uninstall_payload_parent");
    expect(await exists(payload.sourcePath)).toBe(true);
  });
});

describe("idempotence", () => {
  it("resumes a stage interrupted after entry 0 of 2", async () => {
    const value = await fixture();
    const payloads = [await plant(value, 0, "a"), await plant(value, 1, "b")];
    await expect(
      stagePayloads(value.fs, UID, value.staging, payloads, (b) => {
        if (b.ordinal === 0) throw new Error("killed");
      }),
    ).rejects.toThrow("killed");
    expect(await observePayloads(value.fs, UID, payloads)).toBe("before");
    await stagePayloads(value.fs, UID, value.staging, payloads);
    expect(await observePayloads(value.fs, UID, payloads)).toBe("staged");
    for (const payload of payloads) expect(await exists(payload.sourcePath)).toBe(false);
  });

  it("restores every entry after a partial stage", async () => {
    const value = await fixture();
    const payloads = [await plant(value, 0, "a"), await plant(value, 1, "b")];
    const identities = await Promise.all(payloads.map((payload) => identity(payload.sourcePath)));
    await stagePayloads(value.fs, UID, value.staging, payloads.slice(0, 1));
    await restorePayloads(value.fs, UID, payloads);
    expect(await Promise.all(payloads.map((payload) => identity(payload.sourcePath)))).toStrictEqual(identities);
    expect(await observePayloads(value.fs, UID, payloads)).toBe("before");
    await restorePayloads(value.fs, UID, payloads);
  });
});
