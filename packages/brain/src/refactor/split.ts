import { screenAndCap } from "@developer-os/security";
import { stringify } from "yaml";

import { createLinkResolver, findWikilinks, maskCode } from "../indexes/index.js";
import { isUnsafeProposedNotePath } from "../ingest/index.js";
import { MAX_SUMMARY_LENGTH, parseNote, renderNote } from "../schema/note.js";
import { rewriteWikilinks, withoutAnchor } from "./links.js";
import {
  byPath,
  bytesOf,
  dirname,
  fromVault,
  inVault,
  invalid,
  requireNote,
  withoutMd,
} from "./plan.js";
import type { ModePlanV1, PreStateV1, RefactorMutationV1 } from "./plan.js";

/** Spec §6.1's bound on `<heading>`; the slug's path length alone does not enforce it. */
const MAX_HEADING_CHARS = 512;

const ATX = /^ {0,3}(#{1,6})(?:[ \t]|$)/u;

/** NFC lower-case, runs of non-[\p{L}\p{N}] → "-", "-" trimmed. */
export function splitSlug(heading: string): string {
  return heading
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function headingText(line: string): string {
  return line
    .replace(/^ {0,3}#{1,6}/u, "")
    .replace(/[ \t]+#+[ \t]*$/u, "")
    .trim();
}

function anchorOf(tail: string): string | null {
  if (!tail.startsWith("#")) return null;
  const bar = tail.indexOf("|");
  return (bar === -1 ? tail.slice(1) : tail.slice(1, bar)).trim();
}

/**
 * Moves one `##`–`######` section into a fresh sibling note and leaves
 * `See [[slug]].` in its place (spec §6.3). Only links anchored at that heading
 * follow the section; every other link to the parent stays.
 */
export function planSplit(state: PreStateV1, note: string, heading: string): ModePlanV1 {
  if (heading.length > MAX_HEADING_CHARS) {
    throw invalid(`the heading is over ${String(MAX_HEADING_CHARS)} characters`, [note]);
  }
  const parentNote = requireNote(state, note);
  const bytes = bytesOf(state, note);
  const parsed = parseNote(bytes);
  if (!parsed.ok) throw invalid(`${note} is not a canonical note`, [note]);
  const { header, body, frontmatter } = parsed.note;

  // Masking blanks code 1:1 and keeps newlines, so masked and real lines align.
  const lines = body.split("\n");
  const headings = maskCode(body)
    .split("\n")
    .flatMap((line, index) => {
      const match = ATX.exec(line);
      return match === null
        ? []
        : [{ index, level: (match[1] ?? "").length, text: headingText(lines[index] ?? "") }];
    });
  const matches = headings.filter((h) => h.level >= 2 && h.text === heading);
  const found = matches[0];
  if (found === undefined || matches.length > 1) {
    throw invalid(
      found === undefined
        ? `${note} has no level 2-6 heading "${heading}"`
        : `${note} has ${String(matches.length)} headings "${heading}"`,
      [note],
    );
  }
  const end =
    headings.find((h) => h.index > found.index && h.level <= found.level)?.index ?? lines.length;

  const slug = splitSlug(heading);
  const name = `${slug}.md`;
  if (slug === "" || isUnsafeProposedNotePath(name)) {
    throw invalid(`the heading "${heading}" gives no usable note name`, [note]);
  }
  const dir = dirname(note);
  const child = dir === "" ? name : `${dir}/${name}`;

  const P = inVault(state, note);
  const C = inVault(state, child);
  const { notes } = state.build.index;
  const projected = [...notes, { ...parentNote, path: C, title: heading, aliases: [] }].sort(
    (a, b) => byPath(a.path, b.path),
  );
  const resolveBefore = createLinkResolver(notes, state.contentRoot);
  const resolveAfter = createLinkResolver(projected, state.contentRoot);
  const text =
    resolveAfter(slug) === C && resolveBefore(slug) === null ? slug : withoutMd(child);

  const prefix = lines.slice(0, found.index).join("\n") + (found.index > 0 ? "\n" : "");
  const section = lines.slice(found.index, end).join("\n");
  const rest = lines.slice(end).join("\n").trimStart();
  const parentBody =
    (prefix.trim() === "" ? prefix : `${prefix.trimEnd()}\n\n`) +
    `See [[${text}]].\n` +
    (rest === "" ? "" : `\n${rest}`);

  const childFrontmatter = stringify(
    {
      schemaVersion: 1,
      title: heading,
      type: frontmatter.type,
      created: state.input.today,
      tags: [...frontmatter.tags],
      // ponytail: one grapheme under the bound leaves room for the ellipsis; a title of
      // multi-unit graphemes near 400 can still overflow and fail post-condition (a).
      summary: screenAndCap(`Split from ${frontmatter.title}.`, MAX_SUMMARY_LENGTH - 1),
      stage: "emerging",
      author: frontmatter.author,
      reviewed: null,
    },
    { lineWidth: 0 },
  );

  // Edges that legitimately move: the section's own links go from parent to child.
  const edgeSlack: (readonly [string, string])[] = [];
  for (const occurrence of findWikilinks(section)) {
    const before = resolveBefore(occurrence.text.trim());
    const after = resolveAfter(occurrence.text.trim());
    if (before !== null) edgeSlack.push([note, fromVault(state, before)]);
    if (after !== null) edgeSlack.push([child, fromVault(state, after)]);
  }

  const referrers = [
    ...new Set(
      state.build.graph.edges
        .filter((edge) => edge.target === P && edge.source !== P)
        .map((edge) => edge.source),
    ),
  ].sort(byPath);
  const changes: RefactorMutationV1[] = [];
  let rewrittenLinks = 0;
  for (const referrer of referrers) {
    const path = fromVault(state, referrer);
    const source = bytesOf(state, path);
    const parsedReferrer = parseNote(source);
    if (!parsedReferrer.ok) continue;
    const out = rewriteWikilinks(parsedReferrer.note.body, (occurrence) =>
      resolveBefore(occurrence.text.trim()) === P && anchorOf(occurrence.tail) === heading
        ? `[[${text}${withoutAnchor(occurrence.tail)}]]`
        : null,
    );
    if (out.rewritten === 0) continue;
    rewrittenLinks += out.rewritten;
    edgeSlack.push([path, note], [path, child]);
    changes.push({
      operation: "replace",
      path,
      content: parsedReferrer.note.header + out.body,
      before: source,
    });
  }

  return {
    moves: new Map(),
    changes: [
      { operation: "replace", path: note, content: renderNote({ header, body: parentBody }), before: bytes },
      {
        operation: "create",
        path: child,
        content: `---\n${childFrontmatter}---\n\n${section.trimEnd()}\n`,
        before: null,
      },
      ...changes,
    ],
    extraEdges: [[note, child]],
    edgeSlack,
    rewrittenLinks,
  };
}
