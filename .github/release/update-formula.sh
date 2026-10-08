#!/usr/bin/env bash
# A16 §2 step 7: update an existing tap formula for one release. Usage:
#   update-formula.sh <vX.Y.Z> <SHA256SUMS> <Formula/developer-os.rb>
# Rewrites exactly the version line, both url lines and both sha256 lines, and
# refuses (exit 1, file untouched) on anything outside the expected shape.
set -euo pipefail

die() { echo "update-formula: $*" >&2; exit 1; }

[ "$#" -eq 3 ] || die "usage: update-formula.sh <tag> <SHA256SUMS> <formula>"
tag=$1 sums=$2 formula=$3
repo=${GITHUB_REPOSITORY:-msolecki/developer-os}

[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "refusing tag: $tag"
version=${tag#v}
[ -f "$sums" ] && [ -f "$formula" ] || die "missing input file"

# SHA256SUMS: exactly two lines, arm64 first, each in the exact shape.
[ "$(wc -l < "$sums" | tr -d ' ')" = 2 ] || die "SHA256SUMS must have exactly two lines"
[ "$(grep -c '' "$sums")" = 2 ] || die "SHA256SUMS must end with a newline and have exactly two lines"
arch_line() { sed -n "$1p" "$sums"; }
declare_sum() {
  local line=$1 arch=$2
  [[ "$line" =~ ^([0-9a-f]{64})\ \ developer-os-${version//./\\.}-darwin-${arch}\.tar\.gz$ ]] || die "malformed SHA256SUMS line for $arch"
  echo "${BASH_REMATCH[1]}"
}
sum_arm64=$(declare_sum "$(arch_line 1)" arm64)
sum_x64=$(declare_sum "$(arch_line 2)" x64)

# Formula: exactly the expected shape before the edit.
url_base="https://github.com/${repo}/releases/download"
shape_version='^  version "[0-9]+\.[0-9]+\.[0-9]+"$'
shape_url() { echo "^    url \"https://github.com/[A-Za-z0-9._/-]+/releases/download/v[0-9]+\\.[0-9]+\\.[0-9]+/developer-os-[0-9]+\\.[0-9]+\\.[0-9]+-darwin-$1\\.tar\\.gz\"\$"; }
shape_sha='^    sha256 "[0-9a-f]{64}"$'

count() { grep -Ec "$1" "$formula" || true; }
[ "$(count "$shape_version")" = 1 ] && [ "$(count '^ *version ')" = 1 ] || die "formula must have exactly one version line"
[ "$(count "$(shape_url arm64)")" = 1 ] && [ "$(count "$(shape_url x64)")" = 1 ] && [ "$(count '^ *url ')" = 2 ] || die "formula must have exactly two url lines, one per architecture"
[ "$(count "$shape_sha")" = 2 ] && [ "$(count '^ *sha256 ')" = 2 ] || die "formula must have exactly two sha256 lines"
[ "$(count 'resource |using:|post_install|patch |system |`|^ *require|^ *eval')" = 0 ] || die "formula carries a construct this workflow does not edit around"
[ "$(count '^  def install$')" = 1 ] || die "formula must have exactly one def install"
grep -A2 '^  def install$' "$formula" | sed -n 2,3p | paste -sd'|' - | grep -qx '    prefix.install Dir\["\*"\]|  end' || die "formula install block is not the expected one"

n_ver=$(grep -En "$shape_version" "$formula" | cut -d: -f1)
n_url_arm=$(grep -En "$(shape_url arm64)" "$formula" | cut -d: -f1)
n_url_x64=$(grep -En "$(shape_url x64)" "$formula" | cut -d: -f1)
[ "$(sed -n "$((n_url_arm + 1))p;$((n_url_x64 + 1))p" "$formula" | grep -Ecx "$shape_sha")" = 2 ] || die "each sha256 line must follow its url line"

new_ver="  version \"${version}\""
new_url_arm="    url \"${url_base}/${tag}/developer-os-${version}-darwin-arm64.tar.gz\""
new_url_x64="    url \"${url_base}/${tag}/developer-os-${version}-darwin-x64.tar.gz\""
new_sha_arm="    sha256 \"${sum_arm64}\""
new_sha_x64="    sha256 \"${sum_x64}\""

work=$(mktemp)
trap 'rm -f "$work"' EXIT
awk -v nv="$n_ver" -v ua="$n_url_arm" -v ux="$n_url_x64" \
  -v tv="$new_ver" -v tua="$new_url_arm" -v tux="$new_url_x64" -v tsa="$new_sha_arm" -v tsx="$new_sha_x64" '
  NR == nv { print tv; next }
  NR == ua { print tua; next }
  NR == ua + 1 { print tsa; next }
  NR == ux { print tux; next }
  NR == ux + 1 { print tsx; next }
  { print }' "$formula" > "$work"

# After the edit: exactly those five lines changed, each to its expected value.
changed=$(diff "$formula" "$work" | grep -c '^>' || true)
removed=$(diff "$formula" "$work" | grep -c '^<' || true)
[ "$changed" -le 5 ] && [ "$removed" -le 5 ] || die "edit touched more than five lines"
for want in "$new_ver" "$new_url_arm" "$new_url_x64" "$new_sha_arm" "$new_sha_x64"; do
  grep -Fxq -- "$want" "$work" || die "edited formula lacks: $want"
done
[ "$(wc -l < "$work")" = "$(wc -l < "$formula")" ] || die "line count changed"
cp "$work" "$formula"
