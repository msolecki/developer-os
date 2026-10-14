# Contributing

The plugin is Markdown and JSON. There is no build step and no runtime.

## Check

Run before every commit:

```sh
scripts/check.sh
```

It needs `claude` (Claude Code), `jq` and `gitleaks` on `PATH`. CI runs the same script.

## Rules

- Use synthetic examples only. Never commit a real vault note, a client name or a credential.
- A skill does one job, says when to use it in its `description`, and fits on one screen where possible.
- Test a changed skill by running it: `claude --plugin-dir plugin`, then invoke it on a scratch vault.
