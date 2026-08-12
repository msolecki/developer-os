import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import { MARKETPLACE_NAME, renderMarketplace } from "./marketplace.js";
import { MARKETPLACE_RELATIVE_PATH, PLUGIN_NAME } from "./plugin.js";

const home = "/synthetic/home/.developer-os";

describe("renderMarketplace", () => {
  it("is written at the path Codex reads, relative to the marketplace root", () => {
    expect(renderMarketplace({ home }).path).toBe(MARKETPLACE_RELATIVE_PATH);
  });

  it("describes one local plugin, at the path the installer actually writes", () => {
    const parsed = JSON.parse(renderMarketplace({ home }).contents) as {
      name: string;
      plugins: { name: string; source: { source: string; path: string } }[];
    };
    expect(parsed.name).toBe(MARKETPLACE_NAME);
    expect(parsed.plugins).toHaveLength(1);
    expect(parsed.plugins[0]?.name).toBe(PLUGIN_NAME);
    expect(parsed.plugins[0]?.source.source).toBe("local");
    expect(parsed.plugins[0]?.source.path).toBe(
      posix.join(home, "codex", "plugins", PLUGIN_NAME),
    );
  });

  /**
   * Spec §14.4 names the keys a marketplace document carries and does not
   * document the accepted *values* of `policy` or `category`. We emit only what
   * we can point at, and Task 17 amends §14.4 with whatever the real CLI
   * accepted — an invented enum value that a future version rejects is a
   * failure only the integration test would find.
   */
  it("emits only the keys spec §14.4 names, and invents no enum values", () => {
    const parsed = JSON.parse(renderMarketplace({ home }).contents) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["name", "plugins"]);
    const plugin = (parsed.plugins as Record<string, unknown>[])[0] ?? {};
    expect(Object.keys(plugin).sort()).toEqual(["name", "source"]);
  });

  it("refuses a relative home, because the path it writes must resolve anywhere", () => {
    expect(() => renderMarketplace({ home: "relative/home" })).toThrow(/absolute/iu);
  });

  it("is byte-identical across two renders", () => {
    expect(renderMarketplace({ home })).toEqual(renderMarketplace({ home }));
  });

  /**
   * Every other assertion in this file parses the JSON first, so the
   * serialization format itself was unpinned. This case pins the exact bytes:
   * two-space indentation and a trailing newline. A change to plain
   * JSON.stringify(value) would break this test and be caught immediately,
   * keeping diffs of the descriptor readable and its serialization stable.
   */
  it("serializes with 2-space indent and a trailing newline for stable diffs", () => {
    const { contents } = renderMarketplace({ home });
    expect(contents.startsWith("{\n  \"name\"")).toBe(true);
    expect(contents.endsWith("\n}\n")).toBe(true);
  });
});
