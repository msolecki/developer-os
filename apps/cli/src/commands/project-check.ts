import { EXIT_CODES, failure } from "@developer-os/core";
import type { CliResult } from "@developer-os/core";

import { renderPath } from "../context.js";
import type { CliContext } from "../context.js";
import type { DoctorCheck } from "./doctor.js";

export interface ProjectCheckReportV1 {
  readonly schemaVersion: 1;
  readonly root: string;
  readonly checks: readonly DoctorCheck[];
}

export interface ProjectCheckOptions {
  readonly dir: string | null;
}

export function runProjectCheck(
  context: CliContext,
  options: ProjectCheckOptions,
): Promise<CliResult<ProjectCheckReportV1>> {
  return Promise.resolve(failure(EXIT_CODES.capabilityUnavailable, {
    kind: "not_implemented",
    message: `developer-os project check${options.dir === null ? "" : " <dir>"} is not implemented yet`,
    paths: [],
  }));
}

export function renderProjectCheck(report: ProjectCheckReportV1): readonly string[] {
  return report.checks.map(
    (check) => `[${check.status}] ${check.id}: ${renderPath(check.message)}`,
  );
}
