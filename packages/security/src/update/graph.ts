import { readFileSync } from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import { dirname, resolve } from "node:path";

/**
 * Spec 2 §2: the target planner is trusted release code whose capability absence is enforced
 * in its shipped graph, not by an OS sandbox. This enumerates the complete transitive compiled
 * graph of one entrypoint and classifies every reachable capability.
 */
export type PlannerCapabilityV1 =
  | "filesystem"
  | "network"
  | "process"
  | "environment"
  | "clock"
  | "randomness"
  | "native"
  | "worker"
  | "dynamic_import"
  | "unresolved";

export interface PlannerGraphFindingV1 {
  readonly module: string;
  readonly capability: PlannerCapabilityV1;
  readonly evidence: string;
}

export interface PlannerGraphV1 {
  readonly entrypoint: string;
  /** Every compiled module reached, sorted; empty only when the entrypoint itself is missing. */
  readonly modules: readonly string[];
  readonly builtins: readonly string[];
  readonly forbidden: readonly PlannerGraphFindingV1[];
}

export interface PlannerModuleScanV1 {
  readonly specifiers: readonly string[];
  readonly findings: readonly { readonly capability: PlannerCapabilityV1; readonly evidence: string }[];
}

/** Hashing is the one builtin capability the protocol needs; the rest carry no ambient authority. */
const ALLOWED_BUILTINS: ReadonlySet<string> = new Set(["assert", "assert/strict", "buffer", "crypto", "events", "string_decoder", "util"]);

const BUILTIN_CAPABILITIES: Readonly<Record<string, PlannerCapabilityV1>> = {
  fs: "filesystem",
  "fs/promises": "filesystem",
  path: "environment",
  "path/posix": "environment",
  "path/win32": "environment",
  net: "network",
  http: "network",
  https: "network",
  http2: "network",
  tls: "network",
  dgram: "network",
  dns: "network",
  "dns/promises": "network",
  child_process: "process",
  cluster: "process",
  os: "environment",
  process: "environment",
  tty: "environment",
  perf_hooks: "clock",
  timers: "clock",
  "timers/promises": "clock",
  worker_threads: "worker",
  module: "dynamic_import",
  vm: "dynamic_import",
  repl: "dynamic_import",
  v8: "native",
  wasi: "native",
};

/** Matched against code with every comment and literal body blanked. */
const IDENTIFIER_RULES: readonly (readonly [PlannerCapabilityV1, RegExp])[] = [
  ["environment", /(?<![.\w$])(?:process|globalThis|global)(?![\w$])/gu],
  ["clock", /(?<![.\w$])Date\s*\.\s*now(?![\w$])/gu],
  ["clock", /(?<![.\w$])new\s+Date\s*\(\s*\)/gu],
  ["clock", /(?<![.\w$])(?<!new\s+)Date\s*\(/gu],
  ["clock", /(?<![.\w$])(?:performance|setTimeout|setInterval|setImmediate)(?![\w$])/gu],
  ["randomness", /(?<![.\w$])Math\s*\.\s*random(?![\w$])/gu],
  ["randomness", /(?<![\w$])(?:randomBytes|randomUUID|randomInt|randomFill|randomFillSync|getRandomValues|generateKey|generateKeySync|generateKeyPair|generateKeyPairSync|generatePrime|generatePrimeSync|webcrypto)(?![\w$])/gu],
  ["network", /(?<![.\w$])(?:fetch|WebSocket|XMLHttpRequest|EventSource)(?![\w$])/gu],
  ["worker", /(?<![.\w$])(?:Worker|SharedWorker)(?![\w$])/gu],
  ["dynamic_import", /(?<![.\w$])import\s*\(/gu],
  ["dynamic_import", /(?<![.\w$])(?:require|eval)(?![\w$])/gu],
  ["dynamic_import", /(?<![.\w$])Function\s*\(/gu],
  ["filesystem", /(?<![.\w$])import\s*\.\s*meta(?![\w$])/gu],
  ["filesystem", /(?<![.\w$])(?:__dirname|__filename)(?![\w$])/gu],
];

const REGEX_PRECEDING_WORDS: ReadonlySet<string> = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);

interface StringLiteral {
  readonly start: number;
  readonly value: string;
}

/**
 * Blanks comments and literal bodies (keeping newlines and `${}` code) so identifier rules
 * cannot be satisfied or evaded by prose, and collects quoted literals for specifiers.
 *
 * ponytail: `/` is read as a regex after an operator, keyword, or opening token and as division
 * otherwise; that holds for tsc output. A hand-written module that breaks the heuristic needs a
 * real parser here.
 */
export function blankPlannerModule(source: string): { readonly code: string; readonly literals: readonly StringLiteral[] } {
  const out = source.split("");
  const literals: StringLiteral[] = [];
  const templateDepths: number[] = [];
  let braceDepth = 0;
  let last = "";
  let lastWord = "";
  const blank = (from: number, to: number): void => {
    for (let at = from; at < to; at += 1) if (out[at] !== "\n") out[at] = " ";
  };
  const regexAllowed = (): boolean => last === "" || "(,=:[!&|?{};+-*%<>~^".includes(last) || REGEX_PRECEDING_WORDS.has(lastWord);
  const scanTemplate = (start: number): number => {
    let at = start;
    while (at < source.length) {
      const character = source[at];
      if (character === "\\") at += 2;
      else if (character === "`") {
        blank(start, at);
        return at + 1;
      } else if (character === "$" && source[at + 1] === "{") {
        blank(start, at);
        templateDepths.push(braceDepth);
        braceDepth += 1;
        return at + 2;
      } else at += 1;
    }
    throw new Error("unterminated template literal");
  };

  let index = 0;
  while (index < source.length) {
    const character = source[index] as string;
    const next = source[index + 1];
    if (character === "/" && next === "/") {
      const end = source.indexOf("\n", index);
      const stop = end === -1 ? source.length : end;
      blank(index, stop);
      index = stop;
      continue;
    }
    if (character === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) throw new Error("unterminated comment");
      blank(index, end + 2);
      index = end + 2;
      continue;
    }
    if (character === "'" || character === '"') {
      let at = index + 1;
      while (at < source.length && source[at] !== character) {
        if (source[at] === "\n") throw new Error("unterminated string literal");
        at += source[at] === "\\" ? 2 : 1;
      }
      if (at >= source.length) throw new Error("unterminated string literal");
      literals.push({ start: index, value: source.slice(index + 1, at) });
      blank(index + 1, at);
      index = at + 1;
      last = character;
      lastWord = "";
      continue;
    }
    if (character === "`") {
      index = scanTemplate(index + 1);
      last = "`";
      lastWord = "";
      continue;
    }
    if (character === "}" && templateDepths.length > 0 && templateDepths[templateDepths.length - 1] === braceDepth - 1) {
      templateDepths.pop();
      braceDepth -= 1;
      index = scanTemplate(index + 1);
      last = "`";
      lastWord = "";
      continue;
    }
    if (character === "/" && regexAllowed()) {
      let at = index + 1;
      let inClass = false;
      while (at < source.length) {
        const current = source[at];
        if (current === "\n") throw new Error("unterminated regular expression");
        if (current === "\\") at += 2;
        else {
          if (current === "[") inClass = true;
          else if (current === "]") inClass = false;
          else if (current === "/" && !inClass) break;
          at += 1;
        }
      }
      blank(index + 1, at);
      index = at + 1;
      while (index < source.length && /[\w$]/u.test(source[index] as string)) index += 1;
      last = "/";
      lastWord = "";
      continue;
    }
    if (character === "{") braceDepth += 1;
    if (character === "}") braceDepth -= 1;
    if (/[\w$]/u.test(character)) {
      let end = index;
      while (end < source.length && /[\w$]/u.test(source[end] as string)) end += 1;
      lastWord = source.slice(index, end);
      last = source[end - 1] as string;
      index = end;
      continue;
    }
    if (!/\s/u.test(character)) {
      last = character;
      lastWord = "";
    }
    index += 1;
  }
  return { code: out.join(""), literals };
}

/** Static specifiers and identifier-level capability evidence for one compiled module. */
export function scanPlannerModule(source: string): PlannerModuleScanV1 {
  const { code, literals } = blankPlannerModule(source);
  const specifiers: string[] = [];
  for (const literal of literals) {
    if (/(?:^|[^.\w$])(?:from|import)\s*$/u.test(code.slice(Math.max(0, literal.start - 64), literal.start))) specifiers.push(literal.value);
  }
  const findings: { capability: PlannerCapabilityV1; evidence: string }[] = [];
  for (const [capability, rule] of IDENTIFIER_RULES) {
    for (const match of code.matchAll(rule)) findings.push({ capability, evidence: match[0].replace(/\s+/gu, " ") });
  }
  return { specifiers, findings };
}

function readModule(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function resolveSpecifier(specifier: string, from: string): string | null {
  if (specifier.startsWith("./") || specifier.startsWith("../")) return resolve(dirname(from), specifier);
  try {
    return createRequire(from).resolve(specifier);
  } catch {
    return null;
  }
}

/**
 * Enumerates the complete transitive graph. The walk is total: a relative module that cannot be
 * read, a package that does not resolve, a non-JavaScript target, and an unclassified builtin
 * are each findings, never silently skipped.
 */
export function inspectPlannerGraph(entrypoint: string): PlannerGraphV1 {
  const modules = new Set<string>();
  const builtins = new Set<string>();
  const forbidden: PlannerGraphFindingV1[] = [];
  const queue = [resolve(entrypoint)];
  while (queue.length > 0) {
    const path = queue.pop() as string;
    if (modules.has(path)) continue;
    const source = readModule(path);
    if (source === null) {
      forbidden.push({ module: path, capability: "unresolved", evidence: "module is not readable" });
      continue;
    }
    modules.add(path);
    let scan: PlannerModuleScanV1;
    try {
      scan = scanPlannerModule(source);
    } catch {
      forbidden.push({ module: path, capability: "unresolved", evidence: "module is not lexable" });
      continue;
    }
    for (const finding of scan.findings) forbidden.push({ module: path, ...finding });
    for (const specifier of scan.specifiers) {
      if (isBuiltin(specifier)) {
        const name = specifier.replace(/^node:/u, "");
        builtins.add(name);
        if (!ALLOWED_BUILTINS.has(name)) forbidden.push({ module: path, capability: BUILTIN_CAPABILITIES[name] ?? "unresolved", evidence: specifier });
        continue;
      }
      const target = resolveSpecifier(specifier, path);
      if (target === null) forbidden.push({ module: path, capability: "unresolved", evidence: specifier });
      else if (target.endsWith(".node")) forbidden.push({ module: path, capability: "native", evidence: specifier });
      else if (!target.endsWith(".js") && !target.endsWith(".mjs")) forbidden.push({ module: path, capability: "unresolved", evidence: specifier });
      else queue.push(target);
    }
  }
  const byText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);
  return {
    entrypoint: resolve(entrypoint),
    modules: [...modules].sort(byText),
    builtins: [...builtins].sort(byText),
    forbidden: forbidden.sort((left, right) => byText(left.module, right.module) || byText(left.capability, right.capability) || byText(left.evidence, right.evidence)),
  };
}
