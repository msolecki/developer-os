# developer-os

Shared workflows and a local-first knowledge base for Claude Code and Codex.

**Status:** Public beta (0.Y.Z). Interfaces may change before 1.0.0.

## Requirements

- macOS on Apple Silicon or Intel.
- Homebrew.
- Claude Code or Codex, or both.

You do not need a separate Node install. The runtime ships inside the package.

## Install

```sh
brew tap msolecki/developer-os
brew install developer-os
developer-os init --adapters claude,codex
```

`init` installs the product state, a Brain skeleton and the workflows for the adapters you name.

## Documentation

- [Install and upgrade](docs/install/README.md)
- Tutorials: [Claude only](docs/tutorials/claude-only.md), [Codex only](docs/tutorials/codex-only.md), [both agents](docs/tutorials/dual-agent.md)
- [Troubleshooting](docs/troubleshooting/README.md)
- [Privacy](docs/privacy.md)
- [Security](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)
- [Compatibility matrix](docs/releases/compatibility-matrix.md)

## License

License: pending (to be chosen with counsel).
