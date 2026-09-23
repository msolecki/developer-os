import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createNodeLifecycleGuardedFileSystem,
  LifecycleRecoveryRequiredError,
  parseCanonicalAbsolutePathText,
  parseLowerHexSha256,
  parseSafeReasonCode,
  updateTerminalRetirementPlanBytes,
  updateTerminalRetirementPlanRef,
  type CanonicalAbsolutePathV1,
  type ImmutableUpdatePlanRefV1,
  type LifecycleCoordinatorIdV1,
  type LowerHexSha256,
  type RetirementLeafV1,
  type UpdateRetirementSetV1,
  type UpdateTerminalRetirementPlanV1,
} from "@developer-os/core";
import { afterEach, describe, expect, it } from "vitest";

import { UpdateRetirementParticipant, type UpdateRetirementDeathPointV1 } from "./retirement-participant.js";

const sha = (value: string): LowerHexSha256 => parseLowerHexSha256(createHash("sha256").update(value).digest("hex"));
const coordinatorId = `lc_${"e".repeat(64)}_41` as LifecycleCoordinatorIdV1;
const payloadDirectory = `rb_${"c".repeat(64)}_9`;
const uid = process.getuid?.() ?? -1;
const homes: string[] = [];
const files: readonly { readonly name: string; readonly content: string }[] = [
  { name: "blobs/b1", content: "synthetic blob\n" },
  { name: "inverse-plan.json", content: '{"synthetic":"inverse"}\n' },
  { name: "inventory.json", content: '{"synthetic":"inventory"}\n' },
];

class Killed extends Error {}

afterEach(async () => {
  for (const home of homes.splice(0)) await nodeFs.rm(home, { recursive: true, force: true });
});

interface Fixture {
  readonly home: CanonicalAbsolutePathV1;
  readonly root: CanonicalAbsolutePathV1;
  readonly payloadRoot: CanonicalAbsolutePathV1;
  readonly leaves: readonly RetirementLeafV1[];
  readonly ref: ImmutableUpdatePlanRefV1<"terminal_retirement">;
}

const step = (set: UpdateRetirementSetV1 = "prior_rollback") => ({ kind: "terminal_retire", set }) as const;

function participant(fixture: Fixture, interrupt?: (point: UpdateRetirementDeathPointV1) => void): UpdateRetirementParticipant {
  const fs = createNodeLifecycleGuardedFileSystem({
    effectiveUid: uid,
    renameNoReplace: async ({ sourcePath, destinationPath }) => {
      await nodeFs.link(sourcePath, destinationPath);
      await nodeFs.unlink(sourcePath);
    },
  });
  return new UpdateRetirementParticipant({ fs, effectiveUid: uid, resolve: () => Promise.resolve(fixture.leaves), ...(interrupt === undefined ? {} : { interrupt }) }, fixture.root, fixture.ref);
}

async function exists(path: string): Promise<boolean> {
  return nodeFs.lstat(path).then(() => true, () => false);
}

/** A retained synthetic rollback payload and a staged retirement plan that retires it. */
async function fixture(set: UpdateRetirementSetV1 = "prior_rollback"): Promise<Fixture> {
  const home = parseCanonicalAbsolutePathText(await nodeFs.realpath(await nodeFs.mkdtemp(join(tmpdir(), "dos-retirement-"))));
  homes.push(home);
  const root = parseCanonicalAbsolutePathText(`${home}/staging/lifecycle/${coordinatorId}`);
  const payloadRoot = parseCanonicalAbsolutePathText(`${home}/rollback/${payloadDirectory}`);
  await nodeFs.mkdir(`${root}/update/plans/terminal_retirement`, { recursive: true, mode: 0o700 });
  await nodeFs.mkdir(`${payloadRoot}/blobs`, { recursive: true, mode: 0o700 });
  for (const file of files) await nodeFs.writeFile(`${payloadRoot}/${file.name}`, file.content, { mode: 0o600, flag: "wx" });
  const leaves: RetirementLeafV1[] = [
    ...files.map((file): RetirementLeafV1 => ({ path: parseCanonicalAbsolutePathText(`${payloadRoot}/${file.name}`), kind: "file", bytes: file.name.startsWith("blobs/") ? Buffer.byteLength(file.content) : null, sha256: sha(file.content) })),
    { path: parseCanonicalAbsolutePathText(`${payloadRoot}/blobs`), kind: "directory", bytes: null, sha256: null },
    { path: payloadRoot, kind: "directory", bytes: null, sha256: null },
  ];
  const plan: UpdateTerminalRetirementPlanV1 = {
    schemaVersion: 1,
    id: parseSafeReasonCode("terminal_retirement"),
    coordinatorId,
    set,
    transitionalManifestHash: sha("transitional manifest"),
    entries: [{ kind: "rollback_payload", root: payloadRoot, inventoryHash: sha("inventory"), leafCount: leaves.length }],
    maximumLeaves: leaves.length,
    maximumPlanBytes: 65_536,
  };
  const ref = updateTerminalRetirementPlanRef(plan, root);
  await nodeFs.writeFile(ref.path, updateTerminalRetirementPlanBytes(plan), { mode: 0o600, flag: "wx" });
  return { home, root, payloadRoot, leaves, ref };
}

async function retireFrom(handler: UpdateRetirementParticipant, from: number, set: UpdateRetirementSetV1 = "prior_rollback"): Promise<void> {
  const maximum = await handler.leaves(step(set));
  for (let ordinal = from; ordinal < maximum; ordinal += 1) await handler.retire(step(set), ordinal);
}

describe("UpdateRetirementParticipant", () => {
  it.each<UpdateRetirementSetV1>(["prior_rollback", "consumed_rollback_and_rejected_release"])("retires every %s leaf in cursor order and keeps the shared parent", async (set) => {
    const found = await fixture(set);
    const handler = participant(found);
    expect(await handler.leaves(step(set))).toBe(found.leaves.length);
    await retireFrom(handler, 0, set);
    expect(await exists(found.payloadRoot)).toBe(false);
    expect(await exists(`${found.home}/rollback`)).toBe(true);
  });

  it("refuses a step whose set is not the plan's", async () => {
    const found = await fixture("prior_rollback");
    await expect(participant(found).leaves(step("consumed_rollback_and_rejected_release"))).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
  });

  it("refuses an ordinal outside the flattened leaves", async () => {
    const found = await fixture();
    await expect(participant(found).retire(step(), found.leaves.length)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
  });

  it("refuses a plan whose bytes are not its ref", async () => {
    const found = await fixture();
    await expect(participant({ ...found, ref: { ...found.ref, hash: sha("other") } }).leaves(step())).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    await nodeFs.rm(found.ref.path);
    await expect(participant(found).leaves(step())).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
  });

  it("resumes at every retirementNext after dying once the leaf was removed", async () => {
    for (let cursor = 0; cursor < 5; cursor += 1) {
      const found = await fixture();
      let removed = 0;
      const dying = participant(found, () => {
        if (removed++ === cursor) throw new Killed(`leaf ${String(cursor)}`);
      });
      await expect(retireFrom(dying, 0)).rejects.toBeInstanceOf(Killed);
      expect(await exists(found.leaves[cursor]?.path as string)).toBe(false);
      await retireFrom(participant(found), cursor);
      expect(await exists(found.payloadRoot)).toBe(false);
    }
  });

  it("refuses a mutated file of the same size and preserves it", async () => {
    const found = await fixture();
    const blob = found.leaves[0]?.path as string;
    await nodeFs.writeFile(blob, "synthetic blub\n");
    await expect(participant(found).retire(step(), 0)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(await exists(blob)).toBe(true);
  });

  it("refuses a file with a second link", async () => {
    const found = await fixture();
    await nodeFs.link(found.leaves[1]?.path as string, `${found.home}/extra-link`);
    await expect(participant(found).retire(step(), 1)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
  });

  it("refuses a symlink where a file leaf was planned", async () => {
    const found = await fixture();
    const blob = found.leaves[0]?.path as string;
    await nodeFs.rm(blob);
    await nodeFs.symlink(`${found.home}/elsewhere`, blob);
    await expect(participant(found).retire(step(), 0)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
  });

  it("refuses a directory leaf that still has an unplanned child", async () => {
    const found = await fixture();
    const handler = participant(found);
    for (let ordinal = 0; ordinal < 3; ordinal += 1) await handler.retire(step(), ordinal);
    await nodeFs.writeFile(`${found.payloadRoot}/blobs/unplanned`, "x", { mode: 0o600 });
    await expect(handler.retire(step(), 3)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(await exists(`${found.payloadRoot}/blobs/unplanned`)).toBe(true);
  });

  it("accepts an absent leaf only while its parent is present", async () => {
    const found = await fixture();
    await nodeFs.rm(found.payloadRoot, { recursive: true });
    await expect(participant(found).retire(step(), 0)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
  });
});
