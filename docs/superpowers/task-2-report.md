# Task 2 review-fix report

## Controller matrix → regression evidence

- Hash and selection: `changes the selected-arm64 identity hash when projection … changes`, `uses the specified ASCII identity domain …`, `returns detached selection and active values`, `selects …`, and `refuses a present lower requested release` cover the complete canonical no-LF hash projection, non-selected-bundle invariance, latest/exact/active/rebound/downgrade selection, and copy-out behavior.
- Origin, offline, signed, and delegation: `refuses DNS boundary …`, `admits DNS 63-byte labels …`, `admits exact URL path bounds …`, `refuses offline trust …`, `refuses signed document …`, and `admits/refuses delegation …` cover the DNS/IP, path, root/key/locator, one-signature, origin cardinality, duplicate, and key-ID matrix.
- Manifest: `enforces the bundle-manifest byte cap …`, `enforces exact 512MiB files …`, `refuses BundleRelativePath …`, `refuses exact and folded duplicate …`, `refuses each entrypoint …`, and the existing 200,001-row test cover size, count, path, ordering, parent, duplicate, and four-entrypoint inventory rules.
- Identity and active: `refuses identity admission when bound … changes`, `admits a reordered … selected bundle …`, `returns a detached admitted identity …`, and `validates active exact keys …` cover the complete context-bound admission path and active-record scalar validation.
- Trust and exact keys: `allows independent higher … watermark advancement`, `refuses equal … watermark mismatch`, role-specific release checks, and `refuses nested persisted schema extra key …` cover independent monotonicity, equality replay, guarded-role admission, and recursive persisted-schema closure.

## Red/green evidence

- RED: the reordered selected-bundle admission regression failed with `invalid ReleaseIdentityV1 context`; the cause was a property-order-sensitive `JSON.stringify` comparison.
- GREEN: admission now parses the selected bundle through the strict schema and compares its exact fields to the selected index row. `npx vitest run --root packages/core src/update/release.test.ts src/index.test.ts` passed 143 tests; `npx tsc -p packages/core --noEmit` passed.
- Full gate: the first run exposed the repository capability-scan violation from `node:net`; replacing it with the local dotted-quad check made the second exact `npm run check` green: 127 files passed, 2,527 tests passed, 1 skipped, duration 328.87s. The only output was the existing Node-engine warning (Node 26.7.0 versus the declared Node 24 range).

## Conjunctive boundary rulings

- The 10,000-row index and 200,000-row manifest structural caps remain independent from the 4 MiB and 16 MiB canonical-byte caps. Structural overflow is rejected before row validation; inputs at a structural maximum may separately be rejected by the byte ceiling. Neither cap was weakened.
- Offline-trust and delegation byte limits are also conjunctive with their closed root/origin cardinalities. Their maximum cardinality records cannot reach 64 KiB under the independently enforced 2,048-byte origin path bound; the cardinality guard therefore fires first for an over-cardinality input.
