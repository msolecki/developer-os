/**
 * Plan 1b Task 20: the opt-in lifecycle end to end on real V2 homes, and spec §7 indexed row by
 * row. Temporary repositories and a local bare remote only; the pinned Git never runs (Q5) —
 * `scriptedGitRuntime` stands in for the quarantine rebuild and the local helper graph, and
 * launchd is an injected domain. Every lifecycle participant is the shipped one.
 */
import * as nodeFs from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  EXIT_CODES,
  loadConfig,
  parseCanonicalAbsolutePathText,
  parseLifecycleActivationRecord,
  serializeConfig,
  validateLifecyclePlanGrammar,
} from "@developer-os/core";
import type { ScheduledJobIdV1 } from "@developer-os/core";
import { runAutomation } from "@developer-os/cli/dist/commands/automation/index.js";
import type { AutomationCommandDataV1 } from "@developer-os/cli/dist/commands/automation/index.js";
import { runBrain } from "@developer-os/cli/dist/commands/brain.js";
import { runConfig } from "@developer-os/cli/dist/commands/config.js";
import { runGit } from "@developer-os/cli/dist/commands/git/index.js";
import type { GitCommandDataV1 } from "@developer-os/cli/dist/commands/git/index.js";
import { createGitService, gitScopeOf } from "@developer-os/cli/dist/commands/git/service.js";
import { runStatus } from "@developer-os/cli/dist/commands/status.js";
import { REAL_FILESYSTEM_TIMEOUT_MS, removeCommandFixtures } from "@developer-os/cli/dist/commands/testing.js";
import { runUninstall } from "@developer-os/cli/dist/commands/uninstall.js";
import { lifecycleVariantFacts } from "@developer-os/cli/dist/lifecycle/codecs.js";
import { automationStatusPath, parseAutomationStatusRecord } from "@developer-os/cli/dist/lifecycle/runtime-records.js";

import {
  BASE_SCHEDULES,
  configureCommitter,
  createOptInHome,
  journalRootSizes,
  plistPath,
  readOrNull,
  runScheduledJob,
  writeNote,
} from "../../helpers/opt-in-home.js";
import type { OptInHomeV1 } from "../../helpers/opt-in-home.js";

afterAll(removeCommandFixtures);

const REPOSITORY_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SPEC = "docs/superpowers/specs/2026-08-21-developer-os-opt-in-surfaces-design.md";
const JOBS: readonly ScheduledJobIdV1[] = ["brain-reindex", "brain-lint", "doctor", "git-sync"];

interface GateCoverageV1 {
  readonly gate: string;
  /** Set only where the evidence is knowingly partial, naming what is missing and who owns it. */
  readonly note?: string;
  /** `[file, exact test title]`, each checked below to occur verbatim in its file. */
  readonly tests: readonly (readonly [string, string])[];
}

/** Spec §7, in the spec's own row order. */
const GATE_COVERAGE: readonly GateCoverageV1[] = [
  {
    gate: "disabled Git is inert",
    tests: [
      ["apps/cli/src/commands/git/git.v2.test.ts", "is inert while disabled: status and sync spawn no Git and open no network"],
      ["apps/cli/src/commands/git/git.v2.test.ts", "keeps a forged config.toml lifecycle with no activation arm inert"],
      ["tests/integration/git/lifecycle.test.ts", "keeps disabled opt-in surfaces inert end to end"],
      ["tests/integration/git/lifecycle.test.ts", "refuses a forged Git lifecycle after an enable dies at its Git effect journal"],
      ["tests/integration/git/lifecycle.test.ts", "refuses a forged Git lifecycle after a disable dies right after its plan is published"],
      ["tests/e2e/opt-in-surfaces.test.ts", "keeps disabled opt-in surfaces inert end to end"],
    ],
  },
  {
    gate: "disabled automation is inert",
    tests: [
      ["apps/cli/src/commands/automation/automation.v2.test.ts", "keeps a forged config.toml automation lifecycle with no activation arm inert in status"],
      ["apps/cli/src/commands/automation/runner.test.ts", "records only inert %s"],
      ["apps/cli/src/commands/automation/runner.test.ts", "authenticates a stale installation at stage 1 and still records only automation_disabled"],
      ["tests/integration/launchd/lifecycle.test.ts", "loads and writes nothing after an enable dies right after its plan is published, and the next apply recovers first"],
      ["tests/integration/launchd/lifecycle.test.ts", "keeps an interrupted replace inert for scheduled runs until the next mutation recovers it"],
    ],
  },
  {
    gate: "lifecycle schemas are exhaustive",
    tests: [
      ["packages/core/src/lifecycle/codecs.test.ts", "carries every §2.4 cardinality and bound"],
      ["packages/core/src/config/lifecycle.test.ts", "keeps an absent record distinguishable from a present-and-undefined one"],
      ["packages/core/src/lifecycle/canonical-json.test.ts", "catches an encoder that emits noncanonical control escapes or a missing LF"],
    ],
  },
  {
    gate: "config surface is closed",
    tests: [
      ["packages/core/src/config/keys.test.ts", "enumerates exactly the Spec 1 key unions"],
      ["packages/core/src/config/keys.test.ts", "refuses an absent parent before decoding the supplied value"],
      ["apps/cli/src/commands/config.v2.test.ts", "publishes the whole projection with redaction as a count, never its patterns"],
    ],
  },
  {
    gate: "journal closure is fail-closed",
    tests: [
      ["packages/core/src/lifecycle/ledger.test.ts", "is clear only for a fully valid terminal ledger"],
      ["packages/core/src/lifecycle/foundation-ledger.test.ts", "derives the four journal roots and the three companion inventories"],
      ["packages/core/src/lifecycle/ids.test.ts", "refuses allocated mutation index %j"],
    ],
  },
  {
    gate: "terminal collection stays bounded",
    tests: [
      ["packages/core/src/lifecycle/recovery.test.ts", "leaves a journal root of exactly 10,000 leaves alone and compacts 10,001 below the cap"],
      ["apps/cli/src/commands/automation/runner.v2.test.ts", "compacts every status write's terminal journal so thousands of runs stay bounded"],
      ["packages/core/src/lifecycle/allocator.test.ts", "never reissues a collected ID across reservations"],
      ["tests/integration/git/lifecycle.test.ts", "keeps every journal root at a steady size across repeated sync cycles"],
    ],
  },
  {
    gate: "coordinator grammar is exact",
    tests: [
      ["packages/core/src/lifecycle/grammar.test.ts", "accepts the exact synthetic plan for %s and rejects every single-step corruption"],
      ["packages/core/src/lifecycle/grammar.test.ts", "makes automation_reconcile/live_only exactly one Q with no Foundation or manifest arm"],
      ["packages/core/src/lifecycle/grammar.test.ts", "derives the uninstall variant from launchd evidence and refuses a plan shaped for the other one (A14)"],
    ],
  },
  {
    gate: "applied provenance is mandatory",
    tests: [
      ["apps/cli/src/commands/git/git.v2.test.ts", "enables against a local bare remote, publishing activation and manifest ownership with the enabled config"],
      ["packages/core/src/config/lifecycle.test.ts", "reads both arms inactive"],
      ["apps/cli/src/lifecycle/mutation-gate.v2.test.ts", "keeps a push_pending git_sync at retry_only without pushing and refuses the mutation"],
      ["tests/integration/git/lifecycle.test.ts", "enables Git against a local bare remote and pushes the scoped Brain"],
    ],
  },
  {
    gate: "plan/apply identity",
    tests: [
      ["apps/cli/src/commands/automation/automation.v2.test.ts", "prints the same allocation-free enable preview twice, reconciling the full eligible set"],
      ["apps/cli/src/commands/automation/automation.v2.test.ts", "refuses a preview that went stale before apply and changes nothing"],
      ["packages/core/src/lifecycle/codecs.test.ts", "refuses a previewHash that is not the preview's digest"],
      ["tests/integration/git/lifecycle.test.ts", "refuses a disable preview that a concurrent config edit made stale, and changes nothing"],
    ],
  },
  {
    gate: "V2 new init registers ownership",
    tests: [
      ["apps/cli/src/bootstrap/fresh-layout.v2.test.ts", "creates exactly the fresh plan path set Spec 2 §3.2 and Spec 1 §2.1 reserve"],
      ["apps/cli/src/bootstrap/bookkeeping.v2.test.ts", "keeps the bookkeeping set out of the V2 manifest"],
      ["apps/cli/src/lifecycle/mutation-gate.test.ts", "captures on a V1 home with the legacy executor's own ID and never creates a global lock"],
    ],
  },
  {
    gate: "V2 admission is structural",
    tests: [
      ["apps/cli/src/lifecycle/admission.v2.test.ts", "admits a home carrying a missing schema file, altered retained evidence and a planted lifecycle plan"],
      ["apps/cli/src/lifecycle/admission.v2.test.ts", "admits status and doctor on a drifted V2 home whose closure is recovery-required (A7)"],
      ["apps/cli/src/lifecycle/uninstall-recovery.v2.test.ts", "admits the recovery-only arm at each kill point and resumes to an absent-manifest home"],
    ],
  },
  {
    gate: "runtime records are closed",
    tests: [
      ["apps/cli/src/lifecycle/runtime-records.test.ts", "round-trips every outcome through its exact canonical bytes"],
      ["apps/cli/src/lifecycle/runtime-records.test.ts", "refuses %s"],
      ["packages/platform-macos/src/launchd/registry.test.ts", "derives the current log slot and the status record inside the product home"],
    ],
  },
  {
    gate: "V2 drift is exhaustive",
    tests: [
      ["packages/core/src/manifest/v2-drift.test.ts", "distinguishes wrong kinds and symlink target changes"],
      ["packages/core/src/manifest/v2-drift.test.ts", "separates clean and changed content from directory and ephemeral type changes"],
      ["packages/core/src/manifest/v2-drift.test.ts", "binds schema bytes and ephemeral owner metadata to the admitted artifact path"],
      ["tests/integration/launchd/lifecycle.test.ts", "reports a hand-edited plist as drifted and refuses to plan over it until its bytes are restored"],
    ],
  },
  {
    gate: "composite state recovers",
    tests: [
      ["packages/core/src/lifecycle/coordinator.test.ts", "recovers %s from death at every boundary to the direction its point of no return selects"],
      ["packages/core/src/git/effects.test.ts", "recovers forward after a death at every boundary"],
      ["packages/platform-macos/src/launchd/effects.test.ts", "compensates a replace in reverse: bootout new, restore old bytes, then bootstrap old"],
      ["tests/integration/launchd/lifecycle.test.ts", "loads and writes nothing after an enable dies right after its plan is published, and the next apply recovers first"],
      ["tests/integration/launchd/lifecycle.test.ts", "keeps an interrupted replace inert for scheduled runs until the next mutation recovers it"],
    ],
  },
  {
    gate: "branch-history warning is explicit",
    tests: [
      ["packages/core/src/git/planner.test.ts", "states the branch-history warning with every enable plan"],
      ["apps/cli/src/commands/git/index.test.ts", "prints a preview's plan, its branch-history warning, and that nothing changed"],
    ],
  },
  {
    gate: "scoped staging",
    tests: [
      ["packages/core/src/git/scope.test.ts", "adds the four index artifacts and orders every path by unsigned UTF-8 bytes"],
      ["packages/core/src/git/planner.test.ts", "plans only the guarded Brain scope in unsigned UTF-8 order"],
      ["packages/core/src/git/scope.test.ts", "admits the artifacts and the injected predicate only"],
    ],
  },
  {
    gate: "scope changes reconcile",
    tests: [
      ["packages/core/src/git/planner.test.ts", "refuses a changed scope key as scope_reconcile_required and a changed brainPath as repository identity"],
      ["packages/core/src/git/planner.test.ts", "retires the last managed inventory minus the current scope without touching the local files"],
      ["apps/cli/src/commands/git/service.test.ts", "refuses a relative Brain path as a scope outside the repository"],
    ],
  },
  {
    gate: "validation precedes persistence",
    tests: [
      ["packages/core/src/git/scope.test.ts", "reads the exact 16-MiB boundary and refuses the next byte before any read"],
      ["packages/core/src/git/scope.test.ts", "admits exactly 1 GiB in aggregate and refuses the next file before any read"],
      ["packages/core/src/git/metadata.test.ts", "refuses the first byte over $name before allocation or hash"],
    ],
  },
  {
    gate: "shadow Git isolation is complete",
    tests: [
      ["packages/security/src/git/shadow.test.ts", "binds a local source only through the internal selector, never a real path"],
      ["packages/security/src/git/gateways.test.ts", "refuses the alternate object directory %j before any permit"],
      ["packages/security/src/git/gateways.test.ts", "refuses another token, a real-destination shadow path and a planted shadow hook"],
    ],
  },
  {
    gate: "Git effect publication is attributable",
    tests: [
      ["packages/core/src/git/effects.test.ts", "keeps a published .git as relinquished_created_git_tree on rollback"],
      ["packages/core/src/git/effects.test.ts", "finishes a publication that started before the journal, then compensates it"],
      ["packages/core/src/git/effects.test.ts", "rolls back after a death at every compensation boundary"],
    ],
  },
  {
    gate: "Git cardinality is closed",
    tests: [
      ["packages/core/src/git/planner.test.ts", "admits 100,000 blobs, 100,000 trees and one commit as exactly 200,001 objects"],
      ["packages/core/src/git/planner.test.ts", "refuses %s (the 200,002 boundary)"],
      ["packages/core/src/git/effect-journal.test.ts", "refuses a plan whose journal could exceed 16 MiB"],
    ],
  },
  {
    gate: "Git distribution identity is exact",
    tests: [
      ["packages/security/src/git/distribution.test.ts", "refuses a one-field change to %s as unsupported_git_distribution"],
      ["packages/security/src/git/distribution.test.ts", "refuses a same-version different binary"],
      ["apps/cli/src/commands/git/git.v2.test.ts", "reports an unsupported distribution in status without spawning, and sync refuses before any repository work"],
    ],
  },
  {
    gate: "Git exec gateway enforces descendants",
    tests: [
      ["packages/security/src/git/gateways.test.ts", "writes exactly five owner-only no-shell trampolines from the one template"],
      ["packages/security/src/git/gateways.test.ts", "identifies the pre-issued pack permit, execs the pinned Git, and refuses reuse or the wrong basename"],
      ["packages/security/src/git/supervisor.test.ts", "consumes a permit once and rejects wrong parent/order/argv"],
    ],
  },
  {
    gate: "process table is canonical",
    tests: [
      ["packages/security/src/git/process-table.test.ts", "pins the twelve environment maps, seven I/O profiles, four budgets, 21 nodes and 21 edges in id order"],
      ["packages/security/src/git/distribution.test.ts", "pins thirteen build-option lines without the version line"],
      ["packages/security/src/git/distribution.test.ts", "pins the three executables in id order, with empty versionLines only for the HTTPS helper"],
    ],
  },
  {
    gate: "process tree is level-closed",
    tests: [
      ["packages/security/src/git/supervisor.test.ts", "admits a child transition through consume without spawning, then rechecks before the same-PID exec"],
      ["packages/security/src/git/local-receive.test.ts", "accepts the exact up-to-date target without pack/index children"],
      ["tests/integration/git/local-receive.pinned-host.test.ts", "accepts a zero-object pack when the destination already owns the commit through another ref"],
    ],
  },
  {
    gate: "tree construction is NUL-safe",
    tests: [
      ["packages/core/src/git/planner.test.ts", "renders tab, LF and CR names through the NUL-delimited mktree grammar and the binary tree object"],
      ["packages/core/src/git/planner.test.ts", "refuses a name used both as a file and a directory"],
    ],
  },
  {
    gate: "hostile Git config is inert",
    tests: [
      ["packages/security/src/git/shadow.test.ts", "renders one domain-bound config template to exact bytes"],
      ["packages/security/src/git/shadow.test.ts", "counts exactly the fixed config entries and nothing command-bearing"],
      ["packages/security/src/git/gateways.test.ts", "executes no hostile extension: $name"],
    ],
  },
  {
    gate: "transport set is closed",
    tests: [
      ["packages/core/src/config/lifecycle.test.ts", "refuses a transport outside the closed set"],
      ["packages/core/src/config/lifecycle.test.ts", "refuses %s %j as not normalized or not admitted"],
      ["packages/security/src/git/process-table.test.ts", "refuses HTTPS URL %s"],
    ],
  },
  {
    gate: "SSH bridge is deterministic",
    tests: [
      ["packages/security/src/git/gateways.test.ts", "enters the bridge and execs only the fixed system SSH argv, with no -G probe"],
      ["packages/security/src/git/gateways.test.ts", "refuses a bridge whose argv names another destination"],
      ["packages/security/src/git/gateways.test.ts", "expands exactly one profile, including GIT_SSH_VARIANT=ssh and GIT_CONFIG_NOSYSTEM, and inherits nothing"],
    ],
  },
  {
    gate: "local receive-pack is closed",
    tests: [
      ["packages/security/src/git/gateways.test.ts", "speaks only capabilities and connect, then permits receive-pack against the fixed private shadow"],
      ["packages/security/src/git/shadow.test.ts", "renders the bare-destination arm with the receive pins and no remote"],
      ["packages/security/src/git/local-receive.test.ts", "refuses a shadow outside the quarantine before running any process"],
    ],
  },
  {
    gate: "Git ref publication includes reflogs",
    tests: [
      ["packages/core/src/git/planner.test.ts", "binds every reflog append bijectively to one ref transition"],
      ["packages/core/src/git/planner.test.ts", "accepts the 64-MiB reflog preimage plus one append and refuses the next preimage byte"],
      ["packages/core/src/git/effects.test.ts", "restores ref before reflogs and never deletes a relinquished object"],
    ],
  },
  {
    gate: "Git object publication is no-replace",
    tests: [
      ["packages/core/src/git/effects.test.ts", "preserves a late identical EEXIST and appends no observation"],
      ["packages/core/src/git/effects.test.ts", "refuses a destination pack/index collision between publications and keeps the published pack"],
      ["packages/core/src/git/effects.test.ts", "reuses an identical present object without touching it"],
    ],
  },
  {
    gate: "repository/index formats are closed",
    tests: [
      ["packages/core/src/git/metadata.test.ts", "admits only plain DIRC v2 plus the supported TREE cache"],
      ["packages/core/src/git/metadata.test.ts", "refuses an index with %s"],
      ["packages/core/src/git/metadata.test.ts", "admits the unborn repository with an absent index, ref and reflogs"],
    ],
  },
  {
    gate: "commit tree stays exact",
    note: "Partial: the commit is pinned to the candidate tree and hostile hooks never run; no case compares the post-commit tree with the pre-push tree.",
    tests: [
      ["packages/core/src/git/planner.test.ts", "builds the exact commit with the fixed committer, date and message"],
      ["packages/security/src/git/gateways.test.ts", "executes no hostile extension: $name"],
    ],
  },
  {
    gate: "push failure is not success",
    tests: [
      ["apps/cli/src/commands/git/git.v2.test.ts", "preserves the prior sync record when push fails and retries only the persisted push"],
      ["packages/security/src/git/supervisor.test.ts", "gives a later push_pending invocation a fresh phase only after its distribution recheck"],
      ["packages/security/src/git/supervisor.test.ts", "persists no lifetime clock in a permit or its evidence"],
      ["tests/integration/git/lifecycle.test.ts", "keeps the prior sync record when a push fails and retries only the persisted push"],
    ],
  },
  {
    gate: "no-change is truthful",
    tests: [
      ["packages/core/src/git/planner.test.ts", "reports no_changes only when nothing changed and HEAD equals the last pushed HEAD"],
      ["apps/cli/src/commands/git/sync-record.test.ts", "records no_changes only over a pushed baseline at the same head"],
      ["apps/cli/src/commands/git/git.v2.test.ts", "syncs the scoped Brain to the local remote, then records a truthful no_changes"],
    ],
  },
  {
    gate: "history ownership",
    tests: [
      ["packages/core/src/git/planner.test.ts", "refuses a dirty index and an in-progress history operation"],
      ["packages/security/src/git/process-table.test.ts", "refuses refspec %s"],
      ["packages/security/src/git/gateways.test.ts", "refuses the protocol line %j"],
      ["tests/integration/git/lifecycle.test.ts", "refuses a hand-edited repository branch before any spawn and syncs again once it is restored"],
    ],
  },
  {
    gate: "automation is closed",
    tests: [
      ["apps/cli/src/commands/automation/handlers.test.ts", "cover exactly the closed four-job registry, none of which may spawn a vendor"],
      ["packages/platform-macos/src/launchd/registry.test.ts", "ignores ambient HOME and product-home overrides"],
      ["apps/cli/src/commands/automation/index.test.ts", "accepts the exact ProgramArguments tail for every registry job"],
      ["tests/integration/launchd/lifecycle.test.ts", "refuses to plan over an unowned plist at a generated path and leaves it byte-identical"],
    ],
  },
  {
    gate: "every stale job is inert",
    tests: [
      ["apps/cli/src/commands/automation/runner.test.ts", "authenticates every registry job from exact retained evidence alone"],
      ["apps/cli/src/commands/automation/runner.test.ts", "lets an active git-sync proceed to its bound retry under retry_only, then records once clear"],
      ["apps/cli/src/commands/automation/runner.test.ts", "writes nothing when the post-handler recheck is still retry_only"],
      ["tests/integration/git/lifecycle.test.ts", "disables Git; the installed git-sync goes stale and its scheduled run records git_disabled without spawning"],
    ],
  },
  {
    gate: "schedules are complete",
    tests: [
      ["packages/platform-macos/src/launchd/schedule.test.ts", "requires a flag for every eligible job on first enable"],
      ["packages/platform-macos/src/launchd/schedule.test.ts", "preserves prior schedules and replaces only the supplied ones"],
      ["packages/core/src/config/lifecycle.test.ts", "accepts the three mandatory entries without the optional fourth"],
    ],
  },
  {
    gate: "launchd identity is closed",
    tests: [
      ["packages/platform-macos/src/launchd/registry.test.ts", "builds exactly nine arguments with the guarded product home and the generation last"],
      ["packages/platform-macos/src/launchd/plist.test.ts", "serializes the exact five-key plist with one LF and escapes a hostile home"],
      ["packages/platform-macos/src/launchd/registry.test.ts", "encodes the effective uid as the one GUI domain"],
    ],
  },
  {
    gate: "launchd replace is ordered",
    tests: [
      ["packages/platform-macos/src/launchd/effects.test.ts", "unloads the old generation before the plist mutation and loads the new one after verification"],
      ["tests/integration/launchd/fd3-bootstrap.pinned-host.test.ts", "loads the generated label from an already-unlinked inherited snapshot and leaves nothing behind"],
      ["packages/platform-macos/src/launchd/snapshot.test.ts", "keeps FD 3 on the verified bytes after $name, and the recheck reports the drift"],
      ["tests/integration/launchd/lifecycle.test.ts", "replaces one schedule by unloading the old generation before loading the new one"],
    ],
  },
  {
    gate: "lock behavior is serialized",
    tests: [
      ["apps/cli/src/commands/automation/runner.test.ts", "acquires the lifetime lease before waiting for the global lock"],
      ["apps/cli/src/commands/automation/runner.test.ts", "waits at most ten minutes, then exits silently when the final attempt is busy"],
      ["apps/cli/src/commands/automation/runner.test.ts", "records skipped_lock_timeout when the one final attempt succeeds on active state"],
      ["tests/integration/git/lifecycle.test.ts", "schedules git-sync and pushes from the scheduled run under the runner's lock"],
    ],
  },
  {
    gate: "logs are bounded and safe",
    tests: [
      ["apps/cli/src/lifecycle/runtime-records.test.ts", "redacts the structured result before it is bounded or encoded"],
      ["apps/cli/src/lifecycle/runtime-records.test.ts", "shifts ten slots and discards the eleventh without a directory scan"],
      ["apps/cli/src/commands/automation/runner.v2.test.ts", "compacts every status write's terminal journal so thousands of runs stay bounded"],
    ],
  },
  {
    gate: "uninstall drains without deadlock",
    tests: [
      ["apps/cli/src/lifecycle/uninstall.v2.test.ts", "re-drains after a death that followed R and removes each lease only while its descriptor is held"],
      ["apps/cli/src/commands/automation/runner.test.ts", "exits silently when the lease is absent because an uninstall drained it"],
      ["packages/core/src/lifecycle/ledger.test.ts", "returns uninstall_draining only after the artifacts participant removed every bound lease path"],
    ],
  },
  {
    gate: "absent-manifest uninstall is evidence-bound",
    tests: [
      ["apps/cli/src/lifecycle/absent-manifest-uninstall.test.ts", "walks an empty state twice, creates nothing and reports key_absent"],
      ["apps/cli/src/lifecycle/absent-manifest-uninstall.test.ts", "leaves the key when the run dies before the unlink, and a rerun deletes it"],
      ["packages/core/src/lifecycle/absent-manifest.test.ts", "walks the %s bound at %i through the production path (A8)"],
    ],
  },
  {
    gate: "uninstall respects ownership",
    tests: [
      ["apps/cli/src/commands/uninstall.test.ts", "removes product artifacts and keeps the Brain"],
      ["apps/cli/src/lifecycle/uninstall-launchd.v2.test.ts", "unloads the installed label before its plist is removed and preserves the Brain and its .git"],
      ["apps/cli/src/commands/uninstall.test.ts", "removes no path beyond the manifest and the redaction key"],
      ["tests/integration/git/lifecycle.test.ts", "uninstalls through uninstall/present_manifest, booting out every label and preserving the Brain, its .git and foreign files"],
      ["tests/integration/launchd/lifecycle.test.ts", "uninstalls a disabled automation without touching launchd and preserves foreign LaunchAgents"],
    ],
  },
  {
    gate: "manifest transitions are no-overwrite",
    tests: [
      ["packages/core/src/manifest/manifest-state.test.ts", "refuses an atomic move source swap and preserves the swapped inode"],
      ["packages/core/src/manifest/manifest-state.test.ts", "refuses and preserves a two-copy postimage"],
      ["packages/core/src/manifest/manifest-state.test.ts", "$direction refuses and preserves unlisted $name"],
    ],
  },
  {
    gate: "uninstall removes its manifest recoverably",
    tests: [
      ["apps/cli/src/lifecycle/uninstall.v2.test.ts", "re-derives the empty-directory list from the tombstone after a death between an rmdir and the tombstone deletion (D25)"],
      ["apps/cli/src/lifecycle/uninstall.v2.test.ts", "compensates a death at the manifest preimage move back to a byte-identical installation"],
      ["packages/core/src/manifest/manifest-state.test.ts", "applies committed absence from the preimage physical state without guessing rollback"],
    ],
  },
  {
    gate: "uninstall then init round-trips",
    note: "Partial by decision: single uninstall → init sequences only. The chained kill-point matrix is NEW-100, owned by post-A16 hardening (D42).",
    tests: [
      ["tests/e2e/fresh-v2-retained-bootstrap.test.ts", "reports, preserves, uninstalls through the coordinator, and reinstalls over the retained evidence"],
      ["apps/cli/src/lifecycle/absent-manifest-uninstall.v2.test.ts", "deletes an orphaned key after a rolled-back V2 init under the bootstrap leaf, then init succeeds"],
      ["apps/cli/src/lifecycle/absent-manifest-uninstall.v2.test.ts", "creates nothing on an empty state and lets init succeed over it"],
    ],
  },
  {
    gate: "redaction-key deletion is secret-opaque",
    tests: [
      ["apps/cli/src/lifecycle/codecs.test.ts", "round-trips a present opaque key and refuses a foreign coordinator's tombstone"],
      ["apps/cli/src/lifecycle/uninstall.v2.test.ts", "refuses a pre-existing redaction key tombstone"],
      ["apps/cli/src/lifecycle/absent-manifest-uninstall.test.ts", "refuses a key that is $label and deletes nothing"],
    ],
  },
];

function specGates(text: string): readonly string[] {
  const lines = text.slice(text.indexOf("## 7. Verification gates")).split("\n");
  const start = lines.findIndex((line) => line.startsWith("|"));
  const table: string[] = [];
  for (const line of lines.slice(start)) {
    if (!line.startsWith("|")) break;
    table.push(line);
  }
  return table.slice(2).map((line) => line.split("|")[1]?.trim() ?? "");
}

describe("spec §7 gate coverage, row by row", () => {
  it("maps exactly the gate column of spec §7, in order", async () => {
    const gates = specGates(await nodeFs.readFile(join(REPOSITORY_ROOT, SPEC), "utf8"));
    expect(gates.length).toBeGreaterThan(0);
    expect(GATE_COVERAGE.map((row) => row.gate)).toStrictEqual(gates);
  });

  describe.each(GATE_COVERAGE)("§7 $gate", (row) => {
    it("is pinned by named tests that exist verbatim", async () => {
      expect(row.tests.length).toBeGreaterThan(0);
      for (const [file, title] of row.tests) {
        const source = await nodeFs.readFile(join(REPOSITORY_ROOT, file), "utf8");
        expect(source, `${file} :: ${title}`).toContain(JSON.stringify(title));
      }
    });
  });
});

function gitData(result: Awaited<ReturnType<typeof runGit>>): GitCommandDataV1 {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.data;
}

function automationData(result: Awaited<ReturnType<typeof runAutomation>>): AutomationCommandDataV1 {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.data;
}

function kindOf(result: { readonly ok: boolean; readonly error?: { readonly kind: string } }): string {
  expect(result.ok).toBe(false);
  return result.error?.kind ?? "";
}

function localRef(home: OptInHomeV1): Promise<string | null> {
  return readOrNull(join(home.gitDirectory, "refs", "heads", "main"));
}

function remoteRef(home: OptInHomeV1): Promise<string | null> {
  return readOrNull(join(home.remote, "refs", "heads", "main"));
}

async function activationOf(home: OptInHomeV1): Promise<ReturnType<typeof parseLifecycleActivationRecord>> {
  return parseLifecycleActivationRecord(await nodeFs.readFile(join(home.paths.stateDir, "lifecycle-activation.json")));
}

/** Every gated mutation runs the recovery preflight first; a reindex is the cheapest one. */
async function recoverThroughNextMutation(home: OptInHomeV1): Promise<void> {
  const reindex = await runBrain(home.context, { subcommand: "reindex", query: null, limit: null, dryRun: false });
  expect(reindex.ok, JSON.stringify(reindex)).toBe(true);
}

/**
 * Spec §7 "disabled Git is inert": a complete config lifecycle naming the adopted repository,
 * branch and remote, with no matching active provenance, spawns no Git and opens no network.
 */
async function expectForgedLifecycleInert(home: OptInHomeV1): Promise<void> {
  const original = await nodeFs.readFile(home.paths.configFile, "utf8");
  const config = loadConfig(original);
  const url = `file://${home.remote}`;
  await nodeFs.writeFile(
    home.paths.configFile,
    serializeConfig({
      ...config,
      git: {
        enabled: true,
        lifecycle: {
          schemaVersion: 1,
          repositoryRoot: home.paths.brain as never,
          branch: "main" as never,
          remote: { name: "developer-os", transport: "local", declaredUrl: url as never, effectivePushUrl: url as never },
          scope: gitScopeOf(config),
        },
      },
    }),
  );
  const spawns = [...home.runtime.spawns];
  const remoteBefore = await remoteRef(home);
  try {
    expect((await runGit(home.context, { subcommand: "sync" })).ok).toBe(false);
    const status = await runGit(home.context, { subcommand: "status" });
    if (status.ok) expect(status.data).not.toMatchObject({ activation: "active" });
    expect(home.runtime.spawns).toStrictEqual(spawns);
    expect(home.runtime.networkCalls).toStrictEqual([]);
    expect(await remoteRef(home)).toBe(remoteBefore);
  } finally {
    await nodeFs.writeFile(home.paths.configFile, original);
  }
}

let chain: Promise<OptInHomeV1> | null = null;

/** One home the chain below walks in order; each case leaves the state the next one reads. */
function chainHome(): Promise<OptInHomeV1> {
  chain ??= createOptInHome("opt-in-chain");
  return chain;
}

describe("the opt-in lifecycle end to end: enable → sync → automation → disable → uninstall", () => {
  it(
    "keeps disabled opt-in surfaces inert end to end",
    async () => {
      const home = await chainHome();
      await runStatus(home.context);
      expect(kindOf(await runGit(home.context, { subcommand: "sync" }))).toBe("git_disabled");
      expect(gitData(await runGit(home.context, { subcommand: "status" }))).toMatchObject({ kind: "status", enabled: false, activation: "absent" });
      expect(automationData(await runAutomation(home.context, { subcommand: "status" }))).toMatchObject({
        kind: "status",
        enabled: false,
        activation: "absent",
      });
      expect(home.runtime.spawns).toStrictEqual([]);
      expect(home.runtime.networkCalls).toStrictEqual([]);
      expect(home.launchd.events).toStrictEqual([]);
      expect(await readOrNull(join(home.gitDirectory, "HEAD"))).toBeNull();
      expect(await nodeFs.readdir(join(home.userHome, "Library", "LaunchAgents"))).toStrictEqual([]);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "enables Git against a local bare remote and pushes the scoped Brain",
    async () => {
      const home = await chainHome();
      expect(gitData(await runGit(home.context, { subcommand: "enable", remote: home.remote, branch: null, apply: true }))).toMatchObject({
        kind: "applied",
        operation: "git_enable",
      });
      expect((await activationOf(home)).git.state).toBe("active");
      expect(loadConfig(await nodeFs.readFile(home.paths.configFile, "utf8")).git.enabled).toBe(true);

      await configureCommitter(home);
      await writeNote(home, "first");
      const pushed = gitData(await runGit(home.context, { subcommand: "sync" }));
      expect(pushed).toMatchObject({ kind: "sync", outcome: "pushed" });
      if (pushed.kind !== "sync") throw new Error("unreachable");
      expect(await localRef(home)).toBe(`${pushed.headOid}\n`);
      expect(await remoteRef(home)).toBe(`${pushed.headOid}\n`);
      expect(home.runtime.spawns).toStrictEqual([pushed.headOid]);
      expect(home.runtime.networkCalls).toStrictEqual([]);
      expect(home.launchd.events).toStrictEqual([]);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "schedules git-sync and pushes from the scheduled run under the runner's lock",
    async () => {
      const home = await chainHome();
      const enabled = automationData(
        await runAutomation(home.context, { subcommand: "enable", schedules: [...BASE_SCHEDULES, "git-sync=hourly@15"], apply: true }),
      );
      expect(enabled).toMatchObject({ kind: "applied", operation: "automation_enable" });
      expect([...home.launchd.loaded.keys()].sort()).toStrictEqual([...JOBS].sort());
      for (const job of JOBS) expect(await readOrNull(plistPath(home, job))).not.toBeNull();

      await writeNote(home, "scheduled");
      const spawned = home.runtime.spawns.length;
      expect(await runScheduledJob(home, "git-sync")).toStrictEqual({ kind: "recorded", outcome: "success" });
      expect(home.runtime.spawns.length).toBe(spawned + 1);
      expect(await remoteRef(home)).toBe(await localRef(home));
      const record = parseAutomationStatusRecord(
        await nodeFs.readFile(automationStatusPath(parseCanonicalAbsolutePathText(home.paths.home), "git-sync")),
      );
      expect(record).toMatchObject({ job: "git-sync", outcome: "success", reasonCode: "ok" });
      expect(gitData(await runGit(home.context, { subcommand: "status" }))).toMatchObject({
        kind: "status",
        activation: "active",
        closure: "clear",
        lastSync: { outcome: "pushed" },
      });
      expect(home.runtime.networkCalls).toStrictEqual([]);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "keeps the prior sync record when a push fails and retries only the persisted push",
    async () => {
      const home = await chainHome();
      const recordPath = join(home.paths.stateDir, "git-sync.json");
      const previous = await readOrNull(recordPath);
      const remoteBefore = await remoteRef(home);
      await writeNote(home, "rejected");
      home.faults.rejectDestination.on = true;
      try {
        const failed = await runGit(home.context, { subcommand: "sync" });
        expect(failed.ok).toBe(false);
        expect(failed.code).toBe(EXIT_CODES.recoveryRequired);
        expect(await readOrNull(recordPath)).toBe(previous);
        expect(await remoteRef(home)).toBe(remoteBefore);
      } finally {
        home.faults.rejectDestination.on = false;
      }
      const local = await localRef(home);
      expect(local).not.toBe(remoteBefore);
      gitData(await runGit(home.context, { subcommand: "sync" }));
      expect(await remoteRef(home)).toBe(local);
      expect(home.runtime.networkCalls).toStrictEqual([]);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "keeps every journal root at a steady size across repeated sync cycles",
    async () => {
      const home = await chainHome();
      const sizes: Readonly<Record<string, number>>[] = [];
      for (let cycle = 0; cycle < 4; cycle += 1) {
        await writeNote(home, `cycle-${String(cycle)}`);
        expect(gitData(await runGit(home.context, { subcommand: "sync" }))).toMatchObject({ kind: "sync", outcome: "pushed" });
        sizes.push(await journalRootSizes(home));
      }
      expect(sizes).toHaveLength(4);
      const roots = Object.keys(sizes[3] ?? {});
      expect(roots.length).toBeGreaterThan(0);
      for (const root of roots) {
        const steady = Math.max(sizes[1]?.[root] ?? 0, sizes[2]?.[root] ?? 0);
        expect(sizes[3]?.[root], root).toBeLessThanOrEqual(steady);
      }
      expect(gitData(await runGit(home.context, { subcommand: "status" }))).toMatchObject({ closure: "clear" });
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "refuses a hand-edited repository branch before any spawn and syncs again once it is restored",
    async () => {
      const home = await chainHome();
      const headPath = join(home.gitDirectory, "HEAD");
      const head = await nodeFs.readFile(headPath);
      const remoteBefore = await remoteRef(home);
      const spawns = [...home.runtime.spawns];
      await writeNote(home, "diverted");
      await nodeFs.writeFile(headPath, "ref: refs/heads/elsewhere\n");
      try {
        expect((await runGit(home.context, { subcommand: "sync" })).ok).toBe(false);
        expect(home.runtime.spawns).toStrictEqual(spawns);
        expect(await remoteRef(home)).toBe(remoteBefore);
        expect(await readOrNull(join(home.gitDirectory, "refs", "heads", "elsewhere"))).toBeNull();
      } finally {
        await nodeFs.writeFile(headPath, head);
      }
      expect(gitData(await runGit(home.context, { subcommand: "sync" }))).toMatchObject({ kind: "sync", outcome: "pushed" });
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "refuses a disable preview that a concurrent config edit made stale, and changes nothing",
    async () => {
      const home = await chainHome();
      const service = createGitService(home.context, home.lifecycle);
      const preview = await service.previewDisable();
      // Fresh init writes no [brain] table, so a brain leaf is refused config_parent_absent; an empty redaction table changes the config and nothing it governs.
      const changed = await runConfig(home.context, { operation: "set", key: "redaction", value: '{"patterns":[]}' });
      expect(changed.ok, JSON.stringify(changed)).toBe(true);
      const configBefore = await nodeFs.readFile(home.paths.configFile);
      const activationBefore = await nodeFs.readFile(join(home.paths.stateDir, "lifecycle-activation.json"));
      const global = await home.lifecycle.locks.acquireExisting(parseCanonicalAbsolutePathText(join(home.paths.stateDir, ".lifecycle.lock")));
      try {
        await expect(service.applyDisable(preview, global)).rejects.toMatchObject({
          reason: "lifecycle_preview_stale",
          code: EXIT_CODES.decisionRequired,
        });
      } finally {
        await global.release();
      }
      expect(await nodeFs.readFile(home.paths.configFile)).toStrictEqual(configBefore);
      expect(await nodeFs.readFile(join(home.paths.stateDir, "lifecycle-activation.json"))).toStrictEqual(activationBefore);
      expect((await activationOf(home)).git.state).toBe("active");
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "disables Git; the installed git-sync goes stale and its scheduled run records git_disabled without spawning",
    async () => {
      const home = await chainHome();
      const eventsBefore = home.launchd.events.length;
      expect(gitData(await runGit(home.context, { subcommand: "disable", apply: true }))).toMatchObject({
        kind: "applied",
        operation: "git_disable",
      });
      expect(home.launchd.events.length).toBe(eventsBefore);
      expect((await activationOf(home)).git.state).toBe("inactive");

      const status = automationData(await runAutomation(home.context, { subcommand: "status" }));
      if (status.kind !== "status") throw new Error("unreachable");
      expect(status.jobs.find((job) => job.job === "git-sync")).toMatchObject({ eligible: false, installed: "stale" });

      await writeNote(home, "after-disable");
      const spawns = [...home.runtime.spawns];
      const remoteBefore = await remoteRef(home);
      expect(await runScheduledJob(home, "git-sync")).toStrictEqual({ kind: "recorded", outcome: "git_disabled" });
      expect(home.runtime.spawns).toStrictEqual(spawns);
      expect(await remoteRef(home)).toBe(remoteBefore);
      expect(
        parseAutomationStatusRecord(await nodeFs.readFile(automationStatusPath(parseCanonicalAbsolutePathText(home.paths.home), "git-sync"))),
      ).toMatchObject({ outcome: "git_disabled", reasonCode: "git_disabled" });
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "uninstalls through uninstall/present_manifest, booting out every label and preserving the Brain, its .git and foreign files",
    async () => {
      const home = await chainHome();
      const foreignPlist = join(home.userHome, "Library", "LaunchAgents", "com.example.synthetic.plist");
      const foreignNote = join(home.paths.brain, "README.local.md");
      await nodeFs.writeFile(foreignPlist, "<plist version=\"1.0\"><dict/></plist>\n", { mode: 0o644 });
      await nodeFs.writeFile(foreignNote, "a file Developer OS never owned\n", { mode: 0o600 });
      const head = await nodeFs.readFile(join(home.gitDirectory, "HEAD"));
      const local = await localRef(home);
      const remote = await remoteRef(home);
      const note = await nodeFs.readFile(join(home.paths.brain, "content", "DEV", "first.md"));
      const loaded = new Map(home.launchd.loaded);
      expect([...loaded.keys()].sort()).toStrictEqual([...JOBS].sort());
      const eventsBefore = home.launchd.events.length;

      const removed = await runUninstall(home.context, { dryRun: false, assumeYes: true });
      expect(removed.ok, JSON.stringify(removed)).toBe(true);

      const plan = home.plans.at(-1);
      if (plan === undefined) throw new Error("no coordinator plan was published");
      expect(validateLifecyclePlanGrammar(plan, lifecycleVariantFacts(plan))).toBe("uninstall/present_manifest");
      expect([...home.launchd.events.slice(eventsBefore)].sort()).toStrictEqual([...loaded.values()].map((label) => `bootout ${label}`).sort());
      expect(home.launchd.loaded.size).toBe(0);
      for (const job of JOBS) expect(await readOrNull(plistPath(home, job))).toBeNull();
      expect(await readOrNull(home.paths.manifestFile)).toBeNull();

      expect(await nodeFs.readFile(foreignPlist, "utf8")).toBe("<plist version=\"1.0\"><dict/></plist>\n");
      expect(await nodeFs.readFile(foreignNote, "utf8")).toBe("a file Developer OS never owned\n");
      expect(await nodeFs.readFile(join(home.paths.brain, "content", "DEV", "first.md"))).toStrictEqual(note);
      expect(await nodeFs.readFile(join(home.gitDirectory, "HEAD"))).toStrictEqual(head);
      expect(await localRef(home)).toBe(local);
      expect(await remoteRef(home)).toBe(remote);
      expect(home.runtime.networkCalls).toStrictEqual([]);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );
});

let forgery: Promise<OptInHomeV1> | null = null;

function forgeryHome(): Promise<OptInHomeV1> {
  forgery ??= createOptInHome("opt-in-forgery");
  return forgery;
}

describe("a forged Git lifecycle stays inert after every interrupted phase (spec §7 'disabled Git is inert')", () => {
  it(
    "refuses a forged Git lifecycle after an enable dies at its Git effect journal",
    async () => {
      const home = await forgeryHome();
      home.faults.gitJournalDeath = true;
      try {
        expect((await runGit(home.context, { subcommand: "enable", remote: home.remote, branch: null, apply: true })).ok).toBe(false);
      } finally {
        home.faults.gitJournalDeath = false;
      }
      await expectForgedLifecycleInert(home);

      await recoverThroughNextMutation(home);
      expect(gitData(await runGit(home.context, { subcommand: "enable", remote: home.remote, branch: null, apply: true }))).toMatchObject({
        kind: "applied",
        operation: "git_enable",
      });
      expect((await activationOf(home)).git.state).toBe("active");
      expect(home.runtime.spawns).toStrictEqual([]);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it(
    "refuses a forged Git lifecycle after a disable dies right after its plan is published",
    async () => {
      const home = await forgeryHome();
      home.faults.deathAfterPublish = true;
      try {
        expect((await runGit(home.context, { subcommand: "disable", apply: true })).ok).toBe(false);
      } finally {
        home.faults.deathAfterPublish = false;
      }
      await recoverThroughNextMutation(home);
      expect((await activationOf(home)).git.state).toBe("active");

      expect(gitData(await runGit(home.context, { subcommand: "disable", apply: true }))).toMatchObject({
        kind: "applied",
        operation: "git_disable",
      });
      expect(await readOrNull(join(home.gitDirectory, "HEAD"))).toBe("ref: refs/heads/main\n");
      await expectForgedLifecycleInert(home);
      expect(home.runtime.spawns).toStrictEqual([]);
      expect(home.launchd.events).toStrictEqual([]);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );
});
