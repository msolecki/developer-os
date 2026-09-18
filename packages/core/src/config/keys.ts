import { decodeCanonicalJson } from "../lifecycle/canonical-json.js";
import type { CanonicalJsonValue } from "../lifecycle/canonical-json.js";
import { EXIT_CODES } from "../result.js";
import { parseCanonicalAbsolutePathText } from "../update/paths.js";
import { loadConfig, serializeConfig } from "./loader.js";
import type { DeveloperOsConfigV1 } from "./types.js";

export type ConfigReadableKeyV1 =
  | "schemaVersion"
  | "brainPath"
  | "adapters"
  | "adapters.claude"
  | "adapters.codex"
  | "brain"
  | "brain.schemaVersion"
  | "brain.contentRoot"
  | "brain.topicFolders"
  | "brain.topicAliases"
  | "brain.indexesDir"
  | "brain.retrieval"
  | "brain.retrieval.maxCandidates"
  | "brain.staleness"
  | "brain.staleness.reviewAfterDays"
  | "git"
  | "git.enabled"
  | "git.lifecycle"
  | "automation"
  | "automation.enabled"
  | "automation.lifecycle"
  | "redaction"
  | "redaction.patterns"
  | "telemetry";

export type ConfigMutableKeyV1 =
  | "brainPath"
  | "adapters.claude"
  | "adapters.codex"
  | "brain"
  | "brain.contentRoot"
  | "brain.topicFolders"
  | "brain.topicAliases"
  | "brain.indexesDir"
  | "brain.retrieval"
  | "brain.retrieval.maxCandidates"
  | "brain.staleness"
  | "brain.staleness.reviewAfterDays"
  | "redaction"
  | "redaction.patterns";

export const CONFIG_READABLE_KEYS: readonly ConfigReadableKeyV1[] = [
  "schemaVersion",
  "brainPath",
  "adapters",
  "adapters.claude",
  "adapters.codex",
  "brain",
  "brain.schemaVersion",
  "brain.contentRoot",
  "brain.topicFolders",
  "brain.topicAliases",
  "brain.indexesDir",
  "brain.retrieval",
  "brain.retrieval.maxCandidates",
  "brain.staleness",
  "brain.staleness.reviewAfterDays",
  "git",
  "git.enabled",
  "git.lifecycle",
  "automation",
  "automation.enabled",
  "automation.lifecycle",
  "redaction",
  "redaction.patterns",
  "telemetry",
];

export const CONFIG_MUTABLE_KEYS: readonly ConfigMutableKeyV1[] = [
  "brainPath",
  "adapters.claude",
  "adapters.codex",
  "brain",
  "brain.contentRoot",
  "brain.topicFolders",
  "brain.topicAliases",
  "brain.indexesDir",
  "brain.retrieval",
  "brain.retrieval.maxCandidates",
  "brain.staleness",
  "brain.staleness.reviewAfterDays",
  "redaction",
  "redaction.patterns",
];

const READABLE_KEYS: ReadonlySet<string> = new Set(CONFIG_READABLE_KEYS);
const MUTABLE_KEYS: ReadonlySet<string> = new Set(CONFIG_MUTABLE_KEYS);

export type PublishableDeveloperOsConfigV1 = Omit<DeveloperOsConfigV1, "redaction"> & {
  readonly redaction?: { readonly patternsCount: number };
};

export type ConfigGetResultV1 =
  | { readonly schemaVersion: 1; readonly key: null; readonly value: PublishableDeveloperOsConfigV1 }
  | {
      readonly schemaVersion: 1;
      readonly key: ConfigReadableKeyV1;
      readonly value: CanonicalJsonValue;
    };

export interface ConfigSetResultV1 {
  readonly schemaVersion: 1;
  readonly key: ConfigMutableKeyV1;
  readonly outcome: "updated" | "unchanged";
}

export interface ConfigMutationV1 {
  /**
   * The record to persist, so it carries raw `redaction.patterns`. Task 20 publishes it
   * only through `publishableConfig`; printing it directly would leak a pattern value.
   */
  readonly config: DeveloperOsConfigV1;
  readonly result: ConfigSetResultV1;
}

export type ConfigRefusalReasonV1 =
  | "config_key_unknown"
  | "config_key_read_only"
  | "config_value_not_canonical_json"
  | "config_value_invalid"
  | "config_parent_absent"
  | "config_brain_path_is_repository_identity";

const REFUSAL_MESSAGES: Readonly<Record<ConfigRefusalReasonV1, string>> = {
  config_key_unknown: "the key is not a member of ConfigReadableKeyV1",
  config_key_read_only: "the key is readable but not mutable",
  config_value_not_canonical_json: "the value is not exact CanonicalJsonV1",
  config_value_invalid: "the value does not satisfy the key's grammar",
  config_parent_absent: "the optional parent section is absent",
  config_brain_path_is_repository_identity:
    "brainPath is repository identity while a Git lifecycle record exists",
};

export class ConfigRefusalError extends Error {
  readonly code: typeof EXIT_CODES.invalidInput;
  readonly reason: ConfigRefusalReasonV1;

  /**
   * `key` is `null` for `config_key_unknown` on purpose: there the key is itself
   * arbitrary argv text, and naming it would echo user input into an error envelope
   * that Spec 1 §2.2 requires to stay content-free. Every other reason names a member
   * of the closed union, which is a constant of this module.
   */
  constructor(reason: ConfigRefusalReasonV1, key: ConfigReadableKeyV1 | null) {
    super(key === null ? REFUSAL_MESSAGES[reason] : `${key}: ${REFUSAL_MESSAGES[reason]}`);
    this.name = "ConfigRefusalError";
    this.code = EXIT_CODES.invalidInput;
    this.reason = reason;
  }
}

export function parseConfigReadableKey(value: string): ConfigReadableKeyV1 {
  if (!READABLE_KEYS.has(value)) throw new ConfigRefusalError("config_key_unknown", null);
  return value as ConfigReadableKeyV1;
}

export function publishableConfig(
  config: DeveloperOsConfigV1,
): PublishableDeveloperOsConfigV1 {
  return {
    schemaVersion: config.schemaVersion,
    brainPath: config.brainPath,
    adapters: config.adapters,
    git: config.git,
    automation: config.automation,
    ...(config.brain === undefined ? {} : { brain: config.brain }),
    ...(config.redaction === undefined
      ? {}
      : { redaction: { patternsCount: config.redaction.patterns.length } }),
    telemetry: config.telemetry,
  };
}

function projectionValue(
  projection: PublishableDeveloperOsConfigV1,
  key: ConfigReadableKeyV1,
): CanonicalJsonValue {
  if (key === "redaction.patterns") return projection.redaction?.patternsCount ?? null;
  let current: unknown = projection;
  for (const segment of key.split(".")) {
    if (typeof current !== "object" || current === null || !Object.hasOwn(current, segment)) {
      return null;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return (current ?? null) as CanonicalJsonValue;
}

export function readConfigValue(
  config: DeveloperOsConfigV1,
  key: ConfigReadableKeyV1 | null,
): ConfigGetResultV1 {
  const projection = publishableConfig(config);
  if (key === null) return { schemaVersion: 1, key: null, value: projection };
  return {
    schemaVersion: 1,
    key: parseConfigReadableKey(key),
    value: projectionValue(projection, key),
  };
}

function spliceInto(
  parent: Readonly<Record<string, unknown>>,
  path: readonly string[],
  value: CanonicalJsonValue,
): Record<string, unknown> {
  const [head, ...rest] = path;
  if (head === undefined) throw new Error("config key path is empty");
  const next: Record<string, unknown> = { ...parent };
  next[head] =
    rest.length === 0
      ? value
      : spliceInto(parent[head] as Readonly<Record<string, unknown>>, rest, value);
  return next;
}

function withoutSection(
  config: DeveloperOsConfigV1,
  section: "brain" | "redaction",
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(config).filter(([key]) => key !== section));
}

const CONFIG_VALUE_MAX_BYTES = 1_048_576;
const encoder = new TextEncoder();

export function setConfigValue(
  config: DeveloperOsConfigV1,
  key: string,
  argvValue: string,
): ConfigMutationV1 {
  if (!READABLE_KEYS.has(key)) throw new ConfigRefusalError("config_key_unknown", null);
  const readable = key as ConfigReadableKeyV1;
  if (!MUTABLE_KEYS.has(key)) throw new ConfigRefusalError("config_key_read_only", readable);
  const mutable = key as ConfigMutableKeyV1;

  if (mutable === "brainPath" && config.git.lifecycle !== undefined) {
    throw new ConfigRefusalError("config_brain_path_is_repository_identity", mutable);
  }

  const path = mutable.split(".");
  const [head] = path;
  if (head === undefined) throw new ConfigRefusalError("config_key_unknown", null);
  if (
    path.length > 1 &&
    (config as unknown as Record<string, unknown>)[head] === undefined
  ) {
    throw new ConfigRefusalError("config_parent_absent", mutable);
  }

  const previous = serializeConfig(config);

  let value: CanonicalJsonValue;
  try {
    value = decodeCanonicalJson(encoder.encode(`${argvValue}\n`), CONFIG_VALUE_MAX_BYTES);
  } catch {
    throw new ConfigRefusalError("config_value_not_canonical_json", mutable);
  }

  const removesSection = mutable === "brain" || mutable === "redaction";
  if (value === null && !removesSection) {
    throw new ConfigRefusalError("config_value_invalid", mutable);
  }
  if (mutable === "brainPath") {
    try {
      parseCanonicalAbsolutePathText(value);
    } catch {
      throw new ConfigRefusalError("config_value_invalid", mutable);
    }
  }

  const candidate =
    value === null && removesSection
      ? withoutSection(config, mutable)
      : spliceInto(config as unknown as Record<string, unknown>, path, value);

  let serialized: string;
  let next: DeveloperOsConfigV1;
  try {
    serialized = serializeConfig(candidate as unknown as DeveloperOsConfigV1);
    next = loadConfig(serialized);
  } catch {
    throw new ConfigRefusalError("config_value_invalid", mutable);
  }

  return {
    config: next,
    result: {
      schemaVersion: 1,
      key: mutable,
      outcome: serialized === previous ? "unchanged" : "updated",
    },
  };
}
