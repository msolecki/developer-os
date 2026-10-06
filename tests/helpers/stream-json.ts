/** One `tool_use` block an assistant message carried in a `claude --output-format stream-json` run. */
export interface ToolUse {
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
}

/**
 * The assistant `tool_use` blocks of a stream-json transcript. A reply that merely repeats a path
 * from the prompt has none, which is what the vendor brain-workflow case must not pass on (TEST-4).
 * Lines that are not JSON are skipped: `--verbose` interleaves nothing else, but a truncated tail
 * must not hide the blocks before it.
 */
export function assistantToolUses(stdout: string): readonly ToolUse[] {
  const uses: ToolUse[] = [];
  for (const line of stdout.split("\n")) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const message = (event as { type?: unknown; message?: { content?: unknown } } | null);
    if (message?.type !== "assistant" || !Array.isArray(message.message?.content)) continue;
    for (const block of message.message.content as readonly Record<string, unknown>[]) {
      if (block.type === "tool_use" && typeof block.name === "string") {
        uses.push({ name: block.name, input: (block.input ?? {}) as Record<string, unknown> });
      }
    }
  }
  return uses;
}

/** The Skill invocation of `skill` (plugin-namespaced or bare) and a Bash command starting `developer-os`. */
export function drivesCli(uses: readonly ToolUse[], skill: string): { skill: boolean; cli: boolean } {
  return {
    skill: uses.some(
      (use) => use.name === "Skill" && typeof use.input.skill === "string" && use.input.skill.endsWith(skill),
    ),
    cli: uses.some(
      (use) => use.name === "Bash" && typeof use.input.command === "string" && /^\s*developer-os\b/u.test(use.input.command),
    ),
  };
}
