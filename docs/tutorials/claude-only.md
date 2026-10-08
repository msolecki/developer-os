# Tutorial: Claude Code only

This tutorial uses Claude Code as the only agent. The example uses one synthetic vault. Nothing here needs real notes.

Install the product first ([Install and upgrade](../install/README.md)).

## 1. Initialize

```sh
developer-os init --adapters claude
```

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

```sh
developer-os ingest --agent claude
```

## 5. Search

```sh
developer-os search "release notes"
```

The search finds the new note. Next: [Troubleshooting](../troubleshooting/README.md).
