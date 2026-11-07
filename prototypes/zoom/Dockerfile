# Apple Silicon の Mac 上では linux/arm64 でビルドする。
# SDK・認証情報・会議データはイメージに含めない。
FROM ubuntu:24.04

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    build-essential cmake pkg-config ca-certificates \
    libglib2.0-dev libcurl4-openssl-dev libssl-dev zlib1g-dev \
    libgtk-3-0t64 libgbm1 libgl1 libegl1 libdrm2 \
    libx11-xcb1 libxcb-xfixes0 libxcb-shape0 libxcb-shm0 \
    libxcb-randr0 libxcb-image0 libxcb-keysyms1 libxcb-xtest0 \
    libdbus-1-3 libxfixes3 libgssapi-krb5-2 \
    libasound2t64 libasound2-plugins pulseaudio pulseaudio-utils \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 probe
USER probe
WORKDIR /home/probe
CMD ["bash"]
