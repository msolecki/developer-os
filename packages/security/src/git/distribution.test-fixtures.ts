/**
 * Test-only derivations of the one supported row. Nothing here restates a
 * measured literal: every fixture is the compiled constant with one field
 * changed, so a re-pin updates the fixtures by construction.
 */
import { gitDistributionIdentity, SUPPORTED_GIT_DISTRIBUTION } from "./distribution.js";
import type { ObservedGitDistributionV1, SupportedGitDistributionV1 } from "./types.js";

type Mutable = Record<string, unknown> | unknown[];

export function observedFromRow(row: SupportedGitDistributionV1): ObservedGitDistributionV1 {
  return structuredClone(gitDistributionIdentity(row));
}

function alterFirstLeaf(container: Mutable, key: string | number): void {
  const value = (container as Record<string | number, unknown>)[key];
  if (typeof value === "string") {
    (container as Record<string | number, unknown>)[key] = `${value}x`;
    return;
  }
  if (typeof value === "number") {
    (container as Record<string | number, unknown>)[key] = value + 1;
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) throw new Error(`fixture: ${String(key)} has no leaf to alter`);
    alterFirstLeaf(value, 0);
    return;
  }
  if (typeof value === "object" && value !== null) {
    const first = Object.keys(value)[0];
    if (first === undefined) throw new Error(`fixture: ${String(key)} has no leaf to alter`);
    alterFirstLeaf(value as Mutable, first);
    return;
  }
  throw new Error(`fixture: ${String(key)} is not alterable`);
}

/** The observation with exactly one primitive under `field` changed. */
export function mutate(observed: ObservedGitDistributionV1, field: string): ObservedGitDistributionV1 {
  const copy = structuredClone(observed) as unknown as Record<string, unknown>;
  if (!Object.hasOwn(copy, field)) throw new Error(`fixture: unknown field ${field}`);
  alterFirstLeaf(copy, field);
  return copy as unknown as ObservedGitDistributionV1;
}

function flipLastHex(hash: string): string {
  return `${hash.slice(0, -1)}${hash.endsWith("0") ? "1" : "0"}`;
}

/** Identical version and build lines, different `git_main` bytes: a future binary that merely reports the same version. */
export function sameVersionOtherHash(): ObservedGitDistributionV1 {
  const observed = structuredClone(gitDistributionIdentity(SUPPORTED_GIT_DISTRIBUTION)) as unknown as {
    executables: { id: string; target: { sha256: string } }[];
  };
  const main = observed.executables.find((executable) => executable.id === "git_main");
  if (main === undefined) throw new Error("fixture: git_main missing");
  main.target.sha256 = flipLastHex(main.target.sha256);
  return observed as unknown as ObservedGitDistributionV1;
}

interface MutableTable {
  [key: string]: unknown;
  environmentProfiles: { id: string; entries: { name: string; value: unknown }[] }[];
  ioProfiles: { id: string; [key: string]: unknown }[];
  phaseBudgets: { id: string; wallDeadlineMs: number }[];
  nodes: { id: string; environmentProfiles: string[]; [key: string]: unknown }[];
  edges: {
    id: string;
    phase: string;
    minUses: number;
    maxUses: number;
    orderAfter: string[];
    argvAlternatives: { argv: Record<string, unknown>[] }[];
    [key: string]: unknown;
  }[];
}

function table(change: (value: MutableTable) => void): unknown {
  const copy = structuredClone(SUPPORTED_GIT_DISTRIBUTION.processTable) as unknown as MutableTable;
  change(copy);
  return copy;
}

function byId<T extends { id: string }>(items: T[], id: string): T {
  const found = items.find((item) => item.id === id);
  if (found === undefined) throw new Error(`fixture: ${id} missing`);
  return found;
}

function firstArgv(value: MutableTable, edgeId: string): Record<string, unknown>[] {
  const alternative = byId(value.edges, edgeId).argvAlternatives[0];
  if (alternative === undefined) throw new Error(`fixture: ${edgeId} has no argv`);
  return alternative.argv;
}

function setLiteral(value: MutableTable, edgeId: string, index: number, literal: string): void {
  firstArgv(value, edgeId)[index] = { kind: "literal", value: literal };
}

/** One-change corruptions of the compiled process table, each of which must refuse before process authority. */
export const mutatedProcessRows: readonly { readonly name: string; readonly value: unknown }[] = [
  { name: "a wildcard argv literal", value: table((t) => { setLiteral(t, "direct_source_push", 1, "*"); }) },
  { name: "a regex argv literal", value: table((t) => { setLiteral(t, "direct_source_push", 1, "^push$"); }) },
  { name: "an ellipsis argv literal", value: table((t) => { setLiteral(t, "direct_source_push", 1, "..."); }) },
  { name: "an unexpanded slot literal", value: table((t) => { setLiteral(t, "exec_system_ssh", 19, "<ssh_target>"); }) },
  { name: "an option-shaped argv[0]", value: table((t) => { setLiteral(t, "direct_source_push", 0, "--exec=/bin/sh"); }) },
  {
    name: "an extra option literal",
    value: table((t) => firstArgv(t, "direct_source_push").splice(1, 0, { kind: "literal", value: "-c" })),
  },
  {
    name: "a free-string slot",
    value: table((t) => {
      firstArgv(t, "direct_source_push")[5] = { kind: "slot", slot: "free_string" };
    }),
  },
  { name: "an unknown table field", value: table((t) => (t.extra = true)) },
  { name: "an unknown edge field", value: table((t) => (byId(t.edges, "exec_pack_git").extra = true)) },
  { name: "a missing edge", value: table((t) => t.edges.pop()) },
  { name: "a duplicated node", value: table((t) => t.nodes.splice(1, 1, t.nodes[0] as MutableTable["nodes"][number])) },
  { name: "an unsorted edge list", value: table((t) => t.edges.reverse()) },
  { name: "a phase reset on a child edge", value: table((t) => (byId(t.edges, "exec_pack_git").phase = "source_build")) },
  { name: "a stretched push budget", value: table((t) => (byId(t.phaseBudgets, "push").wallDeadlineMs = 1800000)) },
  {
    name: "a same-PID transition that changes argv",
    value: table((t) => { setLiteral(t, "exec_pack_git", 7, "--quiet"); }),
  },
  { name: "minUses above maxUses", value: table((t) => (byId(t.edges, "direct_source_push").minUses = 2)) },
  {
    name: "an edge ordered after itself",
    value: table((t) => (byId(t.edges, "exec_pack_git").orderAfter = ["exec_pack_git", "spawn_pack_gateway"])),
  },
  {
    name: "an inherited environment key",
    value: table((t) =>
      byId(t.environmentProfiles, "push_https").entries.unshift({ name: "GIT_ASKPASS", value: { kind: "literal", value: "" } }),
    ),
  },
  { name: "a dropped environment entry", value: table((t) => byId(t.environmentProfiles, "push_https").entries.pop()) },
  { name: "a coordinator with a profile", value: table((t) => (byId(t.nodes, "coordinator").environmentProfiles = ["push_https"])) },
  { name: "an I/O profile over its range", value: table((t) => (byId(t.ioProfiles, "metadata").stderrMaxBytes = 4194305)) },
];
