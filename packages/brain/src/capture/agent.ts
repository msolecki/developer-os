/**
 * One observed environment signal for one vendor.
 *
 * Every field exists so that a row cannot be added without the observation
 * that justifies it: `observedOn` and `observedIn` are what a later reader
 * consults to decide whether the row is still true of a vendor that has since
 * shipped forty releases. Spec §10.3 requires the same pair in prose, one row
 * per vendor, recorded there in the same change.
 */
export interface AgentDetectionRow {
  /** The value recorded in `CaptureEnvelopeV1.sourceAgent`. */
  readonly agent: string;
  /** The environment variable observed to be set. */
  readonly variable: string;
  /** The exact value observed, or `null` when presence alone was the signal. */
  readonly value: string | null;
  /** When it was observed — a date, not "recently". */
  readonly observedOn: string;
  /** What it was observed on: the vendor build, and how it was run. */
  readonly observedIn: string;
}

/**
 * Recorded when no row matches — an environment neither vendor's marker
 * reaches, which since 2026-08-20 means neither is running rather than that
 * the table is empty.
 *
 * `sourceAgentVersion` takes the same value on the same principle when a
 * version probe fails, but that one is the CLI's to record: it comes from the
 * adapter's own discovery at capture time, and this package spawns nothing.
 */
const UNKNOWN_AGENT = "unknown";

/**
 * **Both vendors are here as of 2026-08-20, and the second row cost five days
 * and a founder's credits.**
 *
 * Spec §10.3 is normative: until a vendor's row is observed, that vendor is not
 * in the table and detection records `"unknown"`. Task 17 observed Claude's on
 * 2026-08-15 and could not observe Codex's — the account's usage limit was
 * exhausted, so every `codex exec` ended `turn.failed` before a shell command
 * could report an environment, and the row was left **absent rather than
 * guessed**. `BACKLOG.md` §1 NEW-21 carried it until the limit reset.
 *
 * **What each row's `observedIn` says about its mode is load-bearing.**
 * Claude's was taken through `claude -p`; Codex's through `codex exec`. Neither
 * vendor's *interactive* session has ever been observed, and that is where a
 * founder actually captures. A row that turns out not to hold there records
 * `"unknown"`, which is the safe direction — a capture that names no agent is
 * correct and is never rewritten, while a guessed row is a fact a later reader
 * will trust (spec §5.4).
 */
export const AGENT_DETECTION_ROWS: readonly AgentDetectionRow[] = Object.freeze([
  {
    agent: "claude",
    variable: "CLAUDECODE",
    value: "1",
    observedOn: "2026-08-15",
    observedIn:
      "Claude Code 2.1.233 on macOS, `claude -p --output-format json`, with every CLAUDE*, CODEX* and ANTHROPIC* variable stripped from the parent environment so the marker could not be one leaking in from the session that ran the experiment",
  },
  {
    agent: "codex",
    variable: "CODEX_THREAD_ID",
    value: null,
    observedOn: "2026-08-20",
    observedIn:
      "codex-cli 0.147.0 on macOS, `codex exec --json`, with every CLAUDE*, CODEX* and ANTHROPIC* variable stripped from the parent environment. A shell command the model ran saw CODEX_CI=1, CODEX_SANDBOX=seatbelt, CODEX_SANDBOX_NETWORK_DISABLED=1 and CODEX_THREAD_ID=<uuid>, identically under both sandbox modes this product emits. The thread id is the row because the other three describe the sandbox or the non-interactive mode rather than the vendor; it matches on presence because its value is per-session",
  },
]);

/**
 * The rule the table is read by, separated from the table so it can be tested
 * against synthetic rows the real table does not carry. The real table now
 * drives both branches — Claude's row matches on an exact value and Codex's on
 * presence — which it did not until 2026-08-20, when a branch that had never
 * run against a real row finally did.
 *
 * An exported-but-empty variable is *absent*: `FOO=` is what a shell leaves
 * behind when a wrapper clears a value, and naming an agent on the strength of
 * an empty string is the same guess this function exists to refuse.
 */
export function matchObservedAgent(
  rows: readonly AgentDetectionRow[],
  env: Readonly<Record<string, string | undefined>>,
): string {
  for (const row of rows) {
    const observed = env[row.variable];
    if (observed === undefined || observed.length === 0) continue;
    if (row.value === null || row.value === observed) return row.agent;
  }
  return UNKNOWN_AGENT;
}

/**
 * The agent that produced a capture, from the environment it was produced in.
 *
 * Detection is from the environment rather than from the command line because
 * the skill body is byte-identical across both vendors (spec §5.4) — the
 * command an agent is told to run cannot carry `--agent claude` on one tree and
 * `--agent codex` on the other without breaking the shared-body property that
 * `npm run render:claude` proves.
 */
export function detectSourceAgent(
  env: Readonly<Record<string, string | undefined>>,
): string {
  return matchObservedAgent(AGENT_DETECTION_ROWS, env);
}
