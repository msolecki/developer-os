/**
 * Redaction gate for the default instruction tree (`foundation.md` §12.1). Findings carry a path, a
 * line and a rule name only, never the matched text, so the report is safe to paste.
 *
 * `node tests/dist/tools/scan-instruction-defaults.js [--patterns <file>]` scans the
 * checkout's `instructions/` and `templates/project/`, and prints paths relative to the checkout. The patterns file holds one regular expression per
 * non-empty line and lives outside the repository; its findings are named by line
 * number (`extra:<n>`) so the report never echoes a private pattern.
 */
import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import process, { argv, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { createRedactor } from "@developer-os/security";

export interface InstructionFinding {
  readonly path: string;
  readonly line: number;
  readonly rule: string;
}

const FILE_CAP_BYTES = 256 * 1024;
const HOSTS_FILE = join("tests", "repository", "instruction-hosts.json");
/** Every repository directory whose files ship as default instructions. */
export const INSTRUCTION_SCAN_ROOTS: readonly string[] = ["instructions", "templates/project"];
const SOURCE_PREFIX = ["DEVELOPER", "OS", "SOURCE", ""].join("_");

const LINE_RULES: readonly { readonly rule: string; readonly expression: RegExp }[] = [
  { rule: "home-path", expression: /(?<![\w.:/-])\/(?:Users|home)\//u },
  {
    rule: "home-relative-path",
    expression: /~\/(?!\.(?:claude|codex|developer-os)(?![\w.-]))/u,
  },
  {
    rule: "email",
    expression: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/u,
  },
  { rule: "source-variable", expression: new RegExp(SOURCE_PREFIX, "u") },
  {
    rule: "legacy-runtime",
    expression: /docs\/superpowers\/plans\/legacy-runtime(?![\w.-])/u,
  },
];

const URL_EXPRESSION = /\b[a-z][a-z0-9+.-]*:\/\/([^/\s?#)>\]"'`]+)/giu;

function urlHost(authority: string): string {
  const afterUser = authority.slice(authority.lastIndexOf("@") + 1);
  return afterUser.replace(/:\d*$/u, "").toLowerCase();
}

function repositoryRoot(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(directory, HOSTS_FILE))) {
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`no ancestor of this module contains ${HOSTS_FILE}`);
    }
    directory = parent;
  }
  return directory;
}

export function loadInstructionHosts(): readonly string[] {
  const value: unknown = JSON.parse(
    readFileSync(join(repositoryRoot(), HOSTS_FILE), "utf8"),
  );
  if (!Array.isArray(value) || !value.every((host) => typeof host === "string")) {
    throw new Error(`${HOSTS_FILE} must be a JSON array of host names`);
  }
  return value.map((host) => host.toLowerCase());
}

type Entry =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "irregular"; readonly path: string };

function walk(root: string, relative: string, out: Entry[]): void {
  for (const dirent of readdirSync(join(root, relative), { withFileTypes: true })) {
    const path = relative === "" ? dirent.name : `${relative}/${dirent.name}`;
    if (dirent.isDirectory()) walk(root, path, out);
    else if (dirent.isFile()) out.push({ kind: "file", path });
    else out.push({ kind: "irregular", path });
  }
}

function entries(root: string): readonly Entry[] {
  const out: Entry[] = [];
  walk(root, "", out);
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Every regular file under `root`, relative and sorted; symlinks are never followed. */
export function listInstructionFiles(root: string): readonly string[] {
  return entries(root)
    .filter((entry) => entry.kind === "file")
    .map((entry) => entry.path);
}

function readBounded(path: string): Buffer | null {
  const descriptor = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(FILE_CAP_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (read === 0) break;
      length += read;
    }
    return length > FILE_CAP_BYTES ? null : buffer.subarray(0, length);
  } finally {
    closeSync(descriptor);
  }
}

export function scanInstructionDefaults(
  root: string,
  extraPatterns: readonly RegExp[],
  hosts: readonly string[] = loadInstructionHosts(),
): readonly InstructionFinding[] {
  const redact = createRedactor(randomBytes(32));
  const allowedHosts = new Set(hosts.map((host) => host.toLowerCase()));
  const extra = extraPatterns.map(
    (pattern) => new RegExp(pattern.source, pattern.flags.replace(/[gy]/gu, "")),
  );
  const findings: InstructionFinding[] = [];

  for (const entry of entries(root)) {
    const add = (line: number, rule: string): void => {
      findings.push({ path: entry.path, line, rule });
    };
    if (entry.kind === "irregular") {
      add(1, "not-regular-file");
      continue;
    }
    const bytes = readBounded(join(root, entry.path));
    if (bytes === null) {
      add(1, "file-too-large");
      continue;
    }
    const text = bytes.toString("utf8");
    const lines = text.split("\n");
    const lineSecretClasses = new Set<string>();

    lines.forEach((content, index) => {
      const line = index + 1;
      for (const finding of redact(content).findings) {
        lineSecretClasses.add(finding.class);
        add(line, `secret:${finding.class}`);
      }
      for (const { rule, expression } of LINE_RULES) {
        if (expression.test(content)) add(line, rule);
      }
      for (const match of content.matchAll(URL_EXPRESSION)) {
        if (!allowedHosts.has(urlHost(match[1] ?? ""))) add(line, "url");
      }
      extra.forEach((expression, patternIndex) => {
        if (expression.test(content)) add(line, `extra:${String(patternIndex + 1)}`);
      });
    });

    // ponytail: a secret spanning lines (a PEM block) is invisible to the per-line pass, so
    // the whole file is redacted once more and any class the lines missed is reported at
    // the first PEM header; exact per-secret lines would need offsets the redactor does not return.
    const pemLine = lines.findIndex((content) => content.includes("-----BEGIN ")) + 1;
    for (const secretClass of new Set(redact(text).findings.map((f) => f.class))) {
      if (!lineSecretClasses.has(secretClass)) add(Math.max(pemLine, 1), `secret:${secretClass}`);
    }
  }

  return findings.sort(
    (a, b) =>
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
      a.line - b.line ||
      (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0),
  );
}

export function parsePatternFile(text: string): readonly RegExp[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => new RegExp(line, "u"));
}

function isEntryPoint(entry: string | undefined): boolean {
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

/**
 * The CLI body: every root's findings and its scanned-file count. A root with no file fails,
 * because a gate that enumerated nothing proves nothing. Returns the exit code.
 */
export function runInstructionScan(
  repository: string,
  roots: readonly string[],
  extra: readonly RegExp[],
  write: (text: string) => void,
): number {
  let code = 0;
  const findings: InstructionFinding[] = [];
  for (const root of roots) {
    const count = listInstructionFiles(join(repository, root)).length;
    write(`${root}: ${String(count)} files scanned\n`);
    if (count === 0) code = 1;
    findings.push(
      ...scanInstructionDefaults(join(repository, root), extra).map((finding) => ({
        ...finding,
        path: `${root}/${finding.path}`,
      })),
    );
  }
  for (const finding of findings) {
    write(`${finding.path}:${String(finding.line)} ${finding.rule}\n`);
  }
  write(`${String(findings.length)} findings\n`);
  return findings.length > 0 ? 1 : code;
}

if (isEntryPoint(argv[1])) {
  const flag = argv.indexOf("--patterns");
  const patternFile = flag >= 0 ? argv[flag + 1] : undefined;
  if (flag >= 0 && patternFile === undefined) {
    throw new Error("--patterns needs a file path");
  }
  const extra =
    patternFile === undefined ? [] : parsePatternFile(readFileSync(resolve(patternFile), "utf8"));
  process.exitCode = runInstructionScan(repositoryRoot(), INSTRUCTION_SCAN_ROOTS, extra, (text) => stdout.write(text));
}
