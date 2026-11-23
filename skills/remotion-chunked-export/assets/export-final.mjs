#!/usr/bin/env node
/**
 * 长片分块导出：分块渲染视频 → 无损拼接 → 整段渲染音频 → 混流 → 校验帧数。
 *
 * 为什么这么做（详见 SKILL.md）：
 *   Remotion 每个渲染标签页各自解码视频素材，标签页活得越久越容易拿不到帧，
 *   画面就会一帧黑一帧亮。600 帧一块 + 并发 2 是实测稳定的组合；
 *   音频单独整段渲染，避免分块 AAC 的 priming 缝隙。
 *
 * 用法：
 *   node export-final.mjs
 *   TOTAL_FRAMES=2897 node export-final.mjs
 *   ENTRY=src/index.ts COMPOSITION=MyComp OUTPUT=out/final.mp4 node export-final.mjs
 *
 * 环境变量：
 *   ENTRY        入口文件               默认 src/index.ts
 *   COMPOSITION  合成 ID                默认 MyComp
 *   OUTPUT       输出文件               默认 out/final.mp4
 *   TOTAL_FRAMES 总帧数                 必填（从 npx remotion compositions 或时间线模块取）
 *   CHUNK_FRAMES 每块帧数               默认 600
 *   CONCURRENCY  并发                   默认 2
 *   AUDIO        0 表示不出音频          默认 1
 *   BROWSER      自定义 Chromium 路径    可选
 */
import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const ENTRY = process.env.ENTRY ?? "src/index.ts";
const COMPOSITION = process.env.COMPOSITION ?? "MyComp";
const OUTPUT = path.resolve(ROOT, process.env.OUTPUT ?? "out/final.mp4");
const TOTAL = Number(process.env.TOTAL_FRAMES ?? "");
const CHUNK = Number(process.env.CHUNK_FRAMES ?? 600);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 2);
const WITH_AUDIO = process.env.AUDIO !== "0";
const BROWSER = process.env.BROWSER ?? "";

const CHUNK_DIR = path.join(path.dirname(OUTPUT), "chunks");
const VIDEO_ONLY = path.join(path.dirname(OUTPUT), "video-only.mp4");
const AUDIO_ONLY = path.join(path.dirname(OUTPUT), "audio-only.wav");

if (!Number.isFinite(TOTAL) || TOTAL <= 0) {
  console.error("缺少 TOTAL_FRAMES。用 `npx remotion compositions` 看 durationInFrames。");
  process.exit(1);
}

const log = (...args) => console.log("[export:final]", ...args);

const remotion = (args) => {
  const extra = BROWSER ? [`--browser-executable=${BROWSER}`] : [];
  log("remotion", args.join(" "));
  execFileSync("npx", ["remotion", ...args, ...extra], { stdio: "inherit" });
};

const ffmpeg = (args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });

const main = async () => {
  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await rm(CHUNK_DIR, { recursive: true, force: true });
  await mkdir(CHUNK_DIR, { recursive: true });

  const chunks = [];
  for (let from = 0; from < TOTAL; from += CHUNK) {
    const to = Math.min(TOTAL - 1, from + CHUNK - 1);
    const file = path.join(CHUNK_DIR, `chunk-${String(from).padStart(5, "0")}.mp4`);
    log(`渲染 ${from}-${to} / ${TOTAL}`);
    remotion([
      "render", ENTRY, COMPOSITION, file,
      "--codec=h264",
      "--muted",
      `--concurrency=${CONCURRENCY}`,
      "--image-format=png",
      `--frames=${from}-${to}`,
    ]);
    chunks.push(file);
  }

  log("拼接视频流");
  const list = path.join(CHUNK_DIR, "concat.txt");
  await writeFile(
    list,
    chunks.map((c) => `file '${c.replaceAll("'", "'\\''")}'`).join("\n") + "\n"
  );
  ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", VIDEO_ONLY]);

  let videoInput = VIDEO_ONLY;
  if (WITH_AUDIO) {
    log("整段渲染音频");
    remotion([
      "render", ENTRY, COMPOSITION, AUDIO_ONLY,
      "--codec=wav",
      "--muted=false",
      `--frames=0-${TOTAL - 1}`,
    ]);
  }

  log("混流");
  const muxArgs = WITH_AUDIO
    ? ["-i", VIDEO_ONLY, "-i", AUDIO_ONLY, "-c:v", "copy", "-c:a", "aac", "-b:a", "320k", "-shortest"]
    : ["-i", VIDEO_ONLY, "-c", "copy"];
  ffmpeg([...muxArgs, "-movflags", "+faststart", OUTPUT]);

  const probe = JSON.parse(
    execFileSync("ffprobe", [
      "-v", "error",
      "-show_entries", "stream=codec_type,nb_frames,duration",
      "-show_entries", "format=duration,size",
      "-of", "json",
      OUTPUT,
    ], { encoding: "utf8" })
  );
  const video = probe.streams.find((s) => s.codec_type === "video");
  log(
    `完成 ${path.relative(ROOT, OUTPUT)}：${video?.nb_frames} 帧 / ${probe.format?.duration}s / ` +
      `${(Number(probe.format?.size) / 1024 / 1024).toFixed(1)} MB`
  );

  if (Number(video?.nb_frames) !== TOTAL) {
    throw new Error(`帧数不对：期望 ${TOTAL}，实际 ${video?.nb_frames}（某块可能渲染失败）`);
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
