#!/usr/bin/env bash
# 取得済みの Meeting SDK（Linux-all 形式、7.2.1.5860）の SHA-256 を照合してから、
# arm64 部分だけを Git 管理外へ展開する。x86_64 部分とアーカイブ内のスクリプトは使わない。
# 使い方: prototypes/zoom/scripts/prepare-sdk.sh <SDK アーカイブ> [展開先]
#   展開先の既定: .local/zoom-sdk/7.2.1.5860（.gitignore 済み）
set -euo pipefail

EXPECTED_SHA256=ddf8daffb053a7bd4702ac9f6f7de2ab6cb58a537eb3448df18a499ac7e62750
ARM64_MEMBER=zoom-sdk-linux-7.2.1.5860/arm64
archive=${1:?SDK アーカイブのパスを指定してください（例: ~/Downloads/zoom-meeting-sdk-linux-7.2.1.5860.tar.xz）}
dest=${2:-.local/zoom-sdk/7.2.1.5860}

actual=$(shasum -a 256 "$archive" 2>/dev/null || sha256sum "$archive")
actual=${actual%% *}
if [[ "$actual" != "$EXPECTED_SHA256" ]]; then
  echo "SHA-256 が受領記録と一致しません。別のファイルの可能性があるため展開しません。" >&2
  exit 1
fi

if [[ -e "$dest/libmeetingsdk.so" ]]; then
  echo "展開済みです: $dest"
  exit 0
fi
exec "$(dirname "$0")/extract-sdk-arm64.sh" "$archive" "$dest" "$ARM64_MEMBER"
