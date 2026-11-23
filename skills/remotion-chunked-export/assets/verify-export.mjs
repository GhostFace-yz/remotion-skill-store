#!/usr/bin/env node
/**
 * 成片验收：黑帧、闪烁、音频断点。纯 ffmpeg 解码 + 手工统计，不依赖图像库。
 *
 * 用法：
 *   node verify-export.mjs out/final.mp4
 *   node verify-export.mjs out/final.mp4 --crop=300,200,700,600   # 只看某区域（例如笔记本屏幕）
 *   node verify-export.mjs out/final.mp4 --fps=30
 *
 * 判定基线（本项目实测）：
 *   黑帧 0；帧间平均亮度差中位数 < 1（修复前 12.77）；音频无明显断点。
 */
import { execFileSync } from "node:child_process";

const run = (bin, args) => execFileSync(bin, args, { maxBuffer: 1 << 30 });

const argv = process.argv.slice(2);
const video = argv.find((a) => !a.startsWith("--"));
if (!video) {
  console.error("用法: node verify-export.mjs <video.mp4> [--crop=x,y,w,h] [--fps=30]");
  process.exit(1);
}
const opt = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const FPS = Number(opt("fps", "30"));
const CROP = opt("crop", "");
const SAMPLE_W = 48;
const SAMPLE_H = 64;
const SILENCE_AMP = 12; // s16 幅度阈值，约 -68 dBFS
const GAP_SECONDS = 0.05;

const probe = JSON.parse(
  run("ffprobe", [
    "-v", "error",
    "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate,nb_frames,duration,sample_rate,channels",
    "-show_entries", "format=duration,size",
    "-of", "json",
    video,
  ]).toString()
);
const v = probe.streams.find((s) => s.codec_type === "video");
const a = probe.streams.find((s) => s.codec_type === "audio");

// ---- 画面：抽成 48×64 灰度，逐帧算平均亮度 ----
const vf = [`fps=${FPS}`, CROP ? `crop=${CROP}` : null, `scale=${SAMPLE_W}:${SAMPLE_H}`, "format=gray"]
  .filter(Boolean)
  .join(",");
const raw = run("ffmpeg", ["-v", "error", "-i", video, "-vf", vf, "-f", "rawvideo", "-"]);
const frameSize = SAMPLE_W * SAMPLE_H;
const frameCount = Math.floor(raw.length / frameSize);

const means = new Array(frameCount);
for (let i = 0; i < frameCount; i++) {
  let sum = 0;
  const base = i * frameSize;
  for (let p = 0; p < frameSize; p++) sum += raw[base + p];
  means[i] = sum / frameSize;
}

const blackFrames = [];
means.forEach((m, i) => {
  if (m < 3) blackFrames.push(i);
});

const diffs = [];
for (let i = 1; i < means.length; i++) diffs.push(Math.abs(means[i] - means[i - 1]));
const sorted = [...diffs].sort((x, y) => x - y);
const pick = (q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);
const median = pick(0.5);
const p99 = pick(0.99);
const max = sorted.length ? sorted[sorted.length - 1] : 0;

// ---- 音频：8kHz 单声道，算 RMS 与静音段 ----
let audioLine = "无音轨";
let gaps = [];
let rmsDb = null;
let peakDb = null;
if (a) {
  const pcm = run("ffmpeg", ["-v", "error", "-i", video, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "-"]);
  const samples = pcm.length >> 1;
  let sumSquares = 0;
  let peak = 0;
  for (let i = 0; i < samples; i++) {
    const s = pcm.readInt16LE(i * 2);
    sumSquares += s * s;
    if (Math.abs(s) > peak) peak = Math.abs(s);
  }
  const rms = Math.sqrt(sumSquares / Math.max(1, samples));
  const toDb = (x) => (x > 0 ? 20 * Math.log10(x / 32768) : -Infinity);
  rmsDb = toDb(rms);
  peakDb = toDb(peak);

  const win = Math.round(8000 * GAP_SECONDS);
  const windows = Math.floor(samples / win);
  const loud = [];
  for (let w = 0; w < windows; w++) {
    let peakInWin = 0;
    for (let i = 0; i < win; i++) {
      const s = Math.abs(pcm.readInt16LE((w * win + i) * 2));
      if (s > peakInWin) peakInWin = s;
    }
    loud.push(peakInWin >= SILENCE_AMP);
  }
  // 中间（前后都有声音）的静音段才算断裂
  let start = -1;
  for (let w = 0; w < loud.length; w++) {
    if (!loud[w] && start < 0) start = w;
    const isEnd = loud[w] || w === loud.length - 1;
    if (start >= 0 && isEnd) {
      const end = w;
      const before = loud.slice(0, start).some(Boolean);
      const after = loud.slice(Math.min(loud.length, end + 1)).some(Boolean);
      if (before && after && (end - start) * GAP_SECONDS >= GAP_SECONDS) {
        gaps.push({ at: +(start * GAP_SECONDS).toFixed(2), dur: +((end - start) * GAP_SECONDS).toFixed(2) });
      }
      start = -1;
    }
  }
  audioLine = `${a.codec_name} ${a.sample_rate}Hz ${a.channels}ch`;
}

// ---- 报告 ----
const ok = blackFrames.length === 0 && median < 1;
const fmt = (x) => (x === null || !Number.isFinite(x) ? "—" : x.toFixed(2));
console.log(`文件    ${video}`);
console.log(`视频    ${v.width}x${v.height} @${v.r_frame_rate} ${mode(v.codec_name)} ${v.nb_frames} 帧 / ${probe.format.duration}s / ${(Number(probe.format.size) / 1024 / 1024).toFixed(1)} MB`);
console.log(`音频    ${audioLine}`);
console.log(`画面    平均亮度 ${fmt(means.reduce((x, y) => x + y, 0) / Math.max(1, means.length))}，黑帧 ${blackFrames.length}${blackFrames.length ? `（前 10 个：${blackFrames.slice(0, 10).join(",")}）` : ""}`);
console.log(`闪烁    帧间亮度差 中位 ${fmt(median)} / p99 ${fmt(p99)} / 最大 ${fmt(max)}`);
if (rmsDb !== null) {
  console.log(`音频电平 整体 RMS ${fmt(rmsDb)} dBFS，峰值 ${fmt(peakDb)} dBFS，静音段 ${gaps.length} 处${gaps.length ? `（${gaps.slice(0, 6).map((g) => `${g.at}s/${g.dur}s`).join("、")}；≥${GAP_SECONDS}s 的间隔，多为自然停顿，落在分块拼接点才需要怀疑）` : ""}`);
}
console.log(`判定    ${ok ? "✅ 通过" : "❌ 不通过"}`);
process.exit(ok ? 0 : 1);

function mode(name) {
  return name ?? "";
}
