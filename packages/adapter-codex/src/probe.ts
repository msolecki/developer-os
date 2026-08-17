import { cwd } from "node:process";
import { parseStructuredPayload } from "@developer-os/security";
import type { ProcessResult, ProcessRunner } from "@developer-os/security";
import type { ProbeObservation } from "@developer-os/core";
import { z } from "zod";
import type { CodexInstallation } from "./discover.js";
import { PLUGIN_NAME } from "./plugin.js";

export interface CodexProbeDependencies {
  readonly runner: ProcessRunner;
  /** The absolute path we install our plugin tree to. */
  readonly pluginRoot: string;
}

export interface CodexProbeResult {
  readonly observations: ReadonlyMap<string, ProbeObservation>;
  /**
   * Raw vendor value from `codex plugin list --json`.
   * May disagree with observations; use observations as the verified fact.
   */
  readonly resolvedPath: string | null;
  /**
   * Raw vendor value from `codex plugin list --json`.
   * May disagree with observations; use observations as the verified fact.
   */
  readonly enabled: boolean | null;
}

const PROBE_TIMEOUT_MS = 30_000;

/**
 * `.loose()` on both levels, deliberately and unlike everywhere else in this
 * repository. This parses the **vendor's** output, not our contract: a field
 * Codex adds in its next release must not turn a successful parse into an
 * `unavailable`. Our own artifacts (`workflow-schema`'s contract, for one)
 * stay strict, because those are ours to keep in sync; this one is not ours
 * to police.
 *
 * Real shape, per spec §14.4 (Task 17, verified against a real 0.147.0
 * binary): `{ installed: [...], available: [...] }`, never the guessed
 * `{ plugins: [...] }` this schema previously expected. Each entry's path
 * is nested under `source.path` — the marketplace-resolved *source*, not
 * the `$CODEX_HOME/plugins/cache/...` copy Codex separately stages — never
 * a top-level `path`. `enabled` is a boolean field on the entry, never the
 * string `status` this schema previously expected.
 *
 * `enabled` and `source` are `optional`, not required, for the same reason
 * as the `.loose()` above — spec §5.2 documents the fields this adapter
 * reads, not a guarantee that every entry in every Codex release carries
 * them. `installed` (the array) is required: without it there is nothing
 * trustworthy to search, and a parse failure becomes `unavailable`, never
 * `absent` (see `probeCodex`'s doc comment on why that distinction matters).
 * `available` is not read at all — `probeCodex` only ever searches
 * `installed` (spec §14.4: `available` lists what a marketplace offers, not
 * what is installed). It is typed `z.unknown()` rather than an array of
 * `pluginEntrySchema`: a malformed `available` entry (say, missing `name`)
 * must never fail the whole parse and turn a perfectly readable `installed`
 * array into `unavailable` — the exact bug fixed in commit `eeae9ba`,
 * re-entering through a field we do not even use. `.loose()` on the outer
 * object would already tolerate the key being dropped entirely; it is kept
 * here, unvalidated, only so the schema still documents that the vendor
 * sends it.
 */
const pluginEntrySchema = z
  .object({
    name: z.string(),
    enabled: z.boolean().optional(),
    source: z.object({ path: z.string().optional() }).loose().optional(),
  })
  .loose();

const listingSchema = z
  .object({
    installed: z.array(pluginEntrySchema),
    available: z.unknown().optional(),
  })
  .loose();

type PluginListing = z.infer<typeof listingSchema>;

/**
 * `codex plugin list --json` structured output as the boundary crossing it
 * is: never throws, and every way of failing to get a trustworthy listing
 * collapses to one outcome the caller can act on — "we could not ask".
 *
 * `parseStructuredPayload` (from `@developer-os/security`) is the same
 * top-level `__proto__` guard the Claude adapter's `invokeClaude` applies to
 * this vendor's structured stdout; a payload merged into other objects
 * downstream gets that guard at the one place it can be applied once.
 */
async function listPlugins(
  installation: CodexInstallation,
  runner: ProcessRunner,
): Promise<PluginListing | null> {
  let result: ProcessResult;
  try {
    result = await runner.run({
      executable: installation.executable,
      args: ["plugin", "list", "--json"],
      cwd: cwd(),
      stdin: "",
      timeoutMs: PROBE_TIMEOUT_MS,
      env: {},
    });
  } catch {
    return null;
  }
  if (result.timedOut || result.exitCode !== 0) return null;

  const parsed = parseStructuredPayload(result.stdout);
  if (!parsed.ok) return null;

  const listing = listingSchema.safeParse(parsed.payload);
  return listing.success ? listing.data : null;
}

/**
 * One structured call settles three separate questions, and this function
 * keeps them separate rather than collapsing them into the single exit code
 * the Claude adapter's probe was corrected out of doing (`claude-adapter.md`
 * §3, the Claude adapter's own `probe.ts`): that probe read one
 * `claude plugin validate` exit code as an observation of `skills`,
 * `plugin_hooks` and `subagents` at once, and reported `yes` for two artifacts
 * a clean exit code never inspected. `codex plugin list --json` is different
 * in kind, not just detail — it is structured output listing `installed` (and
 * separately, `available`) plugins, each naming a specific plugin, its
 * `enabled` state, and its resolved `source.path` — so this probe can settle
 * *installed*, *enabled*, and *is the resolved path the tree we own* from one
 * call without over-claiming, because those three facts are exactly what the
 * listing reports.
 *
 * `skills` is the only key this settles (spec §5.2 scopes the listing to
 * that). `session_start_injection`, `session_end_capture` and
 * `pre_compact_backup` need a real session to observe, and `plugin_hooks` is
 * documented-but-unobserved per spec §15.1 — none of the four are written to
 * `observations` at all, so `observations.has(key)` is `false` for each and
 * Task 7's resolver sees an unmentioned key rather than a false claim about
 * one that was never asked about.
 *
 * `observed` requires all three of: a plugin named `developer-os` present in
 * `installed` — never `available`, which lists what a marketplace offers,
 * not what is installed (spec §14.4) — enabled, and resolved (`source.path`)
 * to `dependencies.pluginRoot`. A plugin under our name resolved to a path we
 * never wrote is not our tree — spec's local-marketplace install shape
 * exists precisely so this call can tell the two apart, and reporting
 * `observed` for someone else's tree would claim we verified an artifact we
 * did not write. Anything that parsed but fails one of the three is
 * `absent`. Anything that did not parse, exited non-zero, or timed out is
 * `unavailable` — never `absent`: "we could not ask" and "we asked and it is
 * not there" are different facts, and a settled state must never be reached by
 * conflating a refusal to answer with an answer of no.
 *
 * `observations` always carries the `skills` key, even when nothing is
 * installed, so a clean result records that a check ran rather than being
 * satisfied by scanning nothing.
 */
export async function probeCodex(
  installation: CodexInstallation,
  dependencies: CodexProbeDependencies,
): Promise<CodexProbeResult> {
  const listing = await listPlugins(installation, dependencies.runner);
  if (listing === null) {
    return {
      observations: new Map<string, ProbeObservation>([["skills", "unavailable"]]),
      resolvedPath: null,
      enabled: null,
    };
  }

  const ours = listing.installed.find((plugin) => plugin.name === PLUGIN_NAME) ?? null;
  const enabled = ours === null ? null : ours.enabled === true;
  const resolvedPath = ours === null ? null : (ours.source?.path ?? null);
  const observed = enabled === true && resolvedPath === dependencies.pluginRoot;

  return {
    observations: new Map<string, ProbeObservation>([["skills", observed ? "observed" : "absent"]]),
    resolvedPath,
    enabled,
  };
}
