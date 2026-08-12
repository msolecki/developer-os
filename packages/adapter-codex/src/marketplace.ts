import { posix } from "node:path";
import type { RenderedArtifact } from "@developer-os/workflow-schema";
import { MARKETPLACE_RELATIVE_PATH, PLUGIN_NAME, PLUGIN_TREE_PREFIX } from "./plugin.js";

export const MARKETPLACE_NAME = "developer-os";

export interface MarketplaceContext {
  readonly home: string;
}

/**
 * `source.path` is **marketplace-root-relative, never absolute** — corrected
 * 2026-08-12 by Task 17 against the real 0.147.0 binary, which is the
 * opposite of what this file previously claimed. An absolute path here does
 * not error: the marketplace loads cleanly and the plugin entry is silently
 * dropped from both `codex plugin list --json`'s `available` and `installed`
 * arrays, and `codex plugin add developer-os@developer-os` then refuses with
 * `plugin \`developer-os\` was not found in marketplace \`developer-os\`` (exit
 * 1) — a real, reproducible install failure this test caught. A relative path
 * *without* a leading `./` (`plugins/developer-os`) fails identically; only
 * `./plugins/developer-os` — matching the vendor's own scaffolding tool and
 * its documented `./plugins/<plugin-name>` form — resolves. Confirmed by
 * running the CLI from a working directory outside the marketplace root
 * entirely, so resolution is against the marketplace root, never the
 * process's cwd — which is what `context.home` was defending against under
 * the old, disproven assumption.
 *
 * **Corrected again 2026-08-12, by the fresh-context review of Task 17:**
 * the marketplace root is **not** "the directory `marketplace.json` itself
 * lives in" — that directory is `.agents/plugins/`
 * (`MARKETPLACE_RELATIVE_PATH`), two levels below the root. The marketplace
 * root is the directory handed to `codex plugin marketplace add`, i.e.
 * `<product-home>/codex` — the directory *containing* `.agents/plugins/`.
 * `./plugins/developer-os` resolves against that directory; resolving it
 * against `.agents/plugins/` itself would look for
 * `.agents/plugins/plugins/developer-os`, which does not exist. Amends spec
 * §14.4, dated 2026-08-12.
 *
 * `context.home` is no longer read to build `path` — `PLUGIN_TREE_PREFIX` is
 * a fixed, marketplace-root-relative constant — but the parameter and its
 * absolute-path guard stay: every sibling context type in this adapter
 * (`InstallContext`) requires an absolute product home, and a caller
 * constructing both from the same value should not find one silently laxer
 * than the other.
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
              path: `./${PLUGIN_TREE_PREFIX}`,
            },
          },
        ],
      },
      null,
      2,
    )}\n`,
  };
}
