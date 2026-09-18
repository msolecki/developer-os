import { describe, expect, it } from "vitest";

import { encodeCanonicalJson } from "../lifecycle/canonical-json.js";
import {
  CONFIG_MUTABLE_KEYS,
  CONFIG_READABLE_KEYS,
  ConfigRefusalError,
  parseConfigReadableKey,
  publishableConfig,
  readConfigValue,
  setConfigValue,
  type ConfigMutableKeyV1,
  type ConfigReadableKeyV1,
} from "./keys.js";
import { gitScopeFingerprint, type GitScopeSnapshotV1 } from "./lifecycle.js";
import { loadConfig, serializeConfig } from "./loader.js";
import type { DeveloperOsConfigV1 } from "./types.js";

const BRAIN_PATH = "/Users/test/DeveloperBrain";

/**
 * The one string no projection, result, error or hash may ever carry. It is the sole
 * entry of `redaction.patterns` in every fixture below, so any leak is this exact
 * substring and every test can look for it by identity.
 */
const PATTERN_SENTINEL = "solkova-sentinel-client";

const SCOPE = {
  brainPath: BRAIN_PATH,
  contentRoot: "content",
  topicFolders: ["DEV", "PROJECTS"],
  topicAliases: { PROJEKTY: "PROJECTS" },
  indexesDir: "_indexes",
};

const SCOPE_FINGERPRINT = gitScopeFingerprint(
  SCOPE as unknown as Omit<GitScopeSnapshotV1, "fingerprint">,
);

const CONFIG_HEAD = `schemaVersion = 1
brainPath = "${BRAIN_PATH}"
telemetry = false

[adapters]
claude = false
codex = false
`;

const GIT_LIFECYCLE_TOML = `
[git.lifecycle]
schemaVersion = 1
repositoryRoot = "${BRAIN_PATH}"
branch = "main"

[git.lifecycle.remote]
name = "developer-os"
transport = "local"
declaredUrl = "file:///Users/test/git/brain.git"
effectivePushUrl = "file:///Users/test/git/brain.git"

[git.lifecycle.scope]
brainPath = "${BRAIN_PATH}"
contentRoot = "content"
topicFolders = ["DEV", "PROJECTS"]
indexesDir = "_indexes"
fingerprint = "${SCOPE_FINGERPRINT}"

[git.lifecycle.scope.topicAliases]
PROJEKTY = "PROJECTS"
`;

const AUTOMATION_LIFECYCLE_TOML = `
[automation.lifecycle]
schemaVersion = 1

[[automation.lifecycle.schedules]]
job = "brain-reindex"
schedule = { cadence = "daily", hour = 2, minute = 0 }

[[automation.lifecycle.schedules]]
job = "brain-lint"
schedule = { cadence = "daily", hour = 2, minute = 30 }

[[automation.lifecycle.schedules]]
job = "doctor"
schedule = { cadence = "weekly", day = "mon", hour = 3, minute = 0 }

[[automation.lifecycle.schedules]]
job = "git-sync"
schedule = { cadence = "hourly", minute = 15 }
`;

const OPTIONAL_SECTIONS_TOML = `
[brain]
schemaVersion = 1
contentRoot = "content"
topicFolders = ["DEV", "PROJECTS"]
indexesDir = "_indexes"

[brain.topicAliases]
PROJEKTY = "PROJECTS"

[brain.retrieval]
maxCandidates = 12

[brain.staleness]
reviewAfterDays = 14

[redaction]
patterns = ["${PATTERN_SENTINEL}"]
`;

/**
 * Git is disabled while the identity record is retained: Spec 1 §2.2's `brainPath`
 * rule names exactly that state, and `git disable` produces it.
 */
const configWithEverything = loadConfig(
  `${CONFIG_HEAD}
[git]
enabled = false
${GIT_LIFECYCLE_TOML}
[automation]
enabled = true
${AUTOMATION_LIFECYCLE_TOML}${OPTIONAL_SECTIONS_TOML}`,
);

const configWithoutLifecycle = loadConfig(
  `${CONFIG_HEAD}
[git]
enabled = false

[automation]
enabled = false
${OPTIONAL_SECTIONS_TOML}`,
);

const minimalConfig = loadConfig(`${CONFIG_HEAD}
[git]
enabled = false

[automation]
enabled = false
`);

function refusal(run: () => unknown): ConfigRefusalError {
  try {
    run();
  } catch (error) {
    if (error instanceof ConfigRefusalError) return error;
    throw error;
  }
  throw new Error("expected a ConfigRefusalError");
}

const READ_ONLY_KEYS = CONFIG_READABLE_KEYS.filter(
  (key) => !CONFIG_MUTABLE_KEYS.includes(key as ConfigMutableKeyV1),
);

describe("the closed config key sets", () => {
  it("enumerates exactly the Spec 1 key unions", () => {
    expect(CONFIG_READABLE_KEYS).not.toHaveLength(0);
    expect(CONFIG_MUTABLE_KEYS).not.toHaveLength(0);
    expect(CONFIG_READABLE_KEYS).toHaveLength(24);
    expect(CONFIG_MUTABLE_KEYS).toHaveLength(14);
    expect(CONFIG_MUTABLE_KEYS.every((key) => CONFIG_READABLE_KEYS.includes(key))).toBe(true);
  });

  it("lists the readable keys in the Spec 1 §2.2 order", () => {
    expect([...CONFIG_READABLE_KEYS]).toStrictEqual([
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
    ]);
  });

  it("lists the mutable keys in the Spec 1 §2.2 order", () => {
    expect([...CONFIG_MUTABLE_KEYS]).toStrictEqual([
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
    ]);
  });

  it.each(CONFIG_READABLE_KEYS)("admits %s as a readable key", (key) => {
    expect(parseConfigReadableKey(key)).toBe(key);
  });

  it.each([
    "",
    "adapter",
    "brain.",
    ".brain",
    "brain.retrieval.maxCandidates.x",
    "git.enabled.value",
    "BRAINPATH",
    "redaction.patterns.0",
    "__proto__",
    "constructor",
    "toString",
  ])("refuses the undeclared key %s", (key) => {
    expect(refusal(() => parseConfigReadableKey(key)).reason).toBe("config_key_unknown");
    expect(refusal(() => setConfigValue(configWithEverything, key, "true")).reason).toBe(
      "config_key_unknown",
    );
  });
});

describe("publishableConfig", () => {
  it("keeps the DeveloperOsConfigV1 key order and replaces redaction with its count", () => {
    const projection = publishableConfig(configWithEverything);
    expect(Object.keys(projection)).toStrictEqual([
      "schemaVersion",
      "brainPath",
      "adapters",
      "git",
      "automation",
      "brain",
      "redaction",
      "telemetry",
    ]);
    expect(projection.redaction).toStrictEqual({ patternsCount: 1 });
    expect(JSON.stringify(projection)).not.toContain(PATTERN_SENTINEL);
  });

  /**
   * The order literal above is a list, so a member added to `DeveloperOsConfigV1` — which is
   * what the amendment in Task 4 did — would be dropped from the projection, made unreadable
   * through every key, and leave this file green. The projection stays an explicit literal:
   * deriving it from `Object.entries` would be fail-open for a future secret-bearing field.
   */
  it("projects every member of the configuration it was given", () => {
    const projection = publishableConfig(configWithEverything);
    expect(Object.keys(configWithEverything)).not.toHaveLength(0);
    expect(Object.keys(projection).sort()).toStrictEqual(
      Object.keys(configWithEverything).sort(),
    );
  });

  it("omits an absent redaction table rather than publishing a zero count", () => {
    expect(Object.hasOwn(publishableConfig(minimalConfig), "redaction")).toBe(false);
  });
});

describe("readConfigValue", () => {
  it("returns the whole publishable projection for the null key", () => {
    const result = readConfigValue(configWithEverything, null);
    expect(result).toStrictEqual({
      schemaVersion: 1,
      key: null,
      value: publishableConfig(configWithEverything),
    });
    expect(encodeCanonicalJson(result as never)).not.toContain(PATTERN_SENTINEL);
  });

  it.each(CONFIG_READABLE_KEYS)("reads %s from the publishable projection only", (key) => {
    const result = readConfigValue(configWithEverything, key);
    expect(result.schemaVersion).toBe(1);
    expect(result.key).toBe(key);
    expect(JSON.stringify(result)).not.toContain(PATTERN_SENTINEL);
    expect(encodeCanonicalJson(result as never)).not.toContain(PATTERN_SENTINEL);
  });

  it.each([
    ["schemaVersion", 1],
    ["brainPath", BRAIN_PATH],
    ["adapters.claude", false],
    ["brain.schemaVersion", 1],
    ["brain.contentRoot", "content"],
    ["brain.retrieval.maxCandidates", 12],
    ["brain.staleness.reviewAfterDays", 14],
    ["git.enabled", false],
    ["automation.enabled", true],
    ["telemetry", false],
  ] as const)("reads %s as its own value", (key, value) => {
    expect(readConfigValue(configWithEverything, key).value).toStrictEqual(value);
  });

  it("returns only the integer count for redaction and redaction.patterns", () => {
    expect(readConfigValue(configWithEverything, "redaction").value).toStrictEqual({
      patternsCount: 1,
    });
    expect(readConfigValue(configWithEverything, "redaction.patterns").value).toBe(1);
  });

  it.each([
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
    "git.lifecycle",
    "automation.lifecycle",
    "redaction",
    "redaction.patterns",
  ] as const)("returns null for the absent section or child %s", (key) => {
    expect(readConfigValue(minimalConfig, key).value).toBeNull();
  });

  it("refuses an undeclared key", () => {
    expect(
      refusal(() => readConfigValue(minimalConfig, "adapter" as ConfigReadableKeyV1)).reason,
    ).toBe("config_key_unknown");
  });
});

describe("setConfigValue", () => {
  it.each(READ_ONLY_KEYS)("refuses to set the read-only key %s", (key) => {
    const error = refusal(() => setConfigValue(configWithEverything, key, "true"));
    expect(error.reason).toBe("config_key_read_only");
    expect(error.code).toBe(2);
  });

  it("covers every readable key with either a mutable or a read-only case", () => {
    expect(READ_ONLY_KEYS).not.toHaveLength(0);
    expect(READ_ONLY_KEYS).toHaveLength(CONFIG_READABLE_KEYS.length - CONFIG_MUTABLE_KEYS.length);
  });

  it.each([
    ["brain.staleness.reviewAfterDays", "30", "updated"],
    ["adapters.claude", "false", "unchanged"],
    ["redaction", "null", "updated"],
    ["redaction.patterns", '["client-a"]', "updated"],
  ] as const)("sets %s to %s", (key, value, outcome) => {
    expect(setConfigValue(configWithEverything, key, value).result).toStrictEqual({
      schemaVersion: 1,
      key,
      outcome,
    });
  });

  it("returns a config the loader accepts and encodes the result as canonical JSON", () => {
    const mutation = setConfigValue(configWithEverything, "brain.retrieval.maxCandidates", "40");
    expect(mutation.config.brain?.retrieval.maxCandidates).toBe(40);
    expect(loadConfig(serializeConfig(mutation.config))).toStrictEqual(mutation.config);
    expect(encodeCanonicalJson(mutation.result as never)).toBe(
      '{"key":"brain.retrieval.maxCandidates","outcome":"updated","schemaVersion":1}\n',
    );
  });

  it("decides updated against unchanged by comparing serializeConfig output", () => {
    const same = setConfigValue(configWithEverything, "brain.topicFolders", '["DEV","PROJECTS"]');
    expect(same.result.outcome).toBe("unchanged");
    expect(serializeConfig(same.config)).toBe(serializeConfig(configWithEverything));
    const different = setConfigValue(
      configWithEverything,
      "brain.topicFolders",
      '["DEV","PROJECTS","NOTES"]',
    );
    expect(different.result.outcome).toBe("updated");
    expect(serializeConfig(different.config)).not.toBe(serializeConfig(configWithEverything));
  });

  it("never changes an immutable field on a successful set", () => {
    const { config: next } = setConfigValue(
      configWithEverything,
      "brain.staleness.reviewAfterDays",
      "30",
    );
    expect(next.schemaVersion).toBe(configWithEverything.schemaVersion);
    expect(next.telemetry).toBe(configWithEverything.telemetry);
    expect(next.git.enabled).toBe(configWithEverything.git.enabled);
    expect(next.automation.enabled).toBe(configWithEverything.automation.enabled);
    expect(next.git.lifecycle).toStrictEqual(configWithEverything.git.lifecycle);
    expect(next.automation.lifecycle).toStrictEqual(configWithEverything.automation.lifecycle);
    expect(next.brain?.schemaVersion).toBe(1);
  });

  it.each([
    " 30",
    "30\n",
    "1.0",
    "-0",
    '{"a" :1}',
    "'x'",
    "x",
    "TRUE",
    "",
    "maxCandidates = 30",
    "30 30",
    "[1,]",
  ])("refuses the non-canonical value %j", (value) => {
    expect(
      refusal(() =>
        setConfigValue(configWithEverything, "brain.retrieval.maxCandidates", value),
      ).reason,
    ).toBe("config_value_not_canonical_json");
  });

  const WRONG_TYPES: readonly (readonly [ConfigMutableKeyV1, string])[] = [
    ["brainPath", "true"],
    ["adapters.claude", "1"],
    ["adapters.codex", '"true"'],
    ["brain", "1"],
    ["brain.contentRoot", "1"],
    ["brain.topicFolders", '"DEV"'],
    ["brain.topicAliases", "1"],
    ["brain.indexesDir", "true"],
    ["brain.retrieval", "5"],
    ["brain.retrieval.maxCandidates", '"5"'],
    ["brain.staleness", '"x"'],
    ["brain.staleness.reviewAfterDays", "true"],
    ["redaction", "1"],
    ["redaction.patterns", '"client-a"'],
  ];

  it("covers every mutable key with a wrong-type case", () => {
    expect(WRONG_TYPES).not.toHaveLength(0);
    expect(WRONG_TYPES.map(([key]) => key)).toStrictEqual([...CONFIG_MUTABLE_KEYS]);
  });

  it.each(WRONG_TYPES)("refuses the wrong JSON type for %s", (key, value) => {
    expect(refusal(() => setConfigValue(configWithoutLifecycle, key, value)).reason).toBe(
      "config_value_invalid",
    );
  });

  it.each(CONFIG_MUTABLE_KEYS.filter((key) => key !== "brain" && key !== "redaction"))(
    "refuses null for %s",
    (key) => {
      expect(refusal(() => setConfigValue(configWithoutLifecycle, key, "null")).reason).toBe(
        "config_value_invalid",
      );
    },
  );

  it.each(["brain", "redaction"] as const)("removes the whole optional table %s on null", (key) => {
    const mutation = setConfigValue(configWithoutLifecycle, key, "null");
    expect(mutation.result.outcome).toBe("updated");
    expect(Object.hasOwn(mutation.config, key)).toBe(false);
  });

  it.each(
    CONFIG_MUTABLE_KEYS.filter(
      (key) => key.startsWith("brain.") || key === "redaction.patterns",
    ),
  )("refuses %s while its optional parent is absent", (key) => {
    expect(refusal(() => setConfigValue(minimalConfig, key, "1")).reason).toBe(
      "config_parent_absent",
    );
  });

  /**
   * Pins the ordering, not just the reason: the supplied value cannot decode, so this passes
   * only while the state refusal is reached without decoding anything.
   */
  it("refuses an absent parent before decoding the supplied value", () => {
    expect(refusal(() => setConfigValue(minimalConfig, "brain.contentRoot", "'x'")).reason).toBe(
      "config_parent_absent",
    );
  });

  it("refuses an incomplete whole brain section", () => {
    expect(
      refusal(() =>
        setConfigValue(minimalConfig, "brain", '{"contentRoot":"content","schemaVersion":1}'),
      ).reason,
    ).toBe("config_value_invalid");
  });

  it("creates an absent optional section from its complete object", () => {
    const mutation = setConfigValue(
      minimalConfig,
      "redaction",
      `{"patterns":["${PATTERN_SENTINEL}"]}`,
    );
    expect(mutation.result.outcome).toBe("updated");
    expect(mutation.config.redaction?.patterns).toStrictEqual([PATTERN_SENTINEL]);
  });

  it.each(["/Users/test/OtherBrain", BRAIN_PATH])(
    "refuses brainPath as repository identity while a Git lifecycle record exists (%s)",
    (path) => {
      expect(configWithEverything.git.enabled).toBe(false);
      expect(
        refusal(() => setConfigValue(configWithEverything, "brainPath", JSON.stringify(path)))
          .reason,
      ).toBe("config_brain_path_is_repository_identity");
    },
  );

  it("sets brainPath when no Git lifecycle record exists", () => {
    const mutation = setConfigValue(
      configWithoutLifecycle,
      "brainPath",
      '"/Users/test/OtherBrain"',
    );
    expect(mutation.result).toStrictEqual({
      schemaVersion: 1,
      key: "brainPath",
      outcome: "updated",
    });
    expect(mutation.config.brainPath).toBe("/Users/test/OtherBrain");
  });

  it.each([
    '"relative/path"',
    '"/Users/test/../test/DeveloperBrain"',
    `"${BRAIN_PATH}/"`,
  ])(
    "refuses the non-canonical brainPath %s",
    (value) => {
      expect(refusal(() => setConfigValue(configWithoutLifecycle, "brainPath", value)).reason).toBe(
        "config_value_invalid",
      );
    },
  );

  it.each([
    ["redaction.patterns", `["${PATTERN_SENTINEL}","${PATTERN_SENTINEL}x"]`, true],
    ["redaction.patterns", `{"patterns":["${PATTERN_SENTINEL}"]}`, false],
    ["redaction", `{"patterns":["${PATTERN_SENTINEL}"],"extra":1}`, false],
  ] as const)("never echoes the supplied value of %s", (key, value, succeeds) => {
    if (succeeds) {
      const mutation = setConfigValue(configWithoutLifecycle, key, value);
      expect(JSON.stringify(mutation.result)).not.toContain(PATTERN_SENTINEL);
      return;
    }
    const error = refusal(() => setConfigValue(configWithoutLifecycle, key, value));
    expect(error.message).not.toContain(PATTERN_SENTINEL);
    expect(error.message).not.toContain(value);
    expect(error.message).toContain(key);
  });

  it("names neither key nor value in an unknown-key refusal", () => {
    const error = refusal(() => setConfigValue(minimalConfig, PATTERN_SENTINEL, "1"));
    expect(error.message).not.toContain(PATTERN_SENTINEL);
    expect(error.reason).toBe("config_key_unknown");
  });

  it("leaves the supplied configuration untouched", () => {
    const before = serializeConfig(configWithEverything);
    setConfigValue(configWithEverything, "brain.retrieval.maxCandidates", "99");
    expect(serializeConfig(configWithEverything)).toBe(before);
  });

  it("refuses a value larger than the canonical JSON bound", () => {
    const oversized = JSON.stringify("a".repeat(1_048_576));
    expect(
      refusal(() => setConfigValue(configWithoutLifecycle, "brain.contentRoot", oversized)).reason,
    ).toBe("config_value_not_canonical_json");
  });
});

describe("the exported result types", () => {
  it("accepts a mutation as the DeveloperOsConfigV1 the loader would produce", () => {
    const mutation = setConfigValue(configWithoutLifecycle, "adapters.codex", "true");
    const next: DeveloperOsConfigV1 = mutation.config;
    expect(next.adapters.codex).toBe(true);
    expect(mutation.result.outcome).toBe("updated");
  });
});
