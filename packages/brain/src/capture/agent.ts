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
 * Recorded when no row matches, which today is every environment.
 *
 * `sourceAgentVersion` takes the same value on the same principle when a
 * version probe fails, but that one is the CLI's to record: it comes from the
 * adapter's own discovery at capture time, and this package spawns nothing.
 */
const UNKNOWN_AGENT = "unknown";

/**
 * **One row, not the two Task 17 set out to add, and the missing one is Codex's.**
 *
 * Spec §10.3 is normative: until a vendor's row is observed, that vendor is not
 * in the table and detection records `"unknown"`. Task 17 ran both binaries on
 * 2026-08-15. Claude's row is below, observed. **Codex's is absent because the
 * account's usage limit was exhausted** and every `codex exec` ended
 * `turn.failed` before a shell command could report an environment — so there
 * was nothing to observe, and a row inferred from the vendor's documentation
 * would be exactly the undocumented capability assumption design spec §20 names
 * as a release blocker.
 *
 * The cost is stated rather than discovered later: every capture written inside
 * a Codex session until that row lands records `sourceAgent: "unknown"`. Those
 * captures are correct and are never rewritten.
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
]);

/**
 * The rule the table is read by, separated from the table so it can be tested
 * against synthetic rows the real table does not carry. That table holds one
 * exact-value row, so it exercises one branch of this function and none of the
 * others; a branch that first runs the day someone adds a row is a branch
 * nobody has ever seen work.
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
