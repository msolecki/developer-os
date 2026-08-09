import { buildIndex } from "../indexes/index.js";
import type { IndexDocumentV1 } from "../indexes/index.js";
import { fixtureRequest } from "../indexes/testing.js";

const FROZEN = "2026-08-04T00:00:00.000Z";

let cached: IndexDocumentV1 | null = null;

/**
 * The `legacy-shape` index, built once. Retrieval is a pure function of the
 * document, so every test can share one — and building it per case would make
 * a search suite spend its time walking a filesystem.
 */
export async function indexFixture(): Promise<IndexDocumentV1> {
  cached ??= (await buildIndex(fixtureRequest(FROZEN))).index;
  return cached;
}
