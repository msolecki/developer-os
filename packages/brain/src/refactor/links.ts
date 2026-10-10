import { findWikilinks } from "../indexes/index.js";
import type { WikilinkOccurrence } from "../indexes/index.js";

/**
 * Replaces each occurrence `decide` returns a string for, and keeps the rest.
 * Walked in reverse so every earlier offset stays valid after a splice.
 * `unlink` also consumes an embed's leading `!`, which the link pattern does not
 * match: replacing a link with plain text would otherwise leave `!label`.
 */
export function rewriteWikilinks(
  body: string,
  decide: (occurrence: WikilinkOccurrence) => string | null,
  unlink = false,
): { readonly body: string; readonly rewritten: number } {
  let out = body;
  let rewritten = 0;
  for (const occurrence of [...findWikilinks(body)].reverse()) {
    const replacement = decide(occurrence);
    if (replacement === null) continue;
    const start = unlink && body[occurrence.index - 1] === "!" ? occurrence.index - 1 : occurrence.index;
    out =
      out.slice(0, start) +
      replacement +
      out.slice(occurrence.index + occurrence.length);
    rewritten += 1;
  }
  return { body: out, rewritten };
}

/** Drops a leading `#anchor` and keeps any `|display`. */
export function withoutAnchor(tail: string): string {
  if (!tail.startsWith("#")) return tail;
  const bar = tail.indexOf("|");
  return bar === -1 ? "" : tail.slice(bar);
}
