import { describe, expect, it } from "vitest";

import { planIngestApply } from "./apply.js";
import type { IngestProposal, ProposedNote } from "./proposal.js";

const CAPTURE_ID = "0f1e2d3c4b5a6978";

function note(path: string, contents = `# ${path}\n`): ProposedNote {
  return { path, contents, sourceCaptureId: CAPTURE_ID };
}

function proposal(...notes: readonly ProposedNote[]): IngestProposal {
  return { schemaVersion: 1, notes };
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

describe("planIngestApply", () => {
  it("plans one write per proposed note, keeping the path byte for byte", () => {
    const result = planIngestApply(proposal(note("DEV/caching.md")));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.writes).toHaveLength(1);
    expect(result.writes[0]?.path).toBe("DEV/caching.md");
    expect(decode(result.writes[0]?.bytes ?? new Uint8Array())).toBe(
      "# DEV/caching.md\n",
    );
  });

  /**
   * The path is content-root-relative and stays that way. Joining it to a vault
   * root is `apps/cli`'s job and doing it here would put a machine path into a
   * package whose whole claim is that it touches no filesystem.
   */
  it("never resolves a path against a root", () => {
    const result = planIngestApply(proposal(note("QA/a.md")));

    expect(result.ok && result.writes[0]?.path).toBe("QA/a.md");
  });

  it("encodes contents as UTF-8, so an astral character survives the plan", () => {
    const result = planIngestApply(proposal(note("DEV/a.md", "a 𝔠 b\n")));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(decode(result.writes[0]?.bytes ?? new Uint8Array())).toBe("a 𝔠 b\n");
    expect(result.writes[0]?.bytes.byteLength).toBe(
      new TextEncoder().encode("a 𝔠 b\n").byteLength,
    );
  });

  /**
   * Two proposals holding the same notes in different orders plan the same
   * sequence, because the transaction's mutation order is what a journal
   * records and what `repair` replays.
   */
  it("sorts by code point, so the order does not depend on the model's", () => {
    const forward = planIngestApply(
      proposal(note("DEV/a.md"), note("DEV/b.md"), note("QA/a.md")),
    );
    const reversed = planIngestApply(
      proposal(note("QA/a.md"), note("DEV/b.md"), note("DEV/a.md")),
    );

    expect(forward.ok && forward.writes.map((write) => write.path)).toStrictEqual([
      "DEV/a.md",
      "DEV/b.md",
      "QA/a.md",
    ]);
    expect(reversed.ok && reversed.writes.map((write) => write.path)).toStrictEqual(
      forward.ok ? forward.writes.map((write) => write.path) : [],
    );
  });

  /**
   * Code point, not locale. `Z` sorts before `a` because it does in UTF-8, and a
   * locale-aware comparison would order the same vault differently on two
   * machines.
   */
  it("orders by code point rather than by locale", () => {
    const result = planIngestApply(proposal(note("DEV/a.md"), note("DEV/Z.md")));

    expect(result.ok && result.writes.map((write) => write.path)).toStrictEqual([
      "DEV/Z.md",
      "DEV/a.md",
    ]);
  });

  /**
   * Normalization precedes de-duplication. A composed and a decomposed spelling
   * of one accented name are one file on a normalizing volume, so planning both
   * would write one note over the other -- a silent loss where a refusal belongs.
   * `parseIngestProposal` refuses it too; this function is total over any
   * `IngestProposal` a caller builds, including one that never went through that
   * parser.
   */
  it("refuses two paths that differ only in normalization form", () => {
    const composed = "DEV/caf\u00E9.md";
    const decomposed = "DEV/cafe\u0301.md";
    expect(composed, "the two spellings must differ as bytes").not.toBe(decomposed);

    const result = planIngestApply(proposal(note(composed), note(decomposed)));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("duplicate-path");
  });

  it("plans nothing for a proposal that proposes nothing", () => {
    const result = planIngestApply(proposal());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.writes).toStrictEqual([]);
  });

  /** Frozen, like every other value this package hands back. */
  it("hands back a frozen plan", () => {
    const result = planIngestApply(proposal(note("DEV/a.md")));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result.writes)).toBe(true);
    expect(Object.isFrozen(result.writes[0])).toBe(true);
  });
});
