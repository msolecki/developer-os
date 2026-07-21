import { isAbsolute, join, normalize } from "node:path";

import type {
  DeveloperOsConfigV1,
  PathEnvironment,
  RuntimePaths,
} from "./types.js";

function validateAbsolutePath(value: string, label: string): string {
  if (value.length === 0) {
    throw new Error(`${label} must not be empty`);
  }

  if (value.includes("\0")) {
    throw new Error(`${label} must not contain NUL bytes`);
  }

  if (!isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path`);
  }

  return normalize(value);
}

export function resolveRuntimePaths(
  environment: PathEnvironment,
  config?: DeveloperOsConfigV1,
): RuntimePaths {
  const home = validateAbsolutePath(
    environment.DEVELOPER_OS_HOME ?? join(environment.HOME, ".developer-os"),
    "Developer OS home",
  );
  const brain = validateAbsolutePath(
    environment.DEVELOPER_OS_BRAIN ??
      config?.brainPath ??
      join(environment.HOME, "DeveloperBrain"),
    "Developer Brain",
  );

  return {
    home,
    configFile: join(home, "config.toml"),
    manifestFile: join(home, "installation-manifest.json"),
    stateDir: join(home, "state"),
    stagingDir: join(home, "staging"),
    backupsDir: join(home, "backups"),
    logsDir: join(home, "logs"),
    brain,
  };
}
