import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  codexRegistrationProjectionHash,
  createNodeLifecycleGuardedFileSystem,
  encodeCanonicalJson,
  LifecycleRecoveryRequiredError,
  ownerExternalEffectEvidencePath,
  ownerExternalEffectProcessPolicyHash,
  parseCanonicalAbsolutePathText,
  parseLowerHexSha256,
  parsePositiveUInt32,
  parseSafeReasonCode,
  parseUInt64Decimal,
  parseUtcTimestamp,
  updateLeafPlanPath,
  updateParticipantDocumentBytes,
  updateParticipantDocumentHash,
  updateParticipantJournalPath,
  type AllocatedLifecycleIdV1,
  type CanonicalAbsolutePathV1,
  type CodexRegistrationProjectionV1,
  type EffectiveUidV1,
  type LifecycleCoordinatorIdV1,
  type LowerHexSha256,
  type OwnerExternalEffectIdV1,
  type OwnerExternalEffectLiteralV1,
  type OwnerExternalEffectPlanV1,
  type OwnerExternalEffectProcessPolicyV1,
  type UpdateInitialJournalRefV1,
} from "@developer-os/core";
import { afterEach, describe, expect, it } from "vitest";

import { OwnerExternalEffectParticipant, resolveOwnerEffectProcess, type OwnerEffectProcessRequestV1, type OwnerExternalEffectStepV1 } from "./external-effect.js";
import { UpdateParticipantJournalStore } from "./state-participant.js";

const encoder = new TextEncoder();
const sha = (value: Uint8Array | string): LowerHexSha256 => parseLowerHexSha256(createHash("sha256").update(value).digest("hex"));
const at = parseUtcTimestamp("2026-09-23T10:00:00.000Z");
const nonce = "e".repeat(64);
const coordinatorId = `lc_${nonce}_5` as LifecycleCoordinatorIdV1;
const effectId = `oe_${nonce}_6` as OwnerExternalEffectIdV1;
const uid = process.getuid?.() ?? -1;
const homes: string[] = [];
const literal = (value: string) => value as OwnerExternalEffectLiteralV1;
const tokens = { managedPluginRoot: "/synthetic/codex/plugin-root", pluginId: "developer-os@developer-os", privateEffectTmp: "/synthetic/tmp/effect", managedVendorHome: "/synthetic/codex/home" };

afterEach(async () => {
  for (const home of homes.splice(0)) await nodeFs.rm(home, { recursive: true, force: true });
});

const policy: OwnerExternalEffectProcessPolicyV1 = {
  kind: "codex_registration_refresh",
  providerProtocol: parsePositiveUInt32(1),
  executable: "pinned_codex_cli",
  executableIdentity: { ownerUid: uid as EffectiveUidV1, mode: 493, nlink: 1, bytes: 2048, sha256: sha("synthetic codex"), dev: parseUInt64Decimal("1"), ino: parseUInt64Decimal("2") },
  argv: [{ kind: "literal", value: literal("plugin") }, { kind: "literal", value: literal("add") }, { kind: "token", value: "plugin_id" }, { kind: "literal", value: literal("--json") }],
  cwd: "managed_plugin_root",
  environment: [{ name: "HOME", value: "managed_vendor_home" }, { name: "TMPDIR", value: "private_effect_tmp" }],
  stdin: "closed",
  network: false,
  model: false,
  stdoutBytes: 4096,
  stderrBytes: 4096,
  wallMilliseconds: 60_000,
  idleMilliseconds: 10_000,
  processCount: 1,
};

const expected: CodexRegistrationProjectionV1 = { pluginId: parseSafeReasonCode("developer_os"), enabled: true, protocol: parsePositiveUInt32(1), version: parseSafeReasonCode("v1_1_0"), source: "managed_plugin_root" };
const proposed: CodexRegistrationProjectionV1 = { ...expected, version: parseSafeReasonCode("v1_2_0") };

interface EffectFixture {
  readonly step: OwnerExternalEffectStepV1;
  readonly root: CanonicalAbsolutePathV1;
  readonly events: string[];
  readonly requests: OwnerEffectProcessRequestV1[];
  readonly state: { current: CodexRegistrationProjectionV1; exitCode: number };
  readonly journals: UpdateParticipantJournalStore;
  readonly participant: OwnerExternalEffectParticipant;
}

async function writeOwned(path: string, content: Uint8Array): Promise<void> {
  await nodeFs.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true, mode: 0o700 });
  await nodeFs.writeFile(path, content, { mode: 0o600 });
}

async function fixture(): Promise<EffectFixture> {
  const home = await nodeFs.realpath(await nodeFs.mkdtemp(join(tmpdir(), "dos-effect-")));
  homes.push(home);
  const root = parseCanonicalAbsolutePathText(`${home}/staging/lifecycle/${coordinatorId}`);
  await nodeFs.mkdir(root, { recursive: true, mode: 0o700 });
  const plan: OwnerExternalEffectPlanV1 = {
    schemaVersion: 1,
    id: effectId,
    coordinatorId,
    kind: "codex_registration_refresh",
    owner: "codex",
    providerProtocol: parsePositiveUInt32(1),
    fileParticipantIds: [`tx_${nonce}_7` as AllocatedLifecycleIdV1<"tx">],
    expectedStateHash: codexRegistrationProjectionHash(expected),
    proposedStateHash: codexRegistrationProjectionHash(proposed),
    processPolicy: policy,
    processPolicyHash: ownerExternalEffectProcessPolicyHash(policy),
    forwardPayloads: [],
    compensationPayloads: [],
    maximumPlanBytes: 65_536,
    maximumJournalBytes: 4096,
    maximumEvidenceBytes: 4096,
  };
  const planPath = updateLeafPlanPath(root, "owner_external_effect", effectId);
  await writeOwned(planPath, updateParticipantDocumentBytes(plan));
  const planHash = updateParticipantDocumentHash("owner_external_effect", plan);
  const initial = encoder.encode(encodeCanonicalJson({ schemaVersion: 1, id: effectId, coordinatorId, planHash, phase: "planned", direction: "forward", nextTransition: 0, evidenceHash: null, createdAt: at, updatedAt: at }));
  const stagedPath = parseCanonicalAbsolutePathText(`${root}/update/initial-journals/owner_external_effect/${effectId}.json`);
  await writeOwned(stagedPath, initial);
  const journal = { kind: "owner_external_effect", id: effectId, planHash, finalPath: updateParticipantJournalPath(root, "owner_external_effect", effectId), stagedPath, stagedExpected: { constructionOrdinal: 2, hash: sha(initial), bytes: initial.byteLength, mode: 384 } } as UpdateInitialJournalRefV1;
  const fs = createNodeLifecycleGuardedFileSystem({
    effectiveUid: uid,
    renameNoReplace: async ({ sourcePath, destinationPath }) => {
      await nodeFs.link(sourcePath, destinationPath);
      await nodeFs.unlink(sourcePath);
    },
  });
  const journals = new UpdateParticipantJournalStore({ fs, effectiveUid: uid });
  const events: string[] = [];
  const requests: OwnerEffectProcessRequestV1[] = [];
  const state = { current: expected, exitCode: 0 };
  const participant = new OwnerExternalEffectParticipant({
    journals,
    stagingRoot: root,
    tokens,
    observe: () => {
      events.push("codex_observe");
      return Promise.resolve(state.current);
    },
    resolveExecutable: () => Promise.resolve("/synthetic/bin/codex"),
    run: (request) => {
      events.push("codex_refresh");
      requests.push(request);
      state.current = state.current === expected ? proposed : expected;
      return Promise.resolve({ exitCode: state.exitCode, stdout: encoder.encode("registered with token secret-token-123\n"), stderr: new Uint8Array() });
    },
    redact: (text) => text.replaceAll(/secret-token-\d+/gu, "[redacted]"),
    now: () => new Date(at),
  });
  return { step: { plan, planRef: { kind: "owner_external_effect", id: effectId, path: planPath, hash: planHash, bytes: updateParticipantDocumentBytes(plan).byteLength }, journal }, root, events, requests, state, journals, participant };
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await nodeFs.readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe("owner external effect", () => {
  it("syncs intent, observes, runs the pinned refresh once, then observes the proposed state", async () => {
    const { step, events, participant } = await fixture();
    await expect(participant.apply(step)).resolves.toEqual({ state: "applied" });
    expect(events).toEqual(["codex_observe", "codex_refresh", "codex_observe"]);
    expect(await readJson(step.journal.finalPath)).toMatchObject({ phase: "forward_observed", nextTransition: 1 });
  });

  it("resolves the exact executable, argv, cwd, environment, and closed stdin", () => {
    const request = resolveOwnerEffectProcess(policy, "/synthetic/bin/codex", tokens);
    expect(request).toEqual({
      executable: "/synthetic/bin/codex",
      argv: ["plugin", "add", "developer-os@developer-os", "--json"],
      env: { HOME: tokens.managedVendorHome, TMPDIR: tokens.privateEffectTmp },
      cwd: tokens.managedPluginRoot,
      stdin: "ignore",
      stdoutCap: 4096,
      stderrCap: 4096,
      idleMs: 10_000,
      wallMs: 60_000,
    });
  });

  it("hashes redacted output only and persists no vendor path or value", async () => {
    const { step, root, participant } = await fixture();
    await participant.apply(step);
    const path = ownerExternalEffectEvidencePath(root, effectId, "forward");
    const text = await nodeFs.readFile(path, "utf8");
    const evidence = JSON.parse(text) as Record<string, unknown>;
    expect(evidence.redactedStdoutHash).toBe(sha("registered with token [redacted]\n"));
    expect(evidence.redactedStdoutHash).not.toBe(sha("registered with token secret-token-123\n"));
    expect(text).not.toContain("secret-token");
    expect(text).not.toContain(tokens.managedPluginRoot);
    expect(text).not.toContain(tokens.managedVendorHome);
  });

  it("re-observes an ambiguous intent and adopts existing evidence without a second process", async () => {
    const { step, events, participant } = await fixture();
    await participant.apply(step);
    const journal = await readJson(step.journal.finalPath);
    const rewound = new UpdateParticipantJournalStore({ fs: createNodeLifecycleGuardedFileSystem({ effectiveUid: uid, renameNoReplace: () => Promise.resolve() }), effectiveUid: uid });
    await rewound.rewrite(step.journal.finalPath, { ...journal, phase: "forward_intent", nextTransition: 0, evidenceHash: null });
    events.length = 0;
    await participant.apply(step);
    expect(events).not.toContain("codex_refresh");
    expect(await readJson(step.journal.finalPath)).toMatchObject({ phase: "forward_observed" });
  });

  it("refuses a foreign registration before any process", async () => {
    const { step, events, state, participant } = await fixture();
    state.current = { ...expected, source: "other" };
    await expect(participant.apply(step)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(events).not.toContain("codex_refresh");
  });

  it("keeps the intent when the vendor process fails", async () => {
    const { step, state, participant } = await fixture();
    state.exitCode = 1;
    await expect(participant.apply(step)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(await readJson(step.journal.finalPath)).toMatchObject({ phase: "forward_intent", evidenceHash: null });
  });

  it("compensates by rerunning the refresh back to the expected projection", async () => {
    const { step, events, state, participant } = await fixture();
    await participant.apply(step);
    events.length = 0;
    await expect(participant.compensate(step)).resolves.toEqual({ state: "compensated" });
    expect(events).toEqual(["codex_observe", "codex_observe", "codex_refresh", "codex_observe"]);
    expect(state.current).toBe(expected);
    expect(await readJson(step.journal.finalPath)).toMatchObject({ phase: "rolled_back", direction: "compensating", nextTransition: 2 });
  });

  it("rolls back an unexecuted intent without a process", async () => {
    const { step, events, state, participant } = await fixture();
    state.exitCode = 1;
    await expect(participant.apply(step)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    state.current = expected;
    events.length = 0;
    await participant.compensate(step);
    expect(events).toEqual(["codex_observe"]);
    expect(await readJson(step.journal.finalPath)).toMatchObject({ phase: "rolled_back", nextTransition: 0, evidenceHash: null });
  });

  it("compacts evidence and journal before the plan", async () => {
    const { step, root, participant } = await fixture();
    await participant.apply(step);
    await participant.finalize(step);
    await participant.compact(step);
    expect(await readJson(ownerExternalEffectEvidencePath(root, effectId, "forward"))).toBeNull();
    expect(await readJson(step.journal.finalPath)).toBeNull();
    expect(await readJson(step.planRef.path)).toBeNull();
  });
});
