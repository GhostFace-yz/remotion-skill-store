import React from "react";
import { Freeze, Sequence, staticFile } from "remotion";
import { Video } from "@remotion/media";

type Props = {
  /** public/ 下的相对路径，例如 "screen/screen.mp4" */
  src: string;
  /** 合成里的第几帧开始播放（绝对帧） */
  startFrame: number;
  /** 播放到合成结束即可，视频比合成短时播放器自己停在最后一帧 */
  playbackRate?: number;
  /** 提前多少帧预载，让首帧先到，避免"升起时屏幕是黑的" */
  preloadFrames?: number;
  onVideoFrame: (frame: CanvasImageSource & Record<string, number | undefined>) => void;
};

/**
 * 两段播放器共用同一个纹理：
 *  1. 预载段：<Freeze frame={0}> 把子树帧冻在 0，于是每帧都取视频第 0 帧，
 *     屏幕停在第一帧（注意：Freeze 的帧号是相对父 Sequence 的）
 *  2. 播放段：按 playbackRate 播放，一直跑到合成结尾
 *
 * 必须挂在 <ThreeCanvas> 外面：@remotion/media 的播放器放进 r3f 的 Canvas 子树里，
 * 导出阶段 onVideoFrame 一帧都不触发，屏幕会一直黑。
 * layout="none" 保证不往 DOM 里插多余节点。
 */
export const ScreenDecks: React.FC<Props> = ({
  src,
  startFrame,
  playbackRate = 1,
  preloadFrames = 30,
  onVideoFrame,
}) => {
  const url = staticFile(src);
  const preloadFrom = Math.max(0, startFrame - preloadFrames);

  return (
    <>
      <Sequence layout="none" from={preloadFrom} durationInFrames={startFrame - preloadFrom}>
        <Freeze frame={0}>
          <Video src={url} headless muted onVideoFrame={onVideoFrame} />
        </Freeze>
      </Sequence>
      <Sequence layout="none" from={startFrame}>
        <Video
          src={url}
          headless
          muted
          playbackRate={playbackRate}
          onVideoFrame={onVideoFrame}
        />
      </Sequence>
    </>
  );
};
