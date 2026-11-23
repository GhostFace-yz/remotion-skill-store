import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useRemotionEnvironment } from "remotion";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * 把视频帧画到 canvas，再把 canvas 当纹理。
 *
 * 三条铁律（每条都对应一次线上事故）：
 *  1. canvas 尺寸只初始化一次 —— 给 canvas.width 赋值会清空内容，
 *     某帧 drawImage 失败就会留下全黑，表现为"屏幕一帧黑一帧亮"。
 *  2. drawImage 失败就保留上一帧，绝不清屏。
 *  3. 导出阶段每帧必须同步 advance()，否则截图拿到的是上一帧。
 */
export const useScreenVideoTexture = () => {
  const { isRendering } = useRemotionEnvironment();
  const rendererRef = useRef<{
    advance: () => void;
    invalidate: () => void;
    gl: THREE.WebGLRenderer;
  } | null>(null);

  const [surface] = useState(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      throw new Error("useScreenVideoTexture: 拿不到 2d context");
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return { canvas, context, texture, sized: false };
  });

  const onVideoFrame = useCallback(
    (videoFrame: CanvasImageSource & Record<string, number | undefined>) => {
      // 导出路径给的是 VideoFrame，预览路径可能是 HTMLCanvasElement，尺寸属性名不同
      const width =
        videoFrame.displayWidth ||
        videoFrame.codedWidth ||
        (videoFrame as HTMLVideoElement).videoWidth ||
        (videoFrame as HTMLImageElement).naturalWidth ||
        videoFrame.width;
      const height =
        videoFrame.displayHeight ||
        videoFrame.codedHeight ||
        (videoFrame as HTMLVideoElement).videoHeight ||
        (videoFrame as HTMLImageElement).naturalHeight ||
        videoFrame.height;
      if (!width || !height) {
        return;
      }
      try {
        if (!surface.sized) {
          surface.canvas.width = width;
          surface.canvas.height = height;
          surface.sized = true;
        }
        surface.context.drawImage(
          videoFrame as CanvasImageSource,
          0,
          0,
          surface.canvas.width,
          surface.canvas.height
        );
        surface.texture.needsUpdate = true;
        if (isRendering) {
          rendererRef.current?.advance();
        } else {
          rendererRef.current?.invalidate();
        }
      } catch {
        // 这一帧取不到就保留上一帧
      }
    },
    [isRendering, surface]
  );

  return { texture: surface.texture, onVideoFrame, rendererRef };
};

/** 各向异性：倾斜的屏幕上文字不被 mipmap 抹平。放在 ThreeCanvas 里的任意位置即可 */
export const ScreenTextureAnisotropy = ({ texture }: { texture: THREE.Texture }) => {
  const gl = useThree((state) => state.gl);
  useLayoutEffect(() => {
    texture.anisotropy = gl.capabilities.getMaxAnisotropy();
    texture.needsUpdate = true;
  }, [gl, texture]);
  return null;
};

/** 把 r3f 的 advance / invalidate 交给画布外面的视频层调用 */
export const RendererBridge = ({
  rendererRef,
}: {
  rendererRef: React.RefObject<{
    advance: () => void;
    invalidate: () => void;
    gl: THREE.WebGLRenderer;
  } | null>;
}) => {
  const gl = useThree((state) => state.gl);
  const { advance, invalidate } = useThree();

  useLayoutEffect(() => {
    rendererRef.current = { advance: () => advance(performance.now()), invalidate, gl };
    return () => {
      rendererRef.current = null;
    };
  }, [advance, gl, invalidate, rendererRef]);

  return null;
};
