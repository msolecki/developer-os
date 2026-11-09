#!/usr/bin/env python3
"""Rewrite every dos-source hash under site/ to its source's current hash.

Run from the repository root. The hash is the one docs/development.md "The site" describes:
the first 12 hex digits of the source's SHA-256 with any "last-verified:" line removed.
It refreshes hashes only; a site/docs/ page still fails the Site stage until its words match.
"""
import hashlib
import pathlib
import re

META = re.compile(r'(<meta name="dos-source" content="([^"@]+)@)([^"]*)(">)')


def digest(src):
    text = re.sub(rb"(?m)^last-verified: .*\n", b"", pathlib.Path(src).read_bytes())
    return hashlib.sha256(text).hexdigest()[:12]


def refresh(match):
    src = match.group(2)
    if not pathlib.Path(src).is_file():
        return match.group(0)
    return match.group(1) + digest(src) + match.group(4)


for page in sorted(pathlib.Path("site").rglob("*.html")):
    old = page.read_text(encoding="utf-8")
    new = META.sub(refresh, old)
    if new != old:
        page.write_text(new, encoding="utf-8")
        print(f"updated {page}")
