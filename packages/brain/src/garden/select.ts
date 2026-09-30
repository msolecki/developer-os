import { compareCanonical, compareRawBytes } from "../discovery/index.js";
import type { IndexedNote } from "../indexes/index.js";
import type { LintFinding } from "../lint/index.js";

export interface GardenTargetsV1 {
  readonly gaps: readonly { readonly tag: string; readonly notePaths: readonly string[] }[];
  /** Content-relative paths. */
  readonly isolated: readonly string[];
}

export const GARDEN_MAX_GAPS = 2;
export const GARDEN_MAX_ISOLATED = 5;
/** Stricter than lint's own `gap` threshold of 3 (spec §3.3 step 2). */
export const GARDEN_GAP_MIN_NOTES = 4;

/** The message `lint.ts` writes for a `gap` finding; the tag sits between the fixed phrases. */
const GAP_MESSAGE = /^\d+ notes share the tag (.*) and no compiled note covers it$/su;

/** `contentRoot` is one path segment, so the content-relative path is everything after the first. */
export function contentRelative(vaultPath: string): string {
  return vaultPath.slice(vaultPath.indexOf("/") + 1);
}

function byPath(a: string, b: string): number {
  return compareCanonical(a, b) || compareRawBytes(a, b);
}

/**
 * Controller ruling 2: gap targets are **derived from `notes`**; a lint `gap`
 * finding only confirms a tag, and only when the tag is recoverable from its
 * message. Lint screens and caps the tag it prints, so a tag carrying a control
 * character or an overlong name never matches and is not selected — fewer
 * targets, never a wrong one.
 */
export function selectGardenTargets(input: {
  readonly notes: readonly IndexedNote[];
  readonly findings: readonly LintFinding[];
  readonly pendingNotePaths: ReadonlySet<string>;
}): GardenTargetsV1 {
  const flagged = new Set<string>();
  for (const finding of input.findings) {
    if (finding.class !== "gap") continue;
    const tag = GAP_MESSAGE.exec(finding.message)?.[1];
    if (tag !== undefined) flagged.add(tag);
  }

  const byTag = new Map<string, string[]>();
  const covered = new Set<string>();
  for (const note of input.notes) {
    for (const tag of note.tags) {
      if (note.type === "compiled-note") covered.add(tag);
      const paths = byTag.get(tag);
      if (paths === undefined) byTag.set(tag, [note.path]);
      else paths.push(note.path);
    }
  }

  const gaps = [...byTag.entries()]
    .filter(([tag, paths]) => paths.length >= GARDEN_GAP_MIN_NOTES && !covered.has(tag) && flagged.has(tag))
    .sort(([a, left], [b, right]) => right.length - left.length || byPath(a, b))
    .slice(0, GARDEN_MAX_GAPS)
    .map(([tag, paths]) => ({ tag, notePaths: paths.map(contentRelative).sort(byPath) }));

  const created = new Map(input.notes.map((note) => [note.path, note.created]));
  const isolated = [
    ...new Set(
      input.findings
        .filter((finding) => finding.class === "isolated" && created.has(finding.path))
        .map((finding) => finding.path),
    ),
  ]
    .filter((path) => !input.pendingNotePaths.has(contentRelative(path)))
    .sort((a, b) => byPath(created.get(a) ?? "", created.get(b) ?? "") || byPath(a, b))
    .slice(0, GARDEN_MAX_ISOLATED)
    .map(contentRelative);

  return { gaps, isolated };
}
