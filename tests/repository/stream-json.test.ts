import { describe, expect, it } from "vitest";

import { assistantToolUses, drivesCli } from "../helpers/stream-json.js";

const line = (content: unknown[]): string => JSON.stringify({ type: "assistant", message: { content } });

describe("the stream-json reading the vendor brain-workflow case relies on", () => {
  it("finds the Skill and the developer-os Bash call in a real-shaped transcript", () => {
    const stdout = [
      line([{ type: "tool_use", name: "Skill", input: { skill: "developer-os:developer-os-brain-enhance" } }]),
      "not json",
      line([{ type: "tool_use", name: "Bash", input: { command: "developer-os brain capture --json" } }]),
    ].join("\n");
    expect(drivesCli(assistantToolUses(stdout), "developer-os-brain-enhance")).toStrictEqual({ skill: true, cli: true });
  });

  it("finds nothing in a reply that only repeats the path from the prompt", () => {
    const stdout = line([{ type: "text", text: "DEV/example-knowledge-note.md" }]);
    expect(drivesCli(assistantToolUses(stdout), "developer-os-brain-enhance")).toStrictEqual({ skill: false, cli: false });
  });

  it("does not count a Read or a Bash that is not the product CLI", () => {
    const stdout = line([
      { type: "tool_use", name: "Read", input: { file_path: "DEV/example-knowledge-note.md" } },
      { type: "tool_use", name: "Bash", input: { command: "cat developer-os" } },
    ]);
    expect(drivesCli(assistantToolUses(stdout), "x")).toStrictEqual({ skill: false, cli: false });
  });
});
