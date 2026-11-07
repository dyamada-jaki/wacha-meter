#!/usr/bin/env bash
# 取得済みの Linux ARM64 Meeting SDK を、SHA-256 を照合してから Git 管理外へ展開する。
# 使い方: prototypes/zoom/scripts/prepare-sdk.sh <SDK アーカイブ> [展開先]
#   展開先の既定: .local/zoom-sdk/7.1.5.4434（.gitignore 済み）
set -euo pipefail

EXPECTED_SHA256=384d2e522b0d3e2650bb5e6f5201e1e5e5d88151a5f8808a2b8832c97c4fcb19
archive=${1:?SDK アーカイブのパスを指定してください（例: ~/Downloads/zoom-meeting-sdk-linux_arm64-7.1.5.4434.tar.xz）}
dest=${2:-.local/zoom-sdk/7.1.5.4434}

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
mkdir -p "$dest"
tar -xJf "$archive" -C "$dest"
echo "展開しました: $dest"
