import type { WorkflowContractV1 } from "./contract.js";
import type { WorkflowOverlayV1 } from "./overlay.js";

export interface RenderedArtifact {
  readonly path: string;
  readonly contents: string;
}

/**
 * An interface only. This package declares the shape and implements no
 * renderer — vendor behaviour lives in `adapter-claude` and `adapter-codex`,
 * which consume an already-validated contract, so this package is testable
 * with neither agent installed.
 */
export interface WorkflowRenderer {
  readonly vendor: string;
  render(
    contract: WorkflowContractV1,
    overlay: WorkflowOverlayV1 | null,
  ): readonly RenderedArtifact[];
}

export interface WorkflowDriftFinding {
  readonly path: string;
  readonly line: number | null;
  readonly message: string;
}

export function sourceMarker(
  contract: Pick<WorkflowContractV1, "id" | "version">,
  file: string,
): string {
  return `Generated from ${file} (${contract.id}@${contract.version}). Do not edit.`;
}

/**
 * The first line that differs, 1-based, or `null` when identical. One case
 * reports a line past the end of both files: when the only difference is a
 * trailing newline. That is deliberate — the alternative is reporting no
 * difference at all, and a stripped final newline is exactly what an editor does.
 */
export function firstDifferingLine(
  expected: string,
  actual: string,
): number | null {
  if (expected === actual) return null;
  const left = expected.split("\n");
  const right = actual.split("\n");
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    if (left[index] !== right[index]) return index + 1;
  }
  return shared + 1;
}

/**
 * Reports the artifact and the first differing line, never a diff — the same
 * rule as brain-engine spec §6.3 and for the same reason: a diff echoes content
 * into a terminal and a log.
 *
 * `onDisk` is a `ReadonlyMap` rather than a record on purpose. A plain object
 * would resolve an artifact path of `toString` through `Object.prototype` and
 * compare a `Function` as if it were file contents — the class of defect three
 * other modules in this package were corrected for.
 *
 * **It iterates `expected` only, so an unexpected file on disk produces no
 * finding.** Set equality is the caller's job: an adapter's drift gate has to
 * assert that the two key sets match, in the same case, or a hand-added file
 * passes a check whose name says byte-for-byte. `tests/contracts/adapters/claude/
 * generated.test.ts` is the worked example. Said here because DOS-P5's gate will
 * call this function and reasonably assume otherwise. Found by fresh-context
 * review, 2026-08-11.
 */
export function detectWorkflowDrift(
  expected: readonly RenderedArtifact[],
  onDisk: ReadonlyMap<string, string>,
): readonly WorkflowDriftFinding[] {
  const findings: WorkflowDriftFinding[] = [];
  for (const artifact of expected) {
    const actual = onDisk.get(artifact.path);
    if (actual === undefined) {
      findings.push({
        path: artifact.path,
        line: null,
        message:
          "this artifact has never been generated; run developer-os workflow render",
      });
      continue;
    }
    const line = firstDifferingLine(artifact.contents, actual);
    if (line === null) continue;
    findings.push({
      path: artifact.path,
      line,
      message: "differs from a fresh render; run developer-os workflow render",
    });
  }
  return findings;
}
