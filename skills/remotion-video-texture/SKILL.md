---
name: remotion-video-texture
description: 把真实录屏/视频当纹理贴到 three.js 的屏幕、手机、显示器或卡片上，做设备 mockup（笔记本里跑着真软件、手机里放着真视频）。当需要"屏幕里是真实画面、镜头和光效是动效"、或者遇到 @remotion/media 的 Video 放进 ThreeCanvas 后导出全黑、屏幕闪黑帧、预览正常导出空白时使用。
---

# 视频当纹理：把录屏贴进 3D 机身

## 定位：录屏是**素材**，不是动画

这条线要分清（决策见 `remotion-frame-driven-refactor/references/recording-vs-frames.md`）：

- 屏幕**内容**：真实录屏，拍一次就好，是素材
- 屏幕**外面**的一切：机身运动、镜头推拉、光效、转场、文字：全部帧驱动

案例：一条竖版宣传片里，笔记本从画面下方升起、镜头推近、最后整机退出、点阵溶解，全部由 `frame` 算；只有屏幕里那 3491 帧 VS Code 操作是真素材（2218×1440 / 30fps / ≈143 MB）。

## 架构

```
<Video headless muted onVideoFrame>   ← 必须挂在 <ThreeCanvas> 外面
        │  videoFrame
        ▼
<canvas 2d>  ──drawImage──►  THREE.CanvasTexture  ──►  screen material
        ▲
        └── 每帧 needsUpdate + renderer.advance()
```

## 三个必踩的坑

### 1. 播放器必须放在 `<ThreeCanvas>` 外面

放进 r3f 的 Canvas 子树里，**导出阶段 `onVideoFrame` 一帧都不触发**，屏幕永远是黑的；Studio 预览有时反而是正常的，于是你以为没问题。布局层用 `<Sequence layout="none">` 包一下，保证不往 DOM 里插多余节点。

### 2. canvas 尺寸只能初始化一次

```ts
if (surface.canvas.width < 16) {   // 只设一次
  surface.canvas.width = width;
  surface.canvas.height = height;
}
```

给 `canvas.width` 赋值会**清空内容**。一旦某帧 `drawImage` 因为 `VideoFrame` 已关闭之类的时序问题失败，画布就变成全黑——表现就是"屏幕一帧黑一帧亮"。

### 3. 导出要同步重绘

```ts
if (isRendering) {
  rendererRef.current?.advance();     // 不能等下一帧，截图马上就来
} else {
  rendererRef.current?.invalidate();  // Studio 预览
}
```

`drawImage` 之后立刻 advance，否则截图拿到上一帧的内容。

`advance()` 的参数是"时钟时间"，**别传 `performance.now()`**——同一帧渲染两次会得到不同值，画面就不再是 `f(frame)` 了。用帧号换算：`advance((frame / fps) * 1000)`（`assets/useScreenVideoTexture.tsx` 里已这么写）。同理，场景里若有 `useFrame((state, delta) => ...)` 读 delta，一律改成用 `useCurrentFrame()`。

## 完整骨架

见 `assets/useScreenVideoTexture.tsx`（纹理 + 每帧绘制）与 `assets/useScreenDecks.tsx`（两段播放器：预载首帧 + 变速播放）。挂载方式：

```tsx
const { texture, onVideoFrame, rendererRef } = useScreenVideoTexture();

<ThreeCanvas frameloop="never" ...>
  <RendererBridge rendererRef={rendererRef} />
  <mesh>
    <planeGeometry args={[16, 10]} />
    <meshBasicMaterial map={texture} toneMapped={false} />
  </mesh>
</ThreeCanvas>

{/* 播放器在画布外面 */}
<ScreenDecks
  src={staticFile("screen/screen.mp4")}
  startFrame={430}          // 合成第几帧开始播
  playbackRate={1.5}        // 与时间线的变速同源
  onVideoFrame={onVideoFrame}
/>
```

## 细节清单

| 事项 | 做法 |
|---|---|
| 首帧预载 | 播放前用 `<Freeze frame={0}>` 冻一段，屏幕在升起阶段就已有画面 |
| 变速 | `playbackRate` 与合成的时间重映射**用同一个常量**，否则音画/字幕对不上 |
| 结尾停住 | 视频比合成短：让播放器跑到合成结束，播放器自己钳在最后一帧，不要用 `<Freeze>` 定格 |
| 倾斜发糊 | `texture.anisotropy = gl.capabilities.getMaxAnisotropy()`；`minFilter` 用 mipmap，`magFilter` 用 Linear |
| 色彩 | `texture.colorSpace = THREE.SRGBColorSpace`，材质 `toneMapped={false}`，渲染器 `NoToneMapping` |
| 闪烁 | 先按上面三坑查；仍闪就分块渲染（见 `remotion-chunked-export`） |
| 素材体积 | 案例里 143 MB 的录屏拖垮了并发解码（40% 帧黑），能压就压，或用分块导出兜住（见 `remotion-chunked-export`） |

## 什么时候别用这套

- 屏幕内容其实是网页/图表/代码：**用 DOM 帧驱动画出来**，别录屏，录屏会糊、不可改
- 只是想"把视频放进画面做个画中画"：直接用 `<Video>` 或 `<OffthreadVideo>`，不需要 3D
- 需要屏幕里有**可交互**的假 UI：用 React 渲染再当纹理是可行的，但别录屏

## 附带资产

| 文件 | 用途 |
|---|---|
| `assets/useScreenVideoTexture.tsx` | canvas → CanvasTexture，含尺寸只初始化一次、失败保上一帧 |
| `assets/useScreenDecks.tsx` | 预载首帧 + 变速播放两段播放器 |
