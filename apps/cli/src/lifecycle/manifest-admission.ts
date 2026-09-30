/**
 * The one confined owner-path admission policy every V2 manifest read on the CLI passes through:
 * `uninstall` and the mutation gate both build it here. It lives in neither of them because
 * `context.ts` → `lifecycle/mutation-gate.ts` → `commands/uninstall.ts` → `context.ts` would be a
 * runtime import cycle through the composition root (NEW-96).
 */
import type {
  CanonicalAbsolutePathV1,
  ManifestAdmissionContextV1,
  RuntimePaths,
} from "@developer-os/core";

import { createCanonicalPathEvidence, createOwnerPathAdmission } from "../bootstrap/admission.js";
import type { VendorHomesV1 } from "../instructions/vendor-homes.js";

/**
 * `uninstall` has no live install request the way `BootstrapExecutor` does —
 * it is reading a manifest a past, possibly unrelated `init` wrote. The roots
 * authoritative for that read are the ones `init` itself would have used to
 * build this exact manifest: the product home and the Brain, both resolved
 * fresh from the current environment and configuration. That is also, not
 * coincidentally, the same pair `runUninstall` builds `ownedRoots` and
 * `excludedRoots` from — reading the manifest and removing from it are
 * bounded by the same authority. Confining here mirrors
 * `BootstrapExecutor.manifestAdmission` (`apps/cli/src/bootstrap/executor.ts`)
 * instead of admitting every path irrespective of owner, which is what an
 * identity `admitOwnerPath` did by accident (NEW-51). Removal itself stays
 * independently bounded by `isRemovableAt` regardless of what this predicate
 * decides, so a manifest whose Brain moved out from under it refuses to
 * *parse* rather than silently widening what a stale record can direct.
 *
 * `sourceRoot` is `productHome`, not a package root, and that is a deliberate
 * choice, not the accidental one this predicate used to carry alongside its
 * identity `admitOwnerPath`: a bare on-disk manifest records only a
 * `VaultFreeRelativePathV1` string (e.g. `"templates/file"`), never the
 * package root it was resolved against, so — unlike `BootstrapExecutor`,
 * which holds the live packaged release's `packageRoot`, and unlike
 * `report.ts`'s `exactV2Handoff`, which can recover one from the retained
 * plan's own `guarded_package_file` payload — there is no root here to
 * recover a package identity from. `productHome` is the only root this
 * function can name with any honesty, matching `report.ts`'s own fallback
 * for the case where no such payload root exists.
 *
 * `refusedOwnerPaths` is populated, not thrown from, here: `admitOwnerPath`'s
 * contract is a value comparison the caller turns into a refusal
 * (`packages/core/src/manifest/v2.ts:31`), so this wrapper cannot itself
 * distinguish "confinement refused this artifact" from "the document never
 * got this far" — it can only record what it saw before `readOptional`
 * collapses every cause into one generic `ManifestStateError`. Whoever awaits
 * `readOptional` reads this array *after* the rejection to recover that
 * distinction.
 */
export function manifestAdmissionFor(
  paths: RuntimePaths,
  refusedOwnerPaths: string[],
  vendors: VendorHomesV1 | null = null,
): ManifestAdmissionContextV1 {
  const productHome = paths.home as CanonicalAbsolutePathV1;
  const brainPath = paths.brain as CanonicalAbsolutePathV1;
  const admitOwnerPath = createOwnerPathAdmission({ kind: "confined", roots: [productHome, brainPath], vendors });
  return {
    evidence: createCanonicalPathEvidence(),
    sourceRoot: productHome,
    backupRoot: paths.backupsDir as CanonicalAbsolutePathV1,
    admitOwnerPath: (owner, path, arm) => {
      const admitted = admitOwnerPath(owner, path, arm);
      if (admitted !== path) refusedOwnerPaths.push(path);
      return admitted;
    },
  };
}
