#!/usr/bin/env node

/**
 * Fails the lint gate on any reference to the founder's legacy runtime outside
 * the documents that exist to describe it, and on any filesystem identity
 * rendered through a JavaScript number. See `self-containment.ts` for the first
 * rule and why each of its allowlist entries is there.
 */

import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { inspectPlannerGraph } from "@developer-os/security";

import { codeWithoutLiterals } from "../helpers/typescript-lexer.js";

import {
  candidateFiles,
  describeOptInAuthorityProblems,
  git,
  inspectOptInAuthoritySurfaces,
} from "./opt-in-authority.js";
import {
  describeViolation,
  findViolations,
  isProbablyText,
} from "./self-containment.js";
import type { Violation } from "./self-containment.js";

/**
 * Asked of `git` rather than derived from this module's own location. The
 * previous version counted directories up from `tests/dist/repository/`, which
 * silently retargeted a parent directory whenever the build layout moved — and
 * a root one level too high still looks like a valid repository.
 */
async function repositoryRoot(): Promise<string> {
  return (await git(["rev-parse", "--show-toplevel"], process.cwd())).trim();
}

/**
 * Spec 1 §2.4: JavaScript safe integers are not a filesystem-identity encoding.
 * `lstat` without `{ bigint: true }` hands back `ino` as a number, and an APFS
 * inode exceeds 2^53 — `/tmp` measured 1152921500312571551 on 2026-09-18, where
 * the spacing between representable numbers is 128 — so rendering one through
 * `String(...)` collapses up to 128 distinct inodes onto one recorded identity.
 * Every identity is read from `{ bigint: true }` stats and rendered with
 * `.toString(10)`, which is exact at every magnitude.
 *
 * The spelling is banned rather than the lossy call, because `String(x.ino)`
 * reads identically whether `x` is `Stats` or `BigIntStats`: a reader cannot
 * tell a correct site from a broken one, and both encodings coexisted in shipped
 * code until D31 (2026-09-18).
 */
const IDENTITY_RENDERING = /\bString\(\s*[A-Za-z_$][A-Za-z0-9_$.?[\]]*\.(?:ino|dev)\s*\)/gu;

/**
 * No file is exempt, including the approved encoder in
 * `packages/core/src/lifecycle/guarded-fs.ts`: it renders through
 * `.toString(10)` and so has nothing to exempt, and the file that defines the
 * encoding is the worst possible place for this rule to be blind.
 *
 * Comments and literal bodies are blanked first, so prose quoting the banned
 * spelling — including this file's own rule — is not an offender.
 */
function findIdentityRenderings(
  path: string,
  content: string,
): readonly Violation[] {
  if (!path.endsWith(".ts")) return [];
  if (!content.includes("String(")) return [];

  const violations: Violation[] = [];
  codeWithoutLiterals(content)
    .split("\n")
    .forEach((text, index) => {
      IDENTITY_RENDERING.lastIndex = 0;
      for (const match of text.matchAll(IDENTITY_RENDERING)) {
        violations.push({ path, line: index + 1, match: match[0] });
      }
    });
  return violations;
}

/**
 * The companion the rule above needs, because a spelling is not the defect.
 * A call that keeps a number-valued stat and writes `stats.ino.toString(10)`
 * loses exactly as much, compiles clean, and reads identically to the approved
 * encoder — which is the idiom a reader will copy. `` `${stats.ino}` `` and
 * `const { ino } = stats` are the same class. Requiring the option at the call
 * makes a number-valued identity *unreachable* instead of merely unspelled, so
 * all four shapes close without parsing expressions.
 *
 * Scope: a module whose *code* names `dev` or `ino`, excluding test files. A
 * module that names neither cannot record an identity, and requiring the option
 * there would mean ~100 exemptions for `isFile()`, `mode` and `mtime` reads. The
 * bare identifier rather than `.dev`/`.ino` is what admits the destructured
 * form, and the scope is read from the blanked code so that the dozen modules
 * which only *discuss* `dev`/`ino` in a comment stay out of it. Test files are
 * excluded because they stat for existence and mode far more often than for
 * identity; they are held instead by the rendering rule and by the requirement
 * that a test's expected identity come from the production recording rather
 * than from its own `lstat`.
 *
 * Residual: a module that stats and hands the whole `Stats` object to an
 * identity recorder elsewhere names neither `dev` nor `ino` itself, so this
 * scope misses it. Closed today only because every identity-consuming helper
 * (`apps/cli/src/bootstrap/context.ts`, `journal-store.ts`, `retention.ts`)
 * declares `BigIntStats`, so `tsc` rejects a number-valued stat at the call
 * site; a future helper typed `Stats` would reopen it.
 */
const STAT_CALL = /\.(?:lstat|fstat|stat)\(/gu;

const IDENTITY_FIELD = /\b(?:dev|ino)\b/u;

/** A forwarded options argument, which carries whatever the caller asked for. */
const FORWARDED_OPTIONS = /\b(?:options|parameters)\b/u;

/**
 * The lifecycle guarded port's `lstat` takes a path and nothing else, and
 * returns an already-exact decimal identity, so these callers cannot pass
 * the option and have nothing to gain from it. The exemption covers only a
 * call whose receiver is the port, spelled `fs` in every one of them: a direct
 * `nodeFs.lstat` in the same file still needs the option (NEW-90), because a
 * file-wide exemption let `stats.ino.toString(10)` on a number-valued stat
 * through both halves of the guard.
 */
const STAT_OPTION_EXEMPT: readonly string[] = [
  "packages/core/src/lifecycle/testing.ts",
  "packages/core/src/lifecycle/allocator.ts",
  "packages/core/src/lifecycle/absent-manifest.ts",
  "packages/core/src/lifecycle/foundation-participant.ts",
  "packages/core/src/lifecycle/foundation-compaction.ts",
  "packages/core/src/lifecycle/coordinator.ts",
  "packages/security/src/update/scratch.ts",
  "packages/core/src/git/metadata.ts",
  "packages/core/src/git/scope.ts",
  "packages/core/src/git/planner.ts",
  "apps/cli/src/update/construction.ts",
  "packages/core/src/git/effects.ts",
  "apps/cli/src/update/state-participant.ts",
  "apps/cli/src/update/bundle-source.ts",
  "apps/cli/src/update/bundle-publication.ts",
  "apps/cli/src/update/rollback-source.ts",
  "apps/cli/src/update/rollback-publication.ts",
  "apps/cli/src/update/recovery.ts",
  "apps/cli/src/update/foundation-port.ts",
];

const GUARDED_PORT_RECEIVER = /(?:^|[^A-Za-z0-9_$])fs$/u;

/** Modules that also hold `context.fs`, the CLI's own filesystem, exempt only the receiver `lifecycle.fs`. */
const LIFECYCLE_PORT_RECEIVER_ONLY: ReadonlyMap<string, RegExp> = new Map([
  ["apps/cli/src/update/apply-ports.ts", /(?:^|[^A-Za-z0-9_$.])lifecycle\.fs$/u],
]);

/**
 * A single call may opt out where the option would change what it reads: on
 * `BigIntStats` the time fields are whole milliseconds, so a call that wants
 * `mtimeMs`'s fraction has to stay on `Stats`. The marker carries its reason at
 * the call rather than in a table here, because a table of `path:line` entries
 * goes stale on the first edit above it.
 */
const IDENTITY_FREE_MARKER = "identity-free stat:";

/** The argument text of a call whose `(` is at `open`, or null when unbalanced. */
function callArguments(code: string, open: number): string | null {
  let depth = 0;
  for (let at = open; at < code.length; at += 1) {
    if (code[at] === "(") depth += 1;
    else if (code[at] === ")") {
      depth -= 1;
      if (depth === 0) return code.slice(open + 1, at);
    }
  }
  return null;
}

function findNumberValuedStats(
  path: string,
  content: string,
): readonly Violation[] {
  if (!path.endsWith(".ts") || path.endsWith(".test.ts")) return [];
  const portReceiver = LIFECYCLE_PORT_RECEIVER_ONLY.get(path) ?? (STAT_OPTION_EXEMPT.includes(path) ? GUARDED_PORT_RECEIVER : null);

  const code = codeWithoutLiterals(content);
  if (!IDENTITY_FIELD.test(code)) return [];

  const lines = content.split("\n");
  const violations: Violation[] = [];
  STAT_CALL.lastIndex = 0;
  for (const match of code.matchAll(STAT_CALL)) {
    const args = callArguments(code, match.index + match[0].length - 1);
    if (args === null) continue;
    if (portReceiver?.test(code.slice(Math.max(0, match.index - 16), match.index)) === true) continue;
    if (args.includes("bigint") || FORWARDED_OPTIONS.test(args)) continue;
    const line = code.slice(0, match.index).split("\n").length;
    const marked = lines
      .slice(Math.max(0, line - 8), line)
      .some((text) => text.includes(IDENTITY_FREE_MARKER));
    if (marked) continue;
    violations.push({
      path,
      line,
      match: `${match[0]}${args.trim()})`,
    });
  }
  return violations;
}

/**
 * Spec 2 §2's capability-absence gate. No shipped planner bundle exists yet, so the entry
 * list is the compiled protocol module every target planner imports plus the owner and
 * migration planners a bundle composes; the bundle's own planner entrypoint joins it when the
 * release packer produces one. `lint` builds before this runs, so a missing entrypoint is a
 * failure, never a skip.
 */
const PLANNER_ENTRYPOINTS: readonly string[] = [
  "packages/core/dist/update/planner.js",
  "packages/adapter-claude/dist/update/plan.js",
  "packages/adapter-codex/dist/update/plan.js",
  "packages/brain/dist/migrations/update/plan.js",
];

function findPlannerCapabilities(root: string): readonly string[] {
  const problems: string[] = [];
  const relative = (path: string): string => (path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path);
  for (const entrypoint of PLANNER_ENTRYPOINTS) {
    const graph = inspectPlannerGraph(join(root, entrypoint));
    if (graph.modules.length === 0) problems.push(`${entrypoint}: the compiled graph is empty or missing`);
    for (const finding of graph.forbidden) {
      problems.push(`${entrypoint}: ${relative(finding.module)}: ${finding.capability} (${finding.evidence})`);
    }
  }
  return problems;
}

/**
 * Spec 2 §12's "network remains explicit" row, as a total classifier (D72 P7(f)): the release
 * transport is the only product module that can reach a network, only the update context composes
 * it, the launcher execs a release from its own entrypoints, and every planner graph is non-empty.
 * `node:net` is not listed: the Git gateway's Unix-domain socket is classified by
 * `tests/security/network.test.ts`, which also proves the socket never leaves the host.
 */
export const RELEASE_NETWORK_ENTRYPOINTS: readonly string[] = ["packages/security/src/update/transport.ts"];
export const RELEASE_TRANSPORT_COMPOSITION: readonly string[] = ["apps/cli/src/update/context.ts"];

const REMOTE_NETWORK_MODULE =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'](?:node:)?(?:https?|http2|tls|dns|dgram|undici)(?:\/[a-z]+)?["']/u;
const GLOBAL_FETCH = /(?<![.\w$])fetch\s*\(|(?<![.\w$])(?:globalThis|self|window)\.fetch\s*\(/u;
const TRANSPORT_COMPOSER = /\b(?:nodeReleaseExchange|FixedReleaseTransport)\b/u;
const LAUNCHER_EXEC = /\bexecAdmittedRelease\b/u;
const PRODUCT_SOURCE = /^(?:packages|apps)\/[^/]+\/src\/.*\.ts$/u;
/** The transport's own module and the package barrels that re-export it name the composer without composing it. */
const TRANSPORT_DEFINITION = /^packages\/security\/src\/(?:update\/(?:transport|index)|index)\.ts$/u;

export interface ReleaseAuthorityReportV1 {
  /** Product modules that import a remote network module or call the global `fetch`. */
  readonly networkEntrypoints: readonly string[];
  /** Product modules outside the transport's definition that compose the release transport. */
  readonly transportCompositions: readonly string[];
  /** Launcher modules that exec an admitted release. */
  readonly launcherEntrypoints: readonly string[];
  /** Each compiled planner entrypoint and the transitive module graph it reaches. */
  readonly plannerGraphs: readonly { readonly entrypoint: string; readonly modules: readonly string[] }[];
}

export async function inspectReleaseAuthoritySurfaces(root: string): Promise<ReleaseAuthorityReportV1> {
  const networkEntrypoints: string[] = [];
  const transportCompositions: string[] = [];
  const launcherEntrypoints: string[] = [];
  const sources = (await candidateFiles(root)).filter(
    (path) => PRODUCT_SOURCE.test(path) && !path.endsWith(".test.ts") && !path.endsWith(".d.ts"),
  );
  for (const path of sources) {
    let content: string;
    try {
      content = await readFile(join(root, path), "utf8");
    } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }
    const code = codeWithoutLiterals(content);
    if (REMOTE_NETWORK_MODULE.test(content) || GLOBAL_FETCH.test(code)) networkEntrypoints.push(path);
    if (!TRANSPORT_DEFINITION.test(path) && TRANSPORT_COMPOSER.test(code)) transportCompositions.push(path);
    if (path.startsWith("apps/launcher/src/") && LAUNCHER_EXEC.test(code)) launcherEntrypoints.push(path);
  }
  const relative = (path: string): string => (path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path);
  const plannerGraphs = PLANNER_ENTRYPOINTS.map((entrypoint) => ({
    entrypoint,
    modules: inspectPlannerGraph(join(root, entrypoint)).modules.map(relative),
  }));
  return { networkEntrypoints, transportCompositions, launcherEntrypoints, plannerGraphs };
}

/** The lint gate's reading: every scope non-empty, and exactly the allowlisted network and transport sites. */
export function describeReleaseAuthorityProblems(report: ReleaseAuthorityReportV1): readonly string[] {
  const problems: string[] = [];
  if (report.networkEntrypoints.length === 0) problems.push("no module reaches the release transport's network");
  for (const path of report.networkEntrypoints) {
    if (!RELEASE_NETWORK_ENTRYPOINTS.includes(path)) problems.push(`unexpected network entrypoint: ${path}`);
  }
  if (report.transportCompositions.length === 0) problems.push("no module composes the release transport");
  for (const path of report.transportCompositions) {
    if (!RELEASE_TRANSPORT_COMPOSITION.includes(path)) problems.push(`unexpected release transport composition: ${path}`);
  }
  if (report.launcherEntrypoints.length === 0) problems.push("no launcher module execs an admitted release");
  for (const graph of report.plannerGraphs) {
    if (graph.modules.length === 0) problems.push(`the planner graph of ${graph.entrypoint} is empty`);
  }
  return problems;
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "EISDIR")
  );
}

async function main(): Promise<number> {
  let root: string;
  let files: readonly string[];
  try {
    root = await repositoryRoot();
    files = await candidateFiles(root);
  } catch {
    process.stderr.write(
      "self-containment: could not list repository files; is this a git checkout?\n",
    );
    return 1;
  }

  const violations: Violation[] = [];
  const renderings: Violation[] = [];
  const numberValued: Violation[] = [];
  const unreadable: string[] = [];

  for (const path of files) {
    let content: string;
    try {
      /**
       * `join`, never a `file://` URL. Splicing a path into a URL string made
       * `#` and `?` truncate it, `%NN` decode, and `\` normalise — so a file
       * named `issue#12.ts` was skipped, and a checkout under a directory
       * containing `#` skipped *every* file and still exited 0.
       */
      content = await readFile(join(root, path), "utf8");
    } catch (error) {
      /**
       * Deleted from the working tree but still indexed, or a directory entry
       * from a submodule. Anything else is a file this rule was supposed to read
       * and could not, which must fail rather than pass quietly.
       */
      if (isMissing(error)) continue;
      unreadable.push(path);
      continue;
    }
    if (!isProbablyText(content)) continue;
    violations.push(...findViolations(path, content));
    renderings.push(...findIdentityRenderings(path, content));
    numberValued.push(...findNumberValuedStats(path, content));
  }

  if (unreadable.length > 0) {
    process.stderr.write(
      `self-containment: ${String(unreadable.length)} file(s) could not be read, so the rule could not be applied to them\n`,
    );
    for (const path of unreadable) process.stderr.write(`  ${path}\n`);
  }

  if (violations.length > 0) {
    process.stderr.write(
      `self-containment: ${String(violations.length)} reference(s) to the legacy runtime outside the allowed documents\n`,
    );
    for (const violation of violations) {
      process.stderr.write(`  ${describeViolation(violation)}\n`);
    }
    process.stderr.write(
      "\nProgram Task 0 froze what the build needs into docs/migration/.\n" +
        "A missing legacy fact is a gap there or in the design spec, not a reason to read a real machine.\n",
    );
  }

  if (renderings.length > 0) {
    process.stderr.write(
      `identity-encoding: ${String(renderings.length)} filesystem identity/identities rendered through a JavaScript number\n`,
    );
    for (const rendering of renderings) {
      process.stderr.write(
        `  ${rendering.path}:${String(rendering.line)}: ${rendering.match}\n`,
      );
    }
    process.stderr.write(
      "\nRead the stats with { bigint: true } and render the field with .toString(10).\n" +
        "An APFS inode exceeds 2^53, so a number-valued ino collapses up to 128 distinct inodes onto one identity.\n",
    );
  }

  if (numberValued.length > 0) {
    process.stderr.write(
      `identity-encoding: ${String(numberValued.length)} stat call(s) in identity-recording modules return number-valued fields\n`,
    );
    for (const call of numberValued) {
      process.stderr.write(`  ${call.path}:${String(call.line)}: ${call.match}\n`);
    }
    process.stderr.write(
      "\nPass { bigint: true }. A module that records or compares dev/ino may not read a stat that cannot represent one.\n",
    );
  }

  const authority = describeOptInAuthorityProblems(await inspectOptInAuthoritySurfaces(root));
  if (authority.length > 0) {
    process.stderr.write(
      `opt-in-authority: ${String(authority.length)} problem(s) with the Git, launchd and scheduled authority surfaces\n`,
    );
    for (const problem of authority) process.stderr.write(`  ${problem}\n`);
    process.stderr.write(
      "\nA new process spawn is new authority: route it through an existing entrypoint, or add it to\n" +
        "ALLOWED_SPAWN_SITES (a raw spawn) or ALLOWED_SUPERVISED_SITES (the supervised primitive) in\n" +
        "tests/repository/opt-in-authority.ts in a reviewed change.\n",
    );
  }

  const capabilities = findPlannerCapabilities(root);
  if (capabilities.length > 0) {
    process.stderr.write(
      `planner-graph: ${String(capabilities.length)} capability finding(s) in the target planner graph\n`,
    );
    for (const problem of capabilities) process.stderr.write(`  ${problem}\n`);
    process.stderr.write(
      "\nThe target planner may reach no filesystem, network, process, environment, clock, randomness,\n" +
        "native addon, worker, or dynamic import. Move the capability to the current process and pass its result in the request.\n",
    );
  }

  const release = describeReleaseAuthorityProblems(await inspectReleaseAuthoritySurfaces(root));
  if (release.length > 0) {
    process.stderr.write(
      `release-authority: ${String(release.length)} problem(s) with the network, transport, launcher and planner scopes\n`,
    );
    for (const problem of release) process.stderr.write(`  ${problem}\n`);
    process.stderr.write(
      "\nOnly `update` plan and apply reach a network, through packages/security/src/update/transport.ts composed in\n" +
        "apps/cli/src/update/context.ts. A new network path is a threat-model change, not a lint fix.\n",
    );
  }

  return violations.length > 0 ||
    authority.length > 0 ||
    release.length > 0 ||
    capabilities.length > 0 ||
    renderings.length > 0 ||
    numberValued.length > 0 ||
    unreadable.length > 0
    ? 1
    : 0;
}

// Imported by `check.test.ts` for the enumerators; only the lint gate's own invocation runs it.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main();
}
