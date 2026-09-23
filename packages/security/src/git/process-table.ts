/**
 * Spec 1 §4.2's closed Git process graph: the compiled table, its exact-key
 * validator, its domain-separated hash and the one argv slot expander. There is
 * no spawn here; Task 9's supervisor consumes these records.
 */
import {
  encodeCanonicalJson,
  hashCanonicalJson,
  parseCanonicalAbsolutePathText,
  parseLowerHexSha1,
  parseNormalizedRemoteUrl,
  parseValidatedGitBranch,
  type CanonicalJsonValue,
  type LowerHexSha256,
} from "@developer-os/core";

import { SecurityRefusalError } from "../paths.js";
import {
  CLOSED_GATEWAY_BASENAMES,
  CLOSED_GIT_ENVIRONMENT_NAMES,
  CLOSED_GIT_PROCESS_EDGE_IDS,
  CLOSED_GIT_PROCESS_NODE_IDS,
  GIT_ARG_SLOTS,
  GIT_ENVIRONMENT_PROFILE_IDS,
  GIT_ENVIRONMENT_SLOTS,
  GIT_EXECUTABLE_IDS,
  GIT_PROCESS_CWDS,
  GIT_PROCESS_EDGE_PHASES,
  GIT_PROCESS_EDGE_PREDICATES,
  GIT_PROCESS_IO_PROFILE_IDS,
  GIT_PROCESS_PHASE_BUDGET_IDS,
  GIT_PROCESS_TRANSITIONS,
  type ClosedGitEnvironmentNameV1,
  type GitAlternateObjectDirectoryV1,
  type GitArgSlotV1,
  type GitArgTokenV1,
  type GitArgvGrammarV1,
  type GitConfigQuotedPathV1,
  type GitEnvironmentProfileIdV1,
  type GitEnvironmentProfileV1,
  type GitEnvironmentSlotV1,
  type GitEnvironmentValueV1,
  type GitProcessEdgePhaseV1,
  type GitProcessEdgeV1,
  type GitProcessImageV1,
  type GitProcessIoProfileV1,
  type GitProcessNodeV1,
  type GitProcessPhaseBudgetIdV1,
  type GitProcessPhaseBudgetV1,
  type SupportedGitProcessTableV1,
} from "./types.js";

export const SUPPORTED_GIT_DISTRIBUTION_ID = "apple-git-157-arm64-xcode-27.0-27A266a";
export const SUPPORTED_GIT_PROCESS_TABLE_ID = "apple-git-157-process-v1";
export const GIT_PACK_OBJECT_COUNT_MAX = 200001;

const GIT_PROCESS_TABLE_DOMAIN = "developer-os:git-process-table:v1";
const encoder = new TextEncoder();

function fail(label: string): never {
  throw new Error(`invalid ${label}`);
}

function refuse(reason: string): never {
  throw new SecurityRefusalError(reason);
}

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label);
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) fail(label);
  return value as Readonly<Record<string, unknown>>;
}

function exact(value: unknown, keys: readonly string[], label: string): Readonly<Record<string, unknown>> {
  const input = record(value, label);
  if (Object.keys(input).length !== keys.length || keys.some((key) => !Object.hasOwn(input, key))) {
    fail(`${label}: keys`);
  }
  return input;
}

function array(value: unknown, minimum: number, maximum: number, label: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) fail(`${label}: length`);
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) fail(`${label}: hole`);
  }
  return value as readonly unknown[];
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail(label);
  return value;
}

function member<const T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) fail(label);
  return value as T;
}

/** Every closed ID is ASCII, so code-unit order is exactly the unsigned byte order spec §4.2 sorts by. */
function assertSortedUnique(values: readonly string[], label: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (!((values[index - 1] as string) < (values[index] as string))) fail(`${label}: not sorted and unique`);
  }
}

function isLineBreak(codePoint: number): boolean {
  return codePoint === 0x0a || codePoint === 0x0d || codePoint === 0x85 || codePoint === 0x2028 || codePoint === 0x2029;
}

function isControl(codePoint: number): boolean {
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
}

function boundedText(
  value: unknown,
  minimumBytes: number,
  maximumBytes: number,
  banControls: boolean,
  label: string,
): string {
  if (typeof value !== "string" || !value.isWellFormed()) fail(label);
  const bytes = byteLength(value);
  if (bytes < minimumBytes || bytes > maximumBytes) fail(`${label}: byte length`);
  for (const character of value) {
    const codePoint = character.codePointAt(0) as number;
    if (codePoint === 0 || isLineBreak(codePoint) || (banControls && isControl(codePoint))) fail(`${label}: character`);
  }
  return value;
}

export function parseBoundedArg(value: unknown): string {
  return boundedText(value, 1, 4096, true, "BoundedArgV1");
}

function parseBoundedArgFragment(value: unknown): string {
  return boundedText(value, 0, 4096, true, "BoundedArgFragmentV1");
}

function parseBoundedEnvironmentValue(value: unknown): string {
  return boundedText(value, 0, 8192, false, "BoundedEnvironmentValueV1");
}

export function parseBoundedTextLine(value: unknown): string {
  return boundedText(value, 1, 1024, false, "BoundedTextLineV1");
}

export function parseBoundedLinkTarget(value: unknown): string {
  return boundedText(value, 1, 4096, false, "BoundedLinkTargetV1");
}

/**
 * A compiled literal is exact text, never a pattern: glob, regex and ellipsis
 * characters, and the `<slot>` spelling of an unexpanded placeholder, have no
 * legal use in any §4.2 argv or environment literal.
 */
function assertNoPatternSyntax(value: string, label: string): void {
  if (/[*?[\]{}()|^$+\\<>~\u2026]/u.test(value) || value.includes("...")) fail(`${label}: pattern syntax`);
}

export function parseGitConfigQuotedPath(value: unknown): GitConfigQuotedPathV1 {
  const path = parseCanonicalAbsolutePathText(value);
  for (const character of path) {
    const codePoint = character.codePointAt(0) as number;
    if (isControl(codePoint) || isLineBreak(codePoint)) fail("GitConfigQuotedPathV1");
  }
  return path as GitConfigQuotedPathV1;
}

/**
 * Git reads `GIT_ALTERNATE_OBJECT_DIRECTORIES` as a colon-separated list and a
 * leading double quote as C-quoted syntax, so the narrower type bans both
 * rather than introducing a second renderer.
 */
export function parseGitAlternateObjectDirectory(value: unknown): GitAlternateObjectDirectoryV1 {
  const path = parseGitConfigQuotedPath(value);
  if (/[:"\\]/u.test(path)) fail("GitAlternateObjectDirectoryV1");
  return path as unknown as GitAlternateObjectDirectoryV1;
}

function parseArgToken(value: unknown, label: string): GitArgTokenV1 {
  const kind = record(value, label).kind;
  if (kind === "literal") {
    const input = exact(value, ["kind", "value"], label);
    const literal = parseBoundedArg(input.value);
    assertNoPatternSyntax(literal, label);
    return { kind: "literal", value: literal };
  }
  if (kind === "slot") {
    const input = exact(value, ["kind", "slot"], label);
    return { kind: "slot", slot: member(input.slot, GIT_ARG_SLOTS, `${label}.slot`) };
  }
  if (kind === "joined") {
    const input = exact(value, ["kind", "prefix", "slot", "suffix"], label);
    const prefix = parseBoundedArgFragment(input.prefix);
    const suffix = parseBoundedArgFragment(input.suffix);
    assertNoPatternSyntax(prefix, `${label}.prefix`);
    assertNoPatternSyntax(suffix, `${label}.suffix`);
    return { kind: "joined", prefix, slot: member(input.slot, GIT_ARG_SLOTS, `${label}.slot`), suffix };
  }
  return fail(`${label}.kind`);
}

function parseArgvGrammar(value: unknown, label: string): GitArgvGrammarV1 {
  const input = exact(value, ["argv"], label);
  const argv = array(input.argv, 1, 32, `${label}.argv`).map((token, index) => parseArgToken(token, `${label}.argv[${String(index)}]`));
  const first = argv[0] as GitArgTokenV1;
  if (first.kind !== "literal" || first.value.startsWith("-")) fail(`${label}: argv[0] is not a literal program name`);
  return { argv };
}

function parseEnvironmentValue(value: unknown, label: string): GitEnvironmentValueV1 {
  const kind = record(value, label).kind;
  if (kind === "literal") {
    const input = exact(value, ["kind", "value"], label);
    const literal = parseBoundedEnvironmentValue(input.value);
    assertNoPatternSyntax(literal, label);
    return { kind: "literal", value: literal };
  }
  if (kind === "slot") {
    const input = exact(value, ["kind", "slot"], label);
    return { kind: "slot", slot: member(input.slot, GIT_ENVIRONMENT_SLOTS, `${label}.slot`) };
  }
  return fail(`${label}.kind`);
}

function parseEnvironmentProfile(value: unknown, label: string): GitEnvironmentProfileV1 {
  const input = exact(value, ["id", "entries"], label);
  const entries = array(input.entries, 1, 48, `${label}.entries`).map((entry, index) => {
    const entryLabel = `${label}.entries[${String(index)}]`;
    const fields = exact(entry, ["name", "value"], entryLabel);
    return {
      name: member(fields.name, CLOSED_GIT_ENVIRONMENT_NAMES, `${entryLabel}.name`),
      value: parseEnvironmentValue(fields.value, `${entryLabel}.value`),
    };
  });
  assertSortedUnique(
    entries.map((entry) => entry.name),
    `${label}.entries`,
  );
  return { id: member(input.id, GIT_ENVIRONMENT_PROFILE_IDS, `${label}.id`), entries };
}

const IO_PROFILE_KEYS = ["id", "stdinMaxBytes", "stdoutMaxBytes", "stderrMaxBytes", "wallDeadlineMs", "idleDeadlineMs"];

function parseIoProfile(value: unknown, label: string): GitProcessIoProfileV1 {
  const input = exact(value, IO_PROFILE_KEYS, label);
  return {
    id: member(input.id, GIT_PROCESS_IO_PROFILE_IDS, `${label}.id`),
    stdinMaxBytes: integer(input.stdinMaxBytes, 0, 2147483648, `${label}.stdinMaxBytes`),
    stdoutMaxBytes: integer(input.stdoutMaxBytes, 0, 2147483648, `${label}.stdoutMaxBytes`),
    stderrMaxBytes: integer(input.stderrMaxBytes, 0, 4194304, `${label}.stderrMaxBytes`),
    wallDeadlineMs: integer(input.wallDeadlineMs, 30000, 600000, `${label}.wallDeadlineMs`),
    idleDeadlineMs: integer(input.idleDeadlineMs, 30000, 120000, `${label}.idleDeadlineMs`),
  };
}

/**
 * The four inherited budgets are fixed per phase. A table that lets one phase
 * carry another's deadline is how a child would reset the push clock.
 */
const PHASE_BUDGET_MS: Readonly<Record<GitProcessPhaseBudgetIdV1, GitProcessPhaseBudgetV1["wallDeadlineMs"]>> = {
  config_candidate: 30000,
  distribution_probe: 30000,
  push: 600000,
  source_build: 1800000,
};

const EDGE_PHASE_BUDGET: Readonly<Record<GitProcessEdgePhaseV1, GitProcessPhaseBudgetIdV1>> = {
  distribution_probe: "distribution_probe",
  config_candidate: "config_candidate",
  source_build: "source_build",
  push_pack: "push",
  push_transport: "push",
  destination_receive: "push",
};

function parsePhaseBudget(value: unknown, label: string): GitProcessPhaseBudgetV1 {
  const input = exact(value, ["id", "wallDeadlineMs"], label);
  const id = member(input.id, GIT_PROCESS_PHASE_BUDGET_IDS, `${label}.id`);
  if (input.wallDeadlineMs !== PHASE_BUDGET_MS[id]) fail(`${label}.wallDeadlineMs`);
  return { id, wallDeadlineMs: PHASE_BUDGET_MS[id] };
}

function parseImage(value: unknown, label: string): GitProcessImageV1 {
  const kind = record(value, label).kind;
  if (kind === "coordinator") {
    exact(value, ["kind"], label);
    return { kind: "coordinator" };
  }
  if (kind === "gateway") {
    const input = exact(value, ["kind", "basename"], label);
    return { kind: "gateway", basename: member(input.basename, CLOSED_GATEWAY_BASENAMES, `${label}.basename`) };
  }
  if (kind === "distribution") {
    const input = exact(value, ["kind", "executableId", "argv0"], label);
    const argv0 = parseBoundedArg(input.argv0);
    assertNoPatternSyntax(argv0, `${label}.argv0`);
    return {
      kind: "distribution",
      executableId: member(input.executableId, GIT_EXECUTABLE_IDS, `${label}.executableId`),
      argv0,
    };
  }
  if (kind === "internal") {
    const input = exact(value, ["kind", "mode"], label);
    return { kind: "internal", mode: member(input.mode, ["ssh_bridge", "local_remote_helper"] as const, `${label}.mode`) };
  }
  return fail(`${label}.kind`);
}

function parseNode(value: unknown, label: string): GitProcessNodeV1 {
  const input = exact(value, ["id", "image", "environmentProfiles", "cwd"], label);
  const environmentProfiles = array(input.environmentProfiles, 0, 3, `${label}.environmentProfiles`).map((id) =>
    member(id, GIT_ENVIRONMENT_PROFILE_IDS, `${label}.environmentProfiles`),
  );
  assertSortedUnique(environmentProfiles, `${label}.environmentProfiles`);
  return {
    id: member(input.id, CLOSED_GIT_PROCESS_NODE_IDS, `${label}.id`),
    image: parseImage(input.image, `${label}.image`),
    environmentProfiles,
    cwd: member(input.cwd, GIT_PROCESS_CWDS, `${label}.cwd`),
  };
}

const EDGE_KEYS = [
  "id",
  "from",
  "to",
  "transition",
  "phase",
  "when",
  "argvAlternatives",
  "ioProfileId",
  "minUses",
  "maxUses",
  "orderAfter",
];

function parseEdge(value: unknown, label: string): GitProcessEdgeV1 {
  const input = exact(value, EDGE_KEYS, label);
  const argvAlternatives = array(input.argvAlternatives, 1, 8, `${label}.argvAlternatives`).map((grammar, index) =>
    parseArgvGrammar(grammar, `${label}.argvAlternatives[${String(index)}]`),
  );
  const encoded = argvAlternatives.map((grammar) => encodeCanonicalJson(grammar as unknown as CanonicalJsonValue));
  if (new Set(encoded).size !== encoded.length) fail(`${label}.argvAlternatives: duplicate`);
  const orderAfter = array(input.orderAfter, 0, 8, `${label}.orderAfter`).map((id) =>
    member(id, CLOSED_GIT_PROCESS_EDGE_IDS, `${label}.orderAfter`),
  );
  assertSortedUnique(orderAfter, `${label}.orderAfter`);
  const minUses = integer(input.minUses, 0, 200002, `${label}.minUses`);
  const maxUses = integer(input.maxUses, 1, 200002, `${label}.maxUses`);
  if (minUses > maxUses) fail(`${label}: minUses exceeds maxUses`);
  return {
    id: member(input.id, CLOSED_GIT_PROCESS_EDGE_IDS, `${label}.id`),
    from: member(input.from, CLOSED_GIT_PROCESS_NODE_IDS, `${label}.from`),
    to: member(input.to, CLOSED_GIT_PROCESS_NODE_IDS, `${label}.to`),
    transition: member(input.transition, GIT_PROCESS_TRANSITIONS, `${label}.transition`),
    phase: member(input.phase, GIT_PROCESS_EDGE_PHASES, `${label}.phase`),
    when: member(input.when, GIT_PROCESS_EDGE_PREDICATES, `${label}.when`),
    argvAlternatives,
    ioProfileId: member(input.ioProfileId, GIT_PROCESS_IO_PROFILE_IDS, `${label}.ioProfileId`),
    minUses,
    maxUses,
    orderAfter,
  };
}

function fixedList<T extends { readonly id: string }>(
  value: unknown,
  count: number,
  parse: (item: unknown, label: string) => T,
  label: string,
): readonly T[] {
  const items = array(value, count, count, label).map((item, index) => parse(item, `${label}[${String(index)}]`));
  assertSortedUnique(
    items.map((item) => item.id),
    label,
  );
  return items;
}

/** Cross-record rules of §4.2 that no single record's schema can see. */
function assertGraphSemantics(table: SupportedGitProcessTableV1): void {
  const label = "SupportedGitProcessTableV1";
  const profileIds = new Set<string>(table.environmentProfiles.map((profile) => profile.id));
  const ioIds = new Set<string>(table.ioProfiles.map((profile) => profile.id));
  const nodes = new Map(table.nodes.map((node) => [node.id, node]));
  const edges = new Map(table.edges.map((edge) => [edge.id, edge]));
  for (const node of table.nodes) {
    const isCoordinator = node.id === "coordinator";
    if (isCoordinator !== (node.image.kind === "coordinator")) fail(`${label}.nodes.${node.id}: coordinator image`);
    if (isCoordinator !== (node.environmentProfiles.length === 0)) fail(`${label}.nodes.${node.id}: environment profiles`);
    for (const id of node.environmentProfiles) {
      if (!profileIds.has(id)) fail(`${label}.nodes.${node.id}: unknown environment profile`);
    }
  }
  for (const edge of table.edges) {
    const edgeLabel = `${label}.edges.${edge.id}`;
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (from === undefined || to === undefined || edge.to === "coordinator") fail(`${edgeLabel}: endpoints`);
    if (!ioIds.has(edge.ioProfileId)) fail(`${edgeLabel}: unknown I/O profile`);
    if (edge.orderAfter.includes(edge.id)) fail(`${edgeLabel}: orders after itself`);
    for (const id of edge.orderAfter) {
      if (!edges.has(id)) fail(`${edgeLabel}: unknown orderAfter edge`);
    }
    const transitionAllowed =
      edge.transition === "spawn"
        ? from.image.kind === "coordinator"
          ? to.image.kind === "distribution"
          : to.image.kind === "gateway"
        : edge.transition === "exec_same_pid"
          ? (from.image.kind === "gateway" || from.image.kind === "internal") && to.image.kind === "distribution"
          : from.image.kind === "gateway" && to.image.kind === "internal";
    if (!transitionAllowed) fail(`${edgeLabel}: transition`);
    if (from.image.kind === "coordinator") continue;
    const parents = edge.orderAfter.map((id) => edges.get(id) as GitProcessEdgeV1).filter((parent) => parent.to === edge.from);
    if (parents.length !== 1) fail(`${edgeLabel}: no single parent edge`);
    const parent = parents[0] as GitProcessEdgeV1;
    if (EDGE_PHASE_BUDGET[edge.phase] !== EDGE_PHASE_BUDGET[parent.phase]) fail(`${edgeLabel}: phase reset`);
    if (edge.transition !== "spawn" && from.image.kind === "gateway") {
      const own = encodeCanonicalJson(edge.argvAlternatives as unknown as CanonicalJsonValue);
      if (own !== encodeCanonicalJson(parent.argvAlternatives as unknown as CanonicalJsonValue)) {
        fail(`${edgeLabel}: same-PID transition changes argv`);
      }
    }
  }
}

function parseProcessTableShape(value: unknown): SupportedGitProcessTableV1 {
  const label = "SupportedGitProcessTableV1";
  const input = exact(
    value,
    ["schemaVersion", "id", "distributionId", "environmentProfiles", "ioProfiles", "phaseBudgets", "nodes", "edges"],
    label,
  );
  if (input.schemaVersion !== 1) fail(`${label}.schemaVersion`);
  if (input.id !== SUPPORTED_GIT_PROCESS_TABLE_ID) fail(`${label}.id`);
  if (input.distributionId !== SUPPORTED_GIT_DISTRIBUTION_ID) fail(`${label}.distributionId`);
  const table: SupportedGitProcessTableV1 = {
    schemaVersion: 1,
    id: SUPPORTED_GIT_PROCESS_TABLE_ID,
    distributionId: SUPPORTED_GIT_DISTRIBUTION_ID,
    environmentProfiles: fixedList(input.environmentProfiles, 12, parseEnvironmentProfile, `${label}.environmentProfiles`),
    ioProfiles: fixedList(input.ioProfiles, 7, parseIoProfile, `${label}.ioProfiles`),
    phaseBudgets: fixedList(input.phaseBudgets, 4, parsePhaseBudget, `${label}.phaseBudgets`),
    nodes: fixedList(input.nodes, 21, parseNode, `${label}.nodes`),
    edges: fixedList(input.edges, 21, parseEdge, `${label}.edges`),
  };
  assertGraphSemantics(table);
  return table;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const literalArg = (value: string): GitArgTokenV1 => ({ kind: "literal", value });
const slotArg = (slot: GitArgSlotV1): GitArgTokenV1 => ({ kind: "slot", slot });
const argv = (...tokens: readonly (string | GitArgTokenV1)[]): GitArgvGrammarV1 => ({
  argv: tokens.map((token) => (typeof token === "string" ? literalArg(token) : token)),
});

type EnvironmentMap = Readonly<Partial<Record<ClosedGitEnvironmentNameV1, GitEnvironmentValueV1>>>;

const envLiteral = (value: string): GitEnvironmentValueV1 => ({ kind: "literal", value });
const envSlot = (slot: GitEnvironmentSlotV1): GitEnvironmentValueV1 => ({ kind: "slot", slot });

/** Spec §4.2's `plus`: an exact disjoint-key union, so a duplicate key is a table bug, not an override. */
function plus(...maps: readonly EnvironmentMap[]): EnvironmentMap {
  const union: Partial<Record<ClosedGitEnvironmentNameV1, GitEnvironmentValueV1>> = {};
  for (const map of maps) {
    for (const [name, value] of Object.entries(map) as [ClosedGitEnvironmentNameV1, GitEnvironmentValueV1][]) {
      if (Object.hasOwn(union, name)) fail(`environment union: duplicate ${name}`);
      union[name] = value;
    }
  }
  return union;
}

function environmentProfile(id: GitEnvironmentProfileIdV1, map: EnvironmentMap): GitEnvironmentProfileV1 {
  const entries = (Object.entries(map) as [ClosedGitEnvironmentNameV1, GitEnvironmentValueV1][])
    .map(([name, value]) => ({ name, value }))
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  return { id, entries };
}

const LOCALE: EnvironmentMap = { LC_ALL: envLiteral("C"), LANG: envLiteral("C") };
const SUPERVISED: EnvironmentMap = {
  DEVELOPER_OS_GIT_SUPERVISOR_SOCKET: envSlot("supervisor_socket"),
  DEVELOPER_OS_GIT_INVOCATION_CAPABILITY: envSlot("invocation_capability"),
  DEVELOPER_OS_GIT_DISTRIBUTION: envLiteral(SUPPORTED_GIT_DISTRIBUTION_ID),
};
const SANITIZED_GIT: EnvironmentMap = plus(LOCALE, {
  HOME: envSlot("temporary_home"),
  TMPDIR: envSlot("temporary_directory"),
  PATH: envSlot("gateway_path"),
  GIT_EXEC_PATH: envSlot("gateway_path"),
  GIT_CONFIG_NOSYSTEM: envLiteral("1"),
  GIT_CONFIG_GLOBAL: envLiteral("/dev/null"),
  GIT_TERMINAL_PROMPT: envLiteral("0"),
  GIT_OPTIONAL_LOCKS: envLiteral("0"),
});
const phaseEnvironment = (phase: string): EnvironmentMap => ({ DEVELOPER_OS_GIT_PHASE: envLiteral(phase) });
const sourceBase = (phase: string): EnvironmentMap =>
  plus(SANITIZED_GIT, SUPERVISED, phaseEnvironment(phase), {
    GIT_DIR: envSlot("source_git_dir"),
    GIT_INDEX_FILE: envSlot("source_index"),
    GIT_OBJECT_DIRECTORY: envSlot("source_object_dir"),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: envSlot("source_alternate"),
  });
const internalBase: EnvironmentMap = plus(LOCALE, SUPERVISED, phaseEnvironment("push_transport"), {
  TMPDIR: envSlot("temporary_directory"),
});
const systemSshNoAgent: EnvironmentMap = plus(LOCALE, {
  HOME: envSlot("canonical_user_home"),
  TMPDIR: envSlot("temporary_directory"),
});

const ENVIRONMENT_PROFILES: readonly GitEnvironmentProfileV1[] = [
  environmentProfile("config_candidate", sourceBase("config_candidate")),
  environmentProfile(
    "destination_receive",
    plus(SANITIZED_GIT, SUPERVISED, phaseEnvironment("destination_receive"), { GIT_DIR: envSlot("destination_git_dir") }),
  ),
  environmentProfile("distribution_probe", plus(SANITIZED_GIT, SUPERVISED, phaseEnvironment("distribution_probe"))),
  environmentProfile("https_helper", sourceBase("push_transport")),
  environmentProfile(
    "local_helper",
    plus(internalBase, {
      DEVELOPER_OS_GIT_LOCAL_TOKEN: envSlot("opaque_local_token"),
      DEVELOPER_OS_GIT_DESTINATION_SHADOW: envSlot("private_destination_shadow"),
    }),
  ),
  environmentProfile("push_https", sourceBase("push_transport")),
  environmentProfile("push_local", sourceBase("push_transport")),
  environmentProfile(
    "push_ssh",
    plus(sourceBase("push_transport"), { GIT_SSH: envSlot("ssh_bridge_path"), GIT_SSH_VARIANT: envLiteral("ssh") }),
  ),
  environmentProfile(
    "source_build",
    plus(sourceBase("source_build"), {
      GIT_AUTHOR_NAME: envSlot("git_author_name"),
      GIT_AUTHOR_EMAIL: envSlot("git_author_email"),
      GIT_AUTHOR_DATE: envSlot("git_author_date"),
      GIT_COMMITTER_NAME: envSlot("git_committer_name"),
      GIT_COMMITTER_EMAIL: envSlot("git_committer_email"),
      GIT_COMMITTER_DATE: envSlot("git_committer_date"),
    }),
  ),
  environmentProfile("ssh_bridge", internalBase),
  environmentProfile("system_ssh_agent", plus(systemSshNoAgent, { SSH_AUTH_SOCK: envSlot("ssh_auth_sock") })),
  environmentProfile("system_ssh_no_agent", systemSshNoAgent),
];

const STREAM = 2147483648;
const TEXT = 4194304;
const STDIN_RECORDS = 16777216;

const IO_PROFILES: readonly GitProcessIoProfileV1[] = [
  { id: "index_stream", stdinMaxBytes: STREAM, stdoutMaxBytes: TEXT, stderrMaxBytes: TEXT, wallDeadlineMs: 600000, idleDeadlineMs: 120000 },
  { id: "metadata", stdinMaxBytes: 0, stdoutMaxBytes: TEXT, stderrMaxBytes: TEXT, wallDeadlineMs: 30000, idleDeadlineMs: 30000 },
  { id: "pack_stream", stdinMaxBytes: STDIN_RECORDS, stdoutMaxBytes: STREAM, stderrMaxBytes: TEXT, wallDeadlineMs: 600000, idleDeadlineMs: 120000 },
  { id: "receive_stream", stdinMaxBytes: STREAM, stdoutMaxBytes: TEXT, stderrMaxBytes: TEXT, wallDeadlineMs: 600000, idleDeadlineMs: 120000 },
  { id: "root_push", stdinMaxBytes: 0, stdoutMaxBytes: TEXT, stderrMaxBytes: TEXT, wallDeadlineMs: 600000, idleDeadlineMs: 120000 },
  { id: "source_build", stdinMaxBytes: STDIN_RECORDS, stdoutMaxBytes: TEXT, stderrMaxBytes: TEXT, wallDeadlineMs: 30000, idleDeadlineMs: 30000 },
  { id: "transport_stream", stdinMaxBytes: STREAM, stdoutMaxBytes: STREAM, stderrMaxBytes: TEXT, wallDeadlineMs: 600000, idleDeadlineMs: 120000 },
];

const PHASE_BUDGETS: readonly GitProcessPhaseBudgetV1[] = GIT_PROCESS_PHASE_BUDGET_IDS.map((id) => ({
  id,
  wallDeadlineMs: PHASE_BUDGET_MS[id],
}));

const PUSH_PROFILES: readonly GitEnvironmentProfileIdV1[] = ["push_https", "push_local", "push_ssh"];
const gitMain = (argv0: string): GitProcessImageV1 => ({ kind: "distribution", executableId: "git_main", argv0 });
const gateway = (basename: (typeof CLOSED_GATEWAY_BASENAMES)[number]): GitProcessImageV1 => ({ kind: "gateway", basename });

const NODES: readonly GitProcessNodeV1[] = [
  { id: "coordinator", image: { kind: "coordinator" }, environmentProfiles: [], cwd: "quarantine" },
  { id: "distribution_probe_git", image: gitMain("git"), environmentProfiles: ["distribution_probe"], cwd: "quarantine" },
  { id: "gateway_https_dispatch_git", image: gateway("git"), environmentProfiles: ["push_https"], cwd: "source_shadow" },
  { id: "gateway_https_helper", image: gateway("git-remote-https"), environmentProfiles: ["push_https"], cwd: "source_shadow" },
  { id: "gateway_index_git", image: gateway("git"), environmentProfiles: ["destination_receive"], cwd: "destination_shadow" },
  { id: "gateway_local_dispatch_git", image: gateway("git"), environmentProfiles: ["push_local"], cwd: "source_shadow" },
  {
    id: "gateway_local_helper",
    image: gateway("git-remote-developer-os-local"),
    environmentProfiles: ["push_local"],
    cwd: "source_shadow",
  },
  { id: "gateway_pack_git", image: gateway("git"), environmentProfiles: PUSH_PROFILES, cwd: "source_shadow" },
  {
    id: "gateway_receive_pack",
    image: gateway("git-receive-pack"),
    environmentProfiles: ["destination_receive"],
    cwd: "destination_shadow",
  },
  { id: "gateway_ssh_bridge", image: gateway("developer-os-ssh-bridge"), environmentProfiles: ["push_ssh"], cwd: "source_shadow" },
  {
    id: "internal_local_helper",
    image: { kind: "internal", mode: "local_remote_helper" },
    environmentProfiles: ["local_helper"],
    cwd: "quarantine",
  },
  { id: "internal_ssh_bridge", image: { kind: "internal", mode: "ssh_bridge" }, environmentProfiles: ["ssh_bridge"], cwd: "quarantine" },
  { id: "real_https_dispatch_git", image: gitMain("git"), environmentProfiles: ["push_https"], cwd: "source_shadow" },
  {
    id: "real_https_helper",
    image: { kind: "distribution", executableId: "git_remote_https", argv0: "git-remote-https" },
    environmentProfiles: ["https_helper"],
    cwd: "source_shadow",
  },
  { id: "real_index_git", image: gitMain("git"), environmentProfiles: ["destination_receive"], cwd: "destination_shadow" },
  { id: "real_local_dispatch_git", image: gitMain("git"), environmentProfiles: ["push_local"], cwd: "source_shadow" },
  { id: "real_pack_git", image: gitMain("git"), environmentProfiles: PUSH_PROFILES, cwd: "source_shadow" },
  {
    id: "real_receive_pack",
    image: gitMain("git-receive-pack"),
    environmentProfiles: ["destination_receive"],
    cwd: "destination_shadow",
  },
  {
    id: "real_system_ssh",
    image: { kind: "distribution", executableId: "system_ssh", argv0: "/usr/bin/ssh" },
    environmentProfiles: ["system_ssh_agent", "system_ssh_no_agent"],
    cwd: "quarantine",
  },
  {
    id: "source_build_git",
    image: gitMain("git"),
    environmentProfiles: ["config_candidate", "source_build"],
    cwd: "quarantine",
  },
  { id: "source_push_git", image: gitMain("git"), environmentProfiles: PUSH_PROFILES, cwd: "source_shadow" },
];

const PACK_ARGV = [
  argv("git", "pack-objects", "--all-progress-implied", "--revs", "--stdout", "--thin", "--delta-base-offset", "-q"),
];
const HTTPS_DISPATCH_ARGV = [argv("git", "remote-https", "developer-os", slotArg("validated_https_url"))];
const HTTPS_HELPER_ARGV = [argv("git-remote-https", "developer-os", slotArg("validated_https_url"))];
const SSH_BRIDGE_ARGV = [
  argv("developer-os-ssh-bridge", slotArg("ssh_target"), slotArg("ssh_receive_pack_command")),
  argv("developer-os-ssh-bridge", "-p", slotArg("ssh_port"), slotArg("ssh_target"), slotArg("ssh_receive_pack_command")),
];
const SYSTEM_SSH_OPTIONS = [
  "-F",
  "/dev/null",
  "-o",
  "BatchMode=yes",
  "-o",
  "NumberOfPasswordPrompts=0",
  "-o",
  "ClearAllForwardings=yes",
  "-o",
  "PermitLocalCommand=no",
  "-o",
  "ProxyCommand=none",
  "-o",
  "ProxyJump=none",
  "-o",
  "RequestTTY=no",
  "-o",
  "StrictHostKeyChecking=yes",
];
const SYSTEM_SSH_ARGV = [
  argv("/usr/bin/ssh", ...SYSTEM_SSH_OPTIONS, slotArg("ssh_target"), slotArg("ssh_receive_pack_command")),
  argv("/usr/bin/ssh", ...SYSTEM_SSH_OPTIONS, "-p", slotArg("ssh_port"), slotArg("ssh_target"), slotArg("ssh_receive_pack_command")),
];
const LOCAL_DISPATCH_ARGV = [argv("git", "remote-developer-os-local", "developer-os", slotArg("opaque_local_token"))];
const LOCAL_HELPER_ARGV = [argv("git-remote-developer-os-local", "developer-os", slotArg("opaque_local_token"))];
const RECEIVE_PACK_ARGV = [argv("git-receive-pack", "--skip-connectivity-check", slotArg("private_destination_shadow"))];
const INDEX_PACK_ARGV = [
  argv(
    "git",
    "index-pack",
    "--stdin",
    { kind: "joined", prefix: "--pack_header=2,", slot: "pack_object_count", suffix: "" },
    { kind: "joined", prefix: "--keep=", slot: "receive_keep_marker", suffix: "" },
    "--report-end-of-input",
    "--fix-thin",
  ),
];

type EdgeSpec = Omit<GitProcessEdgeV1, "minUses" | "maxUses"> & { readonly uses?: readonly [number, number] };

const edge = (spec: EdgeSpec): GitProcessEdgeV1 => {
  const { uses = [1, 1], ...rest } = spec;
  return { ...rest, minUses: uses[0], maxUses: uses[1] };
};

const EDGES: readonly GitProcessEdgeV1[] = [
  edge({
    id: "direct_distribution_probe",
    from: "coordinator",
    to: "distribution_probe_git",
    transition: "spawn",
    phase: "distribution_probe",
    when: "distribution_probe",
    argvAlternatives: [argv("git", "--version", "--build-options")],
    ioProfileId: "metadata",
    orderAfter: [],
  }),
  edge({
    id: "direct_config_candidate",
    from: "coordinator",
    to: "source_build_git",
    transition: "spawn",
    phase: "config_candidate",
    when: "config_candidate",
    argvAlternatives: [
      argv(
        "git",
        "config",
        "--file",
        slotArg("candidate_config_path"),
        "--no-includes",
        "--add",
        "remote.developer-os.url",
        slotArg("normalized_remote_url"),
      ),
    ],
    ioProfileId: "metadata",
    orderAfter: ["direct_distribution_probe"],
  }),
  edge({
    id: "direct_source_build",
    from: "coordinator",
    to: "source_build_git",
    transition: "spawn",
    phase: "source_build",
    when: "new_commit",
    argvAlternatives: [
      argv("git", "hash-object", "-w", "--stdin"),
      argv("git", "mktree", "-z"),
      argv("git", "commit-tree", slotArg("candidate_tree_oid")),
      argv("git", "commit-tree", slotArg("candidate_tree_oid"), "-p", slotArg("parent_commit_oid")),
    ],
    ioProfileId: "source_build",
    uses: [2, GIT_PACK_OBJECT_COUNT_MAX],
    orderAfter: ["direct_distribution_probe"],
  }),
  edge({
    id: "direct_source_push",
    from: "coordinator",
    to: "source_push_git",
    transition: "spawn",
    phase: "push_transport",
    when: "any_push",
    argvAlternatives: [argv("git", "push", "--porcelain", "--no-verify", "developer-os", slotArg("commit_to_branch_refspec"))],
    ioProfileId: "root_push",
    orderAfter: ["direct_distribution_probe", "direct_source_build"],
  }),
  edge({
    id: "spawn_pack_gateway",
    from: "source_push_git",
    to: "gateway_pack_git",
    transition: "spawn",
    phase: "push_pack",
    when: "pack_required",
    argvAlternatives: PACK_ARGV,
    ioProfileId: "pack_stream",
    orderAfter: ["direct_source_push"],
  }),
  edge({
    id: "exec_pack_git",
    from: "gateway_pack_git",
    to: "real_pack_git",
    transition: "exec_same_pid",
    phase: "push_pack",
    when: "pack_required",
    argvAlternatives: PACK_ARGV,
    ioProfileId: "pack_stream",
    orderAfter: ["spawn_pack_gateway"],
  }),
  edge({
    id: "spawn_https_dispatch_gateway",
    from: "source_push_git",
    to: "gateway_https_dispatch_git",
    transition: "spawn",
    phase: "push_transport",
    when: "https_push",
    argvAlternatives: HTTPS_DISPATCH_ARGV,
    ioProfileId: "transport_stream",
    orderAfter: ["direct_source_push"],
  }),
  edge({
    id: "exec_https_dispatch_git",
    from: "gateway_https_dispatch_git",
    to: "real_https_dispatch_git",
    transition: "exec_same_pid",
    phase: "push_transport",
    when: "https_push",
    argvAlternatives: HTTPS_DISPATCH_ARGV,
    ioProfileId: "transport_stream",
    orderAfter: ["spawn_https_dispatch_gateway"],
  }),
  edge({
    id: "spawn_https_helper_gateway",
    from: "real_https_dispatch_git",
    to: "gateway_https_helper",
    transition: "spawn",
    phase: "push_transport",
    when: "https_push",
    argvAlternatives: HTTPS_HELPER_ARGV,
    ioProfileId: "transport_stream",
    orderAfter: ["exec_https_dispatch_git"],
  }),
  edge({
    id: "exec_https_helper",
    from: "gateway_https_helper",
    to: "real_https_helper",
    transition: "exec_same_pid",
    phase: "push_transport",
    when: "https_push",
    argvAlternatives: HTTPS_HELPER_ARGV,
    ioProfileId: "transport_stream",
    orderAfter: ["spawn_https_helper_gateway"],
  }),
  edge({
    id: "spawn_ssh_bridge_gateway",
    from: "source_push_git",
    to: "gateway_ssh_bridge",
    transition: "spawn",
    phase: "push_transport",
    when: "ssh_push",
    argvAlternatives: SSH_BRIDGE_ARGV,
    ioProfileId: "transport_stream",
    orderAfter: ["direct_source_push"],
  }),
  edge({
    id: "enter_ssh_bridge",
    from: "gateway_ssh_bridge",
    to: "internal_ssh_bridge",
    transition: "enter_internal_same_pid",
    phase: "push_transport",
    when: "ssh_push",
    argvAlternatives: SSH_BRIDGE_ARGV,
    ioProfileId: "transport_stream",
    orderAfter: ["spawn_ssh_bridge_gateway"],
  }),
  edge({
    id: "exec_system_ssh",
    from: "internal_ssh_bridge",
    to: "real_system_ssh",
    transition: "exec_same_pid",
    phase: "push_transport",
    when: "ssh_push",
    argvAlternatives: SYSTEM_SSH_ARGV,
    ioProfileId: "transport_stream",
    orderAfter: ["enter_ssh_bridge"],
  }),
  edge({
    id: "spawn_local_dispatch_gateway",
    from: "source_push_git",
    to: "gateway_local_dispatch_git",
    transition: "spawn",
    phase: "push_transport",
    when: "local_push",
    argvAlternatives: LOCAL_DISPATCH_ARGV,
    ioProfileId: "transport_stream",
    orderAfter: ["direct_source_push"],
  }),
  edge({
    id: "exec_local_dispatch_git",
    from: "gateway_local_dispatch_git",
    to: "real_local_dispatch_git",
    transition: "exec_same_pid",
    phase: "push_transport",
    when: "local_push",
    argvAlternatives: LOCAL_DISPATCH_ARGV,
    ioProfileId: "transport_stream",
    orderAfter: ["spawn_local_dispatch_gateway"],
  }),
  edge({
    id: "spawn_local_helper_gateway",
    from: "real_local_dispatch_git",
    to: "gateway_local_helper",
    transition: "spawn",
    phase: "push_transport",
    when: "local_push",
    argvAlternatives: LOCAL_HELPER_ARGV,
    ioProfileId: "transport_stream",
    orderAfter: ["exec_local_dispatch_git"],
  }),
  edge({
    id: "enter_local_helper",
    from: "gateway_local_helper",
    to: "internal_local_helper",
    transition: "enter_internal_same_pid",
    phase: "push_transport",
    when: "local_push",
    argvAlternatives: LOCAL_HELPER_ARGV,
    ioProfileId: "transport_stream",
    orderAfter: ["spawn_local_helper_gateway"],
  }),
  edge({
    id: "spawn_receive_pack_gateway",
    from: "internal_local_helper",
    to: "gateway_receive_pack",
    transition: "spawn",
    phase: "destination_receive",
    when: "local_push",
    argvAlternatives: RECEIVE_PACK_ARGV,
    ioProfileId: "receive_stream",
    orderAfter: ["enter_local_helper"],
  }),
  edge({
    id: "exec_receive_pack",
    from: "gateway_receive_pack",
    to: "real_receive_pack",
    transition: "exec_same_pid",
    phase: "destination_receive",
    when: "local_push",
    argvAlternatives: RECEIVE_PACK_ARGV,
    ioProfileId: "receive_stream",
    orderAfter: ["spawn_receive_pack_gateway"],
  }),
  edge({
    id: "spawn_index_gateway",
    from: "real_receive_pack",
    to: "gateway_index_git",
    transition: "spawn",
    phase: "destination_receive",
    when: "local_pack_received",
    argvAlternatives: INDEX_PACK_ARGV,
    ioProfileId: "index_stream",
    orderAfter: ["exec_receive_pack"],
  }),
  edge({
    id: "exec_index_git",
    from: "gateway_index_git",
    to: "real_index_git",
    transition: "exec_same_pid",
    phase: "destination_receive",
    when: "local_pack_received",
    argvAlternatives: INDEX_PACK_ARGV,
    ioProfileId: "index_stream",
    orderAfter: ["spawn_index_gateway"],
  }),
];

const byId = <T extends { readonly id: string }>(items: readonly T[]): readonly T[] =>
  [...items].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

/** Validated once at load: a sort, count or reference slip in the literals above fails on import. */
export const SUPPORTED_GIT_PROCESS_TABLE: SupportedGitProcessTableV1 = deepFreeze(
  parseProcessTableShape({
    schemaVersion: 1,
    id: SUPPORTED_GIT_PROCESS_TABLE_ID,
    distributionId: SUPPORTED_GIT_DISTRIBUTION_ID,
    environmentProfiles: byId(ENVIRONMENT_PROFILES),
    ioProfiles: byId(IO_PROFILES),
    phaseBudgets: byId(PHASE_BUDGETS),
    nodes: byId(NODES),
    edges: byId(EDGES),
  }),
);

const SUPPORTED_GIT_PROCESS_TABLE_BYTES = encodeCanonicalJson(SUPPORTED_GIT_PROCESS_TABLE as unknown as CanonicalJsonValue);

/**
 * Exact-set identity: a table is supported only if it is well formed and is,
 * byte for byte, the compiled table. Re-pinning replaces the literals above.
 */
export function validateSupportedGitProcessTable(value: unknown): SupportedGitProcessTableV1 {
  const table = parseProcessTableShape(value);
  if (encodeCanonicalJson(table as unknown as CanonicalJsonValue) !== SUPPORTED_GIT_PROCESS_TABLE_BYTES) {
    fail("SupportedGitProcessTableV1: not the compiled table");
  }
  return SUPPORTED_GIT_PROCESS_TABLE;
}

export function hashGitProcessTable(table: SupportedGitProcessTableV1): LowerHexSha256 {
  return hashCanonicalJson(
    GIT_PROCESS_TABLE_DOMAIN,
    validateSupportedGitProcessTable(table) as unknown as CanonicalJsonValue,
  );
}

const SSH_TARGET = /^(?:[A-Za-z0-9_][A-Za-z0-9._-]{0,63}@)?[a-z0-9][a-z0-9.-]{0,252}$/u;
const SSH_SAFE_SEGMENT = /^[A-Za-z0-9_.][A-Za-z0-9._-]*$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;

function decimalWithin(value: string, minimum: number, maximum: number): boolean {
  return DECIMAL.test(value) && value.length <= 16 && Number(value) >= minimum && Number(value) <= maximum;
}

function parses(parse: (value: string) => unknown): (value: string) => boolean {
  return (value) => {
    try {
      parse(value);
      return true;
    } catch {
      return false;
    }
  };
}

function isSafeSshRepositoryPath(path: string): boolean {
  const segments = (path.startsWith("/") ? path.slice(1) : path).split("/");
  return segments.every((segment) => SSH_SAFE_SEGMENT.test(segment) && segment !== "." && segment !== "..");
}

/**
 * Each slot is a closed semantic type, never a pattern: the value must parse
 * as exactly that type before it can appear in an argv.
 */
const ARG_SLOT_ADMISSION: Readonly<Record<GitArgSlotV1, (value: string) => boolean>> = {
  validated_https_url: parses((value) => parseNormalizedRemoteUrl(value, "https")),
  normalized_remote_url: (value) =>
    (["local", "https", "ssh"] as const).some((transport) => parses((text) => parseNormalizedRemoteUrl(text, transport))(value)),
  opaque_local_token: (value) => /^[0-9a-f]{64}$/u.test(value),
  private_destination_shadow: parses(parseCanonicalAbsolutePathText),
  source_shadow_path: parses(parseCanonicalAbsolutePathText),
  candidate_config_path: parses(parseCanonicalAbsolutePathText),
  commit_to_branch_refspec: parses((value) => {
    const separator = value.indexOf(":refs/heads/");
    if (separator !== 40) throw new Error("refspec");
    parseLowerHexSha1(value.slice(0, separator));
    parseValidatedGitBranch(value.slice(separator + ":refs/heads/".length));
  }),
  pack_object_count: (value) => decimalWithin(value, 0, GIT_PACK_OBJECT_COUNT_MAX),
  receive_keep_marker: (value) => {
    const match = /^receive-pack ([1-9][0-9]*) on ([A-Za-z0-9][A-Za-z0-9.-]{0,254})$/u.exec(value);
    return match !== null && decimalWithin(match[1] as string, 1, 2147483647);
  },
  ssh_target: (value) => SSH_TARGET.test(value) && !value.includes(".."),
  ssh_port: (value) => decimalWithin(value, 1, 65535),
  ssh_receive_pack_command: (value) => {
    const match = /^git-receive-pack '([^']+)'$/u.exec(value);
    return match !== null && isSafeSshRepositoryPath(match[1] as string);
  },
  candidate_tree_oid: parses(parseLowerHexSha1),
  parent_commit_oid: parses(parseLowerHexSha1),
};

export type GitArgSlotValuesV1 = Readonly<Partial<Record<GitArgSlotV1, string>>>;

/**
 * Expands one compiled argv alternative into the literal array a one-shot
 * permit binds. A value that cannot populate its slot refuses here, before any
 * process exists; a bare slot value is never option-shaped.
 */
export function expandGitArgv(grammar: GitArgvGrammarV1, values: GitArgSlotValuesV1): readonly string[] {
  const parsed = parseArgvGrammar(grammar, "GitArgvGrammarV1");
  const slotValue = (slot: GitArgSlotV1): string => {
    const value = Object.hasOwn(values, slot) ? values[slot] : undefined;
    if (typeof value !== "string" || !ARG_SLOT_ADMISSION[slot](value)) refuse(`git_argv_slot_invalid: ${slot}`);
    return value;
  };
  return parsed.argv.map((token) => {
    if (token.kind === "literal") return token.value;
    const expanded =
      token.kind === "slot" ? slotValue(token.slot) : `${token.prefix}${slotValue(token.slot)}${token.suffix}`;
    if (token.kind === "slot" && expanded.startsWith("-")) refuse(`git_argv_slot_invalid: ${token.slot}`);
    try {
      return parseBoundedArg(expanded);
    } catch {
      return refuse(`git_argv_slot_invalid: ${token.slot}`);
    }
  });
}
