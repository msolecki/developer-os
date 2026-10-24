#!/bin/sh
# The cart repository plus TypeScript with strict mode off and an API handler that swallows its error.
set -eu
d=${1:-$PWD}
here=$(cd "$(dirname "$0")" && pwd -P)
sh "$here/../fixtures/repo.sh" "$d"
printf '{\n  "compilerOptions": { "strict": false, "target": "ES2022", "module": "NodeNext" }\n}\n' > "$d/tsconfig.json"
mkdir -p "$d/src/api"
cat > "$d/src/api/checkout.ts" <<'TS'
export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    return Response.json({ total: body.total });
  } catch {}
  return Response.json({ total: 0 });
}
TS
cd "$d" && git add -A && git commit -q -m "feat: checkout API"
