/**
 * Test-only hosts and probe output for the fixed-path Git admission (Spec 1 §4.2 as
 * amended 2026-09-28, D71), and one-change corruptions of the compiled process table.
 */
import {
  admitPosixRootOwnedSync,
  type SystemExecutableRowV1,
  type SystemPathInspectorSyncV1,
  type SystemPathInspectorV1,
  type SystemPathObservationV1,
} from "../system-executables.js";
import { GIT_DISTRIBUTION_POLICY, type AdmittedGitExecutablesV1 } from "./distribution.js";

/** The darwin Git rows as the platform table states them (`packages/platform-macos`). */
export const DARWIN = [
  { platform: "darwin", id: "git", path: "/usr/bin/git", ancestors: ["/", "/usr", "/usr/bin"], admission: "posix_root_owned", status: "implemented" },
  { platform: "darwin", id: "git-receive-pack", path: "/usr/bin/git-receive-pack", ancestors: ["/", "/usr", "/usr/bin"], admission: "posix_root_owned", status: "implemented" },
  { platform: "darwin", id: "ssh", path: "/usr/bin/ssh", ancestors: ["/", "/usr", "/usr/bin"], admission: "posix_root_owned", status: "implemented" },
] as unknown as readonly [SystemExecutableRowV1, SystemExecutableRowV1, SystemExecutableRowV1];

type PresentObservation = Exclude<SystemPathObservationV1, { kind: "absent" }>;

const directory = (ino: string): PresentObservation => ({ kind: "directory", ownerUid: 0, mode: 0o755, dev: "1", ino, size: 64, sha256: null });
const file = (ino: string, sha256: string): PresentObservation => ({ kind: "file", ownerUid: 0, mode: 0o755, dev: "1", ino, size: 119_000, sha256 });

/** A stock macOS host: every path root-owned `0755`; `overrides` change single fields of one path. */
export function stockHostSync(overrides: Readonly<Record<string, Partial<PresentObservation>>> = {}): SystemPathInspectorSyncV1 {
  const paths: Record<string, PresentObservation> = {
    "/": directory("2"),
    "/usr": directory("3"),
    "/usr/bin": directory("4"),
    "/usr/bin/git": file("10", "a".repeat(64)),
    "/usr/bin/git-receive-pack": file("11", "b".repeat(64)),
    "/usr/bin/ssh": file("12", "c".repeat(64)),
  };
  for (const [path, change] of Object.entries(overrides)) {
    const base = paths[path];
    if (base === undefined) throw new Error(`fixture: no stock path ${path}`);
    paths[path] = { ...base, ...change };
  }
  return (path) => paths[path] ?? { kind: "absent" };
}

export function stockHost(overrides: Readonly<Record<string, Partial<PresentObservation>>> = {}): SystemPathInspectorV1 {
  const inspect = stockHostSync(overrides);
  return (path) => Promise.resolve(inspect(path));
}

/** What `admitGitExecutables` returns for a local push on the stock host, built synchronously. */
export function stockAdmitted(): AdmittedGitExecutablesV1 {
  const inspect = stockHostSync();
  return { git: admitPosixRootOwnedSync(DARWIN[0], inspect), receivePack: admitPosixRootOwnedSync(DARWIN[1], inspect), ssh: null };
}

/** The thirteen D59 build-option lines, in the measured order, without the version line. */
export const PROBE_OK = [
  "cpu: arm64",
  "no commit associated with this build",
  "sizeof-long: 8",
  "sizeof-size_t: 8",
  "shell-path: /bin/sh",
  "rust: disabled",
  "feature: fsmonitor--daemon",
  "libcurl: 8.7.1",
  "zlib: 1.2.12",
  "SHA-1: SHA1_DC",
  "SHA-256: SHA256_BLK",
  "default-ref-format: files",
  "default-hash: sha1",
].join("\n");

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
  const copy = structuredClone(GIT_DISTRIBUTION_POLICY.processTable) as unknown as MutableTable;
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
