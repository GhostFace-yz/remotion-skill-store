#!/usr/bin/env bash
# 确定性验收：同一帧渲染两次必须逐像素相同。
# 用法: bash verify-determinism.sh <入口文件> <CompositionId> [帧号]
# 例:   bash verify-determinism.sh src/index.ts MyComp 200
set -euo pipefail

ENTRY="${1:?需要入口文件，例如 src/index.ts}"
COMP="${2:?需要 CompositionId}"
FRAME="${3:-120}"

OUT_DIR="out/check/determinism"
mkdir -p "$OUT_DIR"

echo "渲染 $COMP 第 $FRAME 帧 ×2 ..."
npx remotion still "$ENTRY" "$COMP" "$OUT_DIR/a.png" --frame="$FRAME" --log=error
npx remotion still "$ENTRY" "$COMP" "$OUT_DIR/b.png" --frame="$FRAME" --log=error

hash() {
  if command -v md5 >/dev/null 2>&1; then md5 -q "$1"; else md5sum "$1" | cut -d' ' -f1; fi
}

A="$(hash "$OUT_DIR/a.png")"
B="$(hash "$OUT_DIR/b.png")"

echo "a: $A"
echo "b: $B"

if [ "$A" = "$B" ]; then
  echo "✅ 一致：这一帧是帧驱动的"
  exit 0
fi

echo "❌ 不一致：画面还依赖渲染顺序或外部时钟"
echo "   排查顺序："
echo "   1. bash audit-time-sources.sh .   # 找出 rAF / 定时器 / 动画库 / CSS animation"
echo "   2. 有没有 Math.random()、Date.now() 参与画面"
echo "   3. 有没有 useState/useEffect 存中间状态"
echo "   4. 异步资源是否用 delayRender/continueRender 挡住了"
exit 1
