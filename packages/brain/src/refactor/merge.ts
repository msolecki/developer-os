import { screenControlCharacters } from "@developer-os/security";

import { parseNote, renderNote } from "../schema/note.js";
import { bytesOf, GRAVEYARD, invalid, rewriteReferrers } from "./plan.js";
import type { ModePlanV1, PreStateV1 } from "./plan.js";

/**
 * Appends the source body under its title to the target, graveyards the source
 * and retargets links to it (spec §6.3). The target's header stays byte-exact:
 * nothing from the source's frontmatter is unioned in (R6).
 */
export function planMerge(state: PreStateV1, source: string, target: string): ModePlanV1 {
  const sourceBytes = bytesOf(state, source);
  const targetBytes = bytesOf(state, target);
  const referrers = rewriteReferrers(state, source, target, () => false);
  // The target may itself link to the source; its rewritten body is the base.
  const retargeted = referrers.changes.find((change) => change.path === target);
  const parsedSource = parseNote(sourceBytes);
  const parsedTarget = parseNote(retargeted?.content ?? targetBytes);
  if (!parsedSource.ok || !parsedTarget.ok) {
    throw invalid(`${source} or ${target} does not parse as a note`, [source, target]);
  }

  const title = screenControlCharacters(parsedSource.note.frontmatter.title);
  const body = `${parsedTarget.note.body.trimEnd()}\n\n## ${title}\n\n${parsedSource.note.body.trim()}\n`;
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
