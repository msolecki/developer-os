/**
 * The scheduled gardener's pure half (NEW-134, spec §3.3 and §4): which notes
 * it tends, the prompt one isolated agent call reads, and the validation that
 * decides which proposals may reach quarantine. Nothing here touches a
 * filesystem, a process or a clock.
 */
export { buildGardenPrompt, GARDEN_BUNDLE_MAX_BYTES, GARDEN_MAX_CANDIDATES } from "./bundle.js";
export { GARDEN_MAX_PROPOSALS, GARDEN_NOTE_MAX_BYTES, parseGardenResponse } from "./proposal.js";
export type { GardenProposalKindV1, GardenProposalV1 } from "./proposal.js";
export {
  GARDEN_GAP_MIN_NOTES,
  GARDEN_MAX_GAPS,
  GARDEN_MAX_ISOLATED,
  selectGardenTargets,
} from "./select.js";
export type { GardenTargetsV1 } from "./select.js";
export {
  GARDEN_HUB_MIN_LINKS,
  GARDEN_RELATED_MAX_LINKS,
  GARDEN_RELATED_MIN_LINKS,
  validateGardenResponse,
} from "./validate.js";
export type { GardenRejectCodeV1, GardenValidationInputV1, GardenValidationV1 } from "./validate.js";
