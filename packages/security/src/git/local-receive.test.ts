import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";

import {
  parseCanonicalAbsolutePathText,
  parseFullBranchRef,
  type GitRefStateV1,
  type LowerHexSha1,
  type LowerHexSha256,
} from "@developer-os/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prepareLocalReceive, type GitLocalReceiveRequestV1, type GitLocalReceiveRunV1 } from "./local-receive.js";
import { buildPack, smallClosure, type PackFixtureV1 } from "./pack.test-fixtures.js";
import { materializeSanitizedBareDestinationShadow, validateShadowConfigTemplate, type SanitizedBareDestinationShadowV1 } from "./shadow.js";

const UID = process.getuid?.() ?? 0;
const BRANCH = parseFullBranchRef("refs/heads/main");
const RECEIVE_ONLY: GitLocalReceiveRunV1["nodes"] = ["gateway_receive_pack", "real_receive_pack"];
const WITH_INDEX: GitLocalReceiveRunV1["nodes"] = ["gateway_receive_pack", "real_receive_pack", "gateway_index_git", "real_index_git"];

const destinationTemplate = validateShadowConfigTemplate({
  schemaVersion: 1,
  kind: "bare_destination",
  core: { repositoryFormatVersion: 0, fileMode: true, bare: true, hooksPath: { slot: "hooks_directory" }, fsmonitor: false },
  commit: { gpgSign: false },
  tag: { gpgSign: false },
  gc: { auto: 0 },
  maintenance: { auto: false },
  http: { proxy: "", followRedirects: false },
  credential: { helper: "" },
  remote: null,
  receive: { unpackLimit: 0, denyNonFastForwards: true, denyDeletes: false },
});

let root: string;

beforeEach(async () => {
  root = await nodeFs.realpath(await nodeFs.mkdtemp(`${tmpdir()}/developer-os-local-receive-`));
});

afterEach(async () => {
  await nodeFs.rm(root, { recursive: true, force: true });
});

interface ReceiveFixture {
  readonly request: GitLocalReceiveRequestV1;
  readonly shadow: SanitizedBareDestinationShadowV1;
  readonly destinationPackDirectory: string;
  quarantineExists(): Promise<boolean>;
  destinationPackFiles(): Promise<readonly string[]>;
}

interface ReceiveOptions {
  readonly commitOid: LowerHexSha1;
  /** The real destination target ref; also the shadow's validated snapshot. */
  readonly target: LowerHexSha1 | null;
  readonly boundary?: readonly LowerHexSha1[];
  /** What the fixed helper graph does inside the private shadow. */
  readonly run: (shadow: SanitizedBareDestinationShadowV1) => Promise<GitLocalReceiveRunV1>;
}

function refState(oid: LowerHexSha1 | null): GitRefStateV1 {
  return oid === null ? { state: "absent" } : { state: "present", oid, bytesHash: "0".repeat(64) as LowerHexSha256 };
}

async function receiveFixture(options: ReceiveOptions): Promise<ReceiveFixture> {
  const quarantine = parseCanonicalAbsolutePathText(`${root}/staging/lifecycle/c1/git/destination/ge1`);
  await nodeFs.mkdir(quarantine, { recursive: true, mode: 0o700 });
  await nodeFs.chmod(quarantine, 0o700);
  const gitDirectory = parseCanonicalAbsolutePathText(`${root}/remote.git`);
  const destinationPackDirectory = `${gitDirectory}/objects/pack`;
  await nodeFs.mkdir(destinationPackDirectory, { recursive: true });
  const shadow = await materializeSanitizedBareDestinationShadow({
    gitDir: parseCanonicalAbsolutePathText(`${quarantine}/shadow`),
    template: destinationTemplate,
    opaqueLocalToken: null,
    head: new TextEncoder().encode(`ref: ${BRANCH}\n`),
    refs: options.target === null ? [] : [{ ref: BRANCH, bytes: new TextEncoder().encode(`${options.target}\n`) }],
    effectiveUid: UID,
  });
  return {
    shadow,
    destinationPackDirectory,
    request: {
      quarantineRoot: quarantine,
      destinationShadow: shadow,
      destination: { gitDirectory, branchRef: BRANCH, target: refState(options.target) },
      commitOid: options.commitOid,
      boundary: new Set(options.boundary ?? []),
      phase: { remainingMilliseconds: () => 600000 },
      effectiveUid: UID,
      receive: () => options.run(shadow),
    },
    async quarantineExists() {
      return nodeFs
        .lstat(quarantine)
        .then(() => true)
        .catch(() => false);
    },
    async destinationPackFiles() {
      return (await nodeFs.readdir(destinationPackDirectory)).sort();
    },
  };
}

/** What `receive-pack` + `index-pack --keep` leave in the shadow for one ref-update command. */
async function receivePack(shadow: SanitizedBareDestinationShadowV1, pack: PackFixtureV1, commitOid: LowerHexSha1): Promise<void> {
  const stem = `${shadow.objectDirectory}/pack/pack-${pack.checksum}`;
  await nodeFs.writeFile(`${stem}.pack`, pack.pack, { mode: 0o444 });
  await nodeFs.writeFile(`${stem}.idx`, pack.index, { mode: 0o444 });
  await nodeFs.writeFile(`${stem}.keep`, "receive-pack 4242 on synthetic.invalid\n", { mode: 0o600 });
  await nodeFs.mkdir(`${shadow.gitDir}/refs/heads`, { recursive: true });
  await nodeFs.writeFile(`${shadow.gitDir}/${BRANCH}`, `${commitOid}\n`);
}

function packedRun(pack: PackFixtureV1, commitOid: LowerHexSha1, count: number): ReceiveOptions["run"] {
  return async (shadow) => {
    await receivePack(shadow, pack, commitOid);
    return { nodes: WITH_INDEX, packHeaderObjectCount: count };
  };
}

async function upToDate(): Promise<GitLocalReceiveRequestV1> {
  const closure = smallClosure();
  const fixture = await receiveFixture({
    commitOid: closure.head.oid,
    target: closure.head.oid,
    run: () => Promise.resolve({ nodes: RECEIVE_ONLY, packHeaderObjectCount: null }),
  });
  return fixture.request;
}

describe("prepareLocalReceive", () => {
  it("accepts the exact up-to-date target without pack/index children", async () => {
    const upToDateFixture = await upToDate();
    const result = await prepareLocalReceive(upToDateFixture);
    expect(result.destinationTransitions).toEqual([]);
    expect(result.processNodes).toEqual(["receive-pack"]);
    expect(result).toMatchObject({ kind: "up_to_date", packReaderBudget: null, closure: null });
  });

  it("stages a received pack/index as create transitions before any intent", async () => {
    const closure = smallClosure();
    const pack = buildPack(closure.entries);
    const fixture = await receiveFixture({ commitOid: closure.head.oid, target: null, run: packedRun(pack, closure.head.oid, 4) });
    const result = await prepareLocalReceive(fixture.request);
    const quarantine = fixture.request.quarantineRoot;
    expect(result.processNodes).toEqual(["receive-pack", "index-pack"]);
    expect(result.packReaderBudget).toMatchObject({ packHeaderObjectCount: 4, admittedObjectCount: 4, closedEffectObjectCount: 4 });
    expect(result.destinationTransitions.map((transition) => [transition.role, transition.operation, transition.path])).toEqual([
      ["destination_pack", "create", `${fixture.request.destination.gitDirectory}/objects/pack/pack-${pack.checksum}.pack`],
      ["destination_index", "create", `${fixture.request.destination.gitDirectory}/objects/pack/pack-${pack.checksum}.idx`],
    ]);
    expect(result.destinationTransitions.map((transition) => transition.evidence.stagedPostimagePath)).toEqual([
      `${quarantine}/post/0`,
      `${quarantine}/post/1`,
    ]);
    expect(await nodeFs.readFile(`${quarantine}/post/0`)).toEqual(Buffer.from(pack.pack));
    expect(await fixture.destinationPackFiles()).toEqual([]);
    expect((await nodeFs.readdir(`${fixture.shadow.objectDirectory}/pack`)).sort()).toEqual([`pack-${pack.checksum}.keep`]);
  });

  it("classifies byte-identical final pack and index paths as ownership-neutral reuse", async () => {
    const closure = smallClosure();
    const pack = buildPack(closure.entries);
    const fixture = await receiveFixture({ commitOid: closure.head.oid, target: null, run: packedRun(pack, closure.head.oid, 4) });
    await nodeFs.writeFile(`${fixture.destinationPackDirectory}/pack-${pack.checksum}.pack`, pack.pack, { mode: 0o444 });
    await nodeFs.writeFile(`${fixture.destinationPackDirectory}/pack-${pack.checksum}.idx`, pack.index, { mode: 0o444 });
    const result = await prepareLocalReceive(fixture.request);
    expect(result.destinationTransitions.map((transition) => transition.operation)).toEqual(["reuse", "reuse"]);
    expect(result.destinationTransitions.every((transition) => transition.evidence.stagedPostimagePath === null)).toBe(true);
    expect(await nodeFs.readdir(fixture.request.quarantineRoot)).not.toContain("post");
  });

  describe("refusals destroy the private quarantine and leave the real destination untouched", () => {
    const closure = smallClosure();
    const pack = buildPack(closure.entries);
    const head = closure.head.oid;
    const cases: readonly { readonly name: string; readonly reason: string; readonly options: () => ReceiveOptions; readonly prepare?: (fixture: ReceiveFixture) => Promise<void> }[] = [
      {
        name: "a hostile receive hook planted in the shadow",
        reason: "git_shadow_hooks_changed",
        options: () => ({
          commitOid: head,
          target: null,
          run: async (shadow) => {
            await nodeFs.writeFile(`${shadow.hooksPath}/pre-receive`, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
            return packedRun(pack, head, 4)(shadow);
          },
        }),
      },
      {
        name: "a proc-receive configuration",
        reason: "git_shadow_postimage",
        options: () => ({
          commitOid: head,
          target: null,
          run: async (shadow) => {
            await nodeFs.appendFile(shadow.configPath, "\tprocReceiveRefs = refs/heads\n");
            return packedRun(pack, head, 4)(shadow);
          },
        }),
      },
      {
        name: "re-enabled maintenance",
        reason: "git_shadow_config_changed",
        options: () => ({
          commitOid: head,
          target: null,
          run: async (shadow) => {
            const text = await nodeFs.readFile(shadow.configPath, "utf8");
            await nodeFs.writeFile(shadow.configPath, text.replace("[maintenance]\n\tauto = false", "[maintenance]\n\tauto = true"));
            return packedRun(pack, head, 4)(shadow);
          },
        }),
      },
      {
        name: "an index-pack child without a pack-header permit",
        reason: "git_receive_unexpected_process",
        options: () => ({
          commitOid: head,
          target: null,
          run: async (shadow) => {
            await receivePack(shadow, pack, head);
            return { nodes: RECEIVE_ONLY, packHeaderObjectCount: 4 };
          },
        }),
      },
      {
        name: "a loose object that bypassed receive.unpackLimit=0",
        reason: "git_receive_unexpected_object_file",
        options: () => ({
          commitOid: head,
          target: null,
          run: async (shadow) => {
            await nodeFs.mkdir(`${shadow.objectDirectory}/${head.slice(0, 2)}`);
            return packedRun(pack, head, 4)(shadow);
          },
        }),
      },
      {
        name: "an up-to-date claim against a different real target",
        reason: "git_receive_contradictory",
        options: () => ({
          commitOid: head,
          target: null,
          run: async (shadow) => {
            await nodeFs.mkdir(`${shadow.gitDir}/refs/heads`, { recursive: true });
            await nodeFs.writeFile(`${shadow.gitDir}/${BRANCH}`, `${head}\n`);
            return { nodes: RECEIVE_ONLY, packHeaderObjectCount: null };
          },
        }),
      },
      {
        name: "a shadow ref that is not the validated commit",
        reason: "git_receive_ref_mismatch",
        options: () => ({ commitOid: head, target: null, run: packedRun(pack, closure.root.oid, 4) }),
      },
      {
        name: "a pack header count that differs from the permit",
        reason: "git_pack_count_mismatch",
        options: () => ({ commitOid: head, target: null, run: packedRun(pack, head, 3) }),
      },
      {
        name: "a pack header count of 200,002",
        reason: "git_pack_object_count_over_limit",
        options: () => ({ commitOid: head, target: null, run: packedRun(pack, head, 200002) }),
      },
      {
        name: "a missing closure node",
        reason: "git_pack_missing_object",
        options: () => {
          const partial = buildPack(closure.entries.slice(0, 3));
          return { commitOid: head, target: null, run: packedRun(partial, head, 3) };
        },
      },
      {
        name: "a conflicting final pack path",
        reason: "git_receive_final_path_conflicting",
        options: () => ({ commitOid: head, target: null, run: packedRun(pack, head, 4) }),
        prepare: async (fixture) => {
          await nodeFs.writeFile(`${fixture.destinationPackDirectory}/pack-${pack.checksum}.pack`, "not the staged pack");
        },
      },
    ];

    it("enumerates every refusal class", () => {
      expect(cases.length).toBeGreaterThan(0);
    });

    it.each(cases)("refuses $name", async ({ reason, options, prepare }) => {
      const fixture = await receiveFixture(options());
      await prepare?.(fixture);
      const before = await fixture.destinationPackFiles();
      const bytesBefore = await Promise.all(before.map((name) => nodeFs.readFile(`${fixture.destinationPackDirectory}/${name}`)));
      await expect(prepareLocalReceive(fixture.request)).rejects.toThrow(reason);
      expect(await fixture.quarantineExists()).toBe(false);
      expect(await fixture.destinationPackFiles()).toEqual(before);
      expect(await Promise.all(before.map((name) => nodeFs.readFile(`${fixture.destinationPackDirectory}/${name}`)))).toEqual(bytesBefore);
    });
  });

  it("refuses a shadow outside the quarantine before running any process", async () => {
    const closure = smallClosure();
    let ran = false;
    const fixture = await receiveFixture({
      commitOid: closure.head.oid,
      target: null,
      run: () => {
        ran = true;
        return Promise.resolve({ nodes: RECEIVE_ONLY, packHeaderObjectCount: null });
      },
    });
    const elsewhere = parseCanonicalAbsolutePathText(`${root}/elsewhere`);
    await nodeFs.mkdir(elsewhere, { mode: 0o700 });
    await expect(prepareLocalReceive({ ...fixture.request, quarantineRoot: elsewhere })).rejects.toThrow("git_local_shadow_mismatch");
    expect(ran).toBe(false);
  });
});
