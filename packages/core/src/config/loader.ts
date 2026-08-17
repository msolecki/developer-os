import { isAbsolute } from "node:path";

import { parse, stringify } from "smol-toml";
import { z } from "zod";

import { pathSegmentViolation } from "./segment.js";
import type { DeveloperOsConfigV1 } from "./types.js";

const absolutePathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.includes("\0"), {
    message: "Path must not contain NUL bytes",
  })
  .refine(isAbsolute, {
    message: "Path must be absolute",
  });

/**
 * A single path segment, never a path. Topic folders, the content root, and the
 * index directory are joined onto the vault root, so accepting `..` or a
 * separator here would let a configuration file walk out of the vault before any
 * guard sees the resulting path. `pathSegmentViolation` is `./segment.js`,
 * shared with `packages/workflow-schema`'s `resolveScopeGlob` rather than
 * reimplemented here a second time — see that module's docblock for why a
 * second implementation is the defect, not a safety margin, and for why a
 * glob metacharacter is not one of the reasons this schema refuses a value.
 *
 * `superRefine`, not `refine`, so the issue this schema raises states the
 * actual rule the value broke. `pathSegmentViolation` was built to hand back
 * a reason precisely so a caller does not have to invent one — a fixed
 * `refine` message would have thrown that reason away at the one call site a
 * user actually meets a validation error from.
 */
const pathSegmentSchema = z.string().superRefine((value, ctx) => {
  const violation = pathSegmentViolation(value);
  if (violation !== null) {
    ctx.addIssue({ code: "custom", message: `${JSON.stringify(value)} ${violation}` });
  }
});

/**
 * `z.record` silently *drops* these keys before the key schema ever runs, so
 * `__proto__ = "PROJECTS"` would parse to `{}` — and a whole sub-table would
 * pass where only a string is allowed. Rejecting is the only way to make that
 * visible; the message names the key and never its value.
 */
const RESERVED_OBJECT_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

const topicAliasesSchema = z.preprocess((raw, ctx) => {
  if (typeof raw === "object" && raw !== null) {
    for (const key of Object.getOwnPropertyNames(raw)) {
      if (RESERVED_OBJECT_KEYS.has(key)) {
        ctx.addIssue({ code: "custom", message: `Alias key is reserved: ${key}` });
        return z.NEVER;
      }
    }
  }
  return raw;
}, z.record(pathSegmentSchema, pathSegmentSchema));

/** Ten years. Beyond this a staleness threshold is a typo, not a cadence. */
const MAX_REVIEW_AFTER_DAYS = 3650;

/**
 * NFC *and* case, because the default macOS volume folds both: `café` typed as
 * NFC and as NFD are two entries here and one directory on disk.
 */
function foldFolder(name: string): string {
  return name.normalize("NFC").toLowerCase();
}

const brainSchema = z
  .object({
    schemaVersion: z.literal(1),
    contentRoot: pathSegmentSchema,
    topicFolders: z.array(pathSegmentSchema).min(1),
    topicAliases: topicAliasesSchema,
    indexesDir: pathSegmentSchema,
    retrieval: z
      .object({ maxCandidates: z.number().int().min(1).max(1000) })
      .strict(),
    staleness: z
      .object({ reviewAfterDays: z.number().int().min(1).max(MAX_REVIEW_AFTER_DAYS) })
      .strict(),
  })
  .strict()
  /**
   * Two topics in this file that are one directory on disk would silently share
   * storage. See `foldFolder` for why case alone is not enough.
   */
  .refine(
    (value) =>
      new Set(value.topicFolders.map(foldFolder)).size ===
      value.topicFolders.length,
    { message: "topicFolders must be unique after case and Unicode folding" },
  )
  /**
   * An alias pointing at a folder that is not a topic resolves to nothing, and
   * discovery would report the source folder as unclassified — a confusing way
   * to learn about a typo in a configuration file.
   */
  .refine(
    (value) =>
      Object.values(value.topicAliases).every((target) =>
        value.topicFolders.includes(target),
      ),
    { message: "every topicAliases value must name a configured topic folder" },
  )
  /**
   * An alias key that is *also* a topic folder makes one name both a topic and a
   * pointer at another topic, and `PROJECTS = "PROJECTS"` makes it point at
   * itself. Resolution order would decide which meaning wins, which is not a
   * thing a configuration file should leave to implementation detail.
   */
  .refine(
    (value) => {
      const topics = new Set(value.topicFolders.map(foldFolder));
      return Object.keys(value.topicAliases).every(
        (source) => !topics.has(foldFolder(source)),
      );
    },
    { message: "a topicAliases key must not also be a configured topic folder" },
  );

/**
 * **Literal substrings, never expressions.** `redactText` matches these with `indexOf`
 * and not with a compiled pattern: a user-supplied regular expression run over capture
 * text is a ReDoS surface, and this codebase bounds no expression anywhere —
 * `RedactionOptions`' own docblock states the rule this table has to honour.
 *
 * **Bounded on both axes, and the bounds are why it is safe to expose.** Redaction is
 * O(patterns x text) and runs on every capture, every review and every ingest; an
 * unbounded list turns a configuration file into a denial of service against the user's
 * own vault. Sixty-four patterns of up to 200 characters is far above any real
 * client-name list and far below anything measurable.
 *
 * **An empty string is refused rather than ignored**, because `indexOf("")` matches at
 * every position: one empty entry would redact the whole of every text this product
 * handles, and the failure would look like the redactor working.
 *
 * Optional, like `[brain]` and for the same reason: `configSchema` is `.strict()`, so a
 * required table would refuse every installation that predates it. **Amends the schema
 * `docs/architecture/foundation.md` §2 froze**; `BACKLOG.md` §8 carries the row
 * (NEW-16).
 */
const redactionSchema = z
  .object({
    patterns: z
      .array(
        z
          .string()
          .max(200)
          /**
           * **Non-empty after trimming, and no longer than that.** The bound started at
           * `min(1)`, justified by the empty string matching at every position — and a
           * single space defeats that argument while passing it: `patterns = [" "]`
           * redacts between every word of every text this product handles, and the
           * failure looks like the redactor working. Trimming is what that argument
           * actually asked for.
           *
           * **A three-character floor was tried and withdrawn, because it measured the
           * wrong thing.** It refused `EY`, `BP`, `GE` and `3M` — registered company
           * names rather than abbreviations a user could lengthen — and every
           * two-character CJK name, which is the ordinary length there, leaving a user
           * with a Chinese or Japanese client unable to configure it at all. What `" "`
           * and `"e"` share is not shortness; it is that they match ubiquitously, which
           * is a property of the *text* and cannot be measured here.
           *
           * **So over-matching is deliberately not bounded by this schema.** A pattern
           * short or common enough to match most of a note still refuses every ingest,
           * and closing that needs a redaction-time density check plus a refusal that
           * names the offending entry. `BACKLOG.md` §1 **NEW-24** carries it.
           */
          .refine((value) => value.trim().length > 0, {
            message: "A redaction pattern must contain a non-whitespace character",
          }),
      )
      .max(64),
  })
  .strict();

const configSchema = z
  .object({
    schemaVersion: z.literal(1),
    brainPath: absolutePathSchema,
    adapters: z
      .object({
        claude: z.boolean(),
        codex: z.boolean(),
      })
      .strict(),
    git: z
      .object({
        enabled: z.boolean(),
      })
      .strict(),
    automation: z
      .object({
        enabled: z.boolean(),
      })
      .strict(),
    brain: brainSchema.optional(),
    redaction: redactionSchema.optional(),
    telemetry: z.literal(false),
  })
  .strict();

/**
 * `brain` is destructured out and re-added only when present. Zod's `.optional()`
 * widens the field to `BrainConfigV1 | undefined`, and under
 * `exactOptionalPropertyTypes` that is not assignable to `brain?: BrainConfigV1`
 * — the key has to be genuinely absent, not present and `undefined`. Loosening
 * the interface to `| undefined` instead would let `serializeConfig` emit an
 * empty `[brain]` table into a configuration that never had one.
 */
export function loadConfig(source: string): DeveloperOsConfigV1 {
  const { brain, redaction, ...rest } = configSchema.parse(parse(source));

  /**
   * Both optional sections are re-added only when present, for the reason the `brain`
   * docblock above gives: under `exactOptionalPropertyTypes` a present-and-`undefined`
   * key is not assignable to an optional one, and loosening the interface instead would
   * let `serializeConfig` emit an empty table into a configuration that never had one.
   */
  const withBrain = brain === undefined ? rest : { ...rest, brain };
  return redaction === undefined ? withBrain : { ...withBrain, redaction };
}

export function serializeConfig(config: DeveloperOsConfigV1): string {
  const validated = configSchema.parse(config);

  return stringify({
    schemaVersion: validated.schemaVersion,
    brainPath: validated.brainPath,
    adapters: {
      claude: validated.adapters.claude,
      codex: validated.adapters.codex,
    },
    git: {
      enabled: validated.git.enabled,
    },
    automation: {
      enabled: validated.automation.enabled,
    },
    /**
     * Conditional so a configuration without the section serializes to exactly
     * the bytes Foundation has always written. `stringify` would emit an empty
     * `[brain]` table for an `undefined` value, which would rewrite every
     * existing config on the first save that touched it.
     */
    ...(validated.brain === undefined ? {} : { brain: validated.brain }),
    ...(validated.redaction === undefined ? {} : { redaction: validated.redaction }),
    telemetry: validated.telemetry,
  });
}
