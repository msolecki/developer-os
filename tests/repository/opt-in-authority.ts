/**
 * Plan 1b Task 20's authority enumerators, over the same file set the rest of the lint gate
 * reads. Kept out of `check.ts` because that module runs its gate on import, and
 * `check.test.ts` needs this function against the real repository without running the gate.
 *
 * Everything is answered by the TypeScript parser and resolved through the import binding,
 * never a callee name: `RegExp.prototype.exec` and an injected `dependencies.spawn(...)` are
 * not process authority, and a text match on `spawn(` or `exec(` cannot tell them apart.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import ts from "typescript";

const runProcess = promisify(execFile);
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

export async function git(args: readonly string[], cwd: string): Promise<string> {
  const { stdout } = await runProcess("git", [...args], { cwd, maxBuffer: MAX_OUTPUT_BYTES });
  return stdout;
}

/**
 * Tracked files, plus untracked ones that `.gitignore` does not exclude.
 *
 * Tracked alone was wrong in the one case that matters: `git ls-files` reads the
 * index, so a newly written file is invisible until it is staged — and the
 * workflow runs lint *before* `git add`, which is exactly when a new violating
 * file exists and has never been staged. Including `--others
 * --exclude-standard` keeps the `.gitignore` agreement that made `git` the right
 * enumerator while closing that window.
 */
export async function candidateFiles(root: string): Promise<readonly string[]> {
  const [tracked, untracked] = await Promise.all([
    git(["ls-files", "-z"], root),
    git(["ls-files", "--others", "--exclude-standard", "-z"], root),
  ]);

  return [...new Set(`${tracked}${untracked}`.split("\0").filter((path) => path.length > 0))].sort();
}

export interface OptInAuthorityReportV1 {
  /** Files that construct a `GitProcessSupervisor`. */
  readonly gitEntrypoints: readonly string[];
  /** Files that name `/bin/launchctl` in code. */
  readonly launchdEntrypoints: readonly string[];
  /** Files that declare, build or dispatch `ScheduledJobHandlersV1`. */
  readonly scheduledEntrypoints: readonly string[];
  /** Any other process-spawn site in `packages/*\/src` and `apps/*\/src`, as `path::symbol`. */
  readonly unexpectedSpawnSites: readonly string[];
  /** The allowlisted sites this run observed, as `path::symbol`, so the list can be held exact. */
  readonly allowedSpawnSites: readonly string[];
}

/**
 * Today's fixed spawns, by the top-level symbol that holds the call. The plan's list named
 * the lockf and rename runners, `NodeProcessRunner`, the launcher and the Codex registration;
 * the registration has no spawn of its own (it runs `codex` through a `ProcessRunner`, which is
 * `NodeProcessRunner`), and the tree carries four more: the supervised-process primitive both
 * Git and launchd run on, Spec 2's planner child and its `ps` sampler, and the Git gateway's
 * receive-pack trampoline bridge.
 */
export const ALLOWED_SPAWN_SITES: readonly string[] = [
  "apps/cli/src/commands/git/runtime.ts::GitGatewayServer",
  "apps/launcher/src/handoff.ts::execAdmittedRelease",
  "apps/cli/src/commands/git/runtime.ts::GitGatewayServer",
  "apps/launcher/src/main.ts::execAdmittedRelease",
  "apps/launcher/src/main.ts::execAdmittedRelease",
  "packages/platform-macos/src/retained-rename.ts::SpawnRenameAtxRunner",
  "packages/platform-macos/src/transaction-lock.ts::SpawnLockfRunner",
  "packages/security/src/process.ts::NodeProcessRunner",
  "packages/security/src/supervised-process.ts::nodeSupervisedProcessDependencies",
  "packages/security/src/update/planner-process.ts::sampleNodePlannerProcess",
  "packages/security/src/update/planner-process.ts::spawnNodePlannerChild",
];

const CHILD_PROCESS_MODULES = new Set(["node:child_process", "child_process"]);

/**
 * The real-spawn dependency object of the supervised-process primitive. A reference to it is
 * a spawn authority as much as an import of `child_process` is, so outside its own module it
 * may appear only in a Git or launchd entrypoint.
 */
const SUPERVISED_SPAWN_AUTHORITY = "nodeSupervisedProcessDependencies";
const SUPERVISED_SPAWN_MODULE = "packages/security/src/supervised-process.ts";

const SOURCE = /^(?:packages|apps)\/[^/]+\/src\/.*\.ts$/u;

function isProductSource(path: string): boolean {
  return SOURCE.test(path) && !path.endsWith(".test.ts") && !path.endsWith(".d.ts");
}

function topLevelSymbol(node: ts.Node): string {
  let current: ts.Node = node;
  while (!ts.isSourceFile(current.parent)) current = current.parent;
  if ((ts.isFunctionDeclaration(current) || ts.isClassDeclaration(current)) && current.name !== undefined) {
    return current.name.text;
  }
  if (ts.isVariableStatement(current)) {
    const name = current.declarationList.declarations[0]?.name;
    if (name !== undefined && ts.isIdentifier(name)) return name.text;
  }
  return "<module>";
}

/** An identifier that only names a member or a re-export, rather than reading a binding. */
function isNameOnly(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isPropertyDeclaration(parent) && parent.name === node) ||
    (ts.isPropertySignature(parent) && parent.name === node) ||
    (ts.isMethodSignature(parent) && parent.name === node) ||
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent)
  );
}

interface FileFacts {
  readonly spawnSites: readonly string[];
  readonly supervisedSites: readonly string[];
  readonly constructsGitSupervisor: boolean;
  readonly namesLaunchctl: boolean;
  readonly namesScheduledHandlers: boolean;
}

function childProcessBindings(source: ts.SourceFile): ReadonlySet<string> {
  const bindings = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!CHILD_PROCESS_MODULES.has(statement.moduleSpecifier.text)) continue;
    const clause = statement.importClause;
    if (clause === undefined || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) continue;
    if (clause.name !== undefined) bindings.add(clause.name.text);
    const named = clause.namedBindings;
    if (named === undefined) continue;
    if (ts.isNamespaceImport(named)) {
      bindings.add(named.name.text);
      continue;
    }
    for (const element of named.elements) if (!element.isTypeOnly) bindings.add(element.name.text);
  }
  return bindings;
}

function isChildProcessLoad(node: ts.CallExpression): boolean {
  const [argument] = node.arguments;
  if (argument === undefined || !ts.isStringLiteralLike(argument) || !CHILD_PROCESS_MODULES.has(argument.text)) return false;
  return node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require");
}

export function inspectSourceFile(path: string, content: string): FileFacts {
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
  const bindings = childProcessBindings(source);
  const spawnSites = new Set<string>();
  const supervisedSites = new Set<string>();
  let constructsGitSupervisor = false;
  let namesLaunchctl = false;
  let namesScheduledHandlers = false;

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && !isNameOnly(node)) {
      if (bindings.has(node.text)) spawnSites.add(`${path}::${topLevelSymbol(node)}`);
      if (node.text === SUPERVISED_SPAWN_AUTHORITY && path !== SUPERVISED_SPAWN_MODULE) {
        supervisedSites.add(`${path}::${topLevelSymbol(node)}`);
      }
      if (node.text === "ScheduledJobHandlersV1") namesScheduledHandlers = true;
    }
    if (ts.isCallExpression(node) && isChildProcessLoad(node)) {
      spawnSites.add(`${path}::${topLevelSymbol(node)} (dynamic child_process load)`);
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "GitProcessSupervisor") {
      constructsGitSupervisor = true;
    }
    if (ts.isStringLiteralLike(node) && node.text === "/bin/launchctl") {
      namesLaunchctl = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return {
    spawnSites: [...spawnSites],
    supervisedSites: [...supervisedSites],
    constructsGitSupervisor,
    namesLaunchctl,
    namesScheduledHandlers,
  };
}

export async function inspectOptInAuthoritySurfaces(repositoryRoot: string): Promise<OptInAuthorityReportV1> {
  const gitEntrypoints: string[] = [];
  const launchdEntrypoints: string[] = [];
  const scheduledEntrypoints: string[] = [];
  const unexpected = new Set<string>();
  const allowed = new Set<string>();

  for (const path of (await candidateFiles(repositoryRoot)).filter(isProductSource)) {
    let content: string;
    try {
      content = await readFile(join(repositoryRoot, path), "utf8");
    } catch (error) {
      /** Deleted from the working tree but still indexed, or a submodule entry; anything else must fail the gate. */
      if (typeof error === "object" && error !== null && "code" in error && (error.code === "ENOENT" || error.code === "EISDIR")) continue;
      throw error;
    }
    const facts = inspectSourceFile(path, content);
    if (facts.constructsGitSupervisor) gitEntrypoints.push(path);
    if (facts.namesLaunchctl) launchdEntrypoints.push(path);
    if (facts.namesScheduledHandlers) scheduledEntrypoints.push(path);
    for (const site of facts.spawnSites) {
      if (ALLOWED_SPAWN_SITES.includes(site)) allowed.add(site);
      else unexpected.add(site);
    }
    const entrypoint = facts.constructsGitSupervisor || facts.namesLaunchctl;
    for (const site of facts.supervisedSites) if (!entrypoint) unexpected.add(`${site} (${SUPERVISED_SPAWN_AUTHORITY})`);
  }

  return {
    gitEntrypoints,
    launchdEntrypoints,
    scheduledEntrypoints,
    unexpectedSpawnSites: [...unexpected].sort(),
    allowedSpawnSites: [...allowed].sort(),
  };
}

/** The lint gate's reading of the report: every enumerator non-empty, and no stray site. */
export function describeOptInAuthorityProblems(report: OptInAuthorityReportV1): readonly string[] {
  const problems: string[] = [];
  if (report.gitEntrypoints.length === 0) problems.push("no file constructs a GitProcessSupervisor");
  if (report.launchdEntrypoints.length === 0) problems.push("no file names /bin/launchctl");
  if (report.scheduledEntrypoints.length === 0) problems.push("no file dispatches ScheduledJobHandlersV1");
  for (const site of report.unexpectedSpawnSites) problems.push(`unexpected spawn site: ${site}`);
  return problems;
}
