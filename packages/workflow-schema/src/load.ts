import type { ParseRefusal } from "./parse.js";
import { parseWorkflowYaml } from "./parse.js";
import type { WorkflowValidationResult } from "./validate.js";
import { screenFindingPath, validateWorkflow } from "./validate.js";

export interface WorkflowSource {
  readonly file: string;
  readonly text: string;
}

/**
 * `Record<ParseRefusal, …>`, never `Record<string, …>`. The loose type accepts
 * any subset, so adding a refusal reason would silently ship its author the
 * fallback message instead of failing the build — and that nearly happened
 * once already, when Task 2's review added `anchor-or-alias`, the refusal a
 * human is most likely to trip on innocently and least likely to guess from
 * "this file could not be parsed".
 */
const PARSE_MESSAGE: Readonly<Record<ParseRefusal, string>> = {
  "multiple-documents":
    "this file holds more than one YAML document; everything after the first would be silently unread",
  "explicit-tag":
    "an explicitly tagged YAML node is refused, because a tag resolves to a type a string schema cannot check",
  "anchor-or-alias":
    "a YAML anchor or alias is refused, because it makes the bytes and the parsed value disagree; write the value out in full",
  malformed: "this file is not well-formed YAML, or it repeats a key",
};

/**
 * A refusal is a finding, never a throw. A caller validating six workflows
 * should be told about all six.
 */
export function loadWorkflow(source: WorkflowSource): WorkflowValidationResult {
  const parsed = parseWorkflowYaml(source.text);
  if (!parsed.ok) {
    return {
      findings: [
        {
          /**
           * Screened here too. This was the one path into a `WorkflowFinding`
           * that passed the file through raw, so a directory name carrying a
           * U+202E reordered every line printed after it — but only for a file
           * that failed to parse, which is the case least likely to be noticed.
           */
          file: screenFindingPath(source.file),
          stepId: null,
          rule: "parse",
          severity: "error",
          message: PARSE_MESSAGE[parsed.reason],
        },
      ],
      errorCount: 1,
      warnCount: 0,
      infoCount: 0,
      contract: null,
    };
  }
  return validateWorkflow(source.file, parsed.value);
}
