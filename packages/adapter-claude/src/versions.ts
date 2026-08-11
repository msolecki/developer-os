/**
 * Spec §5.4's capability keys.
 *
 * `durable_project_guidance` is reported for `doctor`'s matrix and depended on
 * by nothing: spec §7.1 chose to concatenate the `shared` preamble into every
 * artifact rather than reference one shared guidance surface, so nothing in
 * this package may start relying on it. Reporting a capability this adapter
 * does not use is worth doing; relying on it is not.
 */
export const CLAUDE_CAPABILITY_KEYS = [
  "skills",
  "plugin_hooks",
  "session_start_injection",
  "session_end_capture",
  "pre_compact_backup",
  "non_interactive_run",
  "structured_result",
  "subagents",
  "durable_project_guidance",
] as const;

export type ClaudeCapabilityKey = (typeof CLAUDE_CAPABILITY_KEYS)[number];

/**
 * Provisional; the integration test confirms or raises it.
 *
 * Spec §15.1: the skills-directory-plugin floor is not documented on the page
 * read on 2026-08-11, so it is established by probe. `2.1.142` is the oldest
 * documented plugin-skill gate in spec §14.1 and is the floor below which
 * nothing here is worth attempting.
 *
 * `baseline-capabilities.json` records `2.1.216`. That is a historical
 * observation of one machine on 2026-07-21 and is deliberately **not** this
 * floor — spec §5.2 says so in as many words.
 */
export const CLAUDE_MINIMUM_VERSION = "2.1.142";

/**
 * A documented floor per key, or `null` meaning "no documented floor above the
 * minimum; the probe decides".
 *
 * Deliberately sparse. Spec §5.2 keeps the floor low by refusing to depend on
 * `metadata` (2.1.222), `displayName` (2.1.143) or `defaultEnabled` (2.1.154),
 * so none of them appears here — that absence is the mechanism, not an
 * oversight.
 *
 * A `Map`, not an object literal. `workflow-schema`'s architecture note §9
 * records four modules in one package that shipped `table[key] !== undefined`
 * over a plain object and had a key named `toString` resolve to a `Function`,
 * pass the guard, and crash a line later — twice while hiding a missing
 * refusal. A lookup table is not a lookup unless it cannot inherit.
 */
const DOCUMENTED_FLOORS: ReadonlyMap<ClaudeCapabilityKey, string | null> =
  new Map([
    ["skills", null],
    ["plugin_hooks", null],
    ["session_start_injection", null],
    ["session_end_capture", null],
    ["pre_compact_backup", null],
    ["non_interactive_run", null],
    ["structured_result", null],
    ["subagents", null],
    ["durable_project_guidance", null],
  ]);

/**
 * Exactly three numeric components. A `v` prefix, a pre-release suffix, a
 * two-part version and vendor text are all *not* versions, and saying so is the
 * whole point — see `compareVersions`.
 */
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/u;

function parseVersion(value: string): readonly number[] | null {
  const match = VERSION.exec(value);
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Numeric per component, and `null` when either side is not a version.
 *
 * Not `localeCompare`, which varies with ICU, and not string `<`, which orders
 * `2.1.9` above `2.1.10`.
 *
 * **It returns `null` rather than `NaN`, and that is a fix rather than a
 * style.** The first version did `Number(a[i] ?? 0) - Number(b[i] ?? 0)` and
 * returned `NaN` for unparsable input. `NaN !== 0` is true, so it propagated;
 * `NaN < 0` is **false**, so the floor check in `tablePermits` did not refuse;
 * and every capability the probe had observed was granted on a version string
 * nobody could parse. A comparison that cannot answer has to say so — a number
 * that silently fails every inequality is the worst possible answer, because it
 * fails open. Found by fresh-context review, 2026-08-11.
 */
export function compareVersions(left: string, right: string): number | null {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (a === null || b === null) return null;
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * Whether the version table permits a capability to be *considered*. It never
 * grants one: spec §5.1 requires a probe to observe the capability before it is
 * reported `yes`, and this function is only the first of those two gates.
 *
 * A version above everything the table knows is permitted rather than refused —
 * a table that rejected unknown-newer versions would break on every Claude
 * release.
 */
export function tablePermits(
  key: ClaudeCapabilityKey,
  version: string,
): boolean {
  const floor = DOCUMENTED_FLOORS.get(key);
  if (floor === undefined) return false;

  const aboveMinimum = compareVersions(version, CLAUDE_MINIMUM_VERSION);
  if (aboveMinimum === null || aboveMinimum < 0) return false;
  if (floor === null) return true;

  const aboveFloor = compareVersions(version, floor);
  return aboveFloor !== null && aboveFloor >= 0;
}
