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
import { contentRelative } from "./select.js";
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

/** Case- and normalization-folded, because a hub at `DEV/Beta.md` lands on `DEV/beta.md` on a folding volume. */
function fold(path: string): string {
  return path.normalize("NFC").toLowerCase();
}

/**
 * Not a place a note may live: outside every topic folder (aliases resolved as
 * NEW-128 does), or under a private folder, the indexes directory or a
 * dot-segment at any depth — discovery's own exclusion, which is module-private
 * in `ingest/validate.ts`.
 */
function isPrivate(path: string, config: BrainConfigV1): boolean {
  const segments = path.split("/");
  if (topicOfFolder(segments[0] ?? "", config) === null) return true;
  return segments.some(
    (segment) =>
      segment.startsWith(".") || segment === config.indexesDir || PRIVATE_FOLDERS.includes(segment),
  );
}

/** The note as `brain lint` parses it, if it is an unreviewed, emerging agent note with no unknown key. */
function agentNote(text: string): ParsedNote | null {
  const parsed = parseNote(text);
  if (!parsed.ok) return null;
  const front = parsed.note.frontmatter;
  const clean =
    parsed.issues.every((issue) => issue.severity !== "error") &&
    parsed.note.unknownKeys.length === 0 &&
    front.author === "agent" &&
    front.reviewed === null &&
    front.stage === "emerging";
  return clean ? parsed.note : null;
}

const RELATED_HEADING = /^## Related[ \t]*\r?$/gmu;
const LATER_HEADING = /^#{1,2}[ \t]/mu;

/** The trailing `## Related` section, or `null` when the body has none (or a heading follows it). */
function relatedSection(body: string): { readonly before: string; readonly section: string } | null {
  const last = [...body.matchAll(RELATED_HEADING)].pop();
  if (last === undefined) return null;
  const section = body.slice(last.index);
  if (LATER_HEADING.test(section.slice(last[0].length))) return null;
  return { before: body.slice(0, last.index), section };
}

/** A note minus its `updated` line and trailing `## Related` section; `null` without frontmatter. */
function withoutRelatedAndUpdated(text: string): string | null {
  const match = FRONTMATTER.exec(text);
  if (match === null) return null;
  const body = match[2] ?? "";
  const header = text.slice(0, text.length - body.length).replace(/^updated:[^\n]*\n/gmu, "");
  return header + (relatedSection(body)?.before ?? body).trimEnd();
}

function checkRelated(current: string, proposed: string): Code | null {
  const match = FRONTMATTER.exec(proposed);
  const section = relatedSection(match?.[2] ?? "");
  if (section === null) return "related_changes_body";
  const links = extractLinks(section.section).length;
  if (links < GARDEN_RELATED_MIN_LINKS || links > GARDEN_RELATED_MAX_LINKS) return "related_changes_body";
  const before = withoutRelatedAndUpdated(current);
  return before !== null && before === withoutRelatedAndUpdated(proposed) ? null : "related_changes_body";
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

/**
 * The current note usually fails `parseNote` — that is why it has a finding —
 * so the frontmatter is compared as raw YAML mappings, key by key.
 */
function checkFix(current: string, proposed: string, allowed: ReadonlySet<string>): Code | null {
  const before = FRONTMATTER.exec(current);
  const after = FRONTMATTER.exec(proposed);
  if (before === null || after === null) return "fix_out_of_scope";
  if ((before[2] ?? "") !== (after[2] ?? "")) return "fix_out_of_scope";
  const left = frontmatterMapping(before[1] ?? "");
  const right = frontmatterMapping(after[1] ?? "");
  if (left === null || right === null) return "fix_out_of_scope";
  const changed = [...new Set([...Object.keys(left), ...Object.keys(right)])].filter(
    (key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]),
  );
  if (changed.length === 0) return "fix_out_of_scope";
  return changed.every((key) => allowed.has(key)) ? null : "fix_out_of_scope";
}

interface Checked {
  readonly proposal: GardenProposalV1;
  /** The first failing check before links, or null. */
  readonly early: Code | null;
  readonly parsed: ParsedNote | null;
  readonly links: readonly string[];
}

/**
 * The security boundary of the unattended gardener call (spec §4). The agent
 * only proposes text; this decides what may reach quarantine, and every
 * ambiguity is a rejection. Per proposal, first failing check wins:
 *
 * `over_limit` → `duplicate_target` → `too_large` → `frontmatter_invalid` →
 * kind rules (hub: `target_outside_topics` → `target_occupied` →
 * `frontmatter_invalid` for a non-`compiled-note` type → `hub_too_thin` →
 * `sources_outside_bundle`; related: `target_not_selected` →
 * `related_changes_body`; fix: `target_occupied` → `fix_out_of_scope`) →
 * `link_unresolved` → `redaction_would_alter`.
 */
export function validateGardenResponse(
  input: GardenValidationInputV1,
): GardenValidationV1 | { readonly invalid: "agent_output_invalid" } {
  const response = parseGardenResponse(input.response);
  if (response === null) return { invalid: "agent_output_invalid" };

  const { config, notes } = input;
  const prefix = `${config.contentRoot}/`;
  const bundle = new Set(input.targets.gaps.flatMap((gap) => gap.notePaths));
  const selected = new Set(input.targets.isolated);
  const pending = new Set([...input.pendingNotePaths].map(fold));
  const indexed = new Set(notes.map((note) => fold(contentRelative(note.path))));
  const resolveIndexed = createLinkResolver(notes, config.contentRoot);

  function kindCheck(proposal: GardenProposalV1, parsed: ParsedNote): Code | null {
    const { target } = proposal;
    if (proposal.kind === "hub") {
      if (isUnsafeProposedNotePath(target) || isPrivate(target, config)) return "target_outside_topics";
      if (indexed.has(fold(target)) || pending.has(fold(target)) || input.readNote(target) !== null) {
        return "target_occupied";
      }
      if (parsed.frontmatter.type !== "compiled-note") return "frontmatter_invalid";
      const linked = new Set(
        extractLinks(parsed.body)
          .map(resolveIndexed)
          .filter((path): path is string => path !== null)
          .map(contentRelative)
          .filter((path) => bundle.has(path)),
      );
      if (linked.size < GARDEN_HUB_MIN_LINKS) return "hub_too_thin";
      const sources = parsed.frontmatter.sources ?? [];
      const outside = sources.some((source) => {
        const path = source.startsWith(prefix) ? source.slice(prefix.length) : source;
        return !bundle.has(path);
      });
      return outside ? "sources_outside_bundle" : null;
    }
    const current = selected.has(target) || proposal.kind === "fix" ? input.readNote(target) : null;
    if (proposal.kind === "related") {
      if (current === null) return "target_not_selected";
      return checkRelated(current, proposal.note);
    }
    if (pending.has(fold(target))) return "target_occupied";
    if (current === null) return "fix_out_of_scope";
    const allowed = new Set(
      input.findings
        .filter((finding) => finding.path === prefix + target && finding.key !== null)
        .map((finding) => finding.key as string),
    );
    return checkFix(current, proposal.note, allowed);
  }

  const seen = new Set<string>();
  const checked: Checked[] = response.proposals.map((proposal, index) => {
    const reject = (early: Code): Checked => ({ proposal, early, parsed: null, links: [] });
    if (index >= GARDEN_MAX_PROPOSALS) return reject("over_limit");
    const key = fold(proposal.target);
    if (seen.has(key)) return reject("duplicate_target");
    seen.add(key);
    if (Buffer.byteLength(proposal.note, "utf8") > GARDEN_NOTE_MAX_BYTES) return reject("too_large");
    const parsed = agentNote(proposal.note);
    if (parsed === null) return reject("frontmatter_invalid");
    return { proposal, early: kindCheck(proposal, parsed), parsed, links: extractLinks(parsed.body) };
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
