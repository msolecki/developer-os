import { EXIT_CODES, failure } from "@developer-os/core";
import type { CliResult } from "@developer-os/core";

import { renderPath } from "../context.js";
import type { CliContext } from "../context.js";

export const IMPORT_MAX_ENTRIES_WALKED = 10_000;
export const IMPORT_MAX_DEPTH = 16;
export const IMPORT_MAX_FILES_PER_RUN = 1_000;
export const IMPORT_MAX_MEMORY_PROJECTS = 1_000;

export interface ImportFileResultV1 {
  readonly path: string; // source-relative, redacted
  readonly outcome: "imported" | "skipped" | "refused" | "would_import";
  readonly captureId: string | null;
  readonly reason: string | null; // spec §5.6 reason, or "unsupported_type"
  readonly redactionCount: number;
}

export interface ImportResultV1 {
  readonly schemaVersion: 1;
  readonly source: "inbox" | "path" | "claude-memory";
  readonly dryRun: boolean;
  readonly files: readonly ImportFileResultV1[];
  readonly duplicateCount: number;
  readonly remaining: number;
}

export interface ImportOptions {
  readonly path: string | null;
  readonly claudeMemory: boolean;
  readonly limit: number | null;
  readonly dryRun: boolean;
}

export function runImport(
  context: CliContext,
  options: ImportOptions,
): Promise<CliResult<ImportResultV1>> {
  return Promise.resolve(failure(EXIT_CODES.capabilityUnavailable, {
    kind: "not_implemented",
    message: `developer-os import${options.claudeMemory ? " --claude-memory" : ""} is not implemented yet`,
    paths: [],
  }));
}

export function renderImport(result: ImportResultV1): readonly string[] {
  const imported = result.files.filter((file) => file.outcome === "imported").length;
  return [
    ...result.files.map(
      (file) =>
        `  ${file.outcome} ${renderPath(file.path)}${file.reason === null ? "" : ` (${renderPath(file.reason)})`}`,
    ),
    `imported ${String(imported)}, duplicates ${String(result.duplicateCount)}, remaining ${String(result.remaining)}`,
  ];
}
