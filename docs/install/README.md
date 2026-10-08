# Install and upgrade

Requirements: macOS (Apple Silicon or Intel) and Homebrew.

## Install

```sh
brew tap msolecki/developer-os
brew install developer-os
```

## First run

Preview first, then apply. Name the vendors you use: `claude`, `codex` or `claude,codex`.

```sh
developer-os init --dry-run --adapters claude,codex
developer-os init --adapters claude,codex
```

## Upgrade

`brew upgrade` alone does not change the active release. `developer-os update --apply` does.

```sh
brew upgrade developer-os
developer-os update
developer-os update --apply
```

`developer-os update` previews the change. After an update, run `developer-os init` to refresh the workflows.

## Rollback

The previous release is retained. Preview, then apply.

```sh
developer-os update rollback
developer-os update rollback --apply
```

## Uninstall

The Brain vault is kept.

```sh
developer-os uninstall --dry-run
developer-os uninstall --yes
brew uninstall developer-os
```

If something fails, see [Troubleshooting](../troubleshooting/README.md).
