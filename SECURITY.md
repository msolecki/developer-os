# Security policy

## Supported versions

Only the latest `0.Y.Z` beta receives security fixes.

## Reporting a vulnerability

Report privately through GitHub security advisories:
<https://github.com/msolecki/developer-os/security/advisories/new>

Never report a vulnerability in a public issue.

Include:

- the product version (`developer-os --version`),
- the macOS version and the architecture (Apple Silicon or Intel),
- the steps that reproduce the problem,
- the expected result and the actual result.

Never include the content of a vault or a secret. Describe it instead.

## Scope notes

- Updates are trusted through the Homebrew tap. Releases carry no signatures, by design.
- A process that runs as the same user as the product is outside the security boundary. See `docs/architecture/threat-model.md` for the model.
