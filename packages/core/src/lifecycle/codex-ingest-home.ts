/**
 * D52 (2026-09-22, BACKLOG NEW-102): `ingest` runs Codex with `CODEX_HOME` set to this
 * product-owned directory, so the product's `AGENTS.md` block and `agents/*.toml` roles in the
 * user's own Codex home never reach an ingest request (D8). NEW-105: each run gets its own
 * `run-XXXXXX` directory here, holding a symlink `auth.json` to the user's resolved Codex
 * credential (whose bytes the product never reads), removed by `ingest` after the child exits.
 * At rest the directory is empty; a pre-NEW-105 top-level `auth.json` link is still admitted.
 * A leftover run directory is refused here: it belongs to a live or crashed run.
 */
export const CODEX_INGEST_HOME_RELATIVE_PATH = "state/codex-ingest-home";
export const CODEX_INGEST_AUTH_LINK = "auth.json";

/** The one repair every `codex_ingest_home_shape` refusal names: ingest's, uninstall's and init's. */
export const CODEX_INGEST_HOME_REPAIR =
  "if the named path is a regular auth.json, Codex may have refreshed your credential there: move it over the auth.json in your own Codex home, then remove the run directory that held it; otherwise remove the named path (a run-* directory is left by an interrupted ingest), and ingest recreates what it needs";

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
