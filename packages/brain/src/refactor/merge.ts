import { screenControlCharacters } from "@developer-os/security";

import { createLinkResolver } from "../indexes/index.js";
import type { WikilinkOccurrence } from "../indexes/index.js";
import { parseNote, renderNote } from "../schema/note.js";
import { rewriteWikilinks } from "./links.js";
import { bytesOf, GRAVEYARD, invalid, inVault, rewriteReferrers } from "./plan.js";
import type { ModePlanV1, PreStateV1 } from "./plan.js";

/**
 * Appends the source body under its title to the target, graveyards the source
 * and retargets links to it (`brain.md` §6.13, modes). The target's header stays
 * byte-exact: nothing from the source's frontmatter is unioned in (`brain.md` §6.13 R6).
 * A link either note had to the other or to itself becomes its label in the merged body.
 */
export function planMerge(state: PreStateV1, source: string, target: string): ModePlanV1 {
  const sourceBytes = bytesOf(state, source);
  const targetBytes = bytesOf(state, target);
  const referrers = rewriteReferrers(state, source, target, () => false);
  const parsedSource = parseNote(sourceBytes);
  const parsedTarget = parseNote(targetBytes);
  if (!parsedSource.ok || !parsedTarget.ok) {
    throw invalid(`${source} or ${target} does not parse as a note`, [source, target]);
  }

  const title = screenControlCharacters(parsedSource.note.frontmatter.title);
  const merged = `${parsedTarget.note.body.trimEnd()}\n\n## ${title}\n\n${parsedSource.note.body.trim()}\n`;
  const body = unlinkSelf(state, merged, [source, target]);
  return {
    moves: new Map([[source, target]]),
    changes: [
      ...referrers.changes.filter((change) => change.path !== target),
      {
        operation: "replace",
        path: target,
        content: renderNote({ header: parsedTarget.note.header, body }),
        before: targetBytes,
      },
      { operation: "remove", path: source, content: null, before: sourceBytes },
      { operation: "create", path: `${GRAVEYARD}/${source}`, content: sourceBytes, before: null },
    ],
    extraEdges: [],
    rewrittenLinks: referrers.rewritten,
  };
}

function unlinkSelf(state: PreStateV1, body: string, paths: readonly string[]): string {
  const resolve = createLinkResolver(state.build.index.notes, state.contentRoot);
  const self = new Set(paths.map((path) => inVault(state, path)));
  return rewriteWikilinks(body, (occurrence) =>
    self.has(resolve(occurrence.text.trim()) ?? "") ? labelOf(occurrence) : null,
  ).body;
}

function labelOf(occurrence: WikilinkOccurrence): string {
  const bar = occurrence.tail.indexOf("|");
  return bar === -1 ? occurrence.text.trim() : occurrence.tail.slice(bar + 1).trim();
}
