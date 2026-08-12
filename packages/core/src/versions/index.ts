/**
 * The version comparison and floor logic both adapters need.
 *
 * It lived in `packages/adapter-claude` while there was one adapter. Each
 * adapter's own version table — Claude's `DOCUMENTED_FLOORS`, Codex's
 * equivalent — stays with its vendor, because the floors are vendor facts;
 * only the comparison and the permit rule are shared, which is what
 * `tablePermits` taking the table as an argument buys.
 */

/**
 * Exactly three numeric components, none with a leading zero. A `v` prefix, a
 * pre-release suffix, a two-part version, vendor text and a component like
 * `01` are all *not* versions, and saying so is the whole point — see
 * `compareVersions`. The no-leading-zero narrowing matches
 * `discoverCli`'s `VERSION_PATTERN` (`packages/security/src/cli.ts`) and the
 * workflow-version pattern DOS-P3 narrowed for the same reason
 * (`packages/workflow-schema/src/contract.ts`): a version is compared against
 * a documented floor, and two components a human would never write as
 * *unequal* — `01` and `1` — must not compare equal here either.
 */
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

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

export interface CapabilityVersionTable<Key extends string> {
  readonly minimum: string;
  /** A documented floor per key, or `null` for "the probe decides". */
  readonly floors: ReadonlyMap<Key, string | null>;
}

/**
 * Whether the version table permits a capability to be *considered*. It never
 * grants one: spec §5.1 requires a probe to observe the capability before it is
 * reported `yes`, and this function is only the first of those two gates.
 *
 * A version above everything the table knows is permitted rather than refused —
 * a table that rejected unknown-newer versions would break on every vendor
 * release.
 *
 * `table.floors` is a `Map`, not an object literal. `workflow-schema`'s
 * architecture note §9 records four modules in one package that shipped
 * `table[key] !== undefined` over a plain object and had a key named
 * `toString` resolve to a `Function`, pass the guard, and crash a line later —
 * twice while hiding a missing refusal. A lookup table is not a lookup unless
 * it cannot inherit.
 */
export function tablePermits<Key extends string>(
  table: CapabilityVersionTable<Key>,
  key: Key,
  version: string,
): boolean {
  const floor = table.floors.get(key);
  if (floor === undefined) return false;

  const aboveMinimum = compareVersions(version, table.minimum);
  if (aboveMinimum === null || aboveMinimum < 0) return false;
  if (floor === null) return true;

  const aboveFloor = compareVersions(version, floor);
  return aboveFloor !== null && aboveFloor >= 0;
}
