# Glossary

Terms and identifiers used across the code and the documentation.

## Product terms

| Term | Meaning |
|---|---|
| **Active release** | The installed release the product runs, named by `state/active-release.json`. |
| **Adapter** | The package that integrates one vendor: `adapter-claude` or `adapter-codex`. |
| **Activation record** | `state/lifecycle-activation.json`: the provenance that makes Git or automation operational. Configuration alone is never authority. |
| **Bootstrap** | The first, fresh `init` of a product home, run by the bootstrap executor; its plan and journals are retained as evidence. |
| **Brain** | The user's knowledge vault: Obsidian-compatible Markdown under `content/`, default `~/DeveloperBrain`. |
| **Canonical note** | A Markdown note with valid frontmatter in a configured topic folder. Only canonical notes are indexed, searched and synced. |
| **Capability matrix** | Per-vendor table in `doctor` with values `yes`, `no`, `unknown`, `not-used`. |
| **Capture** | One redacted observation in quarantine, with an envelope of metadata. |
| **Closure** | The state of the lifecycle journals: `clear` lets a mutation run; anything else needs recovery first. |
| **Compiled note** | A `compiled-note`: a synthesis (hub) of several notes on one topic. |
| **Coordinator** | The lifecycle coordinator: runs a composite operation (uninstall, Git or automation enable, update, rollback) under one global lock with journaled participants and external effects. |
| **Drift** | A managed artifact whose bytes no longer match its recorded hash. The product stops rather than overwrite it. |
| **Entrypoint** | `<product-home>/bin/developer-os.mjs`, run by hooks and launchd jobs. |
| **Firing record** | `state/hooks/<vendor>.<verb>.json`: proof that a hook actually fired, read by `doctor`. |
| **Gardener** | The optional `brain-garden` job: one isolated Claude call that proposes note captures for lint gaps and isolated notes. |
| **Generation** | The hash in a launchd label (`com.developer-os.<job>.g.<generation>`) binding a plist to one applied automation plan. |
| **Guard** | A hook verb that inspects an agent's command or edit: `guard command`, `commit`, `path`, `edit`, `prompt`, `format`, `stop`. |
| **Ingest** | Turning accepted captures into canonical notes through an isolated vendor call, nine validators and a product-written transaction. |
| **Injection** | The `brain status --inject` hook: vault map plus the project note, added to the context at session start. |
| **Keg** | The Homebrew installation directory of one version: `Cellar/developer-os/<X.Y.Z>`. |
| **Launcher** | The stable program in the keg that builds a closed environment and execs the admitted release. |
| **Managed artifact** | A file, directory, schema or marked block listed in the installation manifest. |
| **Manifest** | `installation-manifest.json`: every managed artifact with owner, kind, hash and verification mode. |
| **Marked block** | The product's section in a shared vendor file, between `<!-- developer-os:begin v1 -->` and `<!-- developer-os:end v1 -->`. |
| **Note capture** | A capture that carries a whole proposed note for a given vault path, bound to the target's bytes at capture time. |
| **Override** | A user file under `<product-home>/instructions/<vendor>/` or `<product-home>/templates/project/` that replaces or adds a default. |
| **Package channel** | The Homebrew tap and keg, the trust root for releases and updates (D84). |
| **Product home** | The product's state directory, default `~/.developer-os`. |
| **Proposal** | The structured result a vendor model returns during ingest or gardening; data to validate, never an instruction. |
| **Pulse** | The optional `brain-pulse` job: an agent-free health report with a `healthy`, `attention` or `failure` verdict. |
| **Quarantine** | `content/_raw/quarantine/`: where captures wait; nothing reads them as knowledge. |
| **Redaction** | Replacing secrets and user patterns with markers before anything is persisted, logged, hashed or sent to a model. |
| **Release identity** | The hash that names one release's exact bytes; a different package at the same version refuses. |
| **Retained evidence** | Journals, plans and tombstones the product keeps after an operation so that recovery and later installs can trust the home. |
| **Rollback set** | The retained previous release and payload that `update rollback` returns to. |
| **Scope equality** | The workflow compiler's rule that a workflow's derived scopes must equal its declared scopes. |
| **Topic folder** | A configured folder under `content/` whose notes are canonical (`PROJECTS`, `TOOLS`, `DEV`, `INFRA`, `QA` by default). |
| **Transaction** | A journaled, recoverable change plan: `plan → backup → stage → validate → apply → verify → finalize`. |
| **Validator** | One of the nine deterministic checks every ingest proposal must pass. |
| **Watermark** | A trust sequence number that only moves forward; a lower one is a replay and refuses. |
| **Workflow** | A vendor-neutral contract in `workflows/<id>/workflow.yaml`, rendered as a `developer-os-<id>` skill. |

## Identifiers in the process records

| Pattern | Meaning | Where |
|---|---|---|
| `D<n>` | A founder decision, for example D84 (package-channel trust). | [superpowers/DECISIONS.md](superpowers/DECISIONS.md) |
| `NEW-<n>` | A backlog row: a defect, follow-up or gate. | [superpowers/BACKLOG.md](superpowers/BACKLOG.md) |
| `A<n>` | A product entry in the work queue, for example A15 (founder cutover) and A16 (public release). | [superpowers/ORDER.md](superpowers/ORDER.md) |
| `DOS-P<n>` | A program phase of the original program plan (DOS-P2 Brain engine, DOS-P6 knowledge pipeline, DOS-P9 release). | git history; architecture note headers |
| `L1`, `L2` | Long-lead gates: L1 the license, L2 the tap and release permissions. Both closed on 2026-10-14. | [superpowers/ORDER.md](superpowers/ORDER.md) |
| Spec 1, 1a, 1b | The opt-in surfaces design: 1a configuration and the lifecycle kernel, 1b Git and launchd. | `superpowers/specs/2026-08-21-developer-os-opt-in-surfaces-design.md` |
| Spec 2, `K1`–`K8` | The release, update and rollback design, and its 2026-10-07 package-channel amendments. | `superpowers/specs/2026-08-28-developer-os-release-update-design.md` |
| `AUD-<n>`, `FLOW-*`, `W2-*`, `CRITIC-*` | Findings of the full audits and reviews, referenced from backlog rows and notes. | git history of `docs/superpowers/audits/` |
| `V1`, `V2` | Generations of the installation manifest and lifecycle format; only V2 homes exist in practice. | [architecture/foundation.md](architecture/foundation.md) §10 |
