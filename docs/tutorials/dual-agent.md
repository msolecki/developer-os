# Tutorial: Claude Code and Codex

This tutorial installs both agents. The example uses one synthetic vault. Nothing here needs real notes.

Install the product first ([Install and upgrade](../install/README.md)).

## 1. Initialize

```sh
developer-os init --adapters claude,codex
```

Codex runs plugin hooks only after you approve them once in Codex; until then `developer-os doctor`
prints the approval step under its `hooks` check.

## 2. Capture an observation

A capture is quarantined and redacted before it is written. Nothing reads it as a note yet.

```sh
developer-os capture --text "Decision: release notes live in CHANGELOG.md"
```

## 3. Review it

List the quarantined captures, copy the id of yours, and accept it.

```sh
developer-os review
developer-os review --id <capture-id> --decision accept
```

## 4. Ingest

`ingest` turns accepted captures into notes, one agent call each.

Pick the agent with `--agent`. Each run takes the accepted captures that are still waiting, so to try both agents, capture and accept a second observation before the second run.

```sh
developer-os ingest --agent claude
developer-os ingest --agent codex
```

## 5. Search

```sh
developer-os search "release notes"
```

The search finds the new note.

## Differences between the agents

Both agents read the same Brain. Each has its own adapter, its own instruction files and its own vendor CLI, so a workflow can behave differently on each. Which workflows were verified against which vendor version is recorded in [the compatibility matrix](../releases/compatibility-matrix.md).

Next: [Troubleshooting](../troubleshooting/README.md).
