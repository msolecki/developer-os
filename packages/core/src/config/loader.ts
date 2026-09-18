import { isAbsolute } from "node:path";

import { parse, stringify } from "smol-toml";
import { z } from "zod";

import { encodeCanonicalJson } from "../lifecycle/canonical-json.js";
import type { CanonicalJsonValue } from "../lifecycle/canonical-json.js";
import { parseCanonicalAbsolutePathText } from "../update/paths.js";
import { parseLowerHexSha256 } from "../update/scalars.js";
import {
  SCHEDULED_JOB_IDS,
  WEEKDAY_IDS,
  gitScopeFingerprint,
  parseNormalizedRemoteUrl,
  parseValidatedGitBranch,
  parseVaultSegment,
  type NormalizedRemoteUrlV1,
} from "./lifecycle.js";
import { pathSegmentViolation } from "./segment.js";
import type { DeveloperOsConfigV1 } from "./types.js";

export const absolutePathSchema = z
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

function reservedObjectKey(raw: unknown): string | null {
  if (typeof raw === "object" && raw !== null) {
    for (const key of Object.getOwnPropertyNames(raw)) {
      if (RESERVED_OBJECT_KEYS.has(key)) return key;
    }
  }
  return null;
}

const topicAliasesSchema = z.preprocess((raw, ctx) => {
  const reserved = reservedObjectKey(raw);
  if (reserved !== null) {
    ctx.addIssue({ code: "custom", message: `Alias key is reserved: ${reserved}` });
    return z.NEVER;
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

/**
 * The folder/alias rules for one vault scope, shared by `[brain]` and by
 * `GitSyncConfigV1.scope`: Spec 1 §2.2 says the Git scope snapshot uses "the existing
 * NFC/case fold" and "the existing reserved-key and folder/target rules", so a second
 * copy of them would be the defect — the snapshot's whole purpose is to record what
 * `[brain]` said.
 */
function vaultScopeViolation(scope: {
  readonly topicFolders: readonly string[];
  readonly topicAliases: Readonly<Record<string, string>>;
}): string | null {
  /**
   * Two topics in this file that are one directory on disk would silently share
   * storage. See `foldFolder` for why case alone is not enough.
   */
  const folded = scope.topicFolders.map(foldFolder);
  if (new Set(folded).size !== scope.topicFolders.length) {
    return "topicFolders must be unique after case and Unicode folding";
  }
  /**
   * An alias pointing at a folder that is not a topic resolves to nothing, and
   * discovery would report the source folder as unclassified — a confusing way
   * to learn about a typo in a configuration file.
   */
  if (
    !Object.values(scope.topicAliases).every((target) => scope.topicFolders.includes(target))
  ) {
    return "every topicAliases value must name a configured topic folder";
  }
  /**
   * An alias key that is *also* a topic folder makes one name both a topic and a
   * pointer at another topic, and `PROJECTS = "PROJECTS"` makes it point at
   * itself. Resolution order would decide which meaning wins, which is not a
   * thing a configuration file should leave to implementation detail.
   */
  const topics = new Set(folded);
  if (!Object.keys(scope.topicAliases).every((source) => !topics.has(foldFolder(source)))) {
    return "a topicAliases key must not also be a configured topic folder";
  }
  return null;
}

export const brainSchema = z
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
  .superRefine((value, ctx) => {
    const violation = vaultScopeViolation(value);
    if (violation !== null) ctx.addIssue({ code: "custom", message: violation });
  });

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
export const redactionSchema = z
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

/**
 * Every leaf of a lifecycle record is a branded scalar whose one admission rule already
 * lives in a parser. Wrapping the parser keeps the schema and the parser from drifting
 * into two grammars for one value, and the transform is what carries the brand out of
 * Zod, which infers only `string`.
 */
function admittedString(admit: (value: unknown) => unknown) {
  return z.string().superRefine((value, ctx) => {
    try {
      admit(value);
    } catch (error) {
      ctx.addIssue({ code: "custom", message: (error as Error).message });
    }
  });
}

function brandedString<TBranded extends string>(admit: (value: unknown) => TBranded) {
  return admittedString(admit).transform((value) => value as TBranded);
}

const vaultSegmentSchema = brandedString(parseVaultSegment);
/**
 * §2.2 types the alias key `VaultSegmentV1` as well, but the map's declared key type
 * stays `string`: a branded record key would infer a mapped type no plain `Record`
 * consumer can assign to. The bound is enforced, the brand is not carried on the key.
 */
const vaultSegmentKeySchema = admittedString(parseVaultSegment);

const scopeAliasesSchema = z.preprocess(
  (raw, ctx) => {
    const reserved = reservedObjectKey(raw);
    if (reserved !== null) {
      ctx.addIssue({ code: "custom", message: `Alias key is reserved: ${reserved}` });
      return z.NEVER;
    }
    return raw;
  },
  z
    .record(vaultSegmentKeySchema, vaultSegmentSchema)
    .refine((value) => Object.keys(value).length <= 256, {
      message: "topicAliases must hold at most 256 own entries",
    }),
);

const gitScopeSchema = z
  .object({
    brainPath: brandedString(parseCanonicalAbsolutePathText),
    contentRoot: vaultSegmentSchema,
    topicFolders: z.array(vaultSegmentSchema).min(1).max(256),
    topicAliases: scopeAliasesSchema,
    indexesDir: vaultSegmentSchema,
    fingerprint: brandedString(parseLowerHexSha256),
  })
  .strict()
  .superRefine((value, ctx) => {
    const violation = vaultScopeViolation(value);
    if (violation !== null) ctx.addIssue({ code: "custom", message: violation });
    const { fingerprint, ...scope } = value;
    if (gitScopeFingerprint(scope) !== fingerprint) {
      ctx.addIssue({ code: "custom", message: "scope fingerprint does not recompute" });
    }
  });

const gitRemoteSchema = z
  .object({
    name: z.literal("developer-os"),
    transport: z.enum(["local", "https", "ssh"]),
    declaredUrl: z.string(),
    effectivePushUrl: z.string(),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const key of ["declaredUrl", "effectivePushUrl"] as const) {
      try {
        parseNormalizedRemoteUrl(value[key], value.transport);
      } catch (error) {
        ctx.addIssue({ code: "custom", message: `remote.${key}: ${(error as Error).message}` });
      }
    }
    /** Version 1 requires them byte-equal; a second destination is a new reviewed policy. */
    if (value.declaredUrl !== value.effectivePushUrl) {
      ctx.addIssue({
        code: "custom",
        message: "remote.declaredUrl and remote.effectivePushUrl must be byte-equal",
      });
    }
  })
  .transform((value) => ({
    name: value.name,
    transport: value.transport,
    declaredUrl: value.declaredUrl as NormalizedRemoteUrlV1,
    effectivePushUrl: value.effectivePushUrl as NormalizedRemoteUrlV1,
  }));

const gitSyncConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    repositoryRoot: brandedString(parseCanonicalAbsolutePathText),
    branch: brandedString(parseValidatedGitBranch),
    remote: gitRemoteSchema,
    scope: gitScopeSchema,
  })
  .strict();

const minuteSchema = z.number().int().min(0).max(59);
const hourSchema = z.number().int().min(0).max(23);

const normalizedScheduleSchema = z.discriminatedUnion("cadence", [
  z.object({ cadence: z.literal("hourly"), minute: minuteSchema }).strict(),
  z.object({ cadence: z.literal("daily"), hour: hourSchema, minute: minuteSchema }).strict(),
  z
    .object({
      cadence: z.literal("weekly"),
      day: z.enum(WEEKDAY_IDS),
      hour: hourSchema,
      minute: minuteSchema,
    })
    .strict(),
]);

const automationConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    schedules: z
      .array(
        z
          .object({ job: z.enum(SCHEDULED_JOB_IDS), schedule: normalizedScheduleSchema })
          .strict(),
      )
      .min(3)
      .max(4)
      /**
       * One rule for four refusals: a missing mandatory job, the mandatory jobs out of
       * order, a duplicate, and `git-sync` anywhere but fourth are all "entry `i` is not
       * `SCHEDULED_JOB_IDS[i]`". No input spelling is stored, so there is nothing else
       * the order could be recovered from.
       */
      .refine((entries) => entries.every((entry, index) => entry.job === SCHEDULED_JOB_IDS[index]), {
        message:
          "schedules must be the mandatory three in registry order, with git-sync exactly fourth",
      }),
  })
  .strict();

const LIFECYCLE_RECORD_MAX_BYTES = 1_048_576;
const canonicalJsonEncoder = new TextEncoder();

/**
 * Spec 1 §2.2 bounds "the whole serialized lifecycle record" before parsing or hashing,
 * so the ceiling is measured on the raw table and the strict schema never sees an
 * oversized value. Measuring the canonical encoding rather than the TOML source is also
 * what refuses a TOML scalar canonical JSON cannot represent — a date, a float — before
 * any later reader has to decide what those would hash to.
 */
function boundedLifecycleRecord<TSchema extends z.ZodType>(label: string, schema: TSchema) {
  return z.preprocess((raw, ctx) => {
    let canonical: string;
    try {
      canonical = encodeCanonicalJson(raw as CanonicalJsonValue);
    } catch (error) {
      ctx.addIssue({ code: "custom", message: `${label}: ${(error as Error).message}` });
      return z.NEVER;
    }
    if (canonicalJsonEncoder.encode(canonical).byteLength > LIFECYCLE_RECORD_MAX_BYTES) {
      ctx.addIssue({
        code: "custom",
        message: `${label} exceeds ${LIFECYCLE_RECORD_MAX_BYTES.toString(10)} canonical JSON bytes`,
      });
      return z.NEVER;
    }
    return raw;
  }, schema);
}

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
        lifecycle: boundedLifecycleRecord("git.lifecycle", gitSyncConfigSchema).optional(),
      })
      .strict(),
    automation: z
      .object({
        enabled: z.boolean(),
        lifecycle: boundedLifecycleRecord(
          "automation.lifecycle",
          automationConfigSchema,
        ).optional(),
      })
      .strict(),
    brain: brainSchema.optional(),
    redaction: redactionSchema.optional(),
    telemetry: z.literal(false),
  })
  .strict()
  /**
   * Load-time screening uses only the configuration's own patterns, because Core cannot
   * import Security. `git enable` screens the same URLs with the full product redactor;
   * this catches the case where the two records disagree after a hand edit. The message
   * names neither the pattern nor the URL.
   */
  .superRefine((value, ctx) => {
    const patterns = value.redaction?.patterns ?? [];
    const remote = value.git.lifecycle?.remote;
    if (remote === undefined || patterns.length === 0) return;
    const urls = [remote.declaredUrl, remote.effectivePushUrl];
    if (patterns.some((pattern) => urls.some((url) => url.includes(pattern)))) {
      ctx.addIssue({
        code: "custom",
        message: "a configured redaction pattern matches a stored remote URL",
      });
    }
  });

/**
 * `brain` is destructured out and re-added only when present. Zod's `.optional()`
 * widens the field to `BrainConfigV1 | undefined`, and under
 * `exactOptionalPropertyTypes` that is not assignable to `brain?: BrainConfigV1`
 * — the key has to be genuinely absent, not present and `undefined`. Loosening
 * the interface to `| undefined` instead would let `serializeConfig` emit an
 * empty `[brain]` table into a configuration that never had one.
 */
export function loadConfig(source: string): DeveloperOsConfigV1 {
  const { brain, redaction, git, automation, ...rest } = configSchema.parse(parse(source));

  /**
   * Every optional section is re-added only when present, for the reason the `brain`
   * docblock above gives: under `exactOptionalPropertyTypes` a present-and-`undefined`
   * key is not assignable to an optional one, and loosening the interface instead would
   * let `serializeConfig` emit an empty table into a configuration that never had one.
   * Spec 1 §2.2 requires exactly that distinction for both lifecycle records.
   */
  const withTables = {
    ...rest,
    git:
      git.lifecycle === undefined
        ? { enabled: git.enabled }
        : { enabled: git.enabled, lifecycle: git.lifecycle },
    automation:
      automation.lifecycle === undefined
        ? { enabled: automation.enabled }
        : { enabled: automation.enabled, lifecycle: automation.lifecycle },
  };
  const withBrain = brain === undefined ? withTables : { ...withTables, brain };
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
    /**
     * `lifecycle` is emitted only when present, and after `enabled`, which is both the
     * §2.2 key order and what keeps a configuration that predates the records
     * byte-identical through a save that touched it.
     */
    git: {
      enabled: validated.git.enabled,
      ...(validated.git.lifecycle === undefined ? {} : { lifecycle: validated.git.lifecycle }),
    },
    automation: {
      enabled: validated.automation.enabled,
      ...(validated.automation.lifecycle === undefined
        ? {}
        : { lifecycle: validated.automation.lifecycle }),
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
