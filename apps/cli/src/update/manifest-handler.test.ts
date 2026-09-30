import { createHash } from "node:crypto";

import {
  LifecycleRecoveryRequiredError,
  ManifestStateParticipantError,
  parseCanonicalAbsolutePathText,
  parseStableSemver,
  parseUtcTimestamp,
  type CanonicalAbsolutePathV1,
  type InstallationManifestV2,
  type LowerHexSha256,
  type ManagedArtifactV2,
  type ManifestStatePlanV1,
  type UpdateLifecycleCoordinatorStepV1,
} from "@developer-os/core";
import { describe, expect, it } from "vitest";

import {
  deriveTerminalManifest,
  manifestStepHandlers,
  type ManifestStepHandlerDependenciesV1,
  type ManifestStepParticipantV1,
} from "./manifest-handler.js";

type ManifestStep = Extract<UpdateLifecycleCoordinatorStepV1, { readonly kind: "manifest" }>;
type Observation = Awaited<ReturnType<ManifestStepParticipantV1["observe"]>>;

const home = "/synthetic/home/.developer-os";
const at = parseUtcTimestamp("2026-09-28T12:00:00.000Z");
const manifestPath = path(`${home}/installation-manifest.json`);

function path(text: string): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(text);
}

function sha(text: string): LowerHexSha256 {
  return createHash("sha256").update(text).digest("hex") as LowerHexSha256;
}

function row(name: string): ManagedArtifactV2 {
  return {
    owner: "codex",
    path: path(`/synthetic/home/.codex/${name}`),
    productVersion: parseStableSemver("1.1.0"),
    existedBefore: false,
    beforeHash: null,
    backupRelativePath: null,
    source: `skills/${name}` as ManagedArtifactV2["source"],
    mergeStrategy: "dedicated",
    verifiedAt: at,
    kind: "file",
    verification: { mode: "content", installedHash: sha(name) },
  };
}

function manifest(rows: readonly ManagedArtifactV2[]): InstallationManifestV2 {
  return { schemaVersion: 2, productVersion: parseStableSemver("1.1.0"), installedAt: at, artifacts: rows };
}

function present(hash: LowerHexSha256, bytesPath: CanonicalAbsolutePathV1 | null): ManifestStatePlanV1["before"] {
  return {
    state: "present",
    hash,
    bytes: bytesPath === null
      ? null
      : { kind: "update_expected", coordinatorId: "lc_synthetic" as never, ordinal: 0, path: bytesPath as never, hash, bytes: 1, mode: 0o600 },
    ownerUid: 501,
    mode: 0o600,
    nlink: 1,
    size: "1" as never,
    dev: bytesPath === null ? ("7" as never) : null,
    ino: bytesPath === null ? ("11" as never) : null,
  };
}

const transitionalPayload = path(`${home}/update/manifest/transitional/installation-manifest.json`);
const terminalPayload = path(`${home}/update/manifest/terminal/installation-manifest.json`);
const kept = [row("a.md"), row("b.md")];
const retired = [row("old-rollback.json")];
const transitionalManifest = manifest([kept[0] as ManagedArtifactV2, retired[0] as ManagedArtifactV2, kept[1] as ManagedArtifactV2]);
const terminalManifest = manifest(kept);

function plan(participant: "transitional" | "terminal", before: ManifestStatePlanV1["before"], after: ManifestStatePlanV1["after"]): ManifestStatePlanV1 {
  return {
    schemaVersion: 1,
    participantId: participant as ManifestStatePlanV1["participantId"],
    envelope: { kind: "lifecycle", id: "lc_synthetic" as never },
    bindings: { foundationTransactions: { count: 0, orderedIdsHash: sha("[]") }, externalEffects: [] },
    manifestPath,
    tombstonePath: path(`${home}/.installation-manifest.${participant}.json.tombstone`),
    before,
    after,
    maximumPlanBytes: 16_777_216,
    maximumJournalBytes: 1_048_576,
  };
}

const priorHash = sha("prior manifest");
const transitionalHash = sha("transitional manifest");
const terminalHash = sha("terminal manifest");
const plans = {
  transitional: plan("transitional", present(priorHash, null), present(transitionalHash, transitionalPayload)),
  terminal: plan("terminal", present(transitionalHash, transitionalPayload), present(terminalHash, terminalPayload)),
};

interface Harness {
  readonly log: string[];
  readonly deps: ManifestStepHandlerDependenciesV1;
}

function harness(options: {
  readonly terminalObservation?: Observation["state"];
  readonly terminalBytes?: InstallationManifestV2;
  readonly fail?: string;
} = {}): Harness {
  const log: string[] = [];
  const nameOf = (value: ManifestStatePlanV1) => value.participantId as string;
  const act = (method: string, result: Observation["state"]) => (value: ManifestStatePlanV1): Promise<Observation> => {
    const call = `${method}:${nameOf(value)}`;
    log.push(call);
    if (options.fail === call) return Promise.reject(new ManifestStateParticipantError());
    return Promise.resolve({ state: result });
  };
  const participant: ManifestStepParticipantV1 = {
    observe: (value) => act("observe", nameOf(value) === "terminal" ? options.terminalObservation ?? "before" : "applied")(value),
    preserveBefore: act("preserveBefore", "preimage_preserved"),
    publishAfter: act("publishAfter", "applied"),
    compensate: act("compensate", "compensated"),
    compact: async (value) => {
      await act("compact", "applied")(value);
    },
  };
  const contents = new Map<string, InstallationManifestV2>([
    [`${manifestPath}#${transitionalHash}`, transitionalManifest],
    [`${plans.terminal.tombstonePath}#${transitionalHash}`, transitionalManifest],
    [`${terminalPayload}#${terminalHash}`, options.terminalBytes ?? terminalManifest],
  ]);
  return {
    log,
    deps: {
      participant: () => participant,
      readManifest: (at, hash) => {
        log.push(`read:${at}`);
        const found = contents.get(`${at}#${hash}`);
        return found === undefined ? Promise.reject(new Error("unexpected read")) : Promise.resolve(found);
      },
      removeTombstone: (at, expected) => {
        log.push(`removeTombstone:${at}:${expected.ino}`);
        return Promise.resolve();
      },
    },
  };
}

function step(transition: ManifestStep["transition"]): ManifestStep {
  return { kind: "manifest", transition };
}

function handler(deps: ManifestStepHandlerDependenciesV1) {
  return manifestStepHandlers(plans, retired, deps).manifest;
}

describe("manifestStepHandlers (D72 P3)", () => {
  it("maps preserve_before to the transitional plan's preimage move", async () => {
    const { log, deps } = harness();
    await expect(handler(deps).apply(step("preserve_before"))).resolves.toEqual({ state: "applied" });
    expect(log).toEqual(["preserveBefore:transitional"]);
  });

  it("maps publish_transitional to the transitional plan's postimage", async () => {
    const { log, deps } = harness();
    await expect(handler(deps).apply(step("publish_transitional"))).resolves.toEqual({ state: "applied" });
    expect(log).toEqual(["publishAfter:transitional"]);
  });

  it("maps publish_terminal to the checked terminal preserve and publish", async () => {
    const { log, deps } = harness();
    await expect(handler(deps).apply(step("publish_terminal"))).resolves.toEqual({ state: "applied" });
    expect(log).toEqual([
      "observe:terminal",
      `read:${manifestPath}`,
      `read:${terminalPayload}`,
      "preserveBefore:terminal",
      "publishAfter:terminal",
    ]);
  });

  it("checks a resumed publish_terminal against the transitional bytes in the terminal tombstone", async () => {
    const { log, deps } = harness({ terminalObservation: "preimage_preserved" });
    await expect(handler(deps).apply(step("publish_terminal"))).resolves.toEqual({ state: "applied" });
    expect(log).toContain(`read:${plans.terminal.tombstonePath}`);
    expect(log.at(-1)).toBe("publishAfter:terminal");
  });

  it("adopts an already published terminal manifest without rereading it", async () => {
    const { log, deps } = harness({ terminalObservation: "applied" });
    await expect(handler(deps).apply(step("publish_terminal"))).resolves.toEqual({ state: "applied" });
    expect(log.some((entry) => entry.startsWith("read:"))).toBe(false);
  });

  it("finalize_tombstones removes the terminal tombstone, then the transitional one", async () => {
    const { log, deps } = harness();
    await expect(handler(deps).apply(step("finalize_tombstones"))).resolves.toEqual({ state: "applied" });
    expect(log).toEqual(["compact:terminal", `removeTombstone:${plans.transitional.tombstonePath}:11`]);
  });

  it("refuses one extra changed row with exit 6 before the terminal rename (Review Focus 5)", async () => {
    const changed = { ...kept[1], beforeHash: sha("drift") } as ManagedArtifactV2;
    const { log, deps } = harness({ terminalBytes: manifest([kept[0] as ManagedArtifactV2, changed]) });
    const failure = handler(deps).apply(step("publish_terminal"));
    await expect(failure).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    await expect(failure).rejects.toMatchObject({ code: 6 });
    expect(log).not.toContain("preserveBefore:terminal");
    expect(log).not.toContain("publishAfter:terminal");
  });

  it("refuses a terminal plan whose before is not the transitional after", async () => {
    const unchained = { ...plans, terminal: plan("terminal", present(sha("other"), transitionalPayload), present(terminalHash, terminalPayload)) };
    const { log, deps } = harness();
    await expect(manifestStepHandlers(unchained, retired, deps).manifest.apply(step("publish_terminal"))).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(log).not.toContain("preserveBefore:terminal");
  });

  it("compensates both pre-point-of-no-return steps by restoring the old manifest", async () => {
    const { log, deps } = harness();
    const manifestHandler = handler(deps);
    await expect(manifestHandler.compensate(step("publish_transitional"))).resolves.toEqual({ state: "compensated" });
    await expect(manifestHandler.compensate(step("preserve_before"))).resolves.toEqual({ state: "compensated" });
    expect(log).toEqual(["compensate:transitional", "compensate:transitional"]);
  });

  it.each(["publish_terminal", "finalize_tombstones"] as const)("refuses to compensate %s", async (transition) => {
    const { log, deps } = harness();
    await expect(handler(deps).compensate(step(transition))).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    expect(log).toEqual([]);
  });

  it("surfaces a participant third state as exit 6, not a compensable failure", async () => {
    const { deps } = harness({ fail: "publishAfter:transitional" });
    const failure = handler(deps).apply(step("publish_transitional"));
    await expect(failure).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
    await expect(failure).rejects.toMatchObject({ code: 6 });
  });
});

describe("deriveTerminalManifest (D72 P3)", () => {
  it("removes exactly the retired rows and keeps the order and header", () => {
    expect(deriveTerminalManifest(transitionalManifest, retired)).toEqual(terminalManifest);
  });

  it("refuses a retired row absent from the transitional set", () => {
    expect(() => deriveTerminalManifest(transitionalManifest, [row("missing.json")])).toThrow(LifecycleRecoveryRequiredError);
  });

  it("refuses a retired row that differs from its transitional row", () => {
    const drifted = { ...retired[0], beforeHash: sha("drift") } as ManagedArtifactV2;
    expect(() => deriveTerminalManifest(transitionalManifest, [drifted])).toThrow(LifecycleRecoveryRequiredError);
  });
});
