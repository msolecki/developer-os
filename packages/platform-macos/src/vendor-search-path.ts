/**
 * NEW-202 (Spec 2, K8 "Amended 2026-10-08"): the launcher's closed CLI environment has no
 * `PATH`, so it hands the user's `PATH` over under this one name. It decides which binary is
 * `claude` or `codex` and nothing else: `vendorSearchPathOption` feeds only the adapter's
 * discovery `searchPath`, and every discovered path is admitted before it runs
 * (`assertTrustedExecutable`, D83 (3), or `capture`'s stricter pin). `tests/repository/vendor-search-path.test.ts` pins the readers.
 */
export const VENDOR_SEARCH_PATH_VARIABLE = "DEVELOPER_OS_VENDOR_SEARCH_PATH";

/**
 * 32 KiB, in UTF-8 bytes because the kernel counts bytes. That is 32 entries at macOS
 * `MAXPATHLEN` (1024) and several times a heavy real `PATH` (Homebrew plus version managers
 * land at 2–6 KiB), while staying ~3% of `ARG_MAX` (1 MiB, shared by argv and environment),
 * so the variable can never make the CLI's exec fail with `E2BIG`.
 */
export const MAX_VENDOR_SEARCH_PATH_BYTES = 32 * 1024;

/** The value to pass on, or `null`: absent, empty, NUL-carrying or oversize is not passed, never refused. */
export function parseVendorSearchPath(raw: string | undefined): string | null {
  if (raw === undefined || raw.length === 0 || raw.includes("\0")) return null;
  return Buffer.byteLength(raw, "utf8") <= MAX_VENDOR_SEARCH_PATH_BYTES ? raw : null;
}

/** The production adapter's discovery `searchPath`; `{}` keeps today's `PATH`-then-fallback rule. */
export function vendorSearchPathOption(env: Readonly<Record<string, string | undefined>>): { readonly searchPath?: string } {
  const searchPath = parseVendorSearchPath(env[VENDOR_SEARCH_PATH_VARIABLE]);
  return searchPath === null ? {} : { searchPath };
}
