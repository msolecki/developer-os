import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";

import { EXIT_CODES, failure, success } from "@developer-os/core";
import type { CliResult, ExitCode } from "@developer-os/core";
import { createRedactor } from "@developer-os/security";
import type { Redactor } from "@developer-os/security";

import { failureFrom, readRedactionKey, renderPath } from "../context.js";
import type { CliContext } from "../context.js";
import { doctorExitCode, isDirectory, readConfigFile } from "./doctor.js";
import type { DoctorCheck } from "./doctor.js";
import { PROJECT_TEMPLATE } from "./project-template.js";
import { readUntrustedText, UntrustedFileRefusal } from "./untrusted-file.js";

export const PROJECT_CHECK_MAX_READ_BYTES = 1024 * 1024;
export const PROJECT_INSTRUCTION_WARN_BYTES = 40_000;

const INSTRUCTION_FILES: readonly string[] = ["AGENTS.md", "CLAUDE.md"];

export interface ProjectCheckReportV1 {
  readonly schemaVersion: 1;
  readonly root: string;
  readonly checks: readonly DoctorCheck[];
}

export interface ProjectCheckOptions {
  readonly dir: string | null;
}

export interface ProjectCheckDependencies {
  readonly cwd: () => string;
  readonly templateNames: readonly string[];
}

const DEFAULT_DEPENDENCIES: ProjectCheckDependencies = {
  cwd: () => process.cwd(),
  templateNames: PROJECT_TEMPLATE.map((file) => file.name),
};

interface Finding {
  readonly check: DoctorCheck;
  readonly code: ExitCode;
}

interface Problem {
  readonly line: string;
  readonly path: string;
  readonly code: ExitCode;
}

export class ProjectCheckFailure extends Error {
  readonly code: ExitCode;

  constructor(code: ExitCode, message: string) {
    super(message);
    this.name = "ProjectCheckFailure";
    this.code = code;
  }
}

async function userPatterns(context: CliContext): Promise<readonly string[]> {
  try {
    const config = await readConfigFile(context, context.paths.configFile);
    return config?.redaction?.patterns ?? [];
  } catch {
    // The check needs no installed product, so an unreadable configuration means no patterns.
    return [];
  }
}

/**
 * `foundation.md` §13.2: a finding is reported at the first unclaimed line whose own redaction yields the
 * same class, and at `null` when no single line does (a multi-line key block).
 */
function secretFindings(name: string, text: string, redact: Redactor): readonly string[] {
  const whole = redact(text).findings;
  if (whole.length === 0) return [];
  const occurrences = text.split("\n").flatMap((line, index) =>
    redact(line).findings.map((finding) => ({ class: finding.class, line: index + 1, used: false })),
  );
  return whole.map((finding) => {
    const match = occurrences.find((entry) => !entry.used && entry.class === finding.class);
    if (match !== undefined) match.used = true;
    return `${name}: ${finding.class} (line ${match === undefined ? "null" : String(match.line)})`;
  });
}

function finding(
  id: string,
  status: DoctorCheck["status"],
  message: string,
  paths: readonly string[],
  code: ExitCode = EXIT_CODES.success,
): Finding {
  return { check: { id, status, message, paths }, code };
}

export async function runProjectCheck(
  context: CliContext,
  options: ProjectCheckOptions,
  dependencies: ProjectCheckDependencies = DEFAULT_DEPENDENCIES,
): Promise<CliResult<ProjectCheckReportV1>> {
  try {
    const target = resolve(dependencies.cwd(), options.dir ?? ".");
    const root = await context.guards.canonicalize(target);
    if ((await isDirectory(context, root)) !== true) {
      return failure(EXIT_CODES.invalidInput, {
        kind: "project_root_not_directory",
        message: "the project directory does not exist or is not a directory",
        paths: [target],
      });
    }

    const redact = createRedactor(readRedactionKey(context.paths.stateDir) ?? randomBytes(32), {
      userPatterns: await userPatterns(context),
    });

    const names = [...new Set([...INSTRUCTION_FILES, ...dependencies.templateNames])];
    const present = new Set<string>();
    const oversized: string[] = [];
    const problems: Problem[] = [];
    const unread: Problem[] = [];

    for (const name of names) {
      const path = join(root, name);
      let stats;
      try {
        stats = await context.fs.lstat(path, { bigint: true });
      } catch {
        continue;
      }
      present.add(name);
      if (
        INSTRUCTION_FILES.includes(name) &&
        stats.isFile() &&
        stats.size > BigInt(PROJECT_INSTRUCTION_WARN_BYTES)
      ) {
        oversized.push(name);
      }

      let text: string;
      try {
        text = await readUntrustedText(context, path, PROJECT_CHECK_MAX_READ_BYTES);
      } catch (error) {
        if (!(error instanceof UntrustedFileRefusal)) throw error;
        // `foundation.md` §13.2: only a redactor finding (5) or the read bound (1) fails; an unread link or special file warns.
        (error.reason === "too_large" ? problems : unread).push({
          line: `${name}: ${error.message}`,
          path,
          code: error.code,
        });
        continue;
      }
      for (const line of secretFindings(name, text, redact)) {
        problems.push({ line, path, code: EXIT_CODES.securityRefusal });
      }
    }

    const missingTemplates = dependencies.templateNames.filter((name) => !present.has(name));
    // Exit codes 6..1 in numeric order are doctor's EXIT_PRECEDENCE, so the largest is the most severe.
    const secretsCode = problems.reduce<ExitCode>(
      (worst, problem) => (problem.code > worst ? problem.code : worst),
      EXIT_CODES.operationalFailure,
    );

    const findings: readonly Finding[] = [
      INSTRUCTION_FILES.some((name) => present.has(name))
        ? finding("instruction-file", "pass", "an instruction file is present", [])
        : finding("instruction-file", "warn", `neither ${INSTRUCTION_FILES.join(" nor ")} exists`, []),
      oversized.length === 0
        ? finding(
            "instruction-size",
            "pass",
            `every instruction file is at most ${String(PROJECT_INSTRUCTION_WARN_BYTES)} bytes`,
            [],
          )
        : finding(
            "instruction-size",
            "warn",
            `${oversized.join(", ")} exceeds ${String(PROJECT_INSTRUCTION_WARN_BYTES)} bytes`,
            oversized.map((name) => join(root, name)),
          ),
      problems.length > 0
        ? finding(
            "instruction-secrets",
            "fail",
            problems.map((problem) => problem.line).join("; "),
            [...new Set(problems.map((problem) => problem.path))],
            secretsCode,
          )
        : unread.length > 0
          ? finding(
              "instruction-secrets",
              "warn",
              `not scanned: ${unread.map((entry) => entry.line).join("; ")}`,
              unread.map((entry) => entry.path),
            )
          : finding("instruction-secrets", "pass", "no secret was found in the scanned files", []),
      missingTemplates.length === 0
        ? finding("template-set", "pass", "every project template file is present", [])
        : finding(
            "template-set",
            "warn",
            `${missingTemplates.join(", ")} is absent`,
            missingTemplates.map((name) => join(root, name)),
          ),
    ];

    const report: ProjectCheckReportV1 = {
      schemaVersion: 1,
      root,
      checks: findings.map((entry) => entry.check),
    };
    const code = doctorExitCode(findings);
    if (code === EXIT_CODES.success) return success(report);

    const failed = report.checks.filter((entry) => entry.status === "fail");
    return failureFrom(
      context,
      new ProjectCheckFailure(code, failed.map((entry) => `${entry.id}: ${entry.message}`).join("; ")),
      failed.flatMap((entry) => entry.paths),
      undefined,
      report,
    );
  } catch (error) {
    return failureFrom(context, error);
  }
}

export function renderProjectCheck(report: ProjectCheckReportV1): readonly string[] {
  return report.checks.map(
    (check) => `[${check.status}] ${check.id}: ${renderPath(check.message)}`,
  );
}
