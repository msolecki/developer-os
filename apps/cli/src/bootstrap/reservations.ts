import { join } from "node:path";

import type { RuntimePaths } from "@developer-os/core";

const AUTOMATION_JOBS = ["brain-reindex", "brain-lint", "doctor", "git-sync"] as const;
const AUTOMATION_LOG_SLOTS = 10;

export interface V2OnlyProductPathsV1 {
  readonly directories: readonly string[];
  readonly reservations: readonly string[];
}

/** Order is load-bearing: fresh init assigns reservation payload ordinals in this order. */
export function v2OnlyProductPaths(paths: Pick<RuntimePaths, "stateDir" | "logsDir">): V2OnlyProductPathsV1 {
  const { stateDir, logsDir } = paths;
  return {
    directories: [
      join(stateDir, "lifecycle-journals"),
      join(stateDir, "git-effect-journals"),
      join(stateDir, "launchd-effect-journals"),
      join(stateDir, "rollback"),
    ],
    reservations: [
      join(stateDir, "git-sync.json"),
      join(stateDir, "uninstalling.json"),
      join(stateDir, "update-rollback.json"),
      join(stateDir, "update-executor.json"),
      ...AUTOMATION_JOBS.flatMap((job) => [
        join(stateDir, `automation-${job}.json`),
        join(stateDir, `.automation-${job}.lock`),
        ...Array.from({ length: AUTOMATION_LOG_SLOTS }, (_, ordinal) =>
          join(logsDir, `automation-${job}.${String(ordinal)}.json`),
        ),
      ]),
    ],
  };
}
