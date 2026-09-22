import { HOOK_GUARD_KINDS as CORE_HOOK_GUARD_KINDS } from "@developer-os/core";
import { expect, it } from "vitest";

import { HOOK_GUARD_KINDS } from "./argv.js";

it("keeps the hook runtime's guard kinds identical to core's, in order", () => {
  expect(CORE_HOOK_GUARD_KINDS.length).toBeGreaterThan(0);
  expect([...HOOK_GUARD_KINDS]).toStrictEqual([...CORE_HOOK_GUARD_KINDS]);
});
