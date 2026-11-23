# 动画库 → 帧驱动：逐条对照

这份文档假设你已经知道"要用 `interpolate`"，缺的是**每条 API 对应什么**。所有示例里的 `fps` 都来自 `useVideoConfig()`。

---

## 0. 心智模型：时间轴是函数，不是进程

GSAP 的 timeline 本质是"随时间推进的进程"，它会在每一帧改变 DOM。帧驱动里没有"进程"，只有一张**关键帧表**：

```
duration: 1s  →  30 帧（fps=30）
at 0.0s x=0  →  [0, 0]
at 0.6s x=100 →  [18, 100]
```

把 `x` 看成 `f(frame)`，链式调用就消失了。

---

## 1. `gsap.to` / `from` / `fromTo`

```js
gsap.to(el, { x: 100, opacity: 0, duration: 0.6, ease: "power2.out" });
```

```tsx
const p = interpolate(frame, [0, 18], [0, 1], { easing: Easing.out(Easing.quad) });
<div style={{ transform: `translateX(${100 * p}px)`, opacity: 1 - p }} />
```

- `from` 就是交换 `[起始, 目标]`
- `fromTo` 就是 `[from, to]` 两个值都写死
- **`el` 上的 CSS 其它属性别跟着动**：原来靠 CSS 类继承的东西，在 Remotion 里要显式写在 style 上

## 2. timeline 与 position 参数

GSAP 的 `"-=0.3"`、`"<"`、`"+=0.5"` 是**相对定位**，而帧驱动要求绝对帧。

```js
const tl = gsap.timeline();
tl.to(".a", { opacity: 1, duration: 0.3 })     // 0.0 → 0.3
  .to(".b", { y: 0, duration: 0.4 }, "-=0.1")  // 0.2 → 0.6
  .to(".c", { scale: 1, duration: 0.2 }, "<"); // 0.2 → 0.4（与 b 同时）
```

```ts
const A_START = 0;
const A_END = 9;            // 0.3s
const B_START = A_END - 3;  // "-=0.1s"
const B_END = B_START + 12; // 0.4s
const C_START = B_START;    // "<"
```

**做法**：手推一遍，把结果写成常量，全部放进一个文件（本项目：`bgTimeline.js`）。推完就不要再用相对量——后面加镜头时相对量会连锁错位。

## 3. `defaults`

```js
gsap.defaults({ ease: "power2.out", duration: 0.5 });
```

→ 变成一个 `const EASE = Easing.out(Easing.quad)` 和一个 `const DUR = 15`，显式传参。**不要用全局默认值**，它让每一帧的计算依赖模块初始化顺序。

## 4. 缓动对照

| GSAP | Remotion |
|---|---|
| `none` / `linear` | `Easing.linear` |
| `power1/2/3/4.out` | `Easing.out(Easing.quad/cubic/poly(4)/poly(5))` |
| `power2.in` / `.inOut` | `Easing.in(...)` / `Easing.inOut(...)` |
| `expo.out` | `Easing.out(Easing.exp)` |
| `circ.out` | `Easing.out(Easing.circle)` |
| `back.out(1.7)` | `Easing.out(Easing.back(1.7))` |
| `elastic.out` | `spring()` 或 `Easing.elastic(1)` |
| `steps(5)` | `Easing.step0(5)` / `Easing.step1(5)` |
| `CustomEase` | `Easing.bezier(x1, y1, x2, y2)` |
| `rough` | 无对应：改成关键帧表，或少量抖动 = `random(seed)` |

`Easing.in/out/inOut` 包住即可，注意 `back`/`elastic` 会**过冲**，超出 `[0,1]` 时 `interpolate` 默认不钳制——想要过冲就保留，不想要就 `clamp`。

## 5. stagger

```js
gsap.from(".item", { y: 20, stagger: 0.05 });
```

```ts
const STEP = Math.round(0.05 * fps);
items.map((item, i) => {
  const p = interpolate(frame, [i * STEP, i * STEP + 12], [20, 0], { extrapolateLeft: "clamp" });
  return <div style={{ transform: `translateY(${p}px)` }} />;
});
```

`stagger: { from: "center" }` → `const d = Math.abs(i - (n - 1) / 2) * STEP`；`from: "random"` → 用固定种子打乱一次（在模块作用域算，不要每帧算）。

**亚帧问题**：`0.05 * 30 = 1.5` 帧。取整会让间隔变成 1 或 2 帧交替，视觉上反而更自然；想要精确就用小数帧（`interpolate` 接受小数）。

## 6. repeat / yoyo / repeatDelay

```js
gsap.to(el, { x: 100, repeat: -1, yoyo: true, duration: 1 });
```

```ts
const loopFrame = frame % period;                     // period = 30
const wave = 1 - Math.abs(2 * loopFrame / period - 1); // 0 → 1 → 0
const x = 100 * wave;
```

工具函数在 `../assets/keyframes.ts`：`loop()`、`pingPong()`。

**注意**：循环必须由帧算，不能"上一帧到顶了就反向"——那是状态机，乱序渲染会炸。

## 7. 多属性不同关键帧

```js
tl.to(el, { keyframes: [{ x: 0 }, { x: 50, y: 20 }, { y: 0 }], duration: 1 });
```

→ 每个属性一张表，帧号相同即可：

```ts
const x = interpolate(frame, [0, 15, 30], [0, 50, 50]);
const y = interpolate(frame, [0, 15, 30], [0, 20, 0]);
```

## 8. 回调

| 原写法 | 帧驱动 |
|---|---|
| `onStart` | 该段起始帧 = 常量，用 `frame >= start` 判断 |
| `onComplete` | `frame >= end`；需要"播完才进入下一段"就用帧区间 |
| `onUpdate` 改别的元素 | 把值提上去，两个元素读同一个派生值 |
| `call()` 插入时间轴 | 变成新的帧常量 |

回调在渲染中是**执行一次还是多次不确定**的，任何写状态的回调都要删掉。

## 9. ScrollTrigger

`scrub` 的本质是"滚动进度当时间轴进度"，映射到视频里就是"帧号当进度"：

```ts
// 原来：scroll 0 → 1000px 时把 logo 转 360°
const p = interpolate(frame, [START, START + 90], [0, 1], { extrapolateRight: "clamp" });
const rotate = 360 * p;
```

- `pin: true` → 用帧区间"假装停住"（其它元素动、它不动）
- 依赖 `window.innerHeight` 的断点 → 换成 composition 的宽高常量
- 依赖真实滚动的视差 → 把每个层的位移系数手写成常量

**不要真的去监听 scroll**：视频里没有滚动条。

## 10. SplitText / TextPlugin / 打字机

```ts
const perChar = 2; // 帧
const text = "bili-in-code";
text.split("").map((ch, i) => {
  const start = i * perChar;
  const visible = frame >= start;
  return <span style={{ opacity: visible ? 1 : 0 }}>{ch}</span>;
});
```

- 需要"抖动/渐显"同理：`interpolate(frame, [start, start + 6], [0, 1])`
- 等宽字体下别用"逐字 shift"，会挤动后续字符；用 `opacity` 或 `clip-path` 更稳

## 11. MotionPathPlugin

路径动画没有解析解时，**预采样**：把 SVG path 采样成 60 个点，写进关键帧表，然后按帧查表插值。

```ts
const pathSamples = [/* [x, y], ... 60 个点 */];
const idx = Math.min(pathSamples.length - 1, Math.floor((frame / total) * pathSamples.length));
```

采样一次存成常量，不要每帧重算路径长度。

## 12. modifier / snap

```js
snap: { x: 20 }  // 吸附到 20 的整数倍
```

```ts
const x = Math.round(raw / 20) * 20;
```

注意**吸附后不要再用它做插值输入**，否则会出现台阶跳变——视觉上这是想要的效果，但要确认。

---

## framer-motion

| 原写法 | 帧驱动 |
|---|---|
| `<motion.div animate={{x: 100}} transition={{duration: 0.6}}>` | `interpolate` + 内联 style |
| `variants` + `initial/animate` | 帧区间 + 每段的起始帧常量 |
| `useSpring(value, config)` | `spring({ frame, fps, config })` |
| `useScroll()` / `useTransform` | 帧号当进度（同 ScrollTrigger） |
| `AnimatePresence` 出场 | 两个帧区间：`[inStart, inEnd]` / `[outStart, outEnd]`，用 `frame` 判断渲染哪个 |
| `layout` 动画 | **删掉**，改成显式宽高关键帧 |

framer-motion 的 `animate` 有内部调度器，在 Remotion 里可能"只动一次"或"完全不动"，不要试图让它跟帧。

## anime.js

```js
anime({ targets: ".box", translateX: 100, duration: 600, easing: "easeOutQuad", loop: true, direction: "alternate" });
```

→ `loop` + `direction: "alternate"` = `pingPong`；`duration` 是毫秒，除以 1000 再乘 fps；`easeOutQuad` → `Easing.out(Easing.quad)`。`anime.timeline()` 的 `offset` 参数就是 GSAP 的 position，按第 2 节推绝对帧。

## Web Animations API

```js
el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600, fill: "forwards" });
```

→ 同上。`el.animate` 返回的 `Animation` 在截图时不推进，必须删掉。

## Lottie

```js
animation.goToAndStop(frameInLottie, true);
```

必须用 `goToAndStop`（第二参数 `isFrame`），不能 `play()`。同时 `lottie-web` 的 `renderer: "svg"` 在大量帧下会比 `canvas` 慢，二选一按需。

## three.js / R3F

```tsx
// ❌ 组件自己跑循环
useFrame((state, delta) => { mesh.rotation.y += delta; });

// ✅ 由帧算
const frame = useCurrentFrame();
mesh.rotation.y = frame * 0.01;
```

配合 `@remotion/three` 的 `<ThreeCanvas frameloop="never">`，并在每帧的 `useLayoutEffect` 里 `advance()`，否则导出时截图会拿到旧画面。

---

## 反模式清单（见到就改）

- `useState` 存动画进度
- `useEffect` 里起 `setInterval` / `rAF`
- `Date.now()` 算 delta
- `Math.random()` 直接用于画面（要用就给种子）
- 依赖 `window.innerWidth` 布局（用 `useVideoConfig()` 的宽高）
- CSS `transition`/`animation`/`@keyframes`
- 动画库的 `play()` / `ticker` / 自动播放
- 把帧号传给 `setTimeout` 做延时（延时 = 帧区间）
