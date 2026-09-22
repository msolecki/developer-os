import { InstructionSourceInvalidError } from "@developer-os/core";

/**
 * `docs/architecture/codex-adapter.md` §15, "agent TOML key set" (Codex 0.155.1): `name`,
 * `description` and `developer_instructions` are required, and any unrecognised key drops the
 * whole file without a refusal. So exactly these three keys are emitted; the Markdown source's
 * other frontmatter (`tools`, a Claude `model`) has no Codex meaning and is not carried.
 */
export const AGENT_TOML_KEYS = ["name", "description", "developer_instructions"] as const;

// TOML basic strings forbid raw U+007F; JSON.stringify escapes every other character TOML
// requires escaped, with escapes TOML shares (`\n`, `\"`, `\\`, `\uXXXX`).
function tomlString(value: string): string {
  return JSON.stringify(value).replaceAll("\u007f", "\\u007F");
}

function scalar(raw: string): string | null {
  const value = raw.trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    const inner = value.slice(1, -1);
    return inner.includes('"') || inner.includes("\\") ? null : inner;
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    const inner = value.slice(1, -1);
    return inner.replaceAll("''", "").includes("'") ? null : inner.replaceAll("''", "'");
  }
  if (value.length === 0 || /^[-?:,[\]{}#&*!|>'"%@`]/u.test(value) || value.includes(" #") || value.includes(": ")) {
    return null;
  }
  return value;
}

/**
 * A Claude-style agent (`---` frontmatter with a one-line `description:`, then the prompt body)
 * as a Codex role file. The role is named `developer-os-<id>`, the file name Codex ignores.
 */
export function renderAgentToml(markdown: string, id: string): string {
  const path = `agents/${id}.md`;
  const lines = markdown.split("\n");
  if (lines[0] !== "---") throw new InstructionSourceInvalidError(path, 1);
  const close = lines.indexOf("---", 1);
  if (close === -1) throw new InstructionSourceInvalidError(path, 1);

  let description: string | null = null;
  for (let index = 1; index < close; index += 1) {
    const line = lines[index] ?? "";
    if (!line.startsWith("description:")) continue;
    if (description !== null) throw new InstructionSourceInvalidError(path, index + 1);
    description = scalar(line.slice("description:".length));
    if (description === null) throw new InstructionSourceInvalidError(path, index + 1);
  }
  if (description === null) throw new InstructionSourceInvalidError(path, 1);

  const instructions = lines.slice(close + 1).join("\n").replace(/^\n+/u, "");
  if (instructions.trim().length === 0) throw new InstructionSourceInvalidError(path, close + 1);

  return [
    `name = ${tomlString(`developer-os-${id}`)}`,
    `description = ${tomlString(description)}`,
    `developer_instructions = ${tomlString(instructions)}`,
    "",
  ].join("\n");
}
