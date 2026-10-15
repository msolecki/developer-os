#!/bin/sh
# The cart repository plus a small Next.js-style UI (a page and a global stylesheet) and no DESIGN.md.
set -eu
d=${1:-$PWD}
here=$(cd "$(dirname "$0")" && pwd -P)
sh "$here/../fixtures/repo.sh" "$d"
mkdir -p "$d/app"
cat > "$d/app/page.tsx" <<'TSX'
export default function Page() {
  return <button className="bg-[#1a1c1e] text-white rounded-lg px-2">Checkout</button>;
}
TSX
printf '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n' > "$d/app/globals.css"
cd "$d" && git add -A && git commit -q -m "feat: checkout page"
