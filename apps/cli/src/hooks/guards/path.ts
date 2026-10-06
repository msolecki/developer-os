import { isAbsolute, resolve } from "node:path";

import { canonicalizePlannedPath, ProtectedPathPolicy, SecurityRefusalError } from "@developer-os/security";

import { excerpt } from "../outcome.js";
import { editedPaths, HOOK_TOOL_MATCHERS } from "../payload.js";
import { relativePathBase, resolveEditedPath, resolveProjectRoot } from "../project-root.js";
import type { HookVerbHandler } from "../registry.js";

type HookPathMatch =
  | { readonly kind: "segment"; readonly name: string }
  | { readonly kind: "segment-suffix"; readonly suffix: string }
  | { readonly kind: "home-exact"; readonly relativePath: string };

const rows = <M extends HookPathMatch>(id: string, matches: readonly M[]) => matches.map((match) => ({ id, match }));

/**
 * D67 option (c): credential paths `guard path` refuses on top of `ProtectedPathPolicy`. They stay
 * out of `PROTECTED_PATH_RULES`, so they add no `CLAUDE_DENY_RULES` row (D57) and refuse no product
 * read (a `.key` suffix would refuse the product's own `redaction.key`).
 */
export const HOOK_PROTECTED_PATH_RULES: readonly { readonly id: string; readonly match: HookPathMatch }[] = [
  ...rows(
    "credential-file",
    [".git-credentials", ".netrc", ".pgpass", ".htpasswd", ".envrc"].map((name) => ({ kind: "segment", name }) as const),
  ),
  ...rows("private-key", ["id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"].map((name) => ({ kind: "segment", name }) as const)),
  ...rows("credentials-json", [{ kind: "segment", name: "credentials.json" }] as const),
  ...rows("secrets-dir", ["secrets", "secret"].map((name) => ({ kind: "segment", name }) as const)),
  ...rows(
    "home-config",
    [".npmrc", ".docker/config.json", ".kube/config"].map((relativePath) => ({ kind: "home-exact", relativePath }) as const),
  ),
  ...rows(
    "key-material",
    [".pem", ".key", ".p12", ".pfx", ".tfvars"].map((suffix) => ({ kind: "segment-suffix", suffix }) as const),
  ),
];

// NEW-154: the same case and NFC fold `ProtectedPathPolicy` applies, since APFS is case-insensitive.
const fold = (value: string): string => value.normalize("NFC").toLowerCase();

function hookProtected(path: string, home: string): boolean {
  const segments = fold(path).split(/[\\/]/u).filter((segment) => segment.length > 0);
  return HOOK_PROTECTED_PATH_RULES.some(({ match }) => {
    switch (match.kind) {
      case "segment":
        return segments.includes(fold(match.name));
      case "segment-suffix":
        return segments.some((segment) => segment.endsWith(fold(match.suffix)));
      case "home-exact":
        return fold(resolve(home, match.relativePath)) === fold(resolve(path));
    }
  });
}

/**
 * Both the lexical and the canonical path are checked: canonicalizing alone would let a project
 * symlink named `.env` that points at an ordinary file through.
 */
export const guardPath: HookVerbHandler = async (payload, runtime) => {
  if (payload.toolName === null || !HOOK_TOOL_MATCHERS[runtime.vendor].file.includes(payload.toolName)) {
    return { kind: "allow" };
  }
  const paths = editedPaths(payload, runtime.vendor);
  if (paths === null) {
    return runtime.vendor === "codex"
      ? { kind: "block", ruleId: "patch-malformed", detail: "patch outside the observed apply_patch grammar" }
      : { kind: "block", ruleId: "payload-malformed", detail: "file path field absent" };
  }
  if (runtime.userHome === null) return { kind: "block", ruleId: "hook-failed-closed", detail: "user home unavailable" };
  const base = await relativePathBase(runtime.vendor, runtime.cwd, await resolveProjectRoot(runtime.cwd));
  const policy = new ProtectedPathPolicy(runtime.userHome);
  const homes = [runtime.userHome, await canonicalizePlannedPath(runtime.userHome)];
  for (const path of paths) {
    const canonical = await resolveEditedPath(base, path);
    const lexical = isAbsolute(path) ? path : resolve(base, path);
    try {
      await policy.assertWritable(lexical);
      await policy.assertWritable(canonical);
    } catch (error) {
      if (error instanceof SecurityRefusalError) return { kind: "block", ruleId: "protected-path", detail: excerpt(runtime.redact(path)) };
      throw error;
    }
    if ([lexical, canonical].some((candidate) => homes.some((home) => hookProtected(candidate, home)))) {
      return { kind: "block", ruleId: "protected-path", detail: excerpt(runtime.redact(path)) };
    }
  }
  return { kind: "allow" };
};
