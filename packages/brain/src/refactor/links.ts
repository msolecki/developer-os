import { findWikilinks } from "../indexes/index.js";
import type { WikilinkOccurrence } from "../indexes/index.js";

/**
 * Replaces each occurrence `decide` returns a string for, and keeps the rest.
 * Walked in reverse so every earlier offset stays valid after a splice.
 */
export function rewriteWikilinks(
  body: string,
  decide: (occurrence: WikilinkOccurrence) => string | null,
): { readonly body: string; readonly rewritten: number } {
  let out = body;
  let rewritten = 0;
  for (const occurrence of [...findWikilinks(body)].reverse()) {
    const replacement = decide(occurrence);
    if (replacement === null) continue;
    out =
      out.slice(0, occurrence.index) +
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
