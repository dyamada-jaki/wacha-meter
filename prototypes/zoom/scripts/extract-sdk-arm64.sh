#!/usr/bin/env bash
# SDK アーカイブ（Linux-all 形式）から arm64 部分だけを、展開先の直下に置く。
# 使い方: extract-sdk-arm64.sh <アーカイブ> <展開先> <アーカイブ内の arm64 フォルダ>
#   例: ... sdk.tar.xz .local/zoom-sdk/7.2.1.5860 zoom-sdk-linux-7.2.1.5860/arm64
# SHA-256 の照合は呼び出し元（prepare-sdk.sh）で済ませる。アーカイブ内のスクリプトは実行しない。
# いったん隣の一時フォルダへ展開し、libmeetingsdk.so が 64 ビット ELF / AArch64 であることを
# 確かめてから展開先へ移す。展開先の外を指すシンボリックリンク（絶対パス、または .. で外に出るもの）が
# あれば拒否する。確かめられなければ展開先を作らず、今回作った親フォルダだけを消す（処理前からあるものには触れない）。
set -euo pipefail

archive=${1:?アーカイブのパスを指定してください}
dest=${2:?展開先を指定してください}
member=${3:?アーカイブ内の arm64 フォルダを指定してください}
member=${member%/}

if [[ -e "$dest" ]]; then
  echo "展開先がすでにあります。上書きしません: $dest" >&2
  exit 1
fi

# member の深さ（例: a/arm64 → 2）だけ先頭のフォルダを取り除く
depth=$(awk -F/ '{print NF}' <<<"$member")
parent=$(dirname "$dest")
# 今回作る親フォルダを、浅いものから順に記録する（後始末では逆順に1つずつ rmdir する）
created_dirs=()
missing=()
dir=$parent
while [[ ! -d "$dir" ]]; do
  missing=("$dir" "${missing[@]+"${missing[@]}"}")
  dir=$(dirname "$dir")
done
for dir in "${missing[@]+"${missing[@]}"}"; do
  mkdir "$dir"
  created_dirs+=("$dir")
done
staging=""
cleanup() {
  if [[ -n "$staging" ]]; then rm -rf "$staging"; fi
  local i
  for ((i = ${#created_dirs[@]} - 1; i >= 0; i--)); do
    rmdir "${created_dirs[i]}" 2>/dev/null || true
  done
}
trap cleanup EXIT
staging=$(mktemp -d "$parent/.extract-sdk.XXXXXX")

if ! tar -xJf "$archive" -C "$staging" --strip-components="$depth" "$member" 2>/dev/null; then
  echo "アーカイブから $member を展開できませんでした。" >&2
  exit 1
fi

# シンボリックリンクのリンク先を、リンクの置き場所から文字列として辿り、展開先の外に出ないことを確かめる。
# 絶対パスは拒否する。SDK に同梱の相対リンク（例: libglib-2.0.so.0 → libglib-2.0.so.0.7200.4）は許す。
escaping_links=$(cd "$staging" && find . -type l | while IFS= read -r link; do
  target=$(readlink "$link")
  if ! awk -v base="$(dirname "${link#./}")" -v target="$target" 'BEGIN {
    if (substr(target, 1, 1) == "/") exit 1
    depth = 0
    if (base != ".") {
      n = split(base, parts, "/")
      for (i = 1; i <= n; i++) if (parts[i] != "" && parts[i] != ".") depth++
    }
    n = split(target, parts, "/")
    for (i = 1; i <= n; i++) {
      if (parts[i] == "" || parts[i] == ".") continue
      if (parts[i] == "..") { depth--; if (depth < 0) exit 1 } else depth++
    }
    exit 0
  }'; then
    printf '%s\n' "${link#./}"
  fi
done)
if [[ -n "$escaping_links" ]]; then
  echo "展開先の外を指すシンボリックリンクがあります。展開しません:" >&2
  sed 's/^/  /' <<<"$escaping_links" >&2
  exit 1
fi

lib="$staging/libmeetingsdk.so"
if [[ ! -f "$lib" || -L "$lib" ]]; then
  echo "$member に libmeetingsdk.so がありません。" >&2
  exit 1
fi
# ELF ヘッダー: 先頭 7f 45 4c 46、EI_CLASS=2（64 ビット）、EI_DATA=1（リトルエンディアン）、
# e_machine（オフセット 18 の 2 バイト）= 0xb7 0x00（AArch64、183）
header=$(od -An -tx1 -N20 "$lib" | tr -d ' \n')
if [[ "${header:0:12}" != "7f454c460201" || "${header:36:4}" != "b700" ]]; then
  echo "libmeetingsdk.so が 64 ビット ELF / AArch64 ではありません。展開しません。" >&2
  exit 1
fi

mv "$staging" "$dest"
chmod 755 "$dest"
trap - EXIT
echo "展開しました（libmeetingsdk.so は 64 ビット ELF / AArch64）: $dest"
