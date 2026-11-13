FROM catthehacker/ubuntu:act-24.04

RUN bin="$(ls -d /opt/acttoolcache/node/24.*/*/bin | head -1)" \
 && ln -sf "$bin/node" /usr/local/bin/node \
 && ln -sf "$bin/npm" /usr/local/bin/npm \
 && ln -sf "$bin/npx" /usr/local/bin/npx \
 && node --version

RUN apt-get update \
 && apt-get install -y --no-install-recommends xvfb xauth libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libgtk-3-0t64 \
    libgbm1 libasound2t64 libxss1 libsecret-1-0 libxkbfile1 libdrm2 \
 && rm -rf /var/lib/apt/lists/*
