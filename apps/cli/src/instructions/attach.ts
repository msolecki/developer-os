import type { BigIntStats } from "node:fs";
import { join } from "node:path";

import {
  proposeClaudeInstall,
  renderClaudeVendorTree,
  renderInstructionTree as renderClaudeInstructions,
  withClaudeHooks,
} from "@developer-os/adapter-claude";
import {
  PLUGIN_TREE_PREFIX,
  proposeCodexInstall,
  renderCodexVendorTree,
  renderInstructionTree as renderCodexInstructions,
  withCodexHooks,
} from "@developer-os/adapter-codex";
import {
  buildConflictEvidence,
  decideInstructionBlockMerge,
  encodeCanonicalJson,
  EXIT_CODES,
  extractInstructionBlock,
  hashBytes,
  insertInstructionBlock,
  renderInstructionBlock,
  replaceInstructionBlock,
  serializeConfig,
  setConfigValue,
} from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  ConflictEvidence,
  ConflictEvidenceRequest,
  DeveloperOsConfigV1,
  ExitCode,
  HookCommandExecutable,
  InstallationManifestV2,
  InstructionBlockMemberV1,
  InstructionCategoryV1,
  InstructionIdentityV1,
  LowerHexSha256,
  ManagedArtifactV2,
  PlannedFileMutation,
  StableSemverV1,
  UtcTimestampV1,
  VaultFreeRelativePathV1,
} from "@developer-os/core";
import { compareCodePoints } from "@developer-os/workflow-schema";
import type { WorkflowContractV1 } from "@developer-os/workflow-schema";

import type { InstructionSourceSetV1, InstructionSourceV1 } from "./sources.js";
import { claudeInstructionPaths, codexHomeRecordPath, codexInstructionPaths } from "./vendor-homes.js";
import type { VendorHomesV1 } from "./vendor-homes.js";

type Vendor = "claude" | "codex";
type BlockRow = Extract<ManagedArtifactV2, { readonly verification: { readonly mode: "block" } }>;

export interface InstructionAttachInputV1 {
  /** The selection after this run. */
  readonly vendors: readonly Vendor[];
  readonly homes: VendorHomesV1;
  readonly manifest: InstallationManifestV2;
  readonly manifestHash: LowerHexSha256;
  readonly config: DeveloperOsConfigV1;
  readonly configHash: LowerHexSha256;
  readonly sources: ReadonlyMap<Vendor, InstructionSourceSetV1>;
  /** Task 9 `loadReleaseWorkflows`. */
  readonly workflows: readonly WorkflowContractV1[];
  readonly productVersion: StableSemverV1;
  readonly now: UtcTimestampV1;
  /** No-follow, injected. `null` means absent. */
  readonly fs: {
    lstat(path: string): Promise<BigIntStats | null>;
    readFile(path: string): Promise<Uint8Array | null>;
  };
  /** The conflict diff carries user bytes; only the redactor may publish them. */
  readonly redactDiagnostic: (text: string) => string;
  /** Defaults to `UNPROVEN_CLAUDE_CATEGORIES`. */
  readonly heldBackClaudeCategories?: ReadonlySet<InstructionCategoryV1>;
  /**
   * A13 Task 14: what the Claude plugin's `hooks/hooks.json` runs, `<node> <entrypoint>`. The
   * entrypoint is D53's version-free `<product-home>/bin/developer-os.mjs`.
   */
  readonly hookExecutable: HookCommandExecutable;
}

export interface InstructionApplyReportV1 {
  readonly installed: readonly string[];
  readonly restored: readonly string[];
  readonly unchanged: readonly string[];
  readonly emulated: readonly string[];
  readonly unsupported: readonly string[];
  /** Claude artifacts whose loading is not yet proven (invariant 3). */
  readonly heldBack: readonly string[];
}

export type InstructionAttachPlanV1 =
  | { readonly kind: "noop" }
  | {
    readonly kind: "transaction";
    readonly mutations: readonly PlannedFileMutation[];
    readonly manifest: InstallationManifestV2;
    /**
     * Missing parents recorded as `directory` rows, shallowest first. The Foundation executor
     * creates no directory, so the caller creates these (0700) before `execute()`.
     */
    readonly directories: readonly string[];
    readonly report: InstructionApplyReportV1;
  };

/** Invariant 3. Emptied 2026-09-26 by the billed row (NEW-101, `claude-adapter.md` §14.1). */
export const UNPROVEN_CLAUDE_CATEGORIES: ReadonlySet<InstructionCategoryV1> = new Set<InstructionCategoryV1>();

export class InstructionRefusal extends Error {
  readonly reason: string;
  readonly code: ExitCode;
  readonly paths: readonly string[];
  readonly evidence: ConflictEvidence | null;
  readonly recovery: string;

  constructor(input: {
    readonly reason: string;
    readonly code: ExitCode;
    readonly paths: readonly string[];
    readonly evidence?: ConflictEvidence | null;
    readonly recovery: string;
  }) {
    super(`${input.reason}: ${input.paths.join(", ")}`);
    // failureFrom publishes kindOf(name), so this spelling is what yields the reason code.
    this.name = `${input.reason.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("")}Error`;
    this.reason = input.reason;
    this.code = input.code;
    this.paths = input.paths;
    this.evidence = input.evidence ?? null;
    this.recovery = input.recovery;
  }
}

/** Spec §5.2: one text for every exit-3 refusal. */
export function instructionConflictRecovery(productHome: string, vendor: Vendor): string {
  return `move the edits into ${productHome}/instructions/${vendor}/, delete the whole block (both markers included), and re-run the command`;
}

interface DesiredFile {
  readonly owner: Vendor;
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly source: string;
  /** `null` for a workflow plugin file (`kind: "file"`). */
  readonly instruction: InstructionIdentityV1 | null;
}

const encoder = new TextEncoder();
const BLOCK_ID: Readonly<Record<Vendor, string>> = { claude: "claude-md", codex: "agents-md" };

function label(owner: Vendor, category: string, id: string): string {
  return `${owner} ${category}/${id}`;
}

function canonical(value: unknown): string {
  return encodeCanonicalJson(value as never);
}

function compareBytes(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

/** `validateManifestV2`'s inventory order. */
export function compareManifestRows(left: ManagedArtifactV2, right: ManagedArtifactV2): number {
  return compareBytes(left.path, right.path)
    || compareBytes(left.owner, right.owner)
    || compareBytes(left.kind, right.kind)
    || compareBytes(left.verification.mode, right.verification.mode);
}

/** Keeps the recorded row, `verifiedAt` included, when nothing but the stamp would change. */
function settle(candidate: ManagedArtifactV2, previous: ManagedArtifactV2 | undefined): ManagedArtifactV2 {
  if (previous === undefined) return candidate;
  const restamped = { ...candidate, productVersion: previous.productVersion, verifiedAt: previous.verifiedAt };
  return canonical(restamped) === canonical(previous) ? previous : candidate;
}

function installedHashOf(row: ManagedArtifactV2): string | null {
  return "installedHash" in row.verification ? row.verification.installedHash : null;
}

function sourceKey(category: string, id: string): string {
  return `${category}/${id}`;
}

function under(root: string, path: string): boolean {
  return path.startsWith(`${root}/`);
}

class Planner {
  readonly #input: InstructionAttachInputV1;
  readonly #rows = new Map<string, ManagedArtifactV2>();
  readonly #previous: ReadonlyMap<string, ManagedArtifactV2>;
  readonly #mutations: PlannedFileMutation[] = [];
  readonly #directories = new Map<string, Vendor>();
  readonly #status = new Map<string, "installed" | "restored" | "unchanged">();
  readonly #desired = new Set<string>();

  constructor(input: InstructionAttachInputV1) {
    this.#input = input;
    this.#previous = new Map(input.manifest.artifacts.map((row) => [row.path as string, row]));
    for (const row of input.manifest.artifacts) this.#rows.set(row.path, row);
  }

  get homes(): VendorHomesV1 {
    return this.#input.homes;
  }

  #common(owner: Vendor, path: string, source: string) {
    return {
      owner,
      path: path as CanonicalAbsolutePathV1,
      productVersion: this.#input.productVersion,
      existedBefore: false,
      beforeHash: null,
      backupRelativePath: null,
      source: source as VaultFreeRelativePathV1,
      mergeStrategy: "dedicated" as const,
      verifiedAt: this.#input.now,
    };
  }

  #mark(key: string, state: "installed" | "restored" | "unchanged"): void {
    const order = { unchanged: 0, installed: 1, restored: 2 } as const;
    const current = this.#status.get(key);
    if (current === undefined || order[state] > order[current]) this.#status.set(key, state);
  }

  /** The longest of `P`, `H` and `C`'s parent that holds `path`: components below it are checked. */
  #anchor(path: string): string {
    const roots = [this.homes.productHome, this.homes.userHome, join(this.homes.codexHome, "..")]
      .filter((root) => under(root, path))
      .sort((left, right) => right.length - left.length);
    const [root] = roots;
    if (root === undefined) throw new Error(`instruction target outside every vendor home: ${path}`);
    return root;
  }

  /** Spec §2.2: a symlink at any component refuses; missing parents become `directory` rows. */
  async #inspect(owner: Vendor, target: string, recordParents = true): Promise<BigIntStats | null> {
    const anchor = this.#anchor(target);
    const parts = target.slice(anchor.length + 1).split("/");
    let current = anchor;
    let missing = false;
    for (const [index, part] of parts.entries()) {
      current = `${current}/${part}`;
      const leaf = index === parts.length - 1;
      if (missing) {
        if (!leaf && recordParents) this.#directories.set(current, owner);
        continue;
      }
      const stats = await this.#input.fs.lstat(current);
      if (stats === null) {
        missing = true;
        if (!leaf && recordParents) this.#directories.set(current, owner);
        continue;
      }
      if (stats.isSymbolicLink()) {
        throw new InstructionRefusal({
          reason: "instruction_target_symlinked",
          code: EXIT_CODES.securityRefusal,
          paths: [current],
          recovery: `replace the symlink at ${current} with a regular file or directory holding the same content, then re-run the command`,
        });
      }
      if (leaf) {
        if (!stats.isFile()) throw this.#occupied(target);
        return stats;
      }
      if (!stats.isDirectory()) throw this.#occupied(current);
    }
    return null;
  }

  #occupied(path: string): InstructionRefusal {
    return new InstructionRefusal({
      reason: "instruction_target_occupied",
      code: EXIT_CODES.decisionRequired,
      paths: [path],
      recovery: `move ${path} aside (an unmanaged entry is never adopted), then re-run the command`,
    });
  }

  async #read(target: string, stats: BigIntStats | null): Promise<Uint8Array | null> {
    if (stats === null) return null;
    const bytes = await this.#input.fs.readFile(target);
    if (bytes === null) throw this.#occupied(target);
    return bytes;
  }

  async file(entry: DesiredFile, reportKey: string | null): Promise<void> {
    this.#desired.add(entry.path);
    const previous = this.#previous.get(entry.path);
    const recorded = previous === undefined ? null : installedHashOf(previous);
    if (previous !== undefined && (previous.owner !== entry.owner || previous.verification.mode !== "content" || recorded === null)) {
      throw this.#occupied(entry.path);
    }
    const current = await this.#read(entry.path, await this.#inspect(entry.owner, entry.path));
    const proposedHash = hashBytes(entry.bytes) as LowerHexSha256;
    let state: "installed" | "restored" | "unchanged";
    if (recorded === null) {
      if (current !== null) throw this.#occupied(entry.path);
      this.#mutations.push({ targetPath: entry.path, operation: "create", content: entry.bytes });
      state = "installed";
    } else if (current === null) {
      this.#mutations.push({ targetPath: entry.path, operation: "create", content: entry.bytes });
      state = "restored";
    } else {
      const currentHash = hashBytes(current);
      if (currentHash === proposedHash) {
        state = "unchanged";
      } else if (currentHash === recorded) {
        this.#mutations.push({ targetPath: entry.path, operation: "replace", content: entry.bytes, expectedBeforeHash: recorded });
        state = "installed";
      } else {
        throw new InstructionRefusal({
          reason: "instruction_target_drifted",
          code: EXIT_CODES.decisionRequired,
          paths: [entry.path],
          recovery: `move the edits into ${this.homes.productHome}/instructions/${entry.owner}/, delete ${entry.path}, and re-run the command`,
        });
      }
    }
    if (reportKey !== null) this.#mark(reportKey, state);
    const common = this.#common(entry.owner, entry.path, entry.source);
    const candidate: ManagedArtifactV2 = entry.instruction === null
      ? { ...common, kind: "file", verification: { mode: "content", installedHash: proposedHash } }
      : { ...common, kind: "instruction", instruction: entry.instruction, verification: { mode: "content", installedHash: proposedHash } };
    this.#rows.set(entry.path, settle(candidate, previous));
  }

  async block(owner: Vendor, target: string, body: string, members: readonly InstructionBlockMemberV1[]): Promise<void> {
    const previous = this.#previous.get(target);
    if (previous !== undefined && previous.verification.mode !== "block") throw this.#occupied(target);
    const row = previous as BlockRow | undefined;
    // ponytail: an installed block whose members all left is kept as is; stripping it is detach's job.
    if (members.length === 0) return;
    const reportKey = label(owner, "vendor-file", BLOCK_ID[owner]);
    const file = await this.#read(target, await this.#inspect(owner, target));
    const proposed = renderInstructionBlock({ productHome: this.homes.productHome, vendor: owner, body });
    const extraction = file === null ? ({ kind: "absent" } as const) : extractInstructionBlock(file);
    const decision = decideInstructionBlockMerge({ baseHash: row?.verification.blockHash ?? null, current: extraction, proposed });
    if (decision.action === "refuse") {
      throw new InstructionRefusal({
        reason: decision.reason,
        code: EXIT_CODES.decisionRequired,
        paths: [target],
        evidence: decision.reason === "instruction_block_conflict" && row !== undefined && file !== null
          ? await this.#evidence(row, file, proposed)
          : null,
        recovery: instructionConflictRecovery(this.homes.productHome, owner),
      });
    }

    // A file the user deleted is re-created by the product, so detach removes it rather than leave it empty.
    const restore = file === null
      ? { existedBefore: false, beforeHash: null, backupRelativePath: null }
      : row !== undefined
        ? { existedBefore: row.existedBefore, beforeHash: row.beforeHash, backupRelativePath: row.backupRelativePath }
        : await this.#backup(owner, file);
    if (decision.action === "write") {
      const next = extraction.kind === "present" && file !== null
        ? replaceInstructionBlock(file, proposed)
        : insertInstructionBlock(file, proposed);
      if (file === null) {
        this.#mutations.push({ targetPath: target, operation: "create", content: next });
      } else {
        this.#mutations.push({ targetPath: target, operation: "replace", content: next, expectedBeforeHash: hashBytes(file) });
      }
      this.#mark(reportKey, decision.reported === "restored" ? "restored" : "installed");
    } else {
      this.#mark(reportKey, "unchanged");
    }

    const candidate: BlockRow = {
      ...this.#common(owner, target, `generated/${owner}/${BLOCK_ID[owner]}`),
      ...restore,
      mergeStrategy: "marked-block",
      kind: "instruction",
      instruction: {
        category: "vendor-file",
        id: BLOCK_ID[owner] as BlockRow["instruction"]["id"],
        source: "default",
        members: [...members].sort((left, right) => compareCodePoints(left.category, right.category) || compareCodePoints(left.id, right.id)),
      },
      verification: { mode: "block", blockHash: hashBytes(proposed) as LowerHexSha256 },
    };
    this.#rows.set(target, settle(candidate, previous));
  }

  /** The block arm reads only the bytes it is given; `fs` and `guards` must never be touched. */
  async #evidence(row: BlockRow, fileBytes: Uint8Array, proposedBlock: Uint8Array): Promise<ConflictEvidence> {
    const untouchable = new Proxy({}, {
      get: (): never => {
        throw new Error("block conflict evidence must not touch the filesystem");
      },
    });
    return buildConflictEvidence({
      block: { artifact: row, fileBytes, proposedBlock },
      fs: untouchable as Extract<ConflictEvidenceRequest, { readonly block: unknown }>["fs"],
      guards: untouchable as Extract<ConflictEvidenceRequest, { readonly block: unknown }>["guards"],
      redactDiagnostic: this.#input.redactDiagnostic,
    });
  }

  /** Spec §2.1: a pre-existing vendor file's whole-file backup, kept as evidence and never restored. */
  async #backup(owner: Vendor, file: Uint8Array) {
    const beforeHash = hashBytes(file) as LowerHexSha256;
    const relative = `instruction-${owner}-${beforeHash}`;
    const path = join(this.homes.productHome, "backups", relative);
    const stats = await this.#input.fs.lstat(path);
    if (stats === null) {
      this.#mutations.push({ targetPath: path, operation: "create", content: file });
    } else {
      const existing = stats.isFile() ? await this.#input.fs.readFile(path) : null;
      // Content-addressed: an identical backup left by an earlier uninstall is reused.
      if (existing === null || hashBytes(existing) !== beforeHash) throw this.#occupied(path);
    }
    return { existedBefore: true, beforeHash, backupRelativePath: relative as VaultFreeRelativePathV1 };
  }

  /** Vendor content rows this render no longer produces: removed unless the user edited them. */
  async stale(owner: Vendor, owned: (path: string) => boolean): Promise<void> {
    for (const row of this.#previous.values()) {
      if (row.owner !== owner || row.verification.mode !== "content" || this.#desired.has(row.path) || !owned(row.path)) continue;
      const recorded = installedHashOf(row);
      if (recorded === null) continue;
      const current = await this.#read(row.path, await this.#inspect(owner, row.path, false));
      if (current !== null) {
        if (hashBytes(current) !== recorded) {
          throw new InstructionRefusal({
            reason: "instruction_target_drifted",
            code: EXIT_CODES.decisionRequired,
            paths: [row.path],
            recovery: `move the edits into ${this.homes.productHome}/instructions/${owner}/, delete ${row.path}, and re-run the command`,
          });
        }
        this.#mutations.push({ targetPath: row.path, operation: "remove", content: null, expectedBeforeHash: recorded });
      }
      this.#rows.delete(row.path);
    }
  }

  finish(configMutation: PlannedFileMutation | null, report: Omit<InstructionApplyReportV1, "installed" | "restored" | "unchanged">): InstructionAttachPlanV1 {
    for (const [path, owner] of this.#directories) {
      const candidate: ManagedArtifactV2 = { ...this.#common(owner, path, "generated/directory"), kind: "directory", verification: { mode: "content" } };
      this.#rows.set(path, settle(candidate, this.#previous.get(path)));
    }
    const manifest: InstallationManifestV2 = {
      ...this.#input.manifest,
      artifacts: [...this.#rows.values()].sort(compareManifestRows),
    };
    const mutations = [...this.#mutations].sort((left, right) => compareBytes(left.targetPath, right.targetPath));
    if (configMutation !== null) mutations.push(configMutation);
    const manifestText = canonical(manifest);
    if (manifestText !== canonical(this.#input.manifest)) {
      mutations.push({
        targetPath: join(this.homes.productHome, "installation-manifest.json"),
        operation: "replace",
        content: encoder.encode(manifestText),
        expectedBeforeHash: this.#input.manifestHash,
      });
    }
    if (mutations.length === 0) return { kind: "noop" };
    const byState = (state: string) => [...this.#status].filter(([, value]) => value === state).map(([key]) => key).sort(compareCodePoints);
    return {
      kind: "transaction",
      mutations,
      manifest,
      directories: [...this.#directories.keys()].sort((left, right) => left.split("/").length - right.split("/").length || compareBytes(left, right)),
      report: { installed: byState("installed"), restored: byState("restored"), unchanged: byState("unchanged"), ...report },
    };
  }
}

function sourceSet(input: InstructionAttachInputV1, vendor: Vendor): InstructionSourceSetV1 {
  const set = input.sources.get(vendor);
  if (set?.vendor !== vendor) throw new Error(`no ${vendor} instruction source set was loaded`);
  return set;
}

function identityOf(artifacts: ReadonlyMap<string, InstructionSourceV1>, category: InstructionIdentityV1["category"], lookup: string, id: string): InstructionIdentityV1 {
  const artifact = artifacts.get(lookup);
  if (artifact === undefined) throw new Error(`rendered instruction ${category}/${id} has no source`);
  return { category, id: artifact.id, source: artifact.source };
}

async function planClaude(planner: Planner, input: InstructionAttachInputV1, heldBack: ReadonlySet<InstructionCategoryV1>, held: string[]): Promise<void> {
  const loaded = sourceSet(input, "claude");
  const kept = loaded.artifacts.filter((artifact) => {
    if (!heldBack.has(artifact.category)) return true;
    held.push(label("claude", artifact.category, artifact.id));
    return false;
  });
  const set = { ...loaded, artifacts: kept };
  const byKey = new Map(kept.map((artifact) => [sourceKey(artifact.category, artifact.id), artifact]));
  const paths = claudeInstructionPaths(planner.homes);
  const render = renderClaudeInstructions(set, { vendor: "claude", artifacts: [], unsupported: [] }, planner.homes.productHome);
  const tree = withClaudeHooks(renderClaudeVendorTree(input.workflows, render), input.hookExecutable);
  const instructionPaths = new Set(render.pluginFiles.map((file) => file.path));
  const proposal = proposeClaudeInstall(tree, { home: planner.homes.userHome, productVersion: input.productVersion });

  for (const [index, artifact] of tree.entries()) {
    const operation = proposal.operations[index];
    if (operation === undefined) throw new Error("the Claude install proposal lost an artifact");
    let identity: InstructionIdentityV1 | null = null;
    if (instructionPaths.has(artifact.path)) {
      const [directory = "", name = ""] = artifact.path.split("/");
      const id = directory === "skills" ? name : name.replace(/\.md$/u, "");
      identity = directory === "skills"
        ? identityOf(byKey, "skill", sourceKey("skill", id), id)
        : directory === "agents"
          ? identityOf(byKey, "agent", sourceKey("agent", id), id)
          : identityOf(byKey, "command", sourceKey("skill", id), id);
    }
    await planner.file(
      { owner: "claude", path: operation.targetPath, bytes: encoder.encode(artifact.contents), source: `generated/claude/plugin/${artifact.path}`, instruction: identity },
      identity === null ? null : label("claude", identity.category, identity.id),
    );
  }
  for (const file of render.homeFiles) {
    const identity = identityOf(byKey, file.category, sourceKey(file.category, file.id), file.id);
    const dir = file.target === "rules" ? paths.rulesDir : paths.outputStylesDir;
    await planner.file(
      { owner: "claude", path: join(dir, file.path), bytes: encoder.encode(file.contents), source: `generated/claude/${file.target}/${file.path}`, instruction: identity },
      label("claude", identity.category, identity.id),
    );
  }
  for (const file of render.importFiles) {
    const identity = identityOf(byKey, "rule", sourceKey("rule", file.id), file.id);
    await planner.file(
      { owner: "claude", path: join(paths.importDir, file.path), bytes: encoder.encode(file.contents), source: `generated/claude/instructions/${file.path}`, instruction: identity },
      label("claude", "rule", identity.id),
    );
  }
  await planner.block("claude", paths.instructionFile, render.block.body, render.block.members);
  await planner.stale("claude", (path) =>
    under(paths.pluginRoot, path)
    || under(paths.importDir, path)
    || path.startsWith(`${paths.rulesDir}/developer-os-`)
    || path.startsWith(`${paths.outputStylesDir}/developer-os-`));
}

async function planCodex(planner: Planner, input: InstructionAttachInputV1, report: { emulated: string[] }): Promise<void> {
  const set = sourceSet(input, "codex");
  const byKey = new Map(set.artifacts.map((artifact) => [sourceKey(artifact.category, artifact.id), artifact]));
  const paths = codexInstructionPaths(planner.homes);
  const render = renderCodexInstructions(set, { artifacts: [] });
  const tree = withCodexHooks(renderCodexVendorTree(input.workflows, render, { home: planner.homes.productHome }), input.hookExecutable);
  const instructionPaths = new Set(render.pluginFiles.map((file) => file.path));
  const proposal = proposeCodexInstall(tree, { home: planner.homes.productHome, productVersion: input.productVersion });

  for (const [index, artifact] of tree.entries()) {
    const operation = proposal.operations[index];
    if (operation === undefined) throw new Error("the Codex install proposal lost an artifact");
    let identity: InstructionIdentityV1 | null = null;
    if (instructionPaths.has(artifact.path)) {
      const [, id = ""] = artifact.path.slice(PLUGIN_TREE_PREFIX.length + 1).split("/");
      identity = identityOf(byKey, "skill", sourceKey("skill", id), id);
    }
    await planner.file(
      { owner: "codex", path: operation.targetPath, bytes: encoder.encode(artifact.contents), source: `generated/codex/${artifact.path}`, instruction: identity },
      identity === null ? null : label("codex", "skill", identity.id),
    );
  }
  for (const file of render.agentFiles) {
    const identity = identityOf(byKey, "agent", sourceKey("agent", file.id), file.id);
    await planner.file(
      { owner: "codex", path: join(planner.homes.codexHome, file.path), bytes: encoder.encode(file.contents), source: `generated/codex/${file.path}`, instruction: identity },
      label("codex", "agent", identity.id),
    );
  }
  await planner.block("codex", paths.instructionFile, render.block.body, render.block.members);
  await planner.file(
    { owner: "codex", path: codexHomeRecordPath(planner.homes.productHome), bytes: encoder.encode(`${planner.homes.codexHome}\n`), source: "generated/codex/codex-home", instruction: null },
    null,
  );
  report.emulated.push(...render.emulated.map((id) => label("codex", "scoped-rule", id)));
  const marketplaceRoot = join(planner.homes.productHome, "codex");
  await planner.stale("codex", (path) => under(marketplaceRoot, path) || path.startsWith(`${paths.agentsDir}/developer-os-`));
}

function unsupportedOf(input: InstructionAttachInputV1, vendors: readonly Vendor[]): string[] {
  return vendors.flatMap((vendor) => {
    const set = sourceSet(input, vendor);
    const styles = vendor === "codex"
      ? set.artifacts.filter((artifact) => artifact.category === "output-style").map((artifact) => label(vendor, artifact.category, artifact.id))
      : [];
    return [...styles, ...set.unsupported.map((entry) => label(vendor, entry.category, entry.id))];
  });
}

/**
 * Spec §6.1 steps 1–4 as one guarded plan: every file, both blocks, the `adapters.*` values and
 * the manifest rewrite. Writes nothing; every refusal names paths only.
 */
export async function planInstructionAttach(input: InstructionAttachInputV1): Promise<InstructionAttachPlanV1> {
  const vendors = [...new Set(input.vendors)].sort(compareCodePoints);
  const planner = new Planner(input);
  const heldBack: string[] = [];
  const derived = { emulated: [] as string[] };
  if (vendors.includes("claude")) await planClaude(planner, input, input.heldBackClaudeCategories ?? UNPROVEN_CLAUDE_CATEGORIES, heldBack);
  if (vendors.includes("codex")) await planCodex(planner, input, derived);

  // `config set`'s path: the record is rewritten and its schema-verified manifest row is left as is.
  let config = input.config;
  for (const vendor of ["claude", "codex"] as const) {
    config = setConfigValue(config, `adapters.${vendor}`, String(vendors.includes(vendor))).config;
  }
  const serialized = serializeConfig(config);
  const configMutation: PlannedFileMutation | null = serialized === serializeConfig(input.config)
    ? null
    : {
      targetPath: join(input.homes.productHome, "config.toml"),
      operation: "replace",
      content: encoder.encode(serialized),
      expectedBeforeHash: input.configHash,
    };

  return planner.finish(configMutation, {
    emulated: derived.emulated.sort(compareCodePoints),
    unsupported: [...new Set(unsupportedOf(input, vendors))].sort(compareCodePoints),
    heldBack: heldBack.sort(compareCodePoints),
  });
}
