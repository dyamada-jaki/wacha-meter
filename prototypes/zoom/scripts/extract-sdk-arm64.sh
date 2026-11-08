#!/usr/bin/env bash
# SDK アーカイブ（Linux-all 形式）から arm64 部分だけを、展開先の直下に置く。
# 使い方: extract-sdk-arm64.sh <アーカイブ> <展開先> <アーカイブ内の arm64 フォルダ>
#   例: ... sdk.tar.xz .local/zoom-sdk/7.2.1.5860 zoom-sdk-linux-7.2.1.5860/arm64
# SHA-256 の照合は呼び出し元（prepare-sdk.sh）で済ませる。アーカイブ内のスクリプトは実行しない。
# いったん隣の一時フォルダへ展開し、libmeetingsdk.so が 64 ビット ELF / AArch64 であることを
# 確かめてから展開先へ移す。リンク先が絶対パス、または .. を含むシンボリックリンクがあれば拒否する
# （展開先の外を指すものを、連鎖も含めて防ぐ）。確かめられなければ展開先を作らず、今回作った親フォルダだけを消す（処理前からあるものには触れない）。
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
# 後始末に使う変数を先に用意し、親を作る前に trap を登録する（親を作っている途中の失敗も戻す）
staging=""
created_dirs=()
cleanup() {
  if [[ -n "$staging" ]]; then rm -rf "$staging"; fi
  local i
  for ((i = ${#created_dirs[@]} - 1; i >= 0; i--)); do
    rmdir "${created_dirs[i]}" 2>/dev/null || true
  done
}
trap cleanup EXIT
# 無い親フォルダを、浅いものから順に作る。new/.. や new/. のように、前の mkdir で存在するように
# なるものもあるので、作る直前に確かめ直し、実際に作ったものだけを記録する（後始末では逆順に1つずつ rmdir する）
missing=()
dir=$parent
while [[ ! -d "$dir" ]]; do
  missing=("$dir" "${missing[@]+"${missing[@]}"}")
  dir=$(dirname "$dir")
done
for dir in "${missing[@]+"${missing[@]}"}"; do
  if [[ ! -d "$dir" ]]; then
    mkdir "$dir"
    created_dirs+=("$dir")
  fi
done
# 親を作ると、作る前は辿れなかった展開先（例: keep/new/../sdk = keep/sdk）が既存と分かることがある
if [[ -e "$dest" || -L "$dest" ]]; then
  echo "展開先がすでにあります。上書きしません: $dest" >&2
  exit 1
fi
staging=$(mktemp -d "$parent/.extract-sdk.XXXXXX")

if ! tar -xJf "$archive" -C "$staging" --strip-components="$depth" "$member" 2>/dev/null; then
  echo "アーカイブから $member を展開できませんでした。" >&2
  exit 1
fi

# シンボリックリンクは、リンク先が .. を含まない相対パスのものだけを許す（絶対パス、または .. を1つでも含めば拒否）。
# .. を使わない相対のリンク先は、リンクの置き場所のフォルダから下にしか進めない。途中にリンクがあっても、
# そのリンク先も同じ規則で置き場所より下にしか行かないので、どう連鎖しても展開先の外には出られない。
# 7.2.1.5860 の arm64/ にあるリンクは libglib2/lib/ の同じフォルダ内を指す12個だけで、.. を含むものは無い。
escaping_links=$(cd "$staging" && find . -type l | while IFS= read -r link; do
  target=$(readlink "$link")
  if [[ "$target" == /* || "/$target/" == */../* ]]; then
    printf '%s\n' "${link#./}"
  fi
done)
if [[ -n "$escaping_links" ]]; then
  echo "リンク先が絶対パス、または .. を含むシンボリックリンクがあります（展開先の外を指しうる）。展開しません:" >&2
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
