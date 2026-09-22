import { EXIT_CODES, failure } from "@developer-os/core";
import type { CliResult } from "@developer-os/core";

import { renderPath } from "../context.js";
import type { CliContext } from "../context.js";

export interface ProjectInitResultV1 {
  readonly schemaVersion: 1;
  readonly root: string;
  readonly created: readonly string[];
  readonly overridden: readonly string[];
  readonly transactionId: string | null;
}

export interface ProjectInitOptions {
  readonly dir: string | null;
  readonly dryRun: boolean;
}

export function runProjectInit(
  context: CliContext,
  options: ProjectInitOptions,
): Promise<CliResult<ProjectInitResultV1>> {
  return Promise.resolve(failure(EXIT_CODES.capabilityUnavailable, {
    kind: "not_implemented",
    message: `developer-os project init${options.dryRun ? " --dry-run" : ""} is not implemented yet`,
    paths: [],
  }));
}

export function renderProjectInit(result: ProjectInitResultV1): readonly string[] {
  return [
    result.transactionId === null
      ? "Developer OS would create:"
      : "Developer OS created:",
    ...result.created.map((path) => `  ${renderPath(path)}`),
  ];
}
