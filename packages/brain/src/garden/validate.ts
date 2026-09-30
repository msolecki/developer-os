import type { BrainConfigV1 } from "@developer-os/core";
import { parseAllDocuments } from "yaml";

import { PRIVATE_FOLDERS, topicOfFolder } from "../discovery/index.js";
import { createLinkResolver, extractLinks } from "../indexes/index.js";
import type { IndexedNote } from "../indexes/index.js";
import { isUnsafeProposedNotePath } from "../ingest/index.js";
import type { LintFinding } from "../lint/index.js";
import { FRONTMATTER, FRONTMATTER_PARSE_OPTIONS, parseNote } from "../schema/note.js";
import type { ParsedNote } from "../schema/note.js";
import { GARDEN_MAX_PROPOSALS, GARDEN_NOTE_MAX_BYTES, parseGardenResponse } from "./proposal.js";
import type { GardenProposalV1 } from "./proposal.js";
import { contentRelative, fold } from "./select.js";
import type { GardenTargetsV1 } from "./select.js";

export type GardenRejectCodeV1 =
  | "over_limit"
  | "duplicate_target"
  | "frontmatter_invalid"
  | "link_unresolved"
  | "redaction_would_alter"
  | "too_large"
  | "target_occupied"
  | "target_outside_topics"
  | "hub_too_thin"
  | "sources_outside_bundle"
  | "target_not_selected"
  | "related_changes_body"
  | "fix_out_of_scope";

export interface GardenValidationV1 {
  readonly accepted: readonly GardenProposalV1[];
  readonly rejected: readonly {
    readonly index: number;
    readonly target: string;
    readonly code: GardenRejectCodeV1;
  }[];
}

export interface GardenValidationInputV1 {
  /** Parsed JSON from the agent. */
  readonly response: unknown;
  /** The targets as included in the prompt. */
  readonly targets: GardenTargetsV1;
  readonly notes: readonly IndexedNote[];
  readonly config: BrainConfigV1;
  /** Content-relative path to the file's text, or `null` when nothing is there. */
  readonly readNote: (contentRelativePath: string) => string | null;
  /** Content-relative paths a quarantined capture already names. */
  readonly pendingNotePaths: ReadonlySet<string>;
  readonly findings: readonly LintFinding[];
  /** `findings.length` of the capture redactor over `text`. */
  readonly redactionFindings: (text: string) => number;
}

export const GARDEN_HUB_MIN_LINKS = 3;
export const GARDEN_RELATED_MIN_LINKS = 2;
export const GARDEN_RELATED_MAX_LINKS = 5;

type Code = GardenRejectCodeV1;

/**
 * Not a place a note may live: outside every topic folder (aliases resolved as
 * NEW-128 does), or under a private folder, the indexes directory or a
 * dot-segment at any depth — discovery's own exclusion, which is module-private
 * in `ingest/validate.ts`. Segments are folded first, because on a folding
 * volume `DEV/_Raw` is `DEV/_raw`.
 */
function isPrivate(path: string, config: BrainConfigV1): boolean {
  const segments = path.split("/");
  if (topicOfFolder(segments[0] ?? "", config) === null) return true;
  const indexesDir = fold(config.indexesDir);
  return segments.some((raw) => {
    const segment = fold(raw);
    return segment.startsWith(".") || segment === indexesDir || PRIVATE_FOLDERS.includes(segment);
  });
}

/** The note as `brain lint` parses it, with no error and no unknown key. */
function validNote(text: string): ParsedNote | null {
  const parsed = parseNote(text);
  if (!parsed.ok) return null;
  const clean =
    parsed.issues.every((issue) => issue.severity !== "error") && parsed.note.unknownKeys.length === 0;
  return clean ? parsed.note : null;
}

/** Provenance a new agent note must carry (Ruling 5: hubs only). */
function isUnreviewedAgentNote(note: ParsedNote): boolean {
  const front = note.frontmatter;
  return front.author === "agent" && front.reviewed === null && front.stage === "emerging";
}

interface HeaderBlock {
  /** The top-level key the block belongs to, or null for a fence, comment or other line. */
  readonly key: string | null;
  readonly text: string;
}

const KEY_LINE = /^(?:"([^"\n]*)"|'([^'\n]*)'|([^\s#'"-][^:\n]*?))[ \t]*:(?:[ \t]|\r?\n|$)/u;
const CONTINUATION = /^(?:[ \t]|- )/u;

/**
 * The header (fences included) split into one block per top-level key, with
 * its indented or `- ` continuation lines; every other line is its own keyless
 * block. Comparing headers with some keys' blocks removed is how "byte for byte
 * outside the lines of the changed keys" is checked.
 */
function headerBlocks(header: string): readonly HeaderBlock[] {
  const blocks: { key: string | null; text: string }[] = [];
  for (const line of header.split(/(?<=\n)/u)) {
    const match = KEY_LINE.exec(line);
    const last = blocks[blocks.length - 1];
    if (match !== null) blocks.push({ key: match[1] ?? match[2] ?? match[3] ?? "", text: line });
    else if (last !== undefined && last.key !== null && CONTINUATION.test(line)) last.text += line;
    else blocks.push({ key: null, text: line });
  }
  return blocks;
}

function without(blocks: readonly HeaderBlock[], keys: ReadonlySet<string>): string {
  return blocks
    .filter((block) => block.key === null || !keys.has(block.key))
    .map((block) => block.text)
    .join("");
}

function blockOf(blocks: readonly HeaderBlock[], key: string): string {
  return blocks
    .filter((block) => block.key === key)
    .map((block) => block.text)
    .join("");
}

function split(text: string): { readonly header: string; readonly frontmatter: string; readonly body: string } | null {
  const match = FRONTMATTER.exec(text);
  if (match === null) return null;
  const body = match[2] ?? "";
  return { header: text.slice(0, text.length - body.length), frontmatter: match[1] ?? "", body };
}

const RELATED_KEYS: ReadonlySet<string> = new Set(["updated", "reviewed"]);
const LINK_ITEM = String.raw`- \[\[[^\[\]|\n\x60]+(?:\|[^\[\]|\n\x60]+)?\]\]\n`;
/** Ruling 11: the heading, one blank line, 2–5 link items, a final newline, nothing after. */
const RELATED_SECTION = new RegExp(
  `^## Related\\n\\n(?:${LINK_ITEM}){${String(GARDEN_RELATED_MIN_LINKS)},${String(GARDEN_RELATED_MAX_LINKS)}}$`,
  "u",
);
/** An existing section the proposal may replace: the same shape with any number of items. */
const EXISTING_SECTION = /^## Related\n\n(?:- \[\[[^\n]*\]\]\n)*$/u;

/** Offset of the last line that is exactly `## Related`, or -1. */
function lastRelatedHeading(body: string): number {
  const index = body.lastIndexOf("## Related\n");
  if (index === -1) return -1;
  return index === 0 || body[index - 1] === "\n" ? index : -1;
}

/**
 * Ruling 10 and 11. The header may differ only in `updated` and in `reviewed`
 * being set to null; the body is the current body (minus an existing trailing
 * Related section of the same shape), at most one inserted blank line, then a
 * section `RELATED_SECTION` matches exactly.
 */
function checkRelated(current: string, proposed: string): Code | null {
  const before = split(current);
  const after = split(proposed);
  if (before === null || after === null) return "related_changes_body";

  const left = headerBlocks(before.header);
  const right = headerBlocks(after.header);
  if (without(left, RELATED_KEYS) !== without(right, RELATED_KEYS)) return "related_changes_body";
  const reviewed = blockOf(right, "reviewed");
  if (reviewed !== blockOf(left, "reviewed") && !/^reviewed: null\r?\n$/u.test(reviewed)) {
    return "related_changes_body";
  }

  const existing = lastRelatedHeading(before.body);
  const kept =
    existing !== -1 && EXISTING_SECTION.test(before.body.slice(existing))
      ? before.body.slice(0, existing)
      : before.body;
  const heading = lastRelatedHeading(after.body);
  if (heading === -1 || !RELATED_SECTION.test(after.body.slice(heading))) return "related_changes_body";
  const separators = kept === "" || kept.endsWith("\n") ? ["", "\n"] : ["\n", "\n\n"];
  const prefix = after.body.slice(0, heading);
  return separators.some((separator) => prefix === kept + separator) ? null : "related_changes_body";
}

/** The raw frontmatter mapping, parsed as `parseNote` parses it; `null` when it is not one. */
function frontmatterMapping(text: string): Record<string, unknown> | null {
  try {
    const documents = parseAllDocuments(text, FRONTMATTER_PARSE_OPTIONS);
    if (documents.length > 1) return null;
    const document = documents[0];
    if (document === undefined) return {};
    if (document.errors.length > 0) return null;
    const value = document.toJS({ maxAliasCount: 100 }) as unknown;
    if (value === null || value === undefined) return {};
    return typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Provenance a `fix` may never touch, whatever a finding names (Ruling 10). */
const FIX_FORBIDDEN: ReadonlySet<string> = new Set(["author", "reviewed", "stage", "created"]);

/**
 * The current note usually fails `parseNote` — that is why it has a finding —
 * so the changed keys come from comparing raw YAML mappings; then the header
 * must equal the current one byte for byte outside those keys' lines, so an
 * added comment or a reformatted key is out of scope.
 */
function checkFix(current: string, proposed: string, allowed: ReadonlySet<string>): Code | null {
  const before = split(current);
  const after = split(proposed);
  if (before === null || after === null || before.body !== after.body) return "fix_out_of_scope";
  const left = frontmatterMapping(before.frontmatter);
  const right = frontmatterMapping(after.frontmatter);
  if (left === null || right === null) return "fix_out_of_scope";
  const changed = new Set(
    [...new Set([...Object.keys(left), ...Object.keys(right)])].filter(
      (key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]),
    ),
  );
  if (changed.size === 0) return "fix_out_of_scope";
  if ([...changed].some((key) => !allowed.has(key) || FIX_FORBIDDEN.has(key))) return "fix_out_of_scope";
  return without(headerBlocks(before.header), changed) === without(headerBlocks(after.header), changed)
    ? null
    : "fix_out_of_scope";
}

interface Checked {
  readonly proposal: GardenProposalV1;
  /** The first failing check before links, or null. */
  readonly early: Code | null;
  readonly parsed: ParsedNote | null;
  readonly links: readonly string[];
  /** A `[[` the link extractor did not count: inside code, escaped, or otherwise hidden. */
  readonly hiddenLink: boolean;
}

/**
 * The security boundary of the unattended gardener call (spec §4). The agent
 * only proposes text; this decides what may reach quarantine, and every
 * ambiguity is a rejection. Per proposal, first failing check wins:
 *
 * `over_limit` → `duplicate_target` → `too_large` → `frontmatter_invalid`
 * (every kind: parses, no error, no unknown key) → kind rules (hub:
 * `target_outside_topics` → `target_occupied` → `frontmatter_invalid` for
 * missing provenance or a non-`compiled-note` type → `target_not_selected`
 * without a selected gap tag → `duplicate_target` for a gap tag another hub
 * already claimed → `hub_too_thin` → `sources_outside_bundle`; related:
 * `target_not_selected` → `related_changes_body`; fix: `target_occupied` →
 * `fix_out_of_scope`) → `link_unresolved` (a hidden `[[`, or a link that does
 * not resolve) → `redaction_would_alter`.
 */
export function validateGardenResponse(
  input: GardenValidationInputV1,
): GardenValidationV1 | { readonly invalid: "agent_output_invalid" } {
  const response = parseGardenResponse(input.response);
  if (response === null) return { invalid: "agent_output_invalid" };

  const { config, notes } = input;
  const prefix = `${config.contentRoot}/`;
  /** Ruling 13: the notes the prompt carried, gap notes and isolated targets alike. */
  const bundle = new Set([...input.targets.gaps.flatMap((gap) => gap.notePaths), ...input.targets.isolated]);
  const gapTags = new Set(input.targets.gaps.map((gap) => gap.tag));
  const claimed = new Set<string>();
  const selected = new Set(input.targets.isolated);
  const pending = new Set([...input.pendingNotePaths].map(fold));
  const indexed = new Set(notes.map((note) => fold(contentRelative(note.path))));
  const resolveIndexed = createLinkResolver(notes, config.contentRoot);

  function kindCheck(proposal: GardenProposalV1, parsed: ParsedNote): Code | null {
    const { target } = proposal;
    if (proposal.kind === "hub") {
      if (isUnsafeProposedNotePath(target) || target.includes("%") || isPrivate(target, config)) {
        return "target_outside_topics";
      }
      if (indexed.has(fold(target)) || pending.has(fold(target)) || input.readNote(target) !== null) {
        return "target_occupied";
      }
      if (!isUnreviewedAgentNote(parsed) || parsed.frontmatter.type !== "compiled-note") {
        return "frontmatter_invalid";
      }
      const tags = parsed.frontmatter.tags.filter((tag) => gapTags.has(tag));
      if (tags.length === 0) return "target_not_selected";
      if (tags.some((tag) => claimed.has(tag))) return "duplicate_target";
      for (const tag of tags) claimed.add(tag);
      const linked = new Set(
        extractLinks(parsed.body)
          .map(resolveIndexed)
          .filter((path): path is string => path !== null)
          .map(contentRelative)
          .filter((path) => bundle.has(path)),
      );
      if (linked.size < GARDEN_HUB_MIN_LINKS) return "hub_too_thin";
      const sources = parsed.frontmatter.sources ?? [];
      const outside = sources.length === 0 || sources.some((source) => {
        const path = source.startsWith(prefix) ? source.slice(prefix.length) : source;
        return !bundle.has(path);
      });
      return outside ? "sources_outside_bundle" : null;
    }
    if (proposal.kind === "related") {
      const current = selected.has(target) ? input.readNote(target) : null;
      return current === null ? "target_not_selected" : checkRelated(current, proposal.note);
    }
    if (pending.has(fold(target))) return "target_occupied";
    /**
     * The findings gate the read: only a target some finding names (an indexed
     * note) ever reaches `readNote`, so an agent-written path such as
     * `DEV/../x.md` is never handed to the reader.
     */
    const allowed = new Set(
      input.findings
        .filter((finding) => finding.path === prefix + target && finding.key !== null)
        .map((finding) => finding.key as string),
    );
    const current = allowed.size === 0 ? null : input.readNote(target);
    if (current === null) return "fix_out_of_scope";
    return checkFix(current, proposal.note, allowed);
  }

  const seen = new Set<string>();
  const checked: Checked[] = response.proposals.map((proposal, index) => {
    const reject = (early: Code): Checked => ({ proposal, early, parsed: null, links: [], hiddenLink: false });
    if (index >= GARDEN_MAX_PROPOSALS) return reject("over_limit");
    const key = fold(proposal.target);
    if (seen.has(key)) return reject("duplicate_target");
    seen.add(key);
    if (Buffer.byteLength(proposal.note, "utf8") > GARDEN_NOTE_MAX_BYTES) return reject("too_large");
    const parsed = validNote(proposal.note);
    if (parsed === null) return reject("frontmatter_invalid");
    const links = extractLinks(parsed.body);
    const opened = parsed.body.match(/\[\[/gu)?.length ?? 0;
    return { proposal, early: kindCheck(proposal, parsed), parsed, links, hiddenLink: opened > links.length };
  });

  const redacted = checked.map(
    ({ proposal, early }) => early === null && input.redactionFindings(proposal.note) > 0,
  );

  /**
   * A link may resolve to a hub proposed in the same run only if that hub is
   * itself accepted. Rejecting a hub can only add link failures, so iterate
   * until the accepted hub set stops shrinking (at most eight proposals).
   */
  let hubs = checked.filter((entry) => entry.proposal.kind === "hub" && entry.early === null);
  let codes: (Code | null)[] = [];
  for (;;) {
    const resolve = createLinkResolver(
      [...notes, ...hubs.map((hub) => asIndexed(hub, config))],
      config.contentRoot,
    );
    codes = checked.map((entry, index) => {
      if (entry.early !== null) return entry.early;
      if (entry.hiddenLink) return "link_unresolved";
      const resolves = entry.links.every((link) => {
        const path = resolve(link);
        return path !== null && path.startsWith(prefix) && !isPrivate(contentRelative(path), config);
      });
      if (!resolves) return "link_unresolved";
      return redacted[index] === true ? "redaction_would_alter" : null;
    });
    const surviving = hubs.filter((hub) => codes[checked.indexOf(hub)] === null);
    if (surviving.length === hubs.length) break;
    hubs = surviving;
  }

  const accepted: GardenProposalV1[] = [];
  const rejected: { index: number; target: string; code: Code }[] = [];
  checked.forEach(({ proposal }, index) => {
    const code = codes[index] ?? null;
    if (code === null) accepted.push(proposal);
    else rejected.push({ index, target: proposal.target, code });
  });
  return { accepted, rejected };
}

/** A same-run hub as the resolver sees it: only path, folder, title and aliases are read. */
function asIndexed(hub: Checked, config: BrainConfigV1): IndexedNote {
  const front = (hub.parsed as ParsedNote).frontmatter;
  return {
    path: `${config.contentRoot}/${hub.proposal.target}`,
    title: front.title,
    type: front.type,
    topicFolder: topicOfFolder(hub.proposal.target.split("/")[0] ?? "", config) ?? "",
    tags: front.tags,
    aliases: front.aliases ?? [],
    summary: front.summary,
    stage: front.stage,
    author: front.author,
    reviewed: front.reviewed,
    occurrences: front.occurrences ?? 0,
    created: front.created,
    updated: front.updated ?? null,
    sources: front.sources ?? [],
    contentHash: "",
    terms: [],
  };
}
