import { constants } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { CLAUDE_MINIMUM_VERSION, discoverClaude } from "@developer-os/adapter-claude";
import { CODEX_MINIMUM_VERSION, discoverCodex } from "@developer-os/adapter-codex";
import {
  assertHookExecutablePath,
  assertHookNodePath,
  compareVersions,
  decodeCanonicalJson,
  encodeCanonicalJson,
  EXIT_CODES,
  hashBytes,
  validateActiveReleaseRecord,
} from "@developer-os/core";
import type {
  CanonicalJsonValue,
  DeveloperOsConfigV1,
  HookCommandExecutable,
  InstallationManifestV2,
  LowerHexSha256,
  ManagedArtifactV2,
  PlannedFileMutation,
  UtcTimestampV1,
  VaultFreeRelativePathV1,
} from "@developer-os/core";

import { createCanonicalPathEvidence } from "../bootstrap/admission.js";
import { isMissingEntry, readConfigFile } from "../config-file.js";
import type { CliContext } from "../context.js";
import { readConfigRecord } from "../commands/config.js";
import { ConfigurationError, discoverEachAgent } from "../commands/doctor.js";
import { LifecycleMutationRefusal, withLifecycleMutation } from "../lifecycle/mutation-gate.js";
import type { LifecycleMutationAuthorityV1 } from "../lifecycle/mutation-gate.js";
import type { CliLifecycleContext } from "../lifecycle/context.js";
import { entrypointPath } from "../update/local-release.js";
import type { AdmittedPackagedReleaseV1 } from "../update/packaged-release.js";
import { compareManifestRows, InstructionRefusal, planInstructionAttach } from "./attach.js";
import type { InstructionApplyReportV1 } from "./attach.js";
import {
  codexPluginTreeHash,
  CodexRegistrationFailedError,
  inspectCodexRegistration,
  registerCodexPlugin,
  unregisterCodexPlugin,
  validateCodexRegistrationRecord,
} from "./codex-registration.js";
import type { CodexRegistrationRecordV1, CodexRegistrationStateV1 } from "./codex-registration.js";
import { InstructionRefusal as DetachRefusal, planInstructionDetach } from "./detach.js";
import type { InstructionFileSystemV1 } from "./detach.js";
import { loadInstructionDefaults, loadInstructionOverrides, loadReleaseWorkflows, mergeInstructionSources } from "./sources.js";
import type { InstructionSourceSetV1 } from "./sources.js";
import { codexInstructionPaths, resolveVendorHomes } from "./vendor-homes.js";
import type { VendorHomesV1 } from "./vendor-homes.js";

type Vendor = "claude" | "codex";

export type AdapterSelectionV1 = readonly Vendor[];

export type InstructionApplyResultV1 = InstructionApplyReportV1 & {
  readonly registration: CodexRegistrationStateV1 | null;
  readonly warnings: readonly string[];
};

const VENDORS: readonly Vendor[] = ["claude", "codex"];
const ADAPTER_FLAGS: ReadonlyMap<string, AdapterSelectionV1> = new Map<string, AdapterSelectionV1>([
  ["claude,codex", ["claude", "codex"]],
  ["claude", ["claude"]],
  ["codex", ["codex"]],
  ["none", []],
]);
const FLOOR: Readonly<Record<Vendor, string>> = { claude: CLAUDE_MINIMUM_VERSION, codex: CODEX_MINIMUM_VERSION };
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const MAX_ACTIVE_RELEASE_BYTES = 16 * 1024;
const MAX_REGISTRATION_BYTES = 8 * 1024;
const encoder = new TextEncoder();

export const ADAPTERS_NEXT_STEP =
  "no adapter selected; nothing was written for Claude or Codex. Re-run init with --adapters claude,codex, claude or codex to install the instruction artifacts";

export function parseAdaptersFlag(value: string): AdapterSelectionV1 {
  const selection = ADAPTER_FLAGS.get(value);
  if (selection === undefined) {
    throw new InstructionRefusal({
      reason: "adapters_flag_invalid",
      code: EXIT_CODES.invalidInput,
      paths: [],
      recovery: "pass --adapters claude,codex, claude, codex or none",
    });
  }
  return selection;
}

/** What `failureFrom` needs from any refusal this step raises; `evidence` publishes redacted as `data`. */
export function instructionRefusalDetails(error: unknown): {
  readonly paths: readonly string[];
  readonly recovery: string | undefined;
  readonly data: object | undefined;
} | null {
  if (error instanceof InstructionRefusal || error instanceof DetachRefusal) {
    return { paths: error.paths, recovery: error.recovery, data: error.evidence === null ? undefined : { evidence: error.evidence } };
  }
  if (error instanceof LifecycleMutationRefusal) return { paths: error.paths, recovery: error.recovery, data: undefined };
  if (error instanceof CodexRegistrationFailedError) return { paths: error.paths, recovery: "re-run init", data: undefined };
  return null;
}

/** No-follow reads for the planners; `null` means absent. */
export async function readNoFollow(path: string): Promise<Uint8Array | null> {
  let handle;
  try {
    handle = await nodeFs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (isMissingEntry(error)) return null;
    throw error;
  }
  try {
    if (!(await handle.stat()).isFile()) return null;
    return new Uint8Array(await handle.readFile());
  } finally {
    await handle.close();
  }
}

const PLANNER_FS: InstructionFileSystemV1 = {
  lstat: async (path) => {
    try {
      return await nodeFs.lstat(path, { bigint: true });
    } catch (error) {
      if (isMissingEntry(error)) return null;
      throw error;
    }
  },
  readFile: readNoFollow,
  readdir: async (path) => {
    try {
      return await nodeFs.readdir(path);
    } catch (error) {
      if (isMissingEntry(error)) return null;
      throw error;
    }
  },
};

function within(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/** The discovered, trusted executable per vendor; `null` when absent or discovery refused. */
async function discoverExecutables(context: CliContext): Promise<ReadonlyMap<Vendor, string | null>> {
  const found = new Map<Vendor, string | null>();
  for (const outcome of await discoverEachAgent(context)) {
    const discovery = outcome.discovery;
    found.set(outcome.name, discovery?.installed === true ? discovery.executablePath : null);
  }
  return found;
}

async function assertAdapterAvailable(context: CliContext, vendor: Vendor, executable: string | null): Promise<void> {
  const discover = vendor === "claude" ? discoverClaude : discoverCodex;
  const installation = executable === null ? null : await discover({ runner: context.runner, executable });
  const comparison = installation === null ? null : compareVersions(installation.version, FLOOR[vendor]);
  if (comparison === null || comparison < 0) {
    throw new InstructionRefusal({
      reason: "adapter_unavailable",
      code: EXIT_CODES.capabilityUnavailable,
      paths: executable === null ? [] : [executable],
      recovery: `install the ${vendor} CLI at ${FLOOR[vendor]} or later, or leave ${vendor} out of --adapters`,
    });
  }
}

function releaseMismatch(context: CliContext): InstructionRefusal {
  return new InstructionRefusal({
    reason: "release_mismatch",
    code: EXIT_CODES.capabilityUnavailable,
    paths: [context.paths.manifestFile, join(context.paths.stateDir, "active-release.json")],
    recovery: "name the installed build with --local-release, or reinstall from the new build (uninstall, then init)",
  });
}

/** Scope decision 4: the admitted release must be the installed one, by version and by identity. */
async function assertInstalledRelease(
  context: CliContext,
  release: AdmittedPackagedReleaseV1,
  productVersion: unknown,
): Promise<void> {
  if (release.identity.version !== productVersion) throw releaseMismatch(context);
  const bytes = await readNoFollow(join(context.paths.stateDir, "active-release.json"));
  if (bytes === null) throw releaseMismatch(context);
  const active = validateActiveReleaseRecord(decodeCanonicalJson(bytes, MAX_ACTIVE_RELEASE_BYTES), createCanonicalPathEvidence());
  if (active.releaseIdentityHash !== release.identity.releaseIdentityHash) throw releaseMismatch(context);
}

interface GatedState {
  readonly manifest: InstallationManifestV2;
  readonly manifestHash: LowerHexSha256;
  readonly config: DeveloperOsConfigV1;
  readonly configHash: LowerHexSha256;
}

/** Read under the held lock; each hash is of the bytes on disk, never of a re-encoding. */
export async function gatedState(context: CliContext, authority: LifecycleMutationAuthorityV1): Promise<GatedState> {
  const bytes = await readNoFollow(context.paths.manifestFile);
  if (bytes === null) throw new Error("the installation manifest vanished under the lifecycle lock");
  const { config, beforeHash } = await readConfigRecord(context);
  return {
    manifest: authority.admitted.manifest,
    manifestHash: hashBytes(bytes) as LowerHexSha256,
    config,
    configHash: beforeHash as LowerHexSha256,
  };
}

export function manifestMutation(context: CliContext, manifest: InstallationManifestV2, expectedBeforeHash: LowerHexSha256): PlannedFileMutation {
  return {
    targetPath: context.paths.manifestFile,
    operation: "replace",
    content: encoder.encode(encodeCanonicalJson(manifest as unknown as CanonicalJsonValue)),
    expectedBeforeHash,
  };
}

async function loadSources(
  release: AdmittedPackagedReleaseV1,
  selection: AdapterSelectionV1,
  productHome: string,
  effectiveUid: number,
) {
  const workflows = await loadReleaseWorkflows(release);
  const workflowIds = new Set(workflows.map((workflow) => workflow.id));
  const defaults = await loadInstructionDefaults(release, workflowIds);
  const sources = new Map<Vendor, InstructionSourceSetV1>();
  for (const vendor of selection) {
    const overrides = await loadInstructionOverrides({ productHome, vendor, effectiveUid, workflowIds });
    sources.set(vendor, mergeInstructionSources(vendor, defaults, overrides));
  }
  return { workflows, sources };
}

/** Spec §6.4: registers when the tree changed or Codex does not list it; success records the tree hash. */
async function reconcileRegistration(
  context: CliContext,
  lifecycle: CliLifecycleContext,
  homes: VendorHomesV1,
  codexExecutable: string,
): Promise<CodexRegistrationStateV1> {
  const { pluginRoot, registrationFile } = codexInstructionPaths(homes);
  const manifestBytes = await readNoFollow(context.paths.manifestFile);
  if (manifestBytes === null) throw new Error("the installation manifest vanished after the attach");
  const manifest = decodeCanonicalJson(manifestBytes, MAX_MANIFEST_BYTES) as unknown as InstallationManifestV2;
  const treeHash = codexPluginTreeHash(manifest.artifacts.flatMap((artifact) =>
    within(pluginRoot, artifact.path) && artifact.kind !== "directory" && artifact.verification.mode === "content"
      ? [{ path: artifact.path.slice(pluginRoot.length + 1), sha256: artifact.verification.installedHash }]
      : []));
  let record: CodexRegistrationRecordV1 | null;
  try {
    const bytes = await readNoFollow(registrationFile);
    record = bytes === null || bytes.byteLength > MAX_REGISTRATION_BYTES ? null : validateCodexRegistrationRecord(bytes);
  } catch {
    record = null;
  }
  const call = { runner: context.runner, codexExecutable, codexHome: homes.codexHome };
  if ((await inspectCodexRegistration({ ...call, pluginRoot, record, treeHash })) === "registered") return "registered";

  await registerCodexPlugin({ ...call, marketplaceRoot: join(homes.productHome, "codex"), pluginRoot });
  await withLifecycleMutation(context, lifecycle, async (authority) => {
    const state = await gatedState(context, authority);
    const content = encoder.encode(encodeCanonicalJson({ codexHome: homes.codexHome, treeHash }));
    const current = await readNoFollow(registrationFile);
    const previous = state.manifest.artifacts.find((artifact) => artifact.path === registrationFile);
    const row: ManagedArtifactV2 = {
      owner: "codex",
      path: registrationFile as ManagedArtifactV2["path"],
      productVersion: state.manifest.productVersion,
      existedBefore: false,
      beforeHash: null,
      backupRelativePath: null,
      source: "generated/codex/registration.json" as VaultFreeRelativePathV1,
      mergeStrategy: "dedicated",
      verifiedAt: context.now().toISOString() as UtcTimestampV1,
      kind: "file",
      verification: { mode: "schema", schemaId: "codex-registration-v1", installedHash: hashBytes(content) as LowerHexSha256 },
    };
    const manifest: InstallationManifestV2 = {
      ...state.manifest,
      artifacts: [...state.manifest.artifacts.filter((artifact) => artifact !== previous), row].sort(compareManifestRows),
    };
    await context.executor.execute({
      kind: "codex-registration",
      mutations: [
        current === null
          ? { targetPath: registrationFile, operation: "create", content }
          : { targetPath: registrationFile, operation: "replace", content, expectedBeforeHash: hashBytes(current) },
        manifestMutation(context, manifest, state.manifestHash),
      ],
    });
  });
  return "registered";
}

const EMPTY_REPORT: InstructionApplyReportV1 = { installed: [], restored: [], unchanged: [], emulated: [], unsupported: [], heldBack: [] };

/**
 * Spec §6.1 and §6.2: detach every deselected vendor, attach the selection, then register Codex.
 * Each transaction runs under its own gate entry, so each plans against the home the previous
 * one committed.
 */
export async function applyInstructions(context: CliContext, input: {
  /** `null`: use the stored `adapters.*`. */
  readonly selection: AdapterSelectionV1 | null;
  readonly release: AdmittedPackagedReleaseV1 | null;
}): Promise<InstructionApplyResultV1> {
  const stored = await readConfigFile(context, context.paths.configFile);
  const selection = input.selection ?? (stored === null ? [] : VENDORS.filter((vendor) => stored.adapters[vendor]));
  const manifestBytes = await readNoFollow(context.paths.manifestFile);
  const recorded = manifestBytes === null
    ? null
    : decodeCanonicalJson(manifestBytes, MAX_MANIFEST_BYTES) as unknown as InstallationManifestV2;
  const home = context.paths.home;
  const attached = (vendor: Vendor): boolean =>
    stored?.adapters[vendor] === true
    || (recorded?.artifacts ?? []).some((artifact) => artifact.owner === vendor && !within(home, artifact.path));
  const detached = VENDORS.filter((vendor) => !selection.includes(vendor) && attached(vendor));
  // Nothing selected and nothing installed: no gate entry, which would itself write bookkeeping.
  if (selection.length === 0 && detached.length === 0) return { ...EMPTY_REPORT, registration: null, warnings: [] };

  if (stored === null) throw new ConfigurationError();
  const lifecycle = context.lifecycle;
  if (lifecycle === undefined) {
    throw new InstructionRefusal({
      reason: "lifecycle_context_unavailable",
      code: EXIT_CODES.capabilityUnavailable,
      paths: [home],
      recovery: "move the product home to a canonical absolute path before selecting adapters",
    });
  }

  /**
   * A13 Task 14: the Claude hooks run `<this Node> <product-home>/bin/developer-os.mjs`. Checked
   * once, before any transaction, so an unsafe home refuses with exit 2 and nothing written.
   */
  const hookExecutable: HookCommandExecutable = { node: process.execPath, entrypoint: entrypointPath(home) };
  if (selection.includes("claude")) {
    assertHookNodePath(hookExecutable.node);
    assertHookExecutablePath(hookExecutable.entrypoint);
  }

  const executables = await discoverExecutables(context);
  for (const vendor of selection) await assertAdapterAvailable(context, vendor, executables.get(vendor) ?? null);
  if (selection.length > 0) {
    if (input.release === null) {
      throw new InstructionRefusal({
        reason: "packaged_release_unavailable",
        code: EXIT_CODES.capabilityUnavailable,
        paths: [home],
        recovery: "re-run init with --local-release <dir> naming the installed build",
      });
    }
    await assertInstalledRelease(context, input.release, recorded?.productVersion);
  }

  const homes = resolveVendorHomes(context.env, context.userHome, home);
  const warnings: string[] = [];

  if (detached.length > 0) {
    await withLifecycleMutation(context, lifecycle, async (authority) => {
      const plan = await planInstructionDetach({ vendors: detached, homes, ...(await gatedState(context, authority)), fs: PLANNER_FS });
      if (plan.kind === "noop") return;
      if (detached.includes("codex")) {
        const { warning } = await unregisterCodexPlugin({
          runner: context.runner,
          codexExecutable: executables.get("codex") ?? null,
          codexHome: homes.codexHome,
        });
        if (warning !== null) warnings.push(warning);
      }
      await context.executor.execute({ kind: "instructions", mutations: plan.mutations });
      for (const directory of plan.directories) {
        // Exact-empty only: rmdir never removes content, and a refused one stays for doctor to name.
        await nodeFs.rmdir(directory).catch(() => undefined);
      }
      warnings.push(...plan.preserved.map((directory) => `kept ${directory}: it holds entries Developer OS did not create`));
    });
  }

  if (selection.length === 0 || input.release === null) return { ...EMPTY_REPORT, registration: null, warnings };

  const { workflows, sources } = await loadSources(input.release, selection, home, lifecycle.effectiveUid);
  const report = await withLifecycleMutation(context, lifecycle, async (authority) => {
    const state = await gatedState(context, authority);
    const plan = await planInstructionAttach({
      vendors: selection,
      homes,
      ...state,
      sources,
      workflows,
      productVersion: state.manifest.productVersion,
      now: context.now().toISOString() as UtcTimestampV1,
      fs: PLANNER_FS,
      redactDiagnostic: (text) => context.guards.transaction.redactDiagnostic(text),
      hookExecutable,
    });
    if (plan.kind === "noop") return EMPTY_REPORT;
    // The Foundation executor creates no directory; product-created ones are exactly 0700.
    for (const directory of plan.directories) await nodeFs.mkdir(directory, { mode: 0o700 });
    await context.executor.execute({ kind: "instructions", mutations: plan.mutations });
    return plan.report;
  });

  const codex = executables.get("codex") ?? null;
  const registration = selection.includes("codex") && codex !== null
    ? await reconcileRegistration(context, lifecycle, homes, codex)
    : null;
  return { ...report, registration, warnings };
}
