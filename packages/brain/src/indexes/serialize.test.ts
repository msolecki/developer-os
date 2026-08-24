import { describe, expect, it } from "vitest";

import { buildIndex } from "./build.js";
import { serializeGraph, serializeIndex } from "./serialize.js";
import { fixtureRequest } from "./testing.js";

const FROZEN = "2026-08-04T00:00:00.000Z";

describe("serialization", () => {
  it("ends with exactly one newline and contains no carriage return", async () => {
    const { index, graph } = await buildIndex(fixtureRequest(FROZEN));
    for (const text of [serializeIndex(index), serializeGraph(graph)]) {
      expect(text.endsWith("\n")).toBe(true);
      expect(text.endsWith("\n\n")).toBe(false);
      expect(text).not.toContain("\r");
    }
  });

  it("round-trips through JSON.parse byte for byte", async () => {
    const { index, graph } = await buildIndex(fixtureRequest(FROZEN));

    const indexText = serializeIndex(index);
    expect(serializeIndex(JSON.parse(indexText) as typeof index)).toBe(indexText);

    const graphText = serializeGraph(graph);
    expect(serializeGraph(JSON.parse(graphText) as typeof graph)).toBe(graphText);
  });

  it("indents with two spaces", async () => {
    const { index } = await buildIndex(fixtureRequest(FROZEN));
    expect(serializeIndex(index)).toContain('\n  "schemaVersion": 1,');
  });

  it("emits generatedAt exactly once per artifact", async () => {
    /** Brain architecture former §6.3's drift canonicalization replaces one occurrence per file. */
    const { index, graph } = await buildIndex(fixtureRequest(FROZEN));
    for (const text of [serializeIndex(index), serializeGraph(graph)]) {
      expect(text.match(/"generatedAt":/gu)).toHaveLength(1);
    }
  });

  it("puts schemaVersion first, so a reader can dispatch before parsing the rest", async () => {
    const { index, graph } = await buildIndex(fixtureRequest(FROZEN));
    for (const text of [serializeIndex(index), serializeGraph(graph)]) {
      expect(text.indexOf('"schemaVersion"')).toBeLessThan(
        text.indexOf('"generatedAt"'),
      );
    }
  });
});
