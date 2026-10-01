/** Spec §3.2's verdict, pure: the inputs are already gathered, so nothing here reads a clock or a file. */
export type PulseVerdictV1 = "healthy" | "attention" | "failure";

export interface PulseInputV1 {
  readonly now: Date;
  readonly doctorFailing: number;
  readonly lintErrors: number;
  readonly quarantined: readonly { readonly createdAt: string }[];
  readonly accepted: readonly { readonly createdAt: string }[];
  readonly notes: number;
  readonly edges: number;
  readonly isolated: number;
  readonly gaps: number;
  readonly indexGeneratedAt: string | null;
  /** Newest first, at most two. */
  readonly gardenLast: readonly ("success" | "skipped_review_queue_full" | "failed" | "other")[];
}

export interface PulseHeaderV1 {
  readonly date: string;
  readonly verdict: PulseVerdictV1;
  readonly isolated: number;
  readonly isolatedGrew: boolean;
}

const DAY_MS = 86_400_000;
const CAPTURE_WAIT_DAYS = 14;
const INDEX_MAX_AGE_DAYS = 8;

function olderThan(now: Date, timestamp: string, days: number): boolean {
  const at = Date.parse(timestamp);
  return Number.isFinite(at) && now.getTime() - at > days * DAY_MS;
}

export function computePulse(
  input: PulseInputV1,
  previous: PulseHeaderV1 | null,
): { readonly header: PulseHeaderV1; readonly reasons: readonly string[] } {
  const failures: string[] = [];
  if (input.doctorFailing > 0) failures.push("doctor_check_failing");
  if (input.lintErrors > 0) failures.push("lint_errors");
  if (input.gardenLast[0] === "failed" && input.gardenLast[1] === "failed") failures.push("garden_failed_twice");

  const attention: string[] = [];
  if (input.gardenLast[0] === "failed" && input.gardenLast[1] !== "failed") attention.push("garden_failed");
  if (input.quarantined.some((c) => olderThan(input.now, c.createdAt, CAPTURE_WAIT_DAYS))) attention.push("quarantined_capture_waiting");
  if (input.accepted.some((c) => olderThan(input.now, c.createdAt, CAPTURE_WAIT_DAYS))) attention.push("accepted_capture_not_ingested");
  const isolatedGrew = previous !== null && input.notes > 0 && input.isolated > previous.isolated;
  if (isolatedGrew && previous.isolatedGrew) attention.push("isolated_growing");
  if (input.gardenLast[0] === "skipped_review_queue_full") attention.push("garden_skipped_review_queue_full");
  if (input.indexGeneratedAt === null) attention.push("index_missing");
  else if (olderThan(input.now, input.indexGeneratedAt, INDEX_MAX_AGE_DAYS)) attention.push("index_stale");

  const verdict: PulseVerdictV1 = failures.length > 0 ? "failure" : attention.length > 0 ? "attention" : "healthy";
  return {
    header: { date: input.now.toISOString().slice(0, 10), verdict, isolated: input.isolated, isolatedGrew },
    reasons: [...failures, ...attention],
  };
}

/** Counts and reason codes only: no note title or path reaches a report. */
export function renderPulseReport(header: PulseHeaderV1, reasons: readonly string[], input: PulseInputV1): string {
  return [
    `<!-- pulse ${JSON.stringify(header)} -->`,
    `# Brain pulse ${header.date}: ${header.verdict}`,
    "",
    ...(reasons.length === 0 ? ["No findings."] : reasons.map((reason) => `- ${reason}`)),
    "",
    `- notes: ${String(input.notes)}`,
    `- edges: ${String(input.edges)}`,
    `- isolated: ${String(input.isolated)}${header.isolatedGrew ? " (grew)" : ""}`,
    `- gaps: ${String(input.gaps)}`,
    `- quarantined captures: ${String(input.quarantined.length)}`,
    `- accepted captures awaiting ingest: ${String(input.accepted.length)}`,
    `- failing doctor checks: ${String(input.doctorFailing)}`,
    `- lint errors: ${String(input.lintErrors)}`,
    `- index generated: ${input.indexGeneratedAt ?? "missing"}`,
    "",
  ].join("\n");
}

export function parsePulseHeader(text: string): PulseHeaderV1 | null {
  const match = /^<!-- pulse (\{.*\}) -->(?:\r?\n|$)/u.exec(text);
  if (match === null) return null;
  try {
    const value: unknown = JSON.parse(match[1] as string);
    if (typeof value !== "object" || value === null) return null;
    const { date, verdict, isolated, isolatedGrew } = value as Record<string, unknown>;
    if (
      typeof date !== "string" ||
      (verdict !== "healthy" && verdict !== "attention" && verdict !== "failure") ||
      typeof isolated !== "number" ||
      typeof isolatedGrew !== "boolean"
    ) {
      return null;
    }
    return { date, verdict, isolated, isolatedGrew };
  } catch {
    return null;
  }
}
