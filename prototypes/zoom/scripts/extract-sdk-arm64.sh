#!/usr/bin/env bash
# SDK アーカイブ（Linux-all 形式）から arm64 部分だけを、展開先の直下に置く。
# 使い方: extract-sdk-arm64.sh <アーカイブ> <展開先> <アーカイブ内の arm64 フォルダ>
#   例: ... sdk.tar.xz .local/zoom-sdk/7.2.1.5860 zoom-sdk-linux-7.2.1.5860/arm64
# SHA-256 の照合は呼び出し元（prepare-sdk.sh）で済ませる。アーカイブ内のスクリプトは実行しない。
# いったん隣の一時フォルダへ展開し、libmeetingsdk.so が 64 ビット ELF / AArch64 であることを
# 確かめてから展開先へ移す。確かめられなければ展開先を作らない。
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
created_parent=""
if [[ ! -d "$parent" ]]; then
  mkdir -p "$parent"
  created_parent=$parent
fi
staging=$(mktemp -d "$parent/.extract-sdk.XXXXXX")
cleanup() {
  rm -rf "$staging"
  if [[ -n "$created_parent" ]]; then rmdir -p "$created_parent" 2>/dev/null || true; fi
}
trap cleanup EXIT

if ! tar -xJf "$archive" -C "$staging" --strip-components="$depth" "$member" 2>/dev/null; then
  echo "アーカイブから $member を展開できませんでした。" >&2
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
created_parent=""
trap - EXIT
echo "展開しました（libmeetingsdk.so は 64 ビット ELF / AArch64）: $dest"
