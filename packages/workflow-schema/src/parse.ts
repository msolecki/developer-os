import { isAlias, parseAllDocuments, visit } from "yaml";

/**
 * The same options `packages/brain` pins, for the same two reasons, restated
 * because a reader of this file should not have to find that one.
 *
 * `uniqueKeys` — already the library default, so removing it changes nothing
 * today and everything the day the default moves. A workflow carrying two
 * `scopes` blocks would otherwise validate against a value its author never
 * wrote, and the bytes would survive while only the checking went blind.
 *
 * `logLevel` — the default prints warnings *with the offending source line* to
 * stderr, past every redaction seam.
 */
export const WORKFLOW_PARSE_OPTIONS = Object.freeze({
  logLevel: "silent",
  uniqueKeys: true,
} as const);

export type ParseRefusal =
  | "multiple-documents"
  | "explicit-tag"
  | "anchor-or-alias"
  | "malformed";

export type ParseOutcome =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: ParseRefusal };

/**
 * One walk, two refusals, both of them *any-of-a-kind* rather than a denylist.
 *
 * **Any explicit tag.** `yaml@2.8.1` resolves tagged nodes through its
 * known-tags fallback even on the core schema, so `!!binary` becomes a `Buffer`
 * and `!!timestamp` a `Date` — values a `.strict()` string schema would reject
 * with a confusing message, and values a future library version could widen.
 * Brain architecture former §4.4 clause 5 settled this.
 *
 * **Any anchor or alias.** An alias makes the bytes and the parsed value
 * disagree, which is the one property this layer exists to defend, and refusing
 * the whole feature closes three holes at their source rather than three times
 * downstream. `toJS` throws a `ReferenceError` on an unresolved alias with the
 * author's anchor name in the message — unscreened, uncapped, and past every
 * redaction seam. An alias bomb throws from inside the library. A
 * self-referential alias returns a circular value that no downstream serializer
 * can accept, and a repeated one returns two branches that are the same object,
 * so normalizing either silently rewrites the other. Nothing a workflow needs to
 * say requires an anchor; found by the review of this task.
 */
function refuseHostileNodes(
  document: ReturnType<typeof parseAllDocuments>[number],
): ParseRefusal | null {
  /**
   * An array rather than a `let`, and that is not a style choice. TypeScript
   * does not model an assignment made inside a callback, so a
   * `let refusal: ParseRefusal | null = null` is narrowed back to the literal
   * type `null` after `visit()` returns — the compiler then infers this function
   * returns `null`, concludes every refusal branch in the caller is dead, and
   * reports nothing. Only the explicit return annotation held that up, and
   * nothing stopped a later cleanup from deleting it as redundant. Array
   * mutation is immune to that reset (microsoft/TypeScript#9998).
   */
  const found: ParseRefusal[] = [];
  visit(document, (_key, node) => {
    if (node === null || typeof node !== "object") return undefined;
    if (isAlias(node) || typeof (node as { anchor?: unknown }).anchor === "string") {
      found.push("anchor-or-alias");
      return visit.BREAK;
    }
    if (typeof (node as { tag?: unknown }).tag === "string") {
      found.push("explicit-tag");
      return visit.BREAK;
    }
    return undefined;
  });
  return found[0] ?? null;
}

/**
 * The whole body, not one call. Composition is recursive and so is the node
 * walk, so a two-kilobyte file of a thousand nested brackets overflows the stack
 * inside `parseAllDocuments` — the first statement here, and the one an earlier
 * version left outside its guard while guarding a `toJS` that the anchor refusal
 * had already made safe. The caught error is **discarded rather than
 * inspected**: a `yaml` error message carries the offending source verbatim,
 * which is the leak this layer exists to prevent, and nothing downstream needs
 * to know which recursion ran out of room.
 *
 * `maxAliasCount` is pinned for the reason `packages/brain` pins it — so a
 * future library default cannot quietly remove the last resource bound here.
 */
export function parseWorkflowYaml(text: string): ParseOutcome {
  try {
    return parseCheckedYaml(text);
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

function parseCheckedYaml(text: string): ParseOutcome {
  const documents = parseAllDocuments(text, WORKFLOW_PARSE_OPTIONS);
  /**
   * `> 1`, never `!== 1`. An empty file, a comment-only file and a file of
   * whitespace all yield zero documents, and telling their author to look for a
   * second document sends them hunting for text that is not there. Zero falls
   * through to the `undefined` branch below and is called malformed, which is
   * what it is.
   */
  if (documents.length > 1) return { ok: false, reason: "multiple-documents" };

  const [document] = documents;
  if (document === undefined) return { ok: false, reason: "malformed" };
  if (document.errors.length > 0) return { ok: false, reason: "malformed" };

  const hostile = refuseHostileNodes(document);
  if (hostile !== null) return { ok: false, reason: hostile };

  return { ok: true, value: document.toJS({ maxAliasCount: 100 }) as unknown };
}
