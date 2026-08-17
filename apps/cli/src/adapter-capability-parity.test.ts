import { describe, expect, it } from "vitest";
import {
  CLAUDE_CAPABILITY_KEYS,
  CLAUDE_NOT_USED_KEYS,
} from "@developer-os/adapter-claude";
import {
  CODEX_CAPABILITY_KEYS,
  CODEX_NOT_USED_KEYS,
} from "@developer-os/adapter-codex";

/**
 * Both adapters' `versions.ts` carry prose saying their capability key list
 * is deliberately identical to the other's, because DOS-P6 consumes both and
 * two vocabularies would make its contract a translation layer. Nothing
 * checked that claim — the two adapters are peers that may never import one
 * another (spec §1), so neither package can assert it about itself. This
 * test lives here, in `apps/cli`, because this app is the one place both
 * adapters are legally visible at once; it is the only place the assertion
 * can be written at all.
 */
describe("the two adapters' capability key lists", () => {
  it("are identical, in order", () => {
    expect([...CODEX_CAPABILITY_KEYS]).toEqual([...CLAUDE_CAPABILITY_KEYS]);
  });

  /**
   * The same assertion over the `not-used` lists, and for a sharper reason:
   * which surfaces this product uses is one product decision, not two vendor
   * ones. Two adapters that disagree about it produce one `doctor` report that
   * means two different things depending on which half you read.
   */
  it("agree on which surfaces this product does not use", () => {
    expect([...CODEX_NOT_USED_KEYS]).toEqual([...CLAUDE_NOT_USED_KEYS]);
  });
});
