import { describe, expect, it } from "vitest";

import { loadConfig, resolveRuntimePaths, serializeConfig } from "./index.js";

const validToml = `schemaVersion = 1
brainPath = "/Users/test/DeveloperBrain"
telemetry = false

[adapters]
claude = true
codex = false

[git]
enabled = false

[automation]
enabled = false
`;

const validConfig = {
  schemaVersion: 1,
  brainPath: "/Users/test/DeveloperBrain",
  adapters: {
    claude: true,
    codex: false,
  },
  git: {
    enabled: false,
  },
  automation: {
    enabled: false,
  },
  telemetry: false,
};

describe("loadConfig", () => {
  it("parses the strict version-1 configuration", () => {
    expect(loadConfig(validToml)).toStrictEqual(validConfig);
  });

  it.each([
    {
      name: "malformed TOML",
      source: `${validToml}\n[unfinished`,
    },
    {
      name: "an unknown root key",
      source: validToml.replace(
        "telemetry = false",
        "telemetry = false\nunknown = true",
      ),
    },
    {
      name: "an unknown nested key",
      source: validToml.replace("codex = false", "codex = false\nother = true"),
    },
    {
      name: "enabled telemetry",
      source: validToml.replace("telemetry = false", "telemetry = true"),
    },
    {
      name: "a relative brain path",
      source: validToml.replace(
        'brainPath = "/Users/test/DeveloperBrain"',
        'brainPath = "DeveloperBrain"',
      ),
    },
    {
      name: "an empty brain path",
      source: validToml.replace(
        'brainPath = "/Users/test/DeveloperBrain"',
        'brainPath = ""',
      ),
    },
    {
      name: "a NUL-containing brain path",
      source: validToml.replace(
        'brainPath = "/Users/test/DeveloperBrain"',
        'brainPath = "/Users/test/Developer\0Brain"',
      ),
    },
  ])("rejects $name", ({ source }) => {
    expect(() => loadConfig(source)).toThrow();
  });
});

const brainToml = `${validToml}
[brain]
schemaVersion = 1
contentRoot = "content"
topicFolders = ["DEV", "PROJECTS"]
indexesDir = "_indexes"

[brain.topicAliases]
PROJEKTY = "PROJECTS"

[brain.retrieval]
maxCandidates = 25

[brain.staleness]
reviewAfterDays = 90
`;

describe("brain configuration section", () => {
  it("loads a configuration written before the section existed", () => {
    expect(loadConfig(validToml).brain).toBeUndefined();
  });

  it("loads an explicit section", () => {
    const config = loadConfig(brainToml);

    expect(config.brain?.topicAliases).toStrictEqual({ PROJEKTY: "PROJECTS" });
    expect(config.brain?.retrieval.maxCandidates).toBe(25);
    expect(config.brain?.staleness.reviewAfterDays).toBe(90);
    expect(config.brain?.topicFolders).toStrictEqual(["DEV", "PROJECTS"]);
  });

  /**
   * Regression, pinned rather than only fixed: an earlier `pathSegmentSchema`
   * refused any glob metacharacter, which made this schema — governing
   * `topicFolders` and every root — reject `!inbox`, the standard Obsidian
   * convention for sorting a folder to the top of an alphabetical listing,
   * alongside any other ordinary name that happens to use one. The failure
   * was total: `loadConfig` throws, so the CLI cannot start for a vault
   * already using such a name, and `serializeConfig` throws on the same
   * value, so the file cannot be rewritten to fix it either. Glob
   * metacharacters are mitigated by escaping at the one place a root is
   * spliced into a glob (`resolveScopeGlob` in `packages/workflow-schema`),
   * not by refusing them as names here.
   */
  it("loads topic folders and roots that use ordinary glob-metacharacter naming conventions", () => {
    const source = brainToml
      .replace('contentRoot = "content"', 'contentRoot = "content (v2)"')
      .replace('indexesDir = "_indexes"', 'indexesDir = "_indexes!"')
      .replace('["DEV", "PROJECTS"]', '["!inbox", "PROJECTS (2024)"]')
      .replace('PROJEKTY = "PROJECTS"', 'PROJEKTY = "PROJECTS (2024)"');

    const config = loadConfig(source);

    expect(config.brain?.contentRoot).toBe("content (v2)");
    expect(config.brain?.indexesDir).toBe("_indexes!");
    expect(config.brain?.topicFolders).toStrictEqual(["!inbox", "PROJECTS (2024)"]);
  });

  it.each([
    {
      name: "a topic folder that is a path rather than a segment",
      source: brainToml.replace('["DEV", "PROJECTS"]', '["../escape"]'),
    },
    {
      name: "a content root containing a separator",
      source: brainToml.replace('contentRoot = "content"', 'contentRoot = "a/b"'),
    },
    {
      name: "an empty topic folder list",
      source: brainToml.replace('["DEV", "PROJECTS"]', "[]"),
    },
    {
      name: "an unknown key inside the section",
      source: brainToml.replace("contentRoot =", "unknown = true\ncontentRoot ="),
    },
    {
      name: "a non-integer candidate maximum",
      source: brainToml.replace("maxCandidates = 25", "maxCandidates = 2.5"),
    },
    {
      name: "a candidate maximum below one",
      source: brainToml.replace("maxCandidates = 25", "maxCandidates = 0"),
    },
    /**
     * The six cases above are all caught by the separator check, which left the
     * `.` and `..` comparisons and the alias *key* schema pinned by nothing — a
     * reviewer proved both could be deleted with the suite still green.
     */
    {
      name: "a parent-directory content root",
      source: brainToml.replace('contentRoot = "content"', 'contentRoot = ".."'),
    },
    {
      name: "a parent-directory index directory",
      source: brainToml.replace('indexesDir = "_indexes"', 'indexesDir = ".."'),
    },
    {
      name: "a current-directory topic folder",
      source: brainToml.replace('["DEV", "PROJECTS"]', '["."]'),
    },
    {
      name: "an alias key that is a path",
      source: brainToml.replace("PROJEKTY =", '"../escape" ='),
    },
    {
      /**
       * Named for the rule that actually fires. A reviewer proved the alias
       * *value* schema can be deleted with the suite still green, because
       * membership rejects `../escape` first — and membership is sound, since
       * every `topicFolders` entry is itself a validated segment.
       */
      name: "an alias value that is a path, via the membership rule",
      source: brainToml.replace('PROJEKTY = "PROJECTS"', 'PROJEKTY = "../escape"'),
    },
    {
      name: "an alias key JavaScript treats as special",
      source: brainToml.replace("PROJEKTY =", '"__proto__" ='),
    },
    {
      name: "an alias naming a folder that is not a topic",
      source: brainToml.replace('PROJEKTY = "PROJECTS"', 'PROJEKTY = "ABSENT"'),
    },
    {
      name: "topic folders that repeat",
      source: brainToml.replace('["DEV", "PROJECTS"]', '["DEV", "PROJECTS", "DEV"]'),
    },
    {
      name: "topic folders that collide case-insensitively on APFS",
      source: brainToml.replace('["DEV", "PROJECTS"]', '["DEV", "PROJECTS", "dev"]'),
    },
    {
      name: "a staleness threshold beyond any real review cadence",
      source: brainToml.replace("reviewAfterDays = 90", "reviewAfterDays = 99999999999"),
    },
    {
      name: "topic folders colliding only after Unicode normalization",
      /**
       * TOML \uXXXX escapes, so the distinction survives this source file: the
       * first is a composed e-acute, the second is `e` plus a combining acute.
       * Two entries here, one directory on the default macOS volume.
       */
      source: brainToml.replace(
        '["DEV", "PROJECTS"]',
        '["DEV", "PROJECTS", "caf\\u00E9", "cafe\\u0301"]',
      ),
    },
    {
      name: "an alias key that is itself a topic folder",
      source: brainToml.replace("PROJEKTY =", '"DEV" ='),
    },
    {
      name: "an alias pointing a topic folder at itself",
      source: brainToml.replace('PROJEKTY = "PROJECTS"', 'PROJECTS = "PROJECTS"'),
    },
    {
      name: "an alias key that is a topic folder under case folding",
      source: brainToml.replace("PROJEKTY =", '"dev" ='),
    },
  ])("rejects $name", ({ source }) => {
    expect(() => loadConfig(source)).toThrow();
  });

  it("keeps an alias map free of inherited members", () => {
    const aliases = loadConfig(brainToml).brain?.topicAliases;

    expect(Object.hasOwn(aliases ?? {}, "PROJEKTY")).toBe(true);
    expect(Object.hasOwn(aliases ?? {}, "toString")).toBe(false);
  });
});

const redactionToml = `${validToml}
[redaction]
patterns = ["Northwind Traders", "acme-internal"]
`;

/**
 * Spec §8.2 describes a user-extensible redaction class — the one a founder uses for a
 * client name no generic pattern catches. `redactText` has always taken the parameter,
 * no production caller passed it, and `configSchema` was `.strict()` with no table to set,
 * so the feature was specified and never wired (BACKLOG NEW-16, closed 2026-08-17 — the
 * cases below are what closed it, so the present tense here was false the moment they
 * passed).
 *
 * Adding the table amends the schema `foundation.md` §2 froze; BACKLOG §8 carries the row.
 */
describe("redaction configuration section", () => {
  it("parses a table of literal patterns", () => {
    expect(loadConfig(redactionToml).redaction?.patterns).toStrictEqual([
      "Northwind Traders",
      "acme-internal",
    ]);
  });

  /**
   * `indexOf("")` matches at every position, so one empty entry would redact the whole of
   * every text this product handles — and the failure would look like the redactor
   * working.
   */
  it("refuses an empty pattern, which would match at every position", () => {
    expect(() => loadConfig(`${validToml}\n[redaction]\npatterns = [""]\n`)).toThrow();
  });

  /**
   * The bound the empty-string rule was actually reaching for: a single space matches
   * between every word of every text, and passed a `min(1)` justified by the empty string.
   */
  it("refuses a pattern that is only whitespace", () => {
    for (const pattern of [" ", "\\t", "   "]) {
      expect(
        () => loadConfig(`${validToml}\n[redaction]\npatterns = ["${pattern}"]\n`),
        pattern,
      ).toThrow();
    }
  });

  /**
   * **A three-character floor was tried and withdrawn**, and these are the names it
   * refused: registered two-letter companies, and CJK names where two characters is the
   * ordinary length. A user with a Chinese client could not configure it at all.
   */
  it("accepts a real two-character company name, in any script", () => {
    for (const pattern of ["EY", "BP", "3M", "\\u7d22\\u5c3c"]) {
      expect(
        loadConfig(`${validToml}\n[redaction]\npatterns = ["${pattern}"]\n`).redaction
          ?.patterns,
        pattern,
      ).toHaveLength(1);
    }
  });

  it("refuses an unknown key inside the table, because the schema is strict", () => {
    expect(() =>
      loadConfig(`${validToml}\n[redaction]\npatterns = ["a"]\nreplacement = "b"\n`),
    ).toThrow();
  });

  /** A configuration written before this table existed must keep loading unchanged. */
  it("leaves a configuration that predates the table untouched", () => {
    expect(loadConfig(validToml).redaction).toBeUndefined();
    expect(loadConfig(validToml)).toStrictEqual(validConfig);
  });

  it("round-trips through serializeConfig", () => {
    expect(loadConfig(serializeConfig(loadConfig(redactionToml)))).toStrictEqual(
      loadConfig(redactionToml),
    );
  });

  /**
   * The other half of the round-trip, and the reason `brain` is emitted conditionally: an
   * `undefined` value makes `stringify` write an empty `[redaction]` table, which would
   * rewrite every existing configuration on the first save that touched it.
   */
  it("emits no empty table for a configuration that has none", () => {
    expect(serializeConfig(loadConfig(validToml))).not.toContain("[redaction]");
  });
});

describe("serializeConfig", () => {
  it("emits canonical TOML bytes including the final newline", () => {
    expect(serializeConfig(loadConfig(validToml))).toBe(validToml);
  });

  it("omits the brain section entirely when it is absent", () => {
    expect(serializeConfig(loadConfig(validToml))).not.toContain("[brain");
  });

  it("round-trips an explicit brain section", () => {
    expect(loadConfig(serializeConfig(loadConfig(brainToml)))).toStrictEqual(
      loadConfig(brainToml),
    );
  });
});

describe("resolveRuntimePaths", () => {
  it("uses deterministic runtime defaults", () => {
    expect(resolveRuntimePaths({ HOME: "/Users/test" })).toStrictEqual({
      home: "/Users/test/.developer-os",
      configFile: "/Users/test/.developer-os/config.toml",
      manifestFile: "/Users/test/.developer-os/installation-manifest.json",
      stateDir: "/Users/test/.developer-os/state",
      stagingDir: "/Users/test/.developer-os/staging",
      backupsDir: "/Users/test/.developer-os/backups",
      logsDir: "/Users/test/.developer-os/logs",
      brain: "/Users/test/DeveloperBrain",
    });
  });

  it("uses the parsed configuration brain path over the default", () => {
    expect(
      resolveRuntimePaths({ HOME: "/Users/test" }, loadConfig(validToml)),
    ).toStrictEqual({
      home: "/Users/test/.developer-os",
      configFile: "/Users/test/.developer-os/config.toml",
      manifestFile: "/Users/test/.developer-os/installation-manifest.json",
      stateDir: "/Users/test/.developer-os/state",
      stagingDir: "/Users/test/.developer-os/staging",
      backupsDir: "/Users/test/.developer-os/backups",
      logsDir: "/Users/test/.developer-os/logs",
      brain: "/Users/test/DeveloperBrain",
    });
  });

  it("uses environment overrides over the parsed configuration", () => {
    expect(
      resolveRuntimePaths(
        {
          HOME: "/Users/test",
          DEVELOPER_OS_HOME: "/Volumes/State/developer-os",
          DEVELOPER_OS_BRAIN: "/Volumes/Knowledge/Brain",
        },
        loadConfig(validToml),
      ),
    ).toStrictEqual({
      home: "/Volumes/State/developer-os",
      configFile: "/Volumes/State/developer-os/config.toml",
      manifestFile: "/Volumes/State/developer-os/installation-manifest.json",
      stateDir: "/Volumes/State/developer-os/state",
      stagingDir: "/Volumes/State/developer-os/staging",
      backupsDir: "/Volumes/State/developer-os/backups",
      logsDir: "/Volumes/State/developer-os/logs",
      brain: "/Volumes/Knowledge/Brain",
    });
  });

  it.each([
    {
      name: "a relative DEVELOPER_OS_HOME",
      environment: {
        HOME: "/Users/test",
        DEVELOPER_OS_HOME: "developer-os",
      },
    },
    {
      name: "an empty DEVELOPER_OS_HOME",
      environment: {
        HOME: "/Users/test",
        DEVELOPER_OS_HOME: "",
      },
    },
    {
      name: "a NUL-containing DEVELOPER_OS_HOME",
      environment: {
        HOME: "/Users/test",
        DEVELOPER_OS_HOME: "/Users/test/developer\0-os",
      },
    },
    {
      name: "a relative DEVELOPER_OS_BRAIN",
      environment: {
        HOME: "/Users/test",
        DEVELOPER_OS_BRAIN: "DeveloperBrain",
      },
    },
    {
      name: "an empty DEVELOPER_OS_BRAIN",
      environment: {
        HOME: "/Users/test",
        DEVELOPER_OS_BRAIN: "",
      },
    },
    {
      name: "a NUL-containing DEVELOPER_OS_BRAIN",
      environment: {
        HOME: "/Users/test",
        DEVELOPER_OS_BRAIN: "/Users/test/Developer\0Brain",
      },
    },
  ])("rejects $name", ({ environment }) => {
    expect(() => resolveRuntimePaths(environment)).toThrow();
  });
});
