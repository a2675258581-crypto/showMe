#!/usr/bin/env bash
# 重新生成《临江仙 · 江湖》页面用的字体子集：只保留页面源码（去掉注释后）里出现的汉字与中文标点。
#
# 依赖：python3 + fonttools + brotli（pip install fonttools brotli）
# 字体原文件（SIL OFL）从 github.com/google/fonts 下载到某个目录后作为第一个参数传入：
#   ofl/mashanzheng/MaShanZheng-Regular.ttf   → 马善政毛笔楷书，词句与标题用
#   ofl/notoserifsc/NotoSerifSC[wght].ttf     → 思源宋体（可变字体），旁白与说明用，另存为 NotoSerifSC-VF.ttf
#
# 用法：scripts/subset-jianghu-fonts.sh <字体源文件目录>
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC=${1:?用法: $0 <字体源文件目录>}
OUT="$ROOT/src/pages/jianghu/fonts"
CHARS=$(mktemp)
TMP=$(mktemp -d)

# 收集页面源码里的非 ASCII 字符；先去掉块注释与行注释，避免把注释里的字也打进字体
cat "$ROOT"/src/pages/jianghu/*.ts "$ROOT"/src/pages/jianghu/*.tsx "$ROOT"/src/pages/jianghu/scenes/*.tsx |
  python3 -c '
import re, sys
s = sys.stdin.read()
s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
s = re.sub(r"(^|[^:\"'"'"'])//[^\n]*", r"\1", s, flags=re.M)
chars = sorted({c for c in s if ord(c) > 127 and not c.isspace()})
sys.stdout.write("".join(chars))
' >"$CHARS"
echo "字符数：$(python3 -c "print(len(open('$CHARS', encoding='utf-8').read()))")"

pyftsubset "$SRC/MaShanZheng-Regular.ttf" \
  --text-file="$CHARS" --flavor=woff2 --layout-features='*' --no-hinting --desubroutinize \
  --output-file="$OUT/mashanzheng-jianghu.woff2"

# 思源宋体是可变字体：先实例化成 Regular（wght=400），再子集化
python3 -m fontTools.varLib.instancer "$SRC/NotoSerifSC-VF.ttf" wght=400 -o "$TMP/NotoSerifSC-Regular.ttf" -q
pyftsubset "$TMP/NotoSerifSC-Regular.ttf" \
  --text-file="$CHARS" --flavor=woff2 --layout-features='*' --no-hinting --desubroutinize \
  --output-file="$OUT/notoserifsc-jianghu.woff2"

rm -rf "$TMP" "$CHARS"
ls -la "$OUT"
