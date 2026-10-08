# Troubleshooting

Start with the two read-only checks. Neither changes anything.

```sh
developer-os doctor
developer-os status
```

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success. |
| 1 | Operational failure. |
| 2 | Invalid input. Check the command against `developer-os --help`. |
| 3 | A decision is required. |
| 4 | A capability is unavailable. For `update_package_source_absent`, run `brew install developer-os`. |
| 5 | Security refusal. |
| 6 | Recovery required. Run `developer-os repair --resume <id>`, then `developer-os doctor`. |

The `<id>` is the transaction that `doctor` or `status` reports.

```sh
developer-os repair --resume <id>
developer-os doctor
```

## "workflows not refreshed: run developer-os init"

An update replaced the release but not the workflows that your agents use. Refresh them:

```sh
developer-os init --adapters claude,codex
```

Name only the adapters you use.

## A second install of the same version refuses

`update_release_identity_rebound`: a package with the same version number but different bytes is a security refusal. The product does not switch to it. Uninstall with Homebrew, reinstall, and report it through [SECURITY.md](../../SECURITY.md) if you did not expect it.

## Reporting

Report bugs in the issue tracker of the repository. Include `developer-os --version`, your macOS version and the output of `developer-os doctor`, without vault content. Report vulnerabilities privately, as [SECURITY.md](../../SECURITY.md) describes.
