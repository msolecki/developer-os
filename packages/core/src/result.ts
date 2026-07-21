export const EXIT_CODES = {
  success: 0,
  operationalFailure: 1,
  invalidInput: 2,
  decisionRequired: 3,
  capabilityUnavailable: 4,
  securityRefusal: 5,
  recoveryRequired: 6,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export interface CliError {
  readonly kind: string;
  readonly message: string;
  readonly paths: readonly string[];
  readonly recovery?: string;
}

type FailureExitCode = Exclude<ExitCode, typeof EXIT_CODES.success>;

export type CliResult<T> =
  | {
      readonly ok: true;
      readonly code: typeof EXIT_CODES.success;
      readonly data: T;
      readonly warnings: readonly string[];
    }
  | {
      readonly ok: false;
      readonly code: FailureExitCode;
      readonly error: CliError;
    };

export function success<T>(
  data: T,
  warnings: readonly string[] = [],
): CliResult<T> {
  return {
    ok: true,
    code: EXIT_CODES.success,
    data,
    warnings,
  };
}

export function failure(
  code: FailureExitCode,
  error: CliError,
): CliResult<never> {
  return {
    ok: false,
    code,
    error,
  };
}

export function formatJsonResult<T>(result: CliResult<T>): string {
  return JSON.stringify(result);
}
