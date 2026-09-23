export const MAX_PATCH_HEADERS = 64;

const HEADER = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/u;
const BODY = /^(?:@@.*|[+\- ].*)$/u;

function isRelativePath(path: string): boolean {
  if (path.includes("\0") || path.startsWith("/")) return false;
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/**
 * The paths a Codex `apply_patch` body names, from its file headers only (spec §3, Codex file-edit
 * rule). The grammar is the one `docs/architecture/hooks.md` §1 question 4 observed on 0.155.1;
 * body lines are admitted by their prefix and never read. Any other line, an absolute or `..` path,
 * or more than `MAX_PATCH_HEADERS` headers returns `null`.
 */
export function applyPatchPaths(body: string): readonly string[] | null {
  const lines = body.endsWith("\n") ? body.slice(0, -1).split("\n") : body.split("\n");
  if (lines.length < 2 || lines[0] !== "*** Begin Patch" || lines.at(-1) !== "*** End Patch") return null;
  const paths: string[] = [];
  for (const line of lines.slice(1, -1)) {
    const header = HEADER.exec(line);
    if (header !== null) {
      const path = header[1] ?? "";
      if (!isRelativePath(path) || paths.length === MAX_PATCH_HEADERS) return null;
      paths.push(path);
    } else if (line.startsWith("***") || !BODY.test(line)) {
      return null;
    }
  }
  return paths.length === 0 ? null : paths;
}
