import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { UpdateCapacityInputV1 } from "./capacity.js";
import { admitRollbackPayloadRelativePath, parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1, type CanonicalPathEvidenceV1 } from "./paths.js";
import {
  admitTargetUpdateDraft,
  decodePlannerInput,
  encodePlannerInput,
  encodePlannerOutput,
  materializePlannerDraft,
  parsePlannerPathToken,
  PLANNER_WIRE_BOUNDS_V1,
  PlannerBlobSetHasher,
  plannerBlobSetHash,
  plannerJsonBytes,
  plannerJsonHash,
  plannerPathToken,
  PlannerWireDecoder,
  PlannerWireEncoder,
  validateUpdatePlannerRequest,
  type PlannerDraftMaterializationContextV1,
  type PlannerPathTokenV1,
  type PlannerWireFrameV1,
  type SecretScreenedBlobV1,
  type TargetUpdateDraftV1,
  type UpdatePlannerRequestV1,
} from "./planner.js";
import { parseRollbackPayloadId, type PlannerTranscriptIdentityV1, type RollbackPayloadEntryV1 } from "./preview.js";
import { validateReleaseIdentity, type ReleaseIdentityV1 } from "./release.js";
import { parseLowerHexSha256, parseSafeReasonCode, parseUInt64Decimal, type LowerHexSha256 } from "./scalars.js";

const encoder = new TextEncoder();
const bytes = (text: string): Uint8Array => encoder.encode(text);
const sha = (value: Uint8Array | string): LowerHexSha256 => parseLowerHexSha256(createHash("sha256").update(value).digest("hex"));
const u = parseUInt64Decimal;
const t = (ordinal: number): PlannerPathTokenV1 => plannerPathToken(ordinal);
const evidence: CanonicalPathEvidenceV1 = {
  reopenCanonicalAbsolutePath: (value) => value,
  containsCanonicalPath: (root, candidate) => candidate === root || candidate.startsWith(`${root}/`),
  hasFoldedAlias: () => false,
};

function release(version: string, sequence: string): ReleaseIdentityV1 {
  return validateReleaseIdentity({
    version, releaseSequence: sequence, releaseIdentityHash: sha(`identity-${version}`),
    delegationSequence: "1", delegationHash: sha("delegation"), releaseIndexSequence: sequence, releaseIndexHash: sha(`index-${sequence}`),
    bundleManifestHash: sha(`manifest-${version}`), bundleRoot: `/product/releases/${version}/darwin-arm64`,
    platform: "darwin", architecture: "arm64", launcherProtocol: 1, updateProtocol: 1,
  }, evidence);
}

const configBytes = bytes('{"schemaVersion":1}\n');
const codexBytes = bytes("codex skill v1\n");
const noteBytes = bytes("# Note\n\nsynthetic vault text\n");
const inputBlobs = [configBytes, codexBytes, noteBytes];
const outputBlobs = [bytes("codex skill v2\n"), bytes('{"schemaVersion":2}\n'), configBytes, bytes("# Note v2\n"), noteBytes];
const largeHash = sha("large synthetic file");
const bundleHash = sha("bundle payload");

const verification = {
  config: { mode: "schema", schemaId: "developer-os-config-v1", installedHash: sha(configBytes) },
  directory: { mode: "content" },
  large: { mode: "content", installedHash: largeHash },
  codex: { mode: "content", installedHash: sha(codexBytes) },
};

function manifestRow(ordinal: number, owner: string, kind: string, rowVerification: object, source: string, currentHash: string | null): Record<string, unknown> {
  return { token: t(ordinal), owner, kind, verification: rowVerification, productVersion: "1.0.0", source, mergeStrategy: "dedicated", currentHash };
}

function inputRow(row: Record<string, unknown>, observed: object): Record<string, unknown> {
  const columns: Record<string, unknown> = { ...row, observed };
  delete columns.currentHash;
  return columns;
}

function requestValue(): Record<string, unknown> {
  const rows = [
    manifestRow(0, "core", "file", verification.config, "state/config.json", sha(configBytes)),
    manifestRow(1, "core", "directory", verification.directory, "state", null),
    manifestRow(2, "codex", "file", verification.large, "codex/large.bin", largeHash),
    manifestRow(3, "codex", "file", verification.codex, "codex/skill.md", sha(codexBytes)),
  ];
  return {
    schemaVersion: 1,
    protocol: 1,
    plannedAt: "2026-09-23T08:00:00.000Z",
    platform: "darwin",
    architecture: "arm64",
    currentRelease: release("1.0.0", "1"),
    targetRelease: release("2.0.0", "2"),
    manifest: { schemaVersion: 1, productVersion: "1.0.0", installedAt: "2026-09-01T08:00:00.000Z", artifacts: rows },
    config: {
      schemaVersion: 1, brainRoot: "brain_root", adapters: { claude: false, codex: true }, git: { enabled: false }, automation: { enabled: false },
      brain: null, redactionPatternsCount: 2, telemetry: false,
    },
    installedOwners: ["core", "codex"],
    artifactInputs: [
      inputRow(rows[0] as Record<string, unknown>, { state: "content", mode: 384, bytes: configBytes.byteLength, sha256: sha(configBytes), blob: { stream: "input", ordinal: 0, bytes: configBytes.byteLength, sha256: sha(configBytes) } }),
      inputRow(rows[1] as Record<string, unknown>, { state: "directory", mode: 448 }),
      inputRow(rows[2] as Record<string, unknown>, { state: "content", mode: 384, bytes: 100_000_000, sha256: largeHash, blob: null }),
      inputRow(rows[3] as Record<string, unknown>, { state: "content", mode: 384, bytes: codexBytes.byteLength, sha256: sha(codexBytes), blob: { stream: "input", ordinal: 1, bytes: codexBytes.byteLength, sha256: sha(codexBytes) } }),
    ],
    brain: {
      schemaVersion: 1, root: "brain_root", folderPolicyVersion: 1, aggregateBytes: noteBytes.byteLength,
      entries: [{ path: "notes/a.md", mode: 384, bytes: noteBytes.byteLength, sha256: sha(noteBytes), blob: { stream: "input", ordinal: 2, bytes: noteBytes.byteLength, sha256: sha(noteBytes) } }],
    },
  };
}

const out = (ordinal: number): Record<string, unknown> => ({ stream: "output", ordinal, bytes: (outputBlobs[ordinal] as Uint8Array).byteLength });

function draftValue(): Record<string, unknown> {
  const request = requestValue();
  const common = (owner: string, source: string) => ({ owner, productVersion: "2.0.0", source, mergeStrategy: "dedicated" });
  return {
    schemaVersion: 1,
    protocol: 1,
    currentRelease: request.currentRelease,
    targetRelease: request.targetRelease,
    ownerPlans: [
      { owner: "core", currentArtifacts: [t(0), t(1)], proposedOperations: [], externalEffects: [] },
      {
        owner: "codex",
        currentArtifacts: [t(2), t(3)],
        proposedOperations: [
          { operation: "keep", target: { kind: "installed", token: t(2) }, expectedHash: largeHash },
          { operation: "replace", target: { kind: "installed", token: t(3) }, expectedHash: sha(codexBytes), content: { kind: "output_blob", blob: out(0) } },
          { operation: "create", target: { kind: "owner_relative", owner: "codex", path: "skills/new.md" }, content: { kind: "target_bundle", path: "payload/new.md", bytes: 3, sha256: bundleHash } },
        ],
        externalEffects: [{ kind: "codex_registration_refresh", owner: "codex", artifactTokens: [t(2), t(3)] }],
      },
    ],
    migrations: [
      { id: "migration_config-v2", domain: "product_state", fromVersion: 1, toVersion: 2, mutations: [{ path: { domain: "product_state", token: t(0) }, beforeHash: sha(configBytes), afterBlob: out(1), inverseBlob: out(2) }] },
      { id: "migration_notes-v2", domain: "brain", fromVersion: 1, toVersion: 2, mutations: [{ path: { domain: "brain", path: "notes/a.md" }, beforeHash: sha(noteBytes), afterBlob: out(3), inverseBlob: out(4) }] },
    ],
    expectedManifest: {
      schemaVersion: 2,
      productVersion: "2.0.0",
      artifacts: [
        { ...common("core", "state/config.json"), path: { kind: "installed", token: t(0) }, kind: "file", verification: { mode: "schema", schemaId: "developer-os-config-v1", installed: { kind: "output_blob", blob: out(1) } } },
        { ...common("core", "state"), path: { kind: "installed", token: t(1) }, kind: "directory", verification: { mode: "content" } },
        { ...common("codex", "codex/large.bin"), path: { kind: "installed", token: t(2) }, kind: "file", verification: { mode: "content", installed: { kind: "installed", token: t(2) } } },
        { ...common("codex", "codex/skill.md"), path: { kind: "installed", token: t(3) }, kind: "file", verification: { mode: "content", installed: { kind: "output_blob", blob: out(0) } } },
        { ...common("codex", "codex/new.md"), path: { kind: "owner_relative", owner: "codex", path: "skills/new.md" }, kind: "file", verification: { mode: "content", installed: { kind: "target_bundle", path: "payload/new.md", bytes: 3, sha256: bundleHash } } },
      ],
    },
  };
}

const request = (): UpdatePlannerRequestV1 => validateUpdatePlannerRequest(requestValue());
const draft = (): TargetUpdateDraftV1 => admitTargetUpdateDraft(draftValue(), request()).draft;

type Path = readonly (string | number)[];

function edit<T>(value: T, path: Path, next: unknown): T {
  const copy = structuredClone(value);
  let cursor = copy as unknown as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) cursor = cursor[key] as Record<string | number, unknown>;
  const last = path[path.length - 1] as string | number;
  if (next === undefined) Reflect.deleteProperty(cursor, last);
  else cursor[last] = next;
  return copy;
}

function frames(direction: "input" | "output", wire: Uint8Array): PlannerWireFrameV1[] {
  const decoder = new PlannerWireDecoder(direction);
  const decoded = decoder.push(wire);
  decoder.finish();
  return decoded;
}

function uint64(value: number): Uint8Array {
  const buffer = new Uint8Array(8);
  new DataView(buffer.buffer).setBigUint64(0, BigInt(value));
  return buffer;
}

function header(kind: number, length: number): Uint8Array {
  return Uint8Array.from([kind, ...uint64(length)]);
}

function join(...parts: Uint8Array[]): Uint8Array {
  return Uint8Array.from(parts.flatMap((part) => [...part]));
}

const MAGIC = bytes("DOSUPD1\n");

describe("planner tokens", () => {
  it("encodes ten-digit tokens and refuses one outside the request", () => {
    expect(t(7)).toBe("artifact_0000000007");
    expect(parsePlannerPathToken("artifact_0000000003", 4).ordinal).toBe(3);
    for (const bad of ["artifact_0000000004", "artifact_3", "artifact_-000000001", "token_0000000000", "artifact_0001000000"]) {
      expect(() => parsePlannerPathToken(bad, 4)).toThrow();
    }
    expect(() => plannerPathToken(1_000_000)).toThrow();
  });
});

describe("planner request", () => {
  it("admits the complete synthetic request unchanged", () => {
    expect(request()).toEqual(requestValue());
  });

  it.each<{ name: string; path: Path; next: unknown }>([
    { name: "an extra top-level key", path: ["extra"], next: 1 },
    { name: "a missing key", path: ["brain"], next: undefined },
    { name: "a token out of order", path: ["artifactInputs", 1, "token"], next: "artifact_0000000002" },
    { name: "an input that differs from its manifest row", path: ["artifactInputs", 3, "source"], next: "codex/other.md" },
    { name: "absent outside a clean ephemeral reservation", path: ["artifactInputs", 0, "observed"], next: { state: "absent" } },
    { name: "a directory arm on a file", path: ["artifactInputs", 3, "observed"], next: { state: "directory", mode: 448 } },
    { name: "a blob hash that differs from the row", path: ["artifactInputs", 0, "observed", "blob", "sha256"], next: sha("other") },
    { name: "a blob-carrying file above 16 MiB", path: ["artifactInputs", 3, "observed", "bytes"], next: 16_777_217 },
    { name: "a blob-less file above 512 MiB", path: ["artifactInputs", 2, "observed", "bytes"], next: 536_870_913 },
    { name: "non-contiguous input blob ordinals", path: ["brain", "entries", 0, "blob", "ordinal"], next: 5 },
    { name: "an aggregate that is not the entry sum", path: ["brain", "aggregateBytes"], next: 1 },
    { name: "a non-literal Brain root", path: ["brain", "root"], next: "/Users/example/vault" },
    { name: "an owner set that differs from the manifest", path: ["installedOwners"], next: ["core"] },
    { name: "owners out of canonical order", path: ["installedOwners"], next: ["codex", "core"] },
    { name: "the same current and target release", path: ["targetRelease"], next: release("1.0.0", "1") },
    { name: "a raw redaction pattern", path: ["config", "redactionPatterns"], next: ["client name"] },
    { name: "telemetry", path: ["config", "telemetry"], next: true },
  ])("refuses $name", ({ path, next }) => {
    expect(() => validateUpdatePlannerRequest(edit(requestValue(), path, next))).toThrow();
  });

  it("refuses Brain entries that are not sorted by unsigned UTF-8 bytes", () => {
    const value = requestValue();
    const brain = value.brain as { entries: Record<string, unknown>[]; aggregateBytes: number };
    const first = brain.entries[0] as Record<string, unknown>;
    brain.entries = [{ ...first, path: "notes/b.md" }, { ...first, path: "notes/a.md", blob: { ...(first.blob as object), ordinal: 3 } }];
    brain.aggregateBytes = noteBytes.byteLength * 2;
    expect(() => validateUpdatePlannerRequest(value)).toThrow();
  });
});

describe("target draft admission", () => {
  it("admits the draft and derives contiguous output expectations", () => {
    const admitted = admitTargetUpdateDraft(draftValue(), request());
    expect(admitted.draft).toEqual(draftValue());
    expect(admitted.outputBlobs).toEqual(outputBlobs.map((blob, ordinal) => ({ ordinal, bytes: blob.byteLength })));
  });

  it.each<{ name: string; path: Path; next: unknown }>([
    { name: "a different protocol", path: ["protocol"], next: 2 },
    { name: "a different target release", path: ["targetRelease"], next: release("3.0.0", "3") },
    { name: "an incomplete current partition", path: ["ownerPlans", 1, "currentArtifacts"], next: [t(3)] },
    { name: "owner plans out of installed order", path: ["ownerPlans", 0, "owner"], next: "codex" },
    { name: "an expected hash that differs from the manifest", path: ["ownerPlans", 1, "proposedOperations", 0, "expectedHash"], next: sha("stale") },
    { name: "a replace of a blob-less artifact", path: ["ownerPlans", 1, "proposedOperations", 0], next: { operation: "replace", target: { kind: "installed", token: t(2) }, expectedHash: largeHash, content: { kind: "output_blob", blob: out(0) } } },
    { name: "a remove of a blob-less artifact", path: ["ownerPlans", 1, "proposedOperations", 0], next: { operation: "remove", target: { kind: "installed", token: t(2) }, expectedHash: largeHash } },
    { name: "an operation on another owner's token", path: ["ownerPlans", 1, "proposedOperations", 0, "target", "token"], next: t(0) },
    { name: "a create under another owner", path: ["ownerPlans", 1, "proposedOperations", 2, "target", "owner"], next: "core" },
    { name: "a create that targets an installed token", path: ["ownerPlans", 1, "proposedOperations", 2, "target"], next: { kind: "installed", token: t(3) } },
    { name: "an owner-relative traversal", path: ["ownerPlans", 1, "proposedOperations", 2, "target", "path"], next: "../escape.md" },
    { name: "an unknown token", path: ["ownerPlans", 1, "proposedOperations", 0, "target", "token"], next: t(9) },
    { name: "a second external effect", path: ["ownerPlans", 1, "externalEffects", 1], next: { kind: "codex_registration_refresh", owner: "codex", artifactTokens: [t(2)] } },
    { name: "an effect on a non-Codex owner", path: ["ownerPlans", 0, "externalEffects"], next: [{ kind: "codex_registration_refresh", owner: "codex", artifactTokens: [t(0)] }] },
    { name: "an effect token outside the Codex partition", path: ["ownerPlans", 1, "externalEffects", 0, "artifactTokens"], next: [t(0)] },
    { name: "a broken migration chain", path: ["migrations", 1, "domain"], next: "product_state" },
    { name: "a migration version that does not advance", path: ["migrations", 0, "toVersion"], next: 1 },
    { name: "a product-state migration of a non-schema artifact", path: ["migrations", 0, "mutations", 0, "path", "token"], next: t(3) },
    { name: "a Brain migration path outside the snapshot", path: ["migrations", 1, "mutations", 0, "path", "path"], next: "notes/missing.md" },
    { name: "a migration before-hash that differs from the snapshot", path: ["migrations", 1, "mutations", 0, "beforeHash"], next: sha("other") },
    { name: "a mutation arm in another domain", path: ["migrations", 1, "mutations", 0, "path"], next: { domain: "product_state", token: t(0) } },
    { name: "an installation-history key in a draft row", path: ["expectedManifest", "artifacts", 0, "existedBefore"], next: false },
    { name: "a verifiedAt key in a draft row", path: ["expectedManifest", "artifacts", 1, "verifiedAt"], next: "2026-09-23T08:00:00.000Z" },
    { name: "an expected manifest for another version", path: ["expectedManifest", "productVersion"], next: "3.0.0" },
    { name: "a blob-less artifact reused elsewhere", path: ["expectedManifest", "artifacts", 3, "verification", "installed"], next: { kind: "installed", token: t(2) } },
    { name: "one output ordinal with two lengths", path: ["expectedManifest", "artifacts", 3, "verification", "installed", "blob", "bytes"], next: 1 },
    { name: "a gap in output ordinals", path: ["migrations", 1, "mutations", 0, "inverseBlob", "ordinal"], next: 9 },
    { name: "a hash on an output reference", path: ["migrations", 0, "mutations", 0, "afterBlob", "sha256"], next: sha("x") },
    { name: "a symlink row that names regular content", path: ["expectedManifest", "artifacts", 1], next: { owner: "core", productVersion: "2.0.0", source: "state", mergeStrategy: "dedicated", path: { kind: "installed", token: t(1) }, kind: "symlink", verification: { mode: "content", installed: { kind: "installed", token: t(0) } } } },
  ])("refuses $name", ({ path, next }) => {
    expect(() => admitTargetUpdateDraft(edit(draftValue(), path, next), request())).toThrow();
  });

  it("refuses a migration chain that is not in canonical execution order (NEW-135)", () => {
    const value = draftValue();
    value.migrations = [...(value.migrations as unknown[])].reverse();
    expect(() => admitTargetUpdateDraft(value, request())).toThrow("planner output is not in canonical chain order");
  });

  it("refuses a migration target whose owner operation changes it", () => {
    const value = draftValue();
    const core = (value.ownerPlans as Record<string, unknown>[])[0] as Record<string, unknown>;
    core.proposedOperations = [{ operation: "remove", target: { kind: "installed", token: t(0) }, expectedHash: sha(configBytes) }];
    expect(() => admitTargetUpdateDraft(value, request())).toThrow();
  });

  it("refuses expected-manifest rows outside root-free canonical order", () => {
    const value = draftValue();
    const manifest = value.expectedManifest as { artifacts: unknown[] };
    manifest.artifacts = [...manifest.artifacts].reverse();
    expect(() => admitTargetUpdateDraft(value, request())).toThrow();
  });

  it("refuses an external effect with no operations", () => {
    const value = edit(draftValue(), ["ownerPlans", 1, "proposedOperations"], []);
    expect(() => admitTargetUpdateDraft(value, request())).toThrow();
  });
});

describe("planner wire framing", () => {
  it("round-trips one request, contiguous blobs, and end frame", () => {
    expect(decodePlannerInput(encodePlannerInput(request(), inputBlobs))).toEqual({ request: request(), blobs: inputBlobs });
  });

  it("decodes identically when the stream arrives one byte at a time", () => {
    const wire = encodePlannerOutput(request(), draft(), outputBlobs);
    const decoder = new PlannerWireDecoder("output");
    const decoded: PlannerWireFrameV1[] = [];
    for (const byte of wire) decoded.push(...decoder.push(Uint8Array.of(byte)));
    decoder.finish();
    expect(decoded).toEqual(frames("output", wire));
    expect(decoded.map((frame) => frame.kind)).toEqual(["json", "blob", "blob", "blob", "blob", "blob", "end"]);
  });

  it("frames the request as its exact no-LF canonical JSON", () => {
    const wire = encodePlannerInput(request(), inputBlobs);
    const json = plannerJsonBytes(request());
    expect(wire.subarray(0, 8)).toEqual(MAGIC);
    expect(wire.subarray(8, 17)).toEqual(header(0x01, json.byteLength));
    expect(wire.subarray(17, 17 + json.byteLength)).toEqual(json);
    expect(json[json.byteLength - 1]).not.toBe(0x0a);
  });

  const json = bytes('{"a":1}');
  it.each<{ name: string; wire: Uint8Array }>([
    { name: "a wrong magic", wire: join(bytes("DOSUPD2\n"), header(0x01, json.byteLength), json, header(0x03, 0)) },
    { name: "an unknown frame kind", wire: join(MAGIC, header(0x01, json.byteLength), json, header(0x04, 0)) },
    { name: "an output kind on stdin", wire: join(MAGIC, header(0x11, json.byteLength), json, header(0x13, 0)) },
    { name: "a blob before the request", wire: join(MAGIC, header(0x02, 1), Uint8Array.of(1), header(0x01, json.byteLength), json, header(0x03, 0)) },
    { name: "a second request frame", wire: join(MAGIC, header(0x01, json.byteLength), json, header(0x01, json.byteLength), json, header(0x03, 0)) },
    { name: "an end frame with a payload", wire: join(MAGIC, header(0x01, json.byteLength), json, header(0x03, 1), Uint8Array.of(0)) },
    { name: "an empty request frame", wire: join(MAGIC, header(0x01, 0), header(0x03, 0)) },
    { name: "a trailing byte", wire: join(MAGIC, header(0x01, json.byteLength), json, header(0x03, 0), Uint8Array.of(0)) },
    { name: "a missing end frame", wire: join(MAGIC, header(0x01, json.byteLength), json) },
    { name: "a truncated payload", wire: join(MAGIC, header(0x01, json.byteLength + 5), json) },
    { name: "a truncated header", wire: join(MAGIC, header(0x01, json.byteLength), json, Uint8Array.of(0x03, 0)) },
    { name: "a blob declared above 16 MiB", wire: join(MAGIC, header(0x01, json.byteLength), json, header(0x02, 16_777_217)) },
    { name: "a request declared above 256 MiB", wire: join(MAGIC, header(0x01, 268_435_457)) },
    { name: "a length above the 64-bit safe range", wire: join(MAGIC, Uint8Array.of(0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff)) },
  ])("refuses $name", ({ wire }) => {
    expect(() => frames("input", wire)).toThrow();
  });

  it("refuses the first blob beyond the count, aggregate, or wire bounds", () => {
    const tight = { ...PLANNER_WIRE_BOUNDS_V1, inputBlobCount: 1, inputBlobBytes: 4, stdinWireBytes: 64 };
    const one = join(MAGIC, header(0x01, json.byteLength), json, header(0x02, 1), Uint8Array.of(1));
    expect(() => new PlannerWireDecoder("input", tight).push(join(one, header(0x02, 1), Uint8Array.of(2)))).toThrow();
    expect(() => new PlannerWireDecoder("input", tight).push(join(MAGIC, header(0x01, json.byteLength), json, header(0x02, 5)))).toThrow();
    expect(() => new PlannerWireDecoder("input", tight).push(join(one, header(0x03, 0), new Uint8Array(64)))).toThrow();
  });

  it("refuses to encode past a bound before emitting the frame", () => {
    const encoder = new PlannerWireEncoder("input", { ...PLANNER_WIRE_BOUNDS_V1, inputBlobCount: 1, inputBlobBytes: 2 });
    encoder.magic();
    encoder.json(json);
    expect(() => encoder.blob(new Uint8Array(3))).toThrow();
    encoder.blob(new Uint8Array(1));
    expect(() => encoder.blob(new Uint8Array(1))).toThrow();
    encoder.end();
    expect(() => encoder.end()).toThrow();
  });

  it("refuses to encode output whose blobs differ from the draft references", () => {
    expect(() => encodePlannerOutput(request(), draft(), outputBlobs.slice(1))).toThrow();
    expect(() => encodePlannerOutput(request(), draft(), [bytes("x"), ...outputBlobs.slice(1)])).toThrow();
  });

  it("refuses input blobs that differ from their references", () => {
    expect(() => encodePlannerInput(request(), [codexBytes, configBytes, noteBytes])).toThrow();
    const wire = encodePlannerInput(request(), inputBlobs);
    const last = wire.byteLength - 10;
    wire[last] = (wire[last] as number) ^ 0xff;
    expect(() => decodePlannerInput(wire)).toThrow();
  });
});

describe("planner transcript hashes", () => {
  it("hashes JSON frames under direction-separated domains", () => {
    const payload = plannerJsonBytes(request());
    expect(plannerJsonHash("input", payload)).toBe(sha(join(bytes("developer-os/update-planner-request/v1\0"), payload)));
    expect(plannerJsonHash("output", payload)).toBe(sha(join(bytes("developer-os/update-planner-result/v1\0"), payload)));
  });

  it("hashes the zero count for an empty blob set", () => {
    expect(plannerBlobSetHash("input", [])).toBe(sha(join(bytes("developer-os/update-planner-input-blobs/v1\0"), uint64(0))));
    expect(plannerBlobSetHash("output", [])).not.toBe(plannerBlobSetHash("input", []));
  });

  it("hashes the count, then each ordinal, length, raw digest, and bytes", () => {
    const tuple = (blob: Uint8Array, ordinal: number): Uint8Array => join(uint64(ordinal), uint64(blob.byteLength), Buffer.from(sha(blob), "hex"), blob);
    const expected = sha(join(bytes("developer-os/update-planner-output-blobs/v1\0"), uint64(2), tuple(outputBlobs[0] as Uint8Array, 0), tuple(outputBlobs[1] as Uint8Array, 1)));
    expect(plannerBlobSetHash("output", outputBlobs.slice(0, 2))).toBe(expected);
  });

  it("refuses an out-of-order or incomplete blob set", () => {
    const skipped = new PlannerBlobSetHasher("input", 2);
    expect(() => {
      skipped.add(1, codexBytes, sha(codexBytes));
    }).toThrow();
    const short = new PlannerBlobSetHasher("input", 2);
    short.add(0, configBytes, sha(configBytes));
    expect(() => short.digest()).toThrow();
  });
});

describe("planner draft materialization", () => {
  const tokenPaths = new Map<PlannerPathTokenV1, CanonicalAbsolutePathV1>([
    [t(0), parseCanonicalAbsolutePathText("/product/state/config.json")],
    [t(1), parseCanonicalAbsolutePathText("/product/state")],
    [t(2), parseCanonicalAbsolutePathText("/home/.codex/large.bin")],
    [t(3), parseCanonicalAbsolutePathText("/home/.codex/skill.md")],
  ]);
  const screened = (): SecretScreenedBlobV1[] =>
    outputBlobs.map((content, ordinal) => ({ ordinal, bytes: content.byteLength, sha256: sha(content), content }) as SecretScreenedBlobV1);

  function transcript(): PlannerTranscriptIdentityV1 {
    return {
      protocol: request().protocol,
      bounds: PLANNER_WIRE_BOUNDS_V1,
      requestHash: plannerJsonHash("input", plannerJsonBytes(request())),
      inputBlobsHash: plannerBlobSetHash("input", inputBlobs),
      resultHash: plannerJsonHash("output", plannerJsonBytes(draft())),
      outputBlobsHash: plannerBlobSetHash("output", outputBlobs),
    };
  }

  function context(overrides: Partial<PlannerDraftMaterializationContextV1> = {}): PlannerDraftMaterializationContextV1 {
    const rollbackRoot = parseCanonicalAbsolutePathText("/product/rollback/payload");
    const entries: RollbackPayloadEntryV1[] = [
      { ordinal: 0, path: admitRollbackPayloadRelativePath("blobs/0000000000.bin", rollbackRoot, evidence), role: "owner_preimage", bytes: codexBytes.byteLength, sha256: sha(codexBytes) },
      { ordinal: 1, path: admitRollbackPayloadRelativePath("plans/owner_inverse/codex.plan.json", rollbackRoot, evidence), role: "inverse_plan_leaf", bytes: 20, sha256: sha("leaf") },
    ];
    const capacity: UpdateCapacityInputV1 = {
      operation: "update",
      components: [{ kind: "active", bytes: u("100"), entries: u("10") }],
      reservationGranularityBytes: u("4096"),
      availableBytes: u("1000000"),
      availableEntries: u("1000"),
    };
    return {
      tokenPaths,
      ownerRoots: { codex: parseCanonicalAbsolutePathText("/home/.codex") },
      transcript: transcript(),
      metadata: { delegationSequence: u("1"), delegationHash: sha("delegation"), delegatedReleaseKeyId: sha("key"), releaseIndexSequence: u("2"), releaseIndexHash: sha("index-2") },
      download: { archiveBytes: u("1024"), archiveSha256: sha("archive"), expandedBytes: u("4096"), entryCount: 3 },
      retainedRollback: { release: release("1.0.0", "1"), payload: { payloadId: parseRollbackPayloadId(`rb_${sha("nonce")}_1`), entryCount: 2, aggregateBytes: 64 } },
      capacity,
      concreteManifest: { artifacts: [], schemaVersion: 2 },
      inverseLeaves: [{ kind: "owner_inverse", id: parseSafeReasonCode("codex"), projection: { owner: "codex" } }],
      inversePlan: { leaves: 1 },
      rollbackInventoryEntries: entries,
      ...overrides,
    };
  }

  it("builds a candidate whose owner and migration previews come from the token map", () => {
    const candidate = materializePlannerDraft(request(), draft(), screened(), context());
    const [core, codex] = candidate.preview.owners;
    expect(core?.paths.unchanged).toEqual(["/product/state", "/product/state/config.json"]);
    expect(codex?.paths).toEqual({
      create: ["/home/.codex/skills/new.md"],
      replace: ["/home/.codex/skill.md"],
      remove: [],
      unchanged: ["/home/.codex/large.bin"],
    });
    expect(codex?.counts.externalEffects).toBe(1);
    expect(candidate.preview.migrations.map((migration) => migration.affectedPaths)).toEqual([["notes/a.md"], ["/product/state/config.json"]]);
    expect(candidate.materialization.outputBlobs).toEqual(screened().map(({ ordinal, bytes: size, sha256 }) => ({ ordinal, bytes: size, sha256 })));
    expect(JSON.stringify(candidate.preview)).not.toContain(transcript().requestHash);
  });

  it("refuses a transcript that names another output set", () => {
    const other = { ...transcript(), outputBlobsHash: plannerBlobSetHash("output", [bytes("x")]) };
    expect(() => materializePlannerDraft(request(), draft(), screened(), context({ transcript: other }))).toThrow();
  });

  it("refuses a transcript that names another request", () => {
    const other = { ...transcript(), requestHash: sha("other request") };
    expect(() => materializePlannerDraft(request(), draft(), screened(), context({ transcript: other }))).toThrow();
  });

  it("refuses a screened blob whose hash does not match its bytes", () => {
    const blobs = screened();
    blobs[0] = { ...blobs[0], sha256: sha("other") } as SecretScreenedBlobV1;
    expect(() => materializePlannerDraft(request(), draft(), blobs, context())).toThrow();
  });

  it("refuses a create for an owner without a root", () => {
    expect(() => materializePlannerDraft(request(), draft(), screened(), context({ ownerRoots: {} }))).toThrow();
  });
});
