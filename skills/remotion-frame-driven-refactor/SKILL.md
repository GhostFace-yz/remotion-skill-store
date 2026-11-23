---
name: remotion-frame-driven-refactor
description: 把 GSAP、Anime.js、Framer Motion、ScrollTrigger、Lottie 或手写 requestAnimationFrame 这类"时间轴/时钟驱动"的动画代码，重构成 Remotion 的"帧驱动"组件（画面 = frame 的纯函数）。当用户想复用一段开源网页动效、把线上 demo 搬进视频、或报告 Remotion 里"动画不跟帧走、导出与预览不一致、偶发错位、渲染出来是静态"时使用。含 API 对照表、七步重构流程、时间源审计脚本与确定性验收。
---

# 帧驱动重构：把"时间轴"动画改成"帧"动画

## 什么时候用

- 拿到一段 GSAP / anime.js / framer-motion / Web Animations API / 原生 rAF 的动画代码，想放进 Remotion 渲染
- 已经搬进去了，但出现这些症状：画面不动、导出与 Studio 预览不一致、跳帧渲染时错位、并发渲染偶发鬼畜、动画在成片里比预览快/慢
- 想用"录屏"绕开这个问题——**先读 `references/recording-vs-frames.md`，通常不该录**

## 唯一原则

**画面 = f(frame)。** 给定帧号，输出唯一确定的像素，与渲染顺序、机器、并发数无关。

所有外部时间源都必须换成帧号：`requestAnimationFrame`、`setTimeout`、`Date.now`、`performance.now`、CSS `transition`/`animation`、`gsap.ticker`、动画库内部的 Ticker。

原因是 Remotion **并发乱序**取帧：第 900 帧可能比第 300 帧先渲染。任何"依赖上一帧状态"的写法（累加、缓动逼近、弹簧积分）都会得到幽灵结果。

一句话自检：

> 单独渲染 `--frames=200-200`，和整段渲染的第 200 帧，是否逐像素相同？

## 换算基数

```
frame = seconds × fps
```

`fps` 从 `useVideoConfig()` 取，不要写死 30。`duration` 同理。

## 快速对照（完整版见 `references/gsap-mapping.md`）

| 原代码 | 帧驱动写法 |
|---|---|
| `gsap.to(el, {x: 100, duration: 1})` | `interpolate(frame, [0, fps], [0, 100])` |
| `ease: "power2.out"` | `Easing.out(Easing.quad)` |
| `tl.to(a).to(b, "-=0.3")` | 帧点位常量：`const aEnd = aStart + 30; const bStart = aEnd - 9;` |
| `stagger: 0.05` | `start + i * Math.round(0.05 * fps)` |
| `repeat: -1` | `frame % period` |
| `yoyo: true` | 三角波（`assets/keyframes.ts` 的 `pingPong`） |
| `tl.progress()` 驱动的 scrub | 传入的进度值直接当 frame 用 |
| `onUpdate` 里改 DOM | 不写 DOM，改成从派生值渲染 |
| `SplitText` 逐字入场 | 用 `charIndex` 算每个字的延迟帧 |
| `useSpring` / `motion.div` | `spring({frame, fps, config})` |
| `Draggable` / `InertiaPlugin` | 闭式解 `v0*t + ½at²`，或预计算曲线采样 |
| canvas `rAF` 循环 | 把 `t` 换成 `frame`，绘制函数保持无副作用 |

## 七步流程

1. **审计时间源**：`bash assets/audit-time-sources.sh <源码目录>`，列出所有 rAF / 定时器 / 动画库 / CSS 动画。
2. **砍掉外部状态**：鼠标位置、窗口尺寸、网络、`Math.random()`。要随机就用 `random(seed)` 显式传种子；渲染中禁止无参随机。
3. **拍平时间轴**：把链式 timeline 变成关键帧表 `[[frame, value], ...]`，帧号写成常量并集中在一处（本项目叫 `bgTimeline.js`，动画、录音脚本、导出脚本共用同一份）。
4. **派生值集中在组件顶部**：一个纯计算的 `const` 区块，下面只做渲染。
5. **缓动映射**：GSAP ease 名 → `Easing.*`（对照表见 references）。
6. **副作用改成渲染**：`el.style.transform = ...` → `style={{transform: ...}}`；命令式 canvas 绘制 → 参数化的绘制函数。
7. **验收**：见下节。

## 本项目踩过的坑（症状 → 根因 → 修法）

1. **结尾定格显示了视频开头**
   根因：`<Freeze frame>` 的帧号是**相对父 `<Sequence>` 起点**的，写了绝对帧就被偏移了。
   修法：`<Freeze frame={0}>` 只表示"冻在本段第 0 帧"；要在绝对帧 N 定格，得用 `frame={N - sequence.from}`，或者干脆别用 Freeze。

2. **字幕聚焦索引一直卡在 0**
   根因：`useCurrentFrame()` 在 `<Sequence>` 内返回的是**相对**父级起点的帧号，直接用绝对帧比较永远不成立。
   修法：把绝对帧口径统一在一处，进 Sequence 前减 `from`（或换算后再传 props）。

3. **音频音量曲线不生效 / 时间对不上**
   根因：同样的相对帧问题——`<Audio volume={(f) => ...}>` 的回调收到的是 **sequence-local** 帧。
   修法：`volume` 回调里 `f + sequenceFrom` 再查表。

4. **逐帧累加的位置积分在导出时抖**
   根因：`pos += v * dt` 依赖上一帧结果，而帧是乱序渲染的。
   修法：一律闭式解——`pos(frame)` 由起始值 + 帧号算出，不读上一帧。

5. **CSS `transition` / `@keyframes` 在成片里不动**
   根因：Remotion 用 `seek` 截图，不推进 CSS 时钟，也等不到过渡结束。
   修法：全部换成内联样式 + `interpolate`；第三方组件的过渡效果要禁用或改 props。

6. **测量出来的位置在预览里偏移，导出却正常**
   根因：Studio 预览把画面缩放了，`getBoundingClientRect()` 返回的是缩放后的值。
   修法：除以容器 `offsetWidth`/`offsetHeight` 做归一化，用比例而不是像素。

7. **异步资源（图片、字体、resize 测量）导致首帧空白**
   根因：数据没就绪就开始截图。
   修法：`delayRender()` 起手、`continueRender(handle)` 收尾，图片额外 `await img.decode()`。

8. **three.js / Lottie / Pixi 内部有自己的时钟**
   根因：这些库自带 ticker 或 `useFrame` 循环，不认 Remotion 的帧。
   修法：接管时钟——`@remotion/three` 用 `frameloop="never"` + 每帧 `advance()`；Lottie 用 `goToAndStop(frame, true)`；Pixi 手动 `app.ticker.update()` 或直接逐帧 `render()`。

## 验收（三条，全过才算完成）

```bash
# 1. 同帧两次渲染必须逐像素相同
bash assets/verify-determinism.sh <入口文件> <CompositionId> 200

# 2. 乱序区间渲染与连续渲染一致（Remotion 并发就是这样取帧的）
npx remotion render <入口> <Id> out/a.mp4 --frames=180-220
npx remotion render <入口> <Id> out/b.mp4 --frames=180-220 --concurrency=8
# 两个文件抽同一帧比对，md5 应相同

# 3. 连续帧差可接受：抽 20 帧看亮度/像素差没有突跳
```

只做 1、2 还不够——画面当然可能是"确定性的一坨屎"。视觉正确性按用户目测（见项目 `AGENTS.md`：视觉效果非必要不跑自动化验证）。

## 录屏什么时候才允许

详见 `references/recording-vs-frames.md`。一句话版本：

- **可以录**：真实软件界面/终端输出（伪造反而不专业）、你无法改源码的第三方 WebGL 场景、单帧渲染预算爆炸的复杂 shader
- **不许录**：文字动画、图表、转场、粒子、任何"改一句文案就要重来"的东西
- **折中**：录下来的当**素材**（贴图），动画与文字仍然帧驱动重做

## 附带资产

| 文件 | 用途 |
|---|---|
| `assets/keyframes.ts` | 关键帧插值、循环、yoyo、stagger、进度等小工具 |
| `assets/audit-time-sources.sh` | 扫出项目里所有外部时钟 |
| `assets/verify-determinism.sh` | 同帧两次渲染 + 比对 md5 |
| `references/gsap-mapping.md` | GSAP/Anime/Framer 到 Remotion 的逐条对照与代码示例 |
| `references/recording-vs-frames.md` | 录屏 vs 帧驱动的决策文档（含真实事故复盘） |
