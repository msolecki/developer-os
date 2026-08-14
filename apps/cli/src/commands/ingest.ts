import { dirname, join } from "node:path";

import {
  containsPath,
  EXIT_CODES,
  foldPath,
  hashBytes,
  success,
  TransactionConflictError,
  validateChangePlan,
} from "@developer-os/core";
import type {
  CliResult,
  DeveloperOsConfigV1,
  ExitCode,
  InstallationManifestV1,
  ManagedArtifactV1,
  PlannedFileMutation,
  RuntimePaths,
} from "@developer-os/core";
import { DEFAULT_MAX_TURNS, invokeClaude } from "@developer-os/adapter-claude";
import { invokeCodex } from "@developer-os/adapter-codex";
import {
  BrainService,
  buildIngestPrompt,
  MAX_PROPOSED_PATH_CHARS,
  parseCaptureFile,
  parseIngestProposal,
  planIngestApply,
  renderCaptureFile,
  resolveBrainConfig,
  validateProposal,
} from "@developer-os/brain";
import type {
  BrainConfigV1,
  BrainServiceDependencies,
  CaptureStatus,
  DirectoryEntry,
  IngestValidationFinding,
  PlannedNoteWriteV1,
  ValidatorId,
} from "@developer-os/brain";
import type { AgentName } from "@developer-os/platform-macos";
import { redactText, screenAndCap } from "@developer-os/security";
import { resolveScopeGlob } from "@developer-os/workflow-schema";

import {
  exitCodeOf,
  failureFrom,
  loadOrCreateRedactionKey,
  renderPath,
  runtimePathsFor,
} from "../context.js";
import type { CliContext, CliGuards } from "../context.js";
import { isDirectory, readConfigFile } from "./doctor.js";
import { outputSchemaPath } from "./output-schemas.js";

/**
 * What `--json` publishes per capture: an id, the status it now holds, and the
 * content-root-relative paths this capture's proposal wrote. Never the note
 * bodies and never the observation — a machine consumer learns what moved and
 * where, and reads the notes in the vault like anybody else.
 */
export interface IngestedCaptureV1 {
  readonly captureId: string;
  readonly status: CaptureStatus;
  readonly notes: readonly string[];
}

export interface IngestResultV1 {
  readonly schemaVersion: 1;
  /**
   * The vendor that produced every proposal in this run, so a run is
   * attributable without re-deriving which agent was installed at the time.
   */
  readonly agent: AgentName;
  /** The captures this invocation selected, in `captureId` order. */
  readonly order: readonly string[];
  /**
   * One entry per capture this invocation reported on: the selected ones, plus
   * any whose own envelope could not be read. Unreadable captures are not
   * *processed*, so they are absent from `order` and present here.
   */
  readonly captures: readonly IngestedCaptureV1[];
  /** The subset of `captures` that reached `ingested`. */
  readonly applied: readonly IngestedCaptureV1[];
}

export interface IngestOptions {
  /** `--limit`. Absent means every accepted capture. */
  readonly limit?: number;
  /** `--agent`. Absent means the first installed vendor in `VENDOR_ORDER`. */
  readonly agent?: string;
  /**
   * `--yes`. Accepted and inert: **`ingest` never asks a question.** The human
   * gate for a capture is `review --decision accept`, already taken per capture
   * before this command can see it, and a second confirmation would re-ask a
   * question the user has already answered — which is why `capture` and
   * `review` prompt for nothing either. The flag is accepted so that a script
   * driving the whole pipeline non-interactively passes one vocabulary to every
   * verb rather than discovering that one of the three refuses it.
   */
  readonly assumeYes?: boolean;
}

/**
 * The `ingest` workflow's **declared, unresolved** write scopes, compiled in.
 *
 * Not the *resolved* set, because resolution is per-install: `resolveScopeGlob`
 * splices this vault's `contentRoot` and `indexesDir` into each glob, so nothing
 * about the resolved strings is knowable at build time. What is fixed between
 * releases is this list, and `ingest.test.ts` pins it against
 * `workflows/ingest/workflow.yaml` so a contract edit that does not update the
 * constant goes red. Resolution happens once per invocation, at the call site,
 * against the same `resolveBrainConfig(config)` every other Brain consumer uses.
 *
 * Reading the contract at runtime was rejected: it would make the workflow a
 * managed artifact this command depends on, which buys a runtime read for a new
 * manifest entry and a new drift surface.
 */
export const INGEST_DECLARED_WRITE_SCOPES = [
  "content/**",
  "content/_indexes/**",
] as const;

/**
 * Tried in this order when `--agent` is absent. A fixed order with no override
 * would make a second vendor reachable only by uninstalling the first, which is
 * not a thing to ask of anyone's machine — hence the flag.
 */
const VENDOR_ORDER: readonly AgentName[] = ["claude", "codex"];

/**
 * The Claude side of "zero declared write scopes" (spec §6.1): read tools only,
 * and **no write tool** — no `Write`, no `Edit`, no `Bash`, no `Task`. That is
 * what makes "the model cannot write" a property the vendor's own permission
 * system enforced before the model ran, rather than one our validators must
 * prove afterwards.
 *
 * Bare tool names rather than path-scoped permission rules, deliberately. The
 * read scope this command declares is a glob, and neither adapter's invocation
 * type carries a read-scope field at all: Codex expresses the read side as a
 * working root plus `-s read-only`, and Claude's `--allowedTools` takes
 * permission-rule syntax whose scoped form `claude-adapter.md` §14.3 names but
 * does not specify. Spec §10 is normative for external surfaces and an
 * implementation may not depend on one it does not carry, so the scoped form is
 * left to Task 17, which is the task that spends a real run against each vendor.
 */
const CLAUDE_READ_ONLY_TOOLS: readonly string[] = ["Read", "Grep", "Glob"];

/**
 * The verb whose JSON Schema `init` installs, and therefore the only value
 * `--output-schema` may be pointed at. `outputSchemaPath` is the one function
 * that names it, because `init` writing the file and this command naming it are
 * the two halves that must not drift.
 */
const INGEST_VERB = "ingest.stage";

/**
 * One model call per capture. Longer than the adapters' own 30 s probe default
 * because this call reads a vault and writes a proposal rather than printing a
 * version, and bounded at all because an unbounded agent invocation is a run
 * whose cost is decided by the model.
 */
const INGEST_TIMEOUT_MS = 120_000;

/**
 * Required by the shared `CliInstallation` shape and read by neither
 * `invokeClaude` nor `invokeCodex`, both of which use `executable` alone. No
 * `--version` probe is spawned to fill it in: this command already knows the
 * executable from `discoverExecutable`, and spending a process to learn a string
 * nothing reads would be a probe in all but name.
 */
const UNKNOWN_VERSION = "unknown";

/** Vault-relative, under the configured content root. Spec §3.4. */
const QUARANTINE_SEGMENTS = ["_raw", "quarantine"] as const;

const CAPTURE_FILE_SUFFIX = ".md";

/**
 * The four transactions one capture produces, plus the compensating fifth.
 *
 * **They cannot be one transaction**, and the correction is the point: the
 * ladder mutates two different ownership regimes and the executor's lock is
 * per-execution. The status must be durable *before* the apply, or a crash
 * cannot be told from a run that never started; `BrainService.reindex()` reads
 * the vault, so it cannot run until the apply has finalized; and `ingested` may
 * not be claimed before the note is findable.
 *
 * **The residual, stated rather than closed:** a crash between `apply` and
 * `ingested` leaves a capture at `staging` with its notes already written.
 * `staging` is not `accepted`, so the next run does not select it and cannot
 * double-apply — it is visible and inert, and `developer-os repair` plus a hand
 * edit of the status is what moves it. No arrangement of these removes that
 * window, because no two of them can share a transaction.
 */
const TRANSACTION_KINDS = {
  stage: "ingest-stage",
  apply: "ingest-apply",
  reindex: "ingest-reindex",
  ingested: "ingest-ingested",
  rollback: "ingest-rollback",
} as const;

/**
 * The two validators whose refusal is a **security refusal** rather than an
 * operational one. Spec §6.4 names exit 5 for write-scope; extending it to the
 * secret scan is this plan's reading and is stated rather than buried — a secret
 * coming back from a model and a path trying to leave the vault are the same
 * kind of event, and different in kind from a model that got a frontmatter key
 * wrong. Collapsing all three either way would make every model mistake read as
 * an attempted escape, or every escape read as a mistake.
 */
const SECURITY_VALIDATORS: readonly ValidatorId[] = ["secret-scan", "write-scope"];

const EMPTY_MANIFEST: InstallationManifestV1 = {
  schemaVersion: 1,
  productVersion: "0.0.0",
  installedAt: "1970-01-01T00:00:00.000Z",
  artifacts: [],
};

const NOT_INITIALIZED = "developer-os init";

const RETRY_LATER =
  "run developer-os ingest again; the capture is unchanged and still accepted";

type FailureExitCode = Exclude<ExitCode, typeof EXIT_CODES.success>;

class IngestRefusal extends Error {
  constructor(
    readonly code: FailureExitCode,
    message: string,
    readonly paths: readonly string[] = [],
    readonly recovery?: string,
  ) {
    super(message);
    this.name = "IngestRefusal";
  }
}

function isMissingEntry(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

/* --------------------------------------------------------- what to work on */

function resolveAgent(options: IngestOptions): AgentName | null {
  const { agent } = options;
  if (agent === undefined) return null;
  if (!(VENDOR_ORDER as readonly string[]).includes(agent)) {
    throw new IngestRefusal(
      EXIT_CODES.invalidInput,
      `an agent is one of ${VENDOR_ORDER.join(", ")}`,
    );
  }
  return agent as AgentName;
}

async function readConfiguration(
  context: CliContext,
): Promise<DeveloperOsConfigV1> {
  const config = await readConfigFile(context, context.paths.configFile);
  if (config === null) {
    throw new IngestRefusal(
      EXIT_CODES.operationalFailure,
      "Developer OS is not initialized, so there is no vault to ingest into",
      [context.paths.configFile],
      NOT_INITIALIZED,
    );
  }
  return config;
}

async function assertVaultPresent(
  context: CliContext,
  paths: RuntimePaths,
): Promise<void> {
  const directory = await isDirectory(context, paths.brain);
  if (directory === null) {
    throw new IngestRefusal(
      EXIT_CODES.operationalFailure,
      "the vault does not exist, so there are no captures to ingest",
      [paths.brain],
      NOT_INITIALIZED,
    );
  }
  if (!directory) {
    throw new IngestRefusal(
      EXIT_CODES.invalidInput,
      "the vault path exists and is not a directory",
      [paths.brain],
    );
  }
}

interface Vendor {
  readonly name: AgentName;
  readonly executable: string;
}

/**
 * The first installed vendor in `VENDOR_ORDER`, or the one `--agent` named.
 *
 * **This does not probe.** Probing is opt-in and its first production caller is
 * elsewhere; making the central path spend a process to learn what the two-gate
 * table already claims would be the expensive half of a capability check for
 * none of its value. A vendor that then returns something `parseIngestProposal`
 * refuses surfaces as `malformed-output`, which is where a missing structured
 * result actually shows up.
 *
 * A discovery that *refuses* — the adapter declines to vouch for a path it
 * resolved — is treated as "not this one" rather than as a run-ending error, so
 * a hostile `claude` on `PATH` does not also cost the user their `codex`. With
 * one vendor named explicitly there is nothing to fall through to, and the
 * refusal is the exit-4 message below.
 */
async function selectVendor(
  context: CliContext,
  requested: AgentName | null,
): Promise<Vendor> {
  const candidates = requested === null ? VENDOR_ORDER : [requested];

  for (const name of candidates) {
    let executable: string | null = null;
    try {
      const discovery = await context.platform.discoverExecutable(name);
      executable = discovery.installed ? discovery.executablePath : null;
    } catch {
      executable = null;
    }
    if (executable !== null) return { name, executable };
  }

  throw new IngestRefusal(
    EXIT_CODES.capabilityUnavailable,
    requested === null
      ? "ingest needs an agent CLI and neither claude nor codex is installed"
      : `ingest was asked for ${requested} and it is not installed`,
    [],
    "install one of the agent CLIs, then developer-os doctor to confirm it is found",
  );
}

/**
 * The capture files in quarantine, by name, sorted — which is `captureId` order,
 * because the id **is** the file name. Two runs over the same set therefore do
 * the same work in the same sequence.
 */
async function captureFileNames(
  context: CliContext,
  quarantine: string,
): Promise<readonly string[]> {
  try {
    const entries = await context.fs.readdir(quarantine, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(CAPTURE_FILE_SUFFIX))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isMissingEntry(error)) return [];
    throw error;
  }
}

interface Selection {
  /** File names, in `captureId` order, bounded by `--limit`. */
  readonly accepted: readonly string[];
  /** Captures whose own envelope could not be read, reported and not processed. */
  readonly unreadable: readonly IngestedCaptureV1[];
  readonly warnings: readonly string[];
}

/**
 * Every accepted capture, in id order, plus the ones nothing can be done with.
 *
 * **A capture this cannot parse is `failed`** (spec §5.5) — a truncated write,
 * or a hand edit that broke the frontmatter — and it is reported rather than
 * repaired: nothing is written to a file whose envelope this product cannot
 * read, because the only honest repair is the user opening it. `failed` is
 * therefore derived and never persisted, which is also how `capture` and
 * `review` report it.
 *
 * **`--limit` bounds the accepted set only.** An unreadable capture costs no
 * agent call and no transaction, so hiding one behind a limit would mean a user
 * with three broken files and `--limit 1` is told about one of them per run.
 */
async function selectCaptures(
  context: CliContext,
  quarantine: string,
  key: Uint8Array,
  limit: number | null,
): Promise<Selection> {
  const accepted: string[] = [];
  const unreadable: IngestedCaptureV1[] = [];
  const warnings: string[] = [];

  for (const fileName of await captureFileNames(context, quarantine)) {
    const text = await context.guards.readText(join(quarantine, fileName));
    const outcome = parseCaptureFile(fileName, text, (value) =>
      redactText(value, key),
    );
    if (!outcome.ok) {
      const captureId = fileName.slice(0, -CAPTURE_FILE_SUFFIX.length);
      unreadable.push({ captureId, status: "failed", notes: [] });
      warnings.push(
        `${fileName} is not a readable capture (${outcome.reason}), so it is failed rather than waiting to be ingested`,
      );
      continue;
    }
    if (outcome.envelope.status !== "accepted") continue;
    if (limit !== null && accepted.length >= limit) continue;
    accepted.push(fileName);
  }

  return { accepted, unreadable, warnings };
}

/* ------------------------------------------------------- reading and writing */

/**
 * The capture's own path, canonicalized and proven to still be inside
 * quarantine — `review.ts` records the argument in full. The file name comes
 * from a directory listing here rather than from `--id`, so the shape check that
 * makes the path unbuildable is upstream; this is the check that makes a
 * *symlinked* component resolving out of the vault unusable.
 */
async function resolveCapturePath(
  context: CliContext,
  quarantine: string,
  fileName: string,
): Promise<string> {
  const target = join(quarantine, fileName);
  await context.guards.transaction.assertTarget(target);

  const canonicalQuarantine = await context.guards.canonicalize(quarantine);
  const canonicalTarget = await context.guards.canonicalize(target);
  if (!containsPath(canonicalQuarantine, canonicalTarget)) {
    throw new IngestRefusal(
      EXIT_CODES.securityRefusal,
      "the capture resolves outside the quarantine directory",
      [target],
    );
  }
  return canonicalTarget;
}

/**
 * One `replace` mutation against a capture file, through Foundation's
 * `TransactionExecutor`.
 *
 * **`validateChangePlan` is deliberately absent**, for the reason `review.ts`
 * records: that layer decides ownership from the manifest, and a capture is
 * absent from it by design — it is the user's own content, editable in Obsidian,
 * so recording it as a managed artifact would report every legitimate edit as
 * drift. `resolveCapturePath` stands in for it, which is a narrower constraint
 * than ownership rather than the same one.
 *
 * **The lost-update window is the one `review.ts` describes and it is not
 * closed here.** Each capture is read as late as possible — immediately before
 * the transaction that moves it — which narrows the window to in-process work
 * and cannot remove it. `docs/superpowers/ORDER.md` carries the Foundation
 * change (a caller-supplied precondition on `PlannedFileMutation`) that would.
 */
async function writeCaptureFile(
  context: CliContext,
  kind: string,
  target: string,
  contents: string,
): Promise<void> {
  try {
    await context.executor.execute({
      kind,
      mutations: [
        {
          targetPath: target,
          operation: "replace",
          content: new TextEncoder().encode(contents),
        },
      ],
    });
  } catch (error) {
    if (!(error instanceof TransactionConflictError)) throw error;
    throw new IngestRefusal(
      exitCodeOf(error),
      "the capture changed on disk while this ingest was running, so its status did not move",
      [target],
      "if developer-os status reports an incomplete transaction, resolve it with developer-os repair first; otherwise run developer-os ingest again, which reads the newer file",
    );
  }
}

/**
 * Notes are read through the protected-path policy, not through the raw
 * filesystem — the same wiring `brain` uses, and for the same reason: they are
 * user files in a user-writable tree, and `readText` is the channel that opens
 * with `O_NOFOLLOW` and re-checks `dev`/`ino` after open.
 */
function dependenciesFor(
  context: CliContext,
  vaultRoot: string,
  config: DeveloperOsConfigV1,
): BrainServiceDependencies {
  return {
    vaultRoot,
    config: resolveBrainConfig(config),
    reader: {
      readDir: async (path: string): Promise<readonly DirectoryEntry[]> => {
        const entries = await context.fs.readdir(path, { withFileTypes: true });
        return entries.map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
          isFile: entry.isFile(),
          isSymbolicLink: entry.isSymbolicLink(),
        }));
      },
    },
    readFile: (path: string) => context.guards.readText(path),
    assertReadable: async (path: string): Promise<void> => {
      await context.guards.manifest.assertReadable(path);
    },
    now: context.now,
  };
}

/* ---------------------------------------------------------- the agent call */

interface AgentOutcome {
  readonly payload: unknown;
}

/**
 * The bridge between one prompt and two vendors that share **neither an
 * invocation type nor a result type**.
 *
 * It lives here rather than in a shared package because it is two vendors, two
 * shapes and one narrow function: inventing a common adapter interface in
 * `packages/core` would be a Foundation change made in passing, and the two
 * adapters are peers under `workflow-schema` rather than implementations of an
 * interface either of them declares.
 *
 * **Zero write scopes, and each sandbox follows from that count rather than
 * from an argument.** `invokeCodex` derives `-s read-only` from
 * `writeScopes.length === 0`; the Claude side passes `CLAUDE_READ_ONLY_TOOLS`,
 * which carries no write tool. Neither invocation type has a *read* scope
 * field, so the read side is each vendor's own vocabulary: Codex gets the
 * content root as its working root, and Claude gets the tool list. The resolved
 * `content/**` glob this workflow declares is what Developer OS states it
 * reads, not a string either CLI accepts.
 *
 * **`outputSchemaPath` reaches Codex only.** `invokeClaude` has no
 * `--output-schema` flag, so on that vendor the schema is described in the
 * prompt and enforced by `parseIngestProposal` afterwards rather than by the
 * CLI. The asymmetry is the adapters', not this command's, and it is stated
 * here because a reader will otherwise assume both calls are constrained the
 * same way.
 */
async function invokeVendor(
  context: CliContext,
  vendor: Vendor,
  prompt: string,
  workingRoot: string,
  schemaPath: string,
): Promise<AgentOutcome> {
  const installation = { executable: vendor.executable, version: UNKNOWN_VERSION };
  const dependencies = { runner: context.runner };

  const result =
    vendor.name === "claude"
      ? await invokeClaude(
          installation,
          {
            prompt,
            maxTurns: DEFAULT_MAX_TURNS,
            allowedTools: CLAUDE_READ_ONLY_TOOLS,
            timeoutMs: INGEST_TIMEOUT_MS,
          },
          dependencies,
        )
      : await invokeCodex(
          installation,
          {
            prompt,
            workingRoot,
            writeScopes: [],
            outputSchemaPath: schemaPath,
            timeoutMs: INGEST_TIMEOUT_MS,
          },
          dependencies,
        );

  if (result.ok) return { payload: result.payload };

  /**
   * Each failure keeps its own identity, because they mean different things to
   * a user: a timeout is retryable, a refusal is a bug in what this command
   * built, a non-zero exit is the vendor's own complaint. None of them is a
   * reason to touch the capture, which stays `accepted`.
   */
  throw new IngestRefusal(
    EXIT_CODES.operationalFailure,
    `the ${vendor.name} agent did not return a usable proposal (${result.reason})`,
    [],
    RETRY_LATER,
  );
}

/* ----------------------------------------------------------- the validators */

/**
 * Where a validation finding becomes a string this process prints — on stderr
 * and, more importantly, in the `--json` payload.
 *
 * **The path is screened here and nowhere upstream**, and both halves of that
 * are deliberate. `packages/brain` keeps a finding's path byte-exact and
 * delegates screening to the terminal (`docs/architecture/brain.md` §5), which
 * is right there: a path is an identifier a user has to be able to act on.
 * `--json` is the channel that has no terminal behind it — `emit` deliberately
 * does not pass it through `renderPath`, and `JSON.stringify` escapes `\p{Cc}`
 * but not `\p{Cf}`, so a bidi override in a model-chosen path would survive into
 * anything that cats the output. `screenAndCap` closes that, at the one seam
 * where a finding stops being data and becomes a message.
 *
 * `finding.message` is screened by the validators already and is not screened
 * twice; the bound is `MAX_PROPOSED_PATH_CHARS`, the same one the proposal
 * parser refuses a longer path with.
 */
export function renderValidationFinding(finding: IngestValidationFinding): string {
  const where =
    finding.path === null
      ? ""
      : ` ${screenAndCap(finding.path, MAX_PROPOSED_PATH_CHARS)}`;
  return `${finding.validator}${where}: ${finding.message}`;
}

function refusalFrom(
  findings: readonly IngestValidationFinding[],
  captureId: string,
): IngestRefusal {
  const security = findings.some((finding) =>
    SECURITY_VALIDATORS.includes(finding.validator),
  );
  const paths = [
    ...new Set(
      findings.flatMap((finding) =>
        finding.path === null
          ? []
          : [screenAndCap(finding.path, MAX_PROPOSED_PATH_CHARS)],
      ),
    ),
  ];

  return new IngestRefusal(
    security ? EXIT_CODES.securityRefusal : EXIT_CODES.operationalFailure,
    [
      `the proposal for capture ${captureId} was refused by ${String(findings.length)} validator finding${findings.length === 1 ? "" : "s"}`,
      ...findings.map((finding) => `  ${renderValidationFinding(finding)}`),
    ].join("\n"),
    paths,
    RETRY_LATER,
  );
}

/* ------------------------------------------------- applying and reindexing */

/**
 * Ported from `apps/cli/src/commands/brain.ts`'s `stageArtifacts`, which is
 * private to that file, and it must be changed with it — as must
 * `recordIndexArtifacts` and `dependenciesFor` above, ported from the same file
 * for the same reason.
 *
 * Every branch below — the canonicalization before anything keys off a path, the
 * manifest reconciliation that adopts files on disk nobody owns and forgets
 * entries whose files are gone, the `existedBefore: false` on a generated
 * artifact, the `expectedBeforeHash` that compares the manifest against itself —
 * has its reasoning recorded there and is not restated here. What differs is the
 * transaction kind the caller then uses: this path's is `ingest-reindex`, which
 * is what makes the four-transaction ladder visible in the journals `repair` and
 * `status` read. Sharing one implementation needs a module both commands can
 * import, which is a wider change than this task's file list.
 */
async function stageIndexArtifacts(
  context: CliContext,
  vaultRoot: string,
  files: Readonly<Record<string, string>>,
  indexesDir: string,
): Promise<{
  readonly mutations: readonly PlannedFileMutation[];
  readonly artifacts: readonly ManagedArtifactV1[];
}> {
  const encoder = new TextEncoder();
  const verifiedAt = context.now().toISOString();

  const planned = await Promise.all(
    Object.entries(files).map(async ([vaultPath, text]) => {
      const targetPath = await context.guards.canonicalize(
        join(vaultRoot, vaultPath),
      );
      let onDisk: string | null = null;
      try {
        onDisk = hashBytes(
          encoder.encode(await context.guards.readText(targetPath)),
        );
      } catch {
        onDisk = null;
      }
      return { vaultPath, targetPath, content: encoder.encode(text), onDisk };
    }),
  );

  const existing = (await context.manifests.readOptional()) ?? {
    ...EMPTY_MANIFEST,
    productVersion: context.productVersion,
    installedAt: verifiedAt,
  };
  const recorded = new Map(
    existing.artifacts.map((artifact) => [foldPath(artifact.path), artifact]),
  );

  const adopted: ManagedArtifactV1[] = [];
  const forgotten = new Set<string>();
  for (const entry of planned) {
    const key = foldPath(entry.targetPath);
    const managed = recorded.get(key);
    if (entry.onDisk !== null && managed === undefined) {
      adopted.push({
        owner: "core",
        path: entry.targetPath,
        kind: "file",
        productVersion: context.productVersion,
        existedBefore: false,
        beforeHash: null,
        backupRelativePath: null,
        installedHash: entry.onDisk,
        source: entry.vaultPath,
        mergeStrategy: "dedicated",
        verifiedAt,
      });
    }
    if (entry.onDisk === null && managed !== undefined) forgotten.add(key);
  }

  const manifest: InstallationManifestV1 = {
    ...existing,
    artifacts: [
      ...existing.artifacts.filter(
        (artifact) => !forgotten.has(foldPath(artifact.path)),
      ),
      ...adopted,
    ],
  };
  const owned = new Map(
    manifest.artifacts.map((artifact) => [foldPath(artifact.path), artifact]),
  );

  const operations = planned.map((entry) => ({
    ...entry,
    operation: entry.onDisk === null ? ("create" as const) : ("replace" as const),
    expectedBeforeHash: owned.get(foldPath(entry.targetPath))?.installedHash ?? null,
    proposedHash: hashBytes(entry.content),
  }));

  const validated = await validateChangePlan(
    {
      schemaVersion: 1,
      productVersion: context.productVersion,
      operations: operations.map((operation) => ({
        targetPath: operation.targetPath,
        operation: operation.operation,
        owner: "core",
        kind: "file",
        expectedBeforeHash: operation.expectedBeforeHash,
        source: operation.vaultPath,
        mergeStrategy: "dedicated",
        proposedHash: operation.proposedHash,
      })),
    },
    {
      manifest,
      ownedRoots: [join(vaultRoot, indexesDir)],
      excludedRoots: [context.paths.home],
      canonicalize: context.guards.canonicalize,
    },
  );

  const contentByPath = new Map(
    operations.map((operation) => [operation.targetPath, operation]),
  );

  const mutations: PlannedFileMutation[] = [];
  const artifacts: ManagedArtifactV1[] = [];

  for (const operation of validated.operations) {
    const staged = contentByPath.get(operation.targetPath);
    if (staged === undefined) {
      throw new IngestRefusal(
        EXIT_CODES.operationalFailure,
        "the validated change plan lost its staged content",
        [operation.canonicalTargetPath],
      );
    }
    mutations.push({
      targetPath: operation.canonicalTargetPath,
      operation: operation.operation === "remove" ? "replace" : operation.operation,
      content: staged.content,
    });
    artifacts.push({
      owner: "core",
      path: operation.canonicalTargetPath,
      kind: "file",
      productVersion: context.productVersion,
      existedBefore: false,
      beforeHash: null,
      backupRelativePath: null,
      installedHash: operation.proposedHash ?? hashBytes(staged.content),
      source: operation.source,
      mergeStrategy: "dedicated",
      verifiedAt,
    });
  }

  return { mutations, artifacts };
}

/** Ported from `brain.ts`'s `recordArtifacts`; see `stageIndexArtifacts` above. */
async function recordIndexArtifacts(
  context: CliContext,
  artifacts: readonly ManagedArtifactV1[],
): Promise<void> {
  const manifest = (await context.manifests.readOptional()) ?? {
    ...EMPTY_MANIFEST,
    productVersion: context.productVersion,
    installedAt: context.now().toISOString(),
  };

  const written = new Set(artifacts.map((artifact) => foldPath(artifact.path)));
  await context.manifests.write({
    ...manifest,
    artifacts: [
      ...manifest.artifacts.filter(
        (artifact) => !written.has(foldPath(artifact.path)),
      ),
      ...artifacts,
    ],
  });
}

async function exists(context: CliContext, path: string): Promise<boolean> {
  try {
    await context.fs.lstat(path);
    return true;
  } catch (error) {
    if (isMissingEntry(error)) return false;
    throw error;
  }
}

/**
 * Transaction 2: one `create` per proposed note.
 *
 * **`create`, never `replace`.** A proposal names notes the vault would *gain*;
 * a path that already holds a note is refused here rather than overwritten,
 * because the model's job is to propose knowledge and not to edit the user's
 * existing notes. The refusal is raised before the transaction so the user meets
 * a sentence about their own vault rather than a `TransactionPlanError`.
 *
 * **No `validateChangePlan`**, for the reason a capture skips it: a note is the
 * user's own content, edited in Obsidian by design, so recording one as a
 * managed artifact would report every legitimate edit as drift and would make a
 * later ingest a refused `create` over an artifact the product claims to own.
 * What stands in its place is the write-scope validator, which canonicalized
 * every one of these paths and proved the *destination* is inside the content
 * root — a narrower constraint than ownership, and the one that matters for a
 * path a model chose.
 */
async function applyNotes(
  context: CliContext,
  contentRoot: string,
  writes: readonly PlannedNoteWriteV1[],
): Promise<void> {
  const mutations: PlannedFileMutation[] = [];

  for (const write of writes) {
    const target = join(contentRoot, write.path);
    await context.guards.transaction.assertTarget(target);
    /**
     * The executor stages into a temporary file beside its target, so the
     * directory has to exist first — the same reason `init`, `capture` and
     * `brain reindex` create theirs before executing. A proposal may name a
     * topic folder the vault does not have yet, which is inside `content/**`
     * and is a legitimate thing for it to name.
     *
     * A refusal below therefore leaves an empty directory behind, because a
     * directory is not a transaction mutation and nothing rolls it back. That
     * is the same residual `brain reindex` leaves when it creates the indexes
     * directory and then refuses; an empty folder in the vault is visible,
     * inert, and the user's to remove.
     */
    await context.fs.mkdir(dirname(target), { recursive: true, mode: 0o700 });

    const canonical = await context.guards.canonicalize(target);
    if (await exists(context, canonical)) {
      throw new IngestRefusal(
        EXIT_CODES.operationalFailure,
        "the proposal names a path that already holds a file; ingest creates notes and never replaces one",
        [screenAndCap(write.path, MAX_PROPOSED_PATH_CHARS)],
        "move or delete the existing note if the proposal should replace it, then run developer-os ingest again",
      );
    }

    mutations.push({
      targetPath: canonical,
      operation: "create",
      content: write.bytes,
    });
  }

  await context.executor.execute({
    kind: TRANSACTION_KINDS.apply,
    mutations,
  });
}

/**
 * Transaction 3: `brain reindex`'s path, not a second one.
 *
 * `BrainService.reindex()` returns bytes and **cannot write** — its absence of a
 * write channel is the design — so the CLI stages those bytes through the
 * executor exactly as `brain reindex` does. It runs after the apply has
 * finalized, because it reads the vault it is indexing.
 */
async function reindexVault(
  context: CliContext,
  config: DeveloperOsConfigV1,
  paths: RuntimePaths,
  brainConfig: BrainConfigV1,
): Promise<void> {
  const service = new BrainService(
    dependenciesFor(context, paths.brain, config),
  );
  const artifacts = await service.reindex();

  const indexesDir = join(brainConfig.contentRoot, brainConfig.indexesDir);
  const indexDirectory = join(paths.brain, indexesDir);
  await context.guards.transaction.assertTarget(indexDirectory);
  await context.fs.mkdir(indexDirectory, { recursive: true, mode: 0o700 });

  const staged = await stageIndexArtifacts(
    context,
    paths.brain,
    artifacts.files,
    indexesDir,
  );
  await context.executor.execute({
    kind: TRANSACTION_KINDS.reindex,
    mutations: staged.mutations,
  });
  await recordIndexArtifacts(context, staged.artifacts);
}

/* ------------------------------------------------------------ one capture */

interface IngestEnvironment {
  readonly config: DeveloperOsConfigV1;
  readonly paths: RuntimePaths;
  readonly brainConfig: BrainConfigV1;
  readonly quarantine: string;
  readonly contentRoot: string;
  readonly key: Uint8Array;
  readonly vendor: Vendor;
  readonly ingestContract: readonly string[];
}

/**
 * One capture, one agent call, four transactions.
 *
 * ```text
 * accepted capture
 *   → status → staging                                  (ingest-stage)
 *   → prompt from envelope.content, marked as DATA
 *   → adapter.invoke(read-only sandbox, zero write scopes)
 *   → IngestProposal, parsed
 *   → the nine deterministic validators
 *   → one create per proposed note                      (ingest-apply)
 *   → brain reindex                                     (ingest-reindex)
 *   → status → ingested                                 (ingest-ingested)
 * ```
 *
 * **Every refusal from the agent call onward rolls the capture back to
 * `accepted`, never to `failed`.** The capture is fine and the proposal was
 * not; `failed` describes a capture whose own envelope is unreadable, and
 * collapsing the two would make a transient model failure look like data loss.
 *
 * **The apply and the reindex are skipped when the proposal proposes nothing.**
 * An empty `notes` array is a correct answer — it means this capture is not
 * worth a note — and there is then nothing to create and nothing new to index.
 * The capture still reaches `ingested`, because it has been through the
 * pipeline and there is no other status for "considered and left alone".
 */
async function ingestOne(
  context: CliContext,
  environment: IngestEnvironment,
  fileName: string,
): Promise<IngestedCaptureV1> {
  const { brainConfig, key, paths, quarantine, vendor } = environment;
  const path = await resolveCapturePath(context, quarantine, fileName);
  let applied = false;

  const text = await context.guards.readText(path);
  const parsed = parseCaptureFile(fileName, text, (value) =>
    redactText(value, key),
  );
  if (!parsed.ok) {
    throw new IngestRefusal(
      EXIT_CODES.invalidInput,
      `the capture at ${fileName} could not be read (${parsed.reason})`,
      [path],
      "open the file and repair its frontmatter; nothing is written to a capture this command cannot read",
    );
  }
  const envelope = parsed.envelope;
  if (envelope.status !== "accepted") {
    throw new IngestRefusal(
      EXIT_CODES.invalidInput,
      `this capture is at status ${envelope.status}, which ingest does not move`,
      [path],
      "set the file's status back to accepted by hand if it should be ingested again",
    );
  }

  /** Transaction 1. Durable before the apply, or a crash is indistinguishable
   * from a run that never started. */
  await writeCaptureFile(
    context,
    TRANSACTION_KINDS.stage,
    path,
    renderCaptureFile({ ...envelope, status: "staging" }),
  );

  try {
    const outcome = await invokeVendor(
      context,
      vendor,
      buildIngestPrompt(envelope, { config: brainConfig }),
      environment.contentRoot,
      outputSchemaPath(paths.home, INGEST_VERB),
    );

    const proposal = parseIngestProposal(outcome.payload);
    if (!proposal.ok) {
      throw new IngestRefusal(
        EXIT_CODES.operationalFailure,
        `the ${vendor.name} agent returned a proposal this product refuses (${proposal.reason})`,
        [],
        RETRY_LATER,
      );
    }

    const validation = await validateProposal(proposal.proposal, {
      captureId: envelope.captureId,
      ingestContract: environment.ingestContract,
      redact: (value: string) => redactText(value, key),
      brain: dependenciesFor(context, paths.brain, environment.config),
    });
    if (!validation.ok) throw refusalFrom(validation.findings, envelope.captureId);

    const plan = planIngestApply(proposal.proposal);
    if (!plan.ok) {
      throw new IngestRefusal(
        EXIT_CODES.operationalFailure,
        `the proposal for capture ${envelope.captureId} names one file twice (${plan.reason})`,
        [],
        RETRY_LATER,
      );
    }

    if (plan.writes.length > 0) {
      await applyNotes(context, environment.contentRoot, plan.writes);
      applied = true;
      await reindexVault(context, environment.config, paths, brainConfig);
    }

    await writeCaptureFile(
      context,
      TRANSACTION_KINDS.ingested,
      path,
      renderCaptureFile({ ...envelope, status: "ingested" }),
    );

    return {
      captureId: envelope.captureId,
      status: "ingested",
      notes: plan.writes.map((write) => write.path),
    };
  } catch (error) {
    /**
     * **Rolled back only while a retry could still succeed**, which is up to
     * the moment the notes land. `accepted` means "ingest may run this again",
     * and once `ingest-apply` has finalized that is no longer true: the notes
     * are on disk, and a second run would meet its own output and refuse. A
     * capture left at `staging` says what is actually the case — considered,
     * partly applied, and waiting for a person — which is exactly the inert
     * residual `TRANSACTION_KINDS` describes, reached here by a caught failure
     * rather than by a crash.
     */
    if (!applied) {
      try {
        await writeCaptureFile(
          context,
          TRANSACTION_KINDS.rollback,
          path,
          renderCaptureFile(envelope),
        );
      } catch {
        /**
         * The refusal that got us here is the one worth reporting, and a second
         * failure must not replace it. What is left is the same residual.
         */
      }
    }
    throw error;
  }
}

/* -------------------------------------------------------------------- entry */

/**
 * Diagnostics redacted with the key this command loaded, not with whatever the
 * context closed over — `init` records the rule, and `capture` and `review`
 * follow it at the same point.
 */
function guardsWith(guards: CliGuards, key: Uint8Array): CliGuards {
  return {
    ...guards,
    redactDiagnostic: (text: string): string => redactText(text, key).text,
  };
}

function compareIds(left: IngestedCaptureV1, right: IngestedCaptureV1): number {
  return left.captureId < right.captureId ? -1 : 1;
}

/**
 * `developer-os ingest`, spec §6.
 *
 * ```text
 * developer-os ingest                      every accepted capture, in captureId order
 * developer-os ingest --limit 1            the first one only
 * developer-os ingest --agent codex        through a named vendor
 * ```
 *
 * **One capture, one agent call, four transactions.** Failure isolates to a
 * single capture rather than poisoning a batch: a refusal stops the run at that
 * capture, everything already ingested stays ingested, and everything after it
 * is untouched and still `accepted` for the next invocation. The prompt stays
 * bounded by one envelope rather than by however many captures the user
 * accepted.
 *
 * **The model writes nothing.** It is invoked with zero declared write scopes,
 * inside its vendor's own read-only sandbox, and returns a proposal that nine
 * deterministic validators stand between and the vault. Developer OS performs
 * every write, through `TransactionExecutor`.
 */
export async function runIngest(
  context: CliContext,
  options: IngestOptions,
): Promise<CliResult<IngestResultV1>> {
  let guards = context.guards;

  try {
    /** Before the vault is touched and before a key exists on disk. */
    const requested = resolveAgent(options);
    const limit = options.limit ?? null;

    const config = await readConfiguration(context);
    const paths = runtimePathsFor(context, config);
    await assertVaultPresent(context, paths);

    /**
     * Before the key is loaded, so a machine with no agent CLI writes no
     * secret merely by being asked to ingest.
     */
    const vendor = await selectVendor(context, requested);

    const brainConfig = resolveBrainConfig(config);
    const contentRoot = join(paths.brain, brainConfig.contentRoot);
    const quarantine = join(contentRoot, ...QUARANTINE_SEGMENTS);

    const key = loadOrCreateRedactionKey(paths.stateDir);
    guards = guardsWith(context.guards, key);

    const selection = await selectCaptures(context, quarantine, key, limit);
    const environment: IngestEnvironment = {
      config,
      paths,
      brainConfig,
      quarantine,
      contentRoot,
      key,
      vendor,
      /**
       * Resolved once per invocation, here, because resolution is per-install:
       * the declared globs are constants and the strings they become depend on
       * this vault's `config.toml`.
       */
      ingestContract: INGEST_DECLARED_WRITE_SCOPES.map((glob) =>
        resolveScopeGlob(glob, brainConfig),
      ),
    };

    const ingested: IngestedCaptureV1[] = [];
    for (const fileName of selection.accepted) {
      ingested.push(await ingestOne(context, environment, fileName));
    }

    const captures = [...ingested, ...selection.unreadable].sort(compareIds);
    return success(
      {
        schemaVersion: 1,
        agent: vendor.name,
        order: ingested.map((capture) => capture.captureId),
        captures,
        applied: captures.filter((capture) => capture.status === "ingested"),
      },
      selection.warnings,
    );
  } catch (error) {
    return failureFrom(
      { guards },
      error,
      error instanceof IngestRefusal ? error.paths : [],
      error instanceof IngestRefusal ? error.recovery : undefined,
    );
  }
}

/**
 * Human-facing rendering. Every path goes through `renderPath` first, which is
 * the terminal half of the screening `renderValidationFinding` does for the
 * machine half.
 */
export function renderIngest(result: IngestResultV1): readonly string[] {
  if (result.captures.length === 0) {
    return ["No captures are waiting to be ingested."];
  }

  return [
    `Ingested ${String(result.applied.length)} capture${result.applied.length === 1 ? "" : "s"} through ${result.agent}:`,
    ...result.captures.map(
      (capture) =>
        `  ${capture.captureId}  ${capture.status}${
          capture.notes.length === 0
            ? ""
            : `  ${capture.notes.map(renderPath).join(" ")}`
        }`,
    ),
  ];
}
