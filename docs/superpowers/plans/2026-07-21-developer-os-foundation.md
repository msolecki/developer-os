# Developer OS Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the clean `developer-os` monorepo and deliver a safe, idempotent no-agent CLI lifecycle: `init -> status -> doctor -> repair -> uninstall`.

**Architecture:** Keep the CLI as a thin orchestrator over typed core, security, and macOS platform packages. Route every mutation through an explicit change plan, ownership manifest, transaction journal, deterministic validation, and rollback. Inject home paths, filesystems, clocks, IDs, processes, and platform facts so tests never touch a real agent installation, Brain, credential, scheduler, Git remote, or network.

**Tech Stack:** Node.js 24.16.0, pnpm 11.3.0 workspaces, TypeScript strict mode, Vitest, ESLint flat config, `zod`, and `smol-toml`.

## Global Constraints

- Program Task 0 closed on 2026-07-21; its source classification and publication boundary are frozen in `docs/migration/`. Historical rotations explicitly waived in the Program plan are not part of this gate.
- Target remote: `git@github.com:msolecki/developer-os.git`.
- Target checkout: the current repository root after cloning; do not persist its machine-specific absolute path.
- Inspect remote hooks and MCP configuration before running commands in the checkout.
- Keep the repository private throughout Foundation.
- Do not import legacy Git history or bulk-copy source repositories. Foundation is self-contained: no task may read `~/claude-shared`, `~/brain`, or any `DEVELOPER_OS_SOURCE_*` path. Legacy facts come from `docs/migration/baseline-capabilities.json` or they are a spec gap.
- Use pnpm; obtain approval before the first network-backed dependency download.
- Pin Node.js to 24.16.0 and pnpm to 11.3.0 for this checkpoint.
- Use TypeScript strict mode and Vitest.
- The binary name is `developer-os`.
- Foundation commands are `init`, `status`, `doctor`, `repair`, and `uninstall`.
- Foundation installs no Claude/Codex artifact and writes no canonical Brain note.
- Default product state is `~/.developer-os`; propose `~/DeveloperBrain` for new vaults.
- Support `DEVELOPER_OS_HOME` and `DEVELOPER_OS_BRAIN`; reject overlapping resolved paths.
- No telemetry, network, Git mutation, Keychain access, scheduler mutation, or agent invocation exists in Foundation.
- Every mutation follows `plan -> backup -> stage -> validate -> apply -> verify -> finalize`.
- Never overwrite drifted user files and never use broad Git staging.
- Before every commit run `npm run lint && npm test`, the task-specific test, and `git diff --cached --check`.
- A fresh-context reviewer who did not author the code reviews each task before commit.

## File map

All paths are relative to the target repository root.

| Path | Responsibility |
|---|---|
| `apps/cli/src/bin.ts` | Process boundary: argv, output, and exit code |
| `apps/cli/src/main.ts` | Pure command dispatch returning `CliResult` |
| `apps/cli/src/io.ts` | Injectable user interaction |
| `apps/cli/src/commands/` | One command per module |
| `packages/core/src/result.ts` | Stable exit and error contracts |
| `packages/core/src/config/` | Runtime paths and TOML configuration |
| `packages/core/src/plans/` | Exact change-plan model |
| `packages/core/src/transactions/` | Journal, backup, apply, recovery |
| `packages/core/src/manifest/` | Managed ownership and drift |
| `packages/security/src/paths.ts` | Canonical paths and containment |
| `packages/security/src/protected-paths.ts` | Default deny policy |
| `packages/security/src/redaction.ts` | Redact-before-log primitives |
| `packages/security/src/process.ts` | Shell-free process runner |
| `packages/platform-macos/src/` | Foundation macOS facts and executable discovery |
| `tests/e2e/foundation.test.ts` | Temporary-HOME lifecycle |

---

### Task 1: Clone safely and establish the repository gate

**Complexity:** M

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.node-version`
- Create: `.gitignore`
- Create: `tsconfig.json`
- Create: `tsconfig.base.json`
- Create: `eslint.config.mjs`
- Create: `vitest.config.ts`
- Create: `apps/cli/package.json`
- Create: `apps/cli/tsconfig.json`
- Create: `apps/cli/vitest.config.ts`
- Create: `apps/cli/src/bin.ts`
- Create: `apps/cli/src/main.ts`
- Create: `apps/cli/src/main.test.ts`
- Create: `docs/superpowers/specs/2026-07-21-developer-os-design.md`
- Create: `docs/superpowers/plans/2026-07-21-developer-os-program.md`
- Create: `docs/superpowers/plans/2026-07-21-developer-os-foundation.md`

**Interfaces:**
- Consumes: the approved design and plans, now resident at `docs/superpowers/` in this repository. (Completed 2026-07-21 by copying the three approved documents by hash; the hashes are recorded in `docs/migration/source-manifest.json`.)
- Produces: a validated workspace and the `@developer-os/cli` package.

**What:** Create the empty public repository checkout, pinned monorepo configuration, and a minimal tested CLI binary.

**Where:** The target repository root and `apps/cli/`.

**How:** Inspect repository-owned execution surfaces first, create every file explicitly, use one red smoke test, and copy only the three approved planning documents by hash.

**Test:** `npm run lint && npm test && pnpm build && git diff --check` passes; source/destination document hashes match; private-source scans and fresh review find no leak.

- [x] **Step 1: Inspect and clone without trusting project hooks**

Run outside the target checkout:

```bash
git ls-remote git@github.com:msolecki/developer-os.git
git clone git@github.com:msolecki/developer-os.git developer-os
```

Expected: both commands exit 0. An empty `ls-remote` result is valid for an empty repository. Stop if the target directory already contains unclassified files.

Before running package or Git hook commands, read these paths when present:

```text
developer-os/.claude/settings.json
developer-os/.claude/hooks/
developer-os/.mcp.json
```

- [x] **Step 2: Create pinned workspace metadata**

Create `package.json`:

```json
{
  "name": "developer-os",
  "version": "0.0.0",
  "private": true,
  "description": "Local-first workflows and an Obsidian-compatible Brain for Claude Code and Codex",
  "type": "module",
  "packageManager": "pnpm@11.3.0",
  "engines": { "node": ">=24.16.0 <25" },
  "scripts": {
    "build": "tsc -b",
    "lint": "tsc -b --pretty false && eslint .",
    "test": "vitest run",
    "test:e2e": "vitest run tests/e2e",
    "check": "npm run lint && npm test && pnpm build && git diff --check"
  }
}
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - apps/cli
  - packages/core
  - packages/security
  - packages/platform-macos
  - tests
```

Create `.node-version` containing `24.16.0` and `.gitignore` containing:

```gitignore
node_modules/
dist/
coverage/
*.tsbuildinfo
.DS_Store
.developer-os-test/
```

- [x] **Step 3: Create strict shared compiler configuration**

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2024"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "useUnknownInCatchVariables": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "composite": true,
    "skipLibCheck": true
  }
}
```

Create root `tsconfig.json`:

```json
{
  "files": [],
  "references": [{ "path": "./apps/cli" }]
}
```

Create `eslint.config.mjs`:

```javascript
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/coverage/**", "**/vitest.config.ts", "eslint.config.mjs"] },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error"
    }
  }
);
```

Create root `vitest.config.ts` using Vitest 4's `projects` API:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { projects: ["apps/cli/vitest.config.ts"] }
});
```

Create `apps/cli/package.json`:

```json
{
  "name": "@developer-os/cli",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "bin": { "developer-os": "./dist/bin.js" },
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run"
  }
}
```

Create `apps/cli/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"]
}
```

Create `apps/cli/vitest.config.ts`:

```typescript
import { defineProject } from "vitest/config";

export default defineProject({
  test: { environment: "node", include: ["src/**/*.test.ts"] }
});
```

- [x] **Step 4: Write the failing CLI smoke test**

Create `apps/cli/src/main.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { run } from "./main.js";

describe("run", () => {
  it("prints the product version", async () => {
    const lines: string[] = [];
    const code = await run(["--version"], {
      stdout: (line) => lines.push(line),
      stderr: (line) => lines.push(`error:${line}`),
      confirm: () => Promise.resolve(false)
    });

    expect(code).toBe(0);
    expect(lines).toEqual(["developer-os 0.0.0"]);
  });
});
```

- [x] **Step 5: Install exact dependencies and verify red**

After explicit dependency-download approval:

```bash
node --version
pnpm --version
pnpm add --save-dev --save-exact --workspace-root typescript vitest @types/node eslint @eslint/js typescript-eslint
pnpm test -- apps/cli/src/main.test.ts
```

Expected: FAIL because `apps/cli/src/main.ts` does not exist.

- [x] **Step 6: Implement the minimal binary**

Create `apps/cli/src/main.ts`:

```typescript
export interface CliIo {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
  readonly confirm: (question: string) => Promise<boolean>;
}

export async function run(argv: readonly string[], io: CliIo): Promise<number> {
  if (argv.length === 1 && argv[0] === "--version") {
    io.stdout("developer-os 0.0.0");
    return 0;
  }
  io.stderr("Usage: developer-os --version");
  return 2;
}
```

Create `apps/cli/src/bin.ts`:

```typescript
#!/usr/bin/env node
import { run } from "./main.js";

const code = await run(process.argv.slice(2), {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  confirm: () => Promise.resolve(false)
});
process.exitCode = code;
```

- [x] **Step 7: Copy only the three approved documents**

Copy the design, program plan, and this Foundation plan to identical relative paths in the new repository. Verify source and destination hashes with `shasum -a 256`. Do not copy the surrounding dirty documentation tree.

- [x] **Step 8: Verify, review, and commit**

```bash
npm run lint && npm test && pnpm build && git diff --check
git add package.json pnpm-lock.yaml pnpm-workspace.yaml .node-version .gitignore tsconfig.json tsconfig.base.json eslint.config.mjs vitest.config.ts apps/cli/package.json apps/cli/tsconfig.json apps/cli/vitest.config.ts apps/cli/src/bin.ts apps/cli/src/main.ts apps/cli/src/main.test.ts docs/superpowers/specs/2026-07-21-developer-os-design.md docs/superpowers/plans/2026-07-21-developer-os-program.md docs/superpowers/plans/2026-07-21-developer-os-foundation.md
git diff --cached --check
npm run lint && npm test
git commit -m "chore: bootstrap developer-os workspace"
```

Expected: commands pass, one smoke test passes, and the working tree is clean. The fresh reviewer confirms no legacy history or private content entered the repository.

---

### Task 2: Define stable CLI result and error contracts

**Complexity:** M

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/src/result.ts`
- Create: `packages/core/src/result.test.ts`
- Create: `packages/core/src/index.ts`
- Create: `apps/cli/src/io.ts`
- Modify: `tsconfig.json`
- Modify: `vitest.config.ts`
- Modify: `apps/cli/package.json`
- Modify: `apps/cli/tsconfig.json`
- Modify: `apps/cli/src/main.ts`
- Modify: `apps/cli/src/main.test.ts`

**Interfaces:**
- Consumes: workspace validation.
- Produces: `EXIT_CODES`, `ExitCode`, `CliError`, `CliResult<T>`, `CliIo`, and deterministic JSON output.

**What:** Freeze machine-readable CLI success, failure, and exit-code behavior before command count grows.

**Where:** `packages/core/src/result.ts`, the CLI I/O boundary, and their package/project configuration.

**How:** Write exact serialization tests first, then route CLI output through the shared discriminated union without exposing process state below `bin.ts`.

**Test:** Result and CLI tests pass, JSON bytes remain exact, unknown input returns code 2, and the full lint/test gate passes.

- [x] **Step 1: Write failing contract tests**

Create `packages/core/package.json`:

```json
{
  "name": "@developer-os/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
  },
  "scripts": { "build": "tsc -b", "test": "vitest run" }
}
```

Create `packages/core/tsconfig.json` with `extends: "../../tsconfig.base.json"`, `rootDir: "src"`, `outDir: "dist"`, and `include: ["src/**/*.ts"]`. Create `packages/core/vitest.config.ts` with the same Node environment and `src/**/*.test.ts` pattern as the CLI config.

Add `./packages/core` to root project references and `packages/core/vitest.config.ts` to root `test.projects`. Add `@developer-os/core: workspace:*` to CLI dependencies and `../../packages/core` to CLI TypeScript references. Every package-level Vitest config uses `defineProject`, not the removed `defineWorkspace` API.

Test exact JSON for success and security refusal. Verify code 0 includes `data` and `warnings`, while failures include only `code` and a redacted `error`.

```typescript
expect(formatJsonResult(success({ version: "0.0.0" }))).toBe(
  '{"ok":true,"code":0,"data":{"version":"0.0.0"},"warnings":[]}'
);
```

- [x] **Step 2: Run red**

```bash
pnpm vitest run packages/core/src/result.test.ts
```

Expected: FAIL because the module does not exist.

- [x] **Step 3: Implement exact types**

Create `packages/core/src/result.ts`:

```typescript
export const EXIT_CODES = {
  success: 0,
  operationalFailure: 1,
  invalidInput: 2,
  decisionRequired: 3,
  capabilityUnavailable: 4,
  securityRefusal: 5,
  recoveryRequired: 6
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export interface CliError {
  readonly kind: string;
  readonly message: string;
  readonly paths: readonly string[];
  readonly recovery?: string;
}

export type CliResult<T> =
  | { readonly ok: true; readonly code: 0; readonly data: T; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly code: Exclude<ExitCode, 0>; readonly error: CliError };

export const success = <T>(data: T, warnings: readonly string[] = []): CliResult<T> =>
  ({ ok: true, code: 0, data, warnings });

export const failure = (code: Exclude<ExitCode, 0>, error: CliError): CliResult<never> =>
  ({ ok: false, code, error });

export const formatJsonResult = <T>(result: CliResult<T>): string => JSON.stringify(result);
```

Move `CliIo` to `apps/cli/src/io.ts` and add `--json` handling. Unknown commands and options return code 2.

- [x] **Step 4: Verify, review, and commit**

```bash
pnpm vitest run packages/core/src/result.test.ts apps/cli/src/main.test.ts
npm run lint && npm test
git add packages/core/package.json packages/core/tsconfig.json packages/core/vitest.config.ts packages/core/src/result.ts packages/core/src/result.test.ts packages/core/src/index.ts apps/cli/package.json apps/cli/tsconfig.json apps/cli/src/io.ts apps/cli/src/main.ts apps/cli/src/main.test.ts tsconfig.json vitest.config.ts
git diff --cached --check
npm run lint && npm test
git commit -m "feat: define cli result contracts"
```

Reviewer checks exit meanings, JSON stability, stdout/stderr separation, and that only `bin.ts` touches `process.exitCode`.

---

### Task 3: Load strict configuration and resolve runtime paths

**Complexity:** M

**Files:**
- Create: `packages/core/src/config/types.ts`
- Create: `packages/core/src/config/loader.ts`
- Create: `packages/core/src/config/paths.ts`
- Create: `packages/core/src/config/config.test.ts`
- Create: `packages/core/src/config/index.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/package.json`

**Interfaces:**
- Consumes: `CliResult`.
- Produces: `DeveloperOsConfigV1`, `RuntimePaths`, `PathEnvironment`, `loadConfig`, `serializeConfig`, and `resolveRuntimePaths`.

**What:** Load one versioned configuration contract and deterministically resolve product and Brain paths.

**Where:** `packages/core/src/config/` and the core package metadata.

**How:** Add exact TOML/Zod dependencies, reject unknown or unsafe values, and inject environment reads at the CLI boundary.

**Test:** Valid, precedence, malformed, telemetry, relative-path, and NUL fixtures pass with deterministic serialization and the full lint/test gate.

- [x] **Step 1: Add exact runtime dependencies**

```bash
pnpm --filter @developer-os/core add --save-exact smol-toml zod
```

- [x] **Step 2: Write failing tests**

Test a valid version 1 TOML with absolute Brain path, adapter flags, disabled Git, and disabled automation. Assert the exact object:

```typescript
{
  schemaVersion: 1,
  brainPath: "/Users/test/DeveloperBrain",
  adapters: { claude: true, codex: false },
  git: { enabled: false },
  automation: { enabled: false },
  telemetry: false
}
```

Also test environment precedence, relative-path refusal, unknown-key refusal, and rejection of `telemetry = true`.

- [x] **Step 3: Run red**

```bash
pnpm vitest run packages/core/src/config/config.test.ts
```

Expected: FAIL because config modules do not exist.

- [x] **Step 4: Implement exact contracts**

```typescript
export interface DeveloperOsConfigV1 {
  readonly schemaVersion: 1;
  readonly brainPath: string;
  readonly adapters: { readonly claude: boolean; readonly codex: boolean };
  readonly git: { readonly enabled: boolean };
  readonly automation: { readonly enabled: boolean };
  readonly telemetry: false;
}

export interface RuntimePaths {
  readonly home: string;
  readonly configFile: string;
  readonly manifestFile: string;
  readonly stateDir: string;
  readonly stagingDir: string;
  readonly backupsDir: string;
  readonly logsDir: string;
  readonly brain: string;
}
```

Use strict Zod objects, deterministic TOML serialization, and this precedence: environment override, parsed config for Brain, then defaults. Reject empty, relative, and NUL-containing paths before filesystem access.

- [x] **Step 5: Verify, review, and commit**

```bash
pnpm vitest run packages/core/src/config/config.test.ts
npm run lint && npm test
git add packages/core/package.json packages/core/src/config/types.ts packages/core/src/config/loader.ts packages/core/src/config/paths.ts packages/core/src/config/config.test.ts packages/core/src/config/index.ts packages/core/src/index.ts pnpm-lock.yaml
git diff --cached --check
npm run lint && npm test
git commit -m "feat: load developer-os configuration"
```

Reviewer checks strict parsing, deterministic serialization, precedence, and absence of direct `process.env` reads below the CLI composition root.

---

### Task 4: Build path, redaction, and process security primitives

**Complexity:** L

**Files:**
- Create: `packages/security/package.json`
- Create: `packages/security/tsconfig.json`
- Create: `packages/security/vitest.config.ts`
- Create: `packages/security/src/paths.ts`
- Create: `packages/security/src/paths.test.ts`
- Create: `packages/security/src/protected-paths.ts`
- Create: `packages/security/src/protected-paths.test.ts`
- Create: `packages/security/src/redaction.ts`
- Create: `packages/security/src/redaction.test.ts`
- Create: `packages/security/src/process.ts`
- Create: `packages/security/src/process.test.ts`
- Create: `packages/security/src/index.ts`
- Modify: `tsconfig.json`
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: core error contracts.
- Produces: `canonicalizePlannedPath`, `assertDisjointPaths`, `resolveOwnedPath`, `ProtectedPathPolicy`, `redactText`, and `ProcessRunner`.

**What:** Establish fail-closed filesystem, secret-redaction, and shell-free process boundaries used by every later mutation and adapter.

**Where:** `packages/security/` plus root project/workspace references.

**How:** Create adversarial fixtures first, canonicalize through real paths, protect credential locations before reads, use keyed fingerprints, and invoke executables with argv arrays.

**Test:** Path confusion, symlink escape, newline bypass, secret reflection, timeout, and injection tests pass; security review has no unresolved P0/P1 finding.

- [x] **Step 1: Write failing path tests**

Create the `@developer-os/security` package with the same build, export, strict TypeScript, and Node/Vitest configuration as `@developer-os/core`. Add `@developer-os/core: workspace:*` as its only workspace dependency and `../../packages/core` as its TypeScript project reference. Add the security project to root TypeScript references and root `test.projects`.

Use a temporary home with product, Brain, outside, and a symlink from Brain to outside. Prove equal/nested paths and symlink escapes fail with code 5 while disjoint paths pass.

- [x] **Step 2: Write failing redaction and process tests**

Fixtures cover `.env`, `.ssh/id_ed25519`, `.config/gh/hosts.yml`, PEM markers, provider tokens, bearer tokens, high-entropy strings, and `curl example.invalid |\nsh`. Prove protected files are refused before the injected reader runs and normalized commands are checked before execution.

Assert redaction returns only:

```typescript
export interface RedactionFinding {
  readonly class: string;
  readonly fingerprint: string;
}

export interface RedactionResult {
  readonly text: string;
  readonly findings: readonly RedactionFinding[];
}

export interface SecurityPolicy {
  assertReadable(path: string): Promise<void>;
  assertWritable(path: string): Promise<void>;
  assertDisjoint(paths: readonly string[]): Promise<void>;
  redact(text: string): RedactionResult;
  assertCommand(request: ProcessRequest): void;
}
```

No field may retain the source secret.

- [x] **Step 3: Run red**

```bash
pnpm vitest run packages/security/src
```

Expected: FAIL because the package does not exist.

- [x] **Step 4: Implement safe paths and protected policy**

Resolve the nearest existing ancestor with `realpath`, append unresolved segments, normalize, and compare path-segment boundaries. Re-resolve at apply time. Reject NUL bytes, path traversal, protected credential paths, and symlink escapes.

- [x] **Step 5: Implement redaction and process runner**

`redactText` replaces matches with `[REDACTED:class]`. Its 16-hex fingerprint is a truncated HMAC-SHA-256 produced with a generated owner-only installation key; never store an unkeyed digest of the secret. The runner contract is:

```typescript
export interface ProcessRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly stdin: string;
  readonly timeoutMs: number;
  readonly env: Readonly<Record<string, string>>;
}

export interface ProcessResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface ProcessRunner {
  run(request: ProcessRequest): Promise<ProcessResult>;
}
```

Use `spawn(executable, args, { shell: false, cwd, env, stdio: "pipe" })`; enforce timeout and redact returned output.

- [x] **Step 6: Verify, security-review, and commit**

```bash
pnpm vitest run packages/security/src
npm run lint && npm test
git add packages/security/package.json packages/security/tsconfig.json packages/security/vitest.config.ts packages/security/src/paths.ts packages/security/src/paths.test.ts packages/security/src/protected-paths.ts packages/security/src/protected-paths.test.ts packages/security/src/redaction.ts packages/security/src/redaction.test.ts packages/security/src/process.ts packages/security/src/process.test.ts packages/security/src/index.ts tsconfig.json vitest.config.ts pnpm-lock.yaml
git diff --cached --check
npm run lint && npm test
git commit -m "feat: add foundation security boundaries"
```

Reviewer actively tests prefix confusion, symlink race, newline bypass, secret reflection, and shell injection. No P0/P1 finding remains.

---

### Task 5: Implement recoverable filesystem transactions

> **Completed 2026-07-27.** Task 5 shipped with the kernel exclusion protocol
> designed in
> `docs/superpowers/specs/2026-07-22-developer-os-kernel-transaction-lock-design.md`,
> which remains the reference for review and drift checks. The implementation
> plan that carried it was deleted when its last step closed; recover it from
> git history if the reasoning is ever needed. No lease, heartbeat, stale-owner,
> quarantine, or lock-file deletion behavior exists anywhere in the result.
>
> **What Task 7 inherits, and must not undo:**
>
> - `packages/core` owns a mandatory, platform-neutral `TransactionLockProvider`
>   port; `packages/platform-macos` implements it over `/usr/bin/lockf` in
>   descriptor mode. Core contains no macOS conditional and never spawns.
> - `TransactionLockContext` carries a mutable `active` flag, cleared before
>   release. Reentrancy requires it, so an async descendant that outlives the
>   outer scope re-acquires instead of proceeding on a released handle.
> - The macOS provider is deliberately stricter than the design listing: it pins
>   the parent directory's `dev`/`ino` and re-asserts both parent and lock-file
>   identity *after* `lockf` returns, and it validates the descriptor's type and
>   owner *before* `chmod(0o600)`. Four adversarial tests pin this. Do not
>   simplify them away when adding platform facts.
> - The stable lock file is never unlinked. `<state>/transactions/` therefore
>   accumulates one permanent `0600` lock file per transaction id, and a core
>   test asserts that file's presence — wiring the real provider must not break
>   it. Whether that accumulation wants collection is an open founder question.
> - `SpawnLockfRunner` calls non-blocking `lockf -t 0` with no watchdog. Whether
>   it needs one is the second open founder question.
>
> **Environment note.** The offline `pnpm` store cannot materialize a full
> install in this checkout, so `pnpm install --frozen-lockfile --offline` fails
> on unrelated pre-existing tarballs after its lockfile check passes. The
> equivalent persistence check is
> `pnpm install --lockfile-only --frozen-lockfile --offline --ignore-scripts --trust-lockfile`.
> `packages/platform-macos` also needed its `node_modules/@developer-os/core`
> workspace symlink created by hand, mirroring `packages/security`; any working
> `pnpm install` creates it from the `link:../core` entry already in the
> lockfile. `packages/platform-macos/tsconfig.json` must stay free of a `paths`
> alias, like every sibling package.

**Complexity:** L

**Files:**
- Create: `packages/core/src/transactions/types.ts`
- Create: `packages/core/src/transactions/store.ts`
- Create: `packages/core/src/transactions/executor.ts`
- Create: `packages/core/src/transactions/recovery.ts`
- Create: `packages/core/src/transactions/transactions.test.ts`
- Create: `packages/core/src/transactions/index.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: runtime paths and result types directly, plus injected safe-path and redaction capabilities. `@developer-os/core` must not import `@developer-os/security`; the dependency remains one-way from security to core.
- Produces: `TransactionPhase`, `FileMutation`, `TransactionJournalV1`, `TransactionStore`, `TransactionExecutor`, and recovery results.

**What:** Make each filesystem mutation durable, resumable, rollback-capable, and resistant to concurrent edits.

**Where:** `packages/core/src/transactions/` and the core export surface.

**How:** Drive implementation with phase-by-phase failure injection, persist journals atomically, compare hashes before apply/rollback, and inject guards to avoid a package cycle.

**Test:** Every interruption phase resumes or rolls back to exact bytes; concurrent edits refuse overwrite; the full lint/test gate passes.

- [x] **Step 1: Write table-driven failure-injection tests**

Inject a stop after each phase:

```typescript
const phases = [
  "planned",
  "backed_up",
  "staged",
  "validated",
  "applied",
  "verified"
] as const;
```

For every stop, assert safe resume or rollback to exact original bytes. Add a concurrent edit between backup and apply.

- [x] **Step 2: Run red**

```bash
pnpm vitest run packages/core/src/transactions/transactions.test.ts
```

Expected: FAIL because transaction modules do not exist.

- [x] **Step 3: Define the journal**

```typescript
export type TransactionPhase =
  | "planned"
  | "backed_up"
  | "staged"
  | "validated"
  | "applied"
  | "verified"
  | "finalized"
  | "rolled_back";

export interface FileMutation {
  readonly targetPath: string;
  readonly operation: "create" | "replace" | "remove";
  readonly expectedBeforeHash: string | null;
  readonly stagedRelativePath: string | null;
}

export interface TransactionJournalV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly kind: string;
  readonly phase: TransactionPhase;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly mutations: readonly FileMutation[];
}

export interface TransactionGuards {
  assertTarget(path: string): Promise<void>;
  redactDiagnostic(text: string): string;
}
```

Inject clock, ID generation, filesystem operations, and `TransactionGuards`. The CLI composition root supplies the concrete security implementation, preventing a core/security package cycle.

- [x] **Step 4: Implement durable transitions and rollback**

Write journal JSON to an owner-only sibling temporary file, `fsync`, rename, then `fsync` its parent. Reject non-monotonic or stale transitions. Backup exact bytes/metadata, stage and validate, recheck source hashes, atomically apply, verify hashes, then finalize.

Rollback compares current post-apply hashes before restore. Concurrent edits return code 3 rather than overwrite.

- [x] **Step 5: Verify, review, and commit**

```bash
pnpm vitest run packages/core/src/transactions/transactions.test.ts
npm run lint && npm test
git add packages/core/src/transactions packages/core/src/index.ts packages/core/package.json
git diff --cached --check
npm run lint && npm test
git commit -m "feat: add recoverable file transactions"
```

Reviewer checks durability, phase monotonicity, permissions, symlink re-resolution, concurrent edits, and rollback byte equality.

---

### Task 6: Track owned artifacts and configuration drift

**Complexity:** L

**Files:**
- Create: `packages/core/src/manifest/types.ts`
- Create: `packages/core/src/manifest/store.ts`
- Create: `packages/core/src/manifest/drift.ts`
- Create: `packages/core/src/manifest/manifest.test.ts`
- Create: `packages/core/src/manifest/index.ts`
- Create: `packages/core/src/plans/types.ts`
- Create: `packages/core/src/plans/validate.ts`
- Create: `packages/core/src/plans/plans.test.ts`
- Create: `packages/core/src/plans/index.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: transaction store, hashing, config, and safe paths.
- Produces: `ManagedArtifactV1`, `InstallationManifestV1`, `ChangePlanV1`, `DriftFinding`, `ManifestStore`, and `validateChangePlan`.

**What:** Record exactly what Developer OS owns and prevent repair/update/uninstall from claiming or overwriting unrelated files.

**Where:** `packages/core/src/manifest/`, `packages/core/src/plans/`, and core exports.

**How:** Validate exact targets before transactions, preserve before/installed evidence, and report conflicts without automatic resolution.

**Test:** Ownership, duplicate target, out-of-root, unmanaged removal, drift, and forged-manifest tests pass with the full lint/test gate.

> **Derived contract (2026-07-27).** This task fixes `ManagedArtifactV1` and
> `InstallationManifestV1` exactly, and those ship field-for-field as written.
> It names `ChangePlanV1`, `DriftFinding`, `ManifestStore`, and
> `validateChangePlan` without defining them; those were derived from design
> spec §9.2–9.4 and reviewed. What a later task must not silently change:
>
> - **Ownership comes from the target's location, never from the manifest.**
>   `validateChangePlan` checks the target against `ownedRoots`/`excludedRoots`
>   first; a manifest entry naming an out-of-root path grants nothing. Roots are
>   matched **exactly** to grant and **case-folded, NFC-normalized** to deny,
>   because macOS volumes are case-insensitive by default and an exclusion
>   compared exactly would miss `<home>/BACKUPS`. Manifest lookup and duplicate
>   detection fold **canonicalized** paths; `validateManifest`'s own uniqueness
>   check folds **declared** paths, because it has no canonicalizer. Together
>   they stop `Settings.json` being created over a managed `settings.json`.
>   The roots are re-checked **after** canonicalization against the declared
>   ones, and the test is whether canonicalization *grew* authority — a canonical
>   root that contains its own declared root resolved to an ancestor. A
>   user-writable `~/.claude` symlinked to `/` or to `$HOME` would otherwise
>   widen ownership while every declared-root check still passed. Enumerating
>   forbidden roots instead would not work, because `$HOME`, `~/.ssh`, and `/etc`
>   would each need naming; a sideways relocation such as
>   `~/.claude -> ~/Dropbox/claude` stays allowed.
>
>   **Known residual.** The rule is anchored on each root's own declared path, so
>   it stops *widening* but not *relocation*: `~/.claude -> ~/Documents` is
>   neither an ancestor nor nested nor excluded, and is accepted, granting the
>   plan ownership of that tree. Credential directories are caught one layer
>   down by `ProtectedPathPolicy`; an ordinary directory is not. Closing this
>   needs an anchor on `ChangePlanContext` — the composition root knows the user
>   home — and is Task 8's call, not a silent gap.
> - **`validateChangePlan` is async and canonicalizes through an injected
>   `ChangePlanContext.canonicalize`** before any containment test. Lexical
>   matching alone is not enough: a symlink planted inside an owned root
>   otherwise resolves into the Brain while still matching the owned root as a
>   string, and nothing downstream catches it — `ProtectedPathPolicy` knows
>   about `.ssh`/`.aws`/`.gnupg`/`.env`, not about the Brain or `<state>/backups`.
>   The composition root supplies `canonicalizePlannedPath`, which resolves the
>   longest existing ancestor and tolerates a target that does not exist yet.
> - `replace` and `remove` additionally require the operation's `owner`, `kind`,
>   and `mergeStrategy` to equal the recorded artifact's, and its
>   `expectedBeforeHash` to equal the recorded `installedHash`.
> - A context with no `excludedRoots`, or with `/` as an owned root, is refused.
> - **Core reads user files through an injected `ManifestGuards.assertReadable`**,
>   because `packages/core` must not import `packages/security`. Drift inspection
>   and conflict evidence render file content into diagnostics, so every read
>   passes the guard, uses `O_RDONLY | O_NOFOLLOW` with a `dev`/`ino` re-check
>   after open, and is size capped.
>
>   **Task 8 must supply exactly this and no other shape.** `assertReadable`
>   returns `join(realpath(dirname(path)), basename(path))` — ancestors
>   canonicalized, final component verbatim — and unlike
>   `TransactionGuards.assertTarget` it returns a path rather than `void`.
>   `ProtectedPathPolicy.assertReadable` and the `SecurityPolicy` interface in
>   Task 4 still return `Promise<void>`, so wiring this is a compile error until
>   they change. **`canonicalizePlannedPath` is the wrong function here**: it
>   realpaths the whole path when the target exists and only walks up on
>   `ENOENT`, so it resolves the final component. It is the right function for
>   `ChangePlanContext.canonicalize`, which wants full resolution, and the wrong
>   one for `assertReadable`, which must not. Do not fix that error with
>   `async p => { await policy.assertReadable(p); return p; }` — that returns the
>   unvalidated path and reopens the intermediate-symlink hole. Do not use a full
>   `realpath` either: resolving the final component makes core's `lstat` check
>   dead, so a managed file swapped for a symlink is read through it and a
>   managed `kind: "symlink"` artifact reports `type_changed` forever.
> - `ManifestStore.read()` throws `ManifestMissingError` (code 2) when no
>   manifest exists and `ManifestStateError` (code 6) only when one exists and is
>   corrupt. `readOptional()` returns null for the absent case. A machine that
>   never ran `init` must not be told to run transaction recovery.
>
> **Deferred, failing closed.** `validateManifest` currently **refuses**
> `kind: "config-entry"`. Verifying one needs the semantic merge that arrives
> with the Claude and Codex adapters, and accepting it would let `doctor` report
> a clean tree it never actually checked. The kind stays in `ManagedArtifactV1`;
> lift the refusal in DOS-P4/DOS-P5 together with real semantic-merge drift
> detection, and add the three-way diff design §9.3 requires — Foundation ships
> the two-way form (current vs proposed) named in Step 4.

- [x] **Step 1: Write failing manifest and plan tests**

Prove create/replace ownership, unchanged and drifted hashes, duplicate-target refusal, out-of-root refusal, unmanaged-remove refusal, Brain/backups exclusion, and read-only drift detection.

- [x] **Step 2: Run red**

```bash
pnpm vitest run packages/core/src/manifest packages/core/src/plans
```

Expected: FAIL because modules do not exist.

- [x] **Step 3: Define exact ownership types**

```typescript
export interface ManagedArtifactV1 {
  readonly owner: "core" | "claude" | "codex" | "macos";
  readonly path: string;
  readonly kind: "file" | "directory" | "symlink" | "config-entry";
  readonly productVersion: string;
  readonly existedBefore: boolean;
  readonly beforeHash: string | null;
  readonly backupRelativePath: string | null;
  readonly installedHash: string;
  readonly source: string;
  readonly mergeStrategy: "dedicated" | "semantic-json" | "semantic-toml";
  readonly verifiedAt: string;
}

export interface InstallationManifestV1 {
  readonly schemaVersion: 1;
  readonly productVersion: string;
  readonly installedAt: string;
  readonly artifacts: readonly ManagedArtifactV1[];
}
```

Each change-plan operation contains exact target, expected prior hash, owner, operation type, and staged source. Validate before transaction creation.

- [x] **Step 4: Implement drift and three-way evidence**

Return `missing`, `content_changed`, `type_changed`, or `target_changed` with expected/actual hashes. For a conflict, report baseline backup, current hash, proposed hash, and redacted unified diff. Do not auto-resolve.

- [x] **Step 5: Verify, review, and commit**

```bash
pnpm vitest run packages/core/src/manifest packages/core/src/plans
npm run lint && npm test
git add packages/core/src/manifest packages/core/src/plans packages/core/src/index.ts
git diff --cached --check
npm run lint && npm test
git commit -m "feat: track managed installation artifacts"
```

Reviewer proves update/uninstall cannot gain ownership merely by editing a manifest.

---

### Task 7: Add the macOS platform boundary

> **Completed 2026-07-29.** `packages/platform-macos` was extended, not
> re-scaffolded: `transaction-lock.ts` and its tests are untouched, `index.ts`
> gained additive exports only, and `tsconfig.json` still carries no `paths`
> alias. The root `tsconfig.json` and `vitest.config.ts` already listed this
> package, so Task 7's "keep the existing entries without duplicating them"
> required no edit to either file.
>
> **What Task 8 inherits, and must not undo:**
>
> - **`AgentDiscovery.version` is always `null` in Foundation, by design.**
>   Filling it means executing a `PATH`-resolved binary, which this boundary
>   never does, and design spec §6.6 assigns version detection to the agent
>   adapters. DOS-P4/DOS-P5 populate it. Task 8 is the *no-agent* lifecycle and
>   has no consumer for it.
> - **`discoverExecutable` distinguishes absence from malfunction.** A non-zero
>   `which` exit, or a zero exit with empty output, is `installed: false` —
>   reported data, because printing nothing is consistent with absence. A zero
>   exit with output that `which` could never legitimately produce — any
>   `\p{Cc}` control character, non-absolute, or bearing a `[REDACTED:` marker —
>   throws `MacOsPlatformDiscoveryError` (code 1). This is not defensive
>   padding: `ProcessRunner` redacts its own stdout, and a real path such as
>   `<home>/.cache/<40-char-segment>/bin/claude` comes back as
>   `<home>/.[REDACTED:high-entropy]` — still absolute, still single-line. The
>   first implementation reported that as `installed: true` with a path that
>   never existed on disk. A test drives the real `redactText` over that input,
>   so it fails loudly if redaction is ever retuned. The control-character class
>   is `\p{Cc}` rather than `[\0\n\r]` because the directory component comes
>   from the caller's `PATH`, and Task 8 renders this value to a terminal and
>   writes it into the manifest; an embedded ESC is terminal-escape injection
>   into both. `MacOsPlatformDiscoveryError`'s message deliberately does not
>   interpolate the candidate — that would leak the `PATH`-derived string the
>   check just refused.
> - **`cwd: "/"` on the discovery request is load-bearing; do not change it to
>   `process.cwd()`.** Apple's `which` maps an empty `PATH` element to `.`, so a
>   trailing colon in `PATH` — common — makes it probe `./claude` and print a
>   relative result on success. Anchoring at `/`, where no agent binary lives,
>   is what keeps that from becoming a false positive before the non-absolute
>   check ever sees it.
> - **Malformed input is code 2 on every method.** `assertHomeShape` runs inside
>   `inspect()` *before* the injected canonicalizer, so a relative, upward-
>   traversing, NUL-bearing, or `/` home is `invalidInput` rather than
>   `securityRefusal`. Code 5 stays reserved for a genuine canonicalizer
>   refusal. Do not let a later composition root reintroduce the split by
>   canonicalizing first.
> - **Two gates, deliberately different widths. The test is whether the method
>   touches the host, not whether it reads architecture.** `inspect` and
>   `discoverExecutable` read host state and spawn a process, so both take
>   `#assertSupportedPlatform` (platform, architecture, release).
>   `productStateRoot`/`proposedBrainRoot` are pure string functions of their
>   argument, so they take `#assertDarwin` (platform identity only) — the only
>   question they owe is whether this is the right adapter. Do not "fix" the
>   asymmetry by dropping `discoverExecutable` to the narrow gate. The visible
>   consequence is that on a Darwin/`ia32` host `productStateRoot` answers while
>   `inspect` throws code 4; that is right for `doctor`, and unreachable for
>   `init`, which must call `inspect` first to obtain `userHome`.
> - `productStateRoot`/`proposedBrainRoot` agree with `resolveRuntimePaths` in
>   `packages/core/src/config/paths.ts`, and a test pins that agreement. The
>   literals are duplicated across two packages; the test is the drift guard.
> - Only `PATH` is forwarded to the discovery subprocess, and an empty `PATH`
>   falls back to `/usr/bin:/bin:/usr/sbin:/sbin`. `NodeProcessRunner` replaces
>   the child environment rather than merging it, so nothing else leaks.
>
> **Open question, reinforced not resolved — and now larger than Task 5 sized
> it.** `NodeProcessRunner.finishFromClose` returns early while
> `closeInformation` is `undefined`, so the post-`SIGKILL` escalation cannot
> settle the promise: a child that survives `SIGKILL` leaves it pending
> *forever*, not merely late, and `discoverExecutable` hangs with it. The defect
> is in `packages/security/src/process.ts`, outside this task's files and
> already reviewed under Task 4, so it was deliberately not fixed here. What
> changed is the blast radius: the runner now has **two** consumers that depend
> on its timeout being terminal — the transaction lock and agent discovery.
> That is the fact that should decide the founder's answer to the watchdog
> question Task 5 opened. Unreachable in the committed tree, because nothing
> wires `MacOsPlatformAdapter` to `NodeProcessRunner` yet; Task 8 is what makes
> it reachable.
>
> **One duplication accepted knowingly.** `REDACTION_MARKER` restates a literal
> that `packages/security/src/redaction.ts` owns and does not export. The test
> that drives the real `redactText` is the drift guard. The clean version is for
> the security package to export the marker, or a `containsRedaction` predicate,
> so the platform boundary asks the redactor what its own output looks like
> instead of guessing — that is a security-package change, not a Task 7 one.
>
> **Environment note.** `packages/platform-macos/node_modules/@developer-os/security`
> was created by hand, exactly as Task 5 recorded for `core`; any working
> `pnpm install` creates it from the `link:../security` entry now in the
> lockfile.

**Complexity:** M

**Files:**
- Modify: `packages/platform-macos/package.json`
- Modify: `packages/platform-macos/tsconfig.json`
- Modify: `packages/platform-macos/vitest.config.ts`
- Create: `packages/platform-macos/src/types.ts`
- Create: `packages/platform-macos/src/macos.ts`
- Create: `packages/platform-macos/src/macos.test.ts`
- Modify: `packages/platform-macos/src/index.ts`
- Modify: `tsconfig.json`
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: `ProcessRunner` and safe paths.
- Produces: `PlatformAdapter`, `PlatformFacts`, `AgentDiscovery`, and `MacOsPlatformAdapter`.

**What:** Isolate macOS discovery and path defaults behind an injected platform contract without adding installation side effects.

**Where:** `packages/platform-macos/` plus root project/workspace references.

**How:** Inject operating-system facts and the process runner, support only Darwin arm64/x64, and treat missing agent executables as reported data.

**Test:** Darwin/non-Darwin and executable discovery fixtures pass; no Keychain or scheduler operation occurs; the full lint/test gate passes.

- [x] **Step 1: Extend the package with failing injected-platform tests**

Extend the minimal `@developer-os/platform-macos` package created by Task 5;
read that task's completion note above before touching this package. Preserve
its transaction-lock exports and tests. Add
`@developer-os/security: workspace:*` beside its existing core dependency, add
security beside core in its TypeScript project references, and keep the existing
root TypeScript/Vitest project entries without duplicating them.

Prove non-Darwin returns code 4; Darwin returns OS/architecture/home; executable discovery uses `/usr/bin/which` through `ProcessRunner`; missing executables are data; no Keychain or scheduler command is called.

- [x] **Step 2: Run red**

```bash
pnpm vitest run packages/platform-macos/src/macos.test.ts
```

Expected: FAIL because the platform facts and discovery modules do not exist.

- [x] **Step 3: Implement the interface**

```typescript
export interface PlatformFacts {
  readonly platform: "darwin";
  readonly architecture: "arm64" | "x64";
  readonly release: string;
  readonly userHome: string;
}

export interface AgentDiscovery {
  readonly name: "claude" | "codex";
  readonly installed: boolean;
  readonly executablePath: string | null;
  readonly version: string | null;
}

export interface PlatformAdapter {
  inspect(): Promise<PlatformFacts>;
  discoverExecutable(name: "claude" | "codex"): Promise<AgentDiscovery>;
  productStateRoot(userHome: string): string;
  proposedBrainRoot(userHome: string): string;
}
```

Use injected platform, architecture, OS release, home, and runner values. Do not implement `launchd` until Program Task 7.

- [x] **Step 4: Verify, review, and commit**

```bash
pnpm vitest run packages/platform-macos/src/macos.test.ts
npm run lint && npm test
git add packages/platform-macos/package.json packages/platform-macos/tsconfig.json packages/platform-macos/vitest.config.ts packages/platform-macos/src/types.ts packages/platform-macos/src/macos.ts packages/platform-macos/src/macos.test.ts packages/platform-macos/src/index.ts tsconfig.json vitest.config.ts pnpm-lock.yaml
git diff --cached --check
npm run lint && npm test
git commit -m "feat: add macos platform boundary"
```

---

### Task 8: Implement the no-agent CLI lifecycle

> **Completed 2026-07-31.** Five commands over the Foundation contracts, no agent
> integration, no network. Two fresh-context reviewers found two P0 defects that
> the first implementation shipped with; both are fixed and pinned by regression
> tests. What Task 9 inherits, and must not undo:
>
> - **`CliContext` carries five members beyond the eight this plan fixes** —
>   `fs`, `executor`, `guards`, `paths`, `productVersion`. The eight cannot be
>   used without them: `transactions` and `manifests` are stores, not a
>   filesystem, and nothing else can build an executor. `ids` is in the contract
>   and deliberately unused — `TransactionExecutor` generates its own identifiers,
>   and calling `ids.next()` as well would desynchronise them.
> - **`ManifestGuards.assertReadable` is supplied by the composition root, not by
>   changing `packages/security`.** Task 6 predicted a compile error here and it
>   is real; the fix is `assertReadableArtifactPath` in `apps/cli/src/context.ts`,
>   which canonicalizes the **parent** with `canonicalizePlannedPath` and appends
>   `basename` verbatim. `ProtectedPathPolicy.assertReadable` and the `Task 4`
>   `SecurityPolicy` interface are untouched and still return `Promise<void>`.
>   **The policy is asked twice — about the caller's path and about the
>   ancestor-resolved result — and both calls are load-bearing.** A leaf symlink
>   that points back out of `~/.ssh` passes the first check and is refused only by
>   the second; a test asserts the single check accepts it, so collapsing the two
>   fails loudly.
> - **A finalized transaction cannot be rolled back, so `init` undoes itself with
>   a compensating transaction.** `TransactionExecutor.execute()` runs through to
>   `finalized` before returning, and `rollback` on a finalized journal throws
>   code 6. The revert is therefore the same operation `uninstall` performs, and
>   it is the same code (`revertArtifacts`). Do not "fix" this back into
>   `executor.rollback`. Running `doctor` inside the transaction's verify phase is
>   the other tempting shape and it deadlocks: `doctor` reads journals through
>   `context.transactions`, a different `TransactionStore` instance, so the
>   reentrancy check in `withTransactionLock` misses and the lock is unavailable.
> - **The Brain skeleton is recorded in the manifest, and uninstall still cannot
>   remove it.** `init` owns what it created, so a failed install undoes the
>   `.gitkeep` and the vault directory completely. `uninstall` passes
>   `ownedRoots: [productHome]` and `excludedRoots: [brain]`, so Brain artifacts
>   are refused by location. Those are two different ownership universes over one
>   manifest, and that is the point.
> - **Ownership is decided on the declared path *and* the canonical path, for
>   every artifact kind.** Directory artifacts never reach `validateChangePlan` —
>   the executor moves files only — so they carried no canonicalization at all in
>   the first implementation. A manifest naming `<productHome>/link/x`, where
>   `link` is a symlink to the vault, drove `rmdir` into the Brain. `rmdir` being
>   non-recursive bounds *what* is deleted, never *where*. `removeDirectories`
>   now `lstat`s the canonical path and skips anything that is not a real
>   directory.
> - **Ownership is re-resolved immediately before each `rmdir`, and an absent
>   directory is never removed.** Deciding once, before the transaction, is not
>   enough: the transaction writes a journal and then fsyncs for hundreds of
>   milliseconds, which is a deterministic signal and a deterministic window for
>   an attacker to turn an ancestor into a symlink after the decision. Two rules
>   close it — a directory whose drift is `missing` is skipped (its canonical form
>   is its own declared path, so nothing resolves it into the Brain until the
>   ancestor is planted), and the canonical path is recomputed in the removal loop
>   and any disagreement preserves the artifact. What remains is the gap between
>   that call and `rmdir` itself, which needs `unlinkat` on a directory descriptor
>   to close and is recorded rather than hidden.
> - **Machine health is a precondition of `init`, not a postcondition.** With the
>   full `doctor` report as the only post-apply gate, one stale journal from an
>   earlier interrupted run made every subsequent `init` install successfully and
>   then revert itself, forever. `assertNoIncompleteTransaction` runs before any
>   mutation and returns code 6 with both repair commands.
> - **Configuration is read through the policy, and the TOML parser's message
>   never escapes.** `smol-toml` embeds three raw source lines in `TomlError`, so
>   propagating it printed the contents of whatever file was read into `status`,
>   `doctor`, and their JSON. Redaction is a heuristic — it does not catch
>   `DATABASE_URL=postgres://user:pw@host/db` — and must not be the only thing
>   standing there. Absence is detected with `lstat` first, because the guarded
>   reader reports a missing file as a security refusal.
> - **`renderPath` sanitizes every path that reaches a terminal or a JSON field.**
>   `isManagedPath` accepts any absolute NUL-free string, so an artifact path may
>   carry ANSI escapes and repaint the uninstall confirmation prompt — the only
>   consent gate on deletion. `config.brainPath` reaches the `init` prompt the
>   same way. Task 7 already refuses control characters coming out of `which`;
>   this is the same rule on the way back out. It covers `\p{Cf}` as well as
>   `\p{Cc}`, because U+202E reorders rendered text without being a control
>   character, and it is deliberately **not** applied to `--json`, where
>   `JSON.stringify` escapes those code points itself and a machine consumer needs
>   the value as recorded.
> - **Every `doctor` check has its own error boundary.** Doctor is the command run
>   on exactly the machines where reads fail, and an escaping rejection there
>   became an unhandled top-level rejection with a stack trace and no report.
>
> **Deviations from this task's staged path list**, all additive: this task also
> stages `apps/cli/vitest.config.ts` (aliases for the two new workspace
> dependencies, so tests run against source rather than `dist`),
> `apps/cli/src/context.test.ts` and `apps/cli/src/commands/testing.ts` (the guard
> wiring and the shared fixture are the highest-risk code here and were otherwise
> untested), `apps/cli/src/main.test.ts` (the usage string it pinned no longer
> exists), and `pnpm-lock.yaml` (the CLI gained two workspace dependencies; a
> lockfile disagreeing with `package.json` breaks `--frozen-lockfile`).
>
> **Environment note.** `apps/cli/node_modules/@developer-os/{security,platform-macos}`
> were created by hand, exactly as Tasks 5 and 7 recorded; any working
> `pnpm install` creates them from the `link:` entries now in the lockfile.
>
> **Named residuals, for Task 9 to close or record.** Two fresh-context reviewers
> agreed none of these blocks the commit. Numbers 1 and 2 are the ones that matter:
> each is a state a user can reach and not command their way out of, and number 1
> reports *success* while doing it.
>
> 1. **A crash between `executor.execute()` returning and the manifest write
>    leaves an installation no command repairs.** The config file exists, the
>    journal says `finalized`, no manifest exists: `init` reports "already
>    initialized", `doctor` says "run init", `uninstall` removes nothing. The
>    remedy today is deleting the product home by hand. Closing it means writing
>    the manifest inside the transaction, or teaching `buildPlan` to re-adopt
>    on-disk artifacts when no manifest exists.
> 2. **A managed artifact that is *deleted* blocks `init`.** `assertNoDrift`
>    refuses on any finding, including `missing`, while `revertArtifacts`
>    deliberately skips `missing`. `doctor`'s drift check now carries the escape
>    (`uninstall`, then initialize again) as its `recovery` string, but `init`
>    should probably re-create what is missing rather than refuse.
> 3. **A malformed journal cannot be repaired through the CLI.** `repair` reads
>    the journal before checking its phase, so both actions fail with code 6 and
>    no command quarantines the file. `doctor` points at `repair`, which cannot
>    help, and `init` refuses with the generic state-error message and no
>    recovery. It wants a `repair --discard <id>`, which is a new command surface
>    and therefore not Task 8's to add.
> 4. **A revert leaves the product directories unmanaged.** `state`, `staging`,
>    and `backups` always hold the journal and backups of the transaction being
>    reverted, so `rmdir` refuses them and the manifest is then deleted. They
>    exist with no manifest entry, and `buildPlan` records only *missing*
>    directories, so no later `init` adopts them and no later `uninstall` removes
>    them. Empty directories only — no data loss, nothing misreported — but the
>    fix is to record every product directory the plan depends on, not only the
>    ones it created.
> 5. **A `kind: "symlink"` artifact would delete its target, not the link.**
>    `validateChangePlan` canonicalizes the leaf, so the executor unlinks the
>    resolved path. Latent — Foundation emits no symlink artifacts — and it lands
>    in DOS-P4/DOS-P5, which will.
> 6. **Directory removal still has a check-to-use window.** It is now one
>    canonicalization away from the `rmdir`, rather than a whole transaction away,
>    and an absent directory is never a candidate. Closing it entirely needs
>    `unlinkat` against a directory descriptor, which Node does not expose.
> 7. **A relocated product home makes `uninstall` a no-op.** `isRemovableAt`
>    requires declared-path containment while `recordArtifacts` stores canonical
>    paths, so `~/.developer-os -> ~/Dropbox/developer-os` preserves everything and
>    still deletes the manifest. Pre-existing, fails closed, and the declared check
>    is conservatism only — the canonical check carries the security — but it
>    should be decided deliberately rather than inherited.
> 8. **`assertRootsAnchored` is inert for a root named through
>    `DEVELOPER_OS_HOME`/`DEVELOPER_OS_BRAIN`**, because such a root anchors to
>    itself. It constrains symlink relocation of the default paths and of
>    `config.brainPath`, which is what Task 6's residual asked for; it is not a
>    containment policy for the environment.
>
> **Foundation ships no `--verbose`.** Design spec §8 lists it for every mutating
> command; Step 6 of this task does not, and dispatch is strict, so `--verbose`
> is rejected with code 2. Add it with the subsystem that has diagnostics worth
> printing.

**Complexity:** L

**Files:**
- Create: `apps/cli/src/context.ts`
- Create: `apps/cli/src/commands/init.ts`
- Create: `apps/cli/src/commands/init.test.ts`
- Create: `apps/cli/src/commands/status.ts`
- Create: `apps/cli/src/commands/status.test.ts`
- Create: `apps/cli/src/commands/doctor.ts`
- Create: `apps/cli/src/commands/doctor.test.ts`
- Create: `apps/cli/src/commands/repair.ts`
- Create: `apps/cli/src/commands/repair.test.ts`
- Create: `apps/cli/src/commands/uninstall.ts`
- Create: `apps/cli/src/commands/uninstall.test.ts`
- Modify: `apps/cli/src/main.ts`
- Modify: `apps/cli/src/bin.ts`
- Modify: `apps/cli/package.json`
- Modify: `apps/cli/tsconfig.json`

**Interfaces:**
- Consumes: all Foundation interfaces.
- Produces: `CliContext`, `InitResultV1`, `StatusReportV1`, `DoctorReportV1`, and five working commands.

**What:** Deliver `init`, `status`, `doctor`, `repair`, and `uninstall` over the Foundation contracts while installing no agent integration.

**Where:** `apps/cli/src/commands/`, CLI composition files, and CLI package/project references.

**How:** Test each command before implementation, keep inspection separate from mutation, require explicit plans and confirmation, and route writes through transactions and manifests.

**Test:** Command suites cover dry-run, refusal, idempotence, drift, recovery, and Brain preservation; CLI tests, build, lint, and full tests pass.

Before implementation, add `@developer-os/core`, `@developer-os/security`, and `@developer-os/platform-macos` as `workspace:*` CLI dependencies and all three projects as CLI TypeScript references.

- [x] **Step 1: Define the composition contract**

```typescript
export interface CliContext {
  readonly io: CliIo;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly userHome: string;
  readonly now: () => Date;
  readonly ids: { next: () => string };
  readonly platform: PlatformAdapter;
  readonly transactions: TransactionStore;
  readonly manifests: ManifestStore;
}
```

Only `bin.ts` creates production dependencies.

- [x] **Step 2: Write failing `init` tests**

Cover dry-run purity, declined confirmation, accepted initialization, existing Brain read-only validation, path overlap refusal, idempotent second init, and rollback after post-apply doctor failure.

Foundation creates only product state plus directories and `.gitkeep` for a new Brain; it creates no canonical note.

- [x] **Step 3: Run red and implement `init`**

```bash
pnpm vitest run apps/cli/src/commands/init.test.ts
```

Expected: FAIL before implementation.

Return:

```typescript
export interface InitResultV1 {
  readonly schemaVersion: 1;
  readonly productHome: string;
  readonly brainPath: string;
  readonly created: readonly string[];
  readonly unchanged: readonly string[];
  readonly transactionId: string | null;
}
```

Implement inspect, config/path validation, plan, confirmation, transaction, manifest, doctor, and rollback. Command modules never write directly.

- [x] **Step 4: Write and implement status/doctor tests**

Status reports config, manifest, incomplete transactions, drift count, agent discovery, and Brain existence without mutation.

Doctor uses:

```typescript
export interface DoctorCheck {
  readonly id: string;
  readonly status: "pass" | "warn" | "fail";
  readonly message: string;
  readonly paths: readonly string[];
  readonly recovery?: string;
}

export interface DoctorReportV1 {
  readonly schemaVersion: 1;
  readonly checks: readonly DoctorCheck[];
}
```

Incomplete transaction `tx_fixture_001` returns code 6 and exact resume/rollback commands. Doctor never repairs.

- [x] **Step 5: Write and implement repair/uninstall tests**

Repair accepts exactly one of `--resume tx_fixture_001` and `--rollback tx_fixture_001`. Invalid/finalized IDs return 2.

Uninstall dry-run lists only manifest-owned artifacts. Drift returns 3. Confirmed uninstall restores original shared bytes, removes product-created artifacts, preserves Brain/backups/unrelated files, and is idempotent.

- [x] **Step 6: Implement strict argument dispatch**

Use Node `parseArgs`. Support:

```text
developer-os init --dry-run --json
developer-os status --json
developer-os doctor --json
developer-os repair --resume tx_fixture_001 --json
developer-os repair --rollback tx_fixture_001 --json
developer-os uninstall --dry-run --json
```

Unknown commands/options return 2. `--yes` never bypasses drift, security, backup, or journal failures.

- [x] **Step 7: Verify, review, and commit**

```bash
pnpm vitest run apps/cli/src/commands
npm run lint && npm test
pnpm build
git add apps/cli/package.json apps/cli/tsconfig.json apps/cli/src/context.ts apps/cli/src/commands/init.ts apps/cli/src/commands/init.test.ts apps/cli/src/commands/status.ts apps/cli/src/commands/status.test.ts apps/cli/src/commands/doctor.ts apps/cli/src/commands/doctor.test.ts apps/cli/src/commands/repair.ts apps/cli/src/commands/repair.test.ts apps/cli/src/commands/uninstall.ts apps/cli/src/commands/uninstall.test.ts apps/cli/src/main.ts apps/cli/src/bin.ts
git diff --cached --check
npm run lint && npm test
git commit -m "feat: add safe foundation lifecycle"
```

Reviewer checks dry-run purity, no direct writes in commands, exit precedence, drift refusal, idempotence, and Brain preservation.

---

### Task 9: Prove the temporary-HOME lifecycle

**Complexity:** L

**Files:**
- Create: `tests/package.json`
- Create: `tests/tsconfig.json`
- Create: `tests/vitest.config.ts`
- Create: `tests/helpers/temp-home.ts`
- Create: `tests/helpers/run-cli.ts`
- Create: `tests/e2e/foundation.test.ts`
- Create: `docs/architecture/foundation.md`
- Create: `docs/releases/foundation-checkpoint.md`
- Modify: `tsconfig.json`
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: compiled CLI and all Foundation contracts.
- Produces: process-level evidence for the Foundation checkpoint.

**What:** Prove the complete Foundation lifecycle in an isolated process environment and publish reproducible evidence.

**Where:** `tests/`, `docs/architecture/foundation.md`, and `docs/releases/foundation-checkpoint.md`.

**How:** Execute the compiled binary under a temporary HOME with fake executables and dead proxies, inventory every byte, inject negative cases, and obtain fresh-context review.

**Test:** The full matrix, secret sentinel scan, path/hash snapshots, interruption cases, and final independent review all pass with a clean target tree.

- [ ] **Step 1: Write the failing E2E lifecycle**

Create `tests/package.json` as private package `@developer-os/tests` with `type: module`, a `test` script running `vitest run`, and `workspace:*` dependencies on CLI, core, security, and platform-macos. Its strict `tsconfig.json` extends the root base, emits from the package root to `dist`, includes `helpers/**/*.ts` and `e2e/**/*.ts`, and references all four workspace projects. Its Vitest config uses `defineProject`, Node, and includes `e2e/**/*.test.ts`. Add `tests` to root TypeScript references and `tests/vitest.config.ts` to root `test.projects`.

Run the compiled CLI with temporary `HOME`, `DEVELOPER_OS_HOME`, `DEVELOPER_OS_BRAIN`, fake `PATH`, and dead HTTP/HTTPS proxies. Assert:

```text
init --dry-run --json  -> no files
init --yes --json      -> state and empty Brain skeleton
status --json          -> healthy installed state
doctor --json          -> exit 0
init --yes --json      -> no changes
uninstall --yes --json -> product artifacts removed, Brain retained
uninstall --yes --json -> no changes
```

Snapshot every path/hash under the temporary root before and after each command and compare it to the declared result.

- [ ] **Step 2: Run red**

```bash
pnpm build
pnpm vitest run tests/e2e/foundation.test.ts
```

Expected: FAIL until helpers and binary composition are complete.

- [ ] **Step 3: Implement process-level helpers**

Create unique temporary directories and execute `node apps/cli/dist/bin.js` without a shell. Capture stdout/stderr, timeout, exit, and recursive hash inventory. Delete only the exact test directory after assertions.

- [ ] **Step 4: Add negative E2E cases**

Cover product/Brain nesting, symlink escape, read-only target, forged out-of-root manifest, user drift, every transaction interruption phase, attempted network use, and sentinel `DEVELOPER_OS_SECRET_SENTINEL_7f4c`. The sentinel must be absent from all files and output.

- [ ] **Step 5: Document architecture and evidence**

`foundation.md` records boundaries, interfaces, phases, ownership, exit codes, and explicit non-capabilities. `foundation-checkpoint.md` records exact commands, counts, hashes, and reviewer verdict from fresh output.

- [ ] **Step 6: Run full matrix**

```bash
npm run lint && npm test
pnpm build
pnpm test:e2e
git diff --check
```

Expected: all commands exit 0 and the sentinel scan reports zero findings.

- [ ] **Step 7: Final independent review and commit**

The reviewer checks Foundation spec coverage, clean public provenance, package boundaries, dry-run/idempotence, transaction recovery, ownership/drift, Brain preservation, and absence of network/credential access. Fix accepted findings with regression tests and rerun Step 6.

```bash
git add tests/package.json tests/tsconfig.json tests/vitest.config.ts tests/helpers/temp-home.ts tests/helpers/run-cli.ts tests/e2e/foundation.test.ts docs/architecture/foundation.md docs/releases/foundation-checkpoint.md tsconfig.json vitest.config.ts
git diff --cached --check
npm run lint && npm test
git commit -m "test: prove foundation lifecycle"
```

Expected: a clean working tree and a linear sequence of reviewed commits.

## Foundation completion gate

Foundation is complete only when:

- `npm run lint && npm test`, `pnpm build`, and `pnpm test:e2e` pass freshly;
- the temporary-HOME lifecycle is idempotent;
- interruption recovery and rollback pass at every phase;
- overlap, symlink escape, drift, forged manifest, and secret sentinel cases fail closed;
- no real agent config, Brain, credential, scheduler, Git remote, or network is touched;
- fresh-context review has no unresolved P0/P1 finding;
- the target working tree is clean;
- Program Task 2 can consume the frozen interfaces named above.
