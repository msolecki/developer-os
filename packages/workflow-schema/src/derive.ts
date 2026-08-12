import type { WorkflowContractV1 } from "./contract.js";
import { lookupVerb } from "./vocabulary.js";

export interface DerivedScopes {
  readonly read: readonly string[];
  readonly write: readonly string[];
  readonly unknownVerbs: readonly string[];
}

export interface ScopeMismatch {
  readonly kind: "under-declared" | "over-declared";
  readonly axis: "read" | "write";
  readonly glob: string;
}

/**
 * By code point, which is the same order as UTF-8 bytes — never `localeCompare`,
 * and never the default `<` on strings.
 *
 * `<` compares UTF-16 code units, so every code point at or above U+10000 sorts
 * *below* U+E000–U+FFFF, the reverse of UTF-8 byte order. Within Node that is
 * still deterministic, which is the property that matters here; it stops being
 * enough the moment a non-JS consumer — a renderer in another language, a
 * canonical hash, a `sort`-based check — orders the same set and disagrees. The
 * comment used to claim UTF-8 byte order while the code did not provide it.
 */
export function compareCodePoints(left: string, right: string): number {
  let leftAt = 0;
  let rightAt = 0;
  while (leftAt < left.length && rightAt < right.length) {
    const a = left.codePointAt(leftAt) ?? 0;
    const b = right.codePointAt(rightAt) ?? 0;
    if (a !== b) return a < b ? -1 : 1;
    leftAt += a > 0xffff ? 2 : 1;
    rightAt += b > 0xffff ? 2 : 1;
  }
  return left.length - leftAt - (right.length - rightAt);
}

/**
 * Normalize **then** de-duplicate. The other order made this a bag rather than
 * a set: the `Set` keyed on the raw string, so `café` and `café`
 * both survived and only then became identical, yielding two findings that read
 * exactly alike. The whole job of this function is to return a canonical set.
 */
function sortCanonical(values: Iterable<string>): readonly string[] {
  return [...new Set([...values].map((value) => value.normalize("NFC")))].sort(
    compareCodePoints,
  );
}

export function deriveScopes(workflow: WorkflowContractV1): DerivedScopes {
  const read = new Set<string>();
  const write = new Set<string>();
  const unknownVerbs: string[] = [];

  for (const step of workflow.steps) {
    if (step.do === undefined) continue;
    const footprint = lookupVerb(step.do);
    if (footprint === undefined) {
      unknownVerbs.push(step.do);
      continue;
    }
    for (const glob of footprint.read) read.add(glob);
    for (const glob of footprint.write) write.add(glob);
  }

  return {
    read: sortCanonical(read),
    write: sortCanonical(write),
    unknownVerbs: sortCanonical(unknownVerbs),
  };
}

/**
 * **Equal, not compatible.** Under-declaring is obviously an error.
 * Over-declaring is also one, and the strictness is the mechanism: the check
 * becomes arithmetic on two sets rather than a judgement about intent.
 */
export function compareScopes(
  declared: { readonly read: readonly string[]; readonly write: readonly string[] },
  derived: DerivedScopes,
): readonly ScopeMismatch[] {
  const mismatches: ScopeMismatch[] = [];

  for (const axis of ["read", "write"] as const) {
    const declaredSet = new Set(declared[axis].map((glob) => glob.normalize("NFC")));
    /**
     * Normalized here too, rather than trusted to arrive that way. `DerivedScopes`
     * is an exported interface with nothing in its type saying "normalized", and
     * `compareScopes` is exported independently of `deriveScopes` — so a caller
     * that builds one by hand produced a spurious `over-declared` and no matching
     * `under-declared` to explain it. Normalization is idempotent, so this costs
     * nothing on the path that was already correct.
     */
    const derivedSet = new Set(derived[axis].map((glob) => glob.normalize("NFC")));

    for (const glob of sortCanonical(derivedSet)) {
      if (!declaredSet.has(glob)) {
        mismatches.push({ kind: "under-declared", axis, glob });
      }
    }
    for (const glob of sortCanonical(declaredSet)) {
      if (!derivedSet.has(glob)) {
        mismatches.push({ kind: "over-declared", axis, glob });
      }
    }
  }

  return mismatches;
}
