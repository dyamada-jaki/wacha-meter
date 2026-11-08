#!/usr/bin/env bash
# 検証プログラムを linux/arm64 のコンテナ内でビルドする。SDK は読み取り専用でマウントし、
# ビルド結果は Git 管理外の .local/zoom-auth-probe/build に置く。イメージには何も追加しない。
# 環境変数: WACHA_ZOOM_IMAGE（既定 wacha-meter-zoom-dev:local）、WACHA_ZOOM_SDK_DIR、
#           WACHA_ZOOM_PROBE_BUILD_DIR、WACHA_ZOOM_CONTAINER_PREFIX（既定 wacha-meter-zoom-auth）
set -euo pipefail

repo=$(cd "$(dirname "$0")/../../.." && pwd)
image=${WACHA_ZOOM_IMAGE:-wacha-meter-zoom-dev:local}
sdk_dir=$(cd "${WACHA_ZOOM_SDK_DIR:-$repo/.local/zoom-sdk/7.2.1.5860}" && pwd)
build_dir=${WACHA_ZOOM_PROBE_BUILD_DIR:-$repo/.local/zoom-auth-probe/build}
prefix=${WACHA_ZOOM_CONTAINER_PREFIX:-wacha-meter-zoom-auth}
mkdir -p "$build_dir"
build_dir=$(cd "$build_dir" && pwd)

docker run --rm --platform linux/arm64 --name "$prefix-build-$$" \
  --user "$(id -u):$(id -g)" \
  -v "$sdk_dir:/opt/zoom-sdk:ro" \
  -v "$repo/prototypes/zoom/auth-probe:/src:ro" \
  -v "$build_dir:/build" \
  "$image" \
  bash -c 'cmake -S /src -B /build/cmake -DZOOM_SDK_DIR=/opt/zoom-sdk -DCMAKE_BUILD_TYPE=Release >/dev/null &&
           cmake --build /build/cmake -j"$(nproc)" &&
           cp /build/cmake/wacha-zoom-auth-probe /build/wacha-zoom-auth-probe'
echo "ビルドしました: $build_dir/wacha-zoom-auth-probe"
