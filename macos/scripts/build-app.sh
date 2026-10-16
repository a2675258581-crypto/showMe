#!/usr/bin/env bash
# 构建 showMe.app（macOS）。
#   macos/scripts/build-app.sh              本机架构，输出 macos/build/showMe.app
#   macos/scripts/build-app.sh --universal  同时包含 Apple 芯片与 Intel（需要完整 Xcode）
#   macos/scripts/build-app.sh --install    构建后复制到 /Applications 并打开
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${DEVELOPER_DIR:-}" ] && [ -d /Applications/Xcode.app ]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi

universal=0
install=0
for arg in "$@"; do
  case "$arg" in
    --universal) universal=1 ;;
    --install) install=1 ;;
    *) echo "未知参数：$arg" >&2; exit 2 ;;
  esac
done

flags=(-c release --product ShowMe)
if [ "$universal" = 1 ]; then flags+=(--arch arm64 --arch x86_64); fi

echo "› swift build ${flags[*]}"
swift build "${flags[@]}"
bin_dir="$(swift build "${flags[@]}" --show-bin-path)"

app=build/showMe.app
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$bin_dir/ShowMe" "$app/Contents/MacOS/showMe"
cp Resources/Info.plist "$app/Contents/Info.plist"
printf 'APPL????' > "$app/Contents/PkgInfo"
cp -R Resources/zh-Hans.lproj Resources/en.lproj "$app/Contents/Resources/"
if [ -d Resources/engine ]; then cp -R Resources/engine "$app/Contents/Resources/"; fi

# 图标：Resources/AppIcon.png（1024×1024）→ AppIcon.icns
if [ -f Resources/AppIcon.png ]; then
  iconset="$(mktemp -d)/AppIcon.iconset"
  mkdir -p "$iconset"
  for size in 16 32 128 256 512; do
    sips -z $size $size Resources/AppIcon.png --out "$iconset/icon_${size}x${size}.png" >/dev/null
    double=$((size * 2))
    sips -z $double $double Resources/AppIcon.png --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
  done
  iconutil -c icns "$iconset" -o "$app/Contents/Resources/AppIcon.icns"
fi

# 本机自用：ad-hoc 签名即可（不需要开发者账号）
codesign --force --sign - --timestamp=none "$app"
(cd build && rm -f showMe.zip && ditto -c -k --keepParent showMe.app showMe.zip)
echo "✓ 已生成 macos/$app"

if [ "$install" = 1 ]; then
  rm -rf /Applications/showMe.app
  cp -R "$app" /Applications/
  open /Applications/showMe.app
  echo "✓ 已安装到 /Applications/showMe.app"
fi
