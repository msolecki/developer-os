import {
  EXIT_CODES,
  type AutomationConfigV1,
  type CanonicalAbsolutePathV1,
  type LowerHexSha256,
  type NormalizedScheduleV1,
  type ScheduledJobIdV1,
} from "@developer-os/core";

declare const launchdGuiDomainV1: unique symbol;
declare const launchdScheduledProductHomeV1: unique symbol;
declare const boundedCanonicalPlistXmlV1: unique symbol;

/** Refused launchd input: a schedule flag, a registry lookup, or a plist/preview value outside §5. */
export class LaunchdInputError extends Error {
  readonly code = EXIT_CODES.invalidInput;

  constructor(message: string) {
    super(message);
    this.name = "LaunchdInputError";
  }
}

export type ClosedLaunchdBaseLabelV1 =
  | "com.developer-os.brain-reindex"
  | "com.developer-os.brain-lint"
  | "com.developer-os.doctor"
  | "com.developer-os.git-sync"
  | "com.developer-os.brain-garden"
  | "com.developer-os.brain-pulse";

/** `gui/<effective uid>`: the one launchd domain Developer OS may name. */
export type LaunchdGuiDomainV1 = `gui/${number}` & { readonly [launchdGuiDomainV1]: true };

export type LaunchdGenerationV1 = LowerHexSha256;

export type GeneratedLaunchdLabelV1 = `${ClosedLaunchdBaseLabelV1}.g.${string}`;

export type LaunchdScheduledProductHomeV1 = CanonicalAbsolutePathV1 & {
  readonly [launchdScheduledProductHomeV1]: true;
};

export type LaunchdObservedLabelV1 = ClosedLaunchdBaseLabelV1 | GeneratedLaunchdLabelV1;

export type LaunchdObservedServiceTargetV1 = `${LaunchdGuiDomainV1}/${LaunchdObservedLabelV1}`;

export type LaunchdGeneratedServiceTargetV1 = `${LaunchdGuiDomainV1}/${GeneratedLaunchdLabelV1}`;

/**
 * NEW-144: `[<absolute Node>, <entrypoint>, automation, …]`. The entrypoint is a mode-0600 ES module
 * with no shebang, so launchd cannot exec it (EX_CONFIG, 78); argv[0] must be the Node binary.
 */
export type LaunchdBaseArgvV1 = readonly [
  CanonicalAbsolutePathV1,
  CanonicalAbsolutePathV1,
  "automation",
  "run",
  ScheduledJobIdV1,
  "--scheduled",
  "--product-home",
  LaunchdScheduledProductHomeV1,
];

export type LaunchdProgramArgumentsV1 = readonly [
  ...LaunchdBaseArgvV1,
  "--generation",
  LaunchdGenerationV1,
];

/**
 * The nine-argument shape every plist written before NEW-144 carries (argv[0] the entrypoint).
 * Read-only: it still parses so `automation enable --apply` can replace it and disable or
 * uninstall can remove it; nothing emits it.
 */
export type LaunchdLegacyProgramArgumentsV1 = LaunchdProgramArgumentsV1 extends readonly [CanonicalAbsolutePathV1, ...infer Rest] ? readonly [...Rest] : never;

export interface LaunchdGenerationProjectionV1 {
  readonly job: ScheduledJobIdV1;
  readonly baseLabel: ClosedLaunchdBaseLabelV1;
  readonly domain: LaunchdGuiDomainV1;
  readonly schedule: NormalizedScheduleV1;
  readonly productHome: LaunchdScheduledProductHomeV1;
  readonly plistPath: CanonicalAbsolutePathV1;
  readonly executablePath: CanonicalAbsolutePathV1;
  readonly baseArgv: LaunchdBaseArgvV1;
  readonly logPath: CanonicalAbsolutePathV1;
  readonly statusPath: CanonicalAbsolutePathV1;
}

export type LaunchdLiveStateV1 =
  | { readonly state: "unloaded" }
  | {
      readonly state: "loaded";
      readonly label: GeneratedLaunchdLabelV1;
      readonly generation: LaunchdGenerationV1;
    };

export type LaunchdCalendarIntervalV1 =
  | { readonly Minute: number }
  | { readonly Hour: number; readonly Minute: number }
  | { readonly Weekday: number; readonly Hour: number; readonly Minute: number };

export interface LaunchdPlistDictionaryV1 {
  readonly Label: GeneratedLaunchdLabelV1;
  readonly ProgramArguments: LaunchdProgramArgumentsV1 | LaunchdLegacyProgramArgumentsV1;
  readonly StartCalendarInterval: LaunchdCalendarIntervalV1;
  readonly StandardOutPath: "/dev/null";
  readonly StandardErrorPath: "/dev/null";
}

/** The exact §5.3 serialization: 1..1048576 UTF-8 bytes, no NUL, exactly one trailing LF. */
export type BoundedCanonicalPlistXmlV1 = string & { readonly [boundedCanonicalPlistXmlV1]: true };

export interface LaunchdJobDefinitionV1 {
  readonly id: ScheduledJobIdV1;
  readonly baseLabel: ClosedLaunchdBaseLabelV1;
  readonly plistFileName: `${ClosedLaunchdBaseLabelV1}.plist`;
  readonly requiresGitActivation: boolean;
  readonly maySpawnVendor: boolean;
}

export type LaunchdPlanOperationV1 = "install" | "replace" | "keep" | "remove";

export interface LaunchdPlanPreviewEntryV1 {
  readonly operation: LaunchdPlanOperationV1;
  readonly job: ScheduledJobIdV1;
  readonly baseLabel: ClosedLaunchdBaseLabelV1;
  readonly domain: LaunchdGuiDomainV1;
  readonly productHome: LaunchdScheduledProductHomeV1;
  readonly schedule: NormalizedScheduleV1 | null;
  readonly plistPath: CanonicalAbsolutePathV1;
  readonly plistBytes: BoundedCanonicalPlistXmlV1 | null;
  readonly executablePath: CanonicalAbsolutePathV1;
  readonly baseArgv: LaunchdBaseArgvV1;
  readonly logPath: CanonicalAbsolutePathV1;
  readonly statusPath: CanonicalAbsolutePathV1;
  readonly generationProjection: LaunchdGenerationProjectionV1 | null;
  readonly generation: LaunchdGenerationV1 | null;
  readonly generatedLabel: GeneratedLaunchdLabelV1 | null;
  readonly beforeFileHash: LowerHexSha256 | null;
  readonly beforeLiveState: LaunchdLiveStateV1;
  readonly priorStateFingerprint: LowerHexSha256;
}

export interface LaunchdPlanPreviewV1 {
  readonly schemaVersion: 1;
  readonly observationProcessTableHash: LowerHexSha256;
  readonly mutationProcessTableTemplateHash: LowerHexSha256;
  readonly entries: readonly LaunchdPlanPreviewEntryV1[];
}

/**
 * What the caller already observed for one job. `beforeGeneration` comes from parsing the
 * retained, manifest-bound plist; it is null exactly when `beforeFileHash` is null.
 */
export interface LaunchdPriorJobStateV1 {
  readonly beforeFileHash: LowerHexSha256 | null;
  readonly beforeGeneration: LaunchdGenerationV1 | null;
  readonly beforeLiveState: LaunchdLiveStateV1;
}

/**
 * `automation` is the complete reconciled target set, or null when every installed job is
 * removed (disable, uninstall). The two table hashes come from the pinned process rows.
 */
export interface LaunchdPreviewRequestV1 {
  readonly observationProcessTableHash: LowerHexSha256;
  readonly mutationProcessTableTemplateHash: LowerHexSha256;
  readonly domain: LaunchdGuiDomainV1;
  readonly userHome: CanonicalAbsolutePathV1;
  readonly productHome: LaunchdScheduledProductHomeV1;
  readonly executablePath: CanonicalAbsolutePathV1;
  /** The absolute Node binary every planned plist's argv[0] names (NEW-144). */
  readonly nodePath: CanonicalAbsolutePathV1;
  readonly automation: AutomationConfigV1 | null;
  readonly prior: Readonly<Record<ScheduledJobIdV1, LaunchdPriorJobStateV1>>;
}
