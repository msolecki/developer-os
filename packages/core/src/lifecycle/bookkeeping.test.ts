import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  inspectLifecycleBookkeepingShape,
  LIFECYCLE_BOOKKEEPING_RELATIVE_PATHS,
  lifecycleBookkeepingPaths,
} from "./bookkeeping.js";
import type {
  LifecycleBookkeepingObservationV1,
  LifecycleBookkeepingResidueV1,
} from "./bookkeeping.js";

const HOME = "/product";
const UID = 501;
const FOREIGN_UID = 502;
const PARTICIPANT = "tx_fi_123e4567-e89b-42d3-a456-426614174000_0000000000_f";
const COMPENSATION = "tx_fi_123e4567-e89b-42d3-a456-426614174000_0000000000_c";

const NO_RESIDUE: LifecycleBookkeepingResidueV1 = {
  retainedPaths: new Set(),
  bootstrapParticipantIds: new Set(),
};

function residue(
  retainedPaths: readonly string[],
  bootstrapParticipantIds: readonly string[] = [],
): LifecycleBookkeepingResidueV1 {
  return {
    retainedPaths: new Set(retainedPaths),
    bootstrapParticipantIds: new Set(bootstrapParticipantIds),
  };
}

function observing(
  map: Readonly<Record<string, LifecycleBookkeepingObservationV1>>,
): (path: string) => LifecycleBookkeepingObservationV1 {
  return (path) => map[path] ?? { kind: "other" };
}

function directory(childNames: readonly string[] = []): LifecycleBookkeepingObservationV1 {
  return { kind: "directory", ownerUid: UID, mode: 0o700, childNames };
}

function stableLock(): LifecycleBookkeepingObservationV1 {
  return { kind: "regular_file", ownerUid: UID, mode: 0o600, nlink: 1, size: 0n };
}

function wrongShapesOf(
  exact: LifecycleBookkeepingObservationV1,
): readonly LifecycleBookkeepingObservationV1[] {
  if (exact.kind === "regular_file") {
    return [
      { ...exact, mode: 0o644 },
      { ...exact, size: 1n },
      { ...exact, nlink: 2 },
      { ...exact, ownerUid: FOREIGN_UID },
      directory(),
      { kind: "other" },
    ];
  }
  if (exact.kind === "directory") {
    return [
      { ...exact, mode: 0o755 },
      { ...exact, ownerUid: FOREIGN_UID },
      stableLock(),
      { kind: "other" },
    ];
  }
  return [];
}

describe("the closed lifecycle bookkeeping set", () => {
  it("is exactly Spec 1 §2.1's A12 set", () => {
    expect(LIFECYCLE_BOOKKEEPING_RELATIVE_PATHS.length).toBeGreaterThan(0);
    expect([...LIFECYCLE_BOOKKEEPING_RELATIVE_PATHS]).toStrictEqual([
      "backups",
      "backups/transactions",
      "staging",
      "staging/lifecycle",
      "staging/transactions",
      "state/.lifecycle.lock",
      "state/git-effect-journals",
      "state/launchd-effect-journals",
      "state/lifecycle-journals",
      "state/transactions",
    ]);
    expect([...lifecycleBookkeepingPaths(HOME)].toSorted()).toStrictEqual(
      LIFECYCLE_BOOKKEEPING_RELATIVE_PATHS.map((relative) => join(HOME, relative)).toSorted(),
    );
  });

  it.each(LIFECYCLE_BOOKKEEPING_RELATIVE_PATHS)(
    "admits %s by exact shape and refuses every other shape",
    (relative) => {
      const path = join(HOME, relative);
      const exact = relative.endsWith(".lock") ? stableLock() : directory();
      expect(
        inspectLifecycleBookkeepingShape(HOME, path, observing({ [path]: exact }), UID, NO_RESIDUE),
      ).toStrictEqual({ admitted: true });
      const wrong = wrongShapesOf(exact);
      expect(wrong.length).toBeGreaterThan(0);
      for (const shape of wrong) {
        expect(
          inspectLifecycleBookkeepingShape(HOME, path, observing({ [path]: shape }), UID, NO_RESIDUE),
          `${path} admitted ${shape.kind}`,
        ).toStrictEqual({ admitted: false, offendingPath: path });
      }
    },
  );

  it("refuses a bookkeeping directory holding an unknown child, naming the child", () => {
    const journals = join(HOME, "state", "lifecycle-journals");
    const unknown = join(journals, "unrelated.txt");
    expect(
      inspectLifecycleBookkeepingShape(
        HOME,
        journals,
        observing({
          [journals]: directory(["unrelated.txt"]),
          [unknown]: { kind: "regular_file", ownerUid: UID, mode: 0o600, nlink: 1, size: 4n },
        }),
        UID,
        NO_RESIDUE,
      ),
    ).toStrictEqual({ admitted: false, offendingPath: unknown });
  });

  it("admits a bookkeeping directory whose only child is another bookkeeping path", () => {
    const backups = join(HOME, "backups");
    const transactions = join(backups, "transactions");
    expect(
      inspectLifecycleBookkeepingShape(
        HOME,
        backups,
        observing({ [backups]: directory(["transactions"]), [transactions]: directory() }),
        UID,
        NO_RESIDUE,
      ),
    ).toStrictEqual({ admitted: true });
  });

  it("admits a bootstrap participant's stable lock only for a named participant", () => {
    const transactions = join(HOME, "state", "transactions");
    const lock = join(transactions, `.${PARTICIPANT}.lock`);
    const observe = observing({
      [transactions]: directory([`.${PARTICIPANT}.lock`]),
      [lock]: stableLock(),
    });
    expect(
      inspectLifecycleBookkeepingShape(HOME, transactions, observe, UID, residue([], [PARTICIPANT])),
    ).toStrictEqual({ admitted: true });
    expect(
      inspectLifecycleBookkeepingShape(HOME, transactions, observe, UID, residue([], [COMPENSATION])),
    ).toStrictEqual({ admitted: false, offendingPath: lock });
  });

  it("refuses every inexact shape of a named participant's stable lock", () => {
    const transactions = join(HOME, "state", "transactions");
    const lock = join(transactions, `.${PARTICIPANT}.lock`);
    const wrong = wrongShapesOf(stableLock());
    expect(wrong.length).toBeGreaterThan(0);
    for (const shape of wrong) {
      expect(
        inspectLifecycleBookkeepingShape(
          HOME,
          transactions,
          observing({ [transactions]: directory([`.${PARTICIPANT}.lock`]), [lock]: shape }),
          UID,
          residue([], [PARTICIPANT]),
        ),
        `${lock} admitted ${shape.kind}`,
      ).toStrictEqual({ admitted: false, offendingPath: lock });
    }
  });

  it("admits a retained tombstone beside the journals only when retention names it", () => {
    const transactions = join(HOME, "state", "transactions");
    const tombstone = join(transactions, `.${PARTICIPANT}.json.tombstone`);
    const observe = observing({
      [transactions]: directory([`.${PARTICIPANT}.json.tombstone`]),
      [tombstone]: { kind: "regular_file", ownerUid: UID, mode: 0o600, nlink: 1, size: 12n },
    });
    expect(
      inspectLifecycleBookkeepingShape(HOME, transactions, observe, UID, residue([tombstone])),
    ).toStrictEqual({ admitted: true });
    expect(
      inspectLifecycleBookkeepingShape(HOME, transactions, observe, UID, NO_RESIDUE),
    ).toStrictEqual({ admitted: false, offendingPath: tombstone });
  });

  it("refuses a legacy Foundation journal in the transaction root, naming the journal", () => {
    const transactions = join(HOME, "state", "transactions");
    const journal = join(transactions, "tx_123e4567-e89b-42d3-a456-426614174000.json");
    expect(
      inspectLifecycleBookkeepingShape(
        HOME,
        transactions,
        observing({
          [transactions]: directory(["tx_123e4567-e89b-42d3-a456-426614174000.json"]),
          [journal]: { kind: "regular_file", ownerUid: UID, mode: 0o600, nlink: 1, size: 512n },
        }),
        UID,
        residue([], [PARTICIPANT]),
      ),
    ).toStrictEqual({ admitted: false, offendingPath: journal });
  });

  it("admits a participant staging directory that is empty or holds only retained evidence", () => {
    const staging = join(HOME, "staging", "transactions");
    const participant = join(staging, PARTICIPANT);
    const tombstone = join(participant, "0.bin.tombstone");
    const payload = join(participant, "0.bin");
    expect(
      inspectLifecycleBookkeepingShape(
        HOME,
        staging,
        observing({ [staging]: directory([PARTICIPANT]), [participant]: directory() }),
        UID,
        residue([], [PARTICIPANT]),
      ),
    ).toStrictEqual({ admitted: true });
    expect(
      inspectLifecycleBookkeepingShape(
        HOME,
        staging,
        observing({
          [staging]: directory([PARTICIPANT]),
          [participant]: directory(["0.bin.tombstone"]),
          [tombstone]: { kind: "regular_file", ownerUid: UID, mode: 0o600, nlink: 1, size: 3n },
        }),
        UID,
        residue([tombstone], [PARTICIPANT]),
      ),
    ).toStrictEqual({ admitted: true });
    expect(
      inspectLifecycleBookkeepingShape(
        HOME,
        staging,
        observing({
          [staging]: directory([PARTICIPANT]),
          [participant]: directory(["0.bin", "0.bin.tombstone"]),
          [payload]: { kind: "regular_file", ownerUid: UID, mode: 0o600, nlink: 1, size: 3n },
          [tombstone]: { kind: "regular_file", ownerUid: UID, mode: 0o600, nlink: 1, size: 3n },
        }),
        UID,
        residue([tombstone], [PARTICIPANT]),
      ),
    ).toStrictEqual({ admitted: false, offendingPath: payload });
  });

  it("names the deepest offending child of a participant backup directory", () => {
    const backups = join(HOME, "backups", "transactions");
    const participant = join(backups, PARTICIPANT);
    const unrelated = join(participant, "unrelated.bin");
    expect(
      inspectLifecycleBookkeepingShape(
        HOME,
        backups,
        observing({
          [backups]: directory([PARTICIPANT]),
          [participant]: directory(["unrelated.bin"]),
          [unrelated]: { kind: "regular_file", ownerUid: UID, mode: 0o600, nlink: 1, size: 1n },
        }),
        UID,
        residue([], [PARTICIPANT]),
      ),
    ).toStrictEqual({ admitted: false, offendingPath: unrelated });
  });

  it("admits an ancestor directory that exists only to hold retained evidence", () => {
    const lifecycle = join(HOME, "staging", "lifecycle");
    const ancestor = join(lifecycle, "lc_0000");
    const tombstone = join(ancestor, "plan.json.tombstone");
    const observe = observing({
      [lifecycle]: directory(["lc_0000"]),
      [ancestor]: directory(["plan.json.tombstone"]),
      [tombstone]: { kind: "regular_file", ownerUid: UID, mode: 0o600, nlink: 1, size: 7n },
    });
    expect(
      inspectLifecycleBookkeepingShape(HOME, lifecycle, observe, UID, residue([tombstone])),
    ).toStrictEqual({ admitted: true });
    expect(
      inspectLifecycleBookkeepingShape(HOME, lifecycle, observe, UID, NO_RESIDUE),
    ).toStrictEqual({ admitted: false, offendingPath: ancestor });
  });

  it("never admits a path outside the set", () => {
    for (const relative of ["logs", "schemas", "state", "state/transactions/child", "staging/fresh-v2-init"]) {
      const path = join(HOME, relative);
      expect(
        inspectLifecycleBookkeepingShape(
          HOME,
          path,
          observing({ [path]: directory() }),
          UID,
          NO_RESIDUE,
        ),
      ).toStrictEqual({ admitted: false, offendingPath: path });
    }
  });
});
