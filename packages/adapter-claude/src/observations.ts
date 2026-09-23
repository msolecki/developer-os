import { parseStableSemver } from "@developer-os/core";

export interface ClaudeObservationV1 {
  /** Semver of the Claude Code build the observation ran on. */
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
 * Vendor behaviour, taken from an observation on a disposable home (D57) and
 * never from memory or documentation (spec §5.5). The verb that needs it
 * refuses exit 4 or warns while it is `null`.
 */
export const CLAUDE_MEMORY_LAYOUT: ClaudeMemoryLayoutV1 | null = {
  claudeVersion: "2.1.280",
  observedOn: "2026-09-23",
  observedIn:
    "With HOME set to a disposable directory, one `claude -p` turn asked to save a memory wrote `<home>/.claude/projects/<cwd-slug>/memory/project_mascot.md` and indexed it in `MEMORY.md` beside it; with CLAUDE_CONFIG_DIR set, the session created `projects/<cwd-slug>/memory/` under that directory instead.",
  projectsDirectory: "projects",
  memoryDirectory: "memory",
  extension: ".md",
  indexFileName: "MEMORY.md",
};

/**
 * Vendor behaviour, taken from an observation on a disposable home (D57) and
 * never from memory or documentation (spec §5.5). The verb that needs it
 * refuses exit 4 or warns while it is `null`.
 */
export const CLAUDE_DENY_RULES: ClaudeDenyRulesV1 | null = {
  claudeVersion: "2.1.280",
  observedOn: "2026-09-23",
  observedIn:
    "With HOME set to a disposable directory and these strings in its `.claude/settings.json` `permissions.deny`, a `claude -p --allowedTools Read` turn was denied all 16 synthetic protected files inside and outside the working directory while two control files were read; without the strings every file was read.",
  rules: {
    "read-env": ["Read(//**/.env)", "Read(//**/.env/**)"],
    "read-env-variants": ["Read(//**/.env.*)", "Read(//**/.env.*/**)"],
    "read-ssh": ["Read(//**/.ssh/**)"],
    "read-aws": ["Read(//**/.aws/**)"],
    "read-gnupg": ["Read(//**/.gnupg/**)"],
    "read-gh-hosts": ["Read(~/.config/gh/hosts.yml)"],
    "read-codex-auth": ["Read(~/.codex/auth.json)"],
    "read-claude-credentials": ["Read(~/.claude/.credentials.json)"],
  },
};

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
