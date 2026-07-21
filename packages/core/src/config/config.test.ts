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

describe("serializeConfig", () => {
  it("emits canonical TOML bytes including the final newline", () => {
    expect(serializeConfig(loadConfig(validToml))).toBe(validToml);
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
