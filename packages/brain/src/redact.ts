/**
 * Moved to `@developer-os/security` in DOS-P3 Task 1, because
 * `packages/workflow-schema` needs the same screen and must not depend on
 * `packages/brain` — they are peer subsystems. This file stays as a re-export
 * so the move is one reviewable change rather than a move plus forty import
 * edits. The next task that touches a call site imports from `security`
 * directly; when the last one has, delete this file.
 */
export {
  capGraphemes,
  screenAndCap,
  screenControlCharacters,
} from "@developer-os/security";
