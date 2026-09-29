import { join, relative, sep } from "node:path";

import { compareCanonical, compareRawBytes } from "../discovery/index.js";
import { buildIndex, createLinkResolver } from "../indexes/index.js";
import type { IndexBuildRequest, IndexBuildResult, IndexedNote } from "../indexes/index.js";
import { isUnsafeProposedNotePath } from "../ingest/index.js";
import { lintBuild } from "../lint/index.js";
import type { LintFinding } from "../lint/index.js";
import { parseNote } from "../schema/note.js";
import { rewriteWikilinks, withoutAnchor } from "./links.js";
import { planMerge } from "./merge.js";
import { planSplit } from "./split.js";
import { overlayBuildRequest } from "./vault.js";

export type RefactorModeV1 = "retire" | "rename" | "move" | "merge" | "split";

export type RefactorRequestV1 =
  | { readonly mode: "retire"; readonly note: string }
  | { readonly mode: "rename"; readonly note: string; readonly newName: string }
  | { readonly mode: "move"; readonly note: string; readonly folder: string }
  | { readonly mode: "merge"; readonly source: string; readonly target: string }
  | { readonly mode: "split"; readonly note: string; readonly heading: string };

export interface RefactorMutationV1 {
  readonly operation: "create" | "replace" | "remove";
  /** Content-root-relative, byte-exact. */
  readonly path: string;
  /** `null` for remove. */
  readonly content: string | null;
  /** Bytes read in step 1, for replace/remove; `null` for create. */
  readonly before: string | null;
}

export interface RefactorPlanV1 {
  readonly mode: RefactorModeV1;
  /** Sorted: `compareCanonical(path) || compareRawBytes(path)`. */
  readonly mutations: readonly RefactorMutationV1[];
  readonly rewrittenLinks: number;
}

export type RefactorRefusalCodeV1 =
  | "brain_refactor_input_invalid"
  | "refactor_destination_exists"
  | "retire_has_referrers"
  | "refactor_postcondition_failed"
  | "refactor_too_wide";

export class RefactorRefusal extends Error {
  // `reason`, not `code`: in this codebase `code` is the numeric ExitCode (see V2HomeAdmissionError).
  readonly reason: RefactorRefusalCodeV1;
  readonly paths: readonly string[];

  constructor(reason: RefactorRefusalCodeV1, message: string, paths: readonly string[]) {
    super(message);
    this.name = "RefactorRefusal";
    this.reason = reason;
    this.paths = [...paths];
  }
}

/** The executor's participant bound (`brain.md` §6.13, refactor algorithm). */
export const MAX_REFACTOR_MUTATIONS = 256;

export interface RefactorInputV1 {
  readonly build: IndexBuildRequest;
  /** `YYYY-MM-DD`. */
  readonly today: string;
}

export interface PreStateV1 {
  readonly build: IndexBuildResult;
  /** Keyed by vault-relative NFC path (`content/DEV/a.md`), as `IndexedNote.path` is. */
  readonly files: ReadonlyMap<string, string>;
  readonly contentRoot: string;
  readonly input: RefactorInputV1;
}

/** Internal to the package, shared with merge/split. */
export interface ModePlanV1 {
  /** Old content-root path → new (retire: to `_graveyard/…`). */
  readonly moves: ReadonlyMap<string, string>;
  readonly changes: readonly RefactorMutationV1[];
  /** Split's parent→child, content-root-relative. */
  readonly extraEdges: readonly (readonly [string, string])[];
  /**
   * Split only: edges that may appear or vanish because link occurrences moved
   * between notes (the section's own links, and anchored referrer links).
   */
  readonly edgeSlack?: readonly (readonly [string, string])[];
  readonly rewrittenLinks: number;
}

export const GRAVEYARD = "_graveyard";

export function byPath(a: string, b: string): number {
  return compareCanonical(a, b) || compareRawBytes(a, b);
}

export function inVault(state: PreStateV1, path: string): string {
  return `${state.contentRoot}/${path}`;
}

export function fromVault(state: PreStateV1, vaultPath: string): string {
  const prefix = `${state.contentRoot}/`;
  return vaultPath.startsWith(prefix) ? vaultPath.slice(prefix.length) : vaultPath;
}

function absoluteOf(input: RefactorInputV1, path: string): string {
  return join(input.build.vaultRoot, input.build.config.contentRoot, path);
}

export function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function withoutMd(path: string): string {
  return path.endsWith(".md") ? path.slice(0, -".md".length) : path;
}

export function invalid(message: string, paths: readonly string[] = []): RefactorRefusal {
  return new RefactorRefusal("brain_refactor_input_invalid", message, paths);
}

async function readPreState(input: RefactorInputV1): Promise<PreStateV1> {
  const files = new Map<string, string>();
  const { vaultRoot } = input.build;
  const build = await buildIndex({
    ...input.build,
    readFile: async (path: string) => {
      const text = await input.build.readFile(path);
      files.set(relative(vaultRoot, path).split(sep).join("/").normalize("NFC"), text);
      return text;
    },
  });
  return { build, files, contentRoot: input.build.config.contentRoot.normalize("NFC"), input };
}

function noteAt(state: PreStateV1, path: string): IndexedNote | undefined {
  const vaultPath = inVault(state, path);
  return state.build.index.notes.find((note) => note.path === vaultPath);
}

export function bytesOf(state: PreStateV1, path: string): string {
  const text = state.files.get(inVault(state, path));
  if (text === undefined) throw invalid(`${path} was not read`, [path]);
  return text;
}

export function requireNote(state: PreStateV1, path: string): IndexedNote {
  const note = noteAt(state, path);
  if (note === undefined) throw invalid(`${path} is not a canonical note`, [path]);
  return note;
}

/**
 * Rewrites every link in another note whose old resolution is `moved` and whose
 * text no longer reaches `target` once `moved` is gone (`brain.md` §6.13, link
 * rewriting). Title- and alias-tier links keep resolving and are left alone.
 */
export function rewriteReferrers(
  state: PreStateV1,
  moved: string,
  target: string,
  dropAnchor: (tail: string) => boolean,
): { readonly changes: readonly RefactorMutationV1[]; readonly rewritten: number } {
  const P = inVault(state, moved);
  const T = inVault(state, target);
  const { notes } = state.build.index;
  const movedNote = notes.find((note) => note.path === P);

  const projected = notes.filter((note) => note.path !== P);
  if (movedNote !== undefined && !projected.some((note) => note.path === T)) {
    const folder = target.split("/")[0] ?? "";
    const topicFolder = state.input.build.config.topicFolders.includes(folder)
      ? folder
      : movedNote.topicFolder;
    projected.push({ ...movedNote, path: T, topicFolder });
  }
  projected.sort((a, b) => byPath(a.path, b.path));

  const before = createLinkResolver(notes, state.contentRoot);
  const after = createLinkResolver(projected, state.contentRoot);
  const afterWithoutTarget = createLinkResolver(
    projected.filter((note) => note.path !== T),
    state.contentRoot,
  );
  const short = withoutMd(basename(target));
  const text =
    after(short) === T && afterWithoutTarget(short) === null ? short : withoutMd(target);

  const referrers = [
    ...new Set(
      state.build.graph.edges
        .filter((edge) => edge.target === P && edge.source !== P)
        .map((edge) => edge.source),
    ),
  ].sort(byPath);

  const changes: RefactorMutationV1[] = [];
  let rewritten = 0;
  for (const referrer of referrers) {
    const path = fromVault(state, referrer);
    const source = bytesOf(state, path);
    const parsed = parseNote(source);
    if (!parsed.ok) continue;
    const out = rewriteWikilinks(parsed.note.body, (occurrence) => {
      const written = occurrence.text.trim();
      if (before(written) !== P || after(written) === T) return null;
      const tail = dropAnchor(occurrence.tail) ? withoutAnchor(occurrence.tail) : occurrence.tail;
      return `[[${text}${tail}]]`;
    });
    if (out.rewritten === 0) continue;
    rewritten += out.rewritten;
    changes.push({
      operation: "replace",
      path,
      content: parsed.note.header + out.body,
      before: source,
    });
  }
  return { changes, rewritten };
}

function retirePlan(state: PreStateV1, note: string): ModePlanV1 {
  requireNote(state, note);
  const P = inVault(state, note);
  const cites = (source: string): boolean => {
    const s = source.normalize("NFC");
    return [s, `${s}.md`, `${state.contentRoot}/${s}`, `${state.contentRoot}/${s}.md`].includes(P);
  };
  const referrers = [
    ...new Set([
      ...state.build.graph.edges
        .filter((edge) => edge.target === P && edge.source !== P)
        .map((edge) => edge.source),
      ...state.build.index.notes
        .filter((other) => other.path !== P && other.sources.some(cites))
        .map((other) => other.path),
    ]),
  ]
    .map((path) => fromVault(state, path))
    .sort(byPath);
  if (referrers.length > 0) {
    throw new RefactorRefusal(
      "retire_has_referrers",
      `${note} is linked to or cited by ${String(referrers.length)} note(s); fold it into another note with brain refactor --merge instead`,
      referrers,
    );
  }

  const bytes = bytesOf(state, note);
  const grave = `${GRAVEYARD}/${note}`;
  return {
    moves: new Map([[note, grave]]),
    changes: [
      { operation: "remove", path: note, content: null, before: bytes },
      { operation: "create", path: grave, content: bytes, before: null },
    ],
    extraEdges: [],
    rewrittenLinks: 0,
  };
}

function relocatePlan(state: PreStateV1, note: string, target: string): ModePlanV1 {
  const bytes = bytesOf(state, note);
  const referrers = rewriteReferrers(state, note, target, () => false);
  return {
    moves: new Map([[note, target]]),
    changes: [
      { operation: "remove", path: note, content: null, before: bytes },
      { operation: "create", path: target, content: bytes, before: null },
      ...referrers.changes,
    ],
    extraEdges: [],
    rewrittenLinks: referrers.rewritten,
  };
}

function modePlan(state: PreStateV1, request: RefactorRequestV1): ModePlanV1 {
  switch (request.mode) {
    case "retire":
      return retirePlan(state, request.note);
    case "rename": {
      requireNote(state, request.note);
      if (request.newName.includes("/") || isUnsafeProposedNotePath(request.newName)) {
        throw invalid(`${request.newName} is not a single note file name ending .md`);
      }
      const dir = dirname(request.note);
      return relocatePlan(
        state,
        request.note,
        dir === "" ? request.newName : `${dir}/${request.newName}`,
      );
    }
    case "move": {
      requireNote(state, request.note);
      if (!state.input.build.config.topicFolders.includes(request.folder)) {
        throw invalid(`${request.folder} is not a configured topic folder`);
      }
      return relocatePlan(state, request.note, `${request.folder}/${basename(request.note)}`);
    }
    case "merge":
      requireNote(state, request.source);
      requireNote(state, request.target);
      if (request.source === request.target) {
        throw invalid("a note cannot be merged into itself", [request.source]);
      }
      return planMerge(state, request.source, request.target);
    case "split":
      requireNote(state, request.note);
      return planSplit(state, request.note, request.heading);
  }
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}

function postconditionFailed(message: string, paths: readonly string[]): RefactorRefusal {
  return new RefactorRefusal("refactor_postcondition_failed", message, paths);
}

async function checkPostconditions(
  state: PreStateV1,
  plan: ModePlanV1,
  mutations: readonly RefactorMutationV1[],
): Promise<void> {
  const { input } = state;

  // (a) every created or replaced note parses cleanly.
  for (const mutation of mutations) {
    if (mutation.content === null) continue;
    const parsed = parseNote(mutation.content);
    if (!parsed.ok || parsed.issues.some((issue) => issue.severity === "error")) {
      throw postconditionFailed(`${mutation.path} would not parse as a note`, [mutation.path]);
    }
  }

  const overlay = new Map<string, string | null>(
    mutations.map((mutation) => [absoluteOf(input, mutation.path), mutation.content]),
  );
  const projectedRequest = overlayBuildRequest(input.build, overlay);
  const projected = await buildIndex(projectedRequest);

  const graveyard = inVault(state, `${GRAVEYARD}/`);
  const mapped = (vaultPath: string): string => {
    const moved = plan.moves.get(fromVault(state, vaultPath));
    return moved === undefined ? vaultPath : inVault(state, moved);
  };

  // (b) no new error finding, compared on (class, mapped path, key); index-drift excluded.
  const lintOf = async (build: IndexBuildResult, request: IndexBuildRequest) =>
    (
      await lintBuild(build, {
        build: request,
        readArtifact: () => Promise.resolve(null),
        today: input.today,
      })
    ).findings.filter((f) => f.severity === "error" && f.class !== "index-drift");
  const findingKey = (f: LintFinding, path: string): string =>
    JSON.stringify([f.class, path, f.key]);
  const preErrors = countBy(await lintOf(state.build, input.build), (f) =>
    findingKey(f, mapped(f.path)),
  );
  for (const f of await lintOf(projected, projectedRequest)) {
    const key = findingKey(f, f.path);
    const left = preErrors.get(key) ?? 0;
    if (left === 0) {
      throw postconditionFailed(
        `the refactor would add a ${f.class} error at ${fromVault(state, f.path)}: ${f.message}`,
        [fromVault(state, f.path)],
      );
    }
    preErrors.set(key, left - 1);
  }

  /**
   * (c) edges by (source, target), self-edges (after mapping) dropped. Counted as distinct
   * pairs, not the spec's multiset: `buildIndex` keeps one edge per distinct
   * link *text*, so `[[DEV/b]]` and `[[b]]` in one note are two edges before a
   * move and one after both rewrite to `[[b]]` — a multiset refuses that
   * ordinary refactor. A link lost outright still fails (b) as a `links` error.
   */
  const edgeKey = (source: string, target: string): string => JSON.stringify([source, target]);
  const preEdges: string[] = [];
  for (const edge of state.build.graph.edges) {
    const source = mapped(edge.source);
    const target = mapped(edge.target);
    // After mapping: a merge collapses S->T and T->S into T->T, a self-edge.
    if (source === target) continue;
    // A retired note leaves the index, and its outgoing edges with it.
    if (source.startsWith(graveyard) || target.startsWith(graveyard)) continue;
    preEdges.push(edgeKey(source, target));
  }
  for (const [source, target] of plan.extraEdges) {
    preEdges.push(edgeKey(inVault(state, source), inVault(state, target)));
  }
  const postEdges = projected.graph.edges
    .filter((edge) => edge.source !== edge.target)
    .map((edge) => edgeKey(edge.source, edge.target));
  const pre = new Set(preEdges);
  const post = new Set(postEdges);
  const slack = new Set(
    (plan.edgeSlack ?? []).map(([source, target]) =>
      edgeKey(inVault(state, source), inVault(state, target)),
    ),
  );
  for (const key of [...new Set([...pre, ...post])].sort(byPath)) {
    if (pre.has(key) === post.has(key) || slack.has(key)) continue;
    const [source, target] = (JSON.parse(key) as [string, string]).map((p) => fromVault(state, p)) as [
      string,
      string,
    ];
    throw postconditionFailed(
      `the link ${source} -> ${target} would be ${pre.has(key) ? "lost" : "added"}`,
      [source, target],
    );
  }
}

/**
 * Pure: reads through `input.build` and returns a plan, writing nothing
 * (`brain.md` §2). Every refusal is a `RefactorRefusal`.
 */
export async function planRefactor(
  request: RefactorRequestV1,
  input: RefactorInputV1,
): Promise<RefactorPlanV1> {
  const state = await readPreState(input);
  const plan = modePlan(state, request);

  for (const mutation of plan.changes) {
    if (mutation.operation !== "create") continue;
    if (state.files.has(inVault(state, mutation.path)) || noteAt(state, mutation.path) !== undefined) {
      throw new RefactorRefusal(
        "refactor_destination_exists",
        `${mutation.path} already exists`,
        [mutation.path],
      );
    }
  }

  const mutations = [...plan.changes].sort((a, b) => byPath(a.path, b.path));
  if (mutations.length > MAX_REFACTOR_MUTATIONS) {
    throw new RefactorRefusal(
      "refactor_too_wide",
      `the refactor needs ${String(mutations.length)} changes; at most ${String(MAX_REFACTOR_MUTATIONS)} fit one transaction`,
      [],
    );
  }

  await checkPostconditions(state, plan, mutations);
  return { mode: request.mode, mutations, rewrittenLinks: plan.rewrittenLinks };
}
