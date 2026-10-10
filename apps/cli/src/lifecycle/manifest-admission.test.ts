import { resolveRuntimePaths } from "@developer-os/core";
import { describe, expect, it } from "vitest";

import { manifestAdmission } from "../commands/doctor.js";
import { resolveVendorHomes } from "../instructions/vendor-homes.js";
import { manifestAdmissionFor } from "./manifest-admission.js";

// AUD-015 review: a decomposed home is not a CanonicalAbsolutePathV1, yet `status` and `doctor` build
// this admission for every manifest read, V1 included (which ignores it). Parsing here would throw them out.
describe("manifest admission on a decomposed (NFD) product home", () => {
  const userHome = "/Users/test";
  const paths = resolveRuntimePaths({ HOME: userHome, DEVELOPER_OS_HOME: "/Users/test/José" });
  const homes = resolveVendorHomes({}, userHome, paths.home);

  it("keeps the decomposed spelling and builds both admissions without throwing", () => {
    expect(paths.home).toBe("/Users/test/José");
    expect(manifestAdmissionFor(paths, [], homes).sourceRoot).toBe(paths.home);
    expect(manifestAdmission(paths, homes).sourceRoot).toBe(paths.home);
  });
});
