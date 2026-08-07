import { isAbsolute } from "node:path";

import { parse, stringify } from "smol-toml";
import { z } from "zod";

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
 * guard sees the resulting path.
 */
const pathSegmentSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.includes("\0") &&
      !value.includes("/") &&
      !value.includes("\\") &&
      value !== "." &&
      value !== "..",
    { message: "Must be a single path segment" },
  );

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
  const { brain, ...rest } = configSchema.parse(parse(source));

  return brain === undefined ? rest : { ...rest, brain };
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
    telemetry: validated.telemetry,
  });
}
