import { parseStableSemver } from "@developer-os/core";

export interface ClaudeObservationV1 {
  /** Semver of the Claude Code build the founder observed on. */
  readonly claudeVersion: string;
  /** YYYY-MM-DD. */
  readonly observedOn: string;
  /** One sentence: disposable home, command, what was seen. */
  readonly observedIn: string;
}

export interface ClaudeMemoryLayoutV1 extends ClaudeObservationV1 {
  /** Expected "projects", relative to <user-home>/.claude. */
  readonly projectsDirectory: string;
  /** Expected "memory", relative to each project directory. */
  readonly memoryDirectory: string;
  /** Expected ".md". */
  readonly extension: string;
  /** The index file the vendor keeps beside memory files; excluded. */
  readonly indexFileName: string;
}

export interface ClaudeDenyRulesV1 extends ClaudeObservationV1 {
  /** Keyed by ProtectedPathRuleId (packages/security). A rule is present only if every string is present. */
  readonly rules: Readonly<Record<string, readonly string[]>>;
}

/**
 * Vendor behaviour, taken from a founder observation on a disposable home and
 * never from memory or documentation (spec §5.5). `null` until observed. The
 * verb that needs it refuses exit 4 or warns while it is `null`.
 */
export const CLAUDE_MEMORY_LAYOUT: ClaudeMemoryLayoutV1 | null = null;

/**
 * Vendor behaviour, taken from a founder observation on a disposable home and
 * never from memory or documentation (spec §5.5). `null` until observed. The
 * verb that needs it refuses exit 4 or warns while it is `null`.
 */
export const CLAUDE_DENY_RULES: ClaudeDenyRulesV1 | null = null;

function isPastOrTodayIsoDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  // Date rolls 2026-02-30 over to March; the round trip rejects it.
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) return false;
  return text <= new Date().toISOString().slice(0, 10);
}

export function isValidClaudeObservation(row: ClaudeObservationV1): boolean {
  try {
    parseStableSemver(row.claudeVersion);
  } catch {
    return false;
  }
  return isPastOrTodayIsoDate(row.observedOn) && row.observedIn.trim().length > 0;
}
