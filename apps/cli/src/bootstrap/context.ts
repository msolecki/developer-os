import type { BootstrapExecutor } from "./executor.js";
import type { PackagedReleaseSourceV1 } from "../update/packaged-release.js";

/** The only bootstrap authority projected onto the command-wide context. */
export type CliBootstrapContext =
  | {
      readonly state: "available";
      readonly executor: BootstrapExecutor;
      readonly packagedRelease: PackagedReleaseSourceV1;
    }
  | {
      readonly state: "unavailable_until_packaged_handoff";
    };
