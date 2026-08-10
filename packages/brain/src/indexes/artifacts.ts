import type { BrainConfigV1 } from "@developer-os/core";

import type { IndexBuildResult } from "./build.js";
import { renderCatalog, renderVaultMap } from "./render.js";
import { serializeGraph, serializeIndex } from "./serialize.js";

export interface ArtifactPaths {
  readonly index: string;
  readonly graph: string;
  readonly vaultMap: string;
  readonly catalog: string;
}

export function artifactPaths(config: BrainConfigV1): ArtifactPaths {
  const dir = `${config.contentRoot.normalize("NFC")}/${config.indexesDir.normalize("NFC")}`;
  return {
    index: `${dir}/index.json`,
    graph: `${dir}/graph.json`,
    vaultMap: `${dir}/vault-map.md`,
    catalog: `${dir}/catalog.md`,
  };
}

/**
 * The one place the four artifacts are produced.
 *
 * There were two before this — `lint.ts` computing what a fresh build should
 * look like, and the lint test helper computing what a reindex would write —
 * and `BrainService.reindex` would have been the third. Three copies of "what
 * the vault should contain" is how drift detection ends up comparing against
 * something a real reindex would never have written, and nothing would have
 * failed: the helper's own docstring already claimed the two agreed, and
 * nothing enforced it.
 */
export function renderArtifacts(
  build: IndexBuildResult,
  config: BrainConfigV1,
): Readonly<Record<string, string>> {
  const paths = artifactPaths(config);
  return {
    [paths.index]: serializeIndex(build.index),
    [paths.graph]: serializeGraph(build.graph),
    [paths.vaultMap]: renderVaultMap(build.index),
    [paths.catalog]: renderCatalog(build.index),
  };
}
