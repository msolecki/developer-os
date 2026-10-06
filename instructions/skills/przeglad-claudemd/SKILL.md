---
name: przeglad-claudemd
description: Review a project's instruction file (CLAUDE.md or AGENTS.md) against recent work and propose a minimal evidence-backed diff without applying it. Use when the user asks to improve or review project instructions or invokes przeglad-claudemd.
---

# Improve project instructions from evidence

1. Read the project instruction file (`CLAUDE.md`, or `AGENTS.md` for Codex), any project context file the repository documents, the project's active plan, and recent git history and diffs.
2. Keep only durable instructions supported by repeated work, a concrete defect, or an explicit user correction.
3. Exclude code-discoverable facts, one-off debugging history, rules already present in the user's global instructions, and unsupported preferences.
   Flag existing entries that are stale or contradict the current code for removal, each with its reason. Keep the resulting file under 100 lines, the target the project templates set; when it would exceed that, propose moving the excess to project documentation with a one-line pointer.
4. Propose a minimal unified diff. Apply nothing without explicit approval.
5. Give three bullets linking each proposal to evidence and naming removed duplication.

If no durable improvement exists, output exactly: `NO CHANGES`.
