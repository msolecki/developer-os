# Task 11b: Trust the Homebrew Package Channel (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan one task at a time. Steps use checkbox (`- [ ]`) syntax for tracking. The orchestration rules in `docs/superpowers/SESSION.md` §4.1 apply. Each task runs in its own worktree at `../developer-os.worktrees/<task>`. Only the orchestrator edits `docs/superpowers/`.

**Goal:** `developer-os update` and `update rollback` work end to end on a release that Homebrew installs from the tap `msolecki/homebrew-developer-os`. The product checks no signature and makes no network request. The launcher no longer uses the FD 3 trust handoff.

**Architecture:** One packer turns a commit into one keg tree per architecture. Each tree holds the real unsigned release format: an exact `ReleaseBundleManifestV1`, a one-row `ReleaseIndexV1`, and the `{schemaVersion, trust}` delegation stand-in. The CLI finds a keg only through a fixed per-architecture table in Core. It resolves `opt/developer-os` once, admits the keg by owner, mode class, inventory and hash, and records `trust: "package-channel"`. The admitted keg replaces the FD 3 trust, the transport and the scratch extraction as the update source. The existing bundle publication copies the keg into `releases/<version>/darwin-<arch>` with the manifest's modes. The launcher admits a package-channel active release by inventory and hash, and uses the keg's `libexec/fallback` as its packaged fallback. Signature code, transport code and FD 3 code are deleted only after the keg path has replaced them (Task 13).

**Tech Stack:** TypeScript (strict), Node 24, pnpm workspace, vitest, esbuild (already a devDependency of the packer), Homebrew.

**Spec:** `docs/superpowers/specs/2026-08-28-developer-os-release-update-design.md`, block "**Amended 2026-10-07 (D84, Task 11b)**" (K1–K6, with K2–K4 revised the same day). Also read the block's D72 items (c) and (d) (P7). The block re-scopes the BACKLOG rows NEW-111, NEW-112, NEW-118, NEW-163 and NEW-171.

---

## Founder decisions (answered 2026-10-07, D96: every recommended answer accepted)

The spec and the code disagreed in the places below. Each task that depends on a decision names it on its `Consumes:` line. The plan implements the **recommended** answer. A different answer changes only the named task.

- **Q1: Homebrew's own directories are group-writable (blocks Task 2).** On the founder machine, `stat` shows `drwxrwxr-x msolecki admin /opt/homebrew/Cellar` and the same for `/opt/homebrew/opt`. K2 says "the keg root and every ancestor up to the prefix are owned by the current user or root with no group or other write". Under that rule every real install is refused with exit 6. **Recommended:** reuse the D83 (3) rule of `assertTrustedExecutable` (`packages/platform-macos/src/macos.ts:322-330`). Group write is admitted only on a directory the current uid owns. It is refused on a root-owned directory and on a directory another user owns. Other-write is always refused. This keeps the residual D83 (3) already accepts for `/opt/homebrew/bin`.
- **Q2: The index row has archive fields, but a keg has no archive (blocks Task 8).** `ReleaseIndexEntryV1.bundles` holds exactly two references, `[arm64, x64]`. Each reference needs `archivePath` ending in `.tar.zst`, `archiveBytes` of at least 1 and `archiveSha256`. `releaseIdentityHash` hashes all of these fields, and `admitReleaseIdentity` checks them against each other (`packages/core/src/update/release.ts:340-391`). **Recommended:** the packer builds both architectures in one run, which means it needs two official Node 24 binaries. It also writes each bundle's real zstd-ustar archive and manifest beside the keg trees (`<out>/archives/<version>/darwin-<arch>.tar.zst`, `….manifest.json`), so the fields describe real bytes that A16 can publish later. The keg trees do not contain the archives.
- **Q3: The real target planner can only keep every owner (affects Task 5; K5 (3) is latent).** The repository has no target-planner program yet. A planner graph may not touch `fs`, `process` or `import.meta` (`packages/security/src/update/graph.ts:42-90`), so it cannot read workflows at run time. The pack-time owner trees also embed the user's product-home path in hook commands (`withClaudeHooks`, `renderCodexHooks` take a `HookCommandExecutable`), so they cannot be baked into a release. **Recommended:** the first real planner keeps every installed owner's partition. This is the same keep-all draft the §12 synthetic proof already runs (`apps/cli/src/update/testing.ts` `keepAllDraft`). An update then changes the bundle, the metadata, trust, active and the rollback payload, but not vendor trees. Changing owner trees through `update` needs its own spec item. The F8 / NEW-118 (3) code still lands (Task 4) and takes effect when a planner proposes a Codex change.
- **Q4: An `unsigned-local` bundle manifest has no `entrypoint` (affects Task 11).** NEW-163 option B says to derive the CLI path from the bundle manifest. The retained manifest of an `unsigned-local` home is `{files, schemaVersion, trust}`. **Recommended:** the entrypoint uses `manifest.entrypoint` when it is present, and otherwise the fixed `LOCAL_BUNDLE_CLI_ENTRY`.
- **Q5: Use a VM for the "disposable account" (affects Task 14).** The table fixes the arm64 prefix to `/opt/homebrew`, which the founder's user owns. A second macOS account cannot `brew install` into it. It would also fail K2's "owned by the current user or root" rule against a keg the founder owns. **Recommended:** run the disposable-account gate in a fresh macOS VM whose only user owns that VM's `/opt/homebrew`, then once on the founder machine as K6 requires.

Interpretations the plan takes without a question:

- The keg's "release index document" is a `ReleaseIndexV1` with exactly one row. Its `sequence` is the stamped `releaseIndexSequence`, so `validateReleaseIndex` and `selectRelease` run unchanged.
- `delegatedReleaseKeyId` is the fixed `PACKAGE_CHANNEL_RELEASE_KEY_ID`, which is SHA-256 of `developer-os:package-channel-release-key:v1`. It mirrors `UNSIGNED_LOCAL_RELEASE_KEY_ID`.
- K2 makes the planner and verifier "compiled bundles" that join `PLANNER_ENTRYPOINTS`. The graph gate refuses `process`, so each bundle is two parts. A pure module joins `PLANNER_ENTRYPOINTS`. A stdio shim, which the gate does not scan, only frames stdin and stdout and calls the pure module. The four existing entries in `PLANNER_ENTRYPOINTS` already follow this pattern.
- §4.4 is not withdrawn. `packages/security/src/update/archive.ts`, `scratch.ts` and their tests stay, but production can no longer reach them.
- The D72 (c) persisted-format migrations get no task (K4, founder decision F5).
- `update_launcher_too_old` compares the selected row's `minimumLauncherProtocol` with the target bundle manifest's `launcherProtocol`. The FD 3 `handoffProtocol` that the old check used no longer exists.

## Global Constraints

- Work on `integrate/2026-10-07` (orchestrator). Implementers branch `task/<n>` from it in `../developer-os.worktrees/<n>` (D33; an in-repository worktree breaks `eslint`).
- Per commit: the task's fast commands, then `npm run lint`. Slow suites (any `npm run test…`, `npm run check`, `*.v2.test.ts`, `apps/cli/src/bootstrap/executor.test.ts`, `tests/e2e`, `tests/security`, `tests/integration`) run only for the task's own cases, filtered with `-t`, red then green. Everything else waits for plan close (D32). Tick a deferred step as "deferred to plan close (D32)".
- `npm run check` runs once, at Task 14, by the founder.
- Exact-path staging only. Never `git add -A`, `git add .` or a wildcard.
- The product makes no network request for an update (K1). After Task 13, no product module imports `node:https`, `node:http`, `node:http2`, `node:tls`, `node:dns`, `node:dgram` or `undici`, and none calls `fetch`.
- The table is the only keg locator: `arm64` → `/opt/homebrew/opt/developer-os/libexec/fallback`, `x64` → `/usr/local/opt/developer-os/libexec/fallback`. The CLI never reads `PATH` and never runs `brew`. It resolves the `opt` symlink once, to `<prefix>/Cellar/developer-os/<version>/`.
- Keg source modes: directories `0755`, files `0644` or `0755`, one link each. Every size and SHA-256 equals the bundle manifest. Copied modes are the manifest's own (`0700` for directories and executables, `0600` otherwise). The copy compares the permission class (executable or not).
- Exit codes (`packages/core/src/result.ts`): a missing table path is `update_package_source_absent`, exit 4. Any keg admission failure is exit 6 (`EXIT_CODES.recoveryRequired`).
- `releaseSequence` and `releaseIndexSequence` are packer inputs, and both strictly increase across published releases. A lower keg refuses as a downgrade.
- `ReleaseTrustStateV1.trust` takes the values absent, `"unsigned-local"` or `"package-channel"`. An `unsigned-local` home never updates (NEW-147 refusal, unchanged).
- `pack:local-release` keeps its install-only `unsigned-local` output unchanged.
- Release code still imports `@developer-os/core/planner-protocol` and never the barrel, because the barrel reaches `node:fs`.
- Public-bound repository: synthetic fixtures only. No founder paths or private content in committed files.
- Every enumerating gate asserts a non-empty set per scope (SESSION hard rule).

## Review Focus

1. **An upgrade lands between two `update` runs, or during recovery.** After `brew upgrade`, the `opt` link names a new keg. A recovery executor record with `package_fallback` (`state/update-executor.json`) pins the old fallback's manifest hash. The launcher must refuse with `launcher_update_fallback_mismatch` (exit 6). It must never run the new keg against the old record. Test: Task 12, step 1, case (e).
2. **`brew cleanup` deletes the keg after an update.** The active release and the rollback release must still launch and roll back from `releases/<version>` alone, with no read of `Cellar`. Test: Task 9, step 1, case (d): remove the fixture keg after apply, then `update rollback --apply` succeeds.
3. **The trust value now has three states.** `isUnsignedLocalTrust` reads `"trust" in state` today. With that check, a `package-channel` home would refuse every update and the launcher would send it to recovery. Test: Task 1, step 1, the `isUnsignedLocalTrust` and `advanceReleaseTrust` cases.
4. **A keg whose files Homebrew left `0644`/`0755`, or a keg owned by root.** Admission and `copyVerified` must accept both permission classes. The copy must write `0600`/`0700`. A `0666` file or a group-writable directory owned by root must refuse with exit 6. Test: Task 2, step 1, cases (b)–(d), and Task 9, step 1, case (c).
5. **The same version is installed again with different bytes.** The index row and manifest hashes differ while the version is equal. `update` must refuse `update_release_identity_rebound` (exit 5) and must never report `up_to_date`. Test: Task 9, step 1, case (e).

---

## Wave table

| Wave | Tasks (size) | Starts when integrated |
|---|---|---|
| 1 | 1 (S), 4 (S), 5 (M), 7 (S), 11 (M) | nothing |
| 2 | 2 (M), 6 (M), 12 (L) | 2 ← 1 (and Q1); 6 ← 5; 12 ← 1 |
| 3 | 3 (M), 8 (L) | 3 ← 2; 8 ← 2, 4, 5, 6 (and Q2) |
| 4 | 9 (L) | 3, 7 |
| 5 | 10 (M) | 9 |
| 6 | 13 (L) | 8, 9, 10, 11, 12 |
| 7 | 14 (M, founder) | 1–13 |

Shared files inside one wave take the union (D33): `packages/core/src/planner-protocol.ts` (Tasks 4, 5) and `tests/repository/check.ts` (Tasks 5, 6).

---

### Task 1: Core: the `package-channel` trust value, the shared layout and the table (S)

**Files:**
- Modify: `packages/core/src/update/release.ts` (around 189–205 for the trust union and `isUnsignedLocalTrust`; 463–496 for `validateReleaseTrustState`, `advanceReleaseTrust` and `admitReleaseAgainstTrust`; 348 to export `validateReleaseIndexEntry`)
- Modify: `packages/core/src/update/index.ts` (exports)
- Test: `packages/core/src/update/release.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, all from `@developer-os/core`:
  - `type PackageChannelReleaseTrustStateV1 = SignedReleaseTrustStateV1 & { readonly trust: "package-channel" }`; `ReleaseTrustStateV1` becomes `Signed… | UnsignedLocal… | PackageChannel…`.
  - `isUnsignedLocalTrust(state): state is UnsignedLocalReleaseTrustStateV1`, now `state.trust === "unsigned-local"`.
  - `isPackageChannelTrust(state): state is PackageChannelReleaseTrustStateV1`.
  - `PACKAGE_CHANNEL_RELEASE_KEY_ID: LowerHexSha256`.
  - `PACKAGE_CHANNEL_LAYOUT = { delegation: "metadata/release-key-delegation.json", releaseIndex: "metadata/release-index.json", bundleManifest: "metadata/bundle-manifest.json", bundleRoot: "bundle" } as const`. The paths equal `UNSIGNED_LOCAL_LAYOUT`.
  - `PACKAGE_CHANNEL_DELEGATION_BYTES: Uint8Array`, the canonical `{"schemaVersion":1,"trust":"package-channel"}` plus LF, and `validatePackageChannelDelegation(value: unknown): void`.
  - `PACKAGE_CHANNEL_SOURCE_TABLE: Readonly<Record<"arm64" | "x64", { readonly prefix: CanonicalAbsolutePathV1; readonly opt: CanonicalAbsolutePathV1; readonly fallback: "libexec/fallback" }>>` with `arm64: { prefix: "/opt/homebrew", opt: "/opt/homebrew/opt/developer-os" }` and `x64: { prefix: "/usr/local", opt: "/usr/local/opt/developer-os" }`.
  - `validateReleaseIndexEntry` is exported.
  - `advanceReleaseTrust` returns a state that keeps `trust: "package-channel"` when its input carries it.

- [ ] **Step 1: Write the failing tests** (append to `release.test.ts`; `signedTrust()` is the file's existing helper for a no-member state. If the helper has another name, use that one):

```ts
import { advanceReleaseTrust, admitReleaseAgainstTrust, isPackageChannelTrust, isUnsignedLocalTrust, PACKAGE_CHANNEL_DELEGATION_BYTES, PACKAGE_CHANNEL_RELEASE_KEY_ID, PACKAGE_CHANNEL_SOURCE_TABLE, validatePackageChannelDelegation, validateReleaseTrustState } from "./release.js";
import { decodeCanonicalJson } from "../lifecycle/canonical-json.js";

describe("the package-channel trust value (D84 K4)", () => {
  const channel = () => ({ ...signedTrust(), trust: "package-channel" as const });

  it("admits the value and keeps it distinct from unsigned-local", () => {
    const state = validateReleaseTrustState(channel());
    expect(isPackageChannelTrust(state)).toBe(true);
    expect(isUnsignedLocalTrust(state)).toBe(false);
    expect(() => validateReleaseTrustState({ ...signedTrust(), trust: "root-verified" })).toThrow();
  });

  it("advances a package-channel state and keeps its trust member", () => {
    const state = channel();
    const next = advanceReleaseTrust(state, {
      delegationSequence: state.highestDelegationSequence, delegationHash: state.delegationHash, delegatedReleaseKeyId: state.delegatedReleaseKeyId,
      releaseIndexSequence: (BigInt(state.highestReleaseIndexSequence) + 1n).toString() as never, releaseIndexHash: "b".repeat(64) as never,
      releaseSequence: (BigInt(state.highestAcceptedReleaseSequence) + 1n).toString() as never, releaseIdentityHash: "c".repeat(64) as never,
    });
    expect(next).toMatchObject({ trust: "package-channel", releaseIndexHash: "b".repeat(64) });
  });

  it("refuses a lower release sequence as an online downgrade", () => {
    const state = channel();
    expect(() => admitReleaseAgainstTrust(state, { releaseSequence: "0" as never, releaseIdentityHash: "d".repeat(64) as never }, "online_target")).toThrow(/downgrade|replay/u);
  });

  it("pins the delegation stand-in, the key id and the fixed table", () => {
    expect(new TextDecoder().decode(PACKAGE_CHANNEL_DELEGATION_BYTES)).toBe('{"schemaVersion":1,"trust":"package-channel"}\n');
    expect(() => validatePackageChannelDelegation(decodeCanonicalJson(PACKAGE_CHANNEL_DELEGATION_BYTES, 1024))).not.toThrow();
    expect(() => validatePackageChannelDelegation({ schemaVersion: 1, trust: "unsigned-local" })).toThrow();
    expect(PACKAGE_CHANNEL_RELEASE_KEY_ID).toMatch(/^[0-9a-f]{64}$/u);
    expect(PACKAGE_CHANNEL_SOURCE_TABLE).toEqual({
      arm64: { prefix: "/opt/homebrew", opt: "/opt/homebrew/opt/developer-os", fallback: "libexec/fallback" },
      x64: { prefix: "/usr/local", opt: "/usr/local/opt/developer-os", fallback: "libexec/fallback" },
    });
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx tsc -b && npx vitest run packages/core/src/update/release.test.ts -t "package-channel trust value"`. Expected: FAIL at compile time, because `isPackageChannelTrust` and the other new symbols are not exported. Once they are stubbed, the validator throws on `trust: "package-channel"`.

- [ ] **Step 3: Implement.** In `release.ts`:

```ts
export type PackageChannelReleaseTrustStateV1 = SignedReleaseTrustStateV1 & { readonly trust: "package-channel" };
export type ReleaseTrustStateV1 = SignedReleaseTrustStateV1 | UnsignedLocalReleaseTrustStateV1 | PackageChannelReleaseTrustStateV1;
export const PACKAGE_CHANNEL_RELEASE_KEY_ID = createHash("sha256").update("developer-os:package-channel-release-key:v1", "ascii").digest("hex") as LowerHexSha256;
export function isUnsignedLocalTrust(state: ReleaseTrustStateV1): state is UnsignedLocalReleaseTrustStateV1 { return "trust" in state && state.trust === "unsigned-local"; }
export function isPackageChannelTrust(state: ReleaseTrustStateV1): state is PackageChannelReleaseTrustStateV1 { return "trust" in state && state.trust === "package-channel"; }
```

  - In `validateReleaseTrustState`, accept `input.trust` in `["unsigned-local", "package-channel"]` and spread it back.
  - In `advanceReleaseTrust`, end with `return isPackageChannelTrust(trust) ? { ...advanced, trust: "package-channel" } : advanced;`.
  - Add the layout, the table and the stand-in. `validatePackageChannelDelegation` uses `exact(value, ["schemaVersion", "trust"], "PackageChannelDelegationV1")` and requires `1` / `"package-channel"`.
  - Export everything from `index.ts`.
  - Grep `isUnsignedLocalTrust(` across `apps/` and `packages/` (`planning.ts`, `selection.ts`, `release.ts`). No caller changes, because the old meaning (`"unsigned-local"` only) is kept.

- [ ] **Step 4: Run the tests and confirm they pass.** Run the same command. Expected: PASS. Then run `npx vitest run packages/core/src/update/release.test.ts` (whole file) and confirm PASS.

- [ ] **Step 5: Lint.** Run `npm run lint`. Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/update/release.ts packages/core/src/update/index.ts packages/core/src/update/release.test.ts
git commit -m "feat(core): package-channel trust value, keg layout and fixed source table (Task 11b K4)"
```

---

### Task 2: Write and admit a package-channel keg (M)

**Files:**
- Modify: `apps/cli/src/update/local-release.ts` (add `writePackageChannelRelease`)
- Modify: `apps/cli/src/update/packaged-release.ts` (mode policy in `assertRoot`/`assertDirectory`/`assertFile` at ~133–175; add `admitPackageChannelRelease`, `resolvePackageChannelSource`; `PackagedReleaseTrustV1` gains `"package-channel"`; `PackagedReleaseError.code` gains `EXIT_CODES.recoveryRequired`)
- Test: `apps/cli/src/update/packaged-release.test.ts`

**Interfaces:**
- Consumes: Task 1 (`PACKAGE_CHANNEL_LAYOUT`, `PACKAGE_CHANNEL_DELEGATION_BYTES`, `validatePackageChannelDelegation`, `PACKAGE_CHANNEL_RELEASE_KEY_ID`, `PACKAGE_CHANNEL_SOURCE_TABLE`, `validateReleaseIndex`, `validateBundleManifest`, `releaseIdentityHash`) and **Q1** (recommended rule).
- Produces:
  - `writePackageChannelRelease(input: { readonly outDir: string; readonly index: CanonicalJsonValue; readonly manifest: ReleaseBundleManifestV1; readonly bundleFiles: readonly ReleaseFileV1[] }): Promise<string>`. It writes the three metadata documents, `bundle/<path>` and `templates/**` (`releaseTemplateFiles()`). Directories get `0755`. A file gets `0755` when its manifest mode is `0700` and `0644` otherwise. Bundle files must equal `manifest.entries` exactly.
  - `admitPackageChannelRelease(packageRoot: string, options: { readonly prefix: string; readonly requireVersion: string | null }): Promise<PackagedReleaseSourceV1>`, sealed with `trust: "package-channel"`.
  - `resolvePackageChannelSource(architecture: "arm64" | "x64", table?: typeof PACKAGE_CHANNEL_SOURCE_TABLE): Promise<{ readonly kegRoot: CanonicalAbsolutePathV1; readonly packageRoot: CanonicalAbsolutePathV1 }>`.
  - `AdmittedPackagedReleaseFileV1.mode` stays `0o600 | 0o700`. For a package-channel source it is the class-mapped mode (`0o755→0o700`, `0o644→0o600`). The sealed snapshot keeps the observed disk mode, and the reread checks that.

Rules for `admitPackageChannelRelease`:

1. The package root is canonical.
2. Every directory from `packageRoot` up to and including `options.prefix` passes the Q1 rule: owned by the uid or by root, no other-write, group write only when the uid owns the directory. Inside the package, directories are exactly `0755`, and files are `0644` or `0755` with `nlink === 1`.
3. The delegation passes `validatePackageChannelDelegation`. The index passes `validateReleaseIndex` with exactly one row. The manifest passes `validateBundleManifest`, its `version`, `releaseSequence` and `architecture` equal the row and `process.arch`, and the row's manifest reference for `process.arch` has `manifestSha256` and `manifestBytes` equal to the manifest file.
4. The `bundle/` inventory equals `manifest.entries`: each path, kind, size and SHA-256 matches, and `(diskMode & 0o100) !== 0` exactly when `entry.mode === 448`.
5. The identity is `{ version, releaseSequence: row.releaseSequence, releaseIdentityHash: releaseIdentityHash(row, arch), delegationSequence: "0", delegationHash, delegatedReleaseKeyId: PACKAGE_CHANNEL_RELEASE_KEY_ID, releaseIndexSequence: index.sequence, releaseIndexHash, bundleManifestHash, platform: "darwin", architecture, launcherProtocol: manifest.launcherProtocol, updateProtocol: manifest.updateProtocol }`.
6. `requireVersion !== null && version !== requireVersion` refuses `release_mismatch`, exit 4. This is the F1 split: `init` passes `PRODUCT_VERSION`, `update` passes `null`.
7. Every other failure is a `PackagedReleaseError` with `EXIT_CODES.recoveryRequired`.

`resolvePackageChannelSource`:

- If `lstat(table[arch].opt)` is absent, refuse `update_package_source_absent` with exit 4.
- Read the link once with `readlink`. The resolved path must be exactly `<prefix>/Cellar/developer-os/<stable-semver>`. Check it with `realpath` equality. Anything else refuses with exit 6.
- `packageRoot = <kegRoot>/libexec/fallback`. If it is absent, refuse `update_package_source_absent` with exit 4.

- [ ] **Step 1: Write the failing tests** (new `describe` in `packaged-release.test.ts`; `kegFixture` writes a keg under a temporary prefix with `writePackageChannelRelease`):

```ts
import { EXIT_CODES, PACKAGE_CHANNEL_RELEASE_KEY_ID, releaseIdentityHash } from "@developer-os/core";
import { admitPackageChannelRelease, inspectPackagedRelease, resolvePackageChannelSource } from "./packaged-release.js";
import { writePackageChannelRelease } from "./local-release.js";

async function kegFixture(version = "1.2.0", sequence = "3") {
  const prefix = await nodeFs.realpath(await nodeFs.mkdtemp(join(tmpdir(), "developer-os-keg-")));
  roots.push(prefix);
  await nodeFs.chmod(prefix, 0o755);
  const keg = join(prefix, "Cellar", "developer-os", version);
  await nodeFs.mkdir(join(keg, "libexec"), { recursive: true, mode: 0o755 });
  await nodeFs.mkdir(join(prefix, "opt"), { mode: 0o755 });
  await nodeFs.symlink(`../Cellar/developer-os/${version}`, join(prefix, "opt", "developer-os"));
  const { index, manifest, files } = syntheticKegRelease(version, sequence, process.arch as "arm64" | "x64"); // helper in this file, built from the same entries as testing.ts' syntheticRelease
  const packageRoot = await writePackageChannelRelease({ outDir: join(keg, "libexec", "fallback"), index, manifest, bundleFiles: files });
  return { prefix, keg, packageRoot, index, manifest };
}
const table = (prefix: string) => ({ arm64: { prefix, opt: `${prefix}/opt/developer-os`, fallback: "libexec/fallback" }, x64: { prefix, opt: `${prefix}/opt/developer-os`, fallback: "libexec/fallback" } }) as never;

describe("admitPackageChannelRelease (D84 K2)", () => {
  it("(a) admits Homebrew modes, derives the identity from the index row, and maps modes to their class", async () => {
    const { prefix, packageRoot, index } = await kegFixture();
    const admitted = await inspectPackagedRelease(await admitPackageChannelRelease(packageRoot, { prefix, requireVersion: null }));
    expect(admitted.trust).toBe("package-channel");
    expect(admitted.identity).toMatchObject({ version: "1.2.0", releaseSequence: "3", delegationSequence: "0", delegatedReleaseKeyId: PACKAGE_CHANNEL_RELEASE_KEY_ID, releaseIdentityHash: releaseIdentityHash((index as { releases: unknown[] }).releases[0], process.arch as "arm64") });
    expect(new Set(admitted.files.map((file) => file.mode))).toEqual(new Set([0o600, 0o700]));
  });
  it("(b) refuses a 0666 bundle file as exit 6", async () => {
    const { prefix, packageRoot } = await kegFixture();
    await nodeFs.chmod(join(packageRoot, "bundle/bin/verifier"), 0o666);
    await expect(admitPackageChannelRelease(packageRoot, { prefix, requireVersion: null })).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });
  });
  it("(c) refuses an executable bit that disagrees with the manifest mode", async () => {
    const { prefix, packageRoot } = await kegFixture();
    await nodeFs.chmod(join(packageRoot, "bundle/bin/runtime"), 0o644);
    await expect(admitPackageChannelRelease(packageRoot, { prefix, requireVersion: null })).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });
  });
  it("(d) refuses an other-writable ancestor below the prefix and admits a group-writable one the user owns (Q1)", async () => {
    const { prefix, packageRoot } = await kegFixture();
    await nodeFs.chmod(join(prefix, "Cellar"), 0o775);
    await expect(admitPackageChannelRelease(packageRoot, { prefix, requireVersion: null })).resolves.toBeDefined();
    await nodeFs.chmod(join(prefix, "Cellar"), 0o777);
    await expect(admitPackageChannelRelease(packageRoot, { prefix, requireVersion: null })).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });
  });
  it("(e) splits the version check: init requires PRODUCT_VERSION, update does not", async () => {
    const { prefix, packageRoot } = await kegFixture();
    await expect(admitPackageChannelRelease(packageRoot, { prefix, requireVersion: "9.9.9" })).rejects.toMatchObject({ code: EXIT_CODES.capabilityUnavailable, message: "release_mismatch" });
  });
  it("(f) resolves the opt link once to its canonical keg, and an absent path is exit 4", async () => {
    const { prefix, keg } = await kegFixture();
    await expect(resolvePackageChannelSource(process.arch as "arm64", table(prefix))).resolves.toEqual({ kegRoot: keg, packageRoot: join(keg, "libexec/fallback") });
    await nodeFs.rm(join(prefix, "opt", "developer-os"));
    await expect(resolvePackageChannelSource(process.arch as "arm64", table(prefix))).rejects.toMatchObject({ code: EXIT_CODES.capabilityUnavailable, message: "update_package_source_absent" });
  });
  it("(g) refuses an opt link that leaves <prefix>/Cellar/developer-os", async () => {
    const { prefix } = await kegFixture();
    await nodeFs.rm(join(prefix, "opt", "developer-os"));
    await nodeFs.symlink("/tmp", join(prefix, "opt", "developer-os"));
    await expect(resolvePackageChannelSource(process.arch as "arm64", table(prefix))).rejects.toMatchObject({ code: EXIT_CODES.recoveryRequired });
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx tsc -b && npx vitest run apps/cli/src/update/packaged-release.test.ts -t "admitPackageChannelRelease"`. Expected: FAIL at compile time, because `admitPackageChannelRelease`, `resolvePackageChannelSource` and `writePackageChannelRelease` are not exported.

- [ ] **Step 3: Implement.**
  - Give `inventory()` a `policy: "owner_only" | "homebrew"` parameter. `assertRoot`, `assertDirectory` and `assertFile` take it, and `"owner_only"` is exactly today's rule.
  - Add `assertAncestors(packageRoot, prefix)`, which walks `dirname` up to `prefix` with `lstat` and applies the Q1 rule.
  - Store `diskMode` beside each sealed file row. `readGuardedFile` and `assertSealedFileChain` compare `diskMode`.
  - Build the identity as listed above.
  - Seal through the existing `seal()` with `"package-channel"`.
  - `resolvePackageChannelSource` uses `nodeFs.lstat`, `nodeFs.readlink`, `nodeFs.realpath` and `parseStableSemver`.

- [ ] **Step 4: Run the tests and confirm they pass.** Run the same command. Expected: PASS. Then run `npx vitest run apps/cli/src/update/packaged-release.test.ts` (whole file) and confirm PASS. The unsigned-local and root-verified cases are unchanged.

- [ ] **Step 5: Lint.** Run `npm run lint`. Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/update/local-release.ts apps/cli/src/update/packaged-release.ts apps/cli/src/update/packaged-release.test.ts
git commit -m "feat(update): write and admit a package-channel keg from the fixed table (Task 11b K2)"
```

---

### Task 3: `init` from the keg records `package-channel` (M)

**Files:**
- Modify: `apps/cli/src/main.ts:244,746` (the context request gains `packageChannelInit: boolean`: true when `invocation.command === "init"` and `--local-release` is absent)
- Modify: `apps/cli/src/bin.ts:156-170` (when `request.packageChannelInit`, call `resolvePackageChannelSource(process.arch)` and then `admitPackageChannelRelease(packageRoot, { prefix: table.prefix, requireVersion: PRODUCT_VERSION })`. On `update_package_source_absent`, pass `localRelease: null`, so `init` reports `unavailable_until_packaged_handoff` as it does today)
- Modify: `apps/cli/src/bootstrap/executor.ts:2324` (write `trust: packaged.trust` for `"unsigned-local"` and `"package-channel"`)
- Modify: `apps/cli/src/commands/testing.ts:489-555` (`createSyntheticPackagedRelease` now writes a package-channel keg under `<root>/prefix` with `writePackageChannelRelease`, and admits it with `admitPackageChannelRelease(…, { prefix, requireVersion: null })`)
- Test: `apps/cli/src/bootstrap/executor.test.ts` (one new case, filtered) and `apps/cli/src/main.test.ts` (request flag)

**Interfaces:**
- Consumes: Task 2 (`admitPackageChannelRelease`, `resolvePackageChannelSource`, `writePackageChannelRelease`).
- Produces: a fresh `init` from a keg writes `state/release-trust.json` with `trust: "package-channel"` and a real `releaseIdentityHash`. `createCommandFixture({ bootstrapAvailable: true })` installs package-channel homes from a fixture prefix at `<fixture root>/prefix`, which Task 9 relies on.

- [ ] **Step 1: Write the failing tests.**

```ts
// apps/cli/src/bootstrap/executor.test.ts
it("records package-channel trust when the packaged release is a keg (D84 K2, F6)", async () => {
  const fixture = await createCommandFixture("init-package-channel", { bootstrapAvailable: true });
  const result = await runInit(fixture.context, { dryRun: false, assumeYes: true });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  const trust = JSON.parse(await nodeFs.readFile(join(fixture.paths.stateDir, "release-trust.json"), "utf8"));
  expect(trust).toMatchObject({ trust: "package-channel", delegatedReleaseKeyId: PACKAGE_CHANNEL_RELEASE_KEY_ID, highestDelegationSequence: "0" });
}, 300_000);
```

```ts
// apps/cli/src/main.test.ts
it("asks for the package channel only for init without --local-release", async () => {
  const seen: unknown[] = [];
  const factory = (_io: unknown, request: unknown) => { seen.push(request); throw new Error("stop"); };
  await run(["init", "--dry-run"], recordingIo(), factory as never);
  await run(["init", "--dry-run", "--local-release", "/x"], recordingIo(), factory as never);
  await run(["doctor"], recordingIo(), factory as never);
  expect(seen).toEqual([
    { localRelease: null, packageChannelInit: true },
    { localRelease: "/x", packageChannelInit: false },
    { localRelease: null, packageChannelInit: false },
  ]);
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**
  - Run `npx tsc -b && npx vitest run apps/cli/src/main.test.ts -t "package channel only for init"`. Expected: FAIL, because the request has no `packageChannelInit`.
  - Run `npx vitest run apps/cli/src/bootstrap/executor.test.ts -t "records package-channel trust"`. Expected: FAIL, because the trust has no `trust` member. Today's fixture is root-verified.

- [ ] **Step 3: Implement** the four modifications listed under Files. In `bin.ts`, map the Task 2 `PackagedReleaseError` thrown for an absent table path to `null`. Every other refusal propagates, so a broken keg refuses `init` with exit 6.

- [ ] **Step 4: Run the tests and confirm they pass.** Run both filtered commands. Expected: PASS.

- [ ] **Step 5: Run neighbouring fast suites and lint.** Run `npx vitest run apps/cli/src/update/packaged-release.test.ts apps/cli/src/main.test.ts && npm run lint`. Expected: exit 0. The rest of `executor.test.ts` and every `*.v2.test.ts` is deferred to plan close (D32).

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/main.ts apps/cli/src/bin.ts apps/cli/src/bootstrap/executor.ts apps/cli/src/commands/testing.ts apps/cli/src/bootstrap/executor.test.ts apps/cli/src/main.test.ts
git commit -m "feat(init): admit the keg from the fixed table and record package-channel trust (Task 11b K2, F6)"
```

---

### Task 4: One release version, used for the CLI and the Codex plugin (S)

**Files:**
- Create: `packages/core/src/version.ts`
- Modify: `packages/core/src/planner-protocol.ts` and `packages/core/src/index.ts` (export `RELEASE_VERSION`)
- Modify: `apps/cli/src/context.ts:75` (`export const PRODUCT_VERSION = RELEASE_VERSION;`)
- Modify: `packages/adapter-codex/src/plugin.ts:75-81` (`export const PLUGIN_VERSION = RELEASE_VERSION;` imported from `@developer-os/core/planner-protocol`; update the docblock)
- Modify: `apps/cli/src/update/planning.ts:776-797` (`codexEffectOf(update, draft, target)`: `expectedCurrentStateHash` becomes the projection hash with `version: codexVersionToken(target.version)`, and `restoreStateHash` stays the current hash)
- Test: `packages/core/src/version.test.ts`, `apps/cli/src/update/planning.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `RELEASE_VERSION: string`, which is `__DEVELOPER_OS_RELEASE_VERSION__` when the packer defines it and `"0.0.0"` otherwise.
  - The global declaration `declare const __DEVELOPER_OS_RELEASE_VERSION__: string | undefined;`. Task 8's esbuild `define` replaces exactly this identifier.
  - `codexEffectOf` now takes `target: ReleaseIdentityV1` (K5 (3), F8, NEW-118 (3)).

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/core/src/version.test.ts
import { describe, expect, it } from "vitest";
import { RELEASE_VERSION } from "./version.js";
import { RELEASE_VERSION as fromProtocol } from "./planner-protocol.js";
describe("RELEASE_VERSION", () => {
  it("is 0.0.0 in an unpacked build and is one value for every consumer", () => {
    expect(RELEASE_VERSION).toBe("0.0.0");
    expect(fromProtocol).toBe(RELEASE_VERSION);
  });
});
```

```ts
// apps/cli/src/update/planning.test.ts: inside the existing Codex describe, using createUpdateFixture({ codex: { registration: "registered" } }) and its Codex-changing planner option
it("retains the target plugin version as the post-update projection (F8, NEW-118 (3))", async () => {
  const fixture = createUpdateFixture({ codex: { registration: "registered" } });
  const prepared = await prepareUpdate(fixture.update, { version: parseStableSemver("1.1.0") });
  const leaf = prepared.candidate?.inverseLeaves.find((candidate) => candidate.kind === "owner_external_effect") as { readonly plan: RetainedExternalEffectInversePlanV1 };
  expect(leaf.plan.expectedCurrentStateHash).toBe(codexRegistrationProjectionHash({ ...fixture.codexProjection, version: codexVersionToken("1.1.0") }));
  expect(leaf.plan.restoreStateHash).toBe(codexRegistrationProjectionHash(fixture.codexProjection));
});
```

If `createUpdateFixture` does not expose `codexProjection`, add it to `UpdateFixture` from the value at `apps/cli/src/update/testing.ts:542` as part of this step. Use the leaf accessor the existing Codex preview test in `planning.test.ts` uses.

- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx tsc -b && npx vitest run packages/core/src/version.test.ts apps/cli/src/update/planning.test.ts -t "RELEASE_VERSION|target plugin version"`. Expected: FAIL, because `version.ts` does not exist. Once it exists, the effect still retains the current hash as its post-update projection.

- [ ] **Step 3: Implement.**

```ts
// packages/core/src/version.ts
declare const __DEVELOPER_OS_RELEASE_VERSION__: string | undefined;
/** The release version, stamped by the release packer's esbuild `define` (Task 11b); "0.0.0" in an unpacked build. */
export const RELEASE_VERSION: string = typeof __DEVELOPER_OS_RELEASE_VERSION__ === "string" ? __DEVELOPER_OS_RELEASE_VERSION__ : "0.0.0";
```

  Remove the `ponytail:` note at `planning.ts:774-775`, because the fix lands here. Pass `target` from `materializeUpdate`.

- [ ] **Step 4: Run the tests and confirm they pass.** Run the same command. Expected: PASS. Then run `npx vitest run packages/adapter-codex` and confirm PASS. The manifest version is still `"0.0.0"` in unpacked builds.

- [ ] **Step 5: Lint.** Run `npm run lint`. Expected: exit 0. `adapter-codex/dist/update/plan.js` stays in the planner graph, which proves that `version.ts` is capability-free.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/version.ts packages/core/src/version.test.ts packages/core/src/planner-protocol.ts packages/core/src/index.ts apps/cli/src/context.ts packages/adapter-codex/src/plugin.ts apps/cli/src/update/planning.ts apps/cli/src/update/planning.test.ts apps/cli/src/update/testing.ts
git commit -m "feat(release): one stamped release version for the CLI and the Codex plugin (Task 11b K5 (3), F8)"
```

---

### Task 5: The release target planner program (M)

**Files:**
- Create: `packages/core/src/update/release-planner.ts` (pure: `planKeepAllRelease(request: UpdatePlannerRequestV1): TargetUpdateDraftV1`, moved from `apps/cli/src/update/testing.ts` `keepAllDraft` and `keptManifestRow`)
- Create: `apps/cli/src/update/release-planner-main.ts` (stdio shim: read stdin to EOF, `decodePlannerInput`, `planKeepAllRelease`, write `encodePlannerOutput(request, draft, [])` to stdout; exit 3 on any throw)
- Modify: `packages/core/src/planner-protocol.ts` (export `planKeepAllRelease`)
- Modify: `apps/cli/src/update/testing.ts:832-866` (delete `keptManifestRow` and `keepAllDraft`; the on-disk world calls `admitTargetUpdateDraft(planKeepAllRelease(request), request).draft`)
- Modify: `tests/repository/check.ts:230-242` (add `"packages/core/dist/update/release-planner.js"` to `PLANNER_ENTRYPOINTS`; update the docblock)
- Test: `packages/core/src/update/release-planner.test.ts`, `tests/repository/check.test.ts`

**Interfaces:**
- Consumes: **Q3** (keep-all).
- Produces: `planKeepAllRelease` from `@developer-os/core/planner-protocol`, and the shim source path `apps/cli/src/update/release-planner-main.ts`. Task 8 bundles that shim (dist `apps/cli/dist/update/release-planner-main.js`) as `bin/planner.mjs`.

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/core/src/update/release-planner.test.ts
import { describe, expect, it } from "vitest";
import { admitTargetUpdateDraft, decodePlannerInput, encodePlannerInput } from "./planner.js";
import { planKeepAllRelease } from "./release-planner.js";
import { plannerRequest } from "./planner.test-support.js"; // if no shared builder exists, inline the `request()` builder from planner.test.ts

describe("planKeepAllRelease (Task 11b, Q3)", () => {
  it("keeps every installed owner's partition at the target version and admits", () => {
    const request = plannerRequest();
    const draft = planKeepAllRelease(request);
    expect(draft.ownerPlans.map((plan) => plan.owner)).toEqual(request.installedOwners);
    expect(draft.ownerPlans.every((plan) => plan.proposedOperations.length === 0 && plan.externalEffects.length === 0)).toBe(true);
    expect(draft.expectedManifest.productVersion).toBe(request.targetRelease.version);
    expect(() => admitTargetUpdateDraft(draft, request)).not.toThrow();
  });
  it("round-trips through the wire the shim speaks", () => {
    const request = plannerRequest();
    expect(decodePlannerInput(encodePlannerInput(request, [])).request).toEqual(request);
  });
});
```

```ts
// tests/repository/check.test.ts
it("scans the release planner module as a planner entrypoint", async () => {
  const report = await inspectReleaseAuthoritySurfaces(REPOSITORY_ROOT);
  expect(report.plannerGraphs.map((graph) => graph.entrypoint)).toContain("packages/core/dist/update/release-planner.js");
  expect(report.plannerGraphs.find((graph) => graph.entrypoint.endsWith("release-planner.js"))?.modules.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx tsc -b && npx vitest run packages/core/src/update/release-planner.test.ts tests/repository/check.test.ts -t "planKeepAllRelease|release planner module"`. Expected: FAIL, because the module does not exist.

- [ ] **Step 3: Implement.** Move the two functions verbatim into `release-planner.ts`, importing only relative core modules. Write the shim:

```ts
// apps/cli/src/update/release-planner-main.ts
import { decodePlannerInput, encodePlannerOutput, planKeepAllRelease } from "@developer-os/core/planner-protocol";
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
try {
  const { request } = decodePlannerInput(new Uint8Array(Buffer.concat(chunks)));
  process.stdout.write(encodePlannerOutput(request, planKeepAllRelease(request), []));
} catch {
  process.exitCode = 3;
}
```

  Export `decodePlannerInput` and `encodePlannerOutput` through `planner-protocol.ts` as well.

- [ ] **Step 4: Run the tests and confirm they pass.** Run the same command. Expected: PASS. Then `npm run lint` must exit 0: the graph gate now scans `release-planner.js`, and any capability finding fails it. If the gate flags a module that `release-planner.ts` reaches, stop and report it. Do not widen `ALLOWED_BUILTINS`.

- [ ] **Step 5: Run the one slow consumer of the moved code.** Run `npx vitest run tests/e2e/release-update.test.ts -t "arm64"` (the world now calls the moved planner). Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/update/release-planner.ts packages/core/src/update/release-planner.test.ts packages/core/src/planner-protocol.ts apps/cli/src/update/release-planner-main.ts apps/cli/src/update/testing.ts tests/repository/check.ts tests/repository/check.test.ts
git commit -m "feat(update): the release's keep-all target planner and its stdio entry (Task 11b K2, Q3)"
```

---

### Task 6: The release verifier and its bounded read-only snapshot (M)

**Files:**
- Create: `packages/core/src/update/release-verifier.ts` (pure: `verifyTargetSnapshot(input: { readonly manifest: Uint8Array; readonly owners: readonly OwnerPostimageRowInputV1[]; readonly migrations: readonly { readonly ref: ImmutableUpdatePlanRefV1<"schema_migration">; readonly plan: SchemaMigrationPlanV1 }[] }): { manifestHash; ownerPostimagesHash; migrationPostimagesHash }`, built with `sha256(manifest)`, `ownerPostimagesHash` and `migrationPostimagesHash` from `participants.ts`)
- Create: `apps/cli/src/update/release-verifier-main.ts` (stdio shim: decode the framed `{schemaVersion, plan, snapshot}` with `PlannerWireDecoder`, call `verifyTargetSnapshot`, and write one JSON frame with the three digests, as `testing.ts` `verifierScript()` does today)
- Modify: `apps/cli/src/update/apply-ports.ts:633-639,826-857` (`verifierPort(context, lifecycle, snapshot)`. The dispatcher builds the snapshot from the installed manifest file, read with no-follow and bounded by `plan.inputBytes`, and from `execution.owners` and `execution.migrations` reopened through `leaf(ref)`, together with their effect leaves. Remove the NEW-118 (4) `ponytail:` comment.)
- Modify: `packages/core/src/planner-protocol.ts`, `tests/repository/check.ts` (add `"packages/core/dist/update/release-verifier.js"` to `PLANNER_ENTRYPOINTS`; D72 (c))
- Modify: `apps/cli/src/update/testing.ts:797-820` (`verifierScript()` becomes the bundled shim, so the on-disk world runs the real verifier)
- Test: `packages/core/src/update/release-verifier.test.ts`, `apps/cli/src/update/apply-ports.test.ts`

**Interfaces:**
- Consumes: Task 5 (the `PLANNER_ENTRYPOINTS` edit lands after it).
- Produces: `verifyTargetSnapshot` from `@developer-os/core/planner-protocol`, and the shim `apps/cli/src/update/release-verifier-main.ts`, which Task 8 bundles as `bin/verifier.mjs`.

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/core/src/update/release-verifier.test.ts
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { migrationPostimagesHash, ownerPostimagesHash } from "./participants.js";
import { verifyTargetSnapshot } from "./release-verifier.js";

describe("verifyTargetSnapshot (NEW-118 (4))", () => {
  it("recomputes the three digests from the snapshot, not from labels", () => {
    const manifest = new TextEncoder().encode('{"schemaVersion":2}\n');
    expect(verifyTargetSnapshot({ manifest, owners: [], migrations: [] })).toEqual({
      manifestHash: createHash("sha256").update(manifest).digest("hex"),
      ownerPostimagesHash: ownerPostimagesHash([]),
      migrationPostimagesHash: migrationPostimagesHash([]),
    });
  });
});
```

```ts
// apps/cli/src/update/apply-ports.test.ts
it("compensates when the installed manifest differs from the verified transitional manifest (NEW-118 (4))", async () => {
  const home = await installUpdatableHome("verifier-snapshot", "arm64");
  const tampered = tamperManifestBeforeVerifier(home.fixture.context); // wraps lifecycle.fs.renameOver: after the transitional manifest publication, append a byte to paths.manifestFile
  await expect(updateTo(home.update(tampered), "1.1.0")).rejects.toMatchObject({ code: EXIT_CODES.securityRefusal });
}, 900_000);
```

`tamperManifestBeforeVerifier` lives in `apps/cli/src/update/testing.ts`, beside `dieAfterMutations`. It uses the same wrapping pattern over `DURABLE_MUTATIONS`.

- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx tsc -b && npx vitest run packages/core/src/update/release-verifier.test.ts apps/cli/src/update/apply-ports.test.ts -t "verifyTargetSnapshot|differs from the verified transitional"`. Expected: FAIL, because the module does not exist. Once it exists, the update still applies, because today's verifier echoes the plan's own digests.

- [ ] **Step 3: Implement** as listed under Files.

- [ ] **Step 4: Run the tests and confirm they pass.** Run the same command. Expected: PASS.

- [ ] **Step 5: Lint and the filtered e2e case.** Run `npm run lint && npx vitest run tests/e2e/release-update.test.ts -t "arm64"`. Expected: exit 0 and PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/update/release-verifier.ts packages/core/src/update/release-verifier.test.ts apps/cli/src/update/release-verifier-main.ts apps/cli/src/update/apply-ports.ts apps/cli/src/update/apply-ports.test.ts apps/cli/src/update/testing.ts packages/core/src/planner-protocol.ts tests/repository/check.ts
git commit -m "feat(update): the release verifier recomputes digests from a bounded home snapshot (Task 11b, NEW-118 (4))"
```

---

### Task 7: Instruction rows bypass the planner (NEW-171 option (b)) (S)

**Files:**
- Modify: `apps/cli/src/update/context.ts` (`snapshot()`: exclude `kind: "instruction"` rows from `request.manifest.artifacts` and `artifactInputs`)
- Modify: `apps/cli/src/update/planning.ts` (`concreteManifest`: append the excluded instruction rows unchanged, with `productVersion` set to the target version, and keep the canonical order with `compareManifestRows`)
- Modify: `packages/core/src/update/planner.ts:~812` (every `installedToken` arm checks that the source token's row kind equals the draft row's kind)
- Test: `packages/core/src/update/planner.test.ts`, `apps/cli/src/update/planning.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the planner request never carries an `instruction` row. `admitTargetUpdateDraft` refuses a draft that relabels a token's kind.

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/core/src/update/planner.test.ts
it("refuses a draft row that relabels an installed token's kind (NEW-171)", () => {
  const base = request();
  const directoryToken = base.manifest.artifacts.find((row) => row.kind === "directory")?.token as PlannerPathTokenV1;
  const relabelled = { ...draft(), expectedManifest: { ...draft().expectedManifest, artifacts: draft().expectedManifest.artifacts.map((row) => (row.path.kind === "installed" && row.path.token === directoryToken ? { ...row, kind: "file", verification: { mode: "content", installed: { kind: "installed", token: directoryToken } } } : row)) } };
  expect(() => admitTargetUpdateDraft(relabelled, base)).toThrow();
});
```

```ts
// apps/cli/src/update/planning.test.ts
it("updates a home with an attached instruction and keeps its row identical (NEW-171)", async () => {
  const fixture = createUpdateFixture({ manifestRows: [syntheticInstructionRow()] }); // add the option and helper in testing.ts
  const prepared = await prepareUpdate(fixture.update, { version: parseStableSemver("1.1.0") });
  const row = prepared.apply?.materialized.manifest.artifacts.find((artifact) => artifact.kind === "instruction");
  expect(row).toMatchObject({ ...syntheticInstructionRow(), productVersion: "1.1.0" });
  expect(fixture.plannerRequests[0]?.manifest.artifacts.some((artifact) => (artifact as { kind: string }).kind === "instruction")).toBe(false);
});
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx tsc -b && npx vitest run packages/core/src/update/planner.test.ts apps/cli/src/update/planning.test.ts -t "NEW-171"`. Expected: FAIL. The relabel is admitted, and the instruction row reaches the planner, where `keptManifestRow` throws "no draft arm".

- [ ] **Step 3: Implement** as listed under Files.

- [ ] **Step 4: Run the tests and confirm they pass.** Run the same command. Expected: PASS.

- [ ] **Step 5: Lint.** Run `npm run lint`. Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/update/context.ts apps/cli/src/update/planning.ts packages/core/src/update/planner.ts packages/core/src/update/planner.test.ts apps/cli/src/update/planning.test.ts apps/cli/src/update/testing.ts
git commit -m "fix(update): carry instruction rows past the planner and check token kinds (NEW-171 (b))"
```

---

### Task 8: The release packer, `pack:release` (L)

**Files:**
- Create: `tests/tools/pack-release.ts`
- Create: `tests/tools/release-archive.ts` (the ustar plus zstd writer, moved from `tests/integration/update/archive-planner.test.ts:64-97`; that test then imports it)
- Modify: `tests/tools/pack-local-release.ts` (export `bundleCli`, `collectTree` and `thirdPartyPackageDirectory` for reuse; no behaviour change)
- Modify: `package.json` (`"pack:release": "tsc -b && node tests/dist/tools/pack-release.js"`)
- Modify: `tests/integration/update/archive-planner.test.ts` (import from `../../tools/release-archive.js`)
- Test: `tests/tools/pack-release.test.ts`

**Interfaces:**
- Consumes: Task 2 (`writePackageChannelRelease`), Task 4 (`__DEVELOPER_OS_RELEASE_VERSION__`), Tasks 5 and 6 (the shims), and **Q2**.
- Produces: `pack(options: { readonly outDir: string; readonly version: string; readonly releaseSequence: string; readonly indexSequence: string; readonly node: { readonly arm64: string; readonly x64: string } }): Promise<{ readonly arm64: string; readonly x64: string }>`, which returns the keg tree roots. The CLI is `npm run pack:release -- --out <dir> --version <x.y.z> --release-sequence <n> --index-sequence <n> --node-arm64 <path> --node-x64 <path>`.

The output tree per architecture `<arch>` and table entry `<t>` (Q2):

```
<out>/darwin-<arch>/bin/developer-os          0755  #!/bin/sh\nexec "<t.opt>/libexec/fallback/bundle/bin/node" "<t.opt>/libexec/launcher.mjs" "$@"\n
<out>/darwin-<arch>/libexec/launcher.mjs      0644  esbuild bundle of apps/launcher/dist/main.js
<out>/darwin-<arch>/libexec/fallback/…        written by writePackageChannelRelease
<out>/archives/<version>/darwin-<arch>.tar.zst
<out>/archives/<version>/darwin-<arch>.manifest.json
```

Bundle entries, with manifest modes:

| Path | Mode | Content |
|---|---|---|
| `bin/node` | 448 | the Node binary for that architecture |
| `bin/planner.mjs` | 448 | |
| `bin/verifier.mjs` | 448 | |
| `node_modules/@developer-os/cli/dist/bin.js` | 448 | `entrypoint` |
| `THIRD-PARTY-LICENSES` | 384 | |
| `workflows/**` | 384 | |
| `instructions/**` | 384 | |

Every parent directory is an entry with mode 448. `runtimeEntrypoint` is `bin/node`, `plannerEntrypoint` is `bin/planner.mjs` and `verifierEntrypoint` is `bin/verifier.mjs`. `launcherProtocol` and `updateProtocol` are both 1.

Every esbuild call passes `define: { __DEVELOPER_OS_RELEASE_VERSION__: JSON.stringify(version) }`. The packer refuses:

- a Node binary whose `process.versions.node` major is not 24 (run it with `--version`);
- a Node binary whose Mach-O CPU type does not match its architecture (bytes 4–7: `0x0100000c` arm64, `0x01000007` x64);
- `--version` that is not stable semver;
- `releaseSequence` or `indexSequence` that is not a positive UInt64 decimal;
- an existing `--out`.

The index is `{ sequence: indexSequence, latestVersion: version, releases: [{ version, releaseSequence, minimumLauncherProtocol: 1, updateProtocol: 1, bundles: [arm64Ref, x64Ref] }] }`. Each reference carries the real archive's path, bytes and SHA-256, and its manifest's path, bytes and SHA-256.

- [ ] **Step 1: Write the failing test.** Use the host Node binary for both slots of a single-architecture smoke run; the Mach-O check is tested separately.

```ts
// tests/tools/pack-release.test.ts
import { execPath } from "node:process";
import { describe, expect, it } from "vitest";
import { admitPackageChannelRelease, inspectPackagedRelease } from "@developer-os/cli/dist/update/packaged-release.js";
import { assertNodeBinary, pack } from "./pack-release.js";

describe("pack:release (Task 11b K2)", () => {
  it("produces an admissible keg per architecture with stamped sequences and Homebrew modes", async () => {
    const out = await freshOutDir();
    const kegs = await pack({ outDir: out, version: "0.1.0", releaseSequence: "7", indexSequence: "9", node: { arm64: execPath, x64: execPath }, skipCpuCheck: true });
    const arch = process.arch as "arm64" | "x64";
    const fallback = `${kegs[arch]}/libexec/fallback`;
    const admitted = await inspectPackagedRelease(await admitPackageChannelRelease(fallback, { prefix: out, requireVersion: null }));
    expect(admitted.identity).toMatchObject({ version: "0.1.0", releaseSequence: "7", releaseIndexSequence: "9" });
    expect((await stat(`${fallback}/bundle/bin/node`)).mode & 0o777).toBe(0o755);
    expect(await readFile(`${kegs[arch]}/bin/developer-os`, "utf8")).toContain("/opt/developer-os/libexec/launcher.mjs");
  }, 600_000);
  it("refuses a Node binary of the wrong architecture", async () => {
    await expect(assertNodeBinary(execPath, process.arch === "arm64" ? "x64" : "arm64")).rejects.toThrow(/architecture/u);
  });
});
```

`skipCpuCheck` is a test-only option. The CLI path never sets it. `freshOutDir` creates a realpathed `mkdtemp` directory with mode `0755`.

- [ ] **Step 2: Run the test and confirm it fails.** Run `npx tsc -b && npx vitest run tests/tools/pack-release.test.ts`. Expected: FAIL, because `./pack-release.js` does not exist.

- [ ] **Step 3: Implement** `pack-release.ts` as specified. Reuse `bundleCli`'s esbuild options for the CLI, the launcher and both shims. Use `collectTree` for `workflows/` and `instructions/` (committed bytes only). Use `writePackageChannelRelease` for each fallback, and `release-archive.ts` for the archives. Set `COPYFILE_DISABLE=1` for any `tar` the packer runs. The packer itself runs no `tar`, because the archive writer is in-process.

- [ ] **Step 4: Run the tests and confirm they pass.** Run the same command, plus `npx vitest run tests/integration/update/archive-planner.test.ts -t "signed bundle archive"`. Expected: PASS.

- [ ] **Step 5: Lint.** Run `npm run lint`. Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add tests/tools/pack-release.ts tests/tools/pack-release.test.ts tests/tools/release-archive.ts tests/tools/pack-local-release.ts tests/integration/update/archive-planner.test.ts package.json
git commit -m "feat(release): pack:release builds per-architecture kegs in the real unsigned format (Task 11b K2, Q2)"
```

---

### Task 9: `update` plans from the keg (L)

**Files:**
- Modify: `apps/cli/src/update/context.ts`. `CliUpdateContext` gains `readonly readPackageSource: () => Promise<AdmittedPackagedReleaseV1>`, which is production `resolvePackageChannelSource(process.arch)` followed by `admitPackageChannelRelease(…, { requireVersion: null })` and `inspectPackagedRelease`. `createCliUpdateContext` binds `apply: productionUpdateApplyPorts(context, () => fallbackOf(source))`, where `fallbackOf` returns the admitted keg manifest's `{ bundleManifestHash, launcherProtocol, updateProtocol }` (K3: `update_fallback_unavailable` stops). `readOfflineTrust`, `createTransport` and `scratch` stay declared until Task 13, and planning no longer calls them.
- Modify: `apps/cli/src/update/planning.ts:597-711`. `planUpdateAttempt`:
  1. reads home;
  2. keeps the NEW-147 refusal for unsigned-local;
  3. refuses any trust state that is not package-channel with `update_trust_channel` (exit 6);
  4. calls `readPackageSource()`;
  5. decodes its three retained documents with `validatePackageChannelDelegation`, `validateReleaseIndex` and `validateBundleManifest`;
  6. runs `selectRelease`, the same `admitReleaseAgainstTrust` and `advanceReleaseTrust` checks, `update_launcher_too_old` against `bundleManifest.launcherProtocol`, and `admitReleaseIdentity`;
  7. sets `verified = { id, planHash, manifestHash, root: <packageRoot>/bundle, entries }` with no scratch.

  The planner budget is `PLANNER_WIRE_BOUNDS_V1.wallMilliseconds`. `UpdateTargetInputsV1.transport` becomes `packageSource: { kegPath, bundleManifestHash }`. The capacity components are `verified_scratch` 0/0 and `durable_bundle_source` with the bundle's bytes and entries.
- Modify: `packages/core/src/update/preview.ts:117-131,383-399` and `packages/core/src/update/planner.ts:1127,1201`. `download` becomes `packageSource: { readonly kegPath: CanonicalAbsolutePathV1; readonly bundleManifestHash: LowerHexSha256 }` (K4 F7).
- Modify: `apps/cli/src/update/bundle-source.ts:295`. `copyVerified` compares the permission class: `((observed.mode & 0o100) !== 0) !== (entry.mode === 448)` refuses, and so does any group or other write bit on the source.
- Modify: `apps/cli/src/update/compose.ts:1832-1866`. The comments and names change from scratch to package source. Behaviour is unchanged, because `sourceMode: entry.mode` must equal the row (`packages/core/src/update/construction.ts:663`).
- Modify: `apps/cli/src/update/testing.ts`.
  - `createUpdateFixture` serves `readPackageSource` from its synthetic release, with unsigned documents and no Ed25519.
  - `createOnDiskReleaseWorld` writes real kegs for `ON_DISK_RELEASES` under a fixture prefix with `writePackageChannelRelease` and admits them with the production admission against a fixture table. This is the "fixture prefix behind the fixed-path seam" of K6.
  - `world.ports` becomes `Pick<CliUpdateContext, "readPackageSource" | "planner">`.
  - `onDiskUpdateContext` binds the fallback from the keg.
  - `installUpdatableHome` installs from the same prefix's first keg.
- Modify: every test that asserted transport or FD 3 events of the planning path: `apps/cli/src/update/planning.test.ts`, `apps/cli/src/commands/update/index.test.ts`, `apps/cli/src/update/compose.test.ts`, `apps/cli/src/update/apply.test.ts`, `apps/cli/src/main.test.ts`, `tests/integration/update/archive-planner.test.ts` (the planner-binding describes), `tests/e2e/release-update.test.ts` (header comment and the "no transport request" assertion becomes "no `readPackageSource` call" for rollback). `tests/integration/update/signature-transport.test.ts (already removed by Task 9 under the K6 ruling, `8f89af0a`)` was removed by Task 9 under the K6 ruling (`8f89af0a`); it asserted the withdrawn network update path until Task 13 deletes it with its feature. It is never skipped. To keep it compiling and passing against Security's transport directly, this task keeps `readOfflineTrust`, `createTransport` and `scratch` on `UpdateFixture`.
- Test: `apps/cli/src/update/planning.test.ts`, `packages/core/src/update/preview.test.ts`, `apps/cli/src/update/bundle-source.test.ts`, `tests/e2e/release-update.test.ts`

**Interfaces:**
- Consumes: Task 2 (admission), Task 3 (package-channel fixture homes), Task 7 (snapshot shape).
- Produces: `CliUpdateContext.readPackageSource`, `UpdatePackageSourcePreviewV1 { kegPath; bundleManifestHash }`, and a fixture world whose ports are `readPackageSource` and `planner`.

- [ ] **Step 1: Write the failing tests.**

```ts
// apps/cli/src/update/planning.test.ts
describe("planning from the package channel (D84 K2, K4 F7)", () => {
  it("(a) previews the keg as packageSource and never touches FD 3, a transport or scratch", async () => {
    const fixture = createUpdateFixture();
    const result = await planUpdate({ ...fixture.update, readOfflineTrust: never, createTransport: never, scratch: neverScratch }, { version: null });
    expect(result.result).toMatchObject({ outcome: "preview", plan: { packageSource: { kegPath: fixture.kegPath, bundleManifestHash: fixture.releases.get("1.1.0")?.manifestHash } } });
    expect(result.result.outcome === "preview" && "download" in result.result.plan).toBe(false);
  });
  it("(b) refuses a keg below the trust watermark as a downgrade", async () => {
    const fixture = createUpdateFixture({ kegVersion: "0.9.0", kegSequence: "1" });
    await expect(planUpdate(fixture.update, { version: null })).rejects.toMatchObject({ reason: "update_downgrade_refused", code: EXIT_CODES.invalidInput });
  });
  it("(e) refuses the active version rebuilt with other bytes as a rebound, never up_to_date", async () => {
    const fixture = createUpdateFixture({ kegVersion: "1.0.0", kegSequence: "1", rebuilt: true });
    await expect(planUpdate(fixture.update, { version: null })).rejects.toMatchObject({ reason: "update_release_identity_rebound", code: EXIT_CODES.securityRefusal });
  });
  it("(f) refuses an absent keg as exit 4 before any write", async () => {
    const fixture = createUpdateFixture({ kegAbsent: true });
    await expect(planUpdate(fixture.update, { version: null })).rejects.toMatchObject({ code: EXIT_CODES.capabilityUnavailable, message: "update_package_source_absent" });
  });
});
```

```ts
// apps/cli/src/update/bundle-source.test.ts
it("(c) copies a 0644/0755 source into 0600/0700 targets and refuses a class mismatch", async () => {
  const io = guardedIoFixture();
  const file = await sourceFile(io.root, "bin/node", "x", 0o755);
  await expect(io.copyInto(file, { path: "bin/node", kind: "file", mode: 448, bytes: "1", sha256: sha("x") })).resolves.toMatchObject({ mode: 0o700 });
  const wrong = await sourceFile(io.root, "bin/other", "x", 0o644);
  await expect(io.copyInto(wrong, { path: "bin/other", kind: "file", mode: 448, bytes: "1", sha256: sha("x") })).rejects.toThrow(/bundle_source_changed/u);
});
```

```ts
// tests/e2e/release-update.test.ts
it("(d) rolls back after the keg is removed (brew cleanup)", async () => {
  const lifecycle = await start("arm64");
  await run(lifecycle, { kind: "update", version: parseStableSemver("1.1.0"), apply: true, json: false });
  await nodeFs.rm(lifecycle.home.world.prefix, { recursive: true, force: true });
  await run(lifecycle, { kind: "rollback", apply: true, json: false });
  expect(await activeVersion(lifecycle)).toBe("1.0.0");
}, LIFECYCLE_TIMEOUT_MS);
```

`guardedIoFixture`, `sourceFile` and `copyInto` are small helpers added to `bundle-source.test.ts` over `BundleGuardedIo`. `createUpdateFixture` gains the options `kegVersion`, `kegSequence`, `rebuilt` and `kegAbsent`, and the fields `kegPath` and `prefix` (on the world).

- [ ] **Step 2: Run the tests and confirm they fail.**
  - Run `npx tsc -b && npx vitest run apps/cli/src/update/planning.test.ts apps/cli/src/update/bundle-source.test.ts packages/core/src/update/preview.test.ts -t "package channel|0644/0755|packageSource"`. Expected: FAIL. Planning calls `readOfflineTrust`, and `copyVerified` refuses `0755` against 448.
  - Run `npx vitest run tests/e2e/release-update.test.ts -t "brew cleanup"`. Expected: FAIL, because the world has no `prefix`.

- [ ] **Step 3: Implement** as listed under Files.

- [ ] **Step 4: Run the tests and confirm they pass.** Run both commands. Expected: PASS. Also run `npx vitest run tests/e2e/release-update.test.ts -t "arm64"` (the §12 lifecycle on the fixture prefix, K6). Expected: PASS. The rest of `tests/e2e`, `tests/security`, `tests/integration` and `*.v2.test.ts` is deferred to plan close (D32).

- [ ] **Step 5: Lint and the fast neighbours.** Run `npm run lint && npx vitest run apps/cli/src/update packages/core/src/update`. Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/update/context.ts apps/cli/src/update/planning.ts apps/cli/src/update/bundle-source.ts apps/cli/src/update/compose.ts apps/cli/src/update/testing.ts packages/core/src/update/preview.ts packages/core/src/update/planner.ts apps/cli/src/update/planning.test.ts apps/cli/src/update/bundle-source.test.ts packages/core/src/update/preview.test.ts apps/cli/src/commands/update/index.test.ts apps/cli/src/update/compose.test.ts apps/cli/src/update/apply.test.ts apps/cli/src/main.test.ts tests/integration/update/archive-planner.test.ts tests/e2e/release-update.test.ts
git commit -m "feat(update): plan and apply from the admitted keg; preview packageSource; fallback from the keg (Task 11b K2-K4)"
```

---

### Task 10: Journal the release directory and the empty reservation (NEW-118 (1), (2)) (M)

**Files:**
- Modify: `packages/core/src/update/bundle-participant.ts` (the bundle publication journal gains `versionDirectory: { readonly created: boolean; readonly dev: UInt64DecimalV1; readonly ino: UInt64DecimalV1 } | null`, written by a `version_directory_intent` / `version_directory_created` step pair before the first entry)
- Modify: `apps/cli/src/update/bundle-publication.ts:208-221` (`#versionDirectory` journals the intent, then `mkdirExclusive`, then the identity. Compensation removes the directory only when `created` and the directory is empty under that identity. A reused directory is recorded with `created: false`.)
- Modify: `packages/core/src/update/participants.ts` (the canonical state journal for the empty-reservation role records `reservationReleased: { dev; ino } | null` before the unlink. Compensation recreates the empty `0600` reservation by `writeExclusive`.)
- Modify: `apps/cli/src/update/apply-ports.ts:733-745` (`releaseEmptyReservation` goes through the journal; remove both `ponytail:` comments)
- Test: `apps/cli/src/update/bundle-publication.test.ts`, `apps/cli/src/update/apply-ports.test.ts`, `tests/integration/update/recovery.test.ts` (one filtered case)

**Interfaces:**
- Consumes: Task 9 (stable fixture world and `apply-ports.ts`).
- Produces: a compensated update leaves no `releases/<version>` that it created, and leaves the empty `state/update-rollback.json` reservation in place.

- [ ] **Step 1: Write the failing tests.**

```ts
// apps/cli/src/update/apply-ports.test.ts
it("a compensated update removes the release directory it created and restores the empty reservation (NEW-118 (1), (2))", async () => {
  const home = await installUpdatableHome("compensated-structures", "arm64", { rejectingVersions: ["1.1.0"] });
  await expect(updateTo(home.update(), "1.1.0")).rejects.toMatchObject({ code: EXIT_CODES.securityRefusal });
  expect(await exists(join(home.fixture.paths.home, "releases", "1.1.0"))).toBe(false);
  const reservation = await nodeFs.lstat(join(home.fixture.paths.stateDir, "update-rollback.json"));
  expect([reservation.size, reservation.mode & 0o777]).toEqual([0, 0o600]);
}, 900_000);
```

```ts
// tests/integration/update/recovery.test.ts
it("recovers the release-directory intent after death between intent and mkdir", async () => { /* dieAfterMutations at the journal write that precedes mkdirExclusive; a fresh process's recovery compensates to a home byte-identical to before (inventoryDigest) */ });
```

  Write the recovery case with the file's existing `dieAfterMutations` sweep helper. Choose `count` by first running the uninterrupted update with an unreachable `count` and reading `landed()` at the intent, as the file's other single-point cases do.

- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx tsc -b && npx vitest run apps/cli/src/update/apply-ports.test.ts -t "NEW-118 \\(1\\), \\(2\\)"` and `npx vitest run tests/integration/update/recovery.test.ts -t "release-directory intent"`. Expected: FAIL, because `releases/1.1.0` remains and the reservation is absent.

- [ ] **Step 3: Implement** as listed under Files.

- [ ] **Step 4: Run the tests and confirm they pass.** Run the same commands. Expected: PASS.

- [ ] **Step 5: Lint.** Run `npm run lint`. Expected: exit 0. The full `test:update-recovery` sweeps are deferred to plan close (D32).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/update/bundle-participant.ts apps/cli/src/update/bundle-publication.ts packages/core/src/update/participants.ts apps/cli/src/update/apply-ports.ts apps/cli/src/update/bundle-publication.test.ts apps/cli/src/update/apply-ports.test.ts tests/integration/update/recovery.test.ts
git commit -m "fix(update): journal the release directory and the empty reservation (NEW-118 (1), (2))"
```

---

### Task 11: A version-free entrypoint that follows the active record (NEW-163 option B) (M)

**Files:**
- Modify: `apps/cli/src/update/entrypoint.ts:30-71`. `renderEntrypoint()` takes no argument. The script:
  1. reads `../state/active-release.json` relative to `import.meta.url`;
  2. reads `../state/release-metadata/bundles/<bundleManifestHash>.json`;
  3. sets `entry = manifest.entrypoint ?? "node_modules/@developer-os/cli/dist/bin.js"` (Q4);
  4. checks that `entry` is a relative path with no `..` component;
  5. imports `pathToFileURL(join(active.bundleRoot, entry))`.

  Any failure keeps today's exit rule (2 for the three guard verbs, 1 otherwise). `desiredEntrypoint` returns `renderEntrypoint()` whenever an active record exists.
- Modify: `apps/cli/src/commands/doctor.ts` (`checkEntrypoint` compares the bytes with `renderEntrypoint()`)
- Test: `apps/cli/src/update/entrypoint.test.ts`, `tests/e2e/release-update.test.ts` (NEW-163 validation)

**Interfaces:**
- Consumes: **Q4**.
- Produces: `renderEntrypoint(): Uint8Array`, with the same bytes for every release. Neither update nor rollback rewrites it.

- [ ] **Step 1: Write the failing tests.**

```ts
// apps/cli/src/update/entrypoint.test.ts
it("renders one release-independent entrypoint (NEW-163 B)", () => {
  expect(renderEntrypoint()).toEqual(renderEntrypoint());
  expect(new TextDecoder().decode(renderEntrypoint())).toContain("active-release.json");
});
it("loads the CLI the active record's bundle manifest names, and refuses a traversing entry", async () => {
  const home = await entrypointHome({ entrypoint: "cli/main.mjs" }); // writes state/active-release.json, the retained manifest, and <bundleRoot>/cli/main.mjs printing "loaded"
  expect(await runNode(home.entrypoint, ["--version"])).toMatchObject({ code: 0, stdout: "loaded\n" });
  const traversing = await entrypointHome({ entrypoint: "../escape.mjs" });
  expect(await runNode(traversing.entrypoint, ["guard", "command"])).toMatchObject({ code: 2 });
});
```

```ts
// tests/e2e/release-update.test.ts: inside the existing lifecycle, after each apply and rollback
expect(await entrypointTarget(lifecycle)).toBe(`${(await lifecycle.home.update().readHome()).active.bundleRoot}/${ENTRY}`);
```

`entrypointTarget` evaluates the same resolution the script performs. `ENTRY` is the synthetic world's `entrypoint`.

- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx tsc -b && npx vitest run apps/cli/src/update/entrypoint.test.ts -t "NEW-163|active record"`. Expected: FAIL, because `renderEntrypoint` still takes `bundleRoot` and the bytes differ per release.

- [ ] **Step 3: Implement** as listed under Files.

- [ ] **Step 4: Run the tests and confirm they pass.** Run the same command, plus `npx vitest run tests/e2e/release-update.test.ts -t "arm64"`. Expected: PASS.

- [ ] **Step 5: Check the hook-latency budget and lint.** Run `npm run lint && npx vitest run apps/cli/src/commands/doctor.test.ts`. Expected: exit 0. `tests/tools/hook-latency.ts` is a slow measurement, deferred to plan close (D32).

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/update/entrypoint.ts apps/cli/src/commands/doctor.ts apps/cli/src/update/entrypoint.test.ts tests/e2e/release-update.test.ts
git commit -m "fix(entrypoint): load the active record's bundle entrypoint at run time (NEW-163 option B)"
```

---

### Task 12: The launcher admits package-channel releases, uses the keg fallback and drops FD 3 (L)

> **Ruling 2026-10-07 (orchestrator, plan defect found in review):** this task's original rule that
> "more than one plan returns `malformed`" contradicts Spec 2 §3.1/§6.4 and NEW-123 and would refuse every
> command on a home with several retained envelopes (the founder's home has 12). After the handoff (a
> valid active record), terminal, `unverified` and altered envelopes are inert; exactly one non-terminal
> envelope is `non_terminal`; two or more are `malformed`; before the handoff the strict rule stands. The
> launcher also applies K2's D96 Q1 ancestor rule to every in-place keg run.

**Files:**
- Modify: `packages/platform-macos/src/launcher/admission.ts:70-130`. `admit({ …, modes: "exact" | "homebrew" })`: `"homebrew"` accepts directories `0755` and files `0644`/`0755` by class, and a root owned by the uid or by root.
- Modify: `apps/launcher/src/selection.ts`.
  - `admitPackagedFallback` uses `modes: "homebrew"` and reads `metadata/bundle-manifest.json`.
  - `admitActiveRelease` handles a `package-channel` trust state. The three retained documents are read by hash as today. `validatePackageChannelDelegation` replaces `verifyRetainedDocument`, `validateReleaseIndex` decodes the plain index, and `bindReleaseIdentity` uses `PACKAGE_CHANNEL_RELEASE_KEY_ID` and delegation sequence `"0"`.
  - The bundle uses `modes: "exact"`.
  - `unsigned-local` and absent trust states keep routing to recovery.
  - Remove `LauncherRetainedDocumentVerifierV1` and `extraDescriptors`.
  - `buildLauncherProcessRequest(selection, env, argv)` drops the `trustPipe` parameter.
- Create: `apps/launcher/src/readers.ts`.
  - `readUpdateEnvelope(fs, productHome, coordinatorId)` returns `present` when both of `updateCoordinatorEnvelopePaths(home, id)` are owned regular `0600` files, `absent` when neither exists, and `malformed` otherwise.
  - `readBootstrapClosure(fs, productHome)` lists `state/` for `fresh-v2-init.<id>.plan.json`. With none, it returns `handoff_complete`. With exactly one, it reads the plan and both journal slots, then calls `admitBootstrapEvidencePlan` and `selectBootstrapEvidenceJournal` (moved from `apps/cli/src/bootstrap/report.ts:377-430` into `packages/core/src/manifest/bootstrap-closure.ts`, together with `planAdmission`; the CLI re-imports them). The phases `finalized`, `rolled_back`, `retaining` and `retained` return `handoff_complete`, any other phase returns `non_terminal`, and anything unreadable or more than one plan returns `malformed`. NEW-111 (1), (2).
- Modify: `apps/launcher/src/main.ts`. Delete the roots constants, the trust compile and both `ponytail:` stubs. The fallback is `PACKAGE_CHANNEL_SOURCE_TABLE[arch]`, `opt` is resolved once, and the result is `<keg>/libexec/fallback`. Wire both readers. `execAdmittedRelease(request)` uses stdio `["inherit", "inherit", "inherit"]` only.
- Modify: `apps/launcher/src/handoff.ts` (delete `compileLauncherOfflineReleaseTrust`, `createLauncherRetainedDocumentVerifier` and `writeOfflineReleaseTrustHandoff`, keep `execAdmittedRelease`)
- Test: `apps/launcher/src/selection.test.ts`, `apps/launcher/src/readers.test.ts`, `apps/launcher/src/handoff.test.ts`, `packages/platform-macos/src/launcher/admission.test.ts`

**Interfaces:**
- Consumes: Task 1 (trust value, layout, table, stand-in).
- Produces: a launcher that never opens FD 3 and never passes `--offline-release-trust-fd=3`. `readBootstrapClosure` and `readUpdateEnvelope` replace both stubs (NEW-111). NEW-112 closes by deletion, because no descriptor is accepted from any parent.

- [ ] **Step 1: Write the failing tests** (in `selection.test.ts`; the file's existing in-memory `fs` builders write a package-channel home with `writeHome({ trust: "package-channel" })`, and keg modes with `fallbackModes: "homebrew"`):

```ts
describe("package-channel launcher selection (D84 K3)", () => {
  it("(a) admits a package-channel active release by inventory and hash with no verifier", async () => {
    const selection = await selectLauncherCandidate(request(await writeHome({ trust: "package-channel" })));
    expect(selection.kind).toBe("active_release");
  });
  it("(b) routes a changed retained index to recovery", async () => {
    const home = await writeHome({ trust: "package-channel", tamperIndex: true });
    await expect(selectLauncherCandidate(request(home))).rejects.toMatchObject({ code: 6 });
  });
  it("(c) admits a Homebrew-mode fallback when no active record exists", async () => {
    const selection = await selectLauncherCandidate(request(await writeHome({ active: null, fallbackModes: "homebrew" })));
    expect(selection.kind).toBe("package_fallback");
  });
  it("(d) builds argv without the FD 3 flag and reserves no descriptor", () => {
    const built = buildLauncherProcessRequest(fallbackSelection(), env(), ["doctor"]);
    expect(built.argv).toEqual([fallbackSelection().bundle.entrypoint, "doctor"]);
    expect("extraDescriptors" in built).toBe(false);
  });
  it("(e) refuses a terminal-cleanup record whose fallback hash is not the current keg's", async () => {
    const home = await writeHome({ executor: { kind: "package_fallback", bundleManifestHash: "f".repeat(64) } });
    await expect(selectLauncherCandidate(request(home))).rejects.toMatchObject({ reason: "launcher_update_fallback_mismatch" });
  });
});
```

```ts
// apps/launcher/src/readers.test.ts
it("reports handoff_complete with no bootstrap plan and non_terminal for a planned journal (NEW-111)", async () => {
  expect(await readBootstrapClosure(fsOf({}), HOME)).toEqual({ kind: "handoff_complete" });
  expect(await readBootstrapClosure(fsOf(plannedBootstrap()), HOME)).toEqual({ kind: "non_terminal" });
  expect(await readBootstrapClosure(fsOf({ ...plannedBootstrap(), ...plannedBootstrap("other") }), HOME)).toEqual({ kind: "malformed" });
});
it("reports an update envelope as present, absent or malformed (NEW-111)", async () => {
  expect(await readUpdateEnvelope(fsOf(envelope(ID, "both")), HOME, ID)).toEqual({ kind: "present", coordinatorId: ID });
  expect(await readUpdateEnvelope(fsOf({}), HOME, ID)).toEqual({ kind: "absent" });
  expect(await readUpdateEnvelope(fsOf(envelope(ID, "plan_only")), HOME, ID)).toEqual({ kind: "malformed" });
});
```

`plannedBootstrap()` is built with the CLI's own `createCommandFixture` plus `bootstrapInterruptAfter`, which leaves a real non-terminal envelope. Copy the bytes into the in-memory `fsOf` map.

- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx tsc -b && npx vitest run apps/launcher packages/platform-macos/src/launcher -t "package-channel launcher|NEW-111|homebrew"`. Expected: FAIL. The package-channel trust routes to `launcher_retained_document_unverified`, `readers.ts` does not exist, and `buildLauncherProcessRequest` requires `trustPipe`.

- [ ] **Step 3: Implement** as listed under Files. Moving the closure admission into Core is pure: grep its imports and confirm none reaches `node:fs`.

- [ ] **Step 4: Run the tests and confirm they pass.** Run the same command, then `npx vitest run apps/launcher packages/platform-macos apps/cli/src/bootstrap/report.test.ts`. Expected: PASS.

- [ ] **Step 5: Lint.** Run `npm run lint`. Expected: exit 0. `launcherEntrypoints` must still list `main.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/platform-macos/src/launcher/admission.ts packages/platform-macos/src/launcher/admission.test.ts apps/launcher/src/selection.ts apps/launcher/src/selection.test.ts apps/launcher/src/readers.ts apps/launcher/src/readers.test.ts apps/launcher/src/main.ts apps/launcher/src/handoff.ts apps/launcher/src/handoff.test.ts packages/core/src/manifest/bootstrap-closure.ts packages/core/src/index.ts apps/cli/src/bootstrap/report.ts
git commit -m "feat(launcher): admit package-channel releases, keg fallback, closure and envelope readers, no FD 3 (Task 11b K3, NEW-111, NEW-112)"
```

---

### Task 13: Delete the signature, transport and FD 3 code and flip the network gates (L)

**Files:**
- Delete: `packages/security/src/update/signatures.ts`, `signatures.test.ts`, `transport.ts`, `transport.test.ts`, `handoff.ts`, `handoff.test.ts`; `tests/integration/update/signature-transport.test.ts (already removed by Task 9 under the K6 ruling, `8f89af0a`)`
- Modify: `packages/security/src/update/index.ts`, `packages/security/src/index.ts`, `packages/security/src/index.test.ts` (export lists)
- Modify: `packages/core/src/update/release.ts` and `packages/core/src/update/index.ts` (delete `Ed25519SignatureV1`, `SignedReleaseDocumentV1`, `OfficialReleaseOriginV1`, `FixedReleaseMetadataLocatorV1`, `OfflineRootKeyV1`, `OfflineReleaseTrustV1`, `DelegatedReleaseKeyV1`, `ReleaseKeyDelegationV1` and their validators; keep §4.3/§4.4 types)
- Modify: `apps/cli/src/update/context.ts` (delete `readOfflineTrust`, `createTransport`, `UpdateTransportV1`, `LAUNCHER_TRUST_ARGUMENT`, `TRUST_DESCRIPTOR`, `NODE_TRUST_READER`; also delete the `scratch` port, `scratchPort` and `planning.ts` `cleanScratchResidue`, because no production scratch attempt ever existed (`LAUNCHER_OFFLINE_RELEASE_ROOTS = []` refused every update), and delete `apps/cli/src/update/scratch-lock.ts` if `grep -rn tryLockScratchAttempt apps` then shows no caller; `archive.ts` and `scratch.ts` stay in Security per §4.4)
- Modify: `apps/cli/src/bin.ts:104-131` (delete the FD 3 marker handling; `argv = process.argv.slice(2)`), `apps/cli/src/context.ts:234,760-761,851` (delete `launcherTrustHandoff`)
- Modify: `apps/cli/src/update/packaged-release.ts` (delete `admitRootVerifiedPackagedRelease`, `"root-verified"`), `apps/cli/src/update/packaged-release.test.ts`
- Modify: `apps/cli/src/update/testing.ts` (delete `generateKey`, `signDocument`, `signedReleaseMetadata`, `syntheticReleaseServer` and the FD 3 fields of `UpdateFixture`; keep the archive bytes `archive-planner.test.ts` uses for §4.4)
- Modify: `tests/repository/check.ts:256-327`. `RELEASE_NETWORK_ENTRYPOINTS` becomes `[]` and `RELEASE_TRANSPORT_COMPOSITION` becomes `[]`. `describeReleaseAuthorityProblems` asserts that `networkEntrypoints` and `transportCompositions` are **empty** and that `launcherEntrypoints` and `plannerGraphs` are non-empty. A positive control keeps the empty-set assertion meaningful: `inspectReleaseAuthoritySurfaces` also classifies the synthetic file `tests/repository/fixtures/network-positive-control.ts` (`import "node:https";`) and the gate fails unless that control is reported.
- Modify: `tests/repository/check.test.ts`, `tests/e2e/foundation.test.ts:1180-1215` (delete `RELEASE_TRANSPORT` and its exemption), `tests/security/network.test.ts:485-580` (the rollback case names only `readPackageSource` and `planner` as unreachable; "the release transport is the only network entrypoint" becomes "no product module reaches a remote network" with the same total scan)
- Modify: `apps/cli/src/main.ts:78` (help text: "preview a release update from the installed package")
- Test: the files above

**Interfaces:**
- Consumes: Tasks 8, 9, 10, 11, 12 (the keg path is complete and its e2e case is green).
- Produces: no product module performs network I/O. No product module reads or writes FD 3. `ReleaseTrustStateV1` is unchanged (K4).

- [ ] **Step 1: Write the failing gate tests.**

```ts
// tests/repository/check.test.ts
it("finds no product network entrypoint and still flags the positive control (K1)", async () => {
  const report = await inspectReleaseAuthoritySurfaces(REPOSITORY_ROOT);
  expect(report.networkEntrypoints).toEqual([]);
  expect(report.transportCompositions).toEqual([]);
  expect(report.positiveControl).toEqual(["tests/repository/fixtures/network-positive-control.ts"]);
  expect(describeReleaseAuthorityProblems(report)).toEqual([]);
});
```

```ts
// tests/security/network.test.ts
it("finds network capability in no product module", async () => { /* the existing total scan, expecting [] */ });
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run `npx tsc -b && npx vitest run tests/repository/check.test.ts -t "no product network entrypoint"` and `npx vitest run tests/security/network.test.ts -t "in no product module"`. Expected: FAIL, because `transport.ts` is still reported.

- [ ] **Step 3: Delete and flip** as listed under Files. Then run `grep -rn "OfflineReleaseTrust\|FixedReleaseTransport\|offline-release-trust-fd\|launcherTrustHandoff\|verifySignedReleaseDocument\|admitRootVerifiedPackagedRelease" apps packages tests --include=*.ts | grep -v /dist/`. Expected: no output.

- [ ] **Step 4: Run the tests and confirm they pass.** Run both filtered commands, then `npx vitest run apps/launcher packages/security packages/core/src/update apps/cli/src/update tests/repository`. Expected: PASS.

- [ ] **Step 5: Run the gate's own slow cases and lint.** Run `npx vitest run tests/e2e/foundation.test.ts -t "network"` and `npm run lint`. Expected: PASS, then exit 0. The other slow suites are deferred to plan close (D32).

- [ ] **Step 6: Commit**

```bash
git rm packages/security/src/update/signatures.ts packages/security/src/update/signatures.test.ts packages/security/src/update/transport.ts packages/security/src/update/transport.test.ts packages/security/src/update/handoff.ts packages/security/src/update/handoff.test.ts tests/integration/update/signature-transport.test.ts (already removed by Task 9 under the K6 ruling, `8f89af0a`)
git add packages/security/src/update/index.ts packages/security/src/index.ts packages/security/src/index.test.ts packages/core/src/update/release.ts packages/core/src/update/index.ts apps/cli/src/update/context.ts apps/cli/src/bin.ts apps/cli/src/context.ts apps/cli/src/main.ts apps/cli/src/update/packaged-release.ts apps/cli/src/update/packaged-release.test.ts apps/cli/src/update/testing.ts tests/repository/check.ts tests/repository/check.test.ts tests/repository/fixtures/network-positive-control.ts tests/e2e/foundation.test.ts tests/security/network.test.ts
git commit -m "refactor(update): delete signature, transport and FD 3 code; no product module reaches a network (Task 11b K1, K3)"
```

Deleting a feature together with its tests is removal of the feature. It is not test skipping (K6).

---

### Task 14: Plan close: full suite, brew gate and the founder's reinstall (M, founder)

**Files:**
- Modify (orchestrator): `docs/superpowers/BACKLOG.md` (close NEW-111, NEW-112, NEW-118, NEW-163 and NEW-171 with commit hashes), `docs/superpowers/ORDER.md` (A11b row), `docs/architecture/` (move the surviving K1–K6 contract), `docs/migration/founder-cutover.md` (step 15 gains the keg variant below)

**Interfaces:**
- Consumes: Tasks 1–13 integrated on `integrate/2026-10-07`.

- [ ] **Step 1: Run the full suite (founder, on a quiet machine).**

```sh
cd <devos-checkout> && git switch integrate/2026-10-07 && git pull --ff-only
pnpm install --frozen-lockfile && npx tsc -b
npm run check
```

Expected: exit 0. Do not push until this passes. If it is red, stop and fix through a regression test first.

- [ ] **Step 2: Build two releases (founder machine).** The Node version is the checkout's own Node 24.

```sh
NODE_VERSION=$(node -p 'process.versions.node'); case "$NODE_VERSION" in 24.*) ;; *) echo "need Node 24"; exit 1;; esac
GATE=$HOME/dos-gate && mkdir -p "$GATE/node" && cd "$GATE/node"
curl -fsSLO "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"
for A in arm64 x64; do curl -fsSLO "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-darwin-$A.tar.gz"; done
shasum -a 256 -c --ignore-missing SHASUMS256.txt
for A in arm64 x64; do tar -xzf "node-v$NODE_VERSION-darwin-$A.tar.gz"; done
cd <devos-checkout>
npm run pack:release -- --out "$GATE/r1" --version 0.1.0 --release-sequence 1 --index-sequence 1 --node-arm64 "$GATE/node/node-v$NODE_VERSION-darwin-arm64/bin/node" --node-x64 "$GATE/node/node-v$NODE_VERSION-darwin-x64/bin/node"
npm run pack:release -- --out "$GATE/r2" --version 0.1.1 --release-sequence 2 --index-sequence 2 --node-arm64 "$GATE/node/node-v$NODE_VERSION-darwin-arm64/bin/node" --node-x64 "$GATE/node/node-v$NODE_VERSION-darwin-x64/bin/node"
for R in r1 r2; do V=$([ $R = r1 ] && echo 0.1.0 || echo 0.1.1); COPYFILE_DISABLE=1 tar -C "$GATE/$R/darwin-arm64" -czf "$GATE/developer-os-$V-darwin-arm64.tar.gz" .; done
```

- [ ] **Step 3: Create the local tap clone (founder machine).**

```sh
mkdir -p "$GATE/tap/Formula" && cd "$GATE/tap" && git init -q
write_formula() { V=$1; SHA=$(shasum -a 256 "$GATE/developer-os-$V-darwin-arm64.tar.gz" | cut -d' ' -f1)
cat > Formula/developer-os.rb <<RUBY
class DeveloperOs < Formula
  desc "Developer OS (Task 11b gate build)"
  homepage "https://github.com/msolecki/developer-os"
  url "file:///Volumes/My%20Shared%20Files/gate/developer-os-$V-darwin-arm64.tar.gz"
  sha256 "$SHA"
  version "$V"
  def install
    prefix.install Dir["*"]
  end
end
RUBY
git add Formula/developer-os.rb && git commit -qm "developer-os $V"; }
write_formula 0.1.0
```

- [ ] **Step 4: Run the disposable-account gate in a fresh macOS VM (Q5).** The `macos-sequoia-base` image ships Homebrew owned by its `admin` user. If the image you pull lacks `brew`, install it from brew.sh inside the VM first.

```sh
brew install cirruslabs/cli/tart
tart clone ghcr.io/cirruslabs/macos-sequoia-base:latest dos-gate
tart run dos-gate --dir=gate:"$GATE" &
ssh admin@$(tart ip dos-gate)        # password: admin
# inside the VM
export HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_FROM_API=1
G="/Volumes/My Shared Files/gate"
git clone "$G/tap" ~/tap && brew tap msolecki/developer-os ~/tap
brew install msolecki/developer-os/developer-os
mkdir -p ~/gate-brain
DEVELOPER_OS_BRAIN=~/gate-brain developer-os init --dry-run --adapters claude,codex
DEVELOPER_OS_BRAIN=~/gate-brain developer-os init --yes --adapters claude,codex
developer-os --version                                  # developer-os 0.1.0
grep -c '"trust":"package-channel"' ~/.developer-os/state/release-trust.json   # 1
developer-os doctor
```

- [ ] **Step 5: Bump, upgrade, update and roll back (VM, then the founder machine for the bump).**

```sh
# founder machine: bump the formula in the tap clone
cd "$GATE/tap" && write_formula 0.1.1
# VM
git -C ~/tap pull --ff-only                             # ~/tap tracks the shared $G/tap
git -C "$(brew --repository msolecki/developer-os)" pull --ff-only   # the tap tracks ~/tap
brew upgrade developer-os
developer-os update                                     # preview: packageSource names /opt/homebrew/Cellar/developer-os/0.1.1, no download block
developer-os update --apply
developer-os --version                                  # developer-os 0.1.1
developer-os doctor
brew cleanup developer-os                               # the 0.1.0 keg goes; rollback must not need it
developer-os update rollback
developer-os update rollback --apply
developer-os --version                                  # developer-os 0.1.0
developer-os doctor
developer-os update --apply                             # reapply 0.1.1 from the keg
developer-os uninstall --yes
ls ~/gate-brain                                              # the Brain is untouched
```

Expected: every command exits 0, and each `--version` prints the version noted beside it. Record each command's exit code in the founder log.

- [ ] **Step 6: Run the F4 reinstall on the founder machine (K4, F4).** Follow `docs/migration/founder-cutover.md` step 15, with its "before" captures unchanged. Then replace its pack and init lines with:

```sh
cd "$GATE/tap" && git -C . log -1 --format=%s           # developer-os 0.1.1
brew tap msolecki/developer-os "$GATE/tap" && brew install msolecki/developer-os/developer-os
dos uninstall --dry-run && dos uninstall --yes
DEVELOPER_OS_BRAIN=<vault> developer-os init --dry-run --adapters claude,codex
DEVELOPER_OS_BRAIN=<vault> developer-os init --yes --adapters claude,codex
```

On the founder machine the formula `url` must point at the local file. Before tapping, run `sed -i '' "s#file:///Volumes/My%20Shared%20Files/gate#file://$GATE#" "$GATE/tap/Formula/developer-os.rb" && git -C "$GATE/tap" commit -qam 'founder-machine url'`. Then run step 15's "after" block. Expected: all three `diff`s print nothing, and `grep -c '"trust":"package-channel"' <product-home>/state/release-trust.json` prints `1`. From now on every release goes through `update` (K4).

- [ ] **Step 7: Close the plan (orchestrator).** Update BACKLOG, ORDER and the architecture notes as listed under Files. Then push once, through a PR, because the `baseline` ruleset requires one (`GH013`). The founder merges.
