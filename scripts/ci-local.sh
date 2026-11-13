#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
case "$(uname -m)" in arm64 | aarch64) platform=linux/arm64 ;; *) platform=linux/amd64 ;; esac
docker build --quiet --platform "$platform" -t bun-companion-act:latest .github/act >/dev/null
exec act pull_request --container-architecture "$platform" "$@"
