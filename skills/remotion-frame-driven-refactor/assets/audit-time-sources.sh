#!/usr/bin/env bash
# 扫出项目里所有"外部时钟"——帧驱动重构要从这些地方改起。
# 用法: bash audit-time-sources.sh [源码目录]   默认当前目录
#
# 分两档：
#   高置信 —— 基本必然要让动画跟墙上的时钟走，必须改
#   待人工判断 —— CSS 过渡/动画、three 的 useFrame、Lottie 等，可能只是样式或已接管
set -uo pipefail

DIR="${1:-.}"

INCLUDE=(--include='*.js' --include='*.jsx' --include='*.ts' --include='*.tsx'
         --include='*.css' --include='*.html' --include='*.vue' --include='*.svelte')
EXCLUDE=(--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=out
         --exclude-dir=dist --exclude-dir=build --exclude-dir=.next
         --exclude='audit-time-sources.sh')

# 注释行过滤：grep -rn 的输出是 "文件:行号:内容"，所以要连着前缀一起匹配
strip_comments() {
  grep -vE ':[0-9]+:[[:space:]]*(//|/\*|\*)' || true
}

scan() {
  local pattern="$1"
  grep -rnE "$pattern" "$DIR" "${INCLUDE[@]}" "${EXCLUDE[@]}" 2>/dev/null \
    | strip_comments \
    | grep -vE '^[[:space:]]*$' \
    || true
}

HIGH='requestAnimationFrame|cancelAnimationFrame|setInterval|setTimeout|Date\.now|performance\.now|new Date\(|gsap\.|ScrollTrigger|anime\(|anime\.timeline|framer-motion|useSpring|useAnimation|useScroll|\.animate\(|IntersectionObserver|Ticker|lottie'
MAYBE='\buseFrame\b|useTransition|transition(-property|-duration|-delay|-timing-function)?[[:space:]]*:|animation(-name|-duration|-delay)?[[:space:]]*:|@keyframes'
RANDOM='Math\.random|Math\.RoundRandom|nanoid|\buuid\b'

echo "== 高置信：动画由时钟驱动，必须改成帧驱动 =="
HIGH_HITS="$(scan "$HIGH")"
if [ -z "$HIGH_HITS" ]; then
  echo "（无）"
else
  echo "$HIGH_HITS"
  echo "---- 共 $(printf '%s\n' "$HIGH_HITS" | wc -l | tr -d ' ') 处 ----"
fi

echo
echo "== 待人工判断：可能是样式/已接管，逐条确认 =="
MAYBE_HITS="$(scan "$MAYBE")"
if [ -z "$MAYBE_HITS" ]; then
  echo "（无）"
else
  echo "$MAYBE_HITS"
  echo "---- 共 $(printf '%s\n' "$MAYBE_HITS" | wc -l | tr -d ' ') 处 ----"
fi

echo
echo "== 随机源：渲染中禁止无参随机 =="
RANDOM_HITS="$(scan "$RANDOM")"
if [ -z "$RANDOM_HITS" ]; then
  echo "（无）"
else
  echo "$RANDOM_HITS"
  echo "提示：要随机就用 remotion 的 random(seed) 显式传种子。"
fi
