#!/usr/bin/env bash
# 扫出项目里所有"外部时钟"——这些是帧驱动重构必须改掉的地方。
# 用法: bash audit-time-sources.sh [源码目录]   默认当前目录
set -uo pipefail

DIR="${1:-.}"

# 命中这些的行，基本都意味着"动画由时间推动"，而不是由帧决定
PATTERN='requestAnimationFrame|cancelAnimationFrame|setInterval|setTimeout|Date\.now|performance\.now|new Date\(|gsap|ScrollTrigger|anime\(|anime\.timeline|framer-motion|useSpring|useAnimation|useScroll|\.animate\(|IntersectionObserver|transition|animation:|@keyframes|lottie|Ticker|useFrame'

echo "== 外部时间源扫描: $DIR =="
grep -rnE "$PATTERN" "$DIR" \
  --include='*.js' --include='*.jsx' --include='*.ts' --include='*.tsx' \
  --include='*.css' --include='*.html' \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=out \
  --exclude-dir=dist --exclude-dir=build 2>/dev/null \
  | grep -v '^\s*//' \
  || echo "（没有命中：这个项目已经是帧驱动的）"

echo
echo "== 随机源扫描（渲染中禁止无参随机） =="
grep -rnE 'Math\.random|nanoid|uuid' "$DIR" \
  --include='*.js' --include='*.jsx' --include='*.ts' --include='*.tsx' \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=out 2>/dev/null \
  || echo "（没有命中）"

echo
echo "提示：CSS 的 transition/animation 也会命中 transition: 之类无关写法，人工过一眼即可。"
