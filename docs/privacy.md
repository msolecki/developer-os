# Privacy

The product itself makes no network request.

## Network actions

Every network action on your machine comes from something else:

- Homebrew downloads the tap and the release tarball from GitHub when you run `brew tap`, `brew install` or `brew upgrade`.
- The vendor CLIs you run (Claude Code, Codex) talk to their vendors under their own terms. `ingest` and the Brain workflows invoke them only when you run those commands.
- Git sync and automation, when you enable them, run `git` against the remote you configured.

## What is not collected

There is no telemetry, no analytics and no crash report. The beta collects only the issues that participants choose to report.

## Where data lives

The product home holds the installed releases and the product state. The Brain vault holds your notes and quarantined captures. `developer-os status` prints both paths.

```sh
developer-os status
```

`developer-os uninstall` keeps the Brain vault.
