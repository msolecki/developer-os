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
 * **Empty, and that is the finished state of this task.**
 *
 * Spec §10.3 is normative: until a vendor's row is observed, that vendor is not
 * in the table and detection records `"unknown"`. Task 17 is the one task that
 * runs a real vendor binary; it adds one row per vendor, with what was observed
 * and when, updates spec §10.3, and updates the test that asserts this list is
 * empty — with the observation in the commit message, so the change from
 * "empty" to "two rows" carries its justification.
 *
 * A guessed row is exactly the undocumented capability assumption design spec
 * §20 names as a release blocker. The cost of the empty table is that every
 * capture written between here and Task 17 records `sourceAgent: "unknown"`.
 * Those captures are correct and are never rewritten.
 */
export const AGENT_DETECTION_ROWS: readonly AgentDetectionRow[] = Object.freeze([]);

/**
 * The rule the table is read by, separated from the table so it can be tested
 * against synthetic rows while the real table is empty. A rule that first runs
 * the day someone adds a row is a rule nobody has ever seen work.
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
