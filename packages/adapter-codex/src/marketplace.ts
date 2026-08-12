import { posix } from "node:path";
import type { RenderedArtifact } from "@developer-os/workflow-schema";
import { MARKETPLACE_RELATIVE_PATH, PLUGIN_NAME, PLUGIN_TREE_SEGMENTS } from "./plugin.js";

export const MARKETPLACE_NAME = "developer-os";

export interface MarketplaceContext {
  readonly home: string;
}

/**
 * The one artifact in this adapter carrying a real absolute path. Every other
 * `RenderedArtifact` this adapter produces is relative, resolved by the
 * installer against a root it is given; this one is a marketplace document
 * Codex's own CLI reads from disk, and `source.path` is how Codex finds the
 * plugin it names — so a relative `home` would resolve against whatever
 * directory Codex happens to run in, not the machine that generated the file.
 */
export function renderMarketplace(context: MarketplaceContext): RenderedArtifact {
  if (!posix.isAbsolute(context.home)) {
    throw new Error(`refusing to render a marketplace document for a non-absolute home: ${context.home}`);
  }
  return {
    path: MARKETPLACE_RELATIVE_PATH,
    contents: `${JSON.stringify(
      {
        name: MARKETPLACE_NAME,
        plugins: [
          {
            name: PLUGIN_NAME,
            source: {
              source: "local",
              path: posix.join(context.home, ...PLUGIN_TREE_SEGMENTS),
            },
          },
        ],
      },
      null,
      2,
    )}\n`,
  };
}
