/**
 * D52 (2026-09-22, BACKLOG NEW-102): `ingest` runs Codex with `CODEX_HOME` set to this
 * product-owned directory, so the product's `AGENTS.md` block and `agents/*.toml` roles in the
 * user's own Codex home never reach an ingest request (D8). At rest it holds at most one entry: a
 * symlink `auth.json` to the user's resolved Codex credential, whose bytes the product never reads.
 * Codex's own run residue is removed by `ingest` after every run, so any other child is refused.
 */
export const CODEX_INGEST_HOME_RELATIVE_PATH = "state/codex-ingest-home";
export const CODEX_INGEST_AUTH_LINK = "auth.json";

/** Structural, so a guarded entry and an `lstat` projection both fit. */
export interface CodexIngestHomeEntryV1 {
  readonly kind: string;
  readonly ownerUid: number;
  readonly mode: number;
}

export type CodexIngestHomeShapeV1 =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly offendingName: string | null };

/** The only shape `state/codex-ingest-home` is admitted in: an owned `0700` directory, at most one owned `auth.json` symlink. */
export function inspectCodexIngestHomeShape(
  directory: CodexIngestHomeEntryV1 | null,
  childNames: readonly string[],
  observeChild: (name: string) => CodexIngestHomeEntryV1 | null,
  effectiveUid: number,
): CodexIngestHomeShapeV1 {
  if (directory?.kind !== "directory" || directory.ownerUid !== effectiveUid || directory.mode !== 0o700) {
    return { admitted: false, offendingName: null };
  }
  for (const name of childNames) {
    if (name !== CODEX_INGEST_AUTH_LINK) return { admitted: false, offendingName: name };
    const child = observeChild(name);
    if (child?.kind !== "symlink" || child.ownerUid !== effectiveUid) return { admitted: false, offendingName: name };
  }
  return { admitted: true };
}
