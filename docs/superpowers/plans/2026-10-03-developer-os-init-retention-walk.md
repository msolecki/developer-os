# Init retention walk (NEW-133, option A)

**Goal.** Cut the ~85% of a fresh `init --yes --adapters none` (~320 s) that bootstrap retention
spends re-walking and re-hashing `state/`, without changing any security or durability semantic.

**Decisions (founder, option A, 2026-10-03).**

- Keep every comparison the code makes today: the internal first/second walk pair in
  `projectBootstrapRetentionPostimage` (pinned by `report.test.ts`, "2 walks per inspection") and
  the retainer's parent before/after pair. Make them cheap rather than removing them.
- The retain loop stays one observation per row before and after its rename: the journal slots
  and the bootstrap lock live under `state/` (`executor.ts` `bootstrapIdentity`, `journalSlots`),
  so every `advance` changes the parent tree and no parent projection can be shared across rows.
  Rounds that mutate nothing (the resume prefix and the final loop) observe each distinct parent
  once per round instead of once per row.
- Per-retainer, in-process content cache keyed by bigint lstat
  `dev, ino, size, mode, uid, nlink, mtimeNs, ctimeNs`; never shared across processes or
  persisted. Inserted only when every stat taken around the read agrees on the key and the ctime
  is older than the wall clock sampled before `open` (racy-write guard).
- Option B (metadata-only parent checks), fsync changes, osascript batching and any no-fsync test
  mode are out of scope.

## Task 1 — canonical-JSON sort fast path (S)

- **What:** `sortUtf8` sorts by UTF-16 code units when no key holds a code unit >= 0xD800 (code-unit
  order equals code-point order equals UTF-8 byte order there); otherwise the byte path as today.
  (The comparator already encodes each key once; the cost is the per-key `TextEncoder` allocation.)
- **Where:** `packages/core/src/lifecycle/canonical-json.ts`, a new test beside it.
- **How:** one guard regex and a plain comparator.
- **Test:** randomized oracle test — the old algorithm copied into the test — over objects with
  ASCII, BMP, `￿` and astral keys, asserting byte-identical `encodeCanonicalJson` and
  `sortUtf8` output.

## Task 2 — content cache and fresh-tree comparison (M)

- **What:** optional cache threaded `projectBootstrapRetentionPostimage → projectRetainedDirectoryTreeOnce
  → walkDirectory → projectRegularEntry`; the executor's retainer owns one. Fresh-walk pairs
  (first/second, parent before/after) compare kind, owner, mode, nlink, `treeHash`, `entryCount`,
  `regularFileBytes`, dev and ino — `treeHash` is sha256 over exactly `encodeCanonicalJson(entries)`,
  verified in `projectRetainedDirectoryTreeOnce`. Comparisons against persisted postimages keep
  `sameValue`. Drop the unaliased `structuredClone`. lstat directory entries with concurrency 8.
- **Where:** `apps/cli/src/bootstrap/retention.ts`, `apps/cli/src/bootstrap/executor.ts`
  (`retainTerminal` only), `apps/cli/src/bootstrap/retention.test.ts`.
- **How:** `Map<string, LowerHexSha256>`; a hit builds the entry from lstat without opening.
- **Test:** with the cache active, a same-size in-place rewrite and a rename-replacement of a file
  in the parent tree between parent-before and parent-after are refused; a cache hit opens nothing.

## Task 3 — one observation round for non-mutating loops (S)

- **What:** `BootstrapRetainer.observeAll(entries)`; `observe(e)` is `observeAll([e])`. Used by the
  resume prefix and the final loop of `retainBootstrapEnvelope`.
- **Where:** `apps/cli/src/bootstrap/retention.ts`, `retention.test.ts`.
- **Test:** counting `projectPostimage` on the "reopens an already-retained journal" path: parent projections per
  round are the same for 3 and 8 rows (8 each; previously 12 and 32).

## Task 4 — measure and document (S)

- **What:** before/after `init` wall time (packed release, `/usr/bin/time -l`, twice each), `doctor`
  0 fail, one real-init v2 file before/after; `foundation.md` §9 and `BACKLOG.md` NEW-133.
- **Test:** the recorded numbers and `doctor` output.

## Status (2026-10-03)

- Task 1 done: `06049edb`.
- Tasks 2 and 3 done together (same file): `ec91c69f`.
- Task 4 done: `init` 453-523 s → 136-147 s; `doctor` 0 fail; numbers in `foundation.md` §9.

**Next action:** CI re-measure of `tests/tools/pack-local-release.test.ts` on `macos-15`, then
close NEW-133 and delete this plan.
