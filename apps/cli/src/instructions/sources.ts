import { constants } from "node:fs";
import type { BigIntStats } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import {
  assertInstructionArtifactBounds,
  assertInstructionRelativePath,
  assertInstructionText,
  assertInstructionVendorBounds,
  assertNotWorkflowId,
  INSTRUCTION_BLOCK_BEGIN,
  INSTRUCTION_BLOCK_END,
  INSTRUCTION_BOUNDS_V1,
  InstructionCatalogInvalidError,
  InstructionSourceInvalidError,
  parseInstructionId,
  parseScopedRulePaths,
  sortUtf8,
  validateInstructionCatalog,
} from "@developer-os/core";
import type { InstructionCatalogV1, InstructionCategoryV1, InstructionIdV1 } from "@developer-os/core";
import { loadWorkflow } from "@developer-os/workflow-schema";
import type { WorkflowContractV1 } from "@developer-os/workflow-schema";


type Vendor = "claude" | "codex";
type SourceCategory = Exclude<InstructionCategoryV1, "command" | "vendor-file">;

export interface InstructionSourceFileV1 {
  readonly relativePath: string;
  readonly bytes: Uint8Array;
}

export interface InstructionSourceV1 {
  readonly category: SourceCategory;
  readonly id: InstructionIdV1;
  readonly source: "default" | "user";
  /** `SKILL.md` first for skills, then UTF-8 byte order; exactly one `<id>.md` otherwise. */
  readonly files: readonly InstructionSourceFileV1[];
  readonly thinCommand: boolean;
  readonly vendors: readonly Vendor[];
}

export interface InstructionSourceSetV1 {
  readonly vendor: Vendor;
  /** Sorted by `(category, id)`, after override merge. */
  readonly artifacts: readonly InstructionSourceV1[];
  /** `path` is relative to the product home (overrides) or the bundle (defaults). */
  readonly unsupported: readonly { readonly category: string; readonly id: string; readonly path: string }[];
}

export type InstructionDefaultsV1 = InstructionCatalogV1 & {
  /** Keyed by `artifactKey(category, id)`. */
  readonly files: ReadonlyMap<string, InstructionSourceFileV1[]>;
};

const DIRECTORY: Readonly<Record<SourceCategory, string>> = {
  rule: "rules",
  "scoped-rule": "scoped-rules",
  "output-style": "output-styles",
  agent: "agents",
  skill: "skills",
};
const CATEGORY_OF_DIRECTORY: ReadonlyMap<string, SourceCategory> = new Map(
  Object.entries(DIRECTORY).map(([category, directory]) => [directory, category as SourceCategory]),
);
const UNSUPPORTED: Readonly<Record<Vendor, ReadonlySet<SourceCategory>>> = {
  claude: new Set(),
  codex: new Set(["output-style"]),
};
const WORKFLOW_FILE = /^workflows\/([^/]+)\/workflow\.yaml$/;
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

export function artifactKey(category: SourceCategory, id: string): string {
  return `${category}/${id}`;
}

function compareArtifacts(left: InstructionSourceV1, right: InstructionSourceV1): number {
  if (left.category !== right.category) return left.category < right.category ? -1 : 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function orderFiles(category: SourceCategory, files: InstructionSourceFileV1[]): InstructionSourceFileV1[] {
  if (category !== "skill") return files;
  const ordered = sortUtf8(files, (file) => file.relativePath);
  return [...ordered.filter((file) => file.relativePath === "SKILL.md"), ...ordered.filter((file) => file.relativePath !== "SKILL.md")];
}

/** Rule text enters a marked block, where a marker would make the render throw instead of refusing. */
function assertNoBlockMarker(path: string, bytes: Uint8Array): void {
  const lines = strictUtf8.decode(bytes).split("\n");
  const index = lines.findIndex((line) => line.includes(INSTRUCTION_BLOCK_BEGIN) || line.includes(INSTRUCTION_BLOCK_END));
  if (index !== -1) throw new InstructionSourceInvalidError(path, index + 1);
}

/** The `foundation.md` §12.1 bounds checks shared by defaults and overrides; `where` names the artifact in a refusal. */
function assertArtifact(where: string, category: SourceCategory, files: readonly InstructionSourceFileV1[]): void {
  for (const file of files) {
    const path = `${where}/${file.relativePath}`;
    assertInstructionRelativePath(file.relativePath);
    assertInstructionText(path, file.bytes);
    if (category === "scoped-rule") parseScopedRulePaths(path, strictUtf8.decode(file.bytes));
    if (category === "rule" || category === "scoped-rule") assertNoBlockMarker(path, file.bytes);
  }
  if (category === "skill" && !files.some((file) => file.relativePath === "SKILL.md")) {
    throw new InstructionSourceInvalidError(`${where}/SKILL.md`);
  }
  assertInstructionArtifactBounds(where, files.map((file) => file.bytes.byteLength));
}

/** What the loaders read from a release: an admitted keg (`AdmittedPackagedReleaseV1`) or the active bundle (K8). */
export interface ReleaseTreeV1 {
  readonly bundleRoot: string;
  readonly files: readonly { readonly relativePath: string }[];
  readonly readFile: (relativePath: string) => Promise<Uint8Array>;
}

/** `bundle/workflows/<name>/workflow.yaml`, read through the admitted release only. */
export async function loadReleaseWorkflows(release: ReleaseTreeV1): Promise<readonly WorkflowContractV1[]> {
  const prefix = `${release.bundleRoot}/`;
  const files = sortUtf8(
    release.files.filter((file) => file.relativePath.startsWith(prefix) && WORKFLOW_FILE.test(file.relativePath.slice(prefix.length))),
    (file) => file.relativePath,
  );
  const contracts: WorkflowContractV1[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = strictUtf8.decode(await release.readFile(file.relativePath));
    } catch (error) {
      if (error instanceof TypeError) throw new InstructionCatalogInvalidError();
      throw error;
    }
    // Error severity only: the shipped workflows are gated on errors (`canonical.test.ts`), so a
    // warning must not refuse every install.
    const result = loadWorkflow({ file: file.relativePath.slice(prefix.length), text });
    if (result.contract === null || result.errorCount > 0) throw new InstructionCatalogInvalidError();
    contracts.push(result.contract);
  }
  return contracts;
}

/** `bundle/instructions/`: the catalog and exactly the files its rows claim (`foundation.md` §12.1). */
export async function loadInstructionDefaults(
  release: ReleaseTreeV1,
  workflowIds: ReadonlySet<string>,
): Promise<InstructionDefaultsV1> {
  const root = `${release.bundleRoot}/instructions/`;
  const catalogPath = `${root}catalog.json`;
  const listed = release.files.filter((file) => file.relativePath.startsWith(root));
  if (!listed.some((file) => file.relativePath === catalogPath)) throw new InstructionCatalogInvalidError();

  let value: unknown;
  try {
    const bytes = await release.readFile(catalogPath);
    if (bytes.byteLength > INSTRUCTION_BOUNDS_V1.fileBytes) throw new InstructionCatalogInvalidError();
    value = JSON.parse(strictUtf8.decode(bytes));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) throw new InstructionCatalogInvalidError();
    throw error;
  }
  const catalog = validateInstructionCatalog(value, workflowIds);

  const unclaimed = new Set(listed.map((file) => file.relativePath).filter((path) => path !== catalogPath));
  const files = new Map<string, InstructionSourceFileV1[]>();
  for (const row of catalog.artifacts) {
    const where = `${root}${DIRECTORY[row.category]}/${row.id}`;
    const claimed =
      row.category === "skill"
        ? [...unclaimed].filter((path) => path.startsWith(`${where}/`))
        : unclaimed.has(`${where}.md`)
          ? [`${where}.md`]
          : [];
    if (claimed.length === 0) throw new InstructionCatalogInvalidError();
    const artifactFiles: InstructionSourceFileV1[] = [];
    for (const path of sortUtf8(claimed, (claimedPath) => claimedPath)) {
      unclaimed.delete(path);
      artifactFiles.push({
        relativePath: row.category === "skill" ? path.slice(where.length + 1) : `${row.id}.md`,
        bytes: await release.readFile(path),
      });
    }
    const ordered = orderFiles(row.category, artifactFiles);
    assertArtifact(where, row.category, ordered);
    files.set(artifactKey(row.category, row.id), ordered);
  }
  if (unclaimed.size > 0) throw new InstructionCatalogInvalidError();
  return { ...catalog, files };
}

function refuse(path: string, line: number | null = null): never {
  throw new InstructionSourceInvalidError(path, line);
}

async function lstatOrNull(path: string): Promise<BigIntStats | null> {
  try {
    return await nodeFs.lstat(path, { bigint: true });
  } catch (error) {
    if ((error as { readonly code?: unknown }).code === "ENOENT") return null;
    throw error;
  }
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function listDirectory(path: string, effectiveUid: number): Promise<readonly string[]> {
  const before = await lstatOrNull(path);
  if (before === null || !before.isDirectory() || before.uid !== BigInt(effectiveUid)) refuse(path);
  const entries = await nodeFs.readdir(path, { withFileTypes: true });
  const after = await lstatOrNull(path);
  if (after === null || !sameIdentity(before, after)) refuse(path);
  // Finder writes .DS_Store into any folder it opens; a regular one is never an artifact, so skip it.
  return sortUtf8(
    entries.filter((entry) => !(entry.name === ".DS_Store" && entry.isFile())).map((entry) => entry.name),
    (name) => name,
  );
}

/** No-follow open; the identity is checked before and after the read, and the size before it. */
async function readUserFile(path: string, listed: BigIntStats, effectiveUid: number): Promise<Uint8Array> {
  if (!listed.isFile() || listed.nlink !== 1n || listed.uid !== BigInt(effectiveUid)) refuse(path);
  let handle: nodeFs.FileHandle;
  try {
    handle = await nodeFs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    refuse(path);
  }
  try {
    const opened = await handle.stat({ bigint: true });
    if (
      !opened.isFile() ||
      !sameIdentity(opened, listed) ||
      opened.nlink !== 1n ||
      opened.uid !== BigInt(effectiveUid) ||
      opened.size > BigInt(INSTRUCTION_BOUNDS_V1.fileBytes)
    ) {
      refuse(path);
    }
    const bytes = await handle.readFile();
    const fresh = await lstatOrNull(path);
    if (fresh === null || !sameIdentity(fresh, opened) || bytes.byteLength !== Number(opened.size) || fresh.size !== opened.size) {
      refuse(path);
    }
    return new Uint8Array(bytes);
  } finally {
    await handle.close();
  }
}

async function readSkillTree(
  directory: string,
  relative: string,
  effectiveUid: number,
  files: InstructionSourceFileV1[],
): Promise<void> {
  for (const name of await listDirectory(directory, effectiveUid)) {
    const path = join(directory, name);
    const relativePath = relative === "" ? name : `${relative}/${name}`;
    try {
      assertInstructionRelativePath(relativePath);
    } catch {
      refuse(path);
    }
    const stats = await lstatOrNull(path);
    if (stats === null) refuse(path);
    if (stats.isDirectory()) {
      await readSkillTree(path, relativePath, effectiveUid, files);
    } else {
      if (files.length >= INSTRUCTION_BOUNDS_V1.artifactFiles) refuse(path);
      files.push({ relativePath, bytes: await readUserFile(path, stats, effectiveUid) });
    }
  }
}

function overrideId(path: string, name: string, workflowIds: ReadonlySet<string>): InstructionIdV1 {
  try {
    const id = parseInstructionId(name);
    assertNotWorkflowId(id, workflowIds);
    return id;
  } catch {
    refuse(path);
  }
}

/** `<P>/instructions/<vendor>/`: the category is the directory, the id the file or directory name (`foundation.md` §12.1). */
export async function loadInstructionOverrides(input: {
  readonly productHome: string;
  readonly vendor: Vendor;
  readonly effectiveUid: number;
  readonly workflowIds: ReadonlySet<string>;
}): Promise<readonly InstructionSourceV1[]> {
  const base = join(input.productHome, "instructions");
  if ((await lstatOrNull(base)) === null) return [];
  await listDirectory(base, input.effectiveUid);
  const vendorRoot = join(base, input.vendor);
  if ((await lstatOrNull(vendorRoot)) === null) return [];

  const overrides: InstructionSourceV1[] = [];
  for (const directoryName of await listDirectory(vendorRoot, input.effectiveUid)) {
    const categoryRoot = join(vendorRoot, directoryName);
    const category = CATEGORY_OF_DIRECTORY.get(directoryName);
    if (category === undefined) refuse(categoryRoot);
    for (const name of await listDirectory(categoryRoot, input.effectiveUid)) {
      const path = join(categoryRoot, name);
      const stats = await lstatOrNull(path);
      if (stats === null) refuse(path);
      let id: InstructionIdV1;
      const files: InstructionSourceFileV1[] = [];
      if (category === "skill") {
        id = overrideId(path, name, input.workflowIds);
        if (!stats.isDirectory()) refuse(path);
        await readSkillTree(path, "", input.effectiveUid, files);
      } else {
        if (!name.endsWith(".md")) refuse(path);
        id = overrideId(path, name.slice(0, -".md".length), input.workflowIds);
        files.push({ relativePath: name, bytes: await readUserFile(path, stats, input.effectiveUid) });
      }
      const ordered = orderFiles(category, files);
      assertArtifact(category === "skill" ? path : categoryRoot, category, ordered);
      overrides.push({ category, id, source: "user", files: ordered, thinCommand: false, vendors: [input.vendor] });
    }
  }
  return overrides.sort(compareArtifacts);
}

function artifactPath(source: "default" | "user", vendor: Vendor, category: SourceCategory, id: string): string {
  const tail = `${DIRECTORY[category]}/${id}${category === "skill" ? "" : ".md"}`;
  return source === "user" ? `instructions/${vendor}/${tail}` : `instructions/${tail}`;
}

/**
 * An override replaces the default with its `(category, id)` on this vendor, a skill as a whole
 * directory. A replaced skill keeps the default's `thinCommand`: the command only invokes the skill
 * by id, which the override still provides.
 */
export function mergeInstructionSources(
  vendor: Vendor,
  defaults: InstructionDefaultsV1,
  overrides: readonly InstructionSourceV1[],
): InstructionSourceSetV1 {
  const merged = new Map<string, InstructionSourceV1>();
  for (const row of defaults.artifacts) {
    if (!row.vendors.includes(vendor)) continue;
    const files = defaults.files.get(artifactKey(row.category, row.id));
    if (files === undefined) throw new InstructionCatalogInvalidError();
    merged.set(artifactKey(row.category, row.id), {
      category: row.category,
      id: row.id,
      source: "default",
      files,
      thinCommand: row.thinCommand,
      vendors: [vendor],
    });
  }
  for (const override of overrides) {
    const key = artifactKey(override.category, override.id);
    const replaced = merged.get(key);
    merged.set(key, { ...override, thinCommand: replaced?.thinCommand ?? false, vendors: [vendor] });
  }

  const artifacts: InstructionSourceV1[] = [];
  const unsupported: { category: string; id: string; path: string }[] = [];
  for (const artifact of [...merged.values()].sort(compareArtifacts)) {
    if (UNSUPPORTED[vendor].has(artifact.category)) {
      unsupported.push({
        category: artifact.category,
        id: artifact.id,
        path: artifactPath(artifact.source, vendor, artifact.category, artifact.id),
      });
    } else {
      artifacts.push(artifact);
    }
  }
  assertInstructionVendorBounds(
    `instructions/${vendor}`,
    artifacts.map((artifact) => artifact.files.reduce((sum, file) => sum + file.bytes.byteLength, 0)),
  );
  return { vendor, artifacts, unsupported };
}
