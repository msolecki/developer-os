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
| 6 | Recovery required. Run the command on the `Recovery` line of the error, then `developer-os doctor`. |

Exit 6 has more than one remedy, so the CLI names the right one on its `Recovery` line; `developer-os doctor` prints the same line for every finding it reports. The forms are:

- `developer-os repair --resume <id>` or `developer-os repair --rollback <id>` for a stopped transaction. The `<id>` is the transaction that `doctor` or `status` reports.
- `developer-os init` for an interrupted install (a `tx_fi_*` transaction). `repair` refuses it.
- `developer-os uninstall` for an interrupted uninstall.
- `developer-os update --apply` or `developer-os update rollback --apply` for an interrupted update or rollback. `repair` refuses these too.
- An instruction to fix a named file or record by hand, then re-run the command.

## Workflows are older than the installed release

An update replaced the release but not the workflows that your agents use. Refresh them from the active release:

```sh
developer-os init
```

Pass `--adapters` only to change which agents are selected: it renders from the installed package instead of the active release, and the adapters it leaves out are detached.

## A second install of the same version refuses

`update_release_identity_rebound` is a security refusal. The installed package has the same version as the release this product home runs, but its bundle bytes differ. The product does not switch to it. Reinstalling the package from the tap, with `brew reinstall developer-os`, restores the bytes the tap publishes. If the refusal persists, do not work around it. Report it through [SECURITY.md](../../SECURITY.md).

## Reporting

Report bugs in the issue tracker of the repository. Include `developer-os --version`, your macOS version and the output of `developer-os doctor`, without vault content. Report vulnerabilities privately, as [SECURITY.md](../../SECURITY.md) describes.
