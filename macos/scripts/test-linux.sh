#!/usr/bin/env bash
# 在 Linux（或任何装了 Docker 的机器）上编译并测试 ShowMeCore。
# 用法：macos/scripts/test-linux.sh [swift test 的额外参数，如 --filter JSONTests]
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
if command -v swift >/dev/null 2>&1 && [ "$(uname)" = "Linux" ]; then
  cd "$here" && exec swift test "$@"
fi
exec docker run --rm -v "$here":/src -w /src swift:6.2 swift test "$@"
