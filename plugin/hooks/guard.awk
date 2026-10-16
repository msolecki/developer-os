# Word scanner for guard.sh: prints install, push or noverify for the first hit, nothing otherwise.
{
  gsub(/[;&|()`]/, "\n")
  n = split($0, seg, "\n")
  for (s = 1; s <= n; s++) {
    m = split(seg[s], w)
    pm = 0; sub_ = 0; git = 0; push = 0; commit = 0; force = 0; skip = 0
    for (i = 1; i <= m; i++) {
      x = w[i]
      if (x ~ /^--no-veri(f|fy)?$/ || x == "HUSKY=0" || tolower(x) ~ /core\.hookspath(=|$)/) { print "noverify"; exit }
      if (x ~ /(^|\/)git$/) git = 1
      if (skip) { skip = 0; continue }
      if (pm && x ~ /^(--filter|-F|--prefix|--dir|-C)$/) { skip = 1; continue }
      if (sub_ && x !~ /^-/) { print "install"; exit }
      if (pm && x ~ /^(i|in|ins|inst|insta|instal|install|isnt|isnta|isntal|isntall|it|add)$/) sub_ = 1
      if (x ~ /(^|\/)(npm|pnpm|yarn|bun)$/) pm = 1
      if (git && x == "push") push = 1
      else if (git && x == "commit") commit = 1
      else if (push && (x == "--force" || x == "--mirror" || x ~ /^-[a-zA-Z]*f[a-zA-Z]*$/ || x ~ /^\+/)) force = 1
      else if (commit && x ~ /^-[a-zA-Z]*n[a-zA-Z]*$/) { print "noverify"; exit }
    }
    if (force) { print "push"; exit }
  }
}
