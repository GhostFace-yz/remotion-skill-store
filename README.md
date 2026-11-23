# remotion-skill-store

给 Remotion 项目复用的技能库。每做完一版片子，把**能复用的逻辑、素材、和踩过的坑**沉淀到这里，下一个项目直接调用。

## 一条主线：帧驱动优先，录屏是下策

这个库的判断标准只有一条：

> **画面必须是 `frame` 的纯函数。** 给定帧号，输出唯一确定的像素。

凡是"用外部时钟推动的画面"——GSAP 时间轴、`requestAnimationFrame` 循环、CSS `transition`、第三方 canvas 动画库——都要重构成帧驱动（见 `remotion-frame-driven-refactor`）。

**录屏是最不该用的手段。** 它把动画变成了像素：一句文案改动要重录全片，文字放大就糊，素材几十上百 MB，还会引发解码丢帧（案例：143 MB 素材 + 多标签页并发解码，40% 的帧变黑）。录屏只在"拍真实界面"时成立，而且录下来的是**素材**，动画、文字、转场仍然应该用帧重做。详见 `skills/remotion-frame-driven-refactor/references/recording-vs-frames.md`。

## 技能索引

| 技能 | 一句话 | 什么时候触发 |
|---|---|---|
| [`remotion-frame-driven-refactor`](skills/remotion-frame-driven-refactor/SKILL.md) | 把 GSAP / anime.js / framer-motion / rAF 动画重构成帧驱动 | 想复用别人的网页动效；Remotion 里动画不跟帧走、导出与预览不一致 |
| [`remotion-chunked-export`](skills/remotion-chunked-export/SKILL.md) | 长片成片稳定导出：分块渲染 + 整段音频 + 自动验收 | 出片闪黑；时长超过 1500 帧；画面里贴了视频 |
| [`remotion-video-texture`](skills/remotion-video-texture/SKILL.md) | 把真实录屏当纹理贴到 3D 机身/屏幕上 | 做设备 mockup；要把真实软件画面放进 3D 场景 |

## 怎么用

技能就是标准目录 + `SKILL.md`。拷进 DSH 的技能目录即可：

```bash
# 软链（推荐：改仓库内容立即生效）
ln -s "$(pwd)/skills/remotion-chunked-export" ~/.agents/skills/remotion-chunked-export

# 或者拷贝（需要重拷才更新）
cp -R skills/remotion-chunked-export ~/.agents/skills/
```

装好后重启会话，技能会出现在可用技能列表里，描述是中文的，能直接看懂什么时候该用。

⚠️ **必须整目录拷/链**，保留 `assets/`、`references/` 子目录：`SKILL.md` 里用的是相对路径（`assets/verify-export.mjs`、`references/gsap-mapping.md`），把文件平铺出去这些引用就断了。`name:` 也必须和目录名一致。


## 目录约定

```
skills/<name>/
├── SKILL.md         # 必须有 frontmatter：name（= 目录名）、description（中文，含触发词）
├── references/      # 长文：对照表、决策文档、案例复盘
└── assets/          # 可直接拷进项目的代码、脚本、模板
```

## 写作硬规矩（5 条）

1. **description 用中文写清"什么时候用它"**，把用户会说的原话写进去（"导出闪黑"、"GSAP 不跟帧"）。
2. **必须写坑**：症状 → 根因 → 修法。只写"正确写法"没有价值，正确写法本来就搜得到；被判过刑的地方才是资产。
3. **必须写验收**：怎么证明它对了。脚本 > 肉眼，数字 > 形容词。
4. **数据必须带上下文**：实测数字写清素材规格（分辨率/帧数/体积/编码）和 Remotion 版本，并注明"换素材要重测"。没有上下文的"实测 600 帧没问题"会被下一个项目当常数照搬。
5. **不要写死项目路径**：正文里提别的项目的文件名（`bgTimeline.js` 之类），换项目就是幽灵引用。案例数据可以留，但要标成"案例"。

## 待整理

按优先级排，攒够一次踩坑就写一条：

- `remotion-webgl-frame-recorder`：用虚拟时钟 + 分块缓存把 WebGL 背景逐帧录成视频。本次用过，属于兜底手段，要把"什么时候允许"写清楚再收。
- `remotion-animalese-voice`：中文 → 拼音音节合成乱码语音/旁白，含音色参数与时长对齐。
- `remotion-halftone-shader`：半色调点阵材质，屏幕空间网格与 2D 背景对齐。
- `remotion-layout-metrics`：把版式关键坐标量出来写进 JSON，渲染脚本与动画共用同一份数据。
