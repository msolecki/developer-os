import { createHash } from "node:crypto";

import {
  decodeCanonicalJson,
  EXIT_CODES,
  LifecycleRecoveryRequiredError,
  ownerExternalEffectProcessPolicyHash,
  parseCanonicalAbsolutePathText,
  parseLowerHexSha256,
  parseStableSemver,
  parseUtcTimestamp,
  type CanonicalAbsolutePathV1,
  type LowerHexSha256,
  type ManagedArtifactV2,
} from "@developer-os/core";
import type { SystemPathObservationV1 } from "@developer-os/security";
import { describe, expect, it } from "vitest";

import { codexPluginTreeHash, validateCodexRegistrationRecord } from "../instructions/codex-registration.js";
import { codexExecutableResolver, codexRefreshPolicy, codexRegistrationRow, requireCodexRegistered, resolveCodexExecutable, type CodexExecutableFileSystemV1 } from "./codex-refresh.js";
import { resolveOwnerEffectProcess } from "./external-effect.js";
import { UpdatePlanningRefusal } from "./planning.js";

const UID = 501;
const sha = (value: string): LowerHexSha256 => parseLowerHexSha256(createHash("sha256").update(value).digest("hex"));
const path = (text: string): CanonicalAbsolutePathV1 => parseCanonicalAbsolutePathText(text);

type PresentObservation = Exclude<SystemPathObservationV1, { kind: "absent" }>;
const directory = (ownerUid: number, mode = 0o755): PresentObservation => ({ kind: "directory", ownerUid, mode, dev: "1", ino: "10", size: 64, sha256: null });
const file = (ownerUid: number, mode = 0o755, content = "synthetic codex"): PresentObservation => ({ kind: "file", ownerUid, mode, dev: "1", ino: "42", size: content.length, sha256: sha(content) });

/**
 * A Homebrew-shaped host: `/synthetic/brew/bin/codex` links into the Cellar. Synthetic, so the
 * result never depends on the permission chain of the machine running the suite.
 */
function host(overrides: Record<string, SystemPathObservationV1> = {}): CodexExecutableFileSystemV1 & { table: Map<string, SystemPathObservationV1> } {
  const table = new Map<string, SystemPathObservationV1>(Object.entries({
    "/": directory(0),
    "/synthetic": directory(0),
    "/synthetic/brew": directory(UID),
    "/synthetic/brew/bin": directory(UID),
    "/synthetic/brew/bin/codex": { kind: "symlink", ownerUid: UID, mode: 0o755, dev: "1", ino: "41", size: 30, sha256: null },
    "/synthetic/brew/Cellar": directory(UID),
    "/synthetic/brew/Cellar/codex": directory(UID),
    "/synthetic/brew/Cellar/codex/bin": directory(UID),
    "/synthetic/brew/Cellar/codex/bin/codex": file(UID),
    ...overrides,
  }));
  const links = new Map([["/synthetic/brew/bin/codex", "/synthetic/brew/Cellar/codex/bin/codex"]]);
  return {
    table,
    effectiveUid: UID,
    realpath: (target) => Promise.resolve(links.get(target) ?? target),
    inspect: (target) => Promise.resolve(table.get(target) ?? { kind: "absent" }),
  };
}

const SELECTED = path("/synthetic/brew/bin/codex");
const REAL = "/synthetic/brew/Cellar/codex/bin/codex";

async function refusal(work: Promise<unknown>): Promise<UpdatePlanningRefusal> {
  const error: unknown = await work.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(UpdatePlanningRefusal);
  return error as UpdatePlanningRefusal;
}

describe("resolveCodexExecutable (D72 Q2-A)", () => {
  it("resolves a symlinked codex to its target's canonical path and identity (Review Focus 3)", async () => {
    expect(await resolveCodexExecutable(SELECTED, host())).toEqual({
      canonicalPath: REAL,
      identity: { dev: "1", ino: "42", mode: 0o755, sha256: sha("synthetic codex") },
    });
  });

  it("admits a root-owned target under root-owned ancestors", async () => {
    const rootOwned = host({ [REAL]: file(0, 0o555), "/synthetic/brew/Cellar/codex/bin": directory(0) });
    expect((await resolveCodexExecutable(SELECTED, rootOwned)).identity.mode).toBe(0o555);
  });

  it.each<[string, Record<string, SystemPathObservationV1>]>([
    ["a group-writable target", { [REAL]: file(UID, 0o775) }],
    ["an other-writable target", { [REAL]: file(UID, 0o757) }],
    ["a target without the owner-execute bit", { [REAL]: file(UID, 0o644) }],
    ["a setuid target", { [REAL]: file(UID, 0o4755) }],
    ["a target owned by another user", { [REAL]: file(502) }],
    ["a target that is not a regular file", { [REAL]: directory(UID) }],
    ["a target whose bytes could not be hashed", { [REAL]: { ...file(UID), sha256: null } }],
    ["an absent target", { [REAL]: { kind: "absent" } }],
    ["a group-writable ancestor", { "/synthetic/brew/Cellar": directory(UID, 0o775) }],
    ["an other-writable ancestor", { "/synthetic/brew/Cellar/codex": directory(UID, 0o757) }],
    ["a sticky world-writable ancestor", { "/synthetic": directory(0, 0o1777) }],
    ["an ancestor owned by another user", { "/synthetic/brew/Cellar/codex/bin": directory(502) }],
    ["a group-writable root", { "/": directory(0, 0o775) }],
  ])("refuses %s, exit 5", async (_name, overrides) => {
    const error = await refusal(resolveCodexExecutable(SELECTED, host(overrides)));
    expect(error.code).toBe(EXIT_CODES.securityRefusal);
    expect(error.reason).toBe("update_codex_executable_untrusted");
  });

  it("does not inspect the selected link's own directory chain, only the real path's", async () => {
    // The link's directory may be anything; the pinned executable is the link's target.
    expect((await resolveCodexExecutable(SELECTED, host({ "/synthetic/brew/bin": directory(UID, 0o777) }))).canonicalPath).toBe(REAL);
  });
});

describe("codexExecutableResolver: the recheck before spawn", () => {
  it("returns the real path when the pinned identity still holds", async () => {
    const fs = host();
    const executable = await resolveCodexExecutable(SELECTED, fs);
    expect(await codexExecutableResolver(executable, fs)(executable.identity)).toBe(REAL);
  });

  it.each<[string, (fs: ReturnType<typeof host>) => void]>([
    ["replaced bytes", (fs) => fs.table.set(REAL, file(UID, 0o755, "other codex"))],
    ["a replaced inode", (fs) => fs.table.set(REAL, { ...file(UID), ino: "43" })],
    ["a changed mode", (fs) => fs.table.set(REAL, file(UID, 0o700))],
    ["an ancestor made group-writable", (fs) => fs.table.set("/synthetic/brew/Cellar", directory(UID, 0o775))],
  ])("refuses %s as a participant refusal", async (_name, mutate) => {
    const fs = host();
    const executable = await resolveCodexExecutable(SELECTED, fs);
    mutate(fs);
    await expect(codexExecutableResolver(executable, fs)(executable.identity)).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
  });

  it("refuses an identity other than the plan's pin", async () => {
    const fs = host();
    const executable = await resolveCodexExecutable(SELECTED, fs);
    await expect(codexExecutableResolver(executable, fs)({ ...executable.identity, sha256: sha("pinned elsewhere") })).rejects.toBeInstanceOf(LifecycleRecoveryRequiredError);
  });
});

describe("codexRefreshPolicy", () => {
  it("builds a policy the Core validator admits, with exactly `plugin add <plugin_id> --json` under CODEX_HOME and TMPDIR", async () => {
    const executable = await resolveCodexExecutable(SELECTED, host());
    const policy = codexRefreshPolicy(executable);
    expect(() => ownerExternalEffectProcessPolicyHash(policy)).not.toThrow();
    expect(policy.executableIdentity).toEqual(executable.identity);
    const tokens = { managedPluginRoot: "/synthetic/product/codex/plugins/developer-os", pluginId: "developer-os@developer-os", privateEffectTmp: "/synthetic/tmp/effect", managedVendorHome: "/synthetic/elsewhere/codex-home" };
    const request = resolveOwnerEffectProcess(policy, REAL, tokens);
    expect(request.argv).toEqual(["plugin", "add", "developer-os@developer-os", "--json"]);
    expect(request.env).toEqual({ CODEX_HOME: "/synthetic/elsewhere/codex-home", TMPDIR: "/synthetic/tmp/effect" });
    expect(Object.keys(request.env)).toEqual(["CODEX_HOME", "TMPDIR"]);
  });
});

describe("codexRegistrationRow (Spec 2 P6(d))", () => {
  const homes = { userHome: path("/synthetic/user"), productHome: path("/synthetic/user/.developer-os"), codexHome: path("/synthetic/custom-codex-home") };
  const pluginRoot = "/synthetic/user/.developer-os/codex/plugins/developer-os";
  const productVersion = parseStableSemver("1.2.0");
  const plannedAt = parseUtcTimestamp("2026-09-28T10:00:00.000Z");

  function row(target: string, verification: ManagedArtifactV2["verification"], kind: ManagedArtifactV2["kind"] = "file"): ManagedArtifactV2 {
    return {
      owner: "codex",
      path: path(target),
      productVersion,
      existedBefore: false,
      beforeHash: null,
      backupRelativePath: null,
      source: "codex/x" as ManagedArtifactV2["source"],
      mergeStrategy: "dedicated",
      verifiedAt: plannedAt,
      kind,
      verification,
    } as ManagedArtifactV2;
  }

  const postimage: readonly ManagedArtifactV2[] = [
    row(pluginRoot, { mode: "content" }, "directory"),
    row(`${pluginRoot}/skills/b.md`, { mode: "content", installedHash: sha("b") }),
    row(`${pluginRoot}/.codex-plugin/plugin.json`, { mode: "content", installedHash: sha("manifest") }),
    row("/synthetic/user/.developer-os/codex/.agents/plugins/marketplace.json", { mode: "content", installedHash: sha("marketplace") }),
    { ...row("/synthetic/user/.developer-os/codex/registration.json", { mode: "schema", schemaId: "codex-registration-v1", installedHash: sha("old record") }), existedBefore: true },
  ];

  it("records the Codex home and codexPluginTreeHash over the plugin tree's content files", () => {
    const { artifact, bytes } = codexRegistrationRow({ homes, productVersion, plannedAt, ownerPostimage: postimage });
    const record = validateCodexRegistrationRecord(new TextEncoder().encode(bytes));
    expect(record).toEqual({
      codexHome: "/synthetic/custom-codex-home",
      treeHash: codexPluginTreeHash([{ path: "skills/b.md", sha256: sha("b") }, { path: ".codex-plugin/plugin.json", sha256: sha("manifest") }]),
    });
    expect(artifact).toEqual({
      owner: "codex",
      path: "/synthetic/user/.developer-os/codex/registration.json",
      productVersion,
      existedBefore: true,
      beforeHash: null,
      backupRelativePath: null,
      source: "generated/codex/registration.json",
      mergeStrategy: "dedicated",
      verifiedAt: plannedAt,
      kind: "file",
      verification: { mode: "schema", schemaId: "codex-registration-v1", installedHash: sha(bytes) },
    });
    expect(decodeCanonicalJson(new TextEncoder().encode(bytes), 8192)).toEqual(record);
  });

  it("derives byte-equal output on a second derivation", () => {
    const input = { homes, productVersion, plannedAt, ownerPostimage: postimage };
    expect(codexRegistrationRow(input)).toEqual(codexRegistrationRow(input));
  });

  it("changes the tree hash when a plugin file changes", () => {
    const changed = postimage.map((artifact) => artifact.path.endsWith("b.md") ? row(artifact.path, { mode: "content", installedHash: sha("b2") }) : artifact);
    expect(codexRegistrationRow({ homes, productVersion, plannedAt, ownerPostimage: changed }).bytes).not.toBe(codexRegistrationRow({ homes, productVersion, plannedAt, ownerPostimage: postimage }).bytes);
  });
});

describe("requireCodexRegistered (Spec 2 P6(c))", () => {
  it("admits `registered`", () => {
    expect(() => {
      requireCodexRegistered("registered");
    }).not.toThrow();
  });

  it.each(["stale", "unregistered"] as const)("refuses `%s` as owner drift, exit 3", (state) => {
    let error: unknown = null;
    try {
      requireCodexRegistered(state);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(UpdatePlanningRefusal);
    expect((error as UpdatePlanningRefusal).code).toBe(EXIT_CODES.decisionRequired);
  });
});
