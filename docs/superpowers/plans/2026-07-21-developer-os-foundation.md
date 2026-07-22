# Developer OS Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the clean `developer-os` monorepo and deliver a safe, idempotent no-agent CLI lifecycle: `init -> status -> doctor -> repair -> uninstall`.

**Architecture:** Keep the CLI as a thin orchestrator over typed core, security, and macOS platform packages. Route every mutation through an explicit change plan, ownership manifest, transaction journal, deterministic validation, and rollback. Inject home paths, filesystems, clocks, IDs, processes, and platform facts so tests never touch a real agent installation, Brain, credential, scheduler, Git remote, or network.

**Tech Stack:** Node.js 24.16.0, pnpm 11.3.0 workspaces, TypeScript strict mode, Vitest, ESLint flat config, `zod`, and `smol-toml`.

## Global Constraints

- Execute after Task 0's source-classification and publication-boundary review passes. Historical rotations explicitly waived in the Program plan are not part of this gate.
- Target remote: `git@github.com:msolecki/developer-os.git`.
- Target checkout: the current repository root after cloning; do not persist its machine-specific absolute path.
- Inspect remote hooks and MCP configuration before running commands in the checkout.
- Keep the repository private throughout Foundation.
- Do not import legacy Git history or bulk-copy source repositories.
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
- Consumes: the approved design and plans below the validated `DEVELOPER_OS_SOURCE_REPO` runtime path.
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

> **Active implementation addendum (2026-07-22):** Execute
> `docs/superpowers/plans/2026-07-22-developer-os-kernel-transaction-lock.md`
> for Task 5's exclusion protocol. It supersedes any lease, heartbeat,
> stale-owner, quarantine, or lock-file deletion behavior while preserving the
> transaction journal, durability, recovery, and rollback requirements below.

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

- [ ] **Step 1: Write table-driven failure-injection tests**

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

- [ ] **Step 2: Run red**

```bash
pnpm vitest run packages/core/src/transactions/transactions.test.ts
```

Expected: FAIL because transaction modules do not exist.

- [ ] **Step 3: Define the journal**

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

- [ ] **Step 4: Implement durable transitions and rollback**

Write journal JSON to an owner-only sibling temporary file, `fsync`, rename, then `fsync` its parent. Reject non-monotonic or stale transitions. Backup exact bytes/metadata, stage and validate, recheck source hashes, atomically apply, verify hashes, then finalize.

Rollback compares current post-apply hashes before restore. Concurrent edits return code 3 rather than overwrite.

- [ ] **Step 5: Verify, review, and commit**

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

- [ ] **Step 1: Write failing manifest and plan tests**

Prove create/replace ownership, unchanged and drifted hashes, duplicate-target refusal, out-of-root refusal, unmanaged-remove refusal, Brain/backups exclusion, and read-only drift detection.

- [ ] **Step 2: Run red**

```bash
pnpm vitest run packages/core/src/manifest packages/core/src/plans
```

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Define exact ownership types**

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

- [ ] **Step 4: Implement drift and three-way evidence**

Return `missing`, `content_changed`, `type_changed`, or `target_changed` with expected/actual hashes. For a conflict, report baseline backup, current hash, proposed hash, and redacted unified diff. Do not auto-resolve.

- [ ] **Step 5: Verify, review, and commit**

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

- [ ] **Step 1: Extend the package with failing injected-platform tests**

Extend the minimal `@developer-os/platform-macos` package created by the active
Task 5 addendum. Preserve its transaction-lock exports and tests. Add
`@developer-os/security: workspace:*` beside its existing core dependency, add
security beside core in its TypeScript project references, and keep the existing
root TypeScript/Vitest project entries without duplicating them.

Prove non-Darwin returns code 4; Darwin returns OS/architecture/home; executable discovery uses `/usr/bin/which` through `ProcessRunner`; missing executables are data; no Keychain or scheduler command is called.

- [ ] **Step 2: Run red**

```bash
pnpm vitest run packages/platform-macos/src/macos.test.ts
```

Expected: FAIL because the platform facts and discovery modules do not exist.

- [ ] **Step 3: Implement the interface**

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

- [ ] **Step 4: Verify, review, and commit**

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

- [ ] **Step 1: Define the composition contract**

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

- [ ] **Step 2: Write failing `init` tests**

Cover dry-run purity, declined confirmation, accepted initialization, existing Brain read-only validation, path overlap refusal, idempotent second init, and rollback after post-apply doctor failure.

Foundation creates only product state plus directories and `.gitkeep` for a new Brain; it creates no canonical note.

- [ ] **Step 3: Run red and implement `init`**

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

- [ ] **Step 4: Write and implement status/doctor tests**

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

- [ ] **Step 5: Write and implement repair/uninstall tests**

Repair accepts exactly one of `--resume tx_fixture_001` and `--rollback tx_fixture_001`. Invalid/finalized IDs return 2.

Uninstall dry-run lists only manifest-owned artifacts. Drift returns 3. Confirmed uninstall restores original shared bytes, removes product-created artifacts, preserves Brain/backups/unrelated files, and is idempotent.

- [ ] **Step 6: Implement strict argument dispatch**

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

- [ ] **Step 7: Verify, review, and commit**

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
