#!/usr/bin/env bash
# 确定性验收：证明画面只由帧号决定，与"渲染顺序/是否从第 0 帧播下来"无关。
#
# 用法: bash verify-determinism.sh <入口文件> <CompositionId> [帧号] [窗口=4]
# 例:   bash verify-determinism.sh src/index.ts MyComp 200
#
# 为什么这样测（原来的"still 渲染两次"是无效测试）：
#   同一个 still 跑两遍，只能证明"同一个求值过程幂等"，测不出"帧之间互相影响"。
#   真正会出问题的两种情况是——
#     a) 这一帧只有在"从第 0 帧连续播下来"时才对（隐藏累加状态）
#     b) 并发渲染时因为乱序而结果不同
#   所以：单帧渲染 vs 连续序列里的同一帧 vs 高并发序列里的同一帧，三者必须逐像素相同。
#
# 为什么比 PNG 不比 mp4：H.264 有损，同一帧重编码也会差几个像素；--sequence 出 PNG
# 是无损的，md5 才有意义。注意 --sequence 默认输出 JPEG，必须显式 --image-format=png。
set -euo pipefail

ENTRY="${1:?需要入口文件，例如 src/index.ts}"
COMP="${2:?需要 CompositionId}"
FRAME="${3:-200}"
WINDOW="${4:-4}"

OUT="out/check/determinism"
FROM=$(( FRAME - WINDOW ))
if [ "$FROM" -lt 0 ]; then FROM=0; fi
TO=$(( FRAME + WINDOW ))

rm -rf "$OUT"
mkdir -p "$OUT"

hash() {
  if command -v md5 >/dev/null 2>&1; then md5 -q "$1"; else md5sum "$1" | cut -d' ' -f1; fi
}

echo "== 1/3 连续渲染，并发 1（窗口 ${FROM}-${TO}）=="
npx remotion render "$ENTRY" "$COMP" "$OUT/seq-c1" \
  --sequence --image-format=png --frames="${FROM}-${TO}" --concurrency=1 --log=error

echo "== 2/3 连续渲染，并发 8（顺序与上面不同）=="
npx remotion render "$ENTRY" "$COMP" "$OUT/seq-c8" \
  --sequence --image-format=png --frames="${FROM}-${TO}" --concurrency=8 --log=error

echo "== 3/3 只渲染这一帧 =="
npx remotion still "$ENTRY" "$COMP" "$OUT/still-$FRAME.png" --frame="$FRAME" --log=error

A="$OUT/seq-c1/element-$FRAME.png"
B="$OUT/seq-c8/element-$FRAME.png"
C="$OUT/still-$FRAME.png"

for f in "$A" "$B" "$C"; do
  if [ ! -f "$f" ]; then
    echo "❌ 缺少产物：$f"
    echo "   检查 --sequence 的输出命名是否仍为 element-[frame].png，以及 --frames 是否生效"
    exit 2
  fi
done

HA="$(hash "$A")"
HB="$(hash "$B")"
HC="$(hash "$C")"

echo "序列(并发1)  $HA"
echo "序列(并发8)  $HB"
echo "单帧         $HC"

if [ "$HA" = "$HB" ] && [ "$HA" = "$HC" ]; then
  echo "✅ 一致：第 $FRAME 帧与渲染顺序无关，是帧驱动的"
  exit 0
fi

echo "❌ 不一致：画面仍依赖渲染顺序或外部时钟"
if [ "$HA" != "$HB" ]; then
  echo "   → 序列(1) ≠ 序列(8)：帧与帧之间有共享状态（累加、缓存、useState/useEffect）"
fi
if [ "$HA" != "$HC" ]; then
  echo "   → 序列 ≠ 单帧：这一帧依赖「从第 0 帧播下来」的隐藏状态（累加器、动画库内部时钟）"
fi
echo "   排查：bash audit-time-sources.sh ."
exit 1
