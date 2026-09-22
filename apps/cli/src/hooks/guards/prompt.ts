import { constants, lstat, open } from "node:fs/promises";
import { join } from "node:path";

import { resolveProjectRoot } from "../project-root.js";
import type { HookVerbHandler } from "../registry.js";

export const MAX_SKILL_RULES_BYTES = 65_536;
const MAX_RULES = 200;
const MAX_KEYWORDS = 20;
const MAX_KEYWORD_LENGTH = 64;
const MAX_MATCHED_SKILLS = 3;
const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/u;

interface SkillRule {
  readonly skill: string;
  readonly keywords: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function parseSkillRules(text: string): readonly SkillRule[] | null {
  if (new TextEncoder().encode(text).byteLength > MAX_SKILL_RULES_BYTES) return null;
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(root) || !hasExactKeys(root, ["schemaVersion", "rules"]) || root.schemaVersion !== 1) return null;
  const rules = root.rules;
  if (!Array.isArray(rules) || rules.length > MAX_RULES) return null;
  const parsed: SkillRule[] = [];
  for (const rule of rules as unknown[]) {
    if (!isRecord(rule) || !hasExactKeys(rule, ["skill", "keywords"])) return null;
    const { skill, keywords } = rule;
    if (typeof skill !== "string" || !SKILL_NAME.test(skill)) return null;
    if (!Array.isArray(keywords) || keywords.length > MAX_KEYWORDS) return null;
    const words: string[] = [];
    for (const keyword of keywords as unknown[]) {
      if (typeof keyword !== "string" || keyword.length < 1 || keyword.length > MAX_KEYWORD_LENGTH) return null;
      words.push(keyword);
    }
    parsed.push({ skill, keywords: words });
  }
  return parsed;
}

async function readBounded(path: string): Promise<Uint8Array> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const buffer = new Uint8Array(MAX_SKILL_RULES_BYTES + 1);
    let filled = 0;
    while (filled < buffer.byteLength) {
      const { bytesRead } = await handle.read(buffer, filled, buffer.byteLength - filled, null);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    return buffer.subarray(0, filled);
  } finally {
    await handle.close();
  }
}

function fold(text: string): string {
  return text.normalize("NFC").toLowerCase();
}

export const guardPrompt: HookVerbHandler = async (payload, runtime) => {
  if (payload.prompt === null) return { kind: "allow" };
  const root = await resolveProjectRoot(runtime.cwd);
  const file = join(root, ".developer-os", "skill-rules.json");
  const invalid = { kind: "allow", note: `skill rules ignored: ${file} is invalid` } as const;
  try {
    if (!(await lstat(file)).isFile()) return invalid;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { kind: "allow" };
    return invalid;
  }
  let rules: readonly SkillRule[] | null;
  try {
    const bytes = await readBounded(file);
    if (bytes.byteLength > MAX_SKILL_RULES_BYTES) return invalid;
    rules = parseSkillRules(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return invalid;
  }
  if (rules === null) return invalid;
  const prompt = fold(payload.prompt);
  const skills: string[] = [];
  for (const rule of rules) {
    if (skills.length === MAX_MATCHED_SKILLS) break;
    if (!skills.includes(rule.skill) && rule.keywords.some((keyword) => prompt.includes(fold(keyword)))) {
      skills.push(rule.skill);
    }
  }
  if (skills.length === 0) return { kind: "allow" };
  return { kind: "context", text: `developer-os: relevant skills: ${skills.join(", ")}` };
};
