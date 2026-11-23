/**
 * 帧驱动小工具：把"时间轴"写法压成对 frame 的纯函数。
 *
 * 用法：
 *   const y = at(frame, [[0, 40], [15, 0]], Easing.out(Easing.cubic));
 *   const glow = pingPong(frame, 60);
 *
 * 约定：关键帧表必须按帧号升序，帧号可以是小数；越界一律钳制。
 */
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export type Ease = (input: number) => number;
export type Keyframes = ReadonlyArray<readonly [frame: number, value: number]>;

/** 秒 → 帧。duration 类换算都走这里，别在组件里写死 30 */
export const secondsToFrames = (seconds: number, fps: number): number =>
  Math.round(seconds * fps);

/** 关键帧插值：给定帧号返回该帧的值，越界钳制 */
export const at = (
  frame: number,
  keys: Keyframes,
  easing: Ease = Easing.linear
): number => {
  if (keys.length === 0) {
    throw new Error("at(): 关键帧表为空");
  }
  if (keys.length === 1) {
    return keys[0][1];
  }
  return interpolate(
    frame,
    keys.map(([f]) => f),
    keys.map(([, v]) => v),
    { easing, extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
};

/** 起止帧之间的 0→1 进度，区间外钳制 */
export const progress = (frame: number, start: number, end: number): number => {
  if (end === start) {
    return frame >= end ? 1 : 0;
  }
  const p = (frame - start) / (end - start);
  return Math.min(1, Math.max(0, p));
};

/** 0→1→0 的三角波：替代 gsap 的 repeat + yoyo */
export const pingPong = (frame: number, periodFrames: number): number => {
  if (periodFrames <= 0) {
    throw new Error("pingPong(): 周期必须为正");
  }
  const t = loop(frame, periodFrames);
  return 1 - Math.abs((2 * t) / periodFrames - 1);
};

/** 循环取模，负数也安全：替代 repeat: -1 */
export const loop = (frame: number, periodFrames: number): number => {
  if (periodFrames <= 0) {
    throw new Error("loop(): 周期必须为正");
  }
  return ((frame % periodFrames) + periodFrames) % periodFrames;
};

/** 第 index 个元素的启动帧：替代 stagger */
export const stagger = (
  index: number,
  stepFrames: number,
  baseFrame = 0
): number => baseFrame + index * stepFrames;

/** 常用的"组件顶部一次性取齐"钩子，省得每个组件各写一遍 */
export const useFrameKit = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  return {
    frame,
    fps,
    durationInFrames,
    width,
    height,
    at: (keys: Keyframes, easing?: Ease) => at(frame, keys, easing),
    progress: (start: number, end: number) => progress(frame, start, end),
    pingPong: (periodFrames: number) => pingPong(frame, periodFrames),
  };
};
