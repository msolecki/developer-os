---
type: knowledge
status: inbox
created: 2026-10-12
updated: 2026-10-12
project:
tags: [docker, pnpm]
summary: "Use a BuildKit cache mount for the pnpm store in Dockerfiles."
---

## Context

Image builds downloaded every dependency on each run.

## Decision

`RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile`

## Why

The store survives between builds, so an unchanged lockfile installs from cache.

## Links
