import { compareCanonical, compareRawBytes } from "../discovery/index.js";
import type { IngestProposal } from "./proposal.js";

/**
 * One file the vault would gain, as a path and the bytes that go in it.
 *
 * **The path stays content-root-relative**, exactly as the model named it and
 * byte for byte. Joining it to a vault root is `apps/cli`'s work: this package
 * touches no filesystem, and a function here that produced an absolute path
 * would be handing out a machine path derived from a root it is not allowed to
 * know.
 */
export interface PlannedNoteWriteV1 {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/**
 * `duplicate-path` is the only refusal, and it is a refusal rather than a
 * last-one-wins because the alternative is silent data loss — see below.
 */
export type ApplyResult =
  | { readonly ok: true; readonly writes: readonly PlannedNoteWriteV1[] }
  | { readonly ok: false; readonly reason: "duplicate-path" };

/**
 * Turns a validated proposal into the writes a transaction would perform.
 *
 * **Pure**, with the property this whole directory holds: nothing here touches a
 * filesystem, an environment, a process, a clock or a key. It decides *what*
 * would be written and in *what order*; whether that is legal is the nine
 * validators' question and was answered before this runs, and how it reaches
 * disk is `TransactionExecutor`'s.
 *
 * **The order is fixed here rather than left to the model**, because the
 * mutation order is what a transaction journal records and what `repair`
 * replays. Two proposals holding the same notes in different orders must plan
 * the same sequence, or the same ingest would leave two different journals.
 * Sorting is by code point over the NFC form, tie-broken on the raw bytes —
 * `compareCanonical` then `compareRawBytes`, the same pair discovery orders a
 * vault with, so a plan and the index built from it agree about what "sorted"
 * means.
 *
 * **Normalization precedes de-duplication.** Two paths differing only in
 * normalization form are one file on a normalizing volume, so planning both
 * would write one note over the other: the proposal would claim two notes and
 * produce one, which is a silent loss where a refusal belongs.
 * `parseIngestProposal` refuses the same pair, and that is not a reason to drop
 * this — this function is total over any `IngestProposal` a caller hands it,
 * including one built in a test or by a future path that never went through
 * that parser.
 */
export function planIngestApply(proposal: IngestProposal): ApplyResult {
  const encoder = new TextEncoder();
  const seen = new Set<string>();
  const writes: PlannedNoteWriteV1[] = [];

  for (const note of proposal.notes) {
    const key = note.path.normalize("NFC");
    if (seen.has(key)) return { ok: false, reason: "duplicate-path" };
    seen.add(key);
    writes.push(
      Object.freeze({ path: note.path, bytes: encoder.encode(note.contents) }),
    );
  }

  writes.sort(
    (left, right) =>
      compareCanonical(left.path, right.path) ||
      compareRawBytes(left.path, right.path),
  );

  return { ok: true, writes: Object.freeze(writes) };
}
